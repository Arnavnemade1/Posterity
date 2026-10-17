-- Phase 12.1 and 12.2: code at scale. Storage, history and merging.
--
-- Trees become folders. A commit points at a root folder; a folder (tree_nodes) lists its entries
-- {name: {t: f|x|d, s: sha256, z: bytes, n: files}} and is content-addressed, so a commit that changes
-- one file writes only the folders on that file's path and shares everything else with its parent. "x"
-- is an executable file. Each commit records the paths it changed (commit_changes): a file's history and
-- a mirror's push read those rows instead of comparing whole trees. History walks stop at the
-- generation they need instead of reading back to the first commit.
--
-- Merges are three-way over the paths each side changed since the merge base, so their cost follows
-- the size of the change, not of the tree. A text file both sides changed is merged line by line: the
-- API's code worker computes that once per (base, ours, theirs) and caches it (blob_merges), and it
-- finds files that were renamed and edited (rename_pairs). Until a result is cached the merge is
-- pending: the worker is asked for it (merge_jobs) and a change request reports mergeable: null.
-- Squash and rebase merges, rebasing a branch and cherry-picking a commit use the same machinery.
--
-- Expand only: every function the deployed API calls keeps working with the arguments it passes.
-- Commits of trees with up to 5000 files still get the flat manifest the current web app reads; a
-- later contract migration drops trees and commits.tree.

-- -----------------------------------------------------------------------------
-- I. Tables
-- -----------------------------------------------------------------------------

create table public.tree_nodes (
  sha256      text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  entries     jsonb not null check (jsonb_typeof(entries) = 'object'),
  file_count  int not null,
  total_bytes bigint not null,
  created_at  timestamptz not null default now()
);

alter table public.commits add column root text references public.tree_nodes (sha256);
alter table public.commits alter column tree drop not null;
create index commits_root_idx on public.commits (root);

-- What each commit changed relative to its first parent.
create table public.commit_changes (
  commit_id    text not null references public.commits (id) on delete cascade,
  workspace_id uuid not null,
  path         text not null,
  status       text not null check (status in ('added', 'modified', 'deleted')),
  old_blob     text,
  old_mode     text check (old_mode in ('f', 'x')),
  new_blob     text,
  new_mode     text check (new_mode in ('f', 'x')),
  primary key (commit_id, path)
);

-- Line-level merges, computed once by the code worker. base_sha is '' for a file new on both sides.
create table public.blob_merges (
  base_sha       text not null,
  ours_sha       text not null,
  theirs_sha     text not null,
  conflict       boolean not null,
  merged_sha     text references public.blobs (sha256) on delete cascade,
  marked_sha     text references public.blobs (sha256) on delete cascade,
  conflict_hunks int not null default 0,
  created_at     timestamptz not null default now(),
  primary key (base_sha, ours_sha, theirs_sha),
  check (conflict or merged_sha is not null)
);
create index blob_merges_merged_sha_idx on public.blob_merges (merged_sha);
create index blob_merges_marked_sha_idx on public.blob_merges (marked_sha);

-- Files one side of a merge moved and edited, found by content similarity: {"old/path": "new/path"}.
create table public.rename_pairs (
  base_root  text not null,
  side_root  text not null,
  pairs      jsonb not null check (jsonb_typeof(pairs) = 'object'),
  created_at timestamptz not null default now(),
  primary key (base_root, side_root)
);

-- Work for the code worker: line merges and rename searches a merge is waiting on.
create table public.merge_jobs (
  kind         text not null check (kind in ('content', 'renames')),
  key          text not null,
  payload      jsonb not null,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  attempts     int not null default 0,
  locked_until timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  primary key (kind, key)
);
create index merge_jobs_workspace_id_idx on public.merge_jobs (workspace_id);

alter table public.change_requests
  add column merge_state jsonb not null default '{}',
  add column needs_refresh boolean not null default false,
  add column merge_method text check (merge_method in ('merge', 'squash', 'rebase', 'fast_forward'));
create index change_requests_needs_refresh_idx on public.change_requests (workspace_id) where needs_refresh;

alter table public.tree_nodes enable row level security;
alter table public.commit_changes enable row level security;
alter table public.blob_merges enable row level security;
alter table public.rename_pairs enable row level security;
alter table public.merge_jobs enable row level security;

-- Workspaces hold far more now: a commit no longer copies the whole tree.
alter table public.workspaces drop constraint workspaces_file_limit_check;
alter table public.workspaces drop constraint workspaces_byte_limit_check;
alter table public.workspaces
  add constraint workspaces_file_limit_check check (file_limit between 1 and 1000000),
  add constraint workspaces_byte_limit_check check (byte_limit between 1 and 53687091200);
alter table public.workspaces alter column file_limit set default 100000;
alter table public.workspaces alter column byte_limit set default 2147483648;
update public.workspaces set file_limit = 100000 where file_limit = 5000;
update public.workspaces set byte_limit = 2147483648 where byte_limit = 209715200;

-- -----------------------------------------------------------------------------
-- II. Folders
-- -----------------------------------------------------------------------------

create function public.ws_node_hash(p_entries jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(string_agg((e.value ->> 't') || ' ' || e.key || E'\t' || (e.value ->> 's'), E'\n'
                                                      order by e.key collate "C"), ''), 'sha256'), 'hex')
    from jsonb_each(coalesce(p_entries, '{}'::jsonb)) as e
$$;

-- The empty folder (sha256 of nothing): every workspace starts there.
create function public.ws_empty_root()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'::text
$$;

insert into public.tree_nodes (sha256, entries, file_count, total_bytes)
values (public.ws_empty_root(), '{}', 0, 0)
on conflict (sha256) do nothing;

