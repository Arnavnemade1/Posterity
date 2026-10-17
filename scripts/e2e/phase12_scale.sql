-- Phase 12 scale test: a 100,000-file workspace. Imports it as one commit, then times a one-file
-- commit, a diff, a path's history, a three-way merge plan and a merge commit on it, and history and
-- merge bases over 5,000 commits. The API's database calls stop at 8 seconds; each step should take
-- well under that (import_ms is the tightest).
--
-- Two statements, run separately with MCP `execute_sql` (each call gives up after about a minute):
--   1. Setup (commits): an owner, an "e2e-" agent and workspace, and 100,000 small files' blobs.
--   2. The benchmark: runs inside one transaction and ends by raising PHASE12_SCALE_RESULT, which rolls
--      it back. Every "ok_*" key should be true; "*_ms" keys are timings.
-- Remove the setup with scripts/e2e/cleanup.sql.
--
-- Not timed here: GitHub's first push of such an import (gh_push_plan lists every file of a commit
-- made from nothing), which takes far longer than 8 seconds at this size.

-- 1. Setup
do $setup$
declare
  u uuid := gen_random_uuid();
  a uuid;
  ws uuid;
begin
  if exists (select 1 from public.workspaces where slug = 'e2e-scale-yard') then
    raise exception 'Already set up; run scripts/e2e/cleanup.sql first';
  end if;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2e-owner-scale@phase12.invalid',
          '{"username":"e2e_owner_scale"}', now(), now());
  a := (public.register_agent('e2e-scale', 'Scale', '', '{code}', '{}', '{}', null, u, 'api') -> 'agent' ->> 'id')::uuid;
  ws := (public.create_workspace(a, 'e2e Scale Yard', 'e2e-scale-yard') ->> 'id')::uuid;
  insert into public.blobs (sha256, git_sha1, size, is_binary, content)
  select encode(extensions.digest('file ' || g, 'sha256'), 'hex'), encode(extensions.digest('file ' || g, 'sha1'), 'hex'),
         octet_length('file ' || g), false, 'file ' || g
    from generate_series(1, 100000) g
  on conflict do nothing;
  insert into public.blobs (sha256, git_sha1, size, is_binary, content)
  values (encode(extensions.digest('changed', 'sha256'), 'hex'), encode(extensions.digest('changed', 'sha1'), 'hex'), 7, false, 'changed')
  on conflict do nothing;
  insert into public.workspace_blobs (workspace_id, sha256)
  select ws, encode(extensions.digest('file ' || g, 'sha256'), 'hex') from generate_series(1, 100000) g
  union all
  select ws, encode(extensions.digest('changed', 'sha256'), 'hex')
  on conflict do nothing;
end $setup$;

-- 2. The benchmark
do $test$
declare
  ws uuid := (select id from public.workspaces where slug = 'e2e-scale-yard');
  a uuid := (select id from public.agents where handle = 'e2e-scale');
  v_changed text := encode(extensions.digest('changed', 'sha256'), 'hex');
  out jsonb := '{}'::jsonb;
  t timestamptz;
  r jsonb;
  h0 text; h1 text; h2 text; hb text; v_tip text;
  v_manifest jsonb;
  cnt int;
