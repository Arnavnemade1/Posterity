-- Phase 12: a 100,000-file import inside the API's 8 second limit.
--
-- The tree builder wrote every file as a row of a temporary table before grouping them into folders,
-- and checked every path with a per-path function: together near 8 seconds for 100,000 files. Files
-- are now grouped into their folders as they are read, so the temporary table only holds folders, and
-- paths are checked by file name plus once per distinct folder.

-- The first invalid path of a manifest {path: blob}, or null. Same rules as ws_valid_path.
create or replace function public.ws_bad_manifest_path(p_manifest jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with f as materialized (
    select k.key, split_part(k.key, '/', -1) as name,
           case when strpos(k.key, '/') = 0 then ''
                else left(k.key, length(k.key) - length(split_part(k.key, '/', -1)) - 1) end as dir
      from jsonb_object_keys(p_manifest) as k(key)
  ),
  -- Materialized so each folder is checked once, not once per file.
  dirs as materialized (select distinct f.dir from f where f.dir <> '')
  select coalesce(
    (select f.key from f
      where char_length(f.key) not between 1 and 500
         or f.key ~ '[[:cntrl:]\\]|^/|/$|//'
         or f.name in ('.', '..') or lower(f.name) in ('.git', '.posterity') or char_length(f.name) > 255
      limit 1),
    (select min(f.key) from f
      where f.dir = (select d.dir from dirs d where not public.ws_valid_path(d.dir) limit 1)))
$$;

-- A root from a flat manifest {path: blob}; p_modes marks executables: {"path": "x"}. Raises on a blob
-- that does not exist and on a path used as both a file and a folder.
create or replace function public.ws_tree_from_manifest(p_manifest jsonb, p_modes jsonb default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad text;
  v_depth int;
  v_root text;
begin
  if p_manifest is null or p_manifest = '{}'::jsonb then
    return public.ws_empty_root();
  end if;
  create temp table if not exists ws_dirs (dir text primary key, depth int not null, files jsonb not null,
                                           subs jsonb not null, n int not null, z bigint not null, bad text)
    on commit drop;
  truncate pg_temp.ws_dirs;
  -- Every folder that holds files, with its files as entries.
  insert into pg_temp.ws_dirs (dir, depth, files, subs, n, z, bad)
  select f.dir, f.depth, jsonb_object_agg(f.name, jsonb_build_object('t', f.t, 's', f.sha, 'z', b.size)), '{}'::jsonb,
         count(*), coalesce(sum(b.size), 0), min(f.key) filter (where b.size is null)
    from (select e.key, e.value as sha, split_part(e.key, '/', -1) as name,
                 case when strpos(e.key, '/') = 0 then ''
                      else left(e.key, length(e.key) - length(split_part(e.key, '/', -1)) - 1) end as dir,
                 length(e.key) - length(replace(e.key, '/', '')) as depth,
                 case when p_modes ->> e.key = 'x' then 'x' else 'f' end as t
            from jsonb_each_text(p_manifest) e) f
    left join public.blobs b on b.sha256 = f.sha
   group by f.dir, f.depth;
  select bad into v_bad from pg_temp.ws_dirs where bad is not null limit 1;
  if v_bad is not null then
    raise exception 'Unknown blob % for "%"', left(p_manifest ->> v_bad, 12), v_bad using errcode = 'PT400';
  end if;
  -- Folders that only hold folders, and the root.
  insert into pg_temp.ws_dirs (dir, depth, files, subs, n, z)
  select distinct array_to_string(d.parts[1:i], '/'), i, '{}'::jsonb, '{}'::jsonb, 0, 0
    from (select string_to_array(dir, '/') as parts from pg_temp.ws_dirs where dir <> '') d
    cross join lateral generate_series(1, cardinality(d.parts) - 1) as i
  on conflict (dir) do nothing;
  insert into pg_temp.ws_dirs (dir, depth, files, subs, n, z) values ('', 0, '{}'::jsonb, '{}'::jsonb, 0, 0)
  on conflict (dir) do nothing;
  -- A file whose path is also a folder.
  select dir into v_bad from pg_temp.ws_dirs where dir <> '' and p_manifest ? dir limit 1;
  if v_bad is not null then
    raise exception '"%" cannot be both a file and a folder', v_bad using errcode = 'PT400';
  end if;
  select max(depth) into v_depth from pg_temp.ws_dirs;
  -- Deepest first: each folder is stored, then becomes an entry of its parent.
  for d in reverse v_depth .. 1 loop
    with hashed as (
      select dir, files || subs as entries, n, z, public.ws_node_hash(files || subs) as h
        from pg_temp.ws_dirs where depth = d
    ),
    stored as (
      insert into public.tree_nodes (sha256, entries, file_count, total_bytes)
      select h, entries, n, z from hashed
      on conflict (sha256) do nothing
    ),
    up as (
      select case when strpos(dir, '/') = 0 then ''
                  else left(dir, length(dir) - length(split_part(dir, '/', -1)) - 1) end as parent,
             jsonb_object_agg(split_part(dir, '/', -1), jsonb_build_object('t', 'd', 's', h, 'z', z, 'n', n)) as subs,
             sum(n)::int as n, sum(z)::bigint as z
        from hashed group by 1
    )
    update pg_temp.ws_dirs p set subs = p.subs || up.subs, n = p.n + up.n, z = p.z + up.z
      from up where p.dir = up.parent;
  end loop;
  select public.ws_node_hash(files || subs) into v_root from pg_temp.ws_dirs where dir = '';
  insert into public.tree_nodes (sha256, entries, file_count, total_bytes)
  select v_root, files || subs, n, z from pg_temp.ws_dirs where dir = ''
  on conflict (sha256) do nothing;
  truncate pg_temp.ws_dirs;
  return v_root;
end
$$;

create or replace function public.gh_import_commit(p_ws uuid, p_branch text, p_parents text[], p_expected text, p_manifest jsonb,
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
  v_bad := public.ws_bad_manifest_path(p_manifest);
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

revoke all on function public.ws_bad_manifest_path(jsonb) from public, anon, authenticated;
grant execute on function public.ws_bad_manifest_path(jsonb) to service_role;