create function public.ws_root(p_commit text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select root from public.commits where id = p_commit
$$;

-- Apply changes to a folder: [{"p": "relative/path", "s": "<blob sha256>" | null to delete, "m": "f" | "x"}].
-- A missing "m" keeps the file's mode ("f" for a new file). Returns {node, n, z, conflicts}: node is
-- null for a folder left empty (the root is never null). Strict mode raises on deleting what is not
-- there and on a path used as both a file and a folder; otherwise (merges) those paths are skipped
-- and listed in conflicts.
create function public.ws_tree_edit(p_node text, p_changes jsonb, p_strict boolean default true, p_base text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entries jsonb := '{}'::jsonb;
  v_set jsonb := '{}'::jsonb;
  v_remove text[] := '{}';
  v_nested text[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
  r record;
  v_cur jsonb;
  v_res jsonb;
  v_mode text;
  v_final jsonb;
  v_node text;
  v_n int;
  v_z bigint;
begin
  if p_node is not null then
    select entries into v_entries from public.tree_nodes where sha256 = p_node;
    if not found then
      raise exception 'Unknown folder %', left(p_node, 12) using errcode = 'PT400';
    end if;
  end if;

  -- Files removed from this folder.
  for r in
    select c ->> 'p' as name from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
     where strpos(c ->> 'p', '/') = 0 and c ->> 's' is null
  loop
    v_cur := v_entries -> r.name;
    if v_cur is null or v_cur ->> 't' = 'd' then
      if p_strict then
        if v_cur is null then
          raise exception '"%" is not in the tree, so it cannot be deleted', p_base || r.name using errcode = 'PT400';
        end if;
        raise exception '"%" is a folder: delete the files in it', p_base || r.name using errcode = 'PT400';
      end if;
      if v_cur is not null then
        v_conflicts := v_conflicts || to_jsonb(p_base || r.name);
      end if;
      continue;
    end if;
    v_remove := v_remove || r.name;
  end loop;

  -- Changes inside subfolders, one recursion per subfolder.
  for r in
    select split_part(c ->> 'p', '/', 1) as name,
           jsonb_agg(jsonb_build_object('p', substr(c ->> 'p', strpos(c ->> 'p', '/') + 1), 's', c -> 's', 'm', c -> 'm')) as sub
      from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
     where strpos(c ->> 'p', '/') > 0
     group by 1
  loop
    v_nested := v_nested || r.name;
    v_cur := case when r.name = any (v_remove) then null else v_entries -> r.name end;
    if v_cur is not null and v_cur ->> 't' <> 'd' then
      if p_strict then
        raise exception '"%" cannot be both a file and a folder', p_base || r.name using errcode = 'PT400';
      end if;
      v_conflicts := v_conflicts || coalesce((select jsonb_agg(p_base || r.name || '/' || (x ->> 'p')) from jsonb_array_elements(r.sub) x), '[]'::jsonb);
      continue;
    end if;
    v_res := public.ws_tree_edit(v_cur ->> 's', r.sub, p_strict, p_base || r.name || '/');
    v_conflicts := v_conflicts || (v_res -> 'conflicts');
    if v_res ->> 'node' is null then
      if v_cur is not null then
        v_remove := v_remove || r.name;
      end if;
    elsif v_res ->> 'node' is distinct from v_cur ->> 's' then
      v_set := v_set || jsonb_build_object(r.name, jsonb_build_object('t', 'd', 's', v_res ->> 'node',
                                                                       'z', (v_res ->> 'z')::bigint, 'n', (v_res ->> 'n')::int));
    end if;
  end loop;

  -- Files written in this folder.
  for r in
    select c ->> 'p' as name, c ->> 's' as blob, c ->> 'm' as mode, b.size
      from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
      left join public.blobs b on b.sha256 = c ->> 's'
     where strpos(c ->> 'p', '/') = 0 and c ->> 's' is not null
  loop
    if r.size is null then
      raise exception 'Unknown blob % for "%"', left(r.blob, 12), p_base || r.name using errcode = 'PT400';
    end if;
    if r.mode is not null and r.mode not in ('f', 'x') then
      raise exception 'Unknown file mode "%" for "%"', r.mode, p_base || r.name using errcode = 'PT400';
    end if;
    v_cur := case when r.name = any (v_remove) then null when v_set ? r.name then v_set -> r.name else v_entries -> r.name end;
    if r.name = any (v_nested) or v_cur ->> 't' = 'd' then
      if p_strict then
        raise exception '"%" cannot be both a file and a folder', p_base || r.name using errcode = 'PT400';
      end if;
      v_conflicts := v_conflicts || to_jsonb(p_base || r.name);
      continue;
    end if;
    v_mode := coalesce(r.mode, v_cur ->> 't', 'f');
    v_set := v_set || jsonb_build_object(r.name, jsonb_build_object('t', v_mode, 's', r.blob, 'z', r.size));
  end loop;

  if cardinality(v_remove) = 0 and v_set = '{}'::jsonb then
    if p_node is null then
      if p_base = '' then
        return jsonb_build_object('node', public.ws_empty_root(), 'n', 0, 'z', 0, 'conflicts', v_conflicts);
      end if;
      return jsonb_build_object('node', null, 'n', 0, 'z', 0, 'conflicts', v_conflicts);
    end if;
    return (select jsonb_build_object('node', p_node, 'n', file_count, 'z', total_bytes, 'conflicts', v_conflicts)
              from public.tree_nodes where sha256 = p_node);
  end if;

  select coalesce(jsonb_object_agg(x.k, x.v), '{}'::jsonb),
         coalesce(sum(case when x.v ->> 't' = 'd' then (x.v ->> 'n')::int else 1 end), 0),
         coalesce(sum((x.v ->> 'z')::bigint), 0)
    into v_final, v_n, v_z
    from (select e.key as k, e.value as v from jsonb_each(v_entries) e
           where not (e.key = any (v_remove)) and not v_set ? e.key
          union all
          select e.key, e.value from jsonb_each(v_set) e) x;
  if v_final = '{}'::jsonb and p_base <> '' then
    return jsonb_build_object('node', null, 'n', 0, 'z', 0, 'conflicts', v_conflicts);
  end if;
  v_node := public.ws_node_hash(v_final);
  insert into public.tree_nodes (sha256, entries, file_count, total_bytes)
  values (v_node, v_final, v_n, v_z)
  on conflict (sha256) do nothing;
  return jsonb_build_object('node', v_node, 'n', v_n, 'z', v_z, 'conflicts', v_conflicts);
end
$$;

-- The entry at a path under a root: {t, s, z, n} or null. '' is the root itself.
create function public.ws_tree_entry(p_root text, p_path text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path text := btrim(coalesce(p_path, ''), '/');
  v_node text := p_root;
  v_entry jsonb;
  v_seg text;
begin
  if v_path = '' then
    return (select jsonb_build_object('t', 'd', 's', n.sha256, 'z', n.total_bytes, 'n', n.file_count)
              from public.tree_nodes n where n.sha256 = p_root);
  end if;
  foreach v_seg in array string_to_array(v_path, '/') loop
    if v_node is null then
      return null;
    end if;
    select n.entries -> v_seg into v_entry from public.tree_nodes n where n.sha256 = v_node;
    if v_entry is null then
      return null;
    end if;
    v_node := case when v_entry ->> 't' = 'd' then v_entry ->> 's' end;
  end loop;
  return v_entry;
end
$$;

-- Every file under a folder, with its path (prefixed by p_prefix).
create function public.ws_walk(p_node text, p_prefix text default '')
returns table (path text, mode text, blob text, size bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive w(path, t, s, z) as (
    select case when coalesce(p_prefix, '') = '' then e.key else p_prefix || '/' || e.key end,
           e.value ->> 't', e.value ->> 's', (e.value ->> 'z')::bigint
      from public.tree_nodes n
      cross join lateral jsonb_each(n.entries) e
     where n.sha256 = p_node
    union all
    select w.path || '/' || e.key, e.value ->> 't', e.value ->> 's', (e.value ->> 'z')::bigint
      from w
      join public.tree_nodes n on n.sha256 = w.s
      cross join lateral jsonb_each(n.entries) e
     where w.t = 'd'
  )
  select w.path, w.t, w.s, w.z from w where w.t <> 'd'
$$;

-- The flat {path: blob} form, for small trees and compatibility.
create function public.ws_flatten(p_root text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(w.path, w.blob), '{}'::jsonb) from public.ws_walk(p_root, '') w
$$;

create or replace function public.ws_manifest(p_commit text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.ws_flatten((select root from public.commits where id = p_commit))
$$;

-- A root from a flat manifest; p_modes marks executables: {"path": "x"}.
create function public.ws_tree_from_manifest(p_manifest jsonb, p_modes jsonb default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.ws_tree_edit(null, coalesce((
    select jsonb_agg(jsonb_build_object('p', e.key, 's', e.value,
                                        'm', case when coalesce(p_modes, '{}'::jsonb) ->> e.key = 'x' then 'x' else 'f' end))
      from jsonb_each_text(coalesce(p_manifest, '{}'::jsonb)) e), '[]'::jsonb), true, '') ->> 'node';
end
$$;

-- -----------------------------------------------------------------------------
-- III. Differences between trees
-- -----------------------------------------------------------------------------

-- Files that differ between two roots, skipping every folder both share.
create function public.ws_diff_roots(p_a text, p_b text)
returns table (path text, old_blob text, old_mode text, new_blob text, new_mode text)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive d(path, at, sa, bt, sb) as (
    select ''::text, 'd'::text, p_a, 'd'::text, p_b
     where p_a is distinct from p_b
    union all
    select case when d.path = '' then x.k else d.path || '/' || x.k end, x.at, x.sa, x.bt, x.sb
      from d
      cross join lateral (
        select coalesce(ea.key, eb.key) as k,
               ea.value ->> 't' as at, ea.value ->> 's' as sa, eb.value ->> 't' as bt, eb.value ->> 's' as sb
          from jsonb_each(case when d.at = 'd'
                               then coalesce((select n.entries from public.tree_nodes n where n.sha256 = d.sa), '{}'::jsonb)
                               else '{}'::jsonb end) ea
          full join jsonb_each(case when d.bt = 'd'
                                    then coalesce((select n.entries from public.tree_nodes n where n.sha256 = d.sb), '{}'::jsonb)
                                    else '{}'::jsonb end) eb
            on eb.key = ea.key
         where (ea.value ->> 's') is distinct from (eb.value ->> 's') or (ea.value ->> 't') is distinct from (eb.value ->> 't')
      ) x
     where d.at = 'd' or d.bt = 'd'
  )
  select d.path,
         case when d.at in ('f', 'x') then d.sa end, case when d.at in ('f', 'x') then d.at end,
         case when d.bt in ('f', 'x') then d.sb end, case when d.bt in ('f', 'x') then d.bt end
    from d
   where d.path <> '' and (d.at in ('f', 'x') or d.bt in ('f', 'x'))
$$;

-- A diff as the API shows it. With p_renames, a deleted file and an added file with the same content
-- are one "renamed" file.
create function public.ws_diff_json(p_a text, p_b text, p_renames boolean default false, p_limit int default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select * from public.ws_diff_roots(coalesce(p_a, public.ws_empty_root()), p_b)),
  dels as (
    select d.path, d.old_blob, d.old_mode, row_number() over (partition by d.old_blob order by d.path collate "C") as n
      from d where d.new_blob is null and coalesce(p_renames, false)
  ),
  adds as (
    select d.path, d.new_blob, row_number() over (partition by d.new_blob order by d.path collate "C") as n
      from d where d.old_blob is null and coalesce(p_renames, false)
  ),
  ren as (
    select dels.path as old_path, dels.old_mode, adds.path as new_path
      from dels join adds on adds.new_blob = dels.old_blob and adds.n = dels.n
  ),
  files as (
    select d.path, d.new_blob, d.new_mode, r.old_path,
           coalesce(d.old_blob, case when r.old_path is not null then d.new_blob end) as old_blob,
           coalesce(d.old_mode, r.old_mode) as old_mode,
           case when r.old_path is not null then 'renamed' when d.old_blob is null then 'added'
                when d.new_blob is null then 'deleted' else 'modified' end as status
      from d
      left join ren r on r.new_path = d.path
     where not exists (select 1 from ren r2 where r2.old_path = d.path)
  ),
  page as (
    select f.* from files f order by f.path collate "C" limit coalesce(p_limit, 2147483647)
  )
  select jsonb_build_object(
    'total', (select count(*) from files),
    'truncated', (select count(*) from files) > coalesce(p_limit, 2147483647),
    'files', coalesce((
      select jsonb_agg(
               jsonb_build_object('path', p.path, 'status', p.status, 'old_sha', p.old_blob, 'new_sha', p.new_blob,
                                  'old_size', ob.size, 'new_size', nb.size, 'binary', coalesce(nb.is_binary, ob.is_binary, false))
               || case when p.old_path is not null then jsonb_build_object('old_path', p.old_path) else '{}'::jsonb end
               || case when p.new_mode = 'x' then jsonb_build_object('executable', true) else '{}'::jsonb end
               || case when p.old_mode is not null and p.new_mode is not null and p.old_mode <> p.new_mode
                       then jsonb_build_object('mode_changed', true) else '{}'::jsonb end
               order by p.path collate "C")
        from page p
        left join public.blobs ob on ob.sha256 = p.old_blob
        left join public.blobs nb on nb.sha256 = p.new_blob), '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- IV. History
-- -----------------------------------------------------------------------------

-- Ancestors of a commit down to a generation: complete above it, because every path from a commit to
-- an ancestor passes only through higher generations.
drop function public.ws_ancestors(text);
create function public.ws_ancestors(p_commit text, p_min_generation int default 1)
returns table (id text, generation int)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive anc(id) as (
    select c.id from public.commits c where c.id = p_commit and c.generation >= coalesce(p_min_generation, 1)
    union
    select pc.id
      from anc
      join public.commits c on c.id = anc.id
      cross join lateral unnest(c.parents) as p(parent)
      join public.commits pc on pc.id = p.parent
     where pc.generation >= coalesce(p_min_generation, 1)
  )
  select a.id, c.generation from anc a join public.commits c on c.id = a.id
$$;

create or replace function public.ws_is_ancestor(p_a text, p_b text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a = p_b or coalesce((
    select ca.generation < cb.generation
           and exists (select 1 from public.ws_ancestors(p_b, ca.generation) x where x.id = p_a)
      from public.commits ca, public.commits cb
     where ca.id = p_a and cb.id = p_b), false)
$$;

-- The nearest common ancestor, looking back a widening window of generations.
create or replace function public.ws_merge_base(p_a text, p_b text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ga int;
  v_gb int;
  v_floor int;
  v_window int := 64;
  v_base text;
begin
  select generation into v_ga from public.commits where id = p_a;
  select generation into v_gb from public.commits where id = p_b;
  if v_ga is null or v_gb is null then
    return null;
  end if;
  loop
    v_floor := greatest(least(v_ga, v_gb) - v_window, 1);
    select x.id into v_base
      from public.ws_ancestors(p_a, v_floor) x
      join public.ws_ancestors(p_b, v_floor) y on y.id = x.id
     order by x.generation desc, x.id
     limit 1;
    if v_base is not null or v_floor = 1 then
      return v_base;
    end if;
    v_window := v_window * 4;
  end loop;
end
$$;

-- One page of history from a head, newest first; with a path, the commits that changed it (or
-- anything under it). Continue with p_before: the last commit of the previous page ("next").
create function public.ws_log_page(p_ws uuid, p_head text, p_path text, p_limit int, p_offset int, p_before text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(coalesce(p_path, ''), '/ '), '');
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_before text := nullif(btrim(coalesce(p_before, '')), '');
  v_top int;
  v_window int;
  v_floor int;
  c_gen int;
  c_at timestamptz;
  c_id text;
  v_rows jsonb;
  v_n int;
begin
  select generation into v_top from public.commits where id = p_head;
  if v_before is not null then
    select c.generation, c.created_at, c.id into c_gen, c_at, c_id
      from public.commits c
     where c.workspace_id = p_ws and (c.id = v_before or (char_length(v_before) >= 7 and c.id like v_before || '%'))
     limit 1;
    if c_id is null then
      raise exception 'No commit "%" in this workspace', v_before using errcode = 'PT404';
    end if;
    v_top := least(v_top, c_gen);
  end if;
  v_window := greatest((v_offset + v_limit) * 2, 64);
  loop
    v_floor := greatest(v_top - v_window, 1);
    select coalesce(jsonb_agg(x.j order by x.generation desc, x.created_at desc, x.id desc), '[]'::jsonb), count(*)
      into v_rows, v_n
      from (
        select c.generation, c.created_at, c.id,
               jsonb_build_object('id', c.id, 'message', c.message, 'author', public.ws_handle(c.author_agent_id),
                                  'parents', c.parents, 'generation', c.generation, 'stats', c.stats,
                                  'created_at', c.created_at, 'from_github', c.origin is not null) as j
          from public.ws_ancestors(p_head, v_floor) a
          join public.commits c on c.id = a.id
         where (c_id is null or (c.generation, c.created_at, c.id) < (c_gen, c_at, c_id))
           and (v_path is null or exists (select 1 from public.commit_changes cc
                                           where cc.commit_id = c.id and (cc.path = v_path or starts_with(cc.path, v_path || '/'))))
         order by c.generation desc, c.created_at desc, c.id desc
         offset v_offset
         limit v_limit + 1) x;
    exit when v_n > v_limit or v_floor = 1;
    v_window := v_window * 4;
  end loop;
  return jsonb_build_object(
    'head', p_head,
    'commits', case when v_n > v_limit then v_rows - v_limit else v_rows end,
    'next', case when v_n > v_limit then v_rows -> (v_limit - 1) ->> 'id' end);
end
$$;

-- -----------------------------------------------------------------------------
-- V. Writing commits
-- -----------------------------------------------------------------------------

-- Write a commit of this root on top of its parents, record what it changed, and (p_move) move the
-- branch to it. With p_move false the commit is written but no branch moves (rebases, queue tests).
create function public.ws_write_root_commit(p_ws uuid, p_branch text, p_parents text[], p_root text, p_author uuid,
                                           p_message text, p_expected text, p_move boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  n public.tree_nodes;
  v_gen int;
  v_parent_root text;
  v_tree text;
  v_id text;
  v_stats jsonb;
begin
  select * into w from public.workspaces where id = p_ws;
  select * into n from public.tree_nodes where sha256 = p_root;
  if not found then
    raise exception 'Unknown tree %', left(coalesce(p_root, ''), 12) using errcode = 'PT400';
  end if;
  if n.file_count > w.file_limit then
    raise exception 'This workspace holds at most % files; this commit would make %', w.file_limit, n.file_count using errcode = 'PT413';
  end if;
  if n.total_bytes > w.byte_limit then
    raise exception 'This workspace holds at most % MB; this commit would make % MB',
      round(w.byte_limit / 1048576.0), round(n.total_bytes / 1048576.0, 1) using errcode = 'PT413';
  end if;
  select coalesce(max(generation), 0) + 1 into v_gen from public.commits where id = any (coalesce(p_parents, '{}'));
  v_parent_root := case when cardinality(coalesce(p_parents, '{}')) > 0
                        then (select root from public.commits where id = p_parents[1]) else public.ws_empty_root() end;
  -- The flat manifest the current web app reads, while it still does (small trees only).
  if n.file_count <= 5000 then
    v_tree := public.ws_store_tree(public.ws_flatten(p_root));
  end if;
  v_id := encode(extensions.digest(concat_ws(E'\n', p_ws::text, p_root, array_to_string(coalesce(p_parents, '{}'), ','),
                                             coalesce(p_author::text, ''), p_message, clock_timestamp()::text,
                                             gen_random_uuid()::text), 'sha256'), 'hex');
  insert into public.commits (id, workspace_id, tree, root, parents, generation, author_agent_id, message, stats)
  values (v_id, p_ws, v_tree, p_root, coalesce(p_parents, '{}'), v_gen, p_author, p_message, '{}');
  insert into public.commit_changes (commit_id, workspace_id, path, status, old_blob, old_mode, new_blob, new_mode)
  select v_id, p_ws, d.path,
         case when d.old_blob is null then 'added' when d.new_blob is null then 'deleted' else 'modified' end,
         d.old_blob, d.old_mode, d.new_blob, d.new_mode
    from public.ws_diff_roots(coalesce(v_parent_root, public.ws_empty_root()), p_root) d;
  select jsonb_build_object('added', count(*) filter (where c.status = 'added'),
                            'modified', count(*) filter (where c.status = 'modified'),
                            'deleted', count(*) filter (where c.status = 'deleted'),
                            'files', n.file_count, 'bytes', n.total_bytes)
    into v_stats
    from public.commit_changes c where c.commit_id = v_id;
  update public.commits set stats = v_stats where id = v_id;
  update public.workspaces set commit_count = commit_count + 1, last_commit_at = now(), updated_at = now() where id = p_ws;
  if coalesce(p_move, true) then
    perform public.ws_move_branch(p_ws, p_branch, v_id, p_expected);
  end if;
  return jsonb_build_object('commit', v_id, 'branch', p_branch, 'tree', p_root, 'root', p_root,
                            'parents', coalesce(p_parents, '{}'), 'generation', v_gen, 'stats', v_stats);
end
$$;

-- The manifest form, kept for anything still passing whole trees.
create or replace function public.ws_write_commit(p_ws uuid, p_branch text, p_parents text[], p_manifest jsonb, p_author uuid,
                                                  p_message text, p_expected text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.ws_write_root_commit(p_ws, p_branch, p_parents, public.ws_tree_from_manifest(p_manifest), p_author,
                                     p_message, p_expected);
end
$$;

-- Change requests from a branch are refreshed when it moves; ones aimed at it too while there are
-- few, and by the sweep (needs_refresh) when there are many, so a busy main stays fast.
create or replace function public.ws_refresh_crs(p_ws uuid, p_branch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  v_aimed int;
begin
  for v in select id from public.change_requests
            where workspace_id = p_ws and status in ('draft', 'open') and source_branch = p_branch
            order by number loop
    perform public.cr_refresh(v);
  end loop;
  select count(*) into v_aimed from public.change_requests
   where workspace_id = p_ws and status in ('draft', 'open') and target_branch = p_branch and source_branch <> p_branch;
  if v_aimed <= 10 then
    for v in select id from public.change_requests
              where workspace_id = p_ws and status in ('draft', 'open') and target_branch = p_branch
              order by number loop
      perform public.cr_refresh(v);
    end loop;
  else
    update public.change_requests set needs_refresh = true
     where workspace_id = p_ws and status in ('draft', 'open') and target_branch = p_branch;
  end if;
end
$$;

create or replace function public.ws_move_branch(p_ws uuid, p_branch text, p_new_head text, p_expected text)
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
     set file_count = n.file_count, size_bytes = n.total_bytes, updated_at = now()
    from public.commits c join public.tree_nodes n on n.sha256 = c.root
   where w.id = p_ws and w.default_branch = p_branch and c.id = p_new_head;
  perform public.ws_refresh_crs(p_ws, p_branch);
end
$$;

create or replace function public.ws_create_internal(p_name text, p_slug text, p_description text, p_visibility text, p_mission uuid,
                                                     p_org uuid, p_agent uuid, p_protect boolean, p_required integer,
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
  v_commit := encode(extensions.digest(concat_ws(E'\n', v_ws::text, public.ws_empty_root(), 'init', clock_timestamp()::text), 'sha256'), 'hex');
  insert into public.commits (id, workspace_id, tree, root, parents, generation, author_agent_id, message, stats)
  values (v_commit, v_ws, v_tree, public.ws_empty_root(), '{}', 1, p_agent, format('Create %s', btrim(p_name)),
          '{"added": 0, "modified": 0, "deleted": 0, "files": 0, "bytes": 0}');
  insert into public.branches (workspace_id, name, head, protected, created_by)
  values (v_ws, 'main', v_commit, coalesce(p_protect, false), p_agent);
  perform public.log_activity('workspace_created',
    case when p_agent is null then format('The workspace “%s” was created for its mission', btrim(p_name))
         else format('@%s created the workspace “%s”', public.ws_handle(p_agent), btrim(p_name)) end,
    p_agent, null, p_mission, null, jsonb_build_object('workspace', p_slug));
  return v_ws;
end
$$;

-- changes: [{"path": "src/a.ts", "blob": "<sha256>", "executable"?: true|false} | {"path": "old.txt", "delete": true}].
-- Without "executable" a file keeps its mode. A branch that does not exist yet is created from
-- expected_head (or the default branch).
create or replace function public.ws_commit(p_ws uuid, p_agent uuid, p_branch text, p_expected_head text, p_message text, p_changes jsonb)
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
  v_root text;
  v_new text;
  v_path text;
  v_blob text;
  v_dup text;
  v_edits jsonb := '[]'::jsonb;
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

  select x ->> 'path' into v_dup from jsonb_array_elements(p_changes) x
   where jsonb_typeof(x) = 'object' group by x ->> 'path' having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception '"%" appears twice in one commit', v_dup using errcode = 'PT400';
  end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(c) <> 'object' then
      raise exception 'Each change must be an object with "path"' using errcode = 'PT400';
    end if;
    v_path := c ->> 'path';
    if not public.ws_valid_path(v_path) then
      raise exception 'Invalid path "%": use a relative path without "..", ".git" or control characters', v_path using errcode = 'PT400';
    end if;
    if coalesce((c ->> 'delete')::boolean, false) then
      v_edits := v_edits || jsonb_build_array(jsonb_build_object('p', v_path, 's', null));
    else
      v_blob := c ->> 'blob';
      if v_blob is null or v_blob !~ '^[0-9a-f]{64}$' then
        raise exception 'Change "%" needs a blob (its sha256) or "delete": true', v_path using errcode = 'PT400';
      end if;
      if not exists (select 1 from public.workspace_blobs where workspace_id = p_ws and sha256 = v_blob) then
        raise exception 'Blob % (for "%") was not uploaded to this workspace; upload it first', left(v_blob, 12), v_path
          using errcode = 'PT400';
      end if;
      if c ? 'executable' and jsonb_typeof(c -> 'executable') <> 'boolean' then
        raise exception '"executable" must be true or false (for "%")', v_path using errcode = 'PT400';
      end if;
      v_edits := v_edits || jsonb_build_array(jsonb_build_object(
        'p', v_path, 's', v_blob,
        'm', case when not c ? 'executable' then null when (c ->> 'executable')::boolean then 'x' else 'f' end));
    end if;
  end loop;

  v_root := public.ws_root(v_head);
  v_new := public.ws_tree_edit(v_root, v_edits, true, '') ->> 'node';
  if v_new = v_root then
    raise exception 'Nothing changed: the files are already like this on "%"', p_branch using errcode = 'PT409';
  end if;

  v_result := public.ws_write_root_commit(p_ws, p_branch, array[v_head], v_new, p_agent, v_message, v_head);
  perform public.log_activity('code_committed',
    format('@%s committed to %s/%s: %s', public.agent_handle(p_agent), w.slug, p_branch, left(split_part(v_message, E'\n', 1), 140)),
    p_agent, null, w.mission_id, b.task_id,
    jsonb_build_object('workspace', w.slug, 'branch', p_branch, 'commit', v_result ->> 'commit', 'stats', v_result -> 'stats'));
  return v_result || jsonb_build_object('workspace', w.slug, 'created_branch', v_created);
end
$$;

create or replace function public.update_workspace(p_ws uuid, p_agent uuid, p_fields jsonb)
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
    update public.workspaces ws set file_count = n.file_count, size_bytes = n.total_bytes
      from public.branches b join public.commits c on c.id = b.head join public.tree_nodes n on n.sha256 = c.root
     where ws.id = p_ws and b.workspace_id = p_ws and b.name = w.default_branch;
  end if;
  return public.ws_json(p_ws);
end
$$;

-- -----------------------------------------------------------------------------
-- VI. Reading
-- -----------------------------------------------------------------------------

-- A folder's entries, or (recursively) every file under it, a page at a time: p_after is the last
-- path of the previous page ("next").
drop function public.ws_tree(uuid, uuid, text, text, boolean);
create function public.ws_tree(p_ws uuid, p_agent uuid, p_ref text, p_path text, p_recursive boolean default false,
                               p_after text default null, p_limit int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commit text;
  v_dir text := btrim(coalesce(p_path, ''), '/ ');
  v_entry jsonb;
  v_entries jsonb;
  v_limit int := least(greatest(coalesce(p_limit, 50000), 1), 50000);
  v_n int;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_commit := public.ws_resolve_ref(p_ws, p_ref);
  v_entry := public.ws_tree_entry(public.ws_root(v_commit), v_dir);
  if v_entry is null then
    raise exception 'No folder "%" at this commit', v_dir using errcode = 'PT404';
  end if;
  if v_entry ->> 't' <> 'd' then
    raise exception '"%" is a file; read it with /files?path=%', v_dir, v_dir using errcode = 'PT400';
  end if;
  if coalesce(p_recursive, false) then
    select coalesce(jsonb_agg(jsonb_build_object('path', x.path, 'type', 'file', 'sha256', x.blob, 'size', x.size, 'binary', b.is_binary)
                              || case when x.mode = 'x' then jsonb_build_object('executable', true) else '{}'::jsonb end
                              order by x.path collate "C"), '[]'::jsonb),
           count(*)
      into v_entries, v_n
      from (select w.path, w.mode, w.blob, w.size from public.ws_walk(v_entry ->> 's', v_dir) w
             where p_after is null or w.path collate "C" > p_after collate "C"
             order by w.path collate "C"
             limit v_limit + 1) x
      left join public.blobs b on b.sha256 = x.blob;
    return jsonb_build_object('commit', v_commit, 'path', v_dir,
                              'entries', case when v_n > v_limit then v_entries - v_limit else v_entries end,
                              'next', case when v_n > v_limit then v_entries -> (v_limit - 1) ->> 'path' end);
  end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('name', e.key, 'path', case when v_dir = '' then e.key else v_dir || '/' || e.key end,
                              'type', case when e.value ->> 't' = 'd' then 'dir' else 'file' end)
           || case when e.value ->> 't' = 'd'
                   then jsonb_build_object('files', (e.value ->> 'n')::int, 'size', (e.value ->> 'z')::bigint)
                   else jsonb_build_object('sha256', e.value ->> 's', 'size', (e.value ->> 'z')::bigint, 'binary', b.is_binary) end
           || case when e.value ->> 't' = 'x' then jsonb_build_object('executable', true) else '{}'::jsonb end
           order by e.value ->> 't' <> 'd', e.key collate "C"), '[]'::jsonb)
    into v_entries
    from public.tree_nodes n
    cross join lateral jsonb_each(n.entries) e
    left join public.blobs b on b.sha256 = e.value ->> 's' and e.value ->> 't' <> 'd'
   where n.sha256 = v_entry ->> 's';
  return jsonb_build_object('commit', v_commit, 'path', v_dir, 'entries', v_entries);
end
$$;

-- One file at a ref. The API reads binary content from storage_path.
create or replace function public.ws_file(p_ws uuid, p_agent uuid, p_ref text, p_path text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_commit text;
  v_entry jsonb;
  b public.blobs;
  v_path text := btrim(coalesce(p_path, ''), '/ ');
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_commit := public.ws_resolve_ref(p_ws, p_ref);
  v_entry := case when v_path = '' then null else public.ws_tree_entry(public.ws_root(v_commit), v_path) end;
  if v_entry is null then
    raise exception 'No file "%" at this commit', v_path using errcode = 'PT404';
  end if;
  if v_entry ->> 't' = 'd' then
    raise exception '"%" is a folder; list it with /tree?path=%', v_path, v_path using errcode = 'PT400';
  end if;
  select * into b from public.blobs where sha256 = v_entry ->> 's';
  return jsonb_build_object('commit', v_commit, 'path', v_path, 'sha256', b.sha256, 'git_sha1', b.git_sha1, 'size', b.size,
                            'binary', b.is_binary, 'content', b.content, 'storage_path', b.storage_path,
                            'executable', v_entry ->> 't' = 'x');
end
$$;

-- Files that differ between two refs.
drop function public.ws_diff(uuid, uuid, text, text);
create function public.ws_diff(p_ws uuid, p_agent uuid, p_from text, p_to text, p_renames boolean default false,
                               p_limit int default null)
returns jsonb
language plpgsql
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
  return jsonb_build_object('from', v_from, 'to', v_to)
         || public.ws_diff_json(public.ws_root(v_from), public.ws_root(v_to), p_renames, p_limit);
end
$$;

drop function public.ws_log(uuid, uuid, text, text, int, int);
create function public.ws_log(p_ws uuid, p_agent uuid, p_ref text, p_path text default null, p_limit int default 30,
                              p_offset int default 0, p_before text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  return public.ws_log_page(p_ws, public.ws_resolve_ref(p_ws, p_ref), p_path, p_limit, p_offset, p_before);
end
$$;

-- The code pages' reads, for people: history, a folder or file, and a diff.
drop function public.web_ws_log(text, text, text, int, int);
create function public.web_ws_log(p_slug text, p_ref text default null, p_path text default null,
                                  p_limit int default 30, p_offset int default 0, p_before text default null)
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
  return public.ws_log_page(v_ws, public.ws_resolve_ref(v_ws, p_ref), p_path, p_limit, p_offset, p_before);
end
$$;

create function public.web_ws_tree(p_slug text, p_ref text default null, p_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_commit text;
  v_path text := btrim(coalesce(p_path, ''), '/ ');
  v_entry jsonb;
  b public.blobs;
begin
  select id into v_ws from public.workspaces where slug = lower(btrim(coalesce(p_slug, '')));
  if v_ws is null or not public.ws_readable(v_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  v_commit := public.ws_resolve_ref(v_ws, p_ref);
  v_entry := public.ws_tree_entry(public.ws_root(v_commit), v_path);
  if v_entry is null then
    return jsonb_build_object('commit', v_commit, 'path', v_path, 'kind', null);
  end if;
  if v_entry ->> 't' <> 'd' then
    select * into b from public.blobs where sha256 = v_entry ->> 's';
    return jsonb_build_object('commit', v_commit, 'path', v_path, 'kind', 'file',
                              'file', jsonb_build_object('sha256', b.sha256, 'size', b.size, 'binary', b.is_binary,
                                                         'executable', v_entry ->> 't' = 'x'));
  end if;
  return jsonb_build_object('commit', v_commit, 'path', v_path, 'kind', 'dir', 'entries', coalesce((
    select jsonb_agg(jsonb_build_object('name', e.key, 'path', case when v_path = '' then e.key else v_path || '/' || e.key end,
                                        'type', case when e.value ->> 't' = 'd' then 'dir' else 'file' end,
                                        'sha', case when e.value ->> 't' <> 'd' then e.value ->> 's' end,
                                        'files', case when e.value ->> 't' = 'd' then (e.value ->> 'n')::int end,
                                        'size', (e.value ->> 'z')::bigint,
                                        'executable', e.value ->> 't' = 'x')
                     order by e.value ->> 't' <> 'd', e.key collate "C")
      from public.tree_nodes n cross join lateral jsonb_each(n.entries) e
     where n.sha256 = v_entry ->> 's'), '[]'::jsonb));
end
$$;

create function public.web_ws_diff(p_slug text, p_from text, p_to text, p_limit int default 3000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_from text;
  v_to text;
begin
  select id into v_ws from public.workspaces where slug = lower(btrim(coalesce(p_slug, '')));
  if v_ws is null or not public.ws_readable(v_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  v_from := case when nullif(btrim(coalesce(p_from, '')), '') is null then null else public.ws_resolve_ref(v_ws, p_from) end;
  v_to := public.ws_resolve_ref(v_ws, p_to);
  return jsonb_build_object('from', v_from, 'to', v_to)
         || public.ws_diff_json(coalesce(public.ws_root(v_from), public.ws_empty_root()), public.ws_root(v_to), true,
                                least(greatest(coalesce(p_limit, 3000), 1), 5000));
end
$$;

-- -----------------------------------------------------------------------------
-- VII. Merging
-- -----------------------------------------------------------------------------

-- Deleted and added files with the same content, paired one to one: {"old": "new"}.
create function public.ws_exact_pairs(p_changes jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with d as (select e.key as p, e.value as v from jsonb_each(coalesce(p_changes, '{}'::jsonb)) e),
  dels as (select p, v ->> 'ob' as b, row_number() over (partition by v ->> 'ob' order by p collate "C") as n
             from d where v ->> 'nb' is null and v ->> 'ob' is not null),
  adds as (select p, v ->> 'nb' as b, row_number() over (partition by v ->> 'nb' order by p collate "C") as n
             from d where v ->> 'ob' is null and v ->> 'nb' is not null)
  select coalesce(jsonb_object_agg(dels.p, adds.p), '{}'::jsonb)
    from dels join adds on adds.b = dels.b and adds.n = dels.n
$$;

-- The renames one side made: exact ones, plus files moved and edited, which matter only where the
-- other side edited a file this side deleted. Those come from the code worker's content comparison
-- (rename_pairs); until it answered, the result carries a pending "renames" job.
create function public.ws_side_renames(p_base text, p_side text, p_changes jsonb, p_other jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exact jsonb := public.ws_exact_pairs(p_changes);
  v_targets jsonb;
  v_cached jsonb;
  v_dels jsonb;
  v_adds jsonb;
begin
  if not exists (select 1 from jsonb_each(p_changes) e
                  where e.value ->> 'nb' is null and not v_exact ? e.key
                    and (coalesce(p_other, '{}'::jsonb) -> e.key ->> 'nb') is not null) then
    return jsonb_build_object('pairs', v_exact);
  end if;
  select coalesce(jsonb_object_agg(e.value #>> '{}', true), '{}'::jsonb) into v_targets from jsonb_each(v_exact) e;
  select coalesce(jsonb_agg(jsonb_build_object('path', x.path, 'sha', x.sha) order by x.path), '[]'::jsonb) into v_dels
    from (select e.key as path, e.value ->> 'ob' as sha
            from jsonb_each(p_changes) e join public.blobs b on b.sha256 = e.value ->> 'ob' and not b.is_binary
           where e.value ->> 'nb' is null and not v_exact ? e.key
           order by e.key collate "C" limit 100) x;
  select coalesce(jsonb_agg(jsonb_build_object('path', x.path, 'sha', x.sha) order by x.path), '[]'::jsonb) into v_adds
    from (select e.key as path, e.value ->> 'nb' as sha
            from jsonb_each(p_changes) e join public.blobs b on b.sha256 = e.value ->> 'nb' and not b.is_binary
           where e.value ->> 'ob' is null and not v_targets ? e.key
           order by e.key collate "C" limit 100) x;
  if jsonb_array_length(v_dels) = 0 or jsonb_array_length(v_adds) = 0 then
    return jsonb_build_object('pairs', v_exact);
  end if;
  select pairs into v_cached from public.rename_pairs where base_root = p_base and side_root = p_side;
  if found then
    return jsonb_build_object('pairs', v_exact || coalesce((
      select jsonb_object_agg(e.key, e.value) from jsonb_each(v_cached) e
       where not v_exact ? e.key and not v_targets ? (e.value #>> '{}')
         and p_changes ? e.key and p_changes ? (e.value #>> '{}')
         and (p_changes -> e.key ->> 'nb') is null and (p_changes -> (e.value #>> '{}') ->> 'ob') is null), '{}'::jsonb));
  end if;
  return jsonb_build_object('pairs', v_exact, 'pending', jsonb_build_object(
    'kind', 'renames', 'base_root', p_base, 'side_root', p_side, 'deleted', v_dels, 'added', v_adds));
end
$$;

-- How one path merges when both sides touched it: b/bm the base, o/om ours, t/tm theirs (a null blob:
-- deleted). Answers {action: keep | set | conflict | pending, ...}.
create function public.ws_merge_path(p_path text, b text, bm text, o text, om text, t text, tm text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  m public.blob_merges;
begin
  if o is not distinct from t then
    if o is null or om is not distinct from tm or tm is not distinct from bm then
      return jsonb_build_object('action', 'keep');
    end if;
    if om is not distinct from bm then
      return jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', p_path, 's', t, 'm', tm));
    end if;
    return jsonb_build_object('action', 'keep');
  end if;
  if o is null or t is null then
    return jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
      'path', p_path, 'kind', 'modify_delete', 'base', b, 'ours', o, 'theirs', t));
  end if;
  v_mode := case when om is not distinct from bm then coalesce(tm, om, 'f') else coalesce(om, 'f') end;
  if t is not distinct from b then
    if v_mode is distinct from om then
      return jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', p_path, 's', o, 'm', v_mode));
    end if;
    return jsonb_build_object('action', 'keep');
  end if;
  if o is not distinct from b then
    return jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', p_path, 's', t, 'm', v_mode));
  end if;
  if exists (select 1 from public.blobs x where x.sha256 in (b, o, t) and x.is_binary) then
    return jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
      'path', p_path, 'kind', 'binary', 'base', b, 'ours', o, 'theirs', t));
  end if;
  select * into m from public.blob_merges where base_sha = coalesce(b, '') and ours_sha = o and theirs_sha = t;
  if not found then
    return jsonb_build_object('action', 'pending', 'pending', jsonb_build_object(
      'kind', 'content', 'path', p_path, 'base', coalesce(b, ''), 'ours', o, 'theirs', t));
  end if;
  if m.conflict then
    return jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
      'path', p_path, 'kind', case when b is null then 'add_add' else 'content' end, 'base', b, 'ours', o, 'theirs', t,
      'marked', m.marked_sha, 'hunks', m.conflict_hunks));
  end if;
  return jsonb_build_object('action', 'set', 'blob', m.merged_sha,
                            'change', jsonb_build_object('p', p_path, 's', m.merged_sha, 'm', v_mode));
end
$$;

-- Merge three roots: apply what "theirs" changed since the base onto "ours". Answers
-- {root, conflicts: [{path, kind, ...}], pending: [jobs], blobs: [merged blobs used], applied}.
-- While anything is pending the root is partial and must not be committed.
create function public.ws_merge_plan(p_base text, p_ours text, p_theirs text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := coalesce(p_base, public.ws_empty_root());
  v_o jsonb;
  v_t jsonb;
  v_ro jsonb;
  v_rt jsonb;
  v_rto jsonb;
  v_rtt jsonb;
  v_ren jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_blobs jsonb := '[]'::jsonb;
  v_res jsonb;
  v_pick jsonb;
  r record;
  o jsonb;
  t jsonb;
  oq jsonb;
  tq jsonb;
  q text;
  v_r text;
begin
  if p_ours = p_theirs or p_theirs = v_base then
    return jsonb_build_object('root', p_ours, 'conflicts', '[]'::jsonb, 'pending', '[]'::jsonb, 'blobs', '[]'::jsonb, 'applied', 0);
  end if;
  if p_ours = v_base then
    return jsonb_build_object('root', p_theirs, 'conflicts', '[]'::jsonb, 'pending', '[]'::jsonb, 'blobs', '[]'::jsonb, 'applied', -1);
  end if;
  select coalesce(jsonb_object_agg(d.path, jsonb_build_object('ob', d.old_blob, 'om', d.old_mode, 'nb', d.new_blob, 'nm', d.new_mode)), '{}'::jsonb)
    into v_o from public.ws_diff_roots(v_base, p_ours) d;
  select coalesce(jsonb_object_agg(d.path, jsonb_build_object('ob', d.old_blob, 'om', d.old_mode, 'nb', d.new_blob, 'nm', d.new_mode)), '{}'::jsonb)
    into v_t from public.ws_diff_roots(v_base, p_theirs) d;

  v_ren := public.ws_side_renames(v_base, p_ours, v_o, v_t);
  v_ro := v_ren -> 'pairs';
  if v_ren ? 'pending' then
    v_pending := v_pending || jsonb_build_array(v_ren -> 'pending');
  end if;
  v_ren := public.ws_side_renames(v_base, p_theirs, v_t, v_o);
  v_rt := v_ren -> 'pairs';
  if v_ren ? 'pending' then
    v_pending := v_pending || jsonb_build_array(v_ren -> 'pending');
  end if;
  select coalesce(jsonb_object_agg(e.value #>> '{}', e.key), '{}'::jsonb) into v_rto from jsonb_each(v_ro) e;
  select coalesce(jsonb_object_agg(e.value #>> '{}', e.key), '{}'::jsonb) into v_rtt from jsonb_each(v_rt) e;

  for r in select e.key as p, e.value as v from jsonb_each(v_t) e order by e.key collate "C" loop
    t := r.v;
    v_pick := null;
    if v_rtt ? r.p then
      -- Where they moved a file to: handled with the file it came from.
      continue;
    end if;
    if v_rt ? r.p then
      q := v_rt ->> r.p;
      tq := v_t -> q;
      o := v_o -> r.p;
      if o is null then
        -- We left the file alone: it moves (and changes) as they did.
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('p', r.p, 's', null));
        if v_o ? q then
          oq := v_o -> q;
          v_pick := public.ws_merge_path(q, null, null, oq ->> 'nb', oq ->> 'nm', tq ->> 'nb', tq ->> 'nm');
        else
          v_pick := jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', q, 's', tq ->> 'nb', 'm', tq ->> 'nm'));
        end if;
      elsif o ->> 'nb' is null then
        if v_ro ? r.p then
          v_r := v_ro ->> r.p;
          if v_r = q then
            oq := v_o -> q;
            v_pick := public.ws_merge_path(q, t ->> 'ob', t ->> 'om', oq ->> 'nb', oq ->> 'nm', tq ->> 'nb', tq ->> 'nm');
          else
            v_pick := jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
              'path', r.p, 'kind', 'rename_rename', 'ours_path', v_r, 'theirs_path', q, 'base', t ->> 'ob'));
          end if;
        else
          v_pick := jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
            'path', q, 'kind', 'rename_delete', 'from', r.p, 'base', t ->> 'ob', 'ours', null, 'theirs', tq ->> 'nb'));
        end if;
      else
        -- We edited the file, they moved it: our edit follows it.
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('p', r.p, 's', null));
        if v_o ? q then
          v_pick := jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
            'path', q, 'kind', 'add_add', 'from', r.p, 'base', t ->> 'ob', 'ours', v_o -> q ->> 'nb', 'theirs', tq ->> 'nb'));
        else
          v_pick := public.ws_merge_path(q, t ->> 'ob', t ->> 'om', o ->> 'nb', o ->> 'nm', tq ->> 'nb', tq ->> 'nm');
        end if;
      end if;
    else
      o := v_o -> r.p;
      if o is null then
        v_pick := jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', r.p, 's', t ->> 'nb', 'm', t ->> 'nm'));
      elsif v_ro ? r.p then
        -- We moved the file, they edited (or deleted) it.
        v_r := v_ro ->> r.p;
        oq := v_o -> v_r;
        if t ->> 'nb' is null then
          v_pick := jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
            'path', v_r, 'kind', 'rename_delete', 'from', r.p, 'base', t ->> 'ob', 'ours', oq ->> 'nb', 'theirs', null));
        else
          v_pick := public.ws_merge_path(v_r, t ->> 'ob', t ->> 'om', oq ->> 'nb', oq ->> 'nm', t ->> 'nb', t ->> 'nm');
        end if;
      else
        v_pick := public.ws_merge_path(r.p, t ->> 'ob', t ->> 'om', o ->> 'nb', o ->> 'nm', t ->> 'nb', t ->> 'nm');
      end if;
    end if;

    if v_pick ->> 'action' = 'set' then
      v_changes := v_changes || jsonb_build_array(v_pick -> 'change');
      if v_pick ? 'blob' then
        v_blobs := v_blobs || to_jsonb(v_pick ->> 'blob');
      end if;
    elsif v_pick ->> 'action' = 'conflict' then
      v_conflicts := v_conflicts || jsonb_build_array(v_pick -> 'conflict');
    elsif v_pick ->> 'action' = 'pending' then
      v_pending := v_pending || jsonb_build_array(v_pick -> 'pending');
    end if;
  end loop;

  v_res := public.ws_tree_edit(p_ours, v_changes, false, '');
  v_conflicts := v_conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('path', x #>> '{}', 'kind', 'file_dir')) from jsonb_array_elements(v_res -> 'conflicts') x), '[]'::jsonb);
  return jsonb_build_object('root', v_res ->> 'node', 'conflicts', v_conflicts, 'pending', v_pending, 'blobs', v_blobs,
                            'applied', jsonb_array_length(v_changes));
end
$$;

-- Ask the code worker for the line merges and rename searches a merge waits on.
create function public.kick_code_worker()
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
    url := v_url || '/internal/code-worker',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-posterity-internal', v_token),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'kick_code_worker: %', sqlerrm;
end
$$;

create function public.ws_request_merges(p_ws uuid, p_pending jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  n int := 0;
begin
  for x in select value from jsonb_array_elements(coalesce(p_pending, '[]'::jsonb)) loop
    insert into public.merge_jobs (kind, key, payload, workspace_id)
    values (x ->> 'kind',
            case when x ->> 'kind' = 'content' then concat_ws(':', x ->> 'base', x ->> 'ours', x ->> 'theirs')
                 else concat_ws(':', x ->> 'base_root', x ->> 'side_root') end,
            x, p_ws)
    on conflict (kind, key) do nothing;
    if found then
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    perform public.kick_code_worker();
  end if;
  return n;
end
$$;

-- The code worker takes jobs (a lease of two minutes each), then stores what it computed.
create function public.code_claim(p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  with picked as (
    select j.kind, j.key from public.merge_jobs j
     where j.locked_until is null or j.locked_until < now()
     order by j.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update skip locked
  ),
  taken as (
    update public.merge_jobs j
       set locked_until = now() + interval '2 minutes', attempts = j.attempts + 1
      from picked
     where j.kind = picked.kind and j.key = picked.key
    returning j.kind, j.key, j.payload, j.workspace_id, j.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'key', key, 'payload', payload, 'workspace_id', workspace_id,
                                               'attempts', attempts)), '[]'::jsonb)
    into v from taken;
  return v;
end
$$;

-- Store a computed text (merged, or with conflict markers) as a blob of the workspaces that need it.
create function public.code_put_text(p_content text, p_sha1 text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bytes bytea := convert_to(p_content, 'UTF8');
  v_sha text := encode(extensions.digest(v_bytes, 'sha256'), 'hex');
begin
  if octet_length(v_bytes) > 1048576 then
    raise exception 'A merged file over 1 MB cannot be stored as text' using errcode = 'PT413';
  end if;
  if p_sha1 is null
     or p_sha1 <> encode(extensions.digest(convert_to('blob ' || octet_length(v_bytes), 'UTF8') || '\x00'::bytea || v_bytes, 'sha1'), 'hex') then
    raise exception 'git_sha1 does not match the content' using errcode = 'PT400';
  end if;
  insert into public.blobs (sha256, git_sha1, size, is_binary, content)
  values (v_sha, p_sha1, octet_length(v_bytes), false, p_content)
  on conflict (sha256) do nothing;
  return v_sha;
end
$$;

-- A line merge's result: the merged text, or (conflict) the text with conflict markers.
create function public.code_store_merge(p_base text, p_ours text, p_theirs text, p_conflict boolean, p_content text,
                                        p_sha1 text, p_hunks int default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sha text;
begin
  if p_content is not null then
    v_sha := public.code_put_text(p_content, p_sha1);
  end if;
  if not coalesce(p_conflict, true) and v_sha is null then
    raise exception 'A clean merge needs its content' using errcode = 'PT400';
  end if;
  insert into public.blob_merges (base_sha, ours_sha, theirs_sha, conflict, merged_sha, marked_sha, conflict_hunks)
  values (coalesce(p_base, ''), p_ours, p_theirs, coalesce(p_conflict, true),
          case when not coalesce(p_conflict, true) then v_sha end,
          case when coalesce(p_conflict, true) then v_sha end, greatest(coalesce(p_hunks, 0), 0))
  on conflict (base_sha, ours_sha, theirs_sha) do nothing;
  delete from public.merge_jobs where kind = 'content' and key = concat_ws(':', coalesce(p_base, ''), p_ours, p_theirs);
  return jsonb_build_object('stored', true, 'sha256', v_sha);
end
$$;

create function public.code_store_renames(p_base_root text, p_side_root text, p_pairs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.rename_pairs (base_root, side_root, pairs)
  values (p_base_root, p_side_root, case when jsonb_typeof(p_pairs) = 'object' then p_pairs else '{}'::jsonb end)
  on conflict (base_root, side_root) do update set pairs = excluded.pairs, created_at = now();
  delete from public.merge_jobs where kind = 'renames' and key = concat_ws(':', p_base_root, p_side_root);
end
$$;

-- A job the worker could not finish: after five tries its merge counts as a conflict (and a rename
-- search as finding nothing), so nothing waits on it forever.
create function public.code_fail_job(p_kind text, p_key text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.merge_jobs;
begin
  select * into j from public.merge_jobs where kind = p_kind and key = p_key for update;
  if not found then
    return;
  end if;
  if j.attempts < 5 then
    update public.merge_jobs set last_error = left(p_error, 1000), locked_until = now() + interval '30 seconds'
     where kind = p_kind and key = p_key;
    return;
  end if;
  if j.kind = 'content' then
    insert into public.blob_merges (base_sha, ours_sha, theirs_sha, conflict)
    values (j.payload ->> 'base', j.payload ->> 'ours', j.payload ->> 'theirs', true)
    on conflict do nothing;
  else
    insert into public.rename_pairs (base_root, side_root, pairs)
    values (j.payload ->> 'base_root', j.payload ->> 'side_root', '{}') on conflict do nothing;
  end if;
  delete from public.merge_jobs where kind = p_kind and key = p_key;
end
$$;

-- Recompute where a change request stands after either branch moved: its merge base, whether it
-- merges (pending while a line merge is computed), which files conflict and how, its size, and
-- whether it was merged some other way.
create or replace function public.cr_refresh(p_cr uuid)
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
  v_plan jsonb;
  v_files int;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found or cr.status not in ('draft', 'open') then
    return;
  end if;
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
    -- Everything it proposes is already in the target.
    update public.change_requests
       set status = 'merged', merged_commit = v_tgt, merged_at = now(), head_commit = v_src, target_head = v_tgt,
           mergeable = null, conflicts = '{}', needs_refresh = false, merge_method = coalesce(merge_method, 'merge'), updated_at = now()
     where id = p_cr;
    perform public.ws_count_open(cr.workspace_id);
    return;
  end if;
  v_base := public.ws_merge_base(v_tgt, v_src);
  select count(*) into v_files from public.ws_diff_roots(coalesce(public.ws_root(v_base), public.ws_empty_root()), public.ws_root(v_src));
  if v_base = v_tgt then
    update public.change_requests
       set base_commit = v_base, head_commit = v_src, target_head = v_tgt, mergeable = true, conflicts = '{}', needs_refresh = false,
           merge_state = jsonb_build_object('fast_forward', true, 'files', v_files), updated_at = now()
     where id = p_cr;
    return;
  end if;
  v_plan := public.ws_merge_plan(public.ws_root(v_base), public.ws_root(v_tgt), public.ws_root(v_src));
  if jsonb_array_length(v_plan -> 'pending') > 0 then
    perform public.ws_request_merges(cr.workspace_id, v_plan -> 'pending');
    update public.change_requests
       set base_commit = v_base, head_commit = v_src, target_head = v_tgt, mergeable = null, conflicts = '{}', needs_refresh = false,
           merge_state = jsonb_build_object('pending', jsonb_array_length(v_plan -> 'pending'), 'files', v_files), updated_at = now()
     where id = p_cr;
    return;
  end if;
  update public.change_requests
     set base_commit = v_base, head_commit = v_src, target_head = v_tgt,
         mergeable = jsonb_array_length(v_plan -> 'conflicts') = 0,
         conflicts = array(select distinct x ->> 'path' from jsonb_array_elements(v_plan -> 'conflicts') x),
         needs_refresh = false,
         merge_state = jsonb_build_object('files', v_files,
                                          'conflicts', coalesce((select jsonb_agg(jsonb_build_object('path', x ->> 'path', 'kind', x ->> 'kind'))
                                                                   from (select x from jsonb_array_elements(v_plan -> 'conflicts') x limit 100) y), '[]'::jsonb)),
         updated_at = now()
   where id = p_cr;
end
$$;

-- The commits on src that onto lacks, oldest first, for replaying. Raises when src brought in history
-- older than its merge base with onto that onto does not have (a rebase cannot replay that).
create function public.ws_replay_list(p_onto text, p_src text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text := public.ws_merge_base(p_onto, p_src);
  v_floor int := coalesce((select generation from public.commits where id = v_base), 1);
  v_list text[];
  v_odd text;
begin
  with s as materialized (select a.id, a.generation from public.ws_ancestors(p_src, v_floor) a),
       o as materialized (select a.id from public.ws_ancestors(p_onto, v_floor) a)
  select array_agg(s.id order by s.generation, c.created_at, s.id) into v_list
    from s
    join public.commits c on c.id = s.id
   where not exists (select 1 from o where o.id = s.id);
  select p.parent into v_odd
    from unnest(coalesce(v_list, '{}')) as l(id)
    join public.commits c on c.id = l.id
    cross join lateral unnest(c.parents) as p(parent)
    join public.commits pc on pc.id = p.parent
   where pc.generation < v_floor and not public.ws_is_ancestor(p.parent, p_onto)
   limit 1;
  if v_odd is not null then
    raise exception 'This branch merged in older history (%) that the target lacks; merge it instead of rebasing', left(v_odd, 12)
      using errcode = 'PT409';
  end if;
  return coalesce(v_list, '{}');
end
$$;

-- Build what landing src on onto would be, without moving any branch: "ff" (onto is behind src and the
-- method allows it), "ok" with the new tip commit, "empty" (nothing new), "pending" (line merges being
-- computed) or "conflict". Merge commits: [onto, src]; squash: one commit on onto; rebase: src's
-- commits replayed one by one (each as its change from its first parent).
create function public.ws_compose(p_ws uuid, p_onto text, p_src text, p_method text, p_message text, p_author uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method text := coalesce(nullif(p_method, ''), 'merge');
  v_base text;
  v_plan jsonb;
  v_list text[];
  v_id text;
  c public.commits;
  v_tip_root text := public.ws_root(p_onto);
  v_steps jsonb := '[]'::jsonb;
  v_blobs jsonb := '[]'::jsonb;
  v_prev text := p_onto;
  s jsonb;
begin
  if v_method not in ('merge', 'squash', 'rebase') then
    raise exception 'method must be merge, squash or rebase' using errcode = 'PT400';
  end if;
  if public.ws_is_ancestor(p_src, p_onto) then
    return jsonb_build_object('status', 'empty', 'commit', p_onto);
  end if;
  if v_method = 'merge' and public.ws_is_ancestor(p_onto, p_src) then
    return jsonb_build_object('status', 'ff', 'commit', p_src);
  end if;

  if v_method in ('merge', 'squash') then
    if public.ws_is_ancestor(p_onto, p_src) then
      v_plan := jsonb_build_object('root', public.ws_root(p_src), 'conflicts', '[]'::jsonb, 'pending', '[]'::jsonb, 'blobs', '[]'::jsonb);
    else
      v_base := public.ws_merge_base(p_onto, p_src);
      v_plan := public.ws_merge_plan(public.ws_root(v_base), v_tip_root, public.ws_root(p_src));
    end if;
    if jsonb_array_length(v_plan -> 'pending') > 0 then
      return jsonb_build_object('status', 'pending', 'pending', v_plan -> 'pending');
    end if;
    if jsonb_array_length(v_plan -> 'conflicts') > 0 then
      return jsonb_build_object('status', 'conflict', 'conflicts', v_plan -> 'conflicts');
    end if;
    if v_method = 'squash' and v_plan ->> 'root' = v_tip_root then
      return jsonb_build_object('status', 'empty', 'commit', p_onto);
    end if;
    insert into public.workspace_blobs (workspace_id, sha256)
    select p_ws, x #>> '{}' from jsonb_array_elements(v_plan -> 'blobs') x on conflict do nothing;
    v_id := public.ws_write_root_commit(p_ws, null, case when v_method = 'merge' then array[p_onto, p_src] else array[p_onto] end,
                                        v_plan ->> 'root', p_author, p_message, null, false) ->> 'commit';
    return jsonb_build_object('status', 'ok', 'commit', v_id, 'created', 1);
  end if;

  -- Rebase: replay each commit's own change on the new tip.
  v_list := public.ws_replay_list(p_onto, p_src);
  if cardinality(v_list) > 250 then
    raise exception 'Rebasing replays at most 250 commits; this would replay %. Merge or squash instead', cardinality(v_list)
      using errcode = 'PT413';
  end if;
  for i in 1 .. cardinality(v_list) loop
    select * into c from public.commits where id = v_list[i];
    v_plan := public.ws_merge_plan(coalesce(public.ws_root(c.parents[1]), public.ws_empty_root()), v_tip_root, c.root);
    if jsonb_array_length(v_plan -> 'pending') > 0 then
      return jsonb_build_object('status', 'pending', 'pending', v_plan -> 'pending', 'at', c.id);
    end if;
    if jsonb_array_length(v_plan -> 'conflicts') > 0 then
      return jsonb_build_object('status', 'conflict', 'conflicts', v_plan -> 'conflicts', 'at', c.id,
                                'message', split_part(c.message, E'\n', 1));
    end if;
    if v_plan ->> 'root' is distinct from v_tip_root then
      v_steps := v_steps || jsonb_build_array(jsonb_build_object('root', v_plan ->> 'root', 'message', c.message,
                                                                 'author', c.author_agent_id));
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

-- The 409 a merge raises: conflicts listed in the message and, in full, in the detail.
create function public.ws_raise_conflict(p_conflicts jsonb, p_hint text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'conflict: % file(s) changed on both sides: %. %',
    jsonb_array_length(p_conflicts),
    (select string_agg(x ->> 'path', ', ') from (select x from jsonb_array_elements(p_conflicts) x limit 20) y),
    p_hint
    using errcode = 'PT409', detail = jsonb_build_object('conflicts', p_conflicts)::text;
end
$$;

create function public.ws_raise_pending(p_pending jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'merge_pending: % file(s) need a line-by-line merge, which is being worked out; try again in a minute',
    jsonb_array_length(p_pending)
    using errcode = 'PT409', detail = jsonb_build_object('pending', jsonb_array_length(p_pending))::text;
end
$$;

-- Merge another branch (or commit) into a branch you can push to, e.g. the target into your work to
-- resolve conflicts. resolutions: {"path": "<blob sha256>" or null to delete} for each conflicting file.
-- With p_pending_ok a merge waiting on line merges answers {status: "pending"} (and the worker is
-- asked); otherwise it raises merge_pending.
drop function public.ws_merge_branches(uuid, uuid, text, text, text, jsonb);
create function public.ws_merge_branches(p_ws uuid, p_agent uuid, p_into text, p_from text, p_message text default null,
                                         p_resolutions jsonb default null, p_pending_ok boolean default false)
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
  v_plan jsonb;
  v_conflicts text[];
  v_unresolved jsonb;
  v_pending jsonb;
  v_edits jsonb := '[]'::jsonb;
  v_edit jsonb;
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
    return jsonb_build_object('status', 'merged', 'commit', v_from, 'branch', p_into, 'fast_forward', true, 'workspace', w.slug);
  end if;
  v_base := public.ws_merge_base(b.head, v_from);
  v_plan := public.ws_merge_plan(public.ws_root(v_base), public.ws_root(b.head), public.ws_root(v_from));
  -- A file the caller resolved needs no line merge.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_pending
    from jsonb_array_elements(v_plan -> 'pending') x
   where not (x ->> 'kind' = 'content' and v_res ? (x ->> 'path'));
  if jsonb_array_length(v_pending) > 0 then
    if coalesce(p_pending_ok, false) then
      perform public.ws_request_merges(p_ws, v_pending);
      return jsonb_build_object('status', 'pending', 'pending', jsonb_array_length(v_pending),
                                'branch', p_into, 'workspace', w.slug);
    end if;
    perform public.ws_raise_pending(v_pending);
  end if;
  v_conflicts := array(select distinct x ->> 'path' from jsonb_array_elements(v_plan -> 'conflicts') x);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_unresolved
    from jsonb_array_elements(v_plan -> 'conflicts') x where not v_res ? (x ->> 'path');
  if jsonb_array_length(v_unresolved) > 0 then
    perform public.ws_raise_conflict(v_unresolved,
      'Resolve each in "resolutions": {"path": "<blob sha256>" or null to delete}.');
  end if;
  for v_path, v_blob in select key, value #>> '{}' from jsonb_each(v_res) loop
    if not public.ws_valid_path(v_path) then
      raise exception 'Invalid path "%"', v_path using errcode = 'PT400';
    end if;
    if v_blob is not null and not exists (select 1 from public.workspace_blobs where workspace_id = p_ws and sha256 = v_blob) then
      raise exception 'Blob % (for "%") was not uploaded to this workspace', left(v_blob, 12), v_path using errcode = 'PT400';
    end if;
    v_edits := v_edits || jsonb_build_array(jsonb_build_object('p', v_path, 's', v_blob));
  end loop;
  v_edit := public.ws_tree_edit(v_plan ->> 'root', v_edits, false, '');
  if jsonb_array_length(v_edit -> 'conflicts') > 0 then
    raise exception '"%" cannot be both a file and a folder', v_edit -> 'conflicts' ->> 0 using errcode = 'PT400';
  end if;
  insert into public.workspace_blobs (workspace_id, sha256)
  select p_ws, x #>> '{}' from jsonb_array_elements(v_plan -> 'blobs') x on conflict do nothing;
  v_result := public.ws_write_root_commit(p_ws, p_into, array[b.head, v_from], v_edit ->> 'node', p_agent,
                                          coalesce(nullif(btrim(p_message), ''), format('Merge %s into %s', p_from, p_into)), b.head);
  perform public.log_activity('code_merged', format('@%s merged %s into %s/%s', public.agent_handle(p_agent), p_from, w.slug, p_into),
    p_agent, null, w.mission_id, b.task_id, jsonb_build_object('workspace', w.slug, 'branch', p_into, 'commit', v_result ->> 'commit'));
  return v_result || jsonb_build_object('status', 'merged', 'fast_forward', false, 'resolved', cardinality(v_conflicts),
                                        'workspace', w.slug);
end
$$;

-- Land a change request whose checks passed (the caller holds the target branch's row lock).
create function public.cr_land(p_cr uuid, p_agent uuid, p_message text, p_method text, p_pending_ok boolean)
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
  v_message := coalesce(nullif(btrim(p_message), ''),
                        case when v_method = 'squash' then left(format('%s (#%s)', cr.title, cr.number)
                                                                  || case when btrim(cr.body) <> '' then E'\n\n' || cr.body else '' end, 4000)
                             else format('Merge #%s: %s', cr.number, cr.title) end);
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
  update public.change_requests
     set status = 'merged', merged_commit = v_commit, merged_by = p_agent, merged_at = now(), head_commit = v_src,
         target_head = v_commit, mergeable = null, conflicts = '{}', needs_refresh = false,
         merge_method = case when v_ff then 'fast_forward' else v_method end, updated_at = now()
   where id = p_cr;
  delete from public.cr_review_requests where change_request_id = p_cr;
  perform public.ws_count_open(w.id);
  perform public.log_activity('cr_merged',
    case when p_agent is null then format('Verified work merged into %s: #%s %s', w.slug, cr.number, cr.title)
         else format('@%s merged %s #%s: %s', public.ws_handle(p_agent), w.slug, cr.number, cr.title) end,
    p_agent, null, w.mission_id, cr.task_id,
    jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_commit, 'fast_forward', v_ff, 'method', v_method));
  if cr.author_agent_id is distinct from p_agent then
    perform public.notify_agent(cr.author_agent_id, 'cr_merged', format('%s #%s was merged into %s', w.slug, cr.number, cr.target_branch),
      cr.title, jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_commit));
  end if;
  return jsonb_build_object('status', 'merged', 'commit', v_commit, 'fast_forward', v_ff, 'method', v_method);
end
$$;

-- Merge a change request. p_agent null is the system merging verified work: peer review of the
-- submission stands in for change request approvals. p_method: merge (a merge commit, or a
-- fast-forward), squash (one commit) or rebase (its commits replayed on the target).
drop function public.merge_change_request(uuid, uuid, text);
create function public.merge_change_request(p_cr uuid, p_agent uuid, p_message text default null, p_method text default 'merge',
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
  v_state jsonb;
  v_land jsonb;
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
  if coalesce(p_method, 'merge') not in ('merge', 'squash', 'rebase') then
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
  v_land := public.cr_land(p_cr, p_agent, p_message, coalesce(p_method, 'merge'), p_pending_ok);
  if v_land ->> 'status' = 'pending' then
    return public.cr_json(p_cr) || jsonb_build_object('status', 'pending', 'pending', v_land -> 'pending');
  end if;
  return public.cr_json(p_cr) || jsonb_build_object('fast_forward', (v_land ->> 'fast_forward')::boolean);
end
$$;

-- Replay a branch's own commits on top of another ref (rebase), moving the branch.
create function public.ws_rebase(p_ws uuid, p_agent uuid, p_branch text, p_onto text, p_pending_ok boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  v_onto text;
  v_compose jsonb;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  if not public.ws_can_push(p_ws, p_agent, p_branch) then
    raise exception 'You cannot push to "%"', p_branch using errcode = 'PT403';
  end if;
  select * into b from public.branches where workspace_id = p_ws and name = p_branch for update;
  if not found then
    raise exception 'No branch "%"', p_branch using errcode = 'PT404';
  end if;
  if b.protected then
    raise exception '"%" is protected: it cannot be rebased', p_branch using errcode = 'PT403';
  end if;
  if b.frozen_reason is not null then
    raise exception '"%" is frozen: %', p_branch, b.frozen_reason using errcode = 'PT409';
  end if;
  v_onto := public.ws_resolve_ref(p_ws, coalesce(nullif(btrim(p_onto), ''), w.default_branch));
  if public.ws_is_ancestor(v_onto, b.head) then
    raise exception 'Already up to date: "%" is on top of %', p_branch, coalesce(nullif(btrim(p_onto), ''), w.default_branch)
      using errcode = 'PT409';
  end if;
  if public.ws_is_ancestor(b.head, v_onto) then
    perform public.ws_move_branch(p_ws, p_branch, v_onto, b.head);
    return jsonb_build_object('status', 'rebased', 'commit', v_onto, 'branch', p_branch, 'replayed', 0, 'fast_forward', true,
                              'workspace', w.slug);
  end if;
  v_compose := public.ws_compose(p_ws, v_onto, b.head, 'rebase', null, p_agent);
  if v_compose ->> 'status' = 'pending' then
    if coalesce(p_pending_ok, false) then
      perform public.ws_request_merges(p_ws, v_compose -> 'pending');
      return jsonb_build_object('status', 'pending', 'pending', jsonb_array_length(v_compose -> 'pending'), 'branch', p_branch,
                                'workspace', w.slug);
    end if;
    perform public.ws_raise_pending(v_compose -> 'pending');
  end if;
  if v_compose ->> 'status' = 'conflict' then
    perform public.ws_raise_conflict(v_compose -> 'conflicts',
      format('Replaying %s ("%s") conflicts; merge %s into %s instead, with resolutions.',
             left(v_compose ->> 'at', 12), v_compose ->> 'message', coalesce(nullif(btrim(p_onto), ''), w.default_branch), p_branch));
  end if;
  perform public.ws_move_branch(p_ws, p_branch, v_compose ->> 'commit', b.head);
  perform public.log_activity('code_rebased', format('@%s rebased %s/%s', public.agent_handle(p_agent), w.slug, p_branch),
    p_agent, null, w.mission_id, b.task_id, jsonb_build_object('workspace', w.slug, 'branch', p_branch, 'commit', v_compose ->> 'commit'));
  return jsonb_build_object('status', 'rebased', 'commit', v_compose ->> 'commit', 'branch', p_branch,
                            'replayed', coalesce((v_compose ->> 'created')::int, 0), 'fast_forward', false, 'workspace', w.slug);
end
$$;

-- Apply one commit's change (from its first parent) on top of a branch.
create function public.ws_cherry_pick(p_ws uuid, p_agent uuid, p_branch text, p_commit text, p_pending_ok boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  c public.commits;
  v_plan jsonb;
  v_result jsonb;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  if not public.ws_can_push(p_ws, p_agent, p_branch) then
    raise exception 'You cannot push to "%"', p_branch using errcode = 'PT403';
  end if;
  select * into b from public.branches where workspace_id = p_ws and name = p_branch for update;
  if not found then
    raise exception 'No branch "%"', p_branch using errcode = 'PT404';
  end if;
  if b.protected then
    raise exception '"%" is protected: changes reach it only through a change request', p_branch using errcode = 'PT403';
  end if;
  if b.frozen_reason is not null then
    raise exception '"%" is frozen: %', p_branch, b.frozen_reason using errcode = 'PT409';
  end if;
  select * into c from public.commits where id = public.ws_resolve_ref(p_ws, p_commit);
  v_plan := public.ws_merge_plan(coalesce(public.ws_root(c.parents[1]), public.ws_empty_root()), public.ws_root(b.head), c.root);
  if jsonb_array_length(v_plan -> 'pending') > 0 then
    if coalesce(p_pending_ok, false) then
      perform public.ws_request_merges(p_ws, v_plan -> 'pending');
      return jsonb_build_object('status', 'pending', 'pending', jsonb_array_length(v_plan -> 'pending'), 'branch', p_branch,
                                'workspace', w.slug);
    end if;
    perform public.ws_raise_pending(v_plan -> 'pending');
  end if;
  if jsonb_array_length(v_plan -> 'conflicts') > 0 then
    perform public.ws_raise_conflict(v_plan -> 'conflicts', 'Edit the files on the branch and commit them instead.');
  end if;
  if v_plan ->> 'root' = public.ws_root(b.head) then
    raise exception 'Nothing to apply: "%" already has the changes of %', p_branch, left(c.id, 12) using errcode = 'PT409';
  end if;
  insert into public.workspace_blobs (workspace_id, sha256)
  select p_ws, x #>> '{}' from jsonb_array_elements(v_plan -> 'blobs') x on conflict do nothing;
  v_result := public.ws_write_root_commit(p_ws, p_branch, array[b.head], v_plan ->> 'root', c.author_agent_id,
                                          left(c.message || E'\n\n(cherry picked from commit ' || c.id || ')', 4000), b.head);
  perform public.log_activity('code_committed',
    format('@%s cherry-picked %s onto %s/%s', public.agent_handle(p_agent), left(c.id, 7), w.slug, p_branch),
    p_agent, null, w.mission_id, b.task_id,
    jsonb_build_object('workspace', w.slug, 'branch', p_branch, 'commit', v_result ->> 'commit', 'stats', v_result -> 'stats'));
  return v_result || jsonb_build_object('status', 'picked', 'workspace', w.slug, 'picked', c.id);
end
$$;

-- What a merge of from into into would conflict on, for agents resolving it: each conflict with the
-- three versions and (for text) the text with conflict markers once the worker computed it.
create function public.ws_merge_conflicts(p_ws uuid, p_agent uuid, p_into text, p_from text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_into text;
  v_from text;
  v_base text;
  v_plan jsonb;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_into := public.ws_resolve_ref(p_ws, p_into);
  v_from := public.ws_resolve_ref(p_ws, p_from);
  if public.ws_is_ancestor(v_from, v_into) or public.ws_is_ancestor(v_into, v_from) then
    return jsonb_build_object('into', v_into, 'from', v_from, 'conflicts', '[]'::jsonb, 'pending', 0);
  end if;
  v_base := public.ws_merge_base(v_into, v_from);
  v_plan := public.ws_merge_plan(public.ws_root(v_base), public.ws_root(v_into), public.ws_root(v_from));
  if jsonb_array_length(v_plan -> 'pending') > 0 then
    perform public.ws_request_merges(p_ws, v_plan -> 'pending');
  end if;
  -- Marked-up texts become readable in this workspace.
  insert into public.workspace_blobs (workspace_id, sha256)
  select p_ws, x ->> 'marked' from jsonb_array_elements(v_plan -> 'conflicts') x where x ->> 'marked' is not null
  on conflict do nothing;
  return jsonb_build_object('into', v_into, 'from', v_from, 'base', v_base, 'conflicts', v_plan -> 'conflicts',
                            'pending', jsonb_array_length(v_plan -> 'pending'));
end
$$;

-- A line comment must name a file on its side of the change request.
create or replace function public.cr_insert_comment(p_cr uuid, p_agent uuid, p_body text, p_path text, p_line int, p_side text,
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
  v_entry jsonb;
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
  if v_path is not null then
    v_entry := public.ws_tree_entry(public.ws_root(v_commit), v_path);
    if v_entry is null or v_entry ->> 't' = 'd' then
      raise exception 'No file "%" on the % side of this change request', v_path, v_side using errcode = 'PT400';
    end if;
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

-- Verified work merges by itself; when its line merges are still being worked out, the sweep merges
-- it once they are in. A real conflict goes back to the assignee and the lead.
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
      v_res := public.merge_change_request(cr.id, null, null, 'merge', true);
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

-- Every minute: stale change requests, verified work waiting on line merges, and the worker's queue.
create function public.code_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  for v in select id from public.change_requests where needs_refresh and status in ('draft', 'open')
            order by updated_at limit 25 loop
    begin
      perform public.cr_refresh(v);
    exception when others then
      raise warning 'code_sweep refresh %: %', v, sqlerrm;
    end;
  end loop;
  for v in select cr.id from public.change_requests cr
            where cr.status = 'open' and cr.verified_at is not null and cr.mergeable is true
              and exists (select 1 from public.submissions s where s.id = cr.submission_id and s.commit_id = cr.head_commit)
            order by cr.updated_at limit 10 loop
    begin
      perform public.merge_change_request(v, null, null, 'merge', true);
    exception when others then
      raise warning 'code_sweep merge %: %', v, sqlerrm;
    end;
  end loop;
  if exists (select 1 from public.merge_jobs where locked_until is null or locked_until < now()) then
    perform public.kick_code_worker();
  end if;
end
$$;

-- After the worker stored results: refresh the change requests of those workspaces that waited on it.
create function public.code_after(p_workspaces uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
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
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- VIII. Previews read folders
-- -----------------------------------------------------------------------------

create or replace function public.preview_publish(
  p_ws             uuid,
  p_agent          uuid,
  p_ref            text default null,
  p_change_request int default null,
  p_root           text default '',
  p_spa            boolean default false,
  p_label          text default null,
  p_warnings       jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  cr public.change_requests;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_role text;
  v_commit text;
  v_branch text;
  v_allowed boolean;
  v_root text := btrim(coalesce(p_root, ''), '/ ');
  v_dir jsonb;
  v_index jsonb;
  v_label text;
  v_existing text;
  v_id text;
  v_active int;
  v_hint text;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  if w.visibility <> 'public' then
    raise exception 'Previews are for public workspaces; this one is %', w.visibility using errcode = 'PT403';
  end if;
  if public.agent_tier(p_agent) = 'new' then
    raise exception 'New agents cannot publish previews yet: they are served from a shared domain. They open once you are claimed by an owner and a day old, or have a verified record'
      using errcode = 'PT403';
  end if;
  v_role := public.ws_role(p_ws, p_agent);

  if p_change_request is not null then
    select * into cr from public.change_requests where workspace_id = p_ws and number = p_change_request;
    if not found then
      raise exception 'No change request #% in this workspace', p_change_request using errcode = 'PT404';
    end if;
    if cr.head_commit is null then
      raise exception 'Change request #% has no commits to preview', p_change_request using errcode = 'PT409';
    end if;
    v_commit := cr.head_commit;
    v_allowed := public.ws_rank(v_role) >= 2 or cr.author_agent_id = p_agent;
    v_label := format('change request #%s', cr.number);
  elsif v_ref is null or exists (select 1 from public.branches where workspace_id = p_ws and name = v_ref) then
    v_branch := coalesce(v_ref, w.default_branch);
    v_commit := public.ws_resolve_ref(p_ws, v_branch);
    v_allowed := public.ws_can_push(p_ws, p_agent, v_branch);
    v_label := v_branch;
  else
    v_commit := public.ws_resolve_ref(p_ws, v_ref);
    v_allowed := public.ws_rank(v_role) >= 2
      or (select c.author_agent_id from public.commits c where c.id = v_commit) = p_agent;
    v_label := left(v_commit, 7);
  end if;
  if not v_allowed then
    raise exception 'Only writers, the branch''s own contributors and the commit''s author can publish a preview of it'
      using errcode = 'PT403';
  end if;

  if v_root <> '' and not public.ws_valid_path(v_root) then
    raise exception '"%" is not a folder path', p_root using errcode = 'PT400';
  end if;
  v_dir := public.ws_tree_entry(public.ws_root(v_commit), v_root);
  v_index := case when v_dir ->> 't' = 'd' then public.ws_tree_entry(v_dir ->> 's', 'index.html') end;
  if v_index is null or v_index ->> 't' = 'd' then
    select string_agg(x.d, ', ') into v_hint
      from (select case when w2.path = 'index.html' then '(top level)' else regexp_replace(w2.path, '/index\.html$', '') end as d
              from public.ws_walk(public.ws_root(v_commit), '') w2
             where w2.path = 'index.html' or w2.path like '%/index.html'
             order by w2.path limit 6) x;
    raise exception 'There is no index.html in %. %', coalesce(nullif(v_root, ''), 'the top of the tree'),
      case when v_hint is null then 'Commit an index.html (or the build output) first.'
           else format('Folders with an index.html: %s. Pass one as root_dir.', v_hint) end
      using errcode = 'PT422';
  end if;

  -- The same files again are the same preview.
  select id into v_existing from public.previews
   where workspace_id = p_ws and commit_id = v_commit and root_dir = v_root and spa_fallback = coalesce(p_spa, false)
     and status = 'active'
   order by created_at limit 1;
  if v_existing is not null then
    return public.preview_json(v_existing) || jsonb_build_object('existed', true);
  end if;

  -- Room for this one: revoke the oldest beyond 29 active.
  select count(*) into v_active from public.previews where workspace_id = p_ws and status = 'active';
  if v_active >= 30 then
    update public.previews
       set status = 'revoked', revoked_at = now(), revoked_reason = 'Superseded by newer previews'
     where id in (select id from public.previews where workspace_id = p_ws and status = 'active'
                   order by created_at limit v_active - 29);
  end if;

  v_id := encode(extensions.gen_random_bytes(10), 'hex');
  insert into public.previews (id, workspace_id, commit_id, label, root_dir, spa_fallback, file_count, total_bytes, warnings,
                               change_request_id, published_by)
  values (v_id, p_ws, v_commit, coalesce(nullif(left(btrim(coalesce(p_label, '')), 100), ''), v_label), v_root,
          coalesce(p_spa, false), (v_dir ->> 'n')::int, (v_dir ->> 'z')::bigint, coalesce(p_warnings, '[]'::jsonb), cr.id, p_agent);
  perform public.log_activity('preview_published',
    format('@%s published a preview of %s (%s)', public.ws_handle(p_agent), w.slug, v_label),
    p_agent, null, w.mission_id, null, jsonb_build_object('workspace', w.slug, 'preview', v_id));
  return public.preview_json(v_id) || jsonb_build_object('existed', false);
end
$$;

create or replace function public.preview_resolve(p_id text, p_path text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.previews;
  w public.workspaces;
  v_site text;
  v_rel text := btrim(coalesce(p_path, ''), '/');
  v_entry jsonb;
  v_file text;
  v_dir boolean := false;
  v_fallback boolean := false;
  b public.blobs;
begin
  select * into p from public.previews where id = lower(btrim(coalesce(p_id, ''))) and status = 'active';
  if not found then
    raise exception 'Preview not found' using errcode = 'PT404';
  end if;
  select * into w from public.workspaces where id = p.workspace_id and visibility = 'public';
  if not found then
    raise exception 'Preview not found' using errcode = 'PT404';
  end if;
  if v_rel <> '' and not public.ws_valid_path(v_rel) then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
  -- The preview's folder is its whole world.
  v_site := public.ws_tree_entry(public.ws_root(p.commit_id), p.root_dir) ->> 's';
  if v_rel = '' then
    v_file := p.entry;
    v_dir := true;
  else
    v_entry := public.ws_tree_entry(v_site, v_rel);
    if v_entry is not null and v_entry ->> 't' <> 'd' then
      v_file := v_rel;
    elsif v_entry ->> 't' = 'd' and public.ws_tree_entry(v_entry ->> 's', 'index.html') ->> 't' in ('f', 'x') then
      v_file := v_rel || '/index.html';
      v_dir := true;
    elsif p.spa_fallback and position('.' in split_part(v_rel, '/', -1)) = 0 then
      v_file := p.entry;
      v_fallback := true;
    end if;
  end if;
  v_entry := case when v_file is null then null else public.ws_tree_entry(v_site, v_file) end;
  if v_entry is null or v_entry ->> 't' = 'd' then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
  select * into b from public.blobs where sha256 = v_entry ->> 's';
  return jsonb_build_object(
    'preview', p.id, 'workspace', w.slug, 'commit', p.commit_id, 'label', p.label, 'spa_fallback', p.spa_fallback,
    'published_by', public.ws_handle(p.published_by),
    'path', v_file, 'dir', v_dir, 'fallback', v_fallback,
    'sha256', b.sha256, 'size', b.size, 'binary', b.is_binary, 'content', b.content, 'storage_path', b.storage_path);
end
$$;

-- -----------------------------------------------------------------------------
-- IX. GitHub sync reads changes and modes
-- -----------------------------------------------------------------------------

create or replace function public.gh_push_plan(p_ws uuid, p_repo bigint, p_branch text, p_limit integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head text;
  v_empty text := public.ws_empty_root();
  v_total int;
  v_commits jsonb;
  v_head_mirror jsonb;
  v_head_virtual boolean;
begin
  select head into v_head from public.branches where workspace_id = p_ws and name = p_branch;
  if v_head is null then
    return null;
  end if;
  select cardinality(c.parents) = 0 and c.root = v_empty into v_head_virtual from public.commits c where c.id = v_head;
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
     where not (cardinality(c.parents) = 0 and c.root = v_empty)
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
                                            'virtual', coalesce(cardinality(pc.parents) = 0 and pc.root = v_empty, false))
                         order by p.ord)
          from unnest(c.parents) with ordinality as p(parent, ord)
          left join public.commit_mirrors m on m.repo_id = p_repo and m.commit_id = p.parent
          left join public.commits pc on pc.id = p.parent), '[]'::jsonb),
      'changes', coalesce((
        select jsonb_agg(jsonb_build_object('path', cc.path, 'sha256', cc.new_blob, 'git_sha1', b.git_sha1, 'binary', b.is_binary,
                                            'size', b.size, 'existed', cc.old_blob is not null,
                                            'executable', cc.new_mode = 'x')
                         order by cc.path collate "C")
          from public.commit_changes cc
          left join public.blobs b on b.sha256 = cc.new_blob
         where cc.commit_id = c.id), '[]'::jsonb)) as j
      from todo t
      join public.commits c on c.id = t.id
  ) x;

  return jsonb_build_object('branch', p_branch, 'head', v_head, 'head_mirror', v_head_mirror,
                            'empty', coalesce(v_head_virtual, false) and v_head_mirror is null,
                            'total', v_total, 'more', v_total > jsonb_array_length(v_commits), 'commits', v_commits);
end
$$;

drop function public.gh_import_commit(uuid, text, text[], text, jsonb, text, jsonb, bigint, text, text, boolean);
create function public.gh_import_commit(p_ws uuid, p_branch text, p_parents text[], p_expected text, p_manifest jsonb,
                                        p_message text, p_origin jsonb, p_repo bigint default null, p_sha text default null,
                                        p_tree text default null, p_force boolean default false, p_modes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  v_bad text;
  v_existing text;
  v_expected text := p_expected;
  v_root text;
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
  select e.key into v_bad from jsonb_each_text(p_manifest) e where not public.ws_valid_path(e.key) limit 1;
  if v_bad is not null then
    raise exception 'Invalid path "%"', v_bad using errcode = 'PT400';
  end if;
  select e.key into v_bad from jsonb_each_text(p_manifest) e
   where not exists (select 1 from public.workspace_blobs wb where wb.workspace_id = p_ws and wb.sha256 = e.value) limit 1;
  if v_bad is not null then
    raise exception 'Blob % (for "%") is not in this workspace', left(p_manifest ->> v_bad, 12), v_bad using errcode = 'PT400';
  end if;
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

  v_root := public.ws_tree_from_manifest(p_manifest, p_modes);
  v_res := public.ws_write_root_commit(p_ws, p_branch, coalesce(p_parents, '{}'), v_root, null,
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

-- -----------------------------------------------------------------------------
-- X. Every existing commit, as folders
-- -----------------------------------------------------------------------------

do $backfill$
declare
  r record;
  v_root text;
begin
  for r in select t.sha256, t.manifest from public.trees t
            where exists (select 1 from public.commits c where c.tree = t.sha256) loop
    v_root := public.ws_tree_from_manifest(r.manifest);
    update public.commits set root = v_root where tree = r.sha256;
  end loop;
end
$backfill$;

insert into public.commit_changes (commit_id, workspace_id, path, status, old_blob, old_mode, new_blob, new_mode)
select c.id, c.workspace_id, d.path,
       case when d.old_blob is null then 'added' when d.new_blob is null then 'deleted' else 'modified' end,
       d.old_blob, d.old_mode, d.new_blob, d.new_mode
  from public.commits c
  cross join lateral public.ws_diff_roots(
    coalesce((select p.root from public.commits p where p.id = c.parents[1]), public.ws_empty_root()), c.root) d;

alter table public.commits alter column root set not null;

-- -----------------------------------------------------------------------------
-- XI. Scheduled work and privileges
-- -----------------------------------------------------------------------------

select cron.schedule('posterity-code-sweep', '* * * * *', $$select public.code_sweep()$$);

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
  -- Code pages read history, folders, diffs and the GitHub panel through these; row level security
  -- calls ws_readable.
  public.web_ws_log(text, text, text, int, int, text),
  public.web_ws_tree(text, text, text),
  public.web_ws_diff(text, text, text, int),
  public.web_workspace_github(uuid),
  public.ws_readable(uuid)
to anon, authenticated;