begin
  if ws is null then
    raise exception 'Run the setup statement first';
  end if;
  h0 := public.ws_resolve_ref(ws, 'main');
  -- 100 top folders of 10 folders of 100 files.
  select jsonb_object_agg(format('src/m%s/p%s/f%s.txt', g % 100, (g / 100) % 10, g), encode(extensions.digest('file ' || g, 'sha256'), 'hex'))
    into v_manifest from generate_series(1, 100000) g;

  t := clock_timestamp();
  r := public.gh_import_commit(ws, 'main', array[h0], h0, v_manifest, 'Import', '{"provider": "github"}');
  h1 := r ->> 'commit';
  out := out || jsonb_build_object(
    'import_ms', round(extract(epoch from clock_timestamp() - t) * 1000),
    'ok_import', (r -> 'stats' ->> 'files')::int = 100000 and (r -> 'stats' ->> 'from_empty')::boolean
                 and (select count(*) from public.commit_changes where commit_id = h1) = 0
                 and (select file_count from public.tree_nodes where sha256 = r ->> 'root') = 100000);

  t := clock_timestamp();
  h2 := public.ws_commit(ws, a, 'main', null, 'One file', jsonb_build_array(
          jsonb_build_object('path', 'src/m5/p5/f505.txt', 'blob', v_changed))) ->> 'commit';
  out := out || jsonb_build_object('one_file_commit_ms', round(extract(epoch from clock_timestamp() - t) * 1000));

  t := clock_timestamp();
  cnt := (public.ws_diff(ws, a, h1, h2) ->> 'total')::int;
  out := out || jsonb_build_object('diff_ms', round(extract(epoch from clock_timestamp() - t) * 1000), 'ok_diff', cnt = 1);

  t := clock_timestamp();
  r := public.ws_log(ws, a, 'main', 'src/m5/p5/f505.txt');
  out := out || jsonb_build_object(
    'path_log_ms', round(extract(epoch from clock_timestamp() - t) * 1000),
    'ok_path_log', jsonb_array_length(r -> 'commits') = 2 and r -> 'commits' -> 1 ->> 'id' = h1);

  t := clock_timestamp();
  r := public.ws_tree(ws, a, 'main', 'src/m5/p5');
  out := out || jsonb_build_object(
    'folder_ms', round(extract(epoch from clock_timestamp() - t) * 1000),
    'ok_folder', jsonb_array_length(r -> 'entries') = 100);

  -- Two branches, 50 files changed on each; main merges into side.
  perform public.ws_create_branch(ws, a, 'side', h1);
  perform public.ws_commit(ws, a, 'side', null, 'Side', (
            select jsonb_agg(jsonb_build_object('path', format('src/m%s/p%s/f%s.txt', g % 100, (g / 100) % 10, g), 'blob', v_changed))
              from generate_series(1000, 1049) g));
  perform public.ws_commit(ws, a, 'main', null, 'Main', (
            select jsonb_agg(jsonb_build_object('path', format('src/m%s/p%s/f%s.txt', g % 100, (g / 100) % 10, g), 'blob', v_changed))
              from generate_series(2000, 2049) g));
  t := clock_timestamp();
  hb := public.ws_merge_base(public.ws_resolve_ref(ws, 'main'), public.ws_resolve_ref(ws, 'side'));
  r := public.ws_merge_plan(public.ws_root(hb), public.ws_root(public.ws_resolve_ref(ws, 'main')),
                            public.ws_root(public.ws_resolve_ref(ws, 'side')));
  out := out || jsonb_build_object('three_way_ms', round(extract(epoch from clock_timestamp() - t) * 1000));
  t := clock_timestamp();
  r := public.ws_merge_branches(ws, a, 'side', 'main');
  out := out || jsonb_build_object(
    'merge_commit_ms', round(extract(epoch from clock_timestamp() - t) * 1000),
    'ok_merge', r ->> 'status' = 'merged' and (r -> 'stats' ->> 'modified')::int = 51 and (r -> 'stats' ->> 'files')::int = 100000);

  -- 5,000 more commits on main, written directly.
  v_tip := public.ws_resolve_ref(ws, 'main');
  insert into public.commits (id, workspace_id, root, parents, generation, author_agent_id, message, stats)
  select encode(extensions.digest(v_tip || g, 'sha256'), 'hex'), ws, public.ws_root(v_tip),
         array[case when g = 1 then v_tip else encode(extensions.digest(v_tip || (g - 1), 'sha256'), 'hex') end],
         (select generation from public.commits where id = v_tip) + g, a, 'History ' || g, '{}'
    from generate_series(1, 5000) g;
  update public.branches set head = encode(extensions.digest(v_tip || 5000, 'sha256'), 'hex')
   where workspace_id = ws and name = 'main';
  t := clock_timestamp();
  r := public.ws_log(ws, a, 'main', null, 30);
  out := out || jsonb_build_object(
    'log_5000_ms', round(extract(epoch from clock_timestamp() - t) * 1000),
    'ok_log_5000', jsonb_array_length(r -> 'commits') = 30 and r -> 'commits' -> 0 ->> 'message' = 'History 5000');
  t := clock_timestamp();
  hb := public.ws_merge_base(public.ws_resolve_ref(ws, 'main'), public.ws_resolve_ref(ws, 'side'));
  out := out || jsonb_build_object(
    'merge_base_5000_ms', round(extract(epoch from clock_timestamp() - t) * 1000),
    'ok_merge_base_5000', hb = v_tip);

  raise exception 'PHASE12_SCALE_RESULT %', out::text;
exception when others then
  if sqlerrm like 'PHASE12_SCALE_RESULT%' then
    raise;
  end if;
  raise exception 'PHASE12_SCALE_FAILED (%): % | so far: %', sqlstate, sqlerrm, out::text;
end $test$;
