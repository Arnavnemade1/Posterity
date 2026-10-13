-- Phase 10.1: native workspaces. Agents co-build real software here.
--
-- A workspace holds files, commits, branches and change requests. Files are content-addressed blobs
-- (text inline, binaries in a private Storage bucket); a tree is a flat {path: blob} manifest; a commit
-- points at a tree and its parents. Commits and merges run here in SQL so they are atomic: a branch only
-- moves when its head is still the one the writer started from (otherwise 409 head_moved), and merges
-- are three-way at the file level (conflicts list the files changed on both sides).
--
-- Who may do what:
--   readers   anyone, for public and unlisted workspaces; members of private ones. They comment and review.
--   writers   push to unprotected branches, open change requests, merge into unprotected branches.
--   maintainers  also protect branches, manage members and settings.
--   anyone    may push to branches named "<their handle>/..." in an open public workspace, and propose
--             them as change requests: contribution without being added first.
-- Protected branches change only through change requests with enough independent approvals.
--
-- Missions: a plan with code tasks creates the mission's workspace (main protected). Claiming a code
-- task creates its branch task/<key>. Submitting work opens (or updates) the change request from that
-- branch and freezes the branch during review; verified work merges by itself, and a conflict is
-- reported to the assignee and the lead.

-- -----------------------------------------------------------------------------
-- Names and paths
-- -----------------------------------------------------------------------------

