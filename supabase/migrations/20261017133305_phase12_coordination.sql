-- Phase 12.3: code at scale. Coordination.
--
-- Branch rules: per branch, the approvals a change needs, the checks that must pass on it, whether
-- code owners must approve, the merge methods allowed, how many files one change request may touch,
-- and whether changes land through a merge queue.
--
-- Code owners come from a CODEOWNERS file on the target branch (.github/CODEOWNERS, CODEOWNERS or
-- docs/CODEOWNERS; gitignore-style patterns, the last matching line wins; owners are @handle or
-- @org/<slug>). They are asked to review first, and on a branch that requires it each owned group of
-- files needs an approval from one of its owners.
--
-- The merge queue lands change requests one at a time, in the order they became ready. Each is built
-- on top of the ones ahead of it (a test commit, on queue/<target>/<number> when checks must run), so
-- checks run on exactly what will land, for several entries at once; once its checks pass and
-- everything ahead of it landed, the target fast-forwards to it. A failure takes an entry out and the
-- ones behind it are rebuilt.
--
-- Path claims say who is working where: an agent claims files or folders (globs) for a while; others
-- see it, and commits and change requests touching someone else's claim say so. Advisory only.
--
-- Stacked change requests: one aimed at another's branch is moved onto that one's target when it
-- lands, and after a squash or rebase merge its own commits are replayed there.

-- -----------------------------------------------------------------------------
-- I. Tables
-- -----------------------------------------------------------------------------

alter table public.branches
  add column required_approvals int check (required_approvals between 0 and 5),
  add column required_checks text[] not null default '{}',
  add column require_owner_review boolean not null default false,
  add column merge_queue boolean not null default false,
  add column queue_depth int not null default 3 check (queue_depth between 1 and 10),
  add column merge_methods text[] not null default '{merge,squash,rebase}',
  add column max_change_files int check (max_change_files is null or max_change_files >= 1),
  add constraint branches_merge_methods_check
    check (merge_methods <@ array['merge', 'squash', 'rebase'] and cardinality(merge_methods) >= 1),
  add constraint branches_required_checks_check check (cardinality(required_checks) <= 20);

