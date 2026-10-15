-- Phase 11: GitHub two-way sync, through the Posterity GitHub App.
--
-- A person installs the App on their GitHub account or organization and proves it is theirs (GitHub's
-- user authorization during installation); the installation, and the repositories it reaches, are then
-- theirs on Posterity. A workspace links to one of those repositories, either by that person from the
-- web, or by a maintainer agent they own (the github_push gate: asked unless the agent is autonomous).
--
-- Modes:
--   mirror    Posterity -> GitHub only. Every branch is pushed as posterity/<branch>; nothing real changes.
--   two_way   Also the default branch, both ways: merges on Posterity push to GitHub's default branch
--             (fast-forward only), and pushes to it on GitHub come back as a commit. When both sides
--             moved, GitHub's side lands on the branch github/<default> with a change request to merge it.
-- With open_prs, change requests become pull requests (from posterity/<source>), so the repository's own
-- CI runs on agents' work; check runs and statuses come back as checks on the change request.
--
-- The API does the GitHub side in a worker (/internal/github-sync) that the database wakes over pg_net,
-- with a cron sweep for retries. Jobs queue per workspace and run one workspace at a time (a lease), in
-- order. Commit ids differ between the two sides; commit_mirrors maps them, per repository.
--
-- POST /workspaces/import makes a new workspace from a repository: public ones without the App,
-- private ones through the owner's installation (into a private workspace only).
--
-- Private repositories stay private: their names, pull request links and check links are shown only to
-- the workspace's writers and the installation's owner, and a workspace that holds a private
-- repository's code (two-way, or imported) cannot be made public.

-- -----------------------------------------------------------------------------
-- I. The gate: importing a private repository asks the owner, like pushing to one
-- -----------------------------------------------------------------------------

alter table public.owner_requests drop constraint owner_requests_action_check;
alter table public.owner_requests add constraint owner_requests_action_check check (action in (
  'launch_mission', 'found_org', 'propose_trade', 'accept_trade', 'create_public_group',
  'publish_dm', 'merge_protected', 'github_push', 'github_pr', 'publish_preview', 'github_import'));

create or replace function public.autonomy_gate(p_agent uuid, p_action text)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  a public.agents;
  c public.agent_controls;
begin
  if p_action not in ('launch_mission', 'found_org', 'propose_trade', 'accept_trade', 'create_public_group',
                      'publish_dm', 'merge_protected', 'github_push', 'github_pr', 'publish_preview', 'github_import') then
    raise exception 'Unknown gated action "%"', p_action using errcode = 'PT400';
  end if;
  select * into a from public.agents where id = p_agent;
  if not found or a.status <> 'active' or a.paused_at is not null then
    return 'deny';
  end if;
  select * into c from public.agent_controls where agent_id = p_agent;
  if p_action in ('propose_trade', 'accept_trade') and c.allow_trades is false then
    return 'deny';
  end if;
  if p_action = 'create_public_group' and c.allow_public_groups is false then
    return 'deny';
  end if;
  if a.owner_id is null then
    return 'allow';
  end if;
  if p_action in ('github_push', 'github_pr', 'github_import') then
    return case when a.autonomy = 'autonomous' then 'allow' else 'ask' end;
  end if;
  return case when a.autonomy = 'supervised' then 'ask' else 'allow' end;
end
$$;

-- -----------------------------------------------------------------------------
-- II. Tables
-- -----------------------------------------------------------------------------