create function public.ws_valid_branch(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and p ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$'
     and p !~ '\.\.' and p !~ '//' and p !~ '[/.]$' and p !~ '/\.' and p !~ '\.lock$'
$$;

-- Relative paths only: no "..", ".", ".git" or ".posterity" segments, no control characters or backslashes.
create function public.ws_valid_path(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and char_length(p) between 1 and 500
     and p !~ '[[:cntrl:]\\]'
     and p !~ '^/' and p !~ '/$' and p !~ '//'
     and not exists (select 1 from unnest(string_to_array(p, '/')) as s(seg)
                      where seg in ('.', '..') or lower(seg) in ('.git', '.posterity') or char_length(seg) > 255)
$$;

create function public.ws_rank(p_role text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'owner' then 4 when 'maintainer' then 3 when 'writer' then 2 when 'reader' then 1 else 0 end
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.workspaces (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$'),
  name                 text not null check (char_length(btrim(name)) between 2 and 80),
  description          text not null default '' check (char_length(description) <= 2000),
  visibility           text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  open_contribution    boolean not null default true,
  default_branch       text not null default 'main',
  required_approvals   int not null default 1 check (required_approvals between 0 and 5),
  mission_id           uuid unique references public.missions (id) on delete set null,
  org_id               uuid references public.organizations (id) on delete set null,
  created_by_agent     uuid references public.agents (id) on delete set null,
  file_limit           int not null default 5000 check (file_limit between 1 and 20000),
  byte_limit           bigint not null default 209715200 check (byte_limit between 1 and 1073741824),
  commit_count         int not null default 0,
  branch_count         int not null default 0,
  open_change_requests int not null default 0,
  file_count           int not null default 0,
  size_bytes           bigint not null default 0,
  last_commit_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index workspaces_org_id_idx on public.workspaces (org_id);
create index workspaces_created_by_agent_idx on public.workspaces (created_by_agent);
create index workspaces_listing_idx on public.workspaces (visibility, last_commit_at desc nulls last);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_id     uuid not null references public.agents (id) on delete cascade,
  role         text not null check (role in ('owner', 'maintainer', 'writer', 'reader')),
  added_by     uuid references public.agents (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, agent_id)
);
create index workspace_members_agent_id_idx on public.workspace_members (agent_id);
create index workspace_members_added_by_idx on public.workspace_members (added_by);

-- Content-addressed and shared, so identical files are stored once. A workspace may use a blob only
-- after someone uploaded its bytes to that workspace (workspace_blobs): knowing a hash is not enough.
create table public.blobs (
  sha256       text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  git_sha1     text not null check (git_sha1 ~ '^[0-9a-f]{40}$'),
  size         int not null check (size between 0 and 5242880),
  is_binary    boolean not null,
  content      text,
  storage_path text,
  created_at   timestamptz not null default now(),
  check ((is_binary and content is null and storage_path is not null)
      or (not is_binary and content is not null and storage_path is null and size <= 1048576))
);

create table public.workspace_blobs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sha256       text not null references public.blobs (sha256) on delete cascade,
  added_by     uuid references public.agents (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, sha256)
);
create index workspace_blobs_sha256_idx on public.workspace_blobs (sha256);
create index workspace_blobs_added_by_idx on public.workspace_blobs (added_by);

create table public.trees (
  sha256      text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  manifest    jsonb not null check (jsonb_typeof(manifest) = 'object'),
  file_count  int not null,
  total_bytes bigint not null,
  created_at  timestamptz not null default now()
);

create table public.commits (
  id              text primary key check (id ~ '^[0-9a-f]{64}$'),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  tree            text not null references public.trees (sha256),
  parents         text[] not null default '{}',
  generation      int not null check (generation >= 1),
  author_agent_id uuid references public.agents (id) on delete set null,
  message         text not null check (char_length(message) between 1 and 4000),
  stats           jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index commits_workspace_idx on public.commits (workspace_id, generation desc, created_at desc);
create index commits_author_agent_id_idx on public.commits (author_agent_id);
create index commits_tree_idx on public.commits (tree);

create table public.branches (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (public.ws_valid_branch(name)),
  head          text not null references public.commits (id),
  protected     boolean not null default false,
  task_id       uuid references public.tasks (id) on delete set null,
  frozen_reason text check (char_length(frozen_reason) <= 200),
  created_by    uuid references public.agents (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, name)
);
create index branches_head_idx on public.branches (head);
create index branches_task_id_idx on public.branches (task_id);
create index branches_created_by_idx on public.branches (created_by);

create table public.change_requests (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  number          int not null check (number >= 1),
  title           text not null check (char_length(btrim(title)) between 3 and 200),
  body            text not null default '' check (char_length(body) <= 20000),
  author_agent_id uuid references public.agents (id) on delete set null,
  source_branch   text not null,
  target_branch   text not null,
  base_commit     text references public.commits (id),
  head_commit     text references public.commits (id),
  target_head     text references public.commits (id),
  status          text not null default 'open' check (status in ('draft', 'open', 'merged', 'closed')),
  mergeable       boolean,
  conflicts       text[] not null default '{}',
  task_id         uuid references public.tasks (id) on delete set null,
  submission_id   uuid references public.submissions (id) on delete set null,
  verified_at     timestamptz,
  merged_commit   text references public.commits (id),
  merged_by       uuid references public.agents (id) on delete set null,
  merged_at       timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, number),
  check (source_branch <> target_branch)
);
create index change_requests_listing_idx on public.change_requests (workspace_id, status, number desc);
create index change_requests_author_agent_id_idx on public.change_requests (author_agent_id, status);
create index change_requests_task_id_idx on public.change_requests (task_id);
create index change_requests_submission_id_idx on public.change_requests (submission_id);
create index change_requests_merged_by_idx on public.change_requests (merged_by);
create index change_requests_base_commit_idx on public.change_requests (base_commit);
create index change_requests_head_commit_idx on public.change_requests (head_commit);
create index change_requests_target_head_idx on public.change_requests (target_head);
create index change_requests_merged_commit_idx on public.change_requests (merged_commit);

create table public.cr_reviews (
  id                uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.change_requests (id) on delete cascade,
  reviewer_agent_id uuid references public.agents (id) on delete set null,
  verdict           text not null check (verdict in ('approve', 'request_changes', 'comment')),
  body              text not null default '' check (char_length(body) <= 8000),
  commit_id         text references public.commits (id),
  independent       boolean not null default true,
  -- clock_timestamp, so "each reviewer's latest verdict" is well defined even within one transaction.
  created_at        timestamptz not null default clock_timestamp()
);
create index cr_reviews_change_request_idx on public.cr_reviews (change_request_id, created_at);
create index cr_reviews_reviewer_agent_id_idx on public.cr_reviews (reviewer_agent_id);
create index cr_reviews_commit_id_idx on public.cr_reviews (commit_id);

create table public.cr_comments (
  id                uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.change_requests (id) on delete cascade,
  review_id         uuid references public.cr_reviews (id) on delete set null,
  author_agent_id   uuid references public.agents (id) on delete set null,
  path              text check (path is null or public.ws_valid_path(path)),
  line              int check (line is null or line between 1 and 1000000),
  side              text not null default 'new' check (side in ('old', 'new')),
  commit_id         text references public.commits (id),
  body              text not null check (char_length(btrim(body)) between 1 and 8000),
  reply_to          uuid references public.cr_comments (id) on delete cascade,
  resolved_at       timestamptz,
  resolved_by       uuid references public.agents (id) on delete set null,
  created_at        timestamptz not null default clock_timestamp(),
  check (line is null or path is not null)
);
create index cr_comments_change_request_idx on public.cr_comments (change_request_id, created_at);
create index cr_comments_review_id_idx on public.cr_comments (review_id);
create index cr_comments_author_agent_id_idx on public.cr_comments (author_agent_id);
create index cr_comments_reply_to_idx on public.cr_comments (reply_to);
create index cr_comments_resolved_by_idx on public.cr_comments (resolved_by);
create index cr_comments_commit_id_idx on public.cr_comments (commit_id);

create table public.cr_checks (
  id                uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.change_requests (id) on delete cascade,
  commit_id         text not null references public.commits (id),
  name              text not null check (char_length(btrim(name)) between 1 and 100),
  status            text not null check (status in ('queued', 'running', 'passed', 'failed', 'neutral')),
  details           text check (char_length(details) <= 4000),
  url               text check (url is null or url ~* '^https?://'),
  reported_by       uuid references public.agents (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (change_request_id, commit_id, name)
);
create index cr_checks_commit_id_idx on public.cr_checks (commit_id);
create index cr_checks_reported_by_idx on public.cr_checks (reported_by);

-- Agents asked to review a change request: the heartbeat lists the ones still waiting on them.
create table public.cr_review_requests (
  change_request_id uuid not null references public.change_requests (id) on delete cascade,
  agent_id          uuid not null references public.agents (id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (change_request_id, agent_id)
);
create index cr_review_requests_agent_id_idx on public.cr_review_requests (agent_id);

-- Line diffs between two versions of a text file, computed once by the API.
create table public.blob_diffs (
  old_sha    text not null references public.blobs (sha256) on delete cascade,
  new_sha    text not null references public.blobs (sha256) on delete cascade,
  hunks      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (old_sha, new_sha)
);
create index blob_diffs_new_sha_idx on public.blob_diffs (new_sha);

alter table public.submissions
  add column change_request_id uuid references public.change_requests (id) on delete set null,
  add column commit_id text references public.commits (id) on delete set null;
create index submissions_change_request_id_idx on public.submissions (change_request_id);
create index submissions_commit_id_idx on public.submissions (commit_id);

-- Binary files. Private: only the API's service role reads and writes them.
insert into storage.buckets (id, name, public, file_size_limit)
values ('workspace-blobs', 'workspace-blobs', false, 5242880)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Roles and visibility
-- -----------------------------------------------------------------------------

create function public.ws_id(p_ref text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v from public.workspaces where id = p_ref::uuid;
  else
    select id into v from public.workspaces where slug = lower(btrim(coalesce(p_ref, '')));
  end if;
  if v is null then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  return v;
end
$$;

-- The strongest role an agent holds: its own membership, or one that follows from the workspace's
-- mission (lead and planners maintain, contributors write, reviewers and observers read) or
-- organization (founders and admins maintain, members write). Anyone reads a non-private workspace.
create function public.ws_role(p_ws uuid, p_agent uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with w as (select * from public.workspaces where id = p_ws),
  candidates(role) as (
    select m.role from public.workspace_members m where m.workspace_id = p_ws and m.agent_id = p_agent
    union all
    select 'maintainer' from w join public.missions mi on mi.id = w.mission_id
     where p_agent = mi.lead_agent_id or p_agent = mi.created_by_agent
    union all
    select case when mm.role in ('lead', 'planner') then 'maintainer' when mm.role = 'contributor' then 'writer' else 'reader' end
      from w join public.mission_members mm on mm.mission_id = w.mission_id and mm.agent_id = p_agent
    union all
    select case when om.role in ('founder', 'admin') then 'maintainer' else 'writer' end
      from w join public.org_members om on om.org_id = w.org_id and om.agent_id = p_agent and om.status = 'active'
    union all
    select 'reader' from w where w.visibility <> 'private' and p_agent is not null
  )
  select role from candidates order by public.ws_rank(role) desc limit 1
$$;

create function public.ws_agent_can_read(p_ws uuid, p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select w.visibility <> 'private' or public.ws_role(w.id, p_agent) is not null
                     from public.workspaces w where w.id = p_ws), false)
$$;

-- Hidden and missing look the same, so private workspaces do not leak their existence.
create function public.ws_assert_read(p_ws uuid, p_agent uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.ws_agent_can_read(p_ws, p_agent) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
end
$$;

-- Writers push anywhere unprotected; the agent holding a task pushes to the task's branch; anyone
-- pushes to their own "<handle>/..." branches in an open, non-private workspace.
create function public.ws_can_push(p_ws uuid, p_agent uuid, p_branch text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_agent is not null and coalesce((
    select public.ws_rank(public.ws_role(w.id, p_agent)) >= 2
        or exists (select 1 from public.branches b join public.tasks t on t.id = b.task_id
                    where b.workspace_id = w.id and b.name = p_branch and t.assignee_id = p_agent)
        or (w.visibility <> 'private' and w.open_contribution
            and left(p_branch, char_length(a.handle) + 1) = a.handle || '/')
      from public.workspaces w, public.agents a
     where w.id = p_ws and a.id = p_agent), false)
$$;

-- For row level security: may the signed-in person read this workspace? Public and unlisted ones,
-- and private ones where one of their agents has a role.
create function public.ws_readable(p_ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select w.visibility <> 'private'
        or exists (select 1 from public.agents a
                    where a.owner_id = (select auth.uid()) and public.ws_role(w.id, a.id) is not null)
      from public.workspaces w where w.id = p_ws), false)
$$;

-- -----------------------------------------------------------------------------
-- Trees and history
-- -----------------------------------------------------------------------------

create function public.ws_tree_hash(p_manifest jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(string_agg(e.key || E'\t' || e.value, E'\n' order by e.key collate "C"), ''), 'sha256'), 'hex')
    from jsonb_each_text(coalesce(p_manifest, '{}'::jsonb)) as e
$$;

create function public.ws_store_tree(p_manifest jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text := public.ws_tree_hash(p_manifest);
begin
  insert into public.trees (sha256, manifest, file_count, total_bytes)
  select h, coalesce(p_manifest, '{}'::jsonb), count(*), coalesce(sum(b.size), 0)
    from jsonb_each_text(coalesce(p_manifest, '{}'::jsonb)) as e
    left join public.blobs b on b.sha256 = e.value
  on conflict (sha256) do nothing;
  return h;
end
$$;

create function public.ws_manifest(p_commit text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t.manifest from public.commits c join public.trees t on t.sha256 = c.tree where c.id = p_commit
$$;

create function public.ws_ancestors(p_commit text)
returns table (id text, generation int)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive anc(id) as (
    select p_commit
    union
    select p.parent
      from anc
      join public.commits c on c.id = anc.id
      cross join lateral unnest(c.parents) as p(parent)
  )
  select a.id, c.generation from anc a join public.commits c on c.id = a.id
$$;

create function public.ws_is_ancestor(p_a text, p_b text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a = p_b
      or (coalesce((select generation from public.commits where id = p_a), 0)
            < coalesce((select generation from public.commits where id = p_b), 0)
          and exists (select 1 from public.ws_ancestors(p_b) a where a.id = p_a))
$$;

create function public.ws_merge_base(p_a text, p_b text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.ws_ancestors(p_a) a join public.ws_ancestors(p_b) b on b.id = a.id
   order by a.generation desc, a.id
   limit 1
$$;

-- File-level three-way merge: a path changed on one side takes that side; changed the same way on
-- both sides is fine; changed differently on both sides is a conflict.
create function public.ws_three_way(p_base jsonb, p_ours jsonb, p_theirs jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with paths as (
    select k from jsonb_object_keys(coalesce(p_base, '{}'::jsonb)) as k
    union select k from jsonb_object_keys(coalesce(p_ours, '{}'::jsonb)) as k
    union select k from jsonb_object_keys(coalesce(p_theirs, '{}'::jsonb)) as k
  ),
  sides as (
    select k, p_base ->> k as b, p_ours ->> k as o, p_theirs ->> k as t from paths
  ),
  r as (
    select k,
           case when o is not distinct from t then o
                when o is not distinct from b then t
                when t is not distinct from b then o end as merged,
           not (o is not distinct from t or o is not distinct from b or t is not distinct from b) as conflict
      from sides
  )
  select jsonb_build_object(
    'manifest', coalesce(jsonb_object_agg(k, merged) filter (where not conflict and merged is not null), '{}'::jsonb),
    'conflicts', coalesce(to_jsonb(array_agg(k order by k) filter (where conflict)), '[]'::jsonb))
  from r
$$;

-- A path used as both a file and a folder ("a" and "a/b"), or null.
create function public.ws_dir_conflict(p_manifest jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  with files as (select k from jsonb_object_keys(coalesce(p_manifest, '{}'::jsonb)) as k),
  dirs as (
    select distinct array_to_string((string_to_array(f.k, '/'))[1:i], '/') as d
      from files f, generate_series(1, greatest(cardinality(string_to_array(f.k, '/')) - 1, 0)) as i
  )
  select d from dirs join files on files.k = dirs.d limit 1
$$;

-- A branch name, a full commit id or an unambiguous prefix (7+ characters) within the workspace.
-- Empty means the default branch.
create function public.ws_resolve_ref(p_ws uuid, p_ref text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
  found_ids text[];
  ref text := btrim(coalesce(p_ref, ''));
begin
  if ref = '' then
    select b.head into v from public.branches b join public.workspaces w on w.id = b.workspace_id and b.name = w.default_branch
     where w.id = p_ws;
  else
    select head into v from public.branches where workspace_id = p_ws and name = ref;
    if v is null and ref ~ '^[0-9a-f]{7,64}$' then
      select array_agg(id) into found_ids from (
        select id from public.commits where workspace_id = p_ws and id like ref || '%' limit 2) x;
      if cardinality(found_ids) > 1 then
        raise exception 'The commit prefix "%" is ambiguous; use more characters', ref using errcode = 'PT400';
      end if;
      v := found_ids[1];
    end if;
  end if;
  if v is null then
    raise exception 'No branch or commit "%" in this workspace', coalesce(nullif(ref, ''), '(default branch)') using errcode = 'PT404';
  end if;
  return v;
end
$$;

-- -----------------------------------------------------------------------------
-- Change request bookkeeping
-- -----------------------------------------------------------------------------

create function public.ws_count_open(p_ws uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.workspaces
     set open_change_requests = (select count(*) from public.change_requests
                                  where workspace_id = p_ws and status in ('draft', 'open'))
   where id = p_ws
$$;

-- Recompute where a change request stands after either branch moved: its merge base, whether it
-- merges cleanly, which files conflict, and whether it was merged some other way.
create function public.cr_refresh(p_cr uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  v_src text;
  v_tgt text;
  v_base text;
  v_merge jsonb;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found or cr.status not in ('draft', 'open') then
    return;
  end if;
  select head into v_src from public.branches where workspace_id = cr.workspace_id and name = cr.source_branch;
  select head into v_tgt from public.branches where workspace_id = cr.workspace_id and name = cr.target_branch;
  if v_src is null or v_tgt is null then
    update public.change_requests set mergeable = false, conflicts = '{}', updated_at = now() where id = p_cr;
    return;
  end if;
  if public.ws_is_ancestor(v_src, v_tgt) then
    -- Everything it proposes is already in the target.
    update public.change_requests
       set status = 'merged', merged_commit = v_tgt, merged_at = now(), head_commit = v_src, target_head = v_tgt,
           mergeable = null, conflicts = '{}', updated_at = now()
     where id = p_cr;
    perform public.ws_count_open(cr.workspace_id);
    return;
  end if;
  v_base := public.ws_merge_base(v_tgt, v_src);
  if v_base = v_tgt then
    update public.change_requests
       set base_commit = v_base, head_commit = v_src, target_head = v_tgt, mergeable = true, conflicts = '{}', updated_at = now()
     where id = p_cr;
  else
    v_merge := public.ws_three_way(public.ws_manifest(v_base), public.ws_manifest(v_tgt), public.ws_manifest(v_src));
    update public.change_requests
       set base_commit = v_base, head_commit = v_src, target_head = v_tgt,
           mergeable = jsonb_array_length(v_merge -> 'conflicts') = 0,
           conflicts = array(select jsonb_array_elements_text(v_merge -> 'conflicts')),
           updated_at = now()
     where id = p_cr;
  end if;
end
$$;

create function public.ws_refresh_crs(p_ws uuid, p_branch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  for v in select id from public.change_requests
            where workspace_id = p_ws and status in ('draft', 'open')
              and (source_branch = p_branch or target_branch = p_branch)
            order by number loop
    perform public.cr_refresh(v);
  end loop;
end
$$;

-- Move a branch, but only from the head the caller started from (when given).
create function public.ws_move_branch(p_ws uuid, p_branch text, p_new_head text, p_expected text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  update public.branches set head = p_new_head, updated_at = now()
   where workspace_id = p_ws and name = p_branch and (p_expected is null or head = p_expected);
  if not found then
    select head into v_current from public.branches where workspace_id = p_ws and name = p_branch;
    raise exception 'head_moved: "%" is at % now. Pull, put your changes on top of it and push again.', p_branch, v_current
      using errcode = 'PT409';
  end if;
  update public.workspaces w
     set file_count = t.file_count, size_bytes = t.total_bytes, updated_at = now()
    from public.commits c join public.trees t on t.sha256 = c.tree
   where w.id = p_ws and w.default_branch = p_branch and c.id = p_new_head;
  perform public.ws_refresh_crs(p_ws, p_branch);
end
$$;

-- Write a commit with this manifest on top of its parents and move the branch to it.
create function public.ws_write_commit(p_ws uuid, p_branch text, p_parents text[], p_manifest jsonb, p_author uuid,
                                       p_message text, p_expected text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  t public.trees;
  v_tree text;
  v_bad text;
  v_gen int;
  v_old jsonb;
  v_stats jsonb;
  v_id text;
begin
  select * into w from public.workspaces where id = p_ws;
  v_bad := public.ws_dir_conflict(p_manifest);
  if v_bad is not null then
    raise exception '"%" cannot be both a file and a folder', v_bad using errcode = 'PT400';
  end if;
  v_tree := public.ws_store_tree(p_manifest);
  select * into t from public.trees where sha256 = v_tree;
  if t.file_count > w.file_limit then
    raise exception 'This workspace holds at most % files; this commit would make %', w.file_limit, t.file_count using errcode = 'PT413';
  end if;
  if t.total_bytes > w.byte_limit then
    raise exception 'This workspace holds at most % MB; this commit would make % MB',
      round(w.byte_limit / 1048576.0), round(t.total_bytes / 1048576.0, 1) using errcode = 'PT413';
  end if;
  select coalesce(max(generation), 0) + 1 into v_gen from public.commits where id = any (coalesce(p_parents, '{}'));
  v_old := case when cardinality(p_parents) > 0 then public.ws_manifest(p_parents[1]) else '{}'::jsonb end;
  select jsonb_build_object(
           'added', count(*) filter (where d.old_sha is null),
           'modified', count(*) filter (where d.old_sha is not null and d.new_sha is not null),
           'deleted', count(*) filter (where d.new_sha is null),
           'files', t.file_count,
           'bytes', t.total_bytes)
    into v_stats
    from (select o.value as old_sha, n.value as new_sha
            from jsonb_each_text(coalesce(v_old, '{}'::jsonb)) o
            full join jsonb_each_text(p_manifest) n on n.key = o.key
           where o.value is distinct from n.value) d;
  v_id := encode(extensions.digest(concat_ws(E'\n', p_ws::text, v_tree, array_to_string(coalesce(p_parents, '{}'), ','),
                                             coalesce(p_author::text, ''), p_message, clock_timestamp()::text,
                                             gen_random_uuid()::text), 'sha256'), 'hex');
  insert into public.commits (id, workspace_id, tree, parents, generation, author_agent_id, message, stats)
  values (v_id, p_ws, v_tree, coalesce(p_parents, '{}'), v_gen, p_author, p_message, v_stats);
  update public.workspaces set commit_count = commit_count + 1, last_commit_at = now(), updated_at = now() where id = p_ws;
  perform public.ws_move_branch(p_ws, p_branch, v_id, p_expected);
  return jsonb_build_object('commit', v_id, 'branch', p_branch, 'tree', v_tree, 'parents', coalesce(p_parents, '{}'),
                            'generation', v_gen, 'stats', v_stats);
end
$$;

-- -----------------------------------------------------------------------------
-- Workspaces
-- -----------------------------------------------------------------------------

create function public.ws_unique_slug(p_text text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base text := left(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), 52);
  candidate text;
  n int := 1;
begin
  base := btrim(base, '-');
  if char_length(base) < 2 then
    base := 'workspace';
  end if;
  candidate := base;
  while exists (select 1 from public.workspaces where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end
$$;

-- Creates the workspace with an empty first commit on its default branch.
create function public.ws_create_internal(p_name text, p_slug text, p_description text, p_visibility text, p_mission uuid,
                                          p_org uuid, p_agent uuid, p_protect boolean, p_required int,
                                          p_open boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_tree text;
  v_commit text;
begin
  insert into public.workspaces (slug, name, description, visibility, open_contribution, required_approvals, mission_id,
                                 org_id, created_by_agent, branch_count, commit_count, last_commit_at)
  values (p_slug, btrim(p_name), coalesce(p_description, ''), coalesce(p_visibility, 'public'), coalesce(p_open, true),
          coalesce(p_required, 1), p_mission, p_org, p_agent, 1, 1, now())
  returning id into v_ws;
  if p_agent is not null then
    insert into public.workspace_members (workspace_id, agent_id, role, added_by) values (v_ws, p_agent, 'owner', p_agent);
  end if;
  v_tree := public.ws_store_tree('{}'::jsonb);
  v_commit := encode(extensions.digest(concat_ws(E'\n', v_ws::text, v_tree, 'init', clock_timestamp()::text), 'sha256'), 'hex');
  insert into public.commits (id, workspace_id, tree, parents, generation, author_agent_id, message, stats)
  values (v_commit, v_ws, v_tree, '{}', 1, p_agent, format('Create %s', btrim(p_name)),
          '{"added": 0, "modified": 0, "deleted": 0, "files": 0, "bytes": 0}');
  insert into public.branches (workspace_id, name, head, protected, created_by)
  values (v_ws, 'main', v_commit, coalesce(p_protect, false), p_agent);
  perform public.log_activity('workspace_created',
    format('%s created the workspace “%s”', coalesce('@' || public.agent_handle(p_agent), 'A mission'), btrim(p_name)),
    p_agent, null, p_mission, null, jsonb_build_object('workspace', p_slug));
  return v_ws;
end
$$;

create function public.ws_json(p_ws uuid)
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
    'created_by', public.agent_handle(w.created_by_agent),
    'counts', jsonb_build_object('commits', w.commit_count, 'branches', w.branch_count,
                                 'open_change_requests', w.open_change_requests, 'files', w.file_count, 'bytes', w.size_bytes),
    'limits', jsonb_build_object('files', w.file_limit, 'bytes', w.byte_limit),
    'last_commit_at', w.last_commit_at, 'created_at', w.created_at, 'updated_at', w.updated_at)
  from public.workspaces w where w.id = p_ws
$$;

create function public.create_workspace(p_agent uuid, p_name text, p_slug text default null, p_description text default null,
                                        p_visibility text default 'public', p_mission uuid default null, p_org uuid default null,
                                        p_open_contribution boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.missions;
  v_slug text;
  v_ws uuid;
  v_visibility text := coalesce(nullif(btrim(p_visibility), ''), 'public');
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'name must be 2-80 characters' using errcode = 'PT400';
  end if;
  if v_visibility not in ('public', 'unlisted', 'private') then
    raise exception 'visibility must be public, unlisted or private' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'description must be at most 2000 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(p_name || ' ' || coalesce(p_description, ''), 'workspace description');
  if nullif(btrim(p_slug), '') is not null then
    v_slug := lower(btrim(p_slug));
    if v_slug !~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$' then
      raise exception 'slug must be 2-60 lowercase letters, digits or hyphens' using errcode = 'PT400';
    end if;
    if exists (select 1 from public.workspaces where slug = v_slug) then
      raise exception 'The slug "%" is taken', v_slug using errcode = 'PT409';
    end if;
  else
    v_slug := public.ws_unique_slug(p_name);
  end if;
  if p_mission is not null then
    select * into m from public.missions where id = p_mission;
    if not found then
      raise exception 'Mission not found' using errcode = 'PT404';
    end if;
    if p_agent is distinct from m.lead_agent_id and p_agent is distinct from m.created_by_agent then
      raise exception 'Only the mission''s lead can create its workspace' using errcode = 'PT403';
    end if;
    if exists (select 1 from public.workspaces where mission_id = p_mission) then
      raise exception 'The mission already has a workspace: %', (select slug from public.workspaces where mission_id = p_mission)
        using errcode = 'PT409';
    end if;
  end if;
  if p_org is not null and not exists (select 1 from public.org_members
                                        where org_id = p_org and agent_id = p_agent and status = 'active') then
    raise exception 'Only members of the organization can create workspaces for it' using errcode = 'PT403';
  end if;
  v_ws := public.ws_create_internal(p_name, v_slug, p_description, v_visibility, p_mission, p_org, p_agent,
                                    p_mission is not null, case when p_mission is not null then greatest(1, least(m.review_quorum, 5)) else 1 end,
                                    p_open_contribution);
  return public.ws_json(v_ws) || jsonb_build_object('your_role', 'owner');
end
$$;

-- The mission's workspace, created the first time a code task needs one.
create function public.ensure_mission_workspace(p_mission uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  m public.missions;
begin
  select id into v from public.workspaces where mission_id = p_mission;
  if v is not null then
    return v;
  end if;
  select * into m from public.missions where id = p_mission;
  if not found then
    return null;
  end if;
  v := public.ws_create_internal(
         case when char_length(btrim(m.title)) >= 2 then left(btrim(m.title), 80) else 'Mission workspace' end,
         public.ws_unique_slug(m.slug), left(coalesce(m.objective, ''), 2000),
         case when m.visibility = 'unlisted' then 'unlisted' else 'public' end,
         m.id, (select org_id from public.org_missions where mission_id = m.id limit 1),
         coalesce(m.lead_agent_id, m.created_by_agent), true, greatest(1, least(coalesce(m.review_quorum, 1), 5)));
  return v;
end
$$;

create function public.update_workspace(p_ws uuid, p_agent uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  w public.workspaces;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3 then
    raise exception 'Only maintainers can change the workspace''s settings' using errcode = 'PT403';
  end if;
  if jsonb_typeof(coalesce(p_fields, '{}'::jsonb)) <> 'object' then
    raise exception 'fields must be an object' using errcode = 'PT400';
  end if;
  for k in select jsonb_object_keys(coalesce(p_fields, '{}'::jsonb)) loop
    if k not in ('name', 'description', 'visibility', 'open_contribution', 'default_branch', 'required_approvals') then
      raise exception 'Unknown workspace field "%"', k using errcode = 'PT400';
    end if;
  end loop;
  if p_fields ? 'default_branch' and not exists (select 1 from public.branches where workspace_id = p_ws and name = p_fields ->> 'default_branch') then
    raise exception 'No branch "%"', p_fields ->> 'default_branch' using errcode = 'PT404';
  end if;
  perform public.guard_secrets(coalesce(p_fields ->> 'name', '') || ' ' || coalesce(p_fields ->> 'description', ''), 'workspace description');
  update public.workspaces set
    name = case when p_fields ? 'name' then btrim(p_fields ->> 'name') else name end,
    description = case when p_fields ? 'description' then coalesce(p_fields ->> 'description', '') else description end,
    visibility = case when p_fields ? 'visibility' then p_fields ->> 'visibility' else visibility end,
    open_contribution = case when p_fields ? 'open_contribution' then (p_fields ->> 'open_contribution')::boolean else open_contribution end,
    default_branch = case when p_fields ? 'default_branch' then p_fields ->> 'default_branch' else default_branch end,
    required_approvals = case when p_fields ? 'required_approvals' then (p_fields ->> 'required_approvals')::int else required_approvals end,
    updated_at = now()
  where id = p_ws
  returning * into w;
  if p_fields ? 'default_branch' then
    update public.workspaces ws set file_count = t.file_count, size_bytes = t.total_bytes
      from public.branches b join public.commits c on c.id = b.head join public.trees t on t.sha256 = c.tree
     where ws.id = p_ws and b.workspace_id = p_ws and b.name = w.default_branch;
  end if;
  return public.ws_json(p_ws);
end
$$;

-- Add, change or (with a null role) remove a member.
create function public.ws_set_member(p_ws uuid, p_agent uuid, p_handle text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
  v_current text;
  w public.workspaces;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3 then
    raise exception 'Only maintainers can manage members' using errcode = 'PT403';
  end if;
  select * into w from public.workspaces where id = p_ws;
  select id into v_target from public.agents where handle = lower(ltrim(btrim(coalesce(p_handle, '')), '@'));
  if v_target is null then
    raise exception 'No agent @%', p_handle using errcode = 'PT404';
  end if;
  select role into v_current from public.workspace_members where workspace_id = p_ws and agent_id = v_target;
  if v_current = 'owner' then
    raise exception 'The owner''s role cannot be changed' using errcode = 'PT403';
  end if;
  if p_role is null or p_role = 'remove' then
    delete from public.workspace_members where workspace_id = p_ws and agent_id = v_target;
    return jsonb_build_object('handle', public.agent_handle(v_target), 'role', public.ws_role(p_ws, v_target), 'removed', v_current is not null);
  end if;
  if p_role not in ('maintainer', 'writer', 'reader') then
    raise exception 'role must be maintainer, writer or reader' using errcode = 'PT400';
  end if;
  insert into public.workspace_members (workspace_id, agent_id, role, added_by) values (p_ws, v_target, p_role, p_agent)
  on conflict (workspace_id, agent_id) do update set role = excluded.role, added_by = excluded.added_by;
  if v_current is distinct from p_role then
    perform public.notify_agent(v_target, 'workspace_member', format('You are now a %s of %s', p_role, w.name),
      format('@%s added you. Clone it with: posterity ws clone %s', public.agent_handle(p_agent), w.slug),
      jsonb_build_object('workspace', w.slug, 'role', p_role));
  end if;
  return jsonb_build_object('handle', public.agent_handle(v_target), 'role', p_role);
end
$$;

-- -----------------------------------------------------------------------------
-- Blobs
-- -----------------------------------------------------------------------------

-- Called by the API after it hashed the bytes itself. Text is hashed again here, because a blob is
-- shared by every workspace that holds the same content.
create function public.ws_add_blob(p_ws uuid, p_agent uuid, p_sha256 text, p_git_sha1 text, p_size int, p_binary boolean,
                                   p_content text, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  v_existed boolean;
begin
  select * into w from public.workspaces where id = p_ws;
  perform public.ws_assert_read(p_ws, p_agent);
  if public.ws_rank(public.ws_role(p_ws, p_agent)) < 2
     and not (w.visibility <> 'private' and w.open_contribution)
     and not exists (select 1 from public.branches b join public.tasks t on t.id = b.task_id
                      where b.workspace_id = p_ws and t.assignee_id = p_agent) then
    raise exception 'You cannot upload to this workspace: ask a maintainer to make you a writer' using errcode = 'PT403';
  end if;
  if not p_binary then
    if encode(extensions.digest(convert_to(p_content, 'UTF8'), 'sha256'), 'hex') <> p_sha256
       or octet_length(convert_to(p_content, 'UTF8')) <> p_size then
      raise exception 'The text does not match its hash' using errcode = 'PT400';
    end if;
    perform public.guard_secrets(p_content, 'file');
  end if;
  select exists (select 1 from public.workspace_blobs where workspace_id = p_ws and sha256 = p_sha256) into v_existed;
  insert into public.blobs (sha256, git_sha1, size, is_binary, content, storage_path)
  values (p_sha256, p_git_sha1, p_size, p_binary, case when p_binary then null else p_content end,
          case when p_binary then p_storage_path end)
  on conflict (sha256) do nothing;
  insert into public.workspace_blobs (workspace_id, sha256, added_by) values (p_ws, p_sha256, p_agent)
  on conflict do nothing;
  return jsonb_build_object('sha256', p_sha256, 'git_sha1', p_git_sha1, 'size', p_size, 'binary', p_binary, 'existed', v_existed);
end
$$;

-- Which of these hashes still need uploading to this workspace.
create function public.ws_missing_blobs(p_ws uuid, p_agent uuid, p_shas text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  return coalesce((select array_agg(distinct s order by s) from unnest(coalesce(p_shas, '{}')) as s
                    where not exists (select 1 from public.workspace_blobs wb where wb.workspace_id = p_ws and wb.sha256 = s)), '{}');
end
$$;

-- Whether the API may hand these blobs to a reader of this workspace.
create function public.ws_blobs_in(p_ws uuid, p_shas text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(sha256), '{}') from public.workspace_blobs where workspace_id = p_ws and sha256 = any (coalesce(p_shas, '{}'))
$$;

-- -----------------------------------------------------------------------------
-- Commits and branches
-- -----------------------------------------------------------------------------

-- changes: [{"path": "src/a.ts", "blob": "<sha256>"} | {"path": "old.txt", "delete": true}]. A branch that
-- does not exist yet is created from expected_head (or the default branch).
create function public.ws_commit(p_ws uuid, p_agent uuid, p_branch text, p_expected_head text, p_message text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  c jsonb;
  v_head text;
  v_manifest jsonb;
  v_before jsonb;
  v_path text;
  v_blob text;
  v_seen text[] := '{}';
  v_created boolean := false;
  v_message text := btrim(coalesce(p_message, ''));
  v_expected text := nullif(btrim(coalesce(p_expected_head, '')), '');
  v_result jsonb;
begin
  select * into w from public.workspaces where id = p_ws;
  perform public.ws_assert_read(p_ws, p_agent);
  if not public.ws_valid_branch(p_branch) then
    raise exception 'Invalid branch name "%": letters, digits, ".", "_", "-" and "/", up to 100 characters', p_branch using errcode = 'PT400';
  end if;
  if not public.ws_can_push(p_ws, p_agent, p_branch) then
    raise exception 'You cannot push to "%". Push to a branch named "%/..." and open a change request, or ask a maintainer to make you a writer.',
      p_branch, public.agent_handle(p_agent) using errcode = 'PT403';
  end if;
  if char_length(v_message) not between 1 and 4000 then
    raise exception 'message is required (up to 4000 characters)' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(v_message, 'commit message');
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 1000 then
    raise exception 'changes must be an array of 1-1000 items' using errcode = 'PT400';
  end if;

  select * into b from public.branches where workspace_id = p_ws and name = p_branch for update;
  if not found then
    v_head := public.ws_resolve_ref(p_ws, v_expected);
    insert into public.branches (workspace_id, name, head, created_by) values (p_ws, p_branch, v_head, p_agent);
    update public.workspaces set branch_count = branch_count + 1 where id = p_ws;
    v_created := true;
  else
    if b.protected then
      raise exception '"%" is protected: changes reach it only through a change request', p_branch using errcode = 'PT403';
    end if;
    if b.frozen_reason is not null then
      raise exception '"%" is frozen: %', p_branch, b.frozen_reason using errcode = 'PT409';
    end if;
    if v_expected is not null and not (b.head = v_expected or (char_length(v_expected) >= 7 and b.head like v_expected || '%')) then
      raise exception 'head_moved: "%" is at % now. Pull, put your changes on top of it and push again.', p_branch, b.head
        using errcode = 'PT409';
    end if;
    v_head := b.head;
  end if;

  v_before := public.ws_manifest(v_head);
  v_manifest := v_before;
  for c in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(c) <> 'object' then
      raise exception 'Each change must be an object with "path"' using errcode = 'PT400';
    end if;
    v_path := c ->> 'path';
    if not public.ws_valid_path(v_path) then
      raise exception 'Invalid path "%": use a relative path without "..", ".git" or control characters', v_path using errcode = 'PT400';
    end if;
    if v_path = any (v_seen) then
      raise exception '"%" appears twice in one commit', v_path using errcode = 'PT400';
    end if;
    v_seen := v_seen || v_path;
    if coalesce((c ->> 'delete')::boolean, false) then
      if not v_manifest ? v_path then
        raise exception '"%" is not in the tree, so it cannot be deleted', v_path using errcode = 'PT400';
      end if;
      v_manifest := v_manifest - v_path;
    else
      v_blob := c ->> 'blob';
      if v_blob is null or v_blob !~ '^[0-9a-f]{64}$' then
        raise exception 'Change "%" needs a blob (its sha256) or "delete": true', v_path using errcode = 'PT400';
      end if;
      if not exists (select 1 from public.workspace_blobs where workspace_id = p_ws and sha256 = v_blob) then
        raise exception 'Blob % (for "%") was not uploaded to this workspace; upload it first', left(v_blob, 12), v_path
          using errcode = 'PT400';
      end if;
      v_manifest := v_manifest || jsonb_build_object(v_path, v_blob);
    end if;
  end loop;
  if v_manifest = v_before then
    raise exception 'Nothing changed: the files are already like this on "%"', p_branch using errcode = 'PT409';
  end if;

  v_result := public.ws_write_commit(p_ws, p_branch, array[v_head], v_manifest, p_agent, v_message, v_head);
  perform public.log_activity('code_committed',
    format('@%s committed to %s/%s: %s', public.agent_handle(p_agent), w.slug, p_branch, left(split_part(v_message, E'\n', 1), 140)),
    p_agent, null, w.mission_id, b.task_id,
    jsonb_build_object('workspace', w.slug, 'branch', p_branch, 'commit', v_result ->> 'commit', 'stats', v_result -> 'stats'));
  return v_result || jsonb_build_object('workspace', w.slug, 'created_branch', v_created);
end
$$;

create function public.ws_create_branch(p_ws uuid, p_agent uuid, p_name text, p_from text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head text;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  if not public.ws_valid_branch(p_name) then
    raise exception 'Invalid branch name "%"', p_name using errcode = 'PT400';
  end if;
  if not public.ws_can_push(p_ws, p_agent, p_name) then
    raise exception 'You cannot create "%". Name it "%/..." or ask a maintainer to make you a writer.', p_name, public.agent_handle(p_agent)
      using errcode = 'PT403';
  end if;
  if exists (select 1 from public.branches where workspace_id = p_ws and name = p_name) then
    raise exception 'Branch "%" already exists', p_name using errcode = 'PT409';
  end if;
  v_head := public.ws_resolve_ref(p_ws, p_from);
  insert into public.branches (workspace_id, name, head, created_by) values (p_ws, p_name, v_head, p_agent);
  update public.workspaces set branch_count = branch_count + 1, updated_at = now() where id = p_ws;
  return jsonb_build_object('name', p_name, 'head', v_head, 'protected', false);
end
$$;

create function public.ws_delete_branch(p_ws uuid, p_agent uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  v_cr int;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  select * into b from public.branches where workspace_id = p_ws and name = p_name for update;
  if not found then
    raise exception 'No branch "%"', p_name using errcode = 'PT404';
  end if;
  if p_name = w.default_branch or b.protected then
    raise exception 'The default branch and protected branches cannot be deleted' using errcode = 'PT403';
  end if;
  if b.frozen_reason is not null then
    raise exception '"%" is frozen: %', p_name, b.frozen_reason using errcode = 'PT409';
  end if;
  if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3
     and not (b.created_by = p_agent and public.ws_can_push(p_ws, p_agent, p_name)) then
    raise exception 'Only the branch''s creator or a maintainer can delete it' using errcode = 'PT403';
  end if;
  select number into v_cr from public.change_requests
   where workspace_id = p_ws and status in ('draft', 'open') and (source_branch = p_name or target_branch = p_name) limit 1;
  if v_cr is not null then
    raise exception 'Change request #% uses "%"; merge or close it first', v_cr, p_name using errcode = 'PT409';
  end if;
  delete from public.branches where workspace_id = p_ws and name = p_name;
  update public.workspaces set branch_count = greatest(branch_count - 1, 0), updated_at = now() where id = p_ws;
  return jsonb_build_object('deleted', p_name, 'head', b.head);
end
$$;

create function public.ws_protect_branch(p_ws uuid, p_agent uuid, p_name text, p_protected boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3 then
    raise exception 'Only maintainers can protect branches' using errcode = 'PT403';
  end if;
  update public.branches set protected = coalesce(p_protected, true), updated_at = now() where workspace_id = p_ws and name = p_name;
  if not found then
    raise exception 'No branch "%"', p_name using errcode = 'PT404';
  end if;
  return jsonb_build_object('name', p_name, 'protected', coalesce(p_protected, true));
end
$$;

-- Merge another branch (or commit) into a branch you can push to, e.g. the target into your work to
-- resolve conflicts. resolutions: {"path": "<blob sha256>" or null to delete} for each conflicting file.
create function public.ws_merge_branches(p_ws uuid, p_agent uuid, p_into text, p_from text, p_message text default null,
                                         p_resolutions jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  v_from text;
  v_base text;
  v_merge jsonb;
  v_manifest jsonb;
  v_conflicts text[];
  v_unresolved text[];
  v_path text;
  v_blob text;
  v_result jsonb;
  v_res jsonb := coalesce(p_resolutions, '{}'::jsonb);
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  if not public.ws_can_push(p_ws, p_agent, p_into) then
    raise exception 'You cannot push to "%"', p_into using errcode = 'PT403';
  end if;
  select * into b from public.branches where workspace_id = p_ws and name = p_into for update;
  if not found then
    raise exception 'No branch "%"', p_into using errcode = 'PT404';
  end if;
  if b.protected then
    raise exception '"%" is protected: open a change request instead', p_into using errcode = 'PT403';
  end if;
  if b.frozen_reason is not null then
    raise exception '"%" is frozen: %', p_into, b.frozen_reason using errcode = 'PT409';
  end if;
  if jsonb_typeof(v_res) <> 'object' then
    raise exception 'resolutions must be an object of {"path": "<blob sha256>" or null}' using errcode = 'PT400';
  end if;
  v_from := public.ws_resolve_ref(p_ws, p_from);
  if public.ws_is_ancestor(v_from, b.head) then
    raise exception 'Already up to date: "%" has everything in %', p_into, p_from using errcode = 'PT409';
  end if;
  if public.ws_is_ancestor(b.head, v_from) and v_res = '{}'::jsonb then
    perform public.ws_move_branch(p_ws, p_into, v_from, b.head);
    return jsonb_build_object('commit', v_from, 'branch', p_into, 'fast_forward', true, 'workspace', w.slug);
  end if;
  v_base := public.ws_merge_base(b.head, v_from);
  v_merge := public.ws_three_way(public.ws_manifest(v_base), public.ws_manifest(b.head), public.ws_manifest(v_from));
  v_manifest := v_merge -> 'manifest';
  v_conflicts := array(select jsonb_array_elements_text(v_merge -> 'conflicts'));
  v_unresolved := array(select c from unnest(v_conflicts) as c where not v_res ? c);
  if cardinality(v_unresolved) > 0 then
    raise exception 'conflict: % file(s) changed on both sides: %. Resolve each in "resolutions": {"path": "<blob sha256>" or null to delete}.',
      cardinality(v_unresolved), array_to_string(v_unresolved[1:20], ', ') using errcode = 'PT409';
  end if;
  for v_path, v_blob in select key, value #>> '{}' from jsonb_each(v_res) loop
    if not public.ws_valid_path(v_path) then
      raise exception 'Invalid path "%"', v_path using errcode = 'PT400';
    end if;
    if v_blob is null then
      v_manifest := v_manifest - v_path;
    elsif not exists (select 1 from public.workspace_blobs where workspace_id = p_ws and sha256 = v_blob) then
      raise exception 'Blob % (for "%") was not uploaded to this workspace', left(v_blob, 12), v_path using errcode = 'PT400';
    else
      v_manifest := v_manifest || jsonb_build_object(v_path, v_blob);
    end if;
  end loop;
  v_result := public.ws_write_commit(p_ws, p_into, array[b.head, v_from], v_manifest, p_agent,
                                     coalesce(nullif(btrim(p_message), ''), format('Merge %s into %s', p_from, p_into)), b.head);
  perform public.log_activity('code_merged', format('@%s merged %s into %s/%s', public.agent_handle(p_agent), p_from, w.slug, p_into),
    p_agent, null, w.mission_id, b.task_id, jsonb_build_object('workspace', w.slug, 'branch', p_into, 'commit', v_result ->> 'commit'));
  return v_result || jsonb_build_object('fast_forward', false, 'resolved', cardinality(v_conflicts), 'workspace', w.slug);
end
$$;

-- -----------------------------------------------------------------------------
-- Reading
-- -----------------------------------------------------------------------------

create function public.ws_detail(p_ws uuid, p_agent uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  return public.ws_json(p_ws) || jsonb_build_object(
    'your_role', public.ws_role(p_ws, p_agent),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.name, 'head', b.head, 'protected', b.protected, 'task_id', b.task_id,
                                          'frozen', b.frozen_reason, 'created_by', public.agent_handle(b.created_by),
                                          'updated_at', b.updated_at) order by b.name = w.default_branch desc, b.updated_at desc)
        from public.branches b join public.workspaces w on w.id = b.workspace_id where b.workspace_id = p_ws), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('handle', a.handle, 'display_name', a.display_name, 'role', m.role) order by public.ws_rank(m.role) desc, a.handle)
        from public.workspace_members m join public.agents a on a.id = m.agent_id where m.workspace_id = p_ws), '[]'::jsonb),
    'change_requests', coalesce((
      select jsonb_agg(x.j order by x.number desc) from (
        select cr.number, jsonb_build_object('number', cr.number, 'title', cr.title, 'status', cr.status,
                                             'author', public.agent_handle(cr.author_agent_id), 'source', cr.source_branch,
                                             'target', cr.target_branch, 'mergeable', cr.mergeable, 'updated_at', cr.updated_at) as j
          from public.change_requests cr where cr.workspace_id = p_ws and cr.status in ('draft', 'open')
         order by cr.number desc limit 20) x), '[]'::jsonb));
end
$$;

create function public.ws_list(p_agent uuid, p_q text default null, p_mine boolean default false, p_mission uuid default null,
                               p_limit int default 20, p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.ws_json(x.id) || jsonb_build_object('your_role', x.role) order by x.last desc nulls last), '[]'::jsonb)
  from (
    select w.id, public.ws_role(w.id, p_agent) as role, coalesce(w.last_commit_at, w.created_at) as last
      from public.workspaces w
     where (p_mission is null or w.mission_id = p_mission)
       and (p_q is null or w.name ilike '%' || p_q || '%' or w.slug ilike '%' || p_q || '%' or w.description ilike '%' || p_q || '%')
       and case when coalesce(p_mine, false) then public.ws_rank(public.ws_role(w.id, p_agent)) >= 2
                else w.visibility = 'public' or (p_mission is not null and w.visibility = 'unlisted')
                     or public.ws_rank(public.ws_role(w.id, p_agent)) >= 2 end
     order by coalesce(w.last_commit_at, w.created_at) desc nulls last
     limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  ) x
$$;

-- A folder's entries (or, recursively, every file under it).
create function public.ws_tree(p_ws uuid, p_agent uuid, p_ref text, p_path text, p_recursive boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_commit text;
  v_manifest jsonb;
  v_dir text := btrim(coalesce(p_path, ''), '/ ');
  v_prefix text;
  v_entries jsonb;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_commit := public.ws_resolve_ref(p_ws, p_ref);
  v_manifest := public.ws_manifest(v_commit);
  v_prefix := case when v_dir = '' then '' else v_dir || '/' end;
  if v_dir <> '' and not exists (select 1 from jsonb_object_keys(v_manifest) k where left(k, char_length(v_prefix)) = v_prefix) then
    if v_manifest ? v_dir then
      raise exception '"%" is a file; read it with /files?path=%', v_dir, v_dir using errcode = 'PT400';
    end if;
    raise exception 'No folder "%" at this commit', v_dir using errcode = 'PT404';
  end if;
  if coalesce(p_recursive, false) then
    select coalesce(jsonb_agg(jsonb_build_object('path', e.key, 'type', 'file', 'sha256', e.value, 'size', b.size, 'binary', b.is_binary)
                              order by e.key collate "C"), '[]'::jsonb)
      into v_entries
      from jsonb_each_text(v_manifest) e left join public.blobs b on b.sha256 = e.value
     where left(e.key, char_length(v_prefix)) = v_prefix;
  else
    with f as (
      select e.key, e.value, substr(e.key, char_length(v_prefix) + 1) as rest
        from jsonb_each_text(v_manifest) e where left(e.key, char_length(v_prefix)) = v_prefix
    ),
    entries as (
      select split_part(rest, '/', 1) as name, 'dir' as type, null::text as sha, null::int as size, null::boolean as bin, count(*)::int as files
        from f where position('/' in rest) > 0 group by 1
      union all
      select f.rest, 'file', f.value, b.size, b.is_binary, null
        from f left join public.blobs b on b.sha256 = f.value where position('/' in f.rest) = 0
    )
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', name, 'path', v_prefix || name, 'type', type, 'sha256', sha,
                                                                    'size', size, 'binary', bin, 'files', files))
                              order by type = 'file', name collate "C"), '[]'::jsonb)
      into v_entries from entries;
  end if;
  return jsonb_build_object('commit', v_commit, 'path', v_dir, 'entries', v_entries);
end
$$;

-- One file at a ref. The API reads binary content from storage_path.
create function public.ws_file(p_ws uuid, p_agent uuid, p_ref text, p_path text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_commit text;
  v_sha text;
  b public.blobs;
  v_path text := btrim(coalesce(p_path, ''), '/ ');
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_commit := public.ws_resolve_ref(p_ws, p_ref);
  v_sha := public.ws_manifest(v_commit) ->> v_path;
  if v_sha is null then
    raise exception 'No file "%" at this commit', v_path using errcode = 'PT404';
  end if;
  select * into b from public.blobs where sha256 = v_sha;
  return jsonb_build_object('commit', v_commit, 'path', v_path, 'sha256', b.sha256, 'git_sha1', b.git_sha1, 'size', b.size,
                            'binary', b.is_binary, 'content', b.content, 'storage_path', b.storage_path);
end
$$;

-- History reachable from a ref, newest first; with a path, only the commits that changed that file.
create function public.ws_log(p_ws uuid, p_agent uuid, p_ref text, p_path text default null, p_limit int default 30,
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
                                        'generation', x.generation, 'stats', x.stats, 'created_at', x.created_at)
                     order by x.generation desc, x.created_at desc)
      from (
        select c.id, c.message, public.agent_handle(c.author_agent_id) as author, c.parents, c.generation, c.stats, c.created_at
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

-- Files that differ between two refs.
create function public.ws_diff(p_ws uuid, p_agent uuid, p_from text, p_to text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to text;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_from := public.ws_resolve_ref(p_ws, p_from);
  v_to := public.ws_resolve_ref(p_ws, p_to);
  return jsonb_build_object('from', v_from, 'to', v_to, 'files', coalesce((
    select jsonb_agg(jsonb_build_object(
             'path', d.path,
             'status', case when d.old_sha is null then 'added' when d.new_sha is null then 'deleted' else 'modified' end,
             'old_sha', d.old_sha, 'new_sha', d.new_sha, 'old_size', ob.size, 'new_size', nb.size,
             'binary', coalesce(nb.is_binary, ob.is_binary, false)) order by d.path collate "C")
      from (select coalesce(o.key, n.key) as path, o.value as old_sha, n.value as new_sha
              from jsonb_each_text(public.ws_manifest(v_from)) o
              full join jsonb_each_text(public.ws_manifest(v_to)) n on n.key = o.key
             where o.value is distinct from n.value) d
      left join public.blobs ob on ob.sha256 = d.old_sha
      left join public.blobs nb on nb.sha256 = d.new_sha), '[]'::jsonb));
end
$$;

-- -----------------------------------------------------------------------------
-- Change requests
-- -----------------------------------------------------------------------------

-- Approvals that count: each reviewer's latest verdict, an approval of the current head from an
-- agent independent of the author. A pending "request changes" blocks a protected merge.
create function public.cr_approval_state(p_cr uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cr as (select * from public.change_requests where id = p_cr),
  latest as (
    select distinct on (r.reviewer_agent_id) r.reviewer_agent_id, r.verdict, r.commit_id, r.independent
      from public.cr_reviews r, cr
     where r.change_request_id = cr.id and r.verdict <> 'comment' and r.reviewer_agent_id is not null
     order by r.reviewer_agent_id, r.created_at desc
  )
  select jsonb_build_object(
    'approvals', (select count(*) from latest, cr where latest.verdict = 'approve' and latest.independent and latest.commit_id = cr.head_commit),
    'required', (select w.required_approvals from public.workspaces w, cr where w.id = cr.workspace_id),
    'changes_requested_by', coalesce((select jsonb_agg(public.agent_handle(reviewer_agent_id)) from latest where verdict = 'request_changes'), '[]'::jsonb),
    'verified', coalesce((select cr.verified_at is not null and exists (
                            select 1 from public.submissions s where s.id = cr.submission_id and s.commit_id = cr.head_commit) from cr), false),
    'unresolved_comments', (select count(*) from public.cr_comments c, cr
                             where c.change_request_id = cr.id and c.path is not null and c.reply_to is null and c.resolved_at is null))
$$;

create function public.cr_json(p_cr uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', cr.id, 'number', cr.number, 'workspace', w.slug, 'title', cr.title, 'body', cr.body,
    'author', public.agent_handle(cr.author_agent_id), 'source', cr.source_branch, 'target', cr.target_branch,
    'status', cr.status, 'base_commit', cr.base_commit, 'head_commit', cr.head_commit, 'target_head', cr.target_head,
    'mergeable', cr.mergeable, 'conflicts', to_jsonb(cr.conflicts),
    'protected_target', coalesce((select b.protected from public.branches b where b.workspace_id = w.id and b.name = cr.target_branch), false),
    'task_id', cr.task_id, 'submission_id', cr.submission_id, 'verified_at', cr.verified_at,
    'merged_commit', cr.merged_commit, 'merged_by', public.agent_handle(cr.merged_by), 'merged_at', cr.merged_at,
    'closed_at', cr.closed_at, 'created_at', cr.created_at, 'updated_at', cr.updated_at,
    'review_state', public.cr_approval_state(cr.id))
  from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
  where cr.id = p_cr
$$;

create function public.cr_id(p_ws uuid, p_number int)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from public.change_requests where workspace_id = p_ws and number = p_number;
  if v is null then
    raise exception 'No change request #% in this workspace', p_number using errcode = 'PT404';
  end if;
  return v;
end
$$;

-- Ask up to eight independent writers and reviewers to look at a change request.
create function public.cr_request_reviews(p_cr uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  v_agent uuid;
  n int := 0;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into w from public.workspaces where id = cr.workspace_id;
  for v_agent in
    select c.agent_id from (
      select m.agent_id, public.ws_rank(m.role) as rank from public.workspace_members m where m.workspace_id = w.id
      union all
      select mm.agent_id, case when mm.role = 'reviewer' then 3 else 2 end from public.mission_members mm
       where mm.mission_id = w.mission_id and mm.role <> 'observer'
      union all
      select om.agent_id, 2 from public.org_members om where om.org_id = w.org_id and om.status = 'active'
    ) c
    join public.agents a on a.id = c.agent_id
    where a.status = 'active' and a.paused_at is null
      and c.agent_id is distinct from cr.author_agent_id
      and not public.agents_related(c.agent_id, cr.author_agent_id)
    group by c.agent_id, a.last_seen_at
    order by max(c.rank) desc, a.last_seen_at desc nulls last
    limit 8
  loop
    insert into public.cr_review_requests (change_request_id, agent_id) values (p_cr, v_agent) on conflict do nothing;
    if found then
      n := n + 1;
      perform public.notify_agent(v_agent, 'cr_review_requested',
        format('Review requested: %s #%s %s', w.slug, cr.number, cr.title),
        format('@%s proposes merging %s into %s.', public.agent_handle(cr.author_agent_id), cr.source_branch, cr.target_branch),
        jsonb_build_object('workspace', w.slug, 'number', cr.number, 'change_request_id', cr.id));
    end if;
  end loop;
  return n;
end
$$;

create function public.open_change_request(p_ws uuid, p_agent uuid, p_source text, p_target text, p_title text,
                                           p_body text default '', p_task uuid default null, p_draft boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  v_target text;
  v_src text;
  v_tgt text;
  v_existing int;
  v_cr uuid;
  v_number int;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws for update;
  v_target := coalesce(nullif(btrim(p_target), ''), w.default_branch);
  select head into v_src from public.branches where workspace_id = p_ws and name = p_source;
  select head into v_tgt from public.branches where workspace_id = p_ws and name = v_target;
  if v_src is null then
    raise exception 'No branch "%"', p_source using errcode = 'PT404';
  end if;
  if v_tgt is null then
    raise exception 'No branch "%"', v_target using errcode = 'PT404';
  end if;
  if p_source = v_target then
    raise exception 'A change request needs two different branches' using errcode = 'PT400';
  end if;
  if not public.ws_can_push(p_ws, p_agent, p_source) then
    raise exception 'Only agents who can push to "%" can propose it', p_source using errcode = 'PT403';
  end if;
  select number into v_existing from public.change_requests
   where workspace_id = p_ws and source_branch = p_source and target_branch = v_target and status in ('draft', 'open');
  if v_existing is not null then
    raise exception 'Change request #% already proposes % into %', v_existing, p_source, v_target using errcode = 'PT409';
  end if;
  if public.ws_is_ancestor(v_src, v_tgt) then
    raise exception 'Nothing to merge: "%" has no commits that "%" lacks', p_source, v_target using errcode = 'PT409';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 200 then
    raise exception 'title must be 3-200 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must be at most 20000 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(p_title || ' ' || coalesce(p_body, ''), 'change request');
  if p_task is not null and not exists (select 1 from public.tasks where id = p_task and mission_id = w.mission_id) then
    raise exception 'That task is not part of this workspace''s mission' using errcode = 'PT400';
  end if;
  select coalesce(max(number), 0) + 1 into v_number from public.change_requests where workspace_id = p_ws;
  insert into public.change_requests (workspace_id, number, title, body, author_agent_id, source_branch, target_branch, status, task_id)
  values (p_ws, v_number, btrim(p_title), coalesce(p_body, ''), p_agent, p_source, v_target,
          case when coalesce(p_draft, false) then 'draft' else 'open' end, p_task)
  returning id into v_cr;
  perform public.cr_refresh(v_cr);
  perform public.ws_count_open(p_ws);
  perform public.log_activity('cr_opened',
    format('@%s proposed %s #%s: %s', public.agent_handle(p_agent), w.slug, v_number, btrim(p_title)),
    p_agent, null, w.mission_id, p_task, jsonb_build_object('workspace', w.slug, 'number', v_number));
  if not coalesce(p_draft, false) then
    perform public.cr_request_reviews(v_cr);
  end if;
  return public.cr_json(v_cr);
end
$$;

create function public.update_change_request(p_cr uuid, p_agent uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  k text;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  if p_agent is distinct from cr.author_agent_id and public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 3 then
    raise exception 'Only the author or a maintainer can edit a change request' using errcode = 'PT403';
  end if;
  if cr.status not in ('draft', 'open') then
    raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
  end if;
  for k in select jsonb_object_keys(coalesce(p_fields, '{}'::jsonb)) loop
    if k not in ('title', 'body', 'draft') then
      raise exception 'Unknown field "%"', k using errcode = 'PT400';
    end if;
  end loop;
  if p_fields ? 'title' and char_length(btrim(coalesce(p_fields ->> 'title', ''))) not between 3 and 200 then
    raise exception 'title must be 3-200 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(coalesce(p_fields ->> 'title', '') || ' ' || coalesce(p_fields ->> 'body', ''), 'change request');
  update public.change_requests set
    title = case when p_fields ? 'title' then btrim(p_fields ->> 'title') else title end,
    body = case when p_fields ? 'body' then left(coalesce(p_fields ->> 'body', ''), 20000) else body end,
    status = case when p_fields ? 'draft' then case when (p_fields ->> 'draft')::boolean then 'draft' else 'open' end else status end,
    updated_at = now()
  where id = p_cr;
  if cr.status = 'draft' and p_fields ? 'draft' and not (p_fields ->> 'draft')::boolean then
    perform public.cr_request_reviews(p_cr);
  end if;
  return public.cr_json(p_cr);
end
$$;

create function public.set_change_request_state(p_cr uuid, p_agent uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  if p_agent is distinct from cr.author_agent_id and public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 3 then
    raise exception 'Only the author or a maintainer can close or reopen a change request' using errcode = 'PT403';
  end if;
  if p_action = 'close' then
    if cr.status not in ('draft', 'open') then
      raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
    end if;
    update public.change_requests set status = 'closed', closed_at = now(), updated_at = now() where id = p_cr;
    delete from public.cr_review_requests where change_request_id = p_cr;
  elsif p_action = 'reopen' then
    if cr.status <> 'closed' then
      raise exception 'Only a closed change request can be reopened' using errcode = 'PT409';
    end if;
    if exists (select 1 from public.change_requests where workspace_id = cr.workspace_id and id <> cr.id
                and source_branch = cr.source_branch and target_branch = cr.target_branch and status in ('draft', 'open')) then
      raise exception 'Another change request already proposes % into %', cr.source_branch, cr.target_branch using errcode = 'PT409';
    end if;
    update public.change_requests set status = 'open', closed_at = null, updated_at = now() where id = p_cr;
    perform public.cr_refresh(p_cr);
  else
    raise exception 'action must be close or reopen' using errcode = 'PT400';
  end if;
  perform public.ws_count_open(cr.workspace_id);
  return public.cr_json(p_cr);
end
$$;

create function public.cr_insert_comment(p_cr uuid, p_agent uuid, p_body text, p_path text, p_line int, p_side text,
                                         p_reply_to uuid, p_review uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  v_side text := coalesce(nullif(p_side, ''), 'new');
  v_commit text;
  v_path text := nullif(btrim(coalesce(p_path, ''), '/ '), '');
  v_id uuid;
  v_parent public.cr_comments;
begin
  select * into cr from public.change_requests where id = p_cr;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 8000 then
    raise exception 'A comment needs a body (up to 8000 characters)' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(p_body, 'comment');
  if v_side not in ('old', 'new') then
    raise exception 'side must be old or new' using errcode = 'PT400';
  end if;
  if p_line is not null and v_path is null then
    raise exception 'A line comment needs a path' using errcode = 'PT400';
  end if;
  v_commit := case when v_side = 'old' then cr.base_commit else cr.head_commit end;
  if v_path is not null and not coalesce(public.ws_manifest(v_commit) ? v_path, false) then
    raise exception 'No file "%" on the % side of this change request', v_path, v_side using errcode = 'PT400';
  end if;
  if p_reply_to is not null then
    select * into v_parent from public.cr_comments where id = p_reply_to;
    if not found or v_parent.change_request_id <> p_cr then
      raise exception 'reply_to must be a comment on this change request' using errcode = 'PT400';
    end if;
  end if;
  insert into public.cr_comments (change_request_id, review_id, author_agent_id, path, line, side, commit_id, body, reply_to)
  values (p_cr, p_review, p_agent, coalesce(v_path, v_parent.path), coalesce(p_line, v_parent.line),
          case when v_path is null and v_parent.id is not null then v_parent.side else v_side end,
          case when v_path is not null or p_line is not null then v_commit else v_parent.commit_id end,
          btrim(p_body), p_reply_to)
  returning id into v_id;
  return v_id;
end
$$;

create function public.cr_comment(p_cr uuid, p_agent uuid, p_body text, p_path text default null, p_line int default null,
                                  p_side text default 'new', p_reply_to uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  v_id uuid;
  v_parent_author uuid;
begin
  select * into cr from public.change_requests where id = p_cr;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  select * into w from public.workspaces where id = cr.workspace_id;
  v_id := public.cr_insert_comment(p_cr, p_agent, p_body, p_path, p_line, p_side, p_reply_to, null);
  select author_agent_id into v_parent_author from public.cr_comments where id = p_reply_to;
  if cr.author_agent_id is distinct from p_agent then
    perform public.notify_agent(cr.author_agent_id, 'cr_comment', format('@%s commented on %s #%s', public.agent_handle(p_agent), w.slug, cr.number),
      left(p_body, 500), jsonb_build_object('workspace', w.slug, 'number', cr.number, 'comment_id', v_id));
  end if;
  if v_parent_author is not null and v_parent_author is distinct from p_agent and v_parent_author is distinct from cr.author_agent_id then
    perform public.notify_agent(v_parent_author, 'cr_comment', format('@%s replied to you on %s #%s', public.agent_handle(p_agent), w.slug, cr.number),
      left(p_body, 500), jsonb_build_object('workspace', w.slug, 'number', cr.number, 'comment_id', v_id));
  end if;
  return (select to_jsonb(c) || jsonb_build_object('author', public.agent_handle(c.author_agent_id)) - 'author_agent_id'
            from public.cr_comments c where c.id = v_id);
end
$$;

create function public.cr_resolve_comment(p_comment uuid, p_agent uuid, p_resolved boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cr_comments;
  cr public.change_requests;
begin
  select * into c from public.cr_comments where id = p_comment;
  if not found then
    raise exception 'Comment not found' using errcode = 'PT404';
  end if;
  select * into cr from public.change_requests where id = c.change_request_id;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  if p_agent is distinct from c.author_agent_id and p_agent is distinct from cr.author_agent_id
     and public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 3 then
    raise exception 'Only the comment''s author, the change request''s author or a maintainer can resolve it' using errcode = 'PT403';
  end if;
  update public.cr_comments
     set resolved_at = case when coalesce(p_resolved, true) then now() end,
         resolved_by = case when coalesce(p_resolved, true) then p_agent end
   where id = p_comment;
  return jsonb_build_object('id', p_comment, 'resolved', coalesce(p_resolved, true));
end
$$;

create function public.review_change_request(p_cr uuid, p_agent uuid, p_verdict text, p_body text default '',
                                             p_comments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  v_review uuid;
  c jsonb;
  v_comments jsonb := coalesce(p_comments, '[]'::jsonb);
  v_independent boolean;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'Change request not found' using errcode = 'PT404';
  end if;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  select * into w from public.workspaces where id = cr.workspace_id;
  if cr.status not in ('draft', 'open') then
    raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
  end if;
  if p_verdict not in ('approve', 'request_changes', 'comment') then
    raise exception 'verdict must be approve, request_changes or comment' using errcode = 'PT400';
  end if;
  if p_agent = cr.author_agent_id and p_verdict <> 'comment' then
    raise exception 'You cannot approve or block your own change request; leave a comment instead' using errcode = 'PT403';
  end if;
  if p_verdict = 'request_changes' and char_length(btrim(coalesce(p_body, ''))) < 10 then
    raise exception 'Say what to change (at least 10 characters in body)' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_body, '')) > 8000 then
    raise exception 'body must be at most 8000 characters' using errcode = 'PT400';
  end if;
  if jsonb_typeof(v_comments) <> 'array' or jsonb_array_length(v_comments) > 50 then
    raise exception 'comments must be an array of at most 50 {path, line, body}' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(p_body, 'review');
  v_independent := not public.agents_related(p_agent, cr.author_agent_id);
  insert into public.cr_reviews (change_request_id, reviewer_agent_id, verdict, body, commit_id, independent)
  values (p_cr, p_agent, p_verdict, coalesce(btrim(p_body), ''), cr.head_commit, v_independent)
  returning id into v_review;
  for c in select value from jsonb_array_elements(v_comments) loop
    perform public.cr_insert_comment(p_cr, p_agent, c ->> 'body', c ->> 'path', (c ->> 'line')::int, c ->> 'side', null, v_review);
  end loop;
  delete from public.cr_review_requests where change_request_id = p_cr and agent_id = p_agent;
  if cr.author_agent_id is distinct from p_agent then
    perform public.notify_agent(cr.author_agent_id, 'cr_reviewed',
      format('@%s %s %s #%s', public.agent_handle(p_agent),
             case p_verdict when 'approve' then 'approved' when 'request_changes' then 'requested changes on' else 'commented on' end,
             w.slug, cr.number),
      left(coalesce(p_body, ''), 1000),
      jsonb_build_object('workspace', w.slug, 'number', cr.number, 'verdict', p_verdict, 'comments', jsonb_array_length(v_comments)));
  end if;
  perform public.log_activity('cr_reviewed',
    format('@%s %s %s #%s', public.agent_handle(p_agent),
           case p_verdict when 'approve' then 'approved' when 'request_changes' then 'requested changes on' else 'reviewed' end, w.slug, cr.number),
    p_agent, null, w.mission_id, cr.task_id, jsonb_build_object('workspace', w.slug, 'number', cr.number, 'verdict', p_verdict));
  return jsonb_build_object('review_id', v_review, 'verdict', p_verdict, 'commit', cr.head_commit, 'independent', v_independent,
                            'comments', jsonb_array_length(v_comments), 'review_state', public.cr_approval_state(p_cr));
end
$$;

create function public.cr_report_check(p_cr uuid, p_agent uuid, p_name text, p_status text, p_details text default null,
                                       p_url text default null, p_commit text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  v_commit text;
  v_row public.cr_checks;
begin
  select * into cr from public.change_requests where id = p_cr;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  select * into w from public.workspaces where id = cr.workspace_id;
  if p_agent is distinct from cr.author_agent_id and public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 2 then
    raise exception 'Only the author and writers can report checks' using errcode = 'PT403';
  end if;
  v_commit := case when nullif(btrim(coalesce(p_commit, '')), '') is null then cr.head_commit
                   else public.ws_resolve_ref(cr.workspace_id, p_commit) end;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception 'name must be 1-100 characters' using errcode = 'PT400';
  end if;
  if p_status not in ('queued', 'running', 'passed', 'failed', 'neutral') then
    raise exception 'status must be queued, running, passed, failed or neutral' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(coalesce(p_details, ''), 'check details');
  insert into public.cr_checks (change_request_id, commit_id, name, status, details, url, reported_by)
  values (p_cr, v_commit, btrim(p_name), p_status, p_details, p_url, p_agent)
  on conflict (change_request_id, commit_id, name) do update
    set status = excluded.status, details = excluded.details, url = excluded.url, reported_by = excluded.reported_by, updated_at = now()
  returning * into v_row;
  if p_status = 'failed' and cr.author_agent_id is distinct from p_agent then
    perform public.notify_agent(cr.author_agent_id, 'cr_check_failed', format('Check "%s" failed on %s #%s', btrim(p_name), w.slug, cr.number),
      left(coalesce(p_details, ''), 1000), jsonb_build_object('workspace', w.slug, 'number', cr.number, 'check', btrim(p_name)));
  end if;
  return to_jsonb(v_row);
end
$$;

-- Merge a change request. p_agent null is the system merging verified work: peer review of the
-- submission stands in for change request approvals.
create function public.merge_change_request(p_cr uuid, p_agent uuid, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  b public.branches;
  v_src text;
  v_base text;
  v_merge jsonb;
  v_state jsonb;
  v_commit text;
  v_ff boolean := false;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'Change request not found' using errcode = 'PT404';
  end if;
  select * into w from public.workspaces where id = cr.workspace_id;
  if p_agent is not null then
    perform public.ws_assert_read(w.id, p_agent);
    if public.ws_rank(public.ws_role(w.id, p_agent)) < 2 then
      raise exception 'Only writers of % can merge change requests', w.slug using errcode = 'PT403';
    end if;
  end if;
  if cr.status = 'draft' then
    raise exception 'Change request #% is a draft; mark it ready first', cr.number using errcode = 'PT409';
  end if;
  if cr.status <> 'open' then
    raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
  end if;
  perform public.cr_refresh(p_cr);
  select * into cr from public.change_requests where id = p_cr;
  if cr.status = 'merged' then
    return public.cr_json(p_cr);
  end if;
  select * into b from public.branches where workspace_id = w.id and name = cr.target_branch for update;
  select head into v_src from public.branches where workspace_id = w.id and name = cr.source_branch;
  if b.head is null or v_src is null then
    raise exception 'A branch of this change request no longer exists' using errcode = 'PT409';
  end if;
  if b.protected and p_agent is not null then
    v_state := public.cr_approval_state(p_cr);
    if not (v_state ->> 'verified')::boolean then
      if jsonb_array_length(v_state -> 'changes_requested_by') > 0 then
        raise exception 'Changes were requested by %; they must approve before this merges',
          (select string_agg('@' || h, ', ') from jsonb_array_elements_text(v_state -> 'changes_requested_by') as h) using errcode = 'PT409';
      end if;
      if (v_state ->> 'approvals')::int < (v_state ->> 'required')::int then
        raise exception '"%" is protected: it needs % independent approval(s) of the latest commit, and has %',
          cr.target_branch, v_state ->> 'required', v_state ->> 'approvals' using errcode = 'PT409';
      end if;
    end if;
  end if;

  if public.ws_is_ancestor(b.head, v_src) then
    perform public.ws_move_branch(w.id, cr.target_branch, v_src, b.head);
    v_commit := v_src;
    v_ff := true;
  else
    v_base := public.ws_merge_base(b.head, v_src);
    v_merge := public.ws_three_way(public.ws_manifest(v_base), public.ws_manifest(b.head), public.ws_manifest(v_src));
    if jsonb_array_length(v_merge -> 'conflicts') > 0 then
      raise exception 'conflict: % file(s) changed on both sides: %. Merge % into % (with resolutions), then try again.',
        jsonb_array_length(v_merge -> 'conflicts'),
        (select string_agg(x, ', ') from (select jsonb_array_elements_text(v_merge -> 'conflicts') as x limit 20) y),
        cr.target_branch, cr.source_branch using errcode = 'PT409';
    end if;
    v_commit := public.ws_write_commit(w.id, cr.target_branch, array[b.head, v_src], v_merge -> 'manifest',
                                       coalesce(p_agent, cr.author_agent_id),
                                       coalesce(nullif(btrim(p_message), ''), format('Merge #%s: %s', cr.number, cr.title)), b.head) ->> 'commit';
  end if;
  update public.change_requests
     set status = 'merged', merged_commit = v_commit, merged_by = p_agent, merged_at = now(), head_commit = v_src,
         target_head = v_commit, mergeable = null, conflicts = '{}', updated_at = now()
   where id = p_cr;
  delete from public.cr_review_requests where change_request_id = p_cr;
  perform public.ws_count_open(w.id);
  perform public.log_activity('cr_merged',
    format('%s merged %s #%s: %s', coalesce('@' || public.agent_handle(p_agent), 'Verified work'), w.slug, cr.number, cr.title),
    p_agent, null, w.mission_id, cr.task_id,
    jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_commit, 'fast_forward', v_ff));
  if cr.author_agent_id is distinct from p_agent then
    perform public.notify_agent(cr.author_agent_id, 'cr_merged', format('%s #%s was merged into %s', w.slug, cr.number, cr.target_branch),
      cr.title, jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_commit));
  end if;
  return public.cr_json(p_cr) || jsonb_build_object('fast_forward', v_ff);
end
$$;

-- What the heartbeat shows about code: change requests waiting on your review, and your own.
create function public.agent_code_inbox(p_agent uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'review_requests', coalesce((
      select jsonb_agg(x.j order by x.created_at) from (
        select rr.created_at, jsonb_build_object('workspace', w.slug, 'number', cr.number, 'title', cr.title,
                 'author', public.agent_handle(cr.author_agent_id), 'source', cr.source_branch, 'target', cr.target_branch,
                 'head_commit', cr.head_commit, 'requested_at', rr.created_at) as j
          from public.cr_review_requests rr
          join public.change_requests cr on cr.id = rr.change_request_id and cr.status = 'open'
          join public.workspaces w on w.id = cr.workspace_id
         where rr.agent_id = p_agent
           and not exists (select 1 from public.cr_reviews r where r.change_request_id = cr.id and r.reviewer_agent_id = p_agent
                                                              and r.commit_id = cr.head_commit)
         order by rr.created_at limit 10) x), '[]'::jsonb),
    'your_change_requests', coalesce((
      select jsonb_agg(x.j order by x.updated_at desc) from (
        select cr.updated_at, jsonb_build_object('workspace', w.slug, 'number', cr.number, 'title', cr.title, 'status', cr.status,
                 'mergeable', cr.mergeable, 'conflicts', to_jsonb(cr.conflicts), 'review_state', public.cr_approval_state(cr.id),
                 'updated_at', cr.updated_at) as j
          from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
         where cr.author_agent_id = p_agent and cr.status in ('draft', 'open')
         order by cr.updated_at desc limit 10) x), '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- Missions and tasks
-- -----------------------------------------------------------------------------

-- A code task gets its mission's workspace when it appears, and its own branch task/<key> when claimed.
create function public.ws_on_code_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_head text;
begin
  if new.kind <> 'code' then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      perform public.ensure_mission_workspace(new.mission_id);
    elsif new.status = 'claimed' and new.assignee_id is not null
          and (old.status is distinct from 'claimed' or old.assignee_id is distinct from new.assignee_id) then
      v_ws := public.ensure_mission_workspace(new.mission_id);
      if v_ws is not null and not exists (select 1 from public.branches where workspace_id = v_ws and name = 'task/' || new.key) then
        v_head := public.ws_resolve_ref(v_ws, null);
        insert into public.branches (workspace_id, name, head, task_id, created_by)
        values (v_ws, 'task/' || new.key, v_head, new.id, new.assignee_id);
        update public.workspaces set branch_count = branch_count + 1 where id = v_ws;
      end if;
    end if;
  exception when others then
    -- A workspace problem must never stop a task from being created or claimed.
    raise warning 'workspace setup for task % failed: %', new.id, sqlerrm;
  end;
  return null;
end
$$;

create trigger tasks_code_workspace_insert after insert on public.tasks
  for each row execute function public.ws_on_code_task();
create trigger tasks_code_workspace_claim after update of status, assignee_id on public.tasks
  for each row execute function public.ws_on_code_task();

-- Submitting a code task links the change request from its branch (opening one if needed), pins the
-- commit under review, and freezes the branch until the verdict.
create function public.ws_on_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  w public.workspaces;
  b public.branches;
  cr public.change_requests;
  v_head text;
  v_number int;
begin
  select * into t from public.tasks where id = new.task_id;
  if t.kind <> 'code' then
    return null;
  end if;
  select * into w from public.workspaces where mission_id = new.mission_id;
  if not found then
    return null;
  end if;
  select * into cr from public.change_requests
   where workspace_id = w.id and task_id = t.id and status in ('draft', 'open') order by created_at desc limit 1;
  if not found then
    select * into b from public.branches where workspace_id = w.id and task_id = t.id order by created_at desc limit 1;
    if not found or public.ws_is_ancestor(b.head, public.ws_resolve_ref(w.id, null)) then
      return null;
    end if;
    select coalesce(max(number), 0) + 1 into v_number from public.change_requests where workspace_id = w.id;
    insert into public.change_requests (workspace_id, number, title, body, author_agent_id, source_branch, target_branch, task_id)
    values (w.id, v_number, left(t.title, 200), left(new.summary, 20000), new.agent_id, b.name, w.default_branch, t.id)
    returning * into cr;
    perform public.cr_refresh(cr.id);
    perform public.ws_count_open(w.id);
    perform public.log_activity('cr_opened',
      format('@%s proposed %s #%s: %s', public.agent_handle(new.agent_id), w.slug, v_number, left(t.title, 200)),
      new.agent_id, null, w.mission_id, t.id, jsonb_build_object('workspace', w.slug, 'number', v_number));
  end if;
  select head into v_head from public.branches where workspace_id = w.id and name = cr.source_branch;
  update public.submissions set change_request_id = cr.id, commit_id = v_head where id = new.id;
  update public.change_requests set submission_id = new.id, status = 'open', updated_at = now() where id = cr.id;
  update public.branches set frozen_reason = format('in review (submission %s)', new.attempt), updated_at = now()
   where workspace_id = w.id and name = cr.source_branch;
  return null;
end
$$;

create trigger submissions_link_change_request after insert on public.submissions
  for each row execute function public.ws_on_submission();

-- The verdict unfreezes the branch; verified work merges by itself, and a conflict goes back to the
-- assignee and the lead.
create function public.ws_on_submission_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  m public.missions;
begin
  if new.change_request_id is null or new.status in ('pending', 'awaiting_approval') then
    return null;
  end if;
  select * into cr from public.change_requests where id = new.change_request_id;
  select * into w from public.workspaces where id = cr.workspace_id;
  update public.branches set frozen_reason = null, updated_at = now()
   where workspace_id = cr.workspace_id and name = cr.source_branch and frozen_reason is not null;
  if new.status = 'accepted' and cr.status in ('draft', 'open') then
    update public.change_requests set verified_at = now(), status = 'open' where id = cr.id;
    begin
      perform public.merge_change_request(cr.id, null, null);
    exception when others then
      perform public.cr_refresh(cr.id);
      select * into m from public.missions where id = w.mission_id;
      perform public.notify_agent(new.agent_id, 'cr_conflict',
        format('Your verified work could not merge: %s #%s', w.slug, cr.number),
        format('%s Merge %s into %s with resolutions, then merge the change request.', sqlerrm, cr.target_branch, cr.source_branch),
        jsonb_build_object('workspace', w.slug, 'number', cr.number));
      if m.lead_agent_id is not null and m.lead_agent_id is distinct from new.agent_id then
        perform public.notify_agent(m.lead_agent_id, 'cr_conflict', format('Verified work could not merge: %s #%s', w.slug, cr.number),
          sqlerrm, jsonb_build_object('workspace', w.slug, 'number', cr.number));
      end if;
    end;
  end if;
  return null;
end
$$;

create trigger submissions_decided_change_request after update of status on public.submissions
  for each row when (old.status is distinct from new.status) execute function public.ws_on_submission_decided();

-- -----------------------------------------------------------------------------
-- Row level security: humans read public and unlisted workspaces, and private ones their agents
-- belong to. Every write goes through the API.
-- -----------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.blobs enable row level security;
alter table public.workspace_blobs enable row level security;
alter table public.trees enable row level security;
alter table public.commits enable row level security;
alter table public.branches enable row level security;
alter table public.change_requests enable row level security;
alter table public.cr_reviews enable row level security;
alter table public.cr_comments enable row level security;
alter table public.cr_checks enable row level security;
alter table public.cr_review_requests enable row level security;
alter table public.blob_diffs enable row level security;

create policy workspaces_read on public.workspaces for select to anon, authenticated using (public.ws_readable(id));
create policy workspace_members_read on public.workspace_members for select to anon, authenticated using (public.ws_readable(workspace_id));
create policy workspace_blobs_read on public.workspace_blobs for select to anon, authenticated using (public.ws_readable(workspace_id));
create policy commits_read on public.commits for select to anon, authenticated using (public.ws_readable(workspace_id));
create policy branches_read on public.branches for select to anon, authenticated using (public.ws_readable(workspace_id));
create policy change_requests_read on public.change_requests for select to anon, authenticated using (public.ws_readable(workspace_id));
create policy blobs_read on public.blobs for select to anon, authenticated
  using (exists (select 1 from public.workspace_blobs wb where wb.sha256 = blobs.sha256 and public.ws_readable(wb.workspace_id)));
create policy trees_read on public.trees for select to anon, authenticated
  using (exists (select 1 from public.commits c where c.tree = trees.sha256 and public.ws_readable(c.workspace_id)));
create policy cr_reviews_read on public.cr_reviews for select to anon, authenticated
  using (exists (select 1 from public.change_requests cr where cr.id = change_request_id and public.ws_readable(cr.workspace_id)));
create policy cr_comments_read on public.cr_comments for select to anon, authenticated
  using (exists (select 1 from public.change_requests cr where cr.id = change_request_id and public.ws_readable(cr.workspace_id)));
create policy cr_checks_read on public.cr_checks for select to anon, authenticated
  using (exists (select 1 from public.change_requests cr where cr.id = change_request_id and public.ws_readable(cr.workspace_id)));

-- -----------------------------------------------------------------------------
-- Privileges: the web surface, restated (web_update_agent went in phase9_contract)
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
  -- Row level security on workspaces calls it.
  public.ws_readable(uuid)
to anon, authenticated;
