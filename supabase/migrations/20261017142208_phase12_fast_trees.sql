-- Phase 12: building a whole tree at once, fast.
--
-- A GitHub import (and any flat list of files) became folders through one recursive edit per folder,
-- which took close to a minute for 100,000 files. Now every folder of one depth is built in a single
-- statement, deepest first, so the cost follows the number of files with no recursion. A big first
-- commit no longer lists each of its files as a change (its tree says the same): path history and the
-- GitHub push read the tree for it. Diffs from the empty root walk the other tree.

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
  create temp table if not exists ws_build (dir text not null, name text not null, entry jsonb not null, depth int not null)
    on commit drop;
  truncate pg_temp.ws_build;
  insert into pg_temp.ws_build (dir, name, entry, depth)
  select coalesce(substring(e.key from '^(.*)/[^/]*$'), ''), substring(e.key from '[^/]*$'),
         jsonb_build_object('t', case when coalesce(p_modes, '{}'::jsonb) ->> e.key = 'x' then 'x' else 'f' end,
                            's', e.value, 'z', b.size),
         length(e.key) - length(replace(e.key, '/', ''))
    from jsonb_each_text(p_manifest) e
    left join public.blobs b on b.sha256 = e.value;
  select dir || case when dir = '' then '' else '/' end || name into v_bad
    from pg_temp.ws_build where entry ->> 'z' is null limit 1;
  if v_bad is not null then
    raise exception 'Unknown blob % for "%"', left(p_manifest ->> v_bad, 12), v_bad using errcode = 'PT400';
  end if;
  -- A file whose path is also a folder of another file.
  with dirs as (select distinct string_to_array(dir, '/') as parts from pg_temp.ws_build where dir <> ''),
  folders as (select distinct array_to_string(parts[1:i], '/') as path
                from dirs cross join lateral generate_series(1, cardinality(parts)) as i)
  select f.path into v_bad
    from (select dir || case when dir = '' then '' else '/' end || name as path from pg_temp.ws_build) f
    join folders using (path)
   limit 1;
  if v_bad is not null then
    raise exception '"%" cannot be both a file and a folder', v_bad using errcode = 'PT400';
  end if;
  select max(depth) into v_depth from pg_temp.ws_build;
  -- Folders at each depth, deepest first: each becomes an entry of its parent.
  for d in reverse v_depth .. 1 loop
    with nodes as (
      select dir, jsonb_object_agg(name, entry) as entries,
             sum(case when entry ->> 't' = 'd' then (entry ->> 'n')::int else 1 end)::int as n,
             sum((entry ->> 'z')::bigint)::bigint as z
        from pg_temp.ws_build where depth = d group by dir
    ),
    hashed as (select dir, entries, n, z, public.ws_node_hash(entries) as h from nodes),
    stored as (
      insert into public.tree_nodes (sha256, entries, file_count, total_bytes)
      select h, entries, n, z from hashed
      on conflict (sha256) do nothing
    )
    insert into pg_temp.ws_build (dir, name, entry, depth)
    select coalesce(substring(dir from '^(.*)/[^/]*$'), ''), substring(dir from '[^/]*$'),
           jsonb_build_object('t', 'd', 's', h, 'z', z, 'n', n), d - 1
      from hashed;
  end loop;
  with root as (
    select jsonb_object_agg(name, entry) as entries,
           sum(case when entry ->> 't' = 'd' then (entry ->> 'n')::int else 1 end)::int as n,
           sum((entry ->> 'z')::bigint)::bigint as z
      from pg_temp.ws_build where depth = 0
  )
  select public.ws_node_hash(entries) into v_root from root;
  insert into public.tree_nodes (sha256, entries, file_count, total_bytes)
  select v_root, entries, n, z from (
    select jsonb_object_agg(name, entry) as entries,
           sum(case when entry ->> 't' = 'd' then (entry ->> 'n')::int else 1 end)::int as n,
           sum((entry ->> 'z')::bigint)::bigint as z
      from pg_temp.ws_build where depth = 0) r
  on conflict (sha256) do nothing;
  truncate pg_temp.ws_build;
  return v_root;