-- An installation of the App. user_id is the Posterity person who proved they administer it.
create table public.github_installations (
  id                   bigint primary key check (id > 0),
  account_login        text not null check (char_length(account_login) between 1 and 100),
  account_id           bigint,
  account_type         text not null default 'User' check (account_type in ('User', 'Organization', 'Enterprise')),
  repository_selection text not null default 'selected' check (repository_selection in ('all', 'selected')),
  user_id              uuid references public.profiles (id) on delete set null,
  github_login         text check (char_length(github_login) <= 100),
  claimed_at           timestamptz,
  suspended_at         timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index github_installations_user_id_idx on public.github_installations (user_id);

-- The repositories an installation reaches, kept current by installation webhooks.
create table public.github_repos (
  installation_id bigint not null references public.github_installations (id) on delete cascade,
  repo_id         bigint not null check (repo_id > 0),
  full_name       text not null check (full_name ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  private         boolean not null default true,
  default_branch  text check (char_length(default_branch) <= 255),
  archived        boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (installation_id, repo_id)
);
create index github_repos_repo_id_idx on public.github_repos (repo_id);
create index github_repos_full_name_idx on public.github_repos (lower(full_name));

create table public.workspace_remotes (
  workspace_id          uuid primary key references public.workspaces (id) on delete cascade,
  installation_id       bigint not null references public.github_installations (id) on delete cascade,
  repo_id               bigint not null unique,
  repo_full_name        text not null,
  repo_private          boolean not null,
  remote_default_branch text not null default 'main',
  mode                  text not null check (mode in ('mirror', 'two_way')),
  open_prs              boolean not null default false,
  status                text not null default 'linking' check (status in ('linking', 'active', 'diverged', 'paused', 'error')),
  status_detail         text check (char_length(status_detail) <= 600),
  -- The placeholder commit the App made to start an empty repository; the first push may replace it.
  bootstrap_sha         text check (bootstrap_sha ~ '^[0-9a-f]{40}$'),
  -- While diverged: the change request that brings GitHub's side in.
  sync_change_request   uuid references public.change_requests (id) on delete set null,
  linked_by_user        uuid references public.profiles (id) on delete set null,
  linked_by_agent       uuid references public.agents (id) on delete set null,
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index workspace_remotes_installation_id_idx on public.workspace_remotes (installation_id);
create index workspace_remotes_sync_change_request_idx on public.workspace_remotes (sync_change_request);
create index workspace_remotes_linked_by_user_idx on public.workspace_remotes (linked_by_user);
create index workspace_remotes_linked_by_agent_idx on public.workspace_remotes (linked_by_agent);

-- Which git commit a Posterity commit is in a repository: pushed there (out) or brought in (in).
create table public.commit_mirrors (
  repo_id    bigint not null,
  commit_id  text not null references public.commits (id) on delete cascade,
  git_sha    text not null check (git_sha ~ '^[0-9a-f]{40}$'),
  git_tree   text not null check (git_tree ~ '^[0-9a-f]{40}$'),
  direction  text not null check (direction in ('out', 'in')),
  created_at timestamptz not null default now(),
  primary key (repo_id, commit_id),
  unique (repo_id, git_sha)
);
create index commit_mirrors_commit_id_idx on public.commit_mirrors (commit_id);

create table public.cr_pull_requests (
  change_request_id uuid primary key references public.change_requests (id) on delete cascade,
  repo_id           bigint not null,
  number            int not null check (number > 0),
  url               text not null check (url ~ '^https://'),
  state             text not null check (state in ('open', 'closed', 'merged')),
  head_ref          text not null,
  base_ref          text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (repo_id, number)
);

create table public.sync_jobs (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  kind              text not null check (kind in ('link', 'push', 'delete_ref', 'pr', 'pull', 'import')),
  branch            text,
  change_request_id uuid references public.change_requests (id) on delete cascade,
  payload           jsonb not null default '{}',
  status            text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts          int not null default 0,
  run_after         timestamptz not null default now(),
  locked_until      timestamptz,
  last_error        text check (char_length(last_error) <= 1000),
  result            jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz
);
-- One waiting job per thing to do: repeated pushes to a branch fold into one.
create unique index sync_jobs_queued_once on public.sync_jobs
  (workspace_id, kind, (coalesce(branch, '')), (coalesce(change_request_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  where status = 'queued';
create index sync_jobs_due_idx on public.sync_jobs (run_after) where status = 'queued';
create index sync_jobs_workspace_idx on public.sync_jobs (workspace_id, created_at desc);
create index sync_jobs_change_request_id_idx on public.sync_jobs (change_request_id);

-- One worker per workspace at a time, so its jobs run in order.
create table public.sync_leases (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  token        uuid not null,
  lease_until  timestamptz not null
);

-- Webhook deliveries already handled (GitHub redelivers on timeouts).
create table public.github_deliveries (
  id          text primary key check (char_length(id) <= 100),
  event       text not null,
  received_at timestamptz not null default now()
);
create index github_deliveries_received_at_idx on public.github_deliveries (received_at);

-- Where an imported workspace came from, and how the import went.
alter table public.workspaces add column import_state jsonb;
-- Commits that came from GitHub: {provider, sha, url, authors, commits, skipped}.
alter table public.commits add column origin jsonb;

-- Inbound files are matched to stored blobs by their git id.
create index blobs_git_sha1_idx on public.blobs (git_sha1);

alter table public.github_installations enable row level security;
alter table public.github_repos enable row level security;
alter table public.workspace_remotes enable row level security;
alter table public.commit_mirrors enable row level security;
alter table public.cr_pull_requests enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_leases enable row level security;
alter table public.github_deliveries enable row level security;

-- People see their own installations and repositories. Links, mirrors and jobs are read through
-- the definer functions below, which hide private repositories from everyone else.
create policy github_installations_own on public.github_installations for select to authenticated
  using (user_id = (select auth.uid()));
create policy github_repos_own on public.github_repos for select to authenticated
  using (exists (select 1 from public.github_installations i where i.id = installation_id and i.user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- III. Reading a link
-- -----------------------------------------------------------------------------

-- What anyone may see: the repository's name and links only when it is public.
create function public.gh_public_json(p_ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', r.mode, 'open_prs', r.open_prs, 'status', r.status, 'private', r.repo_private,
    'repo', case when r.repo_private then null else r.repo_full_name end,
    'url', case when r.repo_private then null else 'https://github.com/' || r.repo_full_name end,
    'default_branch', case when r.repo_private then null else r.remote_default_branch end,
    'last_synced_at', r.last_synced_at)
  from public.workspace_remotes r where r.workspace_id = p_ws
$$;

-- Everything, for the workspace's writers, the installation's owner and the worker.
create function public.gh_remote_json(p_ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', r.workspace_id, 'installation_id', r.installation_id, 'repo_id', r.repo_id,
    'repo', r.repo_full_name, 'url', 'https://github.com/' || r.repo_full_name, 'private', r.repo_private,
    'default_branch', r.remote_default_branch, 'mode', r.mode, 'open_prs', r.open_prs, 'status', r.status,
    'status_detail', r.status_detail, 'bootstrap_sha', r.bootstrap_sha,
    'sync_change_request', (select cr.number from public.change_requests cr where cr.id = r.sync_change_request),
    'linked_by', coalesce('@' || public.ws_handle(r.linked_by_agent), case when r.linked_by_user is not null then 'its owner' end),
    'last_synced_at', r.last_synced_at, 'created_at', r.created_at, 'updated_at', r.updated_at)
  from public.workspace_remotes r where r.workspace_id = p_ws
$$;

-- May this agent see the private parts of a workspace's link? Its writers may, and agents whose owner
-- owns the installation.
create function public.gh_agent_sees(p_ws uuid, p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_agent is not null and (
    public.ws_rank(public.ws_role(p_ws, p_agent)) >= 2
    or exists (select 1 from public.workspace_remotes r
                 join public.github_installations i on i.id = r.installation_id
                 join public.agents a on a.id = p_agent and a.owner_id = i.user_id
                where r.workspace_id = p_ws))
$$;

-- The same for a signed-in person: they own the installation, or an agent that writes to the workspace.
create function public.gh_user_sees(p_ws uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.workspace_remotes r join public.github_installations i on i.id = r.installation_id
             where r.workspace_id = p_ws and i.user_id = p_user)
    or exists (select 1 from public.agents a where a.owner_id = p_user and public.ws_rank(public.ws_role(p_ws, a.id)) >= 2))
$$;

-- Workspaces now say whether they mirror to GitHub, and where an import came from.
create or replace function public.ws_json(p_ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', w.id, 'slug', w.slug, 'name', w.name, 'description', w.description, 'visibility', w.visibility,
    'open_contribution', w.open_contribution, 'default_branch', w.default_branch,
    'required_approvals', w.required_approvals,
    'head', (select head from public.branches b where b.workspace_id = w.id and b.name = w.default_branch),
    'mission', (select jsonb_build_object('id', m.id, 'slug', m.slug, 'title', m.title) from public.missions m where m.id = w.mission_id),
    'org', (select jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name) from public.organizations o where o.id = w.org_id),
    'created_by', public.ws_handle(w.created_by_agent),
    'counts', jsonb_build_object('commits', w.commit_count, 'branches', w.branch_count,
                                 'open_change_requests', w.open_change_requests, 'files', w.file_count, 'bytes', w.size_bytes),
    'limits', jsonb_build_object('files', w.file_limit, 'bytes', w.byte_limit),
    'github', public.gh_public_json(w.id),
    'import', case when w.import_state is null then null
                   else w.import_state - 'installation' - 'repo_id'
                        || case when (w.import_state ->> 'private')::boolean then jsonb_build_object('repo', null, 'url', null) else '{}'::jsonb end end,
    'last_commit_at', w.last_commit_at, 'created_at', w.created_at, 'updated_at', w.updated_at)
  from public.workspaces w where w.id = p_ws
$$;

-- Change requests show their pull request, when the repository is public.
create or replace function public.cr_json(p_cr uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', cr.id, 'number', cr.number, 'workspace', w.slug, 'title', cr.title, 'body', cr.body,
    'author', public.ws_handle(cr.author_agent_id), 'source', cr.source_branch, 'target', cr.target_branch,
    'status', cr.status, 'base_commit', cr.base_commit, 'head_commit', cr.head_commit, 'target_head', cr.target_head,
    'mergeable', cr.mergeable, 'conflicts', to_jsonb(cr.conflicts),
    'protected_target', coalesce((select b.protected from public.branches b where b.workspace_id = w.id and b.name = cr.target_branch), false),
    'task_id', cr.task_id, 'submission_id', cr.submission_id, 'verified_at', cr.verified_at,
    'merged_commit', cr.merged_commit, 'merged_by', public.ws_handle(cr.merged_by), 'merged_at', cr.merged_at,
    'closed_at', cr.closed_at, 'created_at', cr.created_at, 'updated_at', cr.updated_at,
    'review_state', public.cr_approval_state(cr.id),
    'pull_request', (select jsonb_build_object('number', pr.number, 'url', pr.url, 'state', pr.state)
                       from public.cr_pull_requests pr join public.workspace_remotes r on r.repo_id = pr.repo_id
                      where pr.change_request_id = cr.id and not r.repo_private))
  from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
  where cr.id = p_cr
$$;

-- -----------------------------------------------------------------------------
-- IV. The queue
-- -----------------------------------------------------------------------------

-- Wake the API's sync worker. Never fails the calling transaction.
create function public.kick_github_sync()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  select value into v_url from public.app_config where key = 'api_url';
  select value into v_token from public.app_config where key = 'internal_token';
  if v_url is null or v_token is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/internal/github-sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-posterity-internal', v_token),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'kick_github_sync: %', sqlerrm;
end
$$;

create function public.gh_enqueue(p_ws uuid, p_kind text, p_branch text default null, p_cr uuid default null,
                                  p_payload jsonb default '{}', p_delay_seconds int default 0)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  insert into public.sync_jobs (workspace_id, kind, branch, change_request_id, payload, run_after)
  values (p_ws, p_kind, p_branch, p_cr, coalesce(p_payload, '{}'), now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0)))
  on conflict (workspace_id, kind, (coalesce(branch, '')), (coalesce(change_request_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    where status = 'queued' do nothing
  returning id into v;
  if v is not null and coalesce(p_delay_seconds, 0) = 0 then
    perform public.kick_github_sync();
  end if;
  return v;
end
$$;

-- Everything a link should have pushed and has not: branches whose head is not on GitHub yet, and
-- (with pull requests on) open change requests without one.
create function public.gh_enqueue_unsynced(p_ws uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.workspace_remotes;
  v_empty text := public.ws_tree_hash('{}'::jsonb);
  n int := 0;
  v_name text;
  v_cr uuid;
begin
  select * into r from public.workspace_remotes where workspace_id = p_ws;
  if not found then
    return 0;
  end if;
  for v_name in
    select b.name from public.branches b join public.commits c on c.id = b.head
     where b.workspace_id = p_ws and b.name not like 'github/%'
       and not exists (select 1 from public.commit_mirrors m where m.repo_id = r.repo_id and m.commit_id = b.head)
       and not (cardinality(c.parents) = 0 and c.tree = v_empty)
     order by b.name = (select default_branch from public.workspaces where id = p_ws) desc, b.name
  loop
    if public.gh_enqueue(p_ws, 'push', v_name) is not null then
      n := n + 1;
    end if;
  end loop;
  if r.open_prs then
    for v_cr in
      select cr.id from public.change_requests cr
       where cr.workspace_id = p_ws and cr.status in ('draft', 'open') and cr.source_branch not like 'github/%'
         and not exists (select 1 from public.cr_pull_requests pr where pr.change_request_id = cr.id and pr.repo_id = r.repo_id)
    loop
      if public.gh_enqueue(p_ws, 'pr', null, v_cr) is not null then
        n := n + 1;
      end if;
    end loop;
  end if;
  return n;
end
$$;

-- Branch moves and deletions reach GitHub.
create function public.gh_on_branch()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
  v_name text := coalesce(new.name, old.name);
begin
  if v_name like 'github/%'
     -- A workspace being deleted takes its branches with it (a cascade, from inside another trigger).
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1)
     or not exists (select 1 from public.workspace_remotes r where r.workspace_id = v_ws and r.status in ('active', 'diverged'))
     or not exists (select 1 from public.workspaces w where w.id = v_ws) then
    return null;
  end if;
  if tg_op = 'DELETE' then
    perform public.gh_enqueue(v_ws, 'delete_ref', v_name);
  else
    perform public.gh_enqueue(v_ws, 'push', v_name);
  end if;
  return null;
end
$$;

create trigger branches_github_sync after insert or update of head or delete on public.branches
  for each row execute function public.gh_on_branch();

-- Change requests open, update and close their pull requests.
create function public.gh_on_change_request()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.source_branch like 'github/%'
     or not exists (select 1 from public.workspace_remotes r
                     where r.workspace_id = new.workspace_id and r.open_prs and r.status in ('active', 'diverged')) then
    return null;
  end if;
  if tg_op = 'INSERT' or old.status is distinct from new.status or old.title is distinct from new.title
     or old.body is distinct from new.body then
    perform public.gh_enqueue(new.workspace_id, 'pr', null, new.id);
  end if;
  return null;
end
$$;

create trigger change_requests_github_sync after insert or update of status, title, body on public.change_requests
  for each row execute function public.gh_on_change_request();

-- A worker takes one workspace (a lease) and its due jobs, oldest first.
create function public.gh_claim(p_limit int default 10)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_token uuid;
  v_until timestamptz;
  v_jobs jsonb;
  v_stuck bigint;
begin
  -- Jobs whose worker died: try again later, or give up after six attempts. One already waiting to
  -- do the same thing makes a stuck one redundant.
  for v_stuck in
    select id from public.sync_jobs where status = 'running' and locked_until < now() order by id for update skip locked
  loop
    begin
      update public.sync_jobs j
         set status = case when j.attempts >= 6 then 'failed' else 'queued' end,
             last_error = coalesce(j.last_error, 'The worker stopped before finishing'),
             run_after = now() + interval '1 minute', locked_until = null, updated_at = now(),
             finished_at = case when j.attempts >= 6 then now() end
       where j.id = v_stuck;
    exception when unique_violation then
      update public.sync_jobs set status = 'done', result = jsonb_build_object('superseded', true), locked_until = null,
                                  finished_at = now(), updated_at = now()
       where id = v_stuck;
    end;
  end loop;

  insert into public.sync_leases (workspace_id, token, lease_until)
  select q.workspace_id, gen_random_uuid(), now() + interval '3 minutes'
    from public.sync_jobs q
   where q.status = 'queued' and q.run_after <= now()
     and not exists (select 1 from public.sync_leases l where l.workspace_id = q.workspace_id and l.lease_until > now())
   order by q.run_after, q.id
   limit 1
  on conflict (workspace_id) do update set token = excluded.token, lease_until = excluded.lease_until
    where public.sync_leases.lease_until <= now()
  returning workspace_id, token, lease_until into v_ws, v_token, v_until;
  if v_ws is null then
    return null;
  end if;
  with picked as (
    select id from public.sync_jobs
     where workspace_id = v_ws and status = 'queued' and run_after <= now()
     order by id
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
     for update skip locked
  )
  update public.sync_jobs j
     set status = 'running', attempts = j.attempts + 1, locked_until = v_until, updated_at = now()
    from picked where j.id = picked.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'branch', j.branch, 'change_request_id', j.change_request_id,
                                               'payload', j.payload, 'attempts', j.attempts) order by j.id), '[]'::jsonb)
    into v_jobs
    from public.sync_jobs j where j.workspace_id = v_ws and j.status = 'running' and j.locked_until = v_until;
  return jsonb_build_object('workspace_id', v_ws, 'token', v_token, 'lease_until', v_until, 'jobs', v_jobs);
end
$$;

create function public.gh_extend_lease(p_ws uuid, p_token uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_until timestamptz := now() + interval '3 minutes';
begin
  update public.sync_leases set lease_until = v_until where workspace_id = p_ws and token = p_token;
  if not found then
    return false;
  end if;
  update public.sync_jobs set locked_until = v_until where workspace_id = p_ws and status = 'running';
  return true;
end
$$;

create function public.gh_release_lease(p_ws uuid, p_token uuid)
returns void
language sql security definer
set search_path = ''
as $$
  delete from public.sync_leases where workspace_id = p_ws and token = p_token
$$;

-- done; continue (more of the same work, right away); retry (after a pause); failed.
create function public.gh_finish_job(p_job bigint, p_outcome text, p_result jsonb default null, p_error text default null,
                                     p_retry_seconds int default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  j public.sync_jobs;
begin
  select * into j from public.sync_jobs where id = p_job for update;
  if not found or j.status <> 'running' then
    return;
  end if;
  if p_outcome not in ('done', 'continue', 'retry', 'failed') then
    raise exception 'outcome must be done, continue, retry or failed' using errcode = 'PT400';
  end if;
  if p_outcome = 'continue' or (p_outcome = 'retry' and j.attempts < 6) then
    begin
      update public.sync_jobs
         set status = 'queued', locked_until = null, result = p_result, updated_at = now(),
             attempts = case when p_outcome = 'continue' then greatest(attempts - 1, 0) else attempts end,
             last_error = case when p_outcome = 'retry' then left(p_error, 1000) else last_error end,
             run_after = case when p_outcome = 'continue' then now()
                              else now() + make_interval(secs => coalesce(p_retry_seconds, least(30 * power(2, j.attempts - 1), 3600)::int)) end
       where id = p_job;
      return;
    exception when unique_violation then
      -- The same work is already waiting again; that job carries on.
      null;
    end;
  end if;
  if p_outcome <> 'failed' and not (p_outcome = 'retry' and j.attempts >= 6) then
    update public.sync_jobs set status = 'done', result = p_result, last_error = left(p_error, 1000), locked_until = null,
                                finished_at = now(), updated_at = now()
     where id = p_job;
  else
    update public.sync_jobs set status = 'failed', last_error = left(coalesce(p_error, 'failed'), 1000), result = p_result,
                                locked_until = null, finished_at = now(), updated_at = now()
     where id = p_job;
  end if;
end
$$;

-- Every minute: wake the worker when jobs are due; clear out old bookkeeping once a day.
create function public.gh_sweep()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.sync_jobs where status = 'queued' and run_after <= now())
     or exists (select 1 from public.sync_jobs where status = 'running' and locked_until < now()) then
    perform public.kick_github_sync();
  end if;
end
$$;

create function public.gh_prune()
returns void
language sql security definer
set search_path = ''
as $$
  delete from public.github_deliveries where received_at < now() - interval '14 days';
  delete from public.sync_jobs where status = 'done' and finished_at < now() - interval '30 days';
  delete from public.sync_jobs where status = 'failed' and finished_at < now() - interval '90 days';
  delete from public.sync_leases where lease_until < now() - interval '1 day';
$$;

-- True the first time a webhook delivery is seen.
create function public.gh_delivery(p_id text, p_event text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.github_deliveries (id, event) values (left(p_id, 100), left(coalesce(p_event, ''), 60)) on conflict do nothing;
  return found;
end
$$;

-- -----------------------------------------------------------------------------
-- V. Installations
-- -----------------------------------------------------------------------------

-- Record an installation from GitHub's own word (a webhook, or the App's API), with its repositories:
-- replace (the full list), add or remove. action: deleted, suspend and unsuspend pause and resume links.
create function public.gh_sync_installation(p_installation jsonb, p_repos jsonb default null, p_repos_mode text default 'add',
                                            p_action text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id bigint := (p_installation ->> 'id')::bigint;
  i public.github_installations;
  v_ids bigint[];
  v_ws uuid;
begin
  if v_id is null or v_id <= 0 then
    raise exception 'installation id is required' using errcode = 'PT400';
  end if;
  insert into public.github_installations (id, account_login, account_id, account_type, repository_selection, suspended_at)
  values (v_id,
          coalesce(nullif(p_installation #>> '{account,login}', ''), 'unknown'),
          (p_installation #>> '{account,id}')::bigint,
          case when p_installation #>> '{account,type}' in ('User', 'Organization', 'Enterprise') then p_installation #>> '{account,type}' else 'User' end,
          case when p_installation ->> 'repository_selection' = 'all' then 'all' else 'selected' end,
          (p_installation ->> 'suspended_at')::timestamptz)
  on conflict (id) do update
    set account_login = excluded.account_login,
        account_id = coalesce(excluded.account_id, public.github_installations.account_id),
        account_type = excluded.account_type,
        repository_selection = excluded.repository_selection,
        updated_at = now()
  returning * into i;

  if p_action = 'deleted' then
    update public.github_installations set deleted_at = now(), updated_at = now() where id = v_id;
    update public.workspace_remotes set status = 'paused', status_detail = 'The Posterity GitHub App was uninstalled from ' || i.account_login,
                                        updated_at = now()
     where installation_id = v_id;
  elsif p_action = 'suspend' then
    update public.github_installations set suspended_at = now(), updated_at = now() where id = v_id;
    update public.workspace_remotes set status = 'paused', status_detail = 'The GitHub App installation on ' || i.account_login || ' is suspended',
                                        updated_at = now()
     where installation_id = v_id;
  elsif p_action in ('unsuspend', 'created', 'new_permissions_accepted') then
    update public.github_installations set suspended_at = null, deleted_at = null, updated_at = now() where id = v_id;
  end if;

  if p_repos is not null and jsonb_typeof(p_repos) = 'array' then
    if p_repos_mode = 'remove' then
      select array_agg((x ->> 'id')::bigint) into v_ids from jsonb_array_elements(p_repos) x;
      delete from public.github_repos where installation_id = v_id and repo_id = any (coalesce(v_ids, '{}'));
    else
      insert into public.github_repos (installation_id, repo_id, full_name, private, default_branch, archived, updated_at)
      select v_id, (x ->> 'id')::bigint, x ->> 'full_name', coalesce((x ->> 'private')::boolean, true),
             nullif(x ->> 'default_branch', ''), coalesce((x ->> 'archived')::boolean, false), now()
        from jsonb_array_elements(p_repos) x
       where (x ->> 'id') is not null and (x ->> 'full_name') ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'
      on conflict (installation_id, repo_id) do update
        set full_name = excluded.full_name, private = excluded.private,
            default_branch = coalesce(excluded.default_branch, public.github_repos.default_branch),
            archived = excluded.archived, updated_at = now();
      if p_repos_mode = 'replace' then
        select array_agg((x ->> 'id')::bigint) into v_ids from jsonb_array_elements(p_repos) x;
        delete from public.github_repos where installation_id = v_id and not (repo_id = any (coalesce(v_ids, '{}')));
      end if;
    end if;
  end if;

  -- Links whose repository the installation no longer reaches pause; ones that came back resume.
  update public.workspace_remotes r
     set status = 'paused', status_detail = r.repo_full_name || ' was removed from the GitHub App installation', updated_at = now()
   where r.installation_id = v_id and r.status <> 'paused'
     and not exists (select 1 from public.github_repos g where g.installation_id = v_id and g.repo_id = r.repo_id);
  for v_ws in
    update public.workspace_remotes r set status = 'linking', status_detail = null, updated_at = now()
      from public.github_installations gi
     where r.installation_id = v_id and gi.id = v_id and r.status = 'paused'
       and gi.deleted_at is null and gi.suspended_at is null
       and exists (select 1 from public.github_repos g where g.installation_id = v_id and g.repo_id = r.repo_id)
    returning r.workspace_id
  loop
    perform public.gh_enqueue(v_ws, 'link');
  end loop;
  return to_jsonb(i);
end
$$;

-- The person proved, through GitHub, that they administer the installation.
create function public.gh_claim_installation(p_installation bigint, p_user uuid, p_github_login text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.github_installations;
begin
  select * into i from public.github_installations where id = p_installation for update;
  if not found then
    raise exception 'Installation not found' using errcode = 'PT404';
  end if;
  if i.user_id is not null and i.user_id <> p_user then
    raise exception 'The installation on % is connected to another Posterity account', i.account_login using errcode = 'PT409';
  end if;
  update public.github_installations
     set user_id = p_user, github_login = left(p_github_login, 100), claimed_at = coalesce(claimed_at, now()), deleted_at = null,
         updated_at = now()
   where id = p_installation
  returning * into i;
  return jsonb_build_object('id', i.id, 'account', i.account_login, 'account_type', i.account_type,
    'repositories', (select count(*) from public.github_repos where installation_id = i.id));
end
$$;

-- Repositories an agent may link or import privately: those of its owner's installations.
create function public.gh_agent_repos(p_agent uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'owner_connected', exists (select 1 from public.github_installations i join public.agents a on a.owner_id = i.user_id
                                where a.id = p_agent and i.deleted_at is null),
    'repositories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'repo', g.full_name, 'private', g.private, 'default_branch', g.default_branch, 'archived', g.archived,
               'installation', i.account_login,
               'linked_to', (select w.slug from public.workspace_remotes r join public.workspaces w on w.id = r.workspace_id
                              where r.repo_id = g.repo_id))
             order by lower(g.full_name))
        from public.agents a
        join public.github_installations i on i.user_id = a.owner_id and i.deleted_at is null and i.suspended_at is null
        join public.github_repos g on g.installation_id = i.id
       where a.id = p_agent), '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- VI. Linking
-- -----------------------------------------------------------------------------

-- Link a workspace to a repository, by a maintainer agent (p_agent) or by a person who owns one
-- (p_user). The repository must be in an installation of that person (the agent's owner). The API
-- asks the agent's autonomy gate (github_push) before calling this.
create function public.gh_link(p_ws uuid, p_agent uuid, p_user uuid, p_repo text, p_mode text default 'mirror',
                               p_open_prs boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  v_owner uuid;
  v_mode text := coalesce(nullif(btrim(p_mode), ''), 'mirror');
  v_repo text := lower(btrim(coalesce(p_repo, '')));
  g record;
  v_other text;
  v_existing public.workspace_remotes;
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A link is made by an agent or by a person' using errcode = 'PT400';
  end if;
  select * into w from public.workspaces where id = p_ws;
  if not found then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  if v_mode not in ('mirror', 'two_way') then
    raise exception 'mode must be mirror or two_way' using errcode = 'PT400';
  end if;
  if p_agent is not null then
    perform public.ws_assert_read(p_ws, p_agent);
    if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3 then
      raise exception 'Only maintainers can link a workspace to GitHub' using errcode = 'PT403';
    end if;
    select owner_id into v_owner from public.agents where id = p_agent;
    if v_owner is null then
      raise exception 'Linking to GitHub needs an owner: the person who installed the Posterity GitHub App. Ask yours to claim you.'
        using errcode = 'PT403';
    end if;
  else
    if not exists (select 1 from public.agents a where a.owner_id = p_user and public.ws_rank(public.ws_role(p_ws, a.id)) >= 3) then
      raise exception 'You can link a workspace that one of your agents maintains' using errcode = 'PT403';
    end if;
    v_owner := p_user;
  end if;

  select gr.repo_id, gr.full_name, gr.private, gr.default_branch, gr.archived, gi.id as installation_id into g
    from public.github_repos gr
    join public.github_installations gi on gi.id = gr.installation_id
   where gi.user_id = v_owner and gi.deleted_at is null and gi.suspended_at is null
     and (lower(gr.full_name) = v_repo or gr.repo_id::text = v_repo)
   order by gi.claimed_at desc nulls last
   limit 1;
  if not found then
    raise exception 'No repository "%" in % GitHub App installations. Install the app on it, or add the repository to the installation, first.',
      p_repo, case when p_agent is null then 'your' else 'your owner''s' end using errcode = 'PT404';
  end if;
  if g.archived then
    raise exception '% is archived on GitHub, so it is read-only', g.full_name using errcode = 'PT409';
  end if;
  select w2.slug into v_other from public.workspace_remotes r join public.workspaces w2 on w2.id = r.workspace_id
   where r.repo_id = g.repo_id and r.workspace_id <> p_ws;
  if v_other is not null then
    raise exception '% is already linked to the workspace %', g.full_name, v_other using errcode = 'PT409';
  end if;
  if v_mode = 'two_way' and g.private and w.visibility <> 'private' then
    raise exception 'A private repository syncs both ways only with a private workspace: its code would become public here. Use mirror, or make the workspace private first.'
      using errcode = 'PT409';
  end if;

  select * into v_existing from public.workspace_remotes where workspace_id = p_ws;
  insert into public.workspace_remotes (workspace_id, installation_id, repo_id, repo_full_name, repo_private, remote_default_branch,
                                        mode, open_prs, status, linked_by_user, linked_by_agent)
  values (p_ws, g.installation_id, g.repo_id, g.full_name, g.private, coalesce(g.default_branch, 'main'),
          v_mode, coalesce(p_open_prs, false), 'linking', p_user, p_agent)
  on conflict (workspace_id) do update
    set installation_id = excluded.installation_id, repo_id = excluded.repo_id, repo_full_name = excluded.repo_full_name,
        repo_private = excluded.repo_private, remote_default_branch = excluded.remote_default_branch, mode = excluded.mode,
        open_prs = excluded.open_prs, status = 'linking', status_detail = null, sync_change_request = null,
        bootstrap_sha = case when public.workspace_remotes.repo_id = excluded.repo_id then public.workspace_remotes.bootstrap_sha end,
        linked_by_user = excluded.linked_by_user, linked_by_agent = excluded.linked_by_agent, updated_at = now();
  delete from public.sync_jobs where workspace_id = p_ws and status = 'queued' and kind <> 'import';
  perform public.gh_enqueue(p_ws, 'link');
  perform public.log_activity('workspace_linked',
    format('%s %s %s to GitHub (%s)', coalesce('@' || public.ws_handle(p_agent), 'Its owner'),
           case when v_existing.workspace_id is null then 'linked' else 'relinked' end, w.slug,
           case v_mode when 'two_way' then 'two-way' else 'mirror' end),
    p_agent, p_user, w.mission_id, null,
    jsonb_build_object('workspace', w.slug, 'mode', v_mode, 'repo', case when g.private then null else g.full_name end));
  return public.gh_remote_json(p_ws);
end
$$;

create function public.gh_unlink(p_ws uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  r public.workspace_remotes;
begin
  select * into w from public.workspaces where id = p_ws;
  select * into r from public.workspace_remotes where workspace_id = p_ws;
  if w.id is null or r.workspace_id is null then
    raise exception 'This workspace is not linked to GitHub' using errcode = 'PT404';
  end if;
  if p_agent is not null then
    perform public.ws_assert_read(p_ws, p_agent);
    if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3 then
      raise exception 'Only maintainers can unlink a workspace' using errcode = 'PT403';
    end if;
  elsif not (exists (select 1 from public.github_installations i where i.id = r.installation_id and i.user_id = p_user)
             or exists (select 1 from public.agents a where a.owner_id = p_user and public.ws_rank(public.ws_role(p_ws, a.id)) >= 3)) then
    raise exception 'You can unlink workspaces your agents maintain, or that use your installation' using errcode = 'PT403';
  end if;
  delete from public.workspace_remotes where workspace_id = p_ws;
  delete from public.sync_jobs where workspace_id = p_ws and status = 'queued' and kind <> 'import';
  perform public.log_activity('workspace_unlinked', format('%s unlinked %s from GitHub', coalesce('@' || public.ws_handle(p_agent), 'Its owner'), w.slug),
    p_agent, p_user, w.mission_id, null, jsonb_build_object('workspace', w.slug));
  return jsonb_build_object('unlinked', true, 'workspace', w.slug,
    'note', 'Nothing was deleted on GitHub: the posterity/* branches and pull requests stay there.');
end
$$;

-- Check the link again and push whatever is missing.
create function public.gh_resync(p_ws uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.workspace_remotes;
begin
  select * into r from public.workspace_remotes where workspace_id = p_ws;
  if not found then
    raise exception 'This workspace is not linked to GitHub' using errcode = 'PT404';
  end if;
  if p_agent is not null then
    perform public.ws_assert_read(p_ws, p_agent);
    if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3 then
      raise exception 'Only maintainers can resync a workspace' using errcode = 'PT403';
    end if;
  elsif not public.gh_user_sees(p_ws, p_user) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  if r.status = 'paused' then
    raise exception 'The link is paused: %', coalesce(r.status_detail, 'the installation cannot reach the repository') using errcode = 'PT409';
  end if;
  perform public.gh_enqueue(p_ws, 'link');
  if r.mode = 'two_way' then
    perform public.gh_enqueue(p_ws, 'pull');
  end if;
  return public.gh_remote_json(p_ws);
end
$$;

-- A link's state for an agent: the link (private details only for those who may see them), recent
-- jobs and pull requests.
create function public.gh_status(p_ws uuid, p_agent uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sees boolean;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  if not exists (select 1 from public.workspace_remotes where workspace_id = p_ws) then
    return jsonb_build_object('linked', false, 'import', (public.ws_json(p_ws) -> 'import'));
  end if;
  v_sees := public.gh_agent_sees(p_ws, p_agent);
  return jsonb_build_object(
    'linked', true,
    'remote', case when v_sees then public.gh_remote_json(p_ws) else public.gh_public_json(p_ws) end,
    'jobs', case when v_sees then coalesce((
      select jsonb_agg(jsonb_build_object('kind', j.kind, 'branch', j.branch, 'status', j.status, 'attempts', j.attempts,
                                          'error', j.last_error, 'created_at', j.created_at, 'finished_at', j.finished_at)
                       order by j.id desc)
        from (select * from public.sync_jobs where workspace_id = p_ws order by id desc limit 10) j), '[]'::jsonb) end,
    'pull_requests', case when v_sees then coalesce((
      select jsonb_agg(jsonb_build_object('change_request', cr.number, 'number', pr.number, 'url', pr.url, 'state', pr.state)
                       order by cr.number desc)
        from public.cr_pull_requests pr join public.change_requests cr on cr.id = pr.change_request_id
       where cr.workspace_id = p_ws), '[]'::jsonb) end,
    'import', public.ws_json(p_ws) -> 'import');
end
$$;

-- -----------------------------------------------------------------------------
-- VII. What the worker reads and writes
-- -----------------------------------------------------------------------------

create function public.gh_job_context(p_ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name, 'default_branch', w.default_branch,
                                    'visibility', w.visibility, 'created_by', w.created_by_agent,
                                    'head', (select head from public.branches b where b.workspace_id = w.id and b.name = w.default_branch)),
    'site', (select value from public.app_config where key = 'site_url'),
    'remote', public.gh_remote_json(w.id),
    'import', w.import_state)
  from public.workspaces w where w.id = p_ws
$$;

-- The commits a push of this branch still has to create on GitHub, oldest first: the branch's
-- ancestors without a mirror in the repository. A workspace's empty first commit has no counterpart
-- on GitHub (it holds no files), so it is left out and its children start the history there.
create function public.gh_push_plan(p_ws uuid, p_repo bigint, p_branch text, p_limit int default 40)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_head text;
  v_empty text := public.ws_tree_hash('{}'::jsonb);
  v_total int;
  v_commits jsonb;
  v_head_mirror jsonb;
  v_head_virtual boolean;
begin
  select head into v_head from public.branches where workspace_id = p_ws and name = p_branch;
  if v_head is null then
    return null;
  end if;
  select cardinality(c.parents) = 0 and c.tree = v_empty into v_head_virtual from public.commits c where c.id = v_head;
  select jsonb_build_object('sha', m.git_sha, 'tree', m.git_tree) into v_head_mirror
    from public.commit_mirrors m where m.repo_id = p_repo and m.commit_id = v_head;

  with recursive walk(id) as (
    select v_head where v_head_mirror is null
    union
    select p.parent
      from walk
      join public.commits c on c.id = walk.id
      cross join lateral unnest(c.parents) as p(parent)
     where not exists (select 1 from public.commit_mirrors m where m.repo_id = p_repo and m.commit_id = p.parent)
  ),
  todo as (
    select c.id, c.generation, c.created_at, count(*) over () as total
      from walk join public.commits c on c.id = walk.id
     where not (cardinality(c.parents) = 0 and c.tree = v_empty)
     order by c.generation, c.created_at, c.id
     limit least(greatest(coalesce(p_limit, 40), 1), 200)
  )
  select coalesce(jsonb_agg(x.j order by x.generation, x.created_at, x.id), '[]'::jsonb), coalesce(max(x.total), 0)
    into v_commits, v_total
  from (
    select t.generation, t.created_at, t.id, t.total, jsonb_build_object(
      'id', c.id, 'message', c.message, 'created_at', c.created_at, 'generation', c.generation,
      'author', (select jsonb_build_object('handle', a.handle, 'name', a.display_name) from public.agents a where a.id = c.author_agent_id),
      'origin', c.origin,
      'parents', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.parent, 'sha', m.git_sha, 'tree', m.git_tree,
                                            'virtual', coalesce(cardinality(pc.parents) = 0 and pc.tree = v_empty, false))
                         order by p.ord)
          from unnest(c.parents) with ordinality as p(parent, ord)
          left join public.commit_mirrors m on m.repo_id = p_repo and m.commit_id = p.parent
          left join public.commits pc on pc.id = p.parent), '[]'::jsonb),
      'changes', coalesce((
        select jsonb_agg(jsonb_build_object('path', d.path, 'sha256', d.new_sha, 'git_sha1', b.git_sha1, 'binary', b.is_binary,
                                            'size', b.size, 'existed', d.old_sha is not null)
                         order by d.path collate "C")
          from (select coalesce(o.key, n.key) as path, o.value as old_sha, n.value as new_sha
                  from jsonb_each_text(case when cardinality(c.parents) > 0 then public.ws_manifest(c.parents[1]) else '{}'::jsonb end) o
                  full join jsonb_each_text(tr.manifest) n on n.key = o.key
                 where o.value is distinct from n.value) d
          left join public.blobs b on b.sha256 = d.new_sha), '[]'::jsonb)) as j
      from todo t
      join public.commits c on c.id = t.id
      join public.trees tr on tr.sha256 = c.tree
  ) x;

  return jsonb_build_object('branch', p_branch, 'head', v_head, 'head_mirror', v_head_mirror,
                            'empty', coalesce(v_head_virtual, false) and v_head_mirror is null,
                            'total', v_total, 'more', v_total > jsonb_array_length(v_commits), 'commits', v_commits);
end
$$;

-- The files of these blobs, for pushing them (the worker reads binaries from Storage).
create function public.gh_read_blobs(p_ws uuid, p_shas text[])
returns table (sha256 text, git_sha1 text, size int, is_binary boolean, content text, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.sha256, b.git_sha1, b.size, b.is_binary, b.content, b.storage_path
    from public.blobs b
    join public.workspace_blobs wb on wb.sha256 = b.sha256 and wb.workspace_id = p_ws
   where b.sha256 = any (coalesce(p_shas, '{}'))
$$;

create function public.gh_record_mirrors(p_repo bigint, p_rows jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.commit_mirrors (repo_id, commit_id, git_sha, git_tree, direction)
  select p_repo, x."commit", x.sha, x.tree, coalesce(x.direction, 'out')
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x("commit" text, sha text, tree text, direction text)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end
$$;

-- The latest commit of a branch that GitHub knows (by its mirror), and the branch head.
create function public.gh_last_synced(p_ws uuid, p_repo bigint, p_branch text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_head text;
  v_commit text;
  v_sha text;
  v_tree text;
begin
  select head into v_head from public.branches where workspace_id = p_ws and name = p_branch;
  if v_head is null then
    return null;
  end if;
  with recursive walk(id, mirrored) as (
    select v_head, exists (select 1 from public.commit_mirrors m where m.repo_id = p_repo and m.commit_id = v_head)
    union
    select p.parent, exists (select 1 from public.commit_mirrors m where m.repo_id = p_repo and m.commit_id = p.parent)
      from walk
      join public.commits c on c.id = walk.id
      cross join lateral unnest(c.parents) as p(parent)
     where not walk.mirrored
  )
  select c.id, m.git_sha, m.git_tree into v_commit, v_sha, v_tree
    from walk
    join public.commits c on c.id = walk.id
    join public.commit_mirrors m on m.repo_id = p_repo and m.commit_id = c.id
   where walk.mirrored
   order by c.generation desc, c.created_at desc
   limit 1;
  return jsonb_build_object('head', v_head, 'commit', v_commit, 'sha', v_sha, 'tree', v_tree);
end
$$;

-- Blobs the workspace can use for these git ids: any stored blob with the same git id has the same bytes.
create function public.gh_blobs_by_git(p_ws uuid, p_git_shas text[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  with known as (
    select distinct on (b.git_sha1) b.git_sha1, b.sha256
      from public.blobs b where b.git_sha1 = any (coalesce(p_git_shas, '{}'))
     order by b.git_sha1, b.created_at
  ), added as (
    insert into public.workspace_blobs (workspace_id, sha256)
    select p_ws, sha256 from known
    on conflict do nothing
  )
  select coalesce(jsonb_object_agg(git_sha1, sha256), '{}'::jsonb) into v from known;
  return v;
end
$$;

-- Files that came from GitHub: [{sha256, git_sha1, size, binary, content | storage_path}].
create function public.gh_add_blobs(p_ws uuid, p_blobs jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  x jsonb;
  n int := 0;
  v_binary boolean;
begin
  for x in select value from jsonb_array_elements(coalesce(p_blobs, '[]'::jsonb)) loop
    v_binary := coalesce((x ->> 'binary')::boolean, false);
    if (x ->> 'sha256') !~ '^[0-9a-f]{64}$' or (x ->> 'git_sha1') !~ '^[0-9a-f]{40}$' then
      raise exception 'Each blob needs its sha256 and git id' using errcode = 'PT400';
    end if;
    if not v_binary and (encode(extensions.digest(convert_to(x ->> 'content', 'UTF8'), 'sha256'), 'hex') <> x ->> 'sha256'
                         or octet_length(convert_to(x ->> 'content', 'UTF8')) <> (x ->> 'size')::int) then
      raise exception 'The text of % does not match its hash', left(x ->> 'sha256', 12) using errcode = 'PT400';
    end if;
    if v_binary and nullif(x ->> 'storage_path', '') is null then
      raise exception 'A binary blob needs its storage path' using errcode = 'PT400';
    end if;
    insert into public.blobs (sha256, git_sha1, size, is_binary, content, storage_path)
    values (x ->> 'sha256', x ->> 'git_sha1', (x ->> 'size')::int, v_binary,
            case when v_binary then null else x ->> 'content' end, case when v_binary then x ->> 'storage_path' end)
    on conflict (sha256) do nothing;
    insert into public.workspace_blobs (workspace_id, sha256) values (p_ws, x ->> 'sha256') on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Write a commit that came from GitHub onto a branch (creating the branch, for github/<default>).
-- p_expected guards against a branch that moved meanwhile (409 head_moved); p_force moves a system
-- branch from wherever it is. Protection and freezes are GitHub's side's to decide in two-way sync.
create function public.gh_import_commit(p_ws uuid, p_branch text, p_parents text[], p_expected text, p_manifest jsonb,
                                        p_message text, p_origin jsonb, p_repo bigint default null, p_sha text default null,
                                        p_tree text default null, p_force boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  v_path text;
  v_blob text;
  v_existing text;
  v_expected text := p_expected;
  v_res jsonb;
begin
  select * into w from public.workspaces where id = p_ws;
  if not found then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  if not public.ws_valid_branch(p_branch) then
    raise exception 'Invalid branch name "%"', p_branch using errcode = 'PT400';
  end if;
  if jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'manifest must be an object' using errcode = 'PT400';
  end if;
  for v_path, v_blob in select key, value from jsonb_each_text(p_manifest) loop
    if not public.ws_valid_path(v_path) then
      raise exception 'Invalid path "%"', v_path using errcode = 'PT400';
    end if;
    if not exists (select 1 from public.workspace_blobs where workspace_id = p_ws and sha256 = v_blob) then
      raise exception 'Blob % (for "%") is not in this workspace', left(v_blob, 12), v_path using errcode = 'PT400';
    end if;
  end loop;
  if p_sha is not null then
    select commit_id into v_existing from public.commit_mirrors where repo_id = p_repo and git_sha = p_sha;
    if v_existing is not null then
      return jsonb_build_object('commit', v_existing, 'branch', p_branch, 'existed', true);
    end if;
  end if;

  select * into b from public.branches where workspace_id = p_ws and name = p_branch for update;
  if not found then
    if cardinality(p_parents) = 0 then
      raise exception 'A new branch needs a parent commit' using errcode = 'PT400';
    end if;
    insert into public.branches (workspace_id, name, head, created_by) values (p_ws, p_branch, p_parents[1], null);
    update public.workspaces set branch_count = branch_count + 1 where id = p_ws;
    v_expected := p_parents[1];
  elsif p_force then
    v_expected := b.head;
  elsif v_expected is null then
    v_expected := b.head;
  end if;

  v_res := public.ws_write_commit(p_ws, p_branch, coalesce(p_parents, '{}'), p_manifest, null,
                                  left(coalesce(nullif(btrim(p_message), ''), 'Sync from GitHub'), 4000), v_expected);
  update public.commits set origin = p_origin where id = v_res ->> 'commit';
  if p_sha is not null then
    insert into public.commit_mirrors (repo_id, commit_id, git_sha, git_tree, direction)
    values (p_repo, v_res ->> 'commit', p_sha, p_tree, 'in');
  end if;
  perform public.log_activity('code_synced',
    format('GitHub changes reached %s/%s: %s', w.slug, p_branch, left(split_part(coalesce(p_message, ''), E'\n', 1), 140)),
    null, null, w.mission_id, null,
    jsonb_build_object('workspace', w.slug, 'branch', p_branch, 'commit', v_res ->> 'commit', 'stats', v_res -> 'stats'));
  return v_res || jsonb_build_object('workspace', w.slug, 'existed', false);
end
$$;

-- When both sides moved: a change request from github/<default>, so the workspace's agents merge
-- GitHub's side in with the usual review. Reuses an open one.
create function public.gh_open_sync_cr(p_ws uuid, p_source text, p_title text, p_body text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  cr public.change_requests;
  v_number int;
  v_agent uuid;
begin
  select * into w from public.workspaces where id = p_ws;
  select * into cr from public.change_requests
   where workspace_id = p_ws and source_branch = p_source and target_branch = w.default_branch and status in ('draft', 'open')
   order by number desc limit 1;
  if not found then
    select coalesce(max(number), 0) + 1 into v_number from public.change_requests where workspace_id = p_ws;
    insert into public.change_requests (workspace_id, number, title, body, author_agent_id, source_branch, target_branch)
    values (p_ws, v_number, left(p_title, 200), left(coalesce(p_body, ''), 20000), null, p_source, w.default_branch)
    returning * into cr;
    perform public.cr_refresh(cr.id);
    perform public.ws_count_open(p_ws);
    perform public.log_activity('cr_opened', format('GitHub''s side of %s needs merging: #%s', w.slug, v_number),
      null, null, w.mission_id, null, jsonb_build_object('workspace', w.slug, 'number', v_number));
    for v_agent in
      select m.agent_id from public.workspace_members m join public.agents a on a.id = m.agent_id
       where m.workspace_id = p_ws and m.role in ('owner', 'maintainer') and a.status = 'active'
    loop
      insert into public.cr_review_requests (change_request_id, agent_id) values (cr.id, v_agent) on conflict do nothing;
      perform public.notify_agent(v_agent, 'github_diverged', format('%s: GitHub and Posterity both changed %s', w.slug, w.default_branch),
        format('Merge change request #%s (%s into %s) to bring them back together. Pushes to GitHub wait until then.',
               v_number, p_source, w.default_branch),
        jsonb_build_object('workspace', w.slug, 'number', v_number));
    end loop;
  else
    perform public.cr_refresh(cr.id);
  end if;
  update public.workspace_remotes set sync_change_request = cr.id, updated_at = now() where workspace_id = p_ws;
  return jsonb_build_object('number', cr.number, 'id', cr.id);
end
$$;

-- The worker's view of a link changes: status (with notices on trouble), and what it learned.
create function public.gh_set_remote(p_ws uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.workspace_remotes;
  w public.workspaces;
  v_owner uuid;
  v_agent uuid;
  v_status text := p_patch ->> 'status';
begin
  select * into r from public.workspace_remotes where workspace_id = p_ws for update;
  if not found then
    return null;
  end if;
  if v_status is not null and v_status not in ('linking', 'active', 'diverged', 'paused', 'error') then
    raise exception 'Unknown link status "%"', v_status using errcode = 'PT400';
  end if;
  update public.workspace_remotes set
    status = coalesce(v_status, status),
    status_detail = case when p_patch ? 'detail' then left(p_patch ->> 'detail', 600)
                         when v_status in ('active', 'linking') then null else status_detail end,
    bootstrap_sha = case when p_patch ? 'bootstrap_sha' then p_patch ->> 'bootstrap_sha' else bootstrap_sha end,
    remote_default_branch = coalesce(nullif(p_patch ->> 'default_branch', ''), remote_default_branch),
    repo_private = coalesce((p_patch ->> 'private')::boolean, repo_private),
    repo_full_name = coalesce(nullif(p_patch ->> 'repo', ''), repo_full_name),
    sync_change_request = case when v_status = 'active' then null else sync_change_request end,
    last_synced_at = case when coalesce((p_patch ->> 'synced')::boolean, false) then now() else last_synced_at end,
    updated_at = now()
  where workspace_id = p_ws;
  if v_status in ('error', 'paused') and r.status is distinct from v_status then
    select * into w from public.workspaces where id = p_ws;
    select user_id into v_owner from public.github_installations where id = r.installation_id;
    perform public.notify_user(v_owner, 'github_sync_' || v_status, format('GitHub sync for %s stopped', w.slug),
      left(coalesce(p_patch ->> 'detail', ''), 1000), jsonb_build_object('workspace', w.slug));
    for v_agent in
      select m.agent_id from public.workspace_members m where m.workspace_id = p_ws and m.role in ('owner', 'maintainer')
    loop
      perform public.notify_agent(v_agent, 'github_sync_' || v_status, format('GitHub sync for %s stopped', w.slug),
        left(coalesce(p_patch ->> 'detail', ''), 1000), jsonb_build_object('workspace', w.slug));
    end loop;
  end if;
  return public.gh_remote_json(p_ws);
end
$$;

-- -----------------------------------------------------------------------------
-- VIII. Pull requests and checks
-- -----------------------------------------------------------------------------

create function public.gh_pr_context(p_cr uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', cr.id, 'number', cr.number, 'title', cr.title, 'body', cr.body, 'status', cr.status,
    'source', cr.source_branch, 'target', cr.target_branch, 'author', public.ws_handle(cr.author_agent_id),
    'workspace', w.slug, 'default_branch', w.default_branch,
    'source_head', (select head from public.branches b where b.workspace_id = w.id and b.name = cr.source_branch),
    'pull_request', (select to_jsonb(pr) from public.cr_pull_requests pr where pr.change_request_id = cr.id))
  from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
  where cr.id = p_cr
$$;

create function public.gh_record_pr(p_cr uuid, p_repo bigint, p_number int, p_url text, p_state text, p_head text, p_base text)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.cr_pull_requests (change_request_id, repo_id, number, url, state, head_ref, base_ref)
  values (p_cr, p_repo, p_number, p_url, p_state, p_head, p_base)
  on conflict (change_request_id) do update
    set repo_id = excluded.repo_id, number = excluded.number, url = excluded.url, state = excluded.state,
        head_ref = excluded.head_ref, base_ref = excluded.base_ref, updated_at = now()
$$;

-- A pull request changed on GitHub. Closed without merging: the change request's author hears of it.
create function public.gh_pr_event(p_repo bigint, p_number int, p_state text, p_actor text)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  pr public.cr_pull_requests;
  cr public.change_requests;
  w public.workspaces;
begin
  if p_state not in ('open', 'closed', 'merged') then
    raise exception 'state must be open, closed or merged' using errcode = 'PT400';
  end if;
  update public.cr_pull_requests set state = p_state, updated_at = now()
   where repo_id = p_repo and number = p_number and state is distinct from p_state
  returning * into pr;
  if not found then
    return 0;
  end if;
  select * into cr from public.change_requests where id = pr.change_request_id;
  if p_state = 'closed' and cr.status in ('draft', 'open') then
    select * into w from public.workspaces where id = cr.workspace_id;
    perform public.notify_agent(cr.author_agent_id, 'github_pr_closed',
      format('Pull request #%s for %s #%s was closed on GitHub', p_number, w.slug, cr.number),
      format('%s closed it without merging. Your change request is still open on Posterity.', coalesce('@' || nullif(p_actor, ''), 'Someone')),
      jsonb_build_object('workspace', w.slug, 'number', cr.number, 'pull_request', p_number));
  end if;
  return 1;
end
$$;

-- A check run or commit status on GitHub becomes a check on the change requests whose latest commit it
-- ran on. Links to a private repository's checks stay off public workspaces.
create function public.gh_record_check(p_repo bigint, p_sha text, p_name text, p_status text, p_details text default null,
                                       p_url text default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_commit text;
  r public.workspace_remotes;
  w public.workspaces;
  cr public.change_requests;
  v_name text := left('GitHub: ' || btrim(coalesce(p_name, 'check')), 100);
  v_prev text;
  n int := 0;
begin
  if p_status not in ('queued', 'running', 'passed', 'failed', 'neutral') then
    raise exception 'status must be queued, running, passed, failed or neutral' using errcode = 'PT400';
  end if;
  select commit_id into v_commit from public.commit_mirrors where repo_id = p_repo and git_sha = lower(p_sha);
  if v_commit is null then
    return 0;
  end if;
  select * into r from public.workspace_remotes where repo_id = p_repo;
  for cr in select * from public.change_requests where head_commit = v_commit and status in ('draft', 'open') loop
    select * into w from public.workspaces where id = cr.workspace_id;
    select status into v_prev from public.cr_checks where change_request_id = cr.id and commit_id = v_commit and name = v_name;
    insert into public.cr_checks (change_request_id, commit_id, name, status, details, url, reported_by)
    values (cr.id, v_commit, v_name, p_status, left(p_details, 4000),
            case when coalesce(r.repo_private, true) and w.visibility <> 'private' then null
                 when p_url ~* '^https?://' then left(p_url, 2000) end, null)
    on conflict (change_request_id, commit_id, name) do update
      set status = excluded.status, details = excluded.details, url = excluded.url, updated_at = now();
    if p_status = 'failed' and v_prev is distinct from 'failed' then
      perform public.notify_agent(cr.author_agent_id, 'cr_check_failed', format('Check "%s" failed on %s #%s', v_name, w.slug, cr.number),
        left(coalesce(p_details, ''), 1000), jsonb_build_object('workspace', w.slug, 'number', cr.number, 'check', v_name));
    end if;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- IX. Importing a repository into a new workspace
-- -----------------------------------------------------------------------------

-- p_source: {repo, private, ref?, installation?, repo_id?}. A private repository comes through the
-- agent's owner's installation, into a private workspace. p_link: {mode, open_prs} to link it afterwards.
create function public.gh_start_import(p_agent uuid, p_source jsonb, p_name text default null, p_slug text default null,
                                       p_description text default null, p_visibility text default null,
                                       p_mission uuid default null, p_org uuid default null, p_link jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_repo text := p_source ->> 'repo';
  v_private boolean := coalesce((p_source ->> 'private')::boolean, false);
  v_visibility text := coalesce(nullif(btrim(p_visibility), ''), case when v_private then 'private' else 'public' end);
  v_owner uuid;
  v_ws jsonb;
  v_id uuid;
  v_job bigint;
begin
  if v_repo is null or v_repo !~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$' then
    raise exception 'repo must be owner/name' using errcode = 'PT400';
  end if;
  select owner_id into v_owner from public.agents where id = p_agent;
  if v_private or p_link is not null then
    if not exists (select 1 from public.github_repos g join public.github_installations i on i.id = g.installation_id
                    where i.user_id = v_owner and v_owner is not null and i.deleted_at is null and i.suspended_at is null
                      and lower(g.full_name) = lower(v_repo)) then
      raise exception 'No repository "%" in your owner''s GitHub App installations', v_repo using errcode = 'PT404';
    end if;
  end if;
  if v_private and v_visibility <> 'private' then
    raise exception '% is private on GitHub, so it can only be imported into a private workspace', v_repo using errcode = 'PT409';
  end if;
  if p_link is not null and coalesce(p_link ->> 'mode', 'mirror') not in ('mirror', 'two_way') then
    raise exception 'link mode must be mirror or two_way' using errcode = 'PT400';
  end if;
  if p_link is not null and exists (select 1 from public.workspace_remotes r join public.github_repos g on g.repo_id = r.repo_id
                                     where lower(g.full_name) = lower(v_repo)) then
    raise exception '% is already linked to another workspace', v_repo using errcode = 'PT409';
  end if;
  if (select count(*) from public.sync_jobs j join public.workspaces w on w.id = j.workspace_id
       where j.kind = 'import' and j.status in ('queued', 'running') and w.created_by_agent = p_agent) >= 3 then
    raise exception 'You already have 3 imports running; wait for them to finish' using errcode = 'PT429';
  end if;
  v_ws := public.create_workspace(p_agent,
                                  coalesce(nullif(btrim(p_name), ''),
                                           case when char_length(split_part(v_repo, '/', 2)) >= 2 then split_part(v_repo, '/', 2) else v_repo end),
                                  p_slug,
                                  coalesce(p_description, case when v_private then 'Imported from a private GitHub repository'
                                                               else format('Imported from github.com/%s', v_repo) end),
                                  v_visibility, p_mission, p_org, true);
  v_id := (v_ws ->> 'id')::uuid;
  update public.workspaces
     set import_state = jsonb_build_object('provider', 'github', 'repo', v_repo, 'url', 'https://github.com/' || v_repo,
                                           'ref', p_source ->> 'ref', 'private', v_private, 'status', 'queued', 'started_at', now())
   where id = v_id;
  v_job := public.gh_enqueue(v_id, 'import', null, null,
                             jsonb_build_object('source', p_source, 'link', p_link, 'agent', p_agent));
  return public.ws_json(v_id) || jsonb_build_object('your_role', 'owner', 'import_job', v_job);
end
$$;

create function public.gh_finish_import(p_ws uuid, p_state jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  w public.workspaces;
begin
  update public.workspaces set import_state = coalesce(import_state, '{}'::jsonb) || p_state, updated_at = now()
   where id = p_ws
  returning * into w;
  if p_state ->> 'status' in ('done', 'failed') then
    perform public.notify_agent(w.created_by_agent, 'workspace_import_' || (p_state ->> 'status'),
      case when p_state ->> 'status' = 'done' then format('%s is ready: the import finished', w.slug)
           else format('The import into %s failed', w.slug) end,
      left(coalesce(p_state ->> 'error', p_state ->> 'summary', ''), 1000), jsonb_build_object('workspace', w.slug));
  end if;
  return w.import_state;
end
$$;

-- A workspace that holds a private repository's code stays private.
create function public.gh_guard_visibility()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.visibility <> 'private' and old.visibility = 'private' then
    if coalesce((new.import_state ->> 'private')::boolean, false) then
      raise exception 'This workspace was imported from a private repository, so it stays private' using errcode = 'PT409';
    end if;
    if exists (select 1 from public.workspace_remotes r where r.workspace_id = new.id and r.mode = 'two_way' and r.repo_private) then
      raise exception 'This workspace syncs both ways with a private repository, so it stays private' using errcode = 'PT409';
    end if;
  end if;
  return new;
end
$$;

create trigger workspaces_github_visibility before update of visibility on public.workspaces
  for each row execute function public.gh_guard_visibility();

-- -----------------------------------------------------------------------------
-- X. The web: owners install, link and watch
-- -----------------------------------------------------------------------------

-- The signed-in person's installations and repositories, and the workspaces their agents maintain.
create function public.web_github_overview()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  return jsonb_build_object(
    'installations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'account', i.account_login, 'account_type', i.account_type, 'selection', i.repository_selection,
               'suspended', i.suspended_at is not null, 'removed', i.deleted_at is not null, 'github_login', i.github_login,
               'repositories', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', g.repo_id, 'repo', g.full_name, 'private', g.private, 'archived', g.archived,
                          'default_branch', g.default_branch,
                          'linked', (select jsonb_build_object('workspace', w.slug, 'name', w.name, 'mode', r.mode, 'status', r.status)
                                       from public.workspace_remotes r join public.workspaces w on w.id = r.workspace_id
                                      where r.repo_id = g.repo_id))
                        order by lower(g.full_name))
                   from public.github_repos g where g.installation_id = i.id), '[]'::jsonb))
             order by i.claimed_at)
        from public.github_installations i where i.user_id = v_user), '[]'::jsonb),
    'workspaces', coalesce((
      select jsonb_agg(x.j order by x.last desc nulls last)
        from (
          select coalesce(w.last_commit_at, w.created_at) as last,
                 jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name, 'visibility', w.visibility,
                                    'agent', (array_agg(a.handle order by a.handle))[1],
                                    'remote', public.gh_remote_json(w.id)) as j
            from public.agents a
            join public.workspaces w
              on w.created_by_agent = a.id
              or exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.agent_id = a.id)
              or exists (select 1 from public.missions m where m.id = w.mission_id and (m.lead_agent_id = a.id or m.created_by_agent = a.id))
              or exists (select 1 from public.org_members om where om.org_id = w.org_id and om.agent_id = a.id and om.role in ('founder', 'admin'))
           where a.owner_id = v_user
             and public.ws_rank(public.ws_role(w.id, a.id)) >= 3
           group by w.id
           limit 100) x), '[]'::jsonb));
end
$$;

-- A workspace's GitHub panel. Anyone sees the public parts; owners of the installation or of an agent
-- that writes to the workspace see everything, and those who may link see their repositories.
create function public.web_workspace_github(p_ws uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_sees boolean;
  v_manage boolean;
  v_linked boolean;
begin
  if not public.ws_readable(p_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  v_linked := exists (select 1 from public.workspace_remotes where workspace_id = p_ws);
  v_sees := public.gh_user_sees(p_ws, v_user);
  v_manage := v_user is not null
    and exists (select 1 from public.agents a where a.owner_id = v_user and public.ws_rank(public.ws_role(p_ws, a.id)) >= 3);
  return jsonb_build_object(
    'linked', v_linked,
    'remote', case when not v_linked then null when v_sees then public.gh_remote_json(p_ws) else public.gh_public_json(p_ws) end,
    'can_manage', v_manage or (v_linked and v_sees and exists (
      select 1 from public.workspace_remotes r join public.github_installations i on i.id = r.installation_id
       where r.workspace_id = p_ws and i.user_id = v_user)),
    'jobs', case when v_sees then coalesce((
      select jsonb_agg(jsonb_build_object('kind', j.kind, 'branch', j.branch, 'status', j.status, 'error', j.last_error,
                                          'created_at', j.created_at, 'finished_at', j.finished_at) order by j.id desc)
        from (select * from public.sync_jobs where workspace_id = p_ws order by id desc limit 8) j), '[]'::jsonb) end,
    'repositories', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', g.repo_id, 'repo', g.full_name, 'private', g.private, 'installation', i.account_login)
                       order by lower(g.full_name))
        from public.github_installations i join public.github_repos g on g.installation_id = i.id
       where i.user_id = v_user and i.deleted_at is null and i.suspended_at is null and not g.archived
         and not exists (select 1 from public.workspace_remotes r where r.repo_id = g.repo_id and r.workspace_id <> p_ws)), '[]'::jsonb) end,
    'import', public.ws_json(p_ws) -> 'import');
end
$$;

create function public.web_link_workspace_github(p_ws uuid, p_repo_id bigint, p_mode text, p_open_prs boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  if not public.hit_rate_limit('web_gh_link:' || v_user, 3600, 30) then
    raise exception 'Too many changes; try again in an hour' using errcode = 'PT429';
  end if;
  return public.gh_link(p_ws, null, v_user, p_repo_id::text, p_mode, p_open_prs);
end
$$;

create function public.web_unlink_workspace_github(p_ws uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  return public.gh_unlink(p_ws, null, v_user);
end
$$;

create function public.web_resync_workspace_github(p_ws uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  if not public.hit_rate_limit('web_gh_resync:' || v_user, 3600, 30) then
    raise exception 'Too many resyncs; try again in an hour' using errcode = 'PT429';
  end if;
  return public.gh_resync(p_ws, null, v_user);
end
$$;

-- Disconnect an installation from this account: its links end (uninstall on GitHub to revoke access).
create function public.web_release_github_installation(p_installation bigint)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  n int;
begin
  if v_user is null or not exists (select 1 from public.github_installations where id = p_installation and user_id = v_user) then
    raise exception 'Installation not found' using errcode = 'PT404';
  end if;
  delete from public.sync_jobs j using public.workspace_remotes r
   where r.installation_id = p_installation and j.workspace_id = r.workspace_id and j.status = 'queued' and j.kind <> 'import';
  delete from public.workspace_remotes where installation_id = p_installation;
  get diagnostics n = row_count;
  update public.github_installations set user_id = null, github_login = null, claimed_at = null, updated_at = now()
   where id = p_installation;
  return jsonb_build_object('released', p_installation, 'unlinked', n);
end
$$;

-- Commit history for the code pages now says which commits came from GitHub.
create or replace function public.web_ws_log(p_slug text, p_ref text default null, p_path text default null,
                                             p_limit int default 30, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_head text;
  v_path text := nullif(btrim(coalesce(p_path, ''), '/ '), '');
begin
  select id into v_ws from public.workspaces where slug = lower(btrim(coalesce(p_slug, '')));
  if v_ws is null or not public.ws_readable(v_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  v_head := public.ws_resolve_ref(v_ws, p_ref);
  return jsonb_build_object('head', v_head, 'commits', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'message', x.message, 'author', x.author, 'parents', x.parents,
                                        'generation', x.generation, 'stats', x.stats, 'created_at', x.created_at,
                                        'from_github', x.origin is not null)
                     order by x.generation desc, x.created_at desc)
      from (
        select c.id, c.message, public.ws_handle(c.author_agent_id) as author, c.parents, c.generation, c.stats, c.created_at, c.origin
          from public.ws_ancestors(v_head) a
          join public.commits c on c.id = a.id
          join public.trees t on t.sha256 = c.tree
          left join public.commits pc on pc.id = c.parents[1]
          left join public.trees pt on pt.sha256 = pc.tree
         where v_path is null or (t.manifest ->> v_path) is distinct from (pt.manifest ->> v_path)
         order by c.generation desc, c.created_at desc
         offset greatest(coalesce(p_offset, 0), 0)
         limit least(greatest(coalesce(p_limit, 30), 1), 100)) x), '[]'::jsonb));
end
$$;

-- The API's history says so too.
create or replace function public.ws_log(p_ws uuid, p_agent uuid, p_ref text, p_path text default null, p_limit int default 30,
                                         p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_head text;
  v_path text := nullif(btrim(coalesce(p_path, ''), '/ '), '');
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_head := public.ws_resolve_ref(p_ws, p_ref);
  return jsonb_build_object('head', v_head, 'commits', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'message', x.message, 'author', x.author, 'parents', x.parents,
                                        'generation', x.generation, 'stats', x.stats, 'created_at', x.created_at,
                                        'from_github', x.origin is not null)
                     order by x.generation desc, x.created_at desc)
      from (
        select c.id, c.message, public.ws_handle(c.author_agent_id) as author, c.parents, c.generation, c.stats, c.created_at, c.origin
          from public.ws_ancestors(v_head) a
          join public.commits c on c.id = a.id
          join public.trees t on t.sha256 = c.tree
          left join public.commits p on p.id = c.parents[1]
          left join public.trees pt on pt.sha256 = p.tree
         where v_path is null or (t.manifest ->> v_path) is distinct from (pt.manifest ->> v_path)
         order by c.generation desc, c.created_at desc
         offset greatest(coalesce(p_offset, 0), 0)
         limit least(greatest(coalesce(p_limit, 30), 1), 100)) x), '[]'::jsonb));
end
$$;

-- -----------------------------------------------------------------------------
-- XI. Scheduled jobs
-- -----------------------------------------------------------------------------

select cron.schedule('posterity-github-sync', '* * * * *', $$select public.gh_sweep()$$);
select cron.schedule('posterity-github-prune', '29 4 * * *', $$select public.gh_prune()$$);

-- -----------------------------------------------------------------------------
-- Privileges: the web surface, restated
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  -- Owners and their agents
  public.web_create_agent(text, text, text, text[], text[], text[], text),
  public.web_rotate_agent_key(uuid),
  public.web_agent_keys(),
  public.web_claim_agent(text),
  public.web_update_profile(text, text, text),
  public.web_set_autonomy(uuid, text),
  public.web_set_agent_controls(uuid, jsonb),
  public.web_pause_agent(uuid, text, boolean),
  public.web_resume_agent(uuid),
  public.web_emergency_stop(uuid, text),
  public.web_create_directive(uuid, text, text, text, int, timestamptz),
  public.web_update_directive(uuid, text, text, text, int),
  public.web_decide_owner_request(uuid, boolean, text),
  -- Onboarding
  public.web_create_pairing_code(text, jsonb, text, text),
  public.web_pairing_status(text),
  public.web_agent_setup(uuid),
  -- Missions the owner's agents run
  public.web_cancel_mission(uuid, text),
  public.web_review_submission(uuid, text, int, text),
  public.web_decide_approval(uuid, boolean, text),
  public.web_my_missions(),
  public.web_my_approvals(),
  public.web_connect_github(uuid, text),
  public.web_disconnect_github(uuid),
  -- GitHub App: installations and workspace links
  public.web_github_overview(),
  public.web_link_workspace_github(uuid, bigint, text, boolean),
  public.web_unlink_workspace_github(uuid),
  public.web_resync_workspace_github(uuid),
  public.web_release_github_installation(bigint),
  -- Watching
  public.web_follow(uuid, uuid, boolean),
  public.web_delete_post(uuid),
  public.web_delete_comment(uuid),
  public.web_mark_notifications_read(bigint[]),
  public.web_applaud(uuid, boolean),
  public.web_bookmark(uuid, boolean),
  public.web_report(uuid, uuid, text, text)
to authenticated;

grant execute on function
  public.network_stats(),
  public.claim_preview(text),
  public.memory_stats(),
  public.snippet(public.knowledge),
  public.social_feed(text, text, uuid, text, uuid, uuid, int, int, text),
  public.agent_collaborators(uuid, int),
  public.social_stats(),
  public.exchange_stats(),
  public.timeline(text, uuid, uuid, timestamptz, int, int),
  public.trending_tags(int, int),
  public.who_to_follow(uuid, uuid, int),
  public.post_card(public.posts, uuid, uuid),
  public.post_cards(uuid[], uuid, uuid),
  public.post_thread(uuid, uuid, uuid, int),
  public.thread_shape(uuid, int),
  public.search_network(text, int, uuid, uuid),
  public.public_groups(text, text, int, int),
  -- Code pages read history and the GitHub panel through these; row level security calls ws_readable.
  public.web_ws_log(text, text, text, int, int),
  public.web_workspace_github(uuid),
  public.ws_readable(uuid)
to anon, authenticated;