-- CODEOWNERS files, compiled once per version: [{re, owners: ["handle" | "org/slug"], line, pattern}].
create table public.codeowners_rules (
  blob_sha   text primary key,
  rules      jsonb not null,
  errors     jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.change_requests
  add column owner_groups jsonb not null default '[]',
  add column claim_overlaps jsonb not null default '[]',
  add column restack_from text;

create table public.merge_queue (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  target_branch     text not null,
  change_request_id uuid not null references public.change_requests (id) on delete cascade,
  method            text not null default 'merge' check (method in ('merge', 'squash', 'rebase')),
  -- waiting: requirements unmet (reason); queued: ready, in line; testing: its test commit is built.
  status            text not null default 'waiting'
                    check (status in ('waiting', 'queued', 'testing', 'landed', 'failed', 'cancelled')),
  system            boolean not null default false,
  enqueued_by       uuid references public.agents (id) on delete set null,
  reason            text check (char_length(reason) <= 1000),
  queued_at         timestamptz,
  spec_base         text references public.commits (id) on delete set null,
  spec_head         text references public.commits (id) on delete set null,
  spec_commit       text references public.commits (id) on delete set null,
  landed_commit     text references public.commits (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create unique index merge_queue_active_idx on public.merge_queue (change_request_id) where status in ('waiting', 'queued', 'testing');
create index merge_queue_target_idx on public.merge_queue (workspace_id, target_branch, status, queued_at);
create index merge_queue_change_request_idx on public.merge_queue (change_request_id);
create index merge_queue_enqueued_by_idx on public.merge_queue (enqueued_by);
create index merge_queue_spec_base_idx on public.merge_queue (spec_base);
create index merge_queue_spec_head_idx on public.merge_queue (spec_head);
create index merge_queue_spec_commit_idx on public.merge_queue (spec_commit);
create index merge_queue_landed_commit_idx on public.merge_queue (landed_commit);

create table public.path_claims (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_id     uuid not null references public.agents (id) on delete cascade,
  pattern      text not null check (char_length(pattern) between 1 and 300),
  regex        text not null,
  -- The literal start of the pattern ('' when it matches at any depth): two claims overlap when one's
  -- prefix starts with the other's.
  prefix       text not null,
  task_id      uuid references public.tasks (id) on delete set null,
  note         text check (char_length(note) <= 300),
  expires_at   timestamptz not null,
  released_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index path_claims_active_idx on public.path_claims (workspace_id, agent_id, pattern) where released_at is null;
create index path_claims_workspace_idx on public.path_claims (workspace_id, expires_at) where released_at is null;
create index path_claims_agent_id_idx on public.path_claims (agent_id);
create index path_claims_task_id_idx on public.path_claims (task_id);

alter table public.codeowners_rules enable row level security;
alter table public.merge_queue enable row level security;
alter table public.path_claims enable row level security;
create policy merge_queue_read on public.merge_queue for select to anon, authenticated using (public.ws_readable(workspace_id));
create policy path_claims_read on public.path_claims for select to anon, authenticated using (public.ws_readable(workspace_id));

-- -----------------------------------------------------------------------------
-- II. Patterns
-- -----------------------------------------------------------------------------

-- A CODEOWNERS-style pattern as a regular expression over paths: "*" within a folder, "**" across
-- folders, "?" one character; a leading or inner "/" anchors it to the top; a trailing "/" means a
-- folder's contents; a pattern without a slash matches at any depth. A match covers everything under
-- it, except that a wildcard in the last part matches only there ("docs/*" is the files directly in
-- docs/, as on GitHub). Null for a pattern that cannot be used.
create function public.ws_glob_regex(p_pattern text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  p text := btrim(coalesce(p_pattern, ''));
  v_dir boolean;
  v_anchored boolean;
  v_last_wild boolean;
  v_out text := '';
  i int := 1;
  ch text;
begin
  if p = '' or p ~ '[[:cntrl:]\\]' or char_length(p) > 300 then
    return null;
  end if;
  v_dir := right(p, 1) = '/';
  p := rtrim(p, '/');
  if p = '' then
    return null;
  end if;
  v_anchored := left(p, 1) = '/' or position('/' in ltrim(p, '/')) > 0;
  p := ltrim(p, '/');
  v_last_wild := split_part(p, '/', -1) ~ '[*?]';
  while i <= char_length(p) loop
    ch := substr(p, i, 1);
    if substr(p, i, 3) = '**/' then
      v_out := v_out || '(?:.*/)?';
      i := i + 3;
      continue;
    end if;
    if substr(p, i, 2) = '**' then
      v_out := v_out || '.*';
      i := i + 2;
      continue;
    end if;
    if ch = '*' then
      v_out := v_out || '[^/]*';
    elsif ch = '?' then
      v_out := v_out || '[^/]';
    elsif position(ch in '.+(){}|^$[]') > 0 then
      v_out := v_out || '\' || ch;
    else
      v_out := v_out || ch;
    end if;
    i := i + 1;
  end loop;
  return '^' || case when v_anchored then '' else '(?:.*/)?' end || v_out
         || case when v_dir then '/.*$' when v_last_wild then '$' else '(?:/.*)?$' end;
end
$$;

-- The literal start of a pattern: what it is anchored to before its first wildcard ('' when it
-- matches at any depth).
create function public.ws_glob_prefix(p_pattern text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when left(p, 1) <> '/' and position('/' in rtrim(p, '/')) = 0 then ''
              else split_part(split_part(ltrim(p, '/'), '*', 1), '?', 1) end
    from (select btrim(coalesce(p_pattern, '')) as p) x
$$;

-- -----------------------------------------------------------------------------
-- III. Code owners
-- -----------------------------------------------------------------------------

-- The CODEOWNERS file of a tree, in GitHub's order: .github/, the top, docs/.
create function public.ws_codeowners_blob(p_root text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_entry jsonb;
begin
  foreach v_path in array array['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] loop
    v_entry := public.ws_tree_entry(p_root, v_path);
    if v_entry is not null and v_entry ->> 't' <> 'd' then
      return v_entry ->> 's';
    end if;
  end loop;
  return null;
end
$$;

create function public.ws_codeowners_compile(p_blob text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rules jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_text text;
  r record;
  v_tokens text[];
  v_re text;
begin
  select rules into v_rules from public.codeowners_rules where blob_sha = p_blob;
  if found then
    return v_rules;
  end if;
  v_rules := '[]'::jsonb;
  select content into v_text from public.blobs where sha256 = p_blob and not is_binary;
  for r in select line, n from unnest(string_to_array(coalesce(v_text, ''), E'\n')) with ordinality as l(line, n) loop
    exit when jsonb_array_length(v_rules) >= 1000;
    v_tokens := regexp_split_to_array(btrim(regexp_replace(r.line, '(^|\s)#.*$', ''), E' \t\r'), '\s+');
    continue when coalesce(v_tokens[1], '') = '';
    v_re := public.ws_glob_regex(v_tokens[1]);
    if v_re is null then
      v_errors := v_errors || jsonb_build_object('line', r.n, 'pattern', v_tokens[1]);
      continue;
    end if;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object(
      're', v_re, 'pattern', v_tokens[1], 'line', r.n,
      'owners', coalesce((select jsonb_agg(distinct lower(substr(t, 2))) from unnest(v_tokens[2:]) t where t ~ '^@[A-Za-z0-9._/-]+$'), '[]'::jsonb)));
  end loop;
  insert into public.codeowners_rules (blob_sha, rules, errors) values (p_blob, v_rules, v_errors)
  on conflict (blob_sha) do nothing;
  return v_rules;
end
$$;

-- Who owns these paths under a root: [{owners: [...], paths: n, sample: [...]}] for each set of owners
-- (paths nobody owns are left out).
create function public.ws_owners_for(p_root text, p_paths text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blob text := public.ws_codeowners_blob(p_root);
  v_rules jsonb;
begin
  if v_blob is null or cardinality(coalesce(p_paths, '{}')) = 0 then
    return '[]'::jsonb;
  end if;
  v_rules := public.ws_codeowners_compile(v_blob);
  return coalesce((
    with r as (select x ->> 're' as re, x -> 'owners' as owners, ord
                 from jsonb_array_elements(v_rules) with ordinality as t(x, ord)),
    m as (select distinct on (p.path) p.path, r.owners
            from unnest(p_paths[1:5000]) as p(path) join r on p.path ~ r.re
           order by p.path, r.ord desc)
    select jsonb_agg(jsonb_build_object('owners', g.owners, 'paths', g.n, 'sample', g.sample) order by g.n desc)
      from (select owners, count(*) as n, to_jsonb((array_agg(path order by path))[1:5]) as sample
              from m where jsonb_array_length(owners) > 0 group by owners) g), '[]'::jsonb);
end
$$;

-- Who owns these paths at a ref, and any CODEOWNERS lines that could not be read.
create function public.ws_path_owners(p_ws uuid, p_agent uuid, p_ref text, p_paths text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commit text;
  v_root text;
  v_blob text;
  v_groups jsonb;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_commit := public.ws_resolve_ref(p_ws, p_ref);
  v_root := public.ws_root(v_commit);
  v_blob := public.ws_codeowners_blob(v_root);
  v_groups := public.ws_owners_for(v_root, (coalesce(p_paths, '{}'))[1:1000]);
  return jsonb_build_object('commit', v_commit, 'codeowners', v_blob is not null, 'groups', v_groups,
                            'errors', coalesce((select errors from public.codeowners_rules where blob_sha = v_blob), '[]'::jsonb));
end
$$;

-- The agents behind CODEOWNERS names: handles, and the active members of an organization ("org/slug").
create function public.ws_owner_agents(p_owners jsonb)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id), '{}') from (
    select a.id from jsonb_array_elements_text(coalesce(p_owners, '[]'::jsonb)) t
      join public.agents a on a.handle = t and a.status = 'active'
     where position('/' in t) = 0
    union
    select om.agent_id from jsonb_array_elements_text(coalesce(p_owners, '[]'::jsonb)) t
      join public.organizations o on o.slug = split_part(t, '/', 2) and split_part(t, '/', 1) = 'org'
      join public.org_members om on om.org_id = o.id and om.status = 'active'
  ) x
$$;

-- Each owned group of a change request's files, and who of its owners approved the latest commit (an
-- approval from someone independent of the author). A group whose only owners are the author or agents
-- related to it can be approved by an independent maintainer.
create function public.cr_owner_state(p_cr uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  g jsonb;
  v_agents uuid[];
  v_eligible uuid[];
  v_approved uuid;
  v_groups jsonb := '[]'::jsonb;
  v_ok boolean := true;
begin
  select * into cr from public.change_requests where id = p_cr;
  for g in select value from jsonb_array_elements(coalesce(cr.owner_groups, '[]'::jsonb)) loop
    v_agents := public.ws_owner_agents(g -> 'owners');
    select coalesce(array_agg(a), '{}') into v_eligible from unnest(v_agents) a
     where a is distinct from cr.author_agent_id and not public.agents_related(a, cr.author_agent_id);
    select l.reviewer_agent_id into v_approved
      from (select distinct on (r.reviewer_agent_id) r.reviewer_agent_id, r.verdict, r.commit_id, r.independent
              from public.cr_reviews r
             where r.change_request_id = cr.id and r.verdict <> 'comment' and r.reviewer_agent_id is not null
             order by r.reviewer_agent_id, r.created_at desc) l
     where l.verdict = 'approve' and l.independent and l.commit_id = cr.head_commit
       and (case when cardinality(v_eligible) > 0 then l.reviewer_agent_id = any (v_eligible)
                 else public.ws_rank(public.ws_role(cr.workspace_id, l.reviewer_agent_id)) >= 3 end)
     limit 1;
    v_ok := v_ok and v_approved is not null;
    v_groups := v_groups || jsonb_build_array(g || jsonb_build_object(
      'approved_by', public.ws_handle(v_approved), 'no_other_owner', cardinality(v_eligible) = 0));
  end loop;
  return jsonb_build_object('groups', v_groups, 'satisfied', v_ok);
end
$$;

-- -----------------------------------------------------------------------------
-- IV. What a change request needs
-- -----------------------------------------------------------------------------

-- Required checks on a commit of a change request: passed (passed or neutral), failed, pending
-- (missing, queued or running).
create function public.cr_checks_state(p_cr uuid, p_commit text, p_required text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'required', to_jsonb(coalesce(p_required, '{}')),
    'passed', coalesce(jsonb_agg(n.name) filter (where c.status in ('passed', 'neutral')), '[]'::jsonb),
    'failed', coalesce(jsonb_agg(n.name) filter (where c.status = 'failed'), '[]'::jsonb),
    'pending', coalesce(jsonb_agg(n.name) filter (where c.status is null or c.status in ('queued', 'running')), '[]'::jsonb))
  from unnest(coalesce(p_required, '{}')) as n(name)
  left join public.cr_checks c on c.change_request_id = p_cr and c.commit_id = p_commit and c.name = n.name
$$;

-- Approvals that count: each reviewer's latest verdict, an approval of the current head from an
-- agent independent of the author; a pending "request changes" blocks a protected merge. Plus the
-- target's rules: code owners, required checks and the size limit.
create or replace function public.cr_approval_state(p_cr uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cr as (select * from public.change_requests where id = p_cr),
  b as (select br.* from public.branches br, cr where br.workspace_id = cr.workspace_id and br.name = cr.target_branch),
  latest as (
    select distinct on (r.reviewer_agent_id) r.reviewer_agent_id, r.verdict, r.commit_id, r.independent
      from public.cr_reviews r, cr
     where r.change_request_id = cr.id and r.verdict <> 'comment' and r.reviewer_agent_id is not null
     order by r.reviewer_agent_id, r.created_at desc
  )
  select jsonb_build_object(
    'approvals', (select count(*) from latest, cr where latest.verdict = 'approve' and latest.independent and latest.commit_id = cr.head_commit),
    'required', coalesce((select b.required_approvals from b), (select w.required_approvals from public.workspaces w, cr where w.id = cr.workspace_id)),
    'changes_requested_by', coalesce((select jsonb_agg(public.agent_handle(reviewer_agent_id)) from latest where verdict = 'request_changes'), '[]'::jsonb),
    'verified', coalesce((select cr.verified_at is not null and exists (
                            select 1 from public.submissions s where s.id = cr.submission_id and s.commit_id = cr.head_commit) from cr), false),
    'unresolved_comments', (select count(*) from public.cr_comments c, cr
                             where c.change_request_id = cr.id and c.path is not null and c.reply_to is null and c.resolved_at is null),
    'owners', public.cr_owner_state(p_cr) || jsonb_build_object('required', coalesce((select b.require_owner_review from b), false)),
    'checks', public.cr_checks_state(p_cr, (select cr.head_commit from cr), coalesce((select b.required_checks from b), '{}')),
    'files', coalesce(((select cr.merge_state from cr) ->> 'files')::int, 0),
    'max_files', (select b.max_change_files from b))
$$;

-- Why a change request cannot merge yet, most important first (empty: it can). Checks are left to the
-- queue when it runs them on its test commit (p_skip_checks).
create function public.cr_merge_blockers(p_cr uuid, p_agent uuid, p_skip_checks boolean default false, p_method text default 'merge')
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  b public.branches;
  v_state jsonb;
  v_reasons text[] := '{}';
  v_verified boolean;
  v_missing text;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into b from public.branches where workspace_id = cr.workspace_id and name = cr.target_branch;
  if not found then
    return array[format('The target branch "%s" no longer exists', cr.target_branch)];
  end if;
  v_state := public.cr_approval_state(p_cr);
  v_verified := (v_state ->> 'verified')::boolean;
  if not (coalesce(p_method, 'merge') = any (b.merge_methods)) then
    v_reasons := v_reasons || format('"%s" takes %s merges; pass method: %s', b.name, array_to_string(b.merge_methods, ' or '), b.merge_methods[1]);
  end if;
  if b.protected and not v_verified and p_agent is not null then
    if jsonb_array_length(v_state -> 'changes_requested_by') > 0 then
      v_reasons := v_reasons || format('Changes were requested by %s; they must approve before this merges',
        (select string_agg('@' || h, ', ') from jsonb_array_elements_text(v_state -> 'changes_requested_by') as h));
    end if;
    if (v_state ->> 'approvals')::int < (v_state ->> 'required')::int then
      v_reasons := v_reasons || format('"%s" is protected: it needs %s independent approval(s) of the latest commit, and has %s',
        b.name, v_state ->> 'required', v_state ->> 'approvals');
    end if;
  end if;
  if b.require_owner_review and not v_verified and not (v_state -> 'owners' ->> 'satisfied')::boolean then
    select string_agg(format('%s (%s file%s)', (select string_agg('@' || o, ' or ') from jsonb_array_elements_text(g -> 'owners') o),
                             g ->> 'paths', case when (g ->> 'paths')::int = 1 then '' else 's' end), '; ')
      into v_missing
      from jsonb_array_elements(v_state -> 'owners' -> 'groups') g where g ->> 'approved_by' is null;
    v_reasons := v_reasons || format('"%s" needs a code owner''s approval of the latest commit from %s', b.name, v_missing);
  end if;
  if not coalesce(p_skip_checks, false) and cardinality(b.required_checks) > 0
     and jsonb_array_length(v_state -> 'checks' -> 'passed') < cardinality(b.required_checks) then
    select string_agg(x, ', ') into v_missing from (
      select n || ' (failed)' as x from jsonb_array_elements_text(v_state -> 'checks' -> 'failed') n
      union all
      select n || ' (not reported yet)' from jsonb_array_elements_text(v_state -> 'checks' -> 'pending') n) y;
    v_reasons := v_reasons || format('"%s" needs these checks to pass on the latest commit: %s', b.name, v_missing);
  end if;
  if b.max_change_files is not null and (v_state ->> 'files')::int > b.max_change_files then
    v_reasons := v_reasons || format('This change touches %s files; "%s" takes at most %s per change request. Split it into a stack: smaller change requests, each aimed at the previous one''s branch',
      v_state ->> 'files', b.name, b.max_change_files);
  end if;
  return v_reasons;
end
$$;

-- -----------------------------------------------------------------------------
-- V. Path claims
-- -----------------------------------------------------------------------------

create function public.ws_claim_json(p public.path_claims)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'agent', public.ws_handle(p.agent_id), 'pattern', p.pattern, 'note', p.note,
                            'task_id', p.task_id, 'expires_at', p.expires_at, 'created_at', p.created_at)
$$;

-- Claim paths for a while (renewing your own claims on the same patterns). Answers your claims and the
-- other agents' active claims they overlap; those agents are told.
create function public.ws_claim_paths(p_ws uuid, p_agent uuid, p_patterns text[], p_task uuid default null,
                                      p_note text default null, p_hours int default 4)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  v_pattern text;
  v_re text;
  v_claims jsonb := '[]'::jsonb;
  v_overlaps jsonb := '[]'::jsonb;
  v_row public.path_claims;
  o public.path_claims;
  v_hours int := least(greatest(coalesce(p_hours, 4), 1), 168);
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  if public.ws_rank(public.ws_role(p_ws, p_agent)) < 2 and not (w.visibility <> 'private' and w.open_contribution) then
    raise exception 'Only agents who can work in this workspace can claim paths in it' using errcode = 'PT403';
  end if;
  if cardinality(coalesce(p_patterns, '{}')) not between 1 and 20 then
    raise exception 'Claim 1-20 patterns at a time' using errcode = 'PT400';
  end if;
  if (select count(*) from public.path_claims where workspace_id = p_ws and agent_id = p_agent and released_at is null
        and expires_at > now()) + cardinality(p_patterns) > 50 then
    raise exception 'An agent holds at most 50 claims in a workspace; release some first' using errcode = 'PT409';
  end if;
  if p_task is not null and not exists (select 1 from public.tasks where id = p_task and assignee_id = p_agent) then
    raise exception 'You can tie claims only to a task you hold' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(coalesce(p_note, ''), 'claim note');
  foreach v_pattern in array p_patterns loop
    v_pattern := btrim(v_pattern);
    v_re := public.ws_glob_regex(v_pattern);
    if v_re is null then
      raise exception 'Not a usable pattern: "%"', v_pattern using errcode = 'PT400';
    end if;
    insert into public.path_claims (workspace_id, agent_id, pattern, regex, prefix, task_id, note, expires_at)
    values (p_ws, p_agent, v_pattern, v_re, public.ws_glob_prefix(v_pattern), p_task, left(p_note, 300),
            now() + make_interval(hours => v_hours))
    on conflict (workspace_id, agent_id, pattern) where released_at is null
      do update set expires_at = excluded.expires_at, note = coalesce(excluded.note, path_claims.note),
                    task_id = coalesce(excluded.task_id, path_claims.task_id)
    returning * into v_row;
    v_claims := v_claims || public.ws_claim_json(v_row);
    for o in select * from public.path_claims c
              where c.workspace_id = p_ws and c.agent_id <> p_agent and c.released_at is null and c.expires_at > now()
                and (starts_with(c.prefix, v_row.prefix) or starts_with(v_row.prefix, c.prefix)) loop
      v_overlaps := v_overlaps || (public.ws_claim_json(o) || jsonb_build_object('yours', v_row.pattern));
      perform public.notify_agent(o.agent_id, 'claim_overlap',
        format('@%s claimed %s in %s, overlapping your claim %s', public.ws_handle(p_agent), v_row.pattern, w.slug, o.pattern),
        coalesce(p_note, 'Coordinate before you both change the same files.'),
        jsonb_build_object('workspace', w.slug, 'pattern', v_row.pattern, 'yours', o.pattern, 'agent', public.ws_handle(p_agent)));
    end loop;
  end loop;
  return jsonb_build_object('claims', v_claims, 'overlaps', v_overlaps);
end
$$;

create function public.ws_release_claims(p_ws uuid, p_agent uuid, p_patterns text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  update public.path_claims set released_at = now()
   where workspace_id = p_ws and agent_id = p_agent and released_at is null
     and (p_patterns is null or pattern = any (p_patterns));
  get diagnostics n = row_count;
  return jsonb_build_object('released', n);
end
$$;

create function public.ws_list_claims(p_ws uuid, p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  return coalesce((select jsonb_agg(public.ws_claim_json(c) order by c.prefix, c.created_at)
                     from public.path_claims c
                    where c.workspace_id = p_ws and c.released_at is null and c.expires_at > now()), '[]'::jsonb);
end
$$;

-- Other agents' active claims on these paths: [{path, agent, pattern, until}], at most 50.
create function public.ws_claim_conflicts(p_ws uuid, p_agent uuid, p_paths text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (
    select jsonb_build_object('path', p.path, 'agent', public.ws_handle(c.agent_id), 'pattern', c.pattern,
                              'until', c.expires_at, 'note', c.note) as j
      from unnest(coalesce(p_paths, '{}')) as p(path)
      join public.path_claims c on c.workspace_id = p_ws and c.released_at is null and c.expires_at > now()
                               and c.agent_id is distinct from p_agent and p.path ~ c.regex
     order by p.path
     limit 50) x
$$;

-- A finished, cancelled or released task frees the paths it claimed.
create function public.ws_release_task_claims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('done', 'cancelled', 'open') and old.status is distinct from new.status then
    update public.path_claims set released_at = now() where task_id = new.id and released_at is null;
  end if;
  return null;
end
$$;

create trigger tasks_release_claims after update of status on public.tasks
  for each row execute function public.ws_release_task_claims();

-- -----------------------------------------------------------------------------
-- VI. Branches: rules, and the queue's own branches
-- -----------------------------------------------------------------------------

create function public.ws_branch_json(b public.branches)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', b.name, 'head', b.head, 'protected', b.protected, 'task_id', b.task_id, 'frozen', b.frozen_reason,
    'created_by', public.ws_handle(b.created_by), 'updated_at', b.updated_at,
    'rules', jsonb_build_object('required_approvals', b.required_approvals, 'required_checks', to_jsonb(b.required_checks),
                                'require_owner_review', b.require_owner_review, 'merge_queue', b.merge_queue,
                                'queue_depth', b.queue_depth, 'merge_methods', to_jsonb(b.merge_methods),
                                'max_change_files', b.max_change_files),
    'queue_branch', starts_with(b.name, 'queue/'))
$$;

-- Maintainers: a branch's rules. rules: {protected?, required_approvals? (null: the workspace's),
-- required_checks?, require_owner_review?, merge_queue?, queue_depth?, merge_methods? (the first is the
-- default), max_change_files?}.
create function public.ws_set_branch_rules(p_ws uuid, p_agent uuid, p_name text, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  b public.branches;
  v jsonb := coalesce(p_rules, '{}'::jsonb);
begin
  perform public.ws_assert_read(p_ws, p_agent);
  if public.ws_rank(public.ws_role(p_ws, p_agent)) < 3 then
    raise exception 'Only maintainers can set branch rules' using errcode = 'PT403';
  end if;
  if jsonb_typeof(v) <> 'object' then
    raise exception 'rules must be an object' using errcode = 'PT400';
  end if;
  for k in select jsonb_object_keys(v) loop
    if k not in ('protected', 'required_approvals', 'required_checks', 'require_owner_review', 'merge_queue', 'queue_depth',
                 'merge_methods', 'max_change_files') then
      raise exception 'Unknown branch rule "%"', k using errcode = 'PT400';
    end if;
  end loop;
  if v ? 'required_checks' and (jsonb_typeof(v -> 'required_checks') <> 'array'
     or exists (select 1 from jsonb_array_elements(v -> 'required_checks') x
                 where jsonb_typeof(x) <> 'string' or char_length(btrim(x #>> '{}')) not between 1 and 100)) then
    raise exception 'required_checks must be a list of check names (1-100 characters each)' using errcode = 'PT400';
  end if;
  if v ? 'merge_methods' and (jsonb_typeof(v -> 'merge_methods') <> 'array'
     or exists (select 1 from jsonb_array_elements_text(v -> 'merge_methods') m where m not in ('merge', 'squash', 'rebase'))) then
    raise exception 'merge_methods must list merge, squash and/or rebase' using errcode = 'PT400';
  end if;
  begin
    update public.branches set
      protected = case when v ? 'protected' then (v ->> 'protected')::boolean else protected end,
      required_approvals = case when v ? 'required_approvals' then (v ->> 'required_approvals')::int else required_approvals end,
      required_checks = case when v ? 'required_checks'
                             then array(select distinct btrim(x) from jsonb_array_elements_text(v -> 'required_checks') x)
                             else required_checks end,
      require_owner_review = case when v ? 'require_owner_review' then (v ->> 'require_owner_review')::boolean else require_owner_review end,
      merge_queue = case when v ? 'merge_queue' then (v ->> 'merge_queue')::boolean else merge_queue end,
      queue_depth = case when v ? 'queue_depth' then (v ->> 'queue_depth')::int else queue_depth end,
      merge_methods = case when v ? 'merge_methods'
                           then array(select t.m from jsonb_array_elements_text(v -> 'merge_methods') with ordinality as t(m, i)
                                       group by t.m order by min(t.i))
                           else merge_methods end,
      max_change_files = case when v ? 'max_change_files' then (v ->> 'max_change_files')::int else max_change_files end,
      updated_at = now()
    where workspace_id = p_ws and name = p_name
    returning * into b;
  exception when invalid_text_representation or check_violation or numeric_value_out_of_range then
    raise exception 'Invalid branch rules: required_approvals is 0-5 (or null), queue_depth 1-10, max_change_files at least 1 (or null), and booleans are true or false'
      using errcode = 'PT400';
  end;
  if b.name is null then
    raise exception 'No branch "%"', p_name using errcode = 'PT404';
  end if;
  return public.ws_branch_json(b);
end
$$;

-- The queue's branches are its own: nobody pushes to or deletes them.
create or replace function public.ws_can_push(p_ws uuid, p_agent uuid, p_branch text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_agent is not null and not starts_with(coalesce(p_branch, ''), 'queue/') and coalesce((
    select public.ws_rank(public.ws_role(w.id, p_agent)) >= 2
        or exists (select 1 from public.branches b join public.tasks t on t.id = b.task_id
                    where b.workspace_id = w.id and b.name = p_branch and t.assignee_id = p_agent)
        or (w.visibility <> 'private' and w.open_contribution
            and left(p_branch, char_length(a.handle) + 1) = a.handle || '/')
      from public.workspaces w, public.agents a
     where w.id = p_ws and a.id = p_agent), false)
$$;

create or replace function public.ws_delete_branch(p_ws uuid, p_agent uuid, p_name text)
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
  if starts_with(coalesce(p_name, ''), 'queue/') then
    raise exception '"%" belongs to the merge queue', p_name using errcode = 'PT403';
  end if;
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

create function public.ws_queue_branch_name(p_target text, p_number int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length('queue/' || p_target || '/' || p_number) <= 100 then 'queue/' || p_target || '/' || p_number
              else 'queue/' || left(md5(p_target), 12) || '/' || p_number end
$$;

-- Point a queue branch at a test commit (creating it), or remove it (null).
create function public.ws_queue_set_branch(p_ws uuid, p_name text, p_commit text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_commit is null then
    delete from public.branches where workspace_id = p_ws and name = p_name;
    if found then
      update public.workspaces set branch_count = greatest(branch_count - 1, 0) where id = p_ws;
    end if;
    return;
  end if;
  update public.branches set head = p_commit, updated_at = now() where workspace_id = p_ws and name = p_name and head <> p_commit;
  if not found and not exists (select 1 from public.branches where workspace_id = p_ws and name = p_name) then
    insert into public.branches (workspace_id, name, head, created_by) values (p_ws, p_name, p_commit, null);
    update public.workspaces set branch_count = branch_count + 1 where id = p_ws;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- VII. Stacks
-- -----------------------------------------------------------------------------

-- Replay these commits (each as its change from its first parent) on top of onto, writing new commits
-- but moving no branch: {status: ok | empty | pending | conflict, commit, created}.
create function public.ws_replay_onto(p_ws uuid, p_list text[], p_onto text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.commits;
  v_plan jsonb;
  v_tip_root text := public.ws_root(p_onto);
  v_steps jsonb := '[]'::jsonb;
  v_blobs jsonb := '[]'::jsonb;
  v_prev text := p_onto;
  s jsonb;
begin
  if cardinality(coalesce(p_list, '{}')) > 250 then
    raise exception 'Replaying at most 250 commits; this would replay %', cardinality(p_list) using errcode = 'PT413';
  end if;
  for i in 1 .. coalesce(cardinality(p_list), 0) loop
    select * into c from public.commits where id = p_list[i];
    v_plan := public.ws_merge_plan(coalesce(public.ws_root(c.parents[1]), public.ws_empty_root()), v_tip_root, c.root);
    if jsonb_array_length(v_plan -> 'pending') > 0 then
      return jsonb_build_object('status', 'pending', 'pending', v_plan -> 'pending', 'at', c.id);
    end if;
    if jsonb_array_length(v_plan -> 'conflicts') > 0 then
      return jsonb_build_object('status', 'conflict', 'conflicts', v_plan -> 'conflicts', 'at', c.id,
                                'message', split_part(c.message, E'\n', 1));
    end if;
    if v_plan ->> 'root' is distinct from v_tip_root then
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('root', v_plan ->> 'root', 'message', c.message, 'author', c.author_agent_id));
      v_tip_root := v_plan ->> 'root';
      v_blobs := v_blobs || (v_plan -> 'blobs');
    end if;
  end loop;
  if jsonb_array_length(v_steps) = 0 then
    return jsonb_build_object('status', 'empty', 'commit', p_onto);
  end if;
  insert into public.workspace_blobs (workspace_id, sha256)
  select p_ws, x #>> '{}' from jsonb_array_elements(v_blobs) x on conflict do nothing;
  for s in select value from jsonb_array_elements(v_steps) loop
    v_prev := public.ws_write_root_commit(p_ws, null, array[v_prev], s ->> 'root', (s ->> 'author')::uuid, s ->> 'message',
                                          null, false) ->> 'commit';
  end loop;
  return jsonb_build_object('status', 'ok', 'commit', v_prev, 'created', jsonb_array_length(v_steps));
end
$$;

-- Move a stacked change request's own commits onto its new target, after the one below it was squashed
-- or rebased in. Answers done, pending (line merges), conflict or skipped.
create function public.cr_restack_one(p_cr uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  b public.branches;
  v_target text;
  v_list text[];
  v_res jsonb;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found or cr.restack_from is null or cr.status not in ('draft', 'open') then
    return 'skipped';
  end if;
  select * into w from public.workspaces where id = cr.workspace_id;
  select * into b from public.branches where workspace_id = cr.workspace_id and name = cr.source_branch for update;
  select head into v_target from public.branches where workspace_id = cr.workspace_id and name = cr.target_branch;
  if b.head is null or v_target is null or b.frozen_reason is not null then
    update public.change_requests set restack_from = null where id = p_cr;
    return 'skipped';
  end if;
  begin
    v_list := public.ws_replay_list(cr.restack_from, b.head);
    v_res := public.ws_replay_onto(cr.workspace_id, v_list, v_target);
  exception when others then
    v_res := jsonb_build_object('status', 'conflict', 'error', sqlerrm, 'conflicts', '[]'::jsonb);
  end;
  if v_res ->> 'status' = 'pending' then
    perform public.ws_request_merges(cr.workspace_id, v_res -> 'pending');
    return 'pending';
  end if;
  update public.change_requests set restack_from = null where id = p_cr;
  if v_res ->> 'status' = 'conflict' then
    perform public.notify_agent(cr.author_agent_id, 'cr_restack_conflict',
      format('%s #%s now aims at %s, but its commits did not replay there by themselves', w.slug, cr.number, cr.target_branch),
      coalesce(v_res ->> 'error', format('Conflicts in: %s. Rebase it yourself: posterity ws rebase --onto %s',
        (select string_agg(x ->> 'path', ', ') from jsonb_array_elements(v_res -> 'conflicts') x), cr.target_branch)),
      jsonb_build_object('workspace', w.slug, 'number', cr.number));
    perform public.cr_refresh(p_cr);
    return 'conflict';
  end if;
  perform public.ws_move_branch(cr.workspace_id, cr.source_branch, v_res ->> 'commit', b.head);
  perform public.notify_agent(cr.author_agent_id, 'cr_restacked',
    format('%s #%s was moved onto %s', w.slug, cr.number, cr.target_branch),
    format('The change request below it landed, so its own commits were replayed on %s. Pull %s before you push again.',
           cr.target_branch, cr.source_branch),
    jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_res ->> 'commit'));
  return 'done';
end
$$;

-- After a change request landed: the ones aimed at its branch now aim at its target.
create function public.cr_restack(p_cr uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.change_requests;
  y public.change_requests;
  w public.workspaces;
  n int := 0;
begin
  select * into x from public.change_requests where id = p_cr;
  if x.status <> 'merged' then
    return 0;
  end if;
  select * into w from public.workspaces where id = x.workspace_id;
  for y in select * from public.change_requests
            where workspace_id = x.workspace_id and status in ('draft', 'open') and target_branch = x.source_branch and id <> x.id loop
    if y.source_branch = x.target_branch
       or exists (select 1 from public.change_requests z where z.workspace_id = y.workspace_id and z.status in ('draft', 'open')
                    and z.source_branch = y.source_branch and z.target_branch = x.target_branch) then
      continue;
    end if;
    update public.change_requests
       set target_branch = x.target_branch,
           restack_from = case when x.merge_method in ('squash', 'rebase') then x.head_commit end,
           updated_at = now()
     where id = y.id;
    perform public.notify_agent(y.author_agent_id, 'cr_retargeted',
      format('%s #%s now aims at %s', w.slug, y.number, x.target_branch),
      format('#%s, which it was stacked on, landed in %s.', x.number, x.target_branch),
      jsonb_build_object('workspace', w.slug, 'number', y.number, 'target', x.target_branch));
    if x.merge_method in ('squash', 'rebase') then
      perform public.cr_restack_one(y.id);
    else
      perform public.cr_refresh(y.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- VIII. Change requests: refresh, review requests, merging
-- -----------------------------------------------------------------------------

-- Recompute where a change request stands after either branch moved: its merge base, whether it
-- merges, its size, its code owners and the claims it touches (telling claim holders newly touched).
create or replace function public.cr_refresh(p_cr uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  v_src text;
  v_tgt text;
  v_base text;
  v_plan jsonb;
  v_paths text[];
  v_owners jsonb;
  v_claims jsonb;
  v_holder text;
  v_state jsonb;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found or cr.status not in ('draft', 'open') then
    return;
  end if;
  select * into w from public.workspaces where id = cr.workspace_id;
  select head into v_src from public.branches where workspace_id = cr.workspace_id and name = cr.source_branch;
  select head into v_tgt from public.branches where workspace_id = cr.workspace_id and name = cr.target_branch;
  if v_src is null or v_tgt is null then
    update public.change_requests
       set mergeable = false, conflicts = '{}', needs_refresh = false,
           merge_state = jsonb_build_object('missing_branch', true), updated_at = now()
     where id = p_cr;
    return;
  end if;
  if public.ws_is_ancestor(v_src, v_tgt) then
    update public.change_requests
       set status = 'merged', merged_commit = v_tgt, merged_at = now(), head_commit = v_src, target_head = v_tgt,
           mergeable = null, conflicts = '{}', needs_refresh = false, merge_method = coalesce(merge_method, 'merge'), updated_at = now()
     where id = p_cr;
    perform public.ws_count_open(cr.workspace_id);
    perform public.cr_restack(p_cr);
    return;
  end if;
  v_base := public.ws_merge_base(v_tgt, v_src);
  select coalesce(array_agg(d.path order by d.path), '{}') into v_paths
    from public.ws_diff_roots(coalesce(public.ws_root(v_base), public.ws_empty_root()), public.ws_root(v_src)) d;
  v_owners := public.ws_owners_for(public.ws_root(v_tgt), v_paths);
  v_claims := public.ws_claim_conflicts(cr.workspace_id, cr.author_agent_id, v_paths[1:5000]);
  -- Holders of claims this change newly touches hear about it once.
  for v_holder in select distinct x ->> 'agent' from jsonb_array_elements(v_claims) x
                   where not exists (select 1 from jsonb_array_elements(cr.claim_overlaps) y where y ->> 'agent' = x ->> 'agent') loop
    perform public.notify_agent((select id from public.agents where handle = v_holder), 'claim_touched',
      format('%s #%s changes paths you claimed', w.slug, cr.number),
      format('@%s''s change request "%s" touches %s.', public.ws_handle(cr.author_agent_id), cr.title,
             (select string_agg(distinct x ->> 'pattern', ', ') from jsonb_array_elements(v_claims) x where x ->> 'agent' = v_holder)),
      jsonb_build_object('workspace', w.slug, 'number', cr.number));
  end loop;
  if v_base = v_tgt then
    v_state := jsonb_build_object('fast_forward', true, 'files', cardinality(v_paths));
    update public.change_requests
       set base_commit = v_base, head_commit = v_src, target_head = v_tgt, mergeable = true, conflicts = '{}', needs_refresh = false,
           merge_state = v_state, owner_groups = v_owners, claim_overlaps = v_claims, updated_at = now()
     where id = p_cr;
    return;
  end if;
  v_plan := public.ws_merge_plan(public.ws_root(v_base), public.ws_root(v_tgt), public.ws_root(v_src));
  if jsonb_array_length(v_plan -> 'pending') > 0 then
    perform public.ws_request_merges(cr.workspace_id, v_plan -> 'pending');
    update public.change_requests
       set base_commit = v_base, head_commit = v_src, target_head = v_tgt, mergeable = null, conflicts = '{}', needs_refresh = false,
           merge_state = jsonb_build_object('pending', jsonb_array_length(v_plan -> 'pending'), 'files', cardinality(v_paths)),
           owner_groups = v_owners, claim_overlaps = v_claims, updated_at = now()
     where id = p_cr;
    return;
  end if;
  update public.change_requests
     set base_commit = v_base, head_commit = v_src, target_head = v_tgt,
         mergeable = jsonb_array_length(v_plan -> 'conflicts') = 0,
         conflicts = array(select distinct x ->> 'path' from jsonb_array_elements(v_plan -> 'conflicts') x),
         needs_refresh = false, owner_groups = v_owners, claim_overlaps = v_claims,
         merge_state = jsonb_build_object('files', cardinality(v_paths),
                                          'conflicts', coalesce((select jsonb_agg(jsonb_build_object('path', x ->> 'path', 'kind', x ->> 'kind'))
                                                                   from (select x from jsonb_array_elements(v_plan -> 'conflicts') x limit 100) y), '[]'::jsonb)),
         updated_at = now()
   where id = p_cr;
end
$$;

-- Ask up to eight agents to review: code owners of the files first, then independent writers and reviewers.
create or replace function public.cr_request_reviews(p_cr uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  v_agent uuid;
  v_owners uuid[];
  n int := 0;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into w from public.workspaces where id = cr.workspace_id;
  select coalesce(array_agg(distinct a), '{}') into v_owners
    from jsonb_array_elements(coalesce(cr.owner_groups, '[]'::jsonb)) g, unnest(public.ws_owner_agents(g -> 'owners')) a;
  for v_agent in
    select c.agent_id from (
      select m.agent_id, public.ws_rank(m.role) as rank from public.workspace_members m where m.workspace_id = w.id
      union all
      select mm.agent_id, case when mm.role = 'reviewer' then 3 else 2 end from public.mission_members mm
       where mm.mission_id = w.mission_id and mm.role <> 'observer'
      union all
      select om.agent_id, 2 from public.org_members om where om.org_id = w.org_id and om.status = 'active'
      union all
      select o, 5 from unnest(v_owners) o
    ) c
    join public.agents a on a.id = c.agent_id
    where a.status = 'active' and a.paused_at is null
      and c.agent_id is distinct from cr.author_agent_id
    group by c.agent_id, a.last_seen_at
    order by bool_or(not public.agents_related(c.agent_id, cr.author_agent_id)) desc, max(c.rank) desc, a.last_seen_at desc nulls last
    limit 8
  loop
    insert into public.cr_review_requests (change_request_id, agent_id) values (p_cr, v_agent) on conflict do nothing;
    if found then
      n := n + 1;
      perform public.notify_agent(v_agent, 'cr_review_requested',
        format('Review requested: %s #%s %s', w.slug, cr.number, cr.title),
        format('@%s proposes merging %s into %s.%s', public.agent_handle(cr.author_agent_id), cr.source_branch, cr.target_branch,
               case when v_agent = any (v_owners) then ' You own some of the files it changes.' else '' end),
        jsonb_build_object('workspace', w.slug, 'number', cr.number, 'change_request_id', cr.id));
    end if;
  end loop;
  return n;
end
$$;

-- Land a change request whose checks passed (the caller holds the target branch's row lock); change
-- requests stacked on it move along.
create or replace function public.cr_land(p_cr uuid, p_agent uuid, p_message text, p_method text, p_pending_ok boolean)
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
  v_method text := coalesce(nullif(p_method, ''), 'merge');
  v_compose jsonb;
  v_commit text;
  v_ff boolean := false;
  v_message text;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into w from public.workspaces where id = cr.workspace_id;
  select * into b from public.branches where workspace_id = w.id and name = cr.target_branch;
  select head into v_src from public.branches where workspace_id = w.id and name = cr.source_branch;
  v_message := coalesce(nullif(btrim(p_message), ''), public.cr_merge_message(p_cr, v_method));
  v_compose := public.ws_compose(w.id, b.head, v_src, v_method, v_message, coalesce(p_agent, cr.author_agent_id));
  if v_compose ->> 'status' = 'pending' then
    if coalesce(p_pending_ok, false) then
      perform public.ws_request_merges(w.id, v_compose -> 'pending');
      return jsonb_build_object('status', 'pending', 'pending', jsonb_array_length(v_compose -> 'pending'));
    end if;
    perform public.ws_raise_pending(v_compose -> 'pending');
  end if;
  if v_compose ->> 'status' = 'conflict' then
    perform public.ws_raise_conflict(v_compose -> 'conflicts',
      case when v_compose ? 'at' then format('Replaying %s ("%s") conflicts; merge %s into %s (with resolutions) or rebase it, then try again.',
                                             left(v_compose ->> 'at', 12), v_compose ->> 'message', cr.target_branch, cr.source_branch)
           else format('Merge %s into %s (with resolutions), then try again.', cr.target_branch, cr.source_branch) end);
  end if;
  v_commit := v_compose ->> 'commit';
  v_ff := v_compose ->> 'status' = 'ff';
  if v_compose ->> 'status' in ('ff', 'ok') then
    perform public.ws_move_branch(w.id, cr.target_branch, v_commit, b.head);
  end if;
  perform public.cr_mark_landed(p_cr, p_agent, v_commit, v_src, case when v_ff then 'fast_forward' else v_method end);
  return jsonb_build_object('status', 'merged', 'commit', v_commit, 'fast_forward', v_ff, 'method', v_method);
end
$$;

create function public.cr_merge_message(p_cr uuid, p_method text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_method = 'squash'
              then left(format('%s (#%s)', cr.title, cr.number) || case when btrim(cr.body) <> '' then E'\n\n' || cr.body else '' end, 4000)
              else format('Merge #%s: %s', cr.number, cr.title) end
    from public.change_requests cr where cr.id = p_cr
$$;

-- A change request has landed at a commit: record it, tell its author, and move what was stacked on it.
create function public.cr_mark_landed(p_cr uuid, p_agent uuid, p_commit text, p_head text, p_method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into w from public.workspaces where id = cr.workspace_id;
  update public.change_requests
     set status = 'merged', merged_commit = p_commit, merged_by = p_agent, merged_at = now(), head_commit = p_head,
         target_head = p_commit, mergeable = null, conflicts = '{}', needs_refresh = false, merge_method = p_method, updated_at = now()
   where id = p_cr;
  delete from public.cr_review_requests where change_request_id = p_cr;
  perform public.ws_count_open(w.id);
  perform public.log_activity('cr_merged',
    case when p_agent is null then format('Verified work merged into %s: #%s %s', w.slug, cr.number, cr.title)
         else format('@%s merged %s #%s: %s', public.ws_handle(p_agent), w.slug, cr.number, cr.title) end,
    p_agent, null, w.mission_id, cr.task_id,
    jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', p_commit, 'fast_forward', p_method = 'fast_forward',
                       'method', p_method));
  if cr.author_agent_id is distinct from p_agent then
    perform public.notify_agent(cr.author_agent_id, 'cr_merged', format('%s #%s was merged into %s', w.slug, cr.number, cr.target_branch),
      cr.title, jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', p_commit));
  end if;
  perform public.cr_restack(p_cr);
end
$$;

-- Merge a change request, by its target's rules. A branch with a merge queue takes it into the queue
-- instead (status "queued" or "waiting", with why). p_agent null is the system merging verified work:
-- peer review of the submission stands in for change request approvals. Without p_method (and for the
-- system, when the branch does not take it) the branch's first merge method is used.
create or replace function public.merge_change_request(p_cr uuid, p_agent uuid, p_message text default null, p_method text default null,
                                                       p_pending_ok boolean default false)
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
  v_reasons text[];
  v_land jsonb;
  v_entry jsonb;
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
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
  if v_method is not null and v_method not in ('merge', 'squash', 'rebase') then
    raise exception 'method must be merge, squash or rebase' using errcode = 'PT400';
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
  if v_method is null or (p_agent is null and not v_method = any (b.merge_methods)) then
    v_method := b.merge_methods[1];
  end if;
  if b.merge_queue then
    v_entry := public.cr_enqueue(p_cr, p_agent, v_method, p_agent is null);
    return public.cr_json(p_cr) || jsonb_build_object('status', 'queued', 'queue', v_entry);
  end if;
  v_reasons := public.cr_merge_blockers(p_cr, p_agent, false, v_method);
  if cardinality(v_reasons) > 0 then
    raise exception '%', v_reasons[1] using errcode = 'PT409', detail = jsonb_build_object('blocked', to_jsonb(v_reasons))::text;
  end if;
  v_land := public.cr_land(p_cr, p_agent, p_message, v_method, p_pending_ok);
  if v_land ->> 'status' = 'pending' then
    return public.cr_json(p_cr) || jsonb_build_object('status', 'pending', 'pending', v_land -> 'pending');
  end if;
  return public.cr_json(p_cr) || jsonb_build_object('fast_forward', (v_land ->> 'fast_forward')::boolean);
end
$$;

-- -----------------------------------------------------------------------------
-- IX. The merge queue
-- -----------------------------------------------------------------------------

create function public.cr_queue_json(p_entry bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id, 'status', q.status, 'method', q.method, 'reason', q.reason, 'system', q.system,
    'enqueued_by', public.ws_handle(q.enqueued_by), 'target', q.target_branch,
    'position', case when q.status in ('queued', 'testing') then (
      select count(*) from public.merge_queue o
       where o.workspace_id = q.workspace_id and o.target_branch = q.target_branch and o.status in ('queued', 'testing')
         and (o.queued_at, o.id) <= (q.queued_at, q.id)) end,
    'test_commit', q.spec_commit,
    'test_branch', case when q.spec_commit is not null and exists (
                     select 1 from public.branches b where b.workspace_id = q.workspace_id
                        and b.name = public.ws_queue_branch_name(q.target_branch, cr.number)) then public.ws_queue_branch_name(q.target_branch, cr.number) end,
    'checks', case when q.spec_commit is not null then public.cr_checks_state(q.change_request_id, q.spec_commit,
                     (select b.required_checks from public.branches b where b.workspace_id = q.workspace_id and b.name = q.target_branch)) end,
    'landed_commit', q.landed_commit, 'created_at', q.created_at, 'updated_at', q.updated_at, 'finished_at', q.finished_at)
  from public.merge_queue q join public.change_requests cr on cr.id = q.change_request_id
  where q.id = p_entry
$$;

-- Put a change request in its target's queue. It waits while its requirements are unmet, lines up once
-- they are met, and lands in order. p_system: verified work (no approvals needed). Without p_method,
-- the branch's first merge method.
create function public.cr_enqueue(p_cr uuid, p_agent uuid, p_method text default null, p_system boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  b public.branches;
  v_id bigint;
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
begin
  select * into cr from public.change_requests where id = p_cr;
  if not found then
    raise exception 'Change request not found' using errcode = 'PT404';
  end if;
  if v_method is not null and v_method not in ('merge', 'squash', 'rebase') then
    raise exception 'method must be merge, squash or rebase' using errcode = 'PT400';
  end if;
  if p_agent is not null then
    perform public.ws_assert_read(cr.workspace_id, p_agent);
    if public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 2 and p_agent is distinct from cr.author_agent_id then
      raise exception 'Only the author and writers can queue a change request' using errcode = 'PT403';
    end if;
  end if;
  if cr.status = 'draft' then
    raise exception 'Change request #% is a draft; mark it ready first', cr.number using errcode = 'PT409';
  end if;
  if cr.status <> 'open' then
    raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
  end if;
  select * into b from public.branches where workspace_id = cr.workspace_id and name = cr.target_branch;
  if not found then
    raise exception 'The target branch "%" no longer exists', cr.target_branch using errcode = 'PT409';
  end if;
  v_method := coalesce(v_method, b.merge_methods[1]);
  if not (v_method = any (b.merge_methods)) then
    if coalesce(p_system, false) then
      v_method := b.merge_methods[1];
    else
      raise exception '"%" takes % merges', b.name, array_to_string(b.merge_methods, ' or ') using errcode = 'PT409';
    end if;
  end if;
  select id into v_id from public.merge_queue where change_request_id = p_cr and status in ('waiting', 'queued', 'testing');
  if v_id is null then
    insert into public.merge_queue (workspace_id, target_branch, change_request_id, method, system, enqueued_by)
    values (cr.workspace_id, cr.target_branch, p_cr, v_method, coalesce(p_system, false), p_agent)
    returning id into v_id;
  else
    update public.merge_queue set method = v_method, system = system or coalesce(p_system, false), updated_at = now()
     where id = v_id;
  end if;
  perform public.ws_queue_process(cr.workspace_id, cr.target_branch);
  return public.cr_queue_json(v_id);
end
$$;

create function public.cr_dequeue(p_cr uuid, p_agent uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  q public.merge_queue;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into q from public.merge_queue where change_request_id = p_cr and status in ('waiting', 'queued', 'testing');
  if not found then
    raise exception 'Change request #% is not in a merge queue', cr.number using errcode = 'PT404';
  end if;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  if p_agent is distinct from cr.author_agent_id and p_agent is distinct from q.enqueued_by
     and public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 3 then
    raise exception 'Only the author, whoever queued it, or a maintainer can take it out of the queue' using errcode = 'PT403';
  end if;
  perform public.ws_queue_finish(q.id, 'cancelled', coalesce(nullif(btrim(p_reason), ''), format('Taken out by @%s', public.ws_handle(p_agent))));
  perform public.ws_queue_process(cr.workspace_id, cr.target_branch);
  return public.cr_queue_json(q.id);
end
$$;

-- End a queue entry (landed, failed or cancelled) and remove its test branch.
create function public.ws_queue_finish(p_entry bigint, p_status text, p_reason text, p_commit text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.merge_queue;
  v_number int;
begin
  update public.merge_queue
     set status = p_status, reason = left(p_reason, 1000), landed_commit = p_commit, finished_at = now(), updated_at = now()
   where id = p_entry
   returning * into q;
  select number into v_number from public.change_requests where id = q.change_request_id;
  perform public.ws_queue_set_branch(q.workspace_id, public.ws_queue_branch_name(q.target_branch, v_number), null);
end
$$;

-- Move a queue along: mark entries waiting or ready, build each ready one's test commit on the one ahead
-- (up to the branch's queue_depth), and land from the front whatever passed its checks. Serialized per
-- queue; safe to call any time.
create function public.ws_queue_process(p_ws uuid, p_target text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.branches;
  q public.merge_queue;
  cr public.change_requests;
  w public.workspaces;
  v_reasons text[];
  v_base text;
  v_head text;
  v_comp jsonb;
  v_spec text;
  v_checks jsonb;
  v_built int := 0;
  v_landed int := 0;
  v_failed boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('posterity-queue:' || p_ws || ':' || p_target, 0));
  select * into w from public.workspaces where id = p_ws;
  select * into b from public.branches where workspace_id = p_ws and name = p_target for update;
  if not found then
    for q in select * from public.merge_queue where workspace_id = p_ws and target_branch = p_target
                                                 and status in ('waiting', 'queued', 'testing') loop
      perform public.ws_queue_finish(q.id, 'cancelled', format('The branch "%s" no longer exists', p_target));
    end loop;
    return jsonb_build_object('landed', 0, 'built', 0);
  end if;

  -- 1. Who is ready.
  for q in select * from public.merge_queue where workspace_id = p_ws and target_branch = p_target
                                               and status in ('waiting', 'queued', 'testing') order by id loop
    select * into cr from public.change_requests where id = q.change_request_id;
    if cr.status = 'merged' then
      perform public.ws_queue_finish(q.id, 'landed', 'Merged some other way', cr.merged_commit);
      continue;
    end if;
    if cr.status <> 'open' or cr.target_branch <> p_target then
      perform public.ws_queue_finish(q.id, 'cancelled',
        case when cr.status <> 'open' then format('The change request is %s', cr.status)
             else format('The change request now aims at %s', cr.target_branch) end);
      continue;
    end if;
    v_reasons := public.cr_merge_blockers(cr.id, case when q.system then null else coalesce(q.enqueued_by, cr.author_agent_id) end,
                                          true, q.method);
    if cardinality(v_reasons) > 0 then
      if q.status <> 'waiting' or q.reason is distinct from v_reasons[1] then
        update public.merge_queue
           set status = 'waiting', reason = left(v_reasons[1], 1000), queued_at = null, spec_base = null, spec_head = null,
               spec_commit = null, updated_at = now()
         where id = q.id;
        perform public.ws_queue_set_branch(p_ws, public.ws_queue_branch_name(p_target, cr.number), null);
      end if;
      continue;
    end if;
    if q.status = 'waiting' then
      update public.merge_queue set status = 'queued', reason = null, queued_at = clock_timestamp(), updated_at = now() where id = q.id;
    end if;
  end loop;

  -- 2. Test commits, each on the one ahead of it.
  v_base := b.head;
  for q in select * from public.merge_queue where workspace_id = p_ws and target_branch = p_target
                                               and status in ('queued', 'testing') order by queued_at, id loop
    exit when v_built >= b.queue_depth;
    select * into cr from public.change_requests where id = q.change_request_id;
    select head into v_head from public.branches where workspace_id = p_ws and name = cr.source_branch;
    if v_head is null then
      perform public.ws_queue_finish(q.id, 'failed', format('Its branch "%s" no longer exists', cr.source_branch));
      continue;
    end if;
    if q.status = 'testing' and q.spec_commit is not null and q.spec_base = v_base and q.spec_head = v_head then
      v_base := q.spec_commit;
      v_built := v_built + 1;
      continue;
    end if;
    begin
      v_comp := public.ws_compose(p_ws, v_base, v_head, q.method, public.cr_merge_message(cr.id, q.method),
                                  coalesce(q.enqueued_by, cr.author_agent_id));
    exception when others then
      v_comp := jsonb_build_object('status', 'error', 'error', sqlerrm);
    end;
    if v_comp ->> 'status' = 'pending' then
      perform public.ws_request_merges(p_ws, v_comp -> 'pending');
      update public.merge_queue set status = 'queued', reason = 'Waiting for the code worker (line merges or renames)', spec_commit = null, updated_at = now()
       where id = q.id;
      exit;
    end if;
    if v_comp ->> 'status' in ('conflict', 'error') then
      perform public.ws_queue_finish(q.id, 'failed',
        coalesce(v_comp ->> 'error', format('Conflicts with what is ahead of it: %s. Merge %s into %s with resolutions, then queue it again.',
          (select string_agg(x ->> 'path', ', ') from (select x from jsonb_array_elements(v_comp -> 'conflicts') x limit 20) y),
          p_target, cr.source_branch)));
      perform public.notify_agent(cr.author_agent_id, 'cr_queue_failed', format('%s #%s left the merge queue', w.slug, cr.number),
        (select reason from public.merge_queue where id = q.id), jsonb_build_object('workspace', w.slug, 'number', cr.number));
      continue;
    end if;
    v_spec := v_comp ->> 'commit';
    update public.merge_queue
       set status = 'testing', reason = null, spec_base = v_base, spec_head = v_head, spec_commit = v_spec, updated_at = now()
     where id = q.id;
    if cardinality(b.required_checks) > 0 then
      perform public.ws_queue_set_branch(p_ws, public.ws_queue_branch_name(p_target, cr.number), v_spec);
      perform public.notify_agent(cr.author_agent_id, 'cr_queue_testing', format('%s #%s is being tested in the merge queue', w.slug, cr.number),
        format('Run %s on %s (branch %s) and report them on the change request with commit: %s.',
               array_to_string(b.required_checks, ', '), left(v_spec, 12), public.ws_queue_branch_name(p_target, cr.number), v_spec),
        jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_spec));
    end if;
    v_base := v_spec;
    v_built := v_built + 1;
  end loop;

  -- 3. Land from the front.
  loop
    select * into q from public.merge_queue where workspace_id = p_ws and target_branch = p_target and status in ('queued', 'testing')
     order by queued_at, id limit 1;
    exit when not found or q.status <> 'testing' or q.spec_base is distinct from b.head;
    if cardinality(b.required_checks) > 0 then
      v_checks := public.cr_checks_state(q.change_request_id, q.spec_commit, b.required_checks);
      if jsonb_array_length(v_checks -> 'failed') > 0 then
        select * into cr from public.change_requests where id = q.change_request_id;
        perform public.ws_queue_finish(q.id, 'failed', format('Checks failed on its test commit: %s',
          (select string_agg(x, ', ') from jsonb_array_elements_text(v_checks -> 'failed') x)));
        perform public.notify_agent(cr.author_agent_id, 'cr_queue_failed', format('%s #%s left the merge queue', w.slug, cr.number),
          (select reason from public.merge_queue where id = q.id), jsonb_build_object('workspace', w.slug, 'number', cr.number));
        -- What was built on it is rebuilt on the target as it is.
        update public.merge_queue set spec_commit = null, spec_base = null, status = 'queued', updated_at = now()
         where workspace_id = p_ws and target_branch = p_target and status = 'testing';
        v_failed := true;
        exit;
      end if;
      exit when jsonb_array_length(v_checks -> 'pending') > 0;
    end if;
    select * into cr from public.change_requests where id = q.change_request_id;
    if q.spec_commit <> b.head then
      perform public.ws_move_branch(p_ws, p_target, q.spec_commit, b.head);
    end if;
    perform public.ws_queue_finish(q.id, 'landed', null, q.spec_commit);
    perform public.cr_mark_landed(cr.id, case when q.system then null else q.enqueued_by end, q.spec_commit, q.spec_head,
                                  case when q.spec_commit = q.spec_head then 'fast_forward' else q.method end);
    select * into b from public.branches where workspace_id = p_ws and name = p_target;
    v_landed := v_landed + 1;
  end loop;
  if v_failed then
    -- The failed entry is out, so this ends; the lock is the same transaction's.
    v_comp := public.ws_queue_process(p_ws, p_target);
    return jsonb_build_object('landed', v_landed + (v_comp ->> 'landed')::int, 'built', (v_comp ->> 'built')::int);
  end if;
  return jsonb_build_object('landed', v_landed, 'built', v_built);
end
$$;

-- Move the queue a change request is in, if it is in one; never fails the caller.
create function public.ws_queue_touch(p_cr uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.merge_queue;
begin
  select * into q from public.merge_queue where change_request_id = p_cr and status in ('waiting', 'queued', 'testing');
  if found then
    begin
      perform public.ws_queue_process(q.workspace_id, q.target_branch);
    exception when others then
      raise warning 'ws_queue_touch %: %', p_cr, sqlerrm;
    end;
  end if;
end
$$;

create function public.ws_queue_list(p_ws uuid, p_agent uuid, p_target text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  return coalesce((
    select jsonb_agg(public.cr_queue_json(q.id) || jsonb_build_object('number', cr.number, 'title', cr.title,
                                                                      'author', public.ws_handle(cr.author_agent_id))
                     order by q.target_branch, q.status = 'waiting', q.queued_at, q.id)
      from public.merge_queue q join public.change_requests cr on cr.id = q.change_request_id
     where q.workspace_id = p_ws and q.status in ('waiting', 'queued', 'testing')
       and (p_target is null or q.target_branch = p_target)), '[]'::jsonb);
end
$$;

-- -----------------------------------------------------------------------------
-- X. Reviews, checks and the sweep move queues along
-- -----------------------------------------------------------------------------

create or replace function public.review_change_request(p_cr uuid, p_agent uuid, p_verdict text, p_body text default '',
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
  if p_verdict <> 'comment' then
    perform public.ws_queue_touch(p_cr);
  end if;
  return jsonb_build_object('review_id', v_review, 'verdict', p_verdict, 'commit', cr.head_commit, 'independent', v_independent,
                            'comments', jsonb_array_length(v_comments), 'review_state', public.cr_approval_state(p_cr));
end
$$;

create or replace function public.cr_report_check(p_cr uuid, p_agent uuid, p_name text, p_status text, p_details text default null,
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
  if p_status in ('passed', 'failed', 'neutral') then
    perform public.ws_queue_touch(p_cr);
  end if;
  return to_jsonb(v_row);
end
$$;

-- GitHub's check runs and statuses reach a change request's latest commit, and its test commit in a
-- merge queue.
create or replace function public.gh_record_check(p_repo bigint, p_sha text, p_name text, p_status text, p_details text default null,
                                                  p_url text default null)
returns integer
language plpgsql
security definer
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
  for cr in select * from public.change_requests c
             where c.status in ('draft', 'open')
               and (c.head_commit = v_commit
                    or c.id in (select q.change_request_id from public.merge_queue q where q.spec_commit = v_commit and q.status = 'testing')) loop
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
    if p_status in ('passed', 'failed', 'neutral') then
      perform public.ws_queue_touch(cr.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Verified work lands through the target's queue when it has one.
create or replace function public.ws_on_submission_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  m public.missions;
  v_res jsonb;
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
      v_res := public.merge_change_request(cr.id, null, null, null, true);
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

-- Every minute: stale change requests, stacks to move, verified work waiting on line merges, queues,
-- and the worker's jobs.
create or replace function public.code_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  r record;
begin
  for v in select id from public.change_requests where needs_refresh and status in ('draft', 'open')
            order by updated_at limit 25 loop
    begin
      perform public.cr_refresh(v);
    exception when others then
      raise warning 'code_sweep refresh %: %', v, sqlerrm;
    end;
  end loop;
  for v in select id from public.change_requests where restack_from is not null and status in ('draft', 'open')
            order by updated_at limit 10 loop
    begin
      perform public.cr_restack_one(v);
    exception when others then
      raise warning 'code_sweep restack %: %', v, sqlerrm;
    end;
  end loop;
  for v in select cr.id from public.change_requests cr
            where cr.status = 'open' and cr.verified_at is not null and cr.mergeable is true
              and exists (select 1 from public.submissions s where s.id = cr.submission_id and s.commit_id = cr.head_commit)
              and not exists (select 1 from public.merge_queue q where q.change_request_id = cr.id and q.status in ('waiting', 'queued', 'testing'))
            order by cr.updated_at limit 10 loop
    begin
      perform public.merge_change_request(v, null, null, null, true);
    exception when others then
      raise warning 'code_sweep merge %: %', v, sqlerrm;
    end;
  end loop;
  for r in select distinct workspace_id, target_branch from public.merge_queue
            where status in ('waiting', 'queued', 'testing') limit 20 loop
    begin
      perform public.ws_queue_process(r.workspace_id, r.target_branch);
    exception when others then
      raise warning 'code_sweep queue %/%: %', r.workspace_id, r.target_branch, sqlerrm;
    end;
  end loop;
  if exists (select 1 from public.merge_jobs where locked_until is null or locked_until < now()) then
    perform public.kick_code_worker();
  end if;
end
$$;

-- After the worker stored results: refresh what waited on it, move stacks and queues along.
create or replace function public.code_after(p_workspaces uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  r record;
  n int := 0;
begin
  for v in select id from public.change_requests
            where workspace_id = any (coalesce(p_workspaces, '{}')) and status in ('draft', 'open')
              and (mergeable is null or needs_refresh)
            order by updated_at limit 50 loop
    begin
      perform public.cr_refresh(v);
      n := n + 1;
    exception when others then
      raise warning 'code_after refresh %: %', v, sqlerrm;
    end;
  end loop;
  for v in select id from public.change_requests
            where workspace_id = any (coalesce(p_workspaces, '{}')) and restack_from is not null and status in ('draft', 'open') loop
    begin
      perform public.cr_restack_one(v);
    exception when others then
      raise warning 'code_after restack %: %', v, sqlerrm;
    end;
  end loop;
  for r in select distinct workspace_id, target_branch from public.merge_queue
            where workspace_id = any (coalesce(p_workspaces, '{}')) and status in ('waiting', 'queued', 'testing') loop
    begin
      perform public.ws_queue_process(r.workspace_id, r.target_branch);
    exception when others then
      raise warning 'code_after queue %/%: %', r.workspace_id, r.target_branch, sqlerrm;
    end;
  end loop;
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- XI. What agents and people read
-- -----------------------------------------------------------------------------

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
    'merge_state', cr.merge_state, 'merge_method', cr.merge_method,
    'protected_target', coalesce((select b.protected from public.branches b where b.workspace_id = w.id and b.name = cr.target_branch), false),
    'task_id', cr.task_id, 'submission_id', cr.submission_id, 'verified_at', cr.verified_at,
    'merged_commit', cr.merged_commit, 'merged_by', public.ws_handle(cr.merged_by), 'merged_at', cr.merged_at,
    'closed_at', cr.closed_at, 'created_at', cr.created_at, 'updated_at', cr.updated_at,
    'review_state', public.cr_approval_state(cr.id),
    'blocked_by', case when cr.status = 'open' then to_jsonb(public.cr_merge_blockers(cr.id, cr.author_agent_id, false,
                     coalesce((select b.merge_methods[1] from public.branches b where b.workspace_id = w.id and b.name = cr.target_branch), 'merge'))) end,
    'queue', (select public.cr_queue_json(q.id) from public.merge_queue q where q.change_request_id = cr.id order by q.id desc limit 1),
    'stack', jsonb_build_object(
      'depends_on', (select o.number from public.change_requests o where o.workspace_id = w.id and o.status in ('draft', 'open')
                      and o.source_branch = cr.target_branch order by o.number limit 1),
      'dependents', coalesce((select jsonb_agg(o.number order by o.number) from public.change_requests o
                               where o.workspace_id = w.id and o.status in ('draft', 'open') and o.target_branch = cr.source_branch), '[]'::jsonb)),
    'claims_touched', cr.claim_overlaps,
    'size', jsonb_build_object('files', coalesce((cr.merge_state ->> 'files')::int, 0),
                               'large', coalesce((cr.merge_state ->> 'files')::int, 0) > 300),
    'pull_request', (select jsonb_build_object('number', pr.number, 'url', pr.url, 'state', pr.state)
                       from public.cr_pull_requests pr join public.workspace_remotes r on r.repo_id = pr.repo_id
                      where pr.change_request_id = cr.id and not r.repo_private))
  from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
  where cr.id = p_cr
$$;

create or replace function public.ws_detail(p_ws uuid, p_agent uuid)
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
      select jsonb_agg(public.ws_branch_json(b) order by b.name = w.default_branch desc, starts_with(b.name, 'queue/'), b.updated_at desc)
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
         order by cr.number desc limit 20) x), '[]'::jsonb),
    'queue', (select count(*) from public.merge_queue q where q.workspace_id = p_ws and q.status in ('waiting', 'queued', 'testing')),
    'claims', (select count(*) from public.path_claims c where c.workspace_id = p_ws and c.released_at is null and c.expires_at > now()));
end
$$;

-- What the heartbeat shows about code: review requests, your change requests and queue entries, your
-- claims, and change requests touching them.
create or replace function public.agent_code_inbox(p_agent uuid)
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
                 'head_commit', cr.head_commit, 'requested_at', rr.created_at,
                 'you_own_files', exists (select 1 from jsonb_array_elements(cr.owner_groups) g
                                           where p_agent = any (public.ws_owner_agents(g -> 'owners')))) as j
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
                 'queue', (select jsonb_build_object('status', q.status, 'reason', q.reason) from public.merge_queue q
                            where q.change_request_id = cr.id and q.status in ('waiting', 'queued', 'testing')),
                 'updated_at', cr.updated_at) as j
          from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
         where cr.author_agent_id = p_agent and cr.status in ('draft', 'open')
         order by cr.updated_at desc limit 10) x), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('workspace', w.slug, 'pattern', c.pattern, 'until', c.expires_at) order by c.expires_at)
        from public.path_claims c join public.workspaces w on w.id = c.workspace_id
       where c.agent_id = p_agent and c.released_at is null and c.expires_at > now()), '[]'::jsonb),
    'touching_your_claims', coalesce((
      select jsonb_agg(x.j) from (
        select jsonb_build_object('workspace', w.slug, 'number', cr.number, 'title', cr.title, 'author', public.ws_handle(cr.author_agent_id),
                                  'paths', (select jsonb_agg(distinct y ->> 'path') from jsonb_array_elements(cr.claim_overlaps) y
                                             where y ->> 'agent' = public.ws_handle(p_agent))) as j
          from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
         where cr.status in ('draft', 'open') and cr.author_agent_id is distinct from p_agent
           and exists (select 1 from jsonb_array_elements(cr.claim_overlaps) y where y ->> 'agent' = public.ws_handle(p_agent))
         order by cr.updated_at desc limit 10) x), '[]'::jsonb))
$$;

-- For the code pages: a change request's queue entry, owners, checks, stack and claims.
create function public.web_cr_status(p_slug text, p_number int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_cr uuid;
begin
  select id into v_ws from public.workspaces where slug = lower(btrim(coalesce(p_slug, '')));
  if v_ws is null or not public.ws_readable(v_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  select id into v_cr from public.change_requests where workspace_id = v_ws and number = p_number;
  if v_cr is null then
    raise exception 'No change request #%', p_number using errcode = 'PT404';
  end if;
  return (select jsonb_build_object('queue', j -> 'queue', 'review_state', j -> 'review_state', 'stack', j -> 'stack',
                                    'claims_touched', j -> 'claims_touched', 'blocked_by', j -> 'blocked_by', 'size', j -> 'size',
                                    'merge_state', j -> 'merge_state', 'merge_method', j -> 'merge_method')
            from (select public.cr_json(v_cr) as j) x);
end
$$;

create function public.web_ws_queue(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select id into v_ws from public.workspaces where slug = lower(btrim(coalesce(p_slug, '')));
  if v_ws is null or not public.ws_readable(v_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'queue', public.ws_queue_list(v_ws, null),
    'claims', coalesce((select jsonb_agg(public.ws_claim_json(c) order by c.prefix, c.created_at) from public.path_claims c
                         where c.workspace_id = v_ws and c.released_at is null and c.expires_at > now()), '[]'::jsonb));
end
$$;

-- -----------------------------------------------------------------------------
-- XII. Privileges
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
  -- Code pages read history, folders, diffs, queues and claims and the GitHub panel through these;
  -- row level security calls ws_readable.
  public.web_ws_log(text, text, text, int, int, text),
  public.web_ws_tree(text, text, text),
  public.web_ws_diff(text, text, text, int),
  public.web_cr_status(text, int),
  public.web_ws_queue(text),
  public.web_workspace_github(uuid),
  public.ws_readable(uuid)
to anon, authenticated;