end
$$;

-- Files that differ between two roots, skipping every folder both share; from the empty root, simply
-- every file of the other.
create or replace function public.ws_diff_roots(p_a text, p_b text)
returns table (path text, old_blob text, old_mode text, new_blob text, new_mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.path, null::text, null::text, w.blob, w.mode
    from public.ws_walk(p_b, '') w
   where coalesce(p_a, public.ws_empty_root()) = public.ws_empty_root() and p_b is not null
  union all
  select * from (
    with recursive d(path, at, sa, bt, sb) as (
      select ''::text, 'd'::text, p_a, 'd'::text, p_b
       where p_a is distinct from p_b and coalesce(p_a, public.ws_empty_root()) <> public.ws_empty_root()
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
  ) x
$$;

-- Write a commit of this root on top of its parents, record what it changed, and (p_move) move the
-- branch to it. With p_move false the commit is written but no branch moves (rebases, queue tests).
-- A big first commit (over 5000 files on an empty parent, like an import) lists no changes: every file
-- of its tree is new, and readers walk the tree instead (stats.from_empty).
create or replace function public.ws_write_root_commit(p_ws uuid, p_branch text, p_parents text[], p_root text, p_author uuid,
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
  if coalesce(v_parent_root, public.ws_empty_root()) = public.ws_empty_root() and n.file_count > 5000 then
    v_stats := jsonb_build_object('added', n.file_count, 'modified', 0, 'deleted', 0, 'files', n.file_count,
                                  'bytes', n.total_bytes, 'from_empty', true);
  else
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
  end if;
  update public.commits set stats = v_stats where id = v_id;
  update public.workspaces set commit_count = commit_count + 1, last_commit_at = now(), updated_at = now() where id = p_ws;
  if coalesce(p_move, true) then
    perform public.ws_move_branch(p_ws, p_branch, v_id, p_expected);
  end if;
  return jsonb_build_object('commit', v_id, 'branch', p_branch, 'tree', p_root, 'root', p_root,
                            'parents', coalesce(p_parents, '{}'), 'generation', v_gen, 'stats', v_stats);
end
$$;

-- One page of history from a head, newest first; with a path, the commits that changed it (or
-- anything under it). Continue with p_before: the last commit of the previous page ("next").
create or replace function public.ws_log_page(p_ws uuid, p_head text, p_path text, p_limit int, p_offset int, p_before text)
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
           and (v_path is null
                or exists (select 1 from public.commit_changes cc
                            where cc.commit_id = c.id and (cc.path = v_path or starts_with(cc.path, v_path || '/')))
                or (coalesce((c.stats ->> 'from_empty')::boolean, false) and public.ws_tree_entry(c.root, v_path) is not null))
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
      'changes', case when coalesce((c.stats ->> 'from_empty')::boolean, false) then coalesce((
        select jsonb_agg(jsonb_build_object('path', w.path, 'sha256', w.blob, 'git_sha1', b.git_sha1, 'binary', b.is_binary,
                                            'size', b.size, 'existed', false, 'executable', w.mode = 'x')
                         order by w.path collate "C")
          from public.ws_walk(c.root, '') w
          left join public.blobs b on b.sha256 = w.blob), '[]'::jsonb)
      else coalesce((
        select jsonb_agg(jsonb_build_object('path', cc.path, 'sha256', cc.new_blob, 'git_sha1', b.git_sha1, 'binary', b.is_binary,
                                            'size', b.size, 'existed', cc.old_blob is not null,
                                            'executable', cc.new_mode = 'x')
                         order by cc.path collate "C")
          from public.commit_changes cc
          left join public.blobs b on b.sha256 = cc.new_blob
         where cc.commit_id = c.id), '[]'::jsonb) end) as j
      from todo t
      join public.commits c on c.id = t.id
  ) x;

  return jsonb_build_object('branch', p_branch, 'head', v_head, 'head_mirror', v_head_mirror,
                            'empty', coalesce(v_head_virtual, false) and v_head_mirror is null,
                            'total', v_total, 'more', v_total > jsonb_array_length(v_commits), 'commits', v_commits);
end
$$;
