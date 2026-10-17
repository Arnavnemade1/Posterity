-- Phase 10.1 database test: workspaces. Paths and names, blobs and their hashes, commits (atomic,
-- compare-and-swap heads, quotas), branches, reading, three-way merges and conflicts, change requests
-- and their approvals, protected branches, open contribution, the mission integration (task
-- branches, frozen review, verified work merging by itself) and row level security.
--
-- Runs entirely inside one transaction and ends by raising PHASE10_RESULT, which rolls everything
-- back. Every "ok_*" key in the JSON should be true. Run it with the Supabase SQL editor or MCP
-- `execute_sql`.
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  r jsonb; j jsonb;
  a uuid; b uuid; c uuid; d uuid; x uuid;
  ws uuid; ws2 uuid; priv uuid; mws uuid;
  h0 text; h1 text; h2 text; hx text; hy text;
  s1 text; s2 text; s3 text; s4 text; sx text; sy text; sz text; sr text;
  cr uuid; cr2 uuid; cr3 uuid;
  m jsonb; mid uuid; t_api uuid; t_docs uuid; sub uuid; sub2 uuid;
  n int;
begin
  create function pg_temp.fails(p_sql text, p_code text) returns boolean
  language plpgsql as $fn$
  begin
    execute p_sql;
    return false;
  exception when others then
    return sqlstate = p_code;
  end
  $fn$;

  -- Upload a text file to a workspace as an agent; returns its sha256.
  create function pg_temp.blob(p_ws uuid, p_agent uuid, p_text text) returns text
  language plpgsql as $fn$
  declare
    v_sha text := encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.ws_add_blob(p_ws, p_agent, v_sha, encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha1'), 'hex'),
                               octet_length(convert_to(p_text, 'UTF8')), false, p_text, null);
    return v_sha;
  end
  $fn$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@phase10.invalid', '{"username":"phase10_u1"}', now(), now()),
         (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@phase10.invalid', '{"username":"phase10_u2"}', now(), now()),
         (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u3@phase10.invalid', '{"username":"phase10_u3"}', now(), now());

  a := (public.register_agent('p10-alice', 'Alice', '', '{code}', '{}', '{}', null, u1, 'api') -> 'agent' ->> 'id')::uuid;
  b := (public.register_agent('p10-bob', 'Bob', '', '{code}', '{}', '{}', null, u2, 'api') -> 'agent' ->> 'id')::uuid;
  c := (public.register_agent('p10-carol', 'Carol', '', '{code}', '{}', '{}', null, u2, 'api') -> 'agent' ->> 'id')::uuid;
  d := (public.register_agent('p10-dave', 'Dave', '', '{code,review}', '{}', '{}', null, u3, 'api') -> 'agent' ->> 'id')::uuid;
  x := (public.register_agent('p10-xena', 'Xena', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;

  -- ------------------------------------------------------------ grants, names and paths
  out := out || jsonb_build_object(
    'ok_grants', has_function_privilege('anon', 'public.ws_readable(uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.ws_commit(uuid, uuid, text, text, text, jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.ws_commit(uuid, uuid, text, text, text, jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.create_workspace(uuid, text, text, text, text, uuid, uuid, boolean)', 'execute')
                 and not has_function_privilege('authenticated', 'public.merge_change_request(uuid, uuid, text, text, boolean)', 'execute'),
    'ok_paths', public.ws_valid_path('src/a.ts') and public.ws_valid_path('README.md') and public.ws_valid_path('.github/workflows/ci.yml')
                and not public.ws_valid_path('../x') and not public.ws_valid_path('a/../b') and not public.ws_valid_path('./a')
                and not public.ws_valid_path('.git/config') and not public.ws_valid_path('x/.GIT/y') and not public.ws_valid_path('/abs')
                and not public.ws_valid_path('a//b') and not public.ws_valid_path('a/') and not public.ws_valid_path('x\y')
                and not public.ws_valid_path('.posterity/index') and not public.ws_valid_path(E'a\nb') and not public.ws_valid_path(''),
    'ok_branches', public.ws_valid_branch('main') and public.ws_valid_branch('task/plan') and public.ws_valid_branch('p10-bob/feature-1')
                   and not public.ws_valid_branch('a..b') and not public.ws_valid_branch('x/') and not public.ws_valid_branch('-x')
                   and not public.ws_valid_branch('a//b') and not public.ws_valid_branch('x.lock') and not public.ws_valid_branch('a/.b'),
    'ok_three_way', public.ws_three_way('{"f":"1","g":"1"}', '{"f":"2","g":"1"}', '{"f":"1","g":"3","h":"4"}')
                    = '{"manifest": {"f": "2", "g": "3", "h": "4"}, "conflicts": []}'::jsonb
                    and public.ws_three_way('{"f":"1"}', '{"f":"2"}', '{"f":"3"}') -> 'conflicts' = '["f"]'::jsonb
                    and public.ws_three_way('{"f":"1"}', '{}', '{"f":"1"}') = '{"manifest": {}, "conflicts": []}'::jsonb
                    and public.ws_three_way('{"f":"1"}', '{}', '{"f":"2"}') -> 'conflicts' = '["f"]'::jsonb,
    'ok_dir_conflict', public.ws_dir_conflict('{"a": "1", "a/b": "2"}') = 'a' and public.ws_dir_conflict('{"a/b": "1", "a/c": "2"}') is null);

  -- ------------------------------------------------------------ creating a workspace
  r := public.create_workspace(a, 'Phase Ten Lab', null, 'A test workspace.');
  ws := (r ->> 'id')::uuid;
  h0 := r ->> 'head';
  out := out || jsonb_build_object(
    'ok_created', r ->> 'slug' = 'phase-ten-lab' and r ->> 'your_role' = 'owner' and r ->> 'default_branch' = 'main'
                  and h0 ~ '^[0-9a-f]{64}$' and (r -> 'counts' ->> 'commits')::int = 1,
    'ok_owner_member', public.ws_role(ws, a) = 'owner' and public.ws_role(ws, b) = 'reader' and public.ws_role(ws, null) is null,
    'ok_slug_taken', pg_temp.fails(format('select public.create_workspace(%L, %L, %L)', b, 'Another', 'phase-ten-lab'), 'PT409'),
    'ok_auto_slug', public.create_workspace(b, 'Phase Ten Lab') ->> 'slug' = 'phase-ten-lab-2',
    'ok_bad_visibility', pg_temp.fails(format('select public.create_workspace(%L, %L, null, null, %L)', a, 'Hidden', 'secret'), 'PT400'),
    'ok_name_secret', pg_temp.fails(format('select public.create_workspace(%L, %L, null, %L)', a, 'Keys', 'pst_' || repeat('a1', 24)), 'PT422'));

  -- ------------------------------------------------------------ blobs
  s1 := pg_temp.blob(ws, a, E'# Lab\n');
  s2 := pg_temp.blob(ws, a, E'export const one = 1;\n');
  out := out || jsonb_build_object(
    'ok_blob_existed', (public.ws_add_blob(ws, a, s1, encode(extensions.digest('x', 'sha1'), 'hex'), 6, false, E'# Lab\n', null) ->> 'existed')::boolean,
    'ok_blob_hash_checked', pg_temp.fails(format('select public.ws_add_blob(%L, %L, %L, %L, 5, false, %L, null)', ws, a, repeat('0', 64), repeat('0', 40), 'hello'), 'PT400'),
    'ok_blob_size_checked', pg_temp.fails(format('select public.ws_add_blob(%L, %L, %L, %L, 99, false, %L, null)', ws, a,
                                                 encode(extensions.digest('hello', 'sha256'), 'hex'), repeat('0', 40), 'hello'), 'PT400'),
    'ok_blob_secret', pg_temp.fails(format('select pg_temp.blob(%L, %L, %L)', ws, a, 'key = "sk-ant-' || repeat('x', 30) || '"'), 'PT422'),
    'ok_missing_blobs', public.ws_missing_blobs(ws, a, array[s1, s2, repeat('f', 64)]) = array[repeat('f', 64)]);

  -- ------------------------------------------------------------ commits
  r := public.ws_commit(ws, a, 'main', h0, 'Start the lab', jsonb_build_array(
         jsonb_build_object('path', 'README.md', 'blob', s1), jsonb_build_object('path', 'src/one.ts', 'blob', s2)));
  h1 := r ->> 'commit';
  out := out || jsonb_build_object(
    'ok_commit', h1 ~ '^[0-9a-f]{64}$' and (r -> 'stats' ->> 'added')::int = 2 and (r ->> 'generation')::int = 2
                 and (select head from public.branches where workspace_id = ws and name = 'main') = h1
                 and (select commit_count from public.workspaces where id = ws) = 2
                 and (select file_count from public.workspaces where id = ws) = 2,
    'ok_head_moved', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, %L, %L, %L)', ws, a, 'main', h0, 'Stale',
                                          jsonb_build_array(jsonb_build_object('path', 'x.md', 'blob', s1))), 'PT409'),
    'ok_short_head', public.ws_commit(ws, a, 'main', left(h1, 10), 'Copy the readme',
                       jsonb_build_array(jsonb_build_object('path', 'docs/README.md', 'blob', s1))) ->> 'commit' is not null,
    'ok_blob_not_here', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Foreign',
                                             jsonb_build_array(jsonb_build_object('path', 'y.md', 'blob', repeat('a', 64)))), 'PT400'),
    'ok_delete_missing', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Delete',
                                              jsonb_build_array(jsonb_build_object('path', 'nope.md', 'delete', true))), 'PT400'),
    'ok_duplicate_path', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Twice',
                                              jsonb_build_array(jsonb_build_object('path', 'z.md', 'blob', s1), jsonb_build_object('path', 'z.md', 'blob', s2))), 'PT400'),
    'ok_bad_path', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Escape',
                                        jsonb_build_array(jsonb_build_object('path', '../etc/passwd', 'blob', s1))), 'PT400'),
    'ok_noop', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Same',
                                    jsonb_build_array(jsonb_build_object('path', 'README.md', 'blob', s1))), 'PT409'),
    'ok_file_folder', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Clash',
                                           jsonb_build_array(jsonb_build_object('path', 'src', 'blob', s1))), 'PT400'),
    'ok_no_message', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', '  ',
                                          jsonb_build_array(jsonb_build_object('path', 'q.md', 'blob', s1))), 'PT400'),
    'ok_reader_cannot_push', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, b, 'main', 'Mine now',
                                                  jsonb_build_array(jsonb_build_object('path', 'b.md', 'blob', s1))), 'PT403'));

  update public.workspaces set file_limit = 3 where id = ws;
  out := out || jsonb_build_object(
    'ok_file_quota', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Too many',
                                          jsonb_build_array(jsonb_build_object('path', 'four.md', 'blob', s1))), 'PT413'));
  update public.workspaces set file_limit = 5000 where id = ws;

  -- ------------------------------------------------------------ reading
  h1 := (select head from public.branches where workspace_id = ws and name = 'main');
  out := out || jsonb_build_object(
    'ok_tree_root', (select jsonb_agg(e ->> 'name') from jsonb_array_elements(public.ws_tree(ws, b, null, null) -> 'entries') e)
                    = '["docs", "src", "README.md"]'::jsonb,
    'ok_tree_dir', public.ws_tree(ws, b, 'main', 'src/') -> 'entries' -> 0 ->> 'path' = 'src/one.ts',
    'ok_tree_recursive', jsonb_array_length(public.ws_tree(ws, b, 'main', null, true) -> 'entries') = 3,
    'ok_tree_missing', pg_temp.fails(format('select public.ws_tree(%L, %L, null, %L)', ws, b, 'nope'), 'PT404'),
    'ok_file', public.ws_file(ws, b, null, 'src/one.ts') ->> 'content' = E'export const one = 1;\n'
               and not (public.ws_file(ws, b, null, 'src/one.ts') ->> 'binary')::boolean,
    'ok_file_missing', pg_temp.fails(format('select public.ws_file(%L, %L, null, %L)', ws, b, 'src/two.ts'), 'PT404'),
    'ok_log', jsonb_array_length(public.ws_log(ws, b, 'main') -> 'commits') = 3
              and public.ws_log(ws, b, 'main') -> 'commits' -> 0 ->> 'id' = h1,
    'ok_log_path', jsonb_array_length(public.ws_log(ws, b, 'main', 'src/one.ts') -> 'commits') = 1,
    'ok_ref_prefix', public.ws_resolve_ref(ws, left(h1, 12)) = h1,
    'ok_ref_unknown', pg_temp.fails(format('select public.ws_resolve_ref(%L, %L)', ws, 'no-such-branch'), 'PT404'),
    'ok_diff', public.ws_diff(ws, b, h0, 'main') -> 'files' -> 0 ->> 'status' = 'added'
               and jsonb_array_length(public.ws_diff(ws, b, h0, 'main') -> 'files') = 3,
    'ok_detail', jsonb_array_length(public.ws_detail(ws, b) -> 'branches') = 1 and public.ws_detail(ws, b) ->> 'your_role' = 'reader');

  out := out || jsonb_build_object(
    'ok_read_blobs', (select count(*) from jsonb_array_elements(public.ws_read_blobs(ws, b, array[s1, s2, repeat('e', 64)]))) = 2
                     and public.ws_read_blobs(ws, b, array[s1]) -> 0 ->> 'content' = E'# Lab\n',
    'ok_read_blobs_limit', pg_temp.fails(format('select public.ws_read_blobs(%L, %L, %L)', ws, b,
                                                (select array_agg(repeat('a', 63) || i % 10) from generate_series(1, 201) i)), 'PT400'),
    'ok_lookups_volatile', (select bool_and(provolatile = 'v') from pg_proc
                             where pronamespace = 'public'::regnamespace and proname in ('ws_id', 'cr_id', 'ws_resolve_ref', 'ws_assert_read')));

  -- ------------------------------------------------------------ open contribution and change requests
  s3 := pg_temp.blob(ws, b, E'export const two = 2;\n');
  r := public.ws_commit(ws, b, 'p10-bob/two', null, 'Add two', jsonb_build_array(jsonb_build_object('path', 'src/two.ts', 'blob', s3)));
  out := out || jsonb_build_object(
    'ok_namespace_push', (r ->> 'created_branch')::boolean and public.ws_can_push(ws, b, 'p10-bob/two')
                         and not public.ws_can_push(ws, b, 'p10-alice/x') and not public.ws_can_push(ws, b, 'feature'),
    'ok_namespace_only', pg_temp.fails(format('select public.ws_create_branch(%L, %L, %L, null)', ws, b, 'feature'), 'PT403'));

  j := public.open_change_request(ws, b, 'p10-bob/two', null, 'Add the number two', 'Two is the loneliest number.');
  cr := (j ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_cr_opened', (j ->> 'number')::int = 1 and j ->> 'status' = 'open' and (j ->> 'mergeable')::boolean
                    and j ->> 'target' = 'main' and j ->> 'base_commit' = h1,
    'ok_cr_requested', exists (select 1 from public.cr_review_requests where change_request_id = cr and agent_id = a)
                       and exists (select 1 from public.notifications where agent_id = a and kind = 'cr_review_requested'),
    'ok_inbox', public.agent_code_inbox(a) -> 'review_requests' -> 0 ->> 'number' = '1'
                and public.agent_code_inbox(b) -> 'your_change_requests' -> 0 ->> 'number' = '1',
    'ok_cr_duplicate', pg_temp.fails(format('select public.open_change_request(%L, %L, %L, null, %L)', ws, b, 'p10-bob/two', 'Again'), 'PT409'),
    'ok_cr_nothing', pg_temp.fails(format('select public.open_change_request(%L, %L, %L, %L, %L)', ws, a, 'main', 'p10-bob/two', 'Backwards'), 'PT409'),
    'ok_cr_self_approve', pg_temp.fails(format('select public.review_change_request(%L, %L, %L)', cr, b, 'approve'), 'PT403'),
    'ok_cr_terse_block', pg_temp.fails(format('select public.review_change_request(%L, %L, %L, %L)', cr, a, 'request_changes', 'no'), 'PT400'),
    'ok_reader_cannot_merge', pg_temp.fails(format('select public.merge_change_request(%L, %L)', cr, b), 'PT403'),
    'ok_cr_comment_bad_path', pg_temp.fails(format('select public.cr_comment(%L, %L, %L, %L, 3)', cr, a, 'Hm', 'src/none.ts'), 'PT400'));

  -- A line comment, a reply, and resolving it.
  j := public.cr_comment(cr, a, 'Should this be a const enum?', 'src/two.ts', 1);
  out := out || jsonb_build_object(
    'ok_cr_comment', j ->> 'path' = 'src/two.ts' and (j ->> 'line')::int = 1 and j ->> 'author' = 'p10-alice'
                     and (public.cr_approval_state(cr) ->> 'unresolved_comments')::int = 1,
    'ok_cr_reply', public.cr_comment(cr, b, 'Kept it simple on purpose.', null, null, 'new', (j ->> 'id')::uuid) ->> 'path' = 'src/two.ts',
    'ok_cr_resolve', (public.cr_resolve_comment((j ->> 'id')::uuid, b) ->> 'resolved')::boolean,
    'ok_cr_resolve_outsider', pg_temp.fails(format('select public.cr_resolve_comment(%L, %L, false)', j ->> 'id', d), 'PT403'));

  out := out || jsonb_build_object('ok_cr_resolved_state', (public.cr_approval_state(cr) ->> 'unresolved_comments')::int = 0);

  -- Protect main: now a merge needs an independent approval of the current head.
  perform public.ws_protect_branch(ws, a, 'main', true);
  out := out || jsonb_build_object(
    'ok_protect_maintainers', pg_temp.fails(format('select public.ws_protect_branch(%L, %L, %L, false)', ws, b, 'main'), 'PT403'),
    'ok_protected_push', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Direct',
                                              jsonb_build_array(jsonb_build_object('path', 'direct.md', 'blob', s1))), 'PT403'),
    'ok_needs_approval', pg_temp.fails(format('select public.merge_change_request(%L, %L)', cr, a), 'PT409'));

  -- c is related to b (same owner): its approval does not count.
  perform public.review_change_request(cr, c, 'approve', 'Looks right to me.');
  out := out || jsonb_build_object(
    'ok_related_approval', (public.cr_approval_state(cr) ->> 'approvals')::int = 0
                           and pg_temp.fails(format('select public.merge_change_request(%L, %L)', cr, a), 'PT409'));
  -- d blocks, then approves; a approves; a merges.
  perform public.review_change_request(cr, d, 'request_changes', 'Please add a test for two.',
            jsonb_build_array(jsonb_build_object('path', 'src/two.ts', 'line', 1, 'body', 'Untested.')));
  r := public.review_change_request(cr, a, 'approve', 'Ship it.');
  out := out || jsonb_build_object(
    'ok_review_comments', (select count(*) from public.cr_comments where change_request_id = cr and review_id is not null) = 1,
    'ok_blocked', (r -> 'review_state' ->> 'approvals')::int = 1
                  and r -> 'review_state' -> 'changes_requested_by' = '["p10-dave"]'::jsonb
                  and pg_temp.fails(format('select public.merge_change_request(%L, %L)', cr, a), 'PT409'),
    'ok_inbox_cleared', jsonb_array_length(public.agent_code_inbox(a) -> 'review_requests') = 0);
  perform public.review_change_request(cr, d, 'approve', 'Fine without it.');
  r := public.merge_change_request(cr, a);
  out := out || jsonb_build_object(
    'ok_merged_ff', r ->> 'status' = 'merged' and (r ->> 'fast_forward')::boolean and r ->> 'merged_by' = 'p10-alice'
                    and (select head from public.branches where workspace_id = ws and name = 'main') = r ->> 'merged_commit'
                    and (select open_change_requests from public.workspaces where id = ws) = 0,
    'ok_merge_notified', exists (select 1 from public.notifications where agent_id = b and kind = 'cr_merged'),
    'ok_merged_closed', pg_temp.fails(format('select public.review_change_request(%L, %L, %L)', cr, d, 'comment'), 'PT409'));

  -- ------------------------------------------------------------ three-way merges and conflicts
  ws2 := (public.create_workspace(a, 'Merge Yard') ->> 'id')::uuid;
  sx := pg_temp.blob(ws2, a, 'f1 v1');
  sy := pg_temp.blob(ws2, a, 'f2 v1');
  perform public.ws_commit(ws2, a, 'main', null, 'Base', jsonb_build_array(
            jsonb_build_object('path', 'f1', 'blob', sx), jsonb_build_object('path', 'f2', 'blob', sy)));
  perform public.ws_set_member(ws2, a, '@p10-bob', 'writer');
  out := out || jsonb_build_object(
    'ok_member_set', public.ws_role(ws2, b) = 'writer'
                     and exists (select 1 from public.notifications where agent_id = b and kind = 'workspace_member'),
    'ok_member_maintainers', pg_temp.fails(format('select public.ws_set_member(%L, %L, %L, %L)', ws2, b, 'p10-dave', 'writer'), 'PT403'),
    'ok_member_owner_fixed', pg_temp.fails(format('select public.ws_set_member(%L, %L, %L, %L)', ws2, a, 'p10-alice', 'reader'), 'PT403'));
  perform public.ws_create_branch(ws2, b, 'x', 'main');
  perform public.ws_commit(ws2, b, 'x', null, 'Change f1', jsonb_build_array(jsonb_build_object('path', 'f1', 'blob', pg_temp.blob(ws2, b, 'f1 from x'))));
  perform public.ws_commit(ws2, a, 'main', null, 'Change f2', jsonb_build_array(jsonb_build_object('path', 'f2', 'blob', pg_temp.blob(ws2, a, 'f2 v2'))));
  j := public.open_change_request(ws2, b, 'x', 'main', 'Change f1 on x');
  cr2 := (j ->> 'id')::uuid;
  out := out || jsonb_build_object('ok_three_way_mergeable', (j ->> 'mergeable')::boolean and j ->> 'base_commit' <> j ->> 'target_head');
  r := public.merge_change_request(cr2, b);
  hx := r ->> 'merged_commit';
  out := out || jsonb_build_object(
    'ok_merge_commit', not (r ->> 'fast_forward')::boolean
                       and cardinality((select parents from public.commits where id = hx)) = 2
                       and public.ws_manifest(hx) ->> 'f1' = encode(extensions.digest('f1 from x', 'sha256'), 'hex')
                       and public.ws_manifest(hx) ->> 'f2' = encode(extensions.digest('f2 v2', 'sha256'), 'hex'));

  perform public.ws_create_branch(ws2, b, 'y', 'main');
  sz := pg_temp.blob(ws2, b, 'f1 from y');
  perform public.ws_commit(ws2, b, 'y', null, 'f1 says y', jsonb_build_array(jsonb_build_object('path', 'f1', 'blob', sz)));
  perform public.ws_commit(ws2, a, 'main', null, 'f1 says z', jsonb_build_array(jsonb_build_object('path', 'f1', 'blob', pg_temp.blob(ws2, a, 'f1 from z'))));
  j := public.open_change_request(ws2, b, 'y', 'main', 'Change f1 on y');
  cr3 := (j ->> 'id')::uuid;
  -- Both sides changed f1's one line: the code worker's line merge (stood in for here) finds the conflict.
  out := out || jsonb_build_object('ok_conflict_pending', j -> 'mergeable' = 'null'::jsonb);
  m := (select payload from public.merge_jobs where kind = 'content' and workspace_id = ws2 limit 1);
  perform public.code_store_merge(m ->> 'base', m ->> 'ours', m ->> 'theirs', true, null, null, 1);
  perform public.code_after(array[ws2]);
  j := public.cr_json(cr3);
  out := out || jsonb_build_object(
    'ok_conflict_seen', not (j ->> 'mergeable')::boolean and j -> 'conflicts' = '["f1"]'::jsonb,
    'ok_conflict_refused', pg_temp.fails(format('select public.merge_change_request(%L, %L)', cr3, b), 'PT409'),
    'ok_merge_needs_resolution', pg_temp.fails(format('select public.ws_merge_branches(%L, %L, %L, %L)', ws2, b, 'y', 'main'), 'PT409'));
  sr := pg_temp.blob(ws2, b, 'f1 from y and z');
  r := public.ws_merge_branches(ws2, b, 'y', 'main', null, jsonb_build_object('f1', sr));
  j := public.cr_json(cr3);
  out := out || jsonb_build_object(
    'ok_resolved', (r ->> 'resolved')::int = 1 and (j ->> 'mergeable')::boolean and j -> 'conflicts' = '[]'::jsonb,
    'ok_resolved_merge', public.merge_change_request(cr3, b) ->> 'status' = 'merged');
  out := out || jsonb_build_object(
    'ok_resolved_main', public.ws_manifest(public.ws_resolve_ref(ws2, 'main')) ->> 'f1' = sr,
    'ok_up_to_date', pg_temp.fails(format('select public.ws_merge_branches(%L, %L, %L, %L)', ws2, b, 'y', 'main'), 'PT409'));

  -- Branch housekeeping.
  perform public.ws_create_branch(ws2, b, 'z', 'main');
  perform public.ws_commit(ws2, b, 'z', null, 'z work', jsonb_build_array(jsonb_build_object('path', 'z.txt', 'blob', pg_temp.blob(ws2, b, 'z'))));
  perform public.open_change_request(ws2, b, 'z', 'main', 'Add z');
  out := out || jsonb_build_object(
    'ok_delete_in_use', pg_temp.fails(format('select public.ws_delete_branch(%L, %L, %L)', ws2, b, 'z'), 'PT409'),
    'ok_delete_default', pg_temp.fails(format('select public.ws_delete_branch(%L, %L, %L)', ws2, a, 'main'), 'PT403'),
    'ok_delete_branch', public.ws_delete_branch(ws2, b, 'x') ->> 'deleted' = 'x');
  out := out || jsonb_build_object(
    'ok_branch_count', (select branch_count from public.workspaces where id = ws2) = 3,
    'ok_close_reopen', public.set_change_request_state(public.cr_id(ws2, 3), b, 'close') ->> 'status' = 'closed'
                       and public.set_change_request_state(public.cr_id(ws2, 3), b, 'reopen') ->> 'status' = 'open',
    'ok_check', public.cr_report_check(public.cr_id(ws2, 3), b, 'unit', 'passed', '12 tests') ->> 'status' = 'passed'
                and public.cr_report_check(public.cr_id(ws2, 3), b, 'unit', 'failed', '1 failing') ->> 'status' = 'failed',
    'ok_check_outsider', pg_temp.fails(format('select public.cr_report_check(%L, %L, %L, %L)', public.cr_id(ws2, 3), d, 'ci', 'passed'), 'PT403'));

  out := out || jsonb_build_object('ok_check_upsert', (select count(*) from public.cr_checks where change_request_id = public.cr_id(ws2, 3)) = 1);

  -- A workspace with commits, comments, reviews and checks deletes cleanly (phase10_cascades).
  delete from public.workspaces where id = ws2;
  out := out || jsonb_build_object('ok_workspace_delete', not exists (select 1 from public.commits where workspace_id = ws2)
                                                          and not exists (select 1 from public.change_requests where workspace_id = ws2));

  -- ------------------------------------------------------------ private workspaces and row level security
  priv := (public.create_workspace(a, 'Quiet Room', null, null, 'private') ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_private_hidden', pg_temp.fails(format('select public.ws_detail(%L, %L)', priv, b), 'PT404')
                         and pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', priv, x, 'p10-xena/in', 'Hi',
                                                  jsonb_build_array(jsonb_build_object('path', 'a', 'blob', s1))), 'PT404')
                         and public.ws_role(priv, b) is null,
    'ok_list_public', not exists (select 1 from jsonb_array_elements(public.ws_list(null)) e where e ->> 'slug' = 'quiet-room')
                      and exists (select 1 from jsonb_array_elements(public.ws_list(a, null, true)) e where e ->> 'slug' = 'quiet-room'));

  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object(
    'ok_rls_anon', (select count(*) from public.workspaces where id in (ws, priv)) = 1
                   and (select count(*) from public.commits where workspace_id = priv) = 0
                   and (select count(*) from public.commits where workspace_id = ws) > 0
                   and (select count(*) from public.blobs where sha256 = s3) = 1);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_rls_owner', (select count(*) from public.branches where workspace_id = priv) = 1);
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_rls_other', (select count(*) from public.branches where workspace_id = priv) = 0
                                                   and (select count(*) from public.blob_diffs) = 0);
  reset role;

  -- ------------------------------------------------------------ missions: task branches, frozen review, verified merges
  m := public.create_mission(a, null, 'Build the phase ten widget', 'Ship a small widget library with docs, built by several agents.',
                             '', '{}', 'public', 1, false, false, null, null,
                             '{"tasks": [{"key": "api", "title": "Write the widget API", "kind": "code", "capabilities": ["code"], "acceptance_criteria": "Exports a widget() function."},
                                         {"key": "docs", "title": "Document the widget", "kind": "code", "capabilities": ["code"], "acceptance_criteria": "A README section."}]}'::jsonb);
  mid := (m ->> 'id')::uuid;
  mws := (select id from public.workspaces where mission_id = mid);
  t_api := (select id from public.tasks where mission_id = mid and key = 'api');
  t_docs := (select id from public.tasks where mission_id = mid and key = 'docs');
  out := out || jsonb_build_object(
    'ok_mission_workspace', mws is not null and public.ws_role(mws, a) = 'owner'
                            and (select protected from public.branches where workspace_id = mws and name = 'main'));

  perform public.claim_task(b, t_api, 30);
  out := out || jsonb_build_object(
    'ok_task_branch', exists (select 1 from public.branches where workspace_id = mws and name = 'task/api' and task_id = t_api and created_by = b)
                      and public.ws_can_push(mws, b, 'task/api') and public.ws_role(mws, b) = 'writer');

  -- Submitting without commits links nothing.
  perform public.claim_task(b, t_docs, 30);
  sub2 := (public.submit_work(b, t_docs, 'Nothing to show yet, but here is the plan.') ->> 'submission_id')::uuid;
  out := out || jsonb_build_object('ok_no_code_no_cr', (select change_request_id from public.submissions where id = sub2) is null);

  perform public.ws_commit(mws, b, 'task/api', null, 'widget()', jsonb_build_array(
            jsonb_build_object('path', 'src/widget.ts', 'blob', pg_temp.blob(mws, b, 'export function widget() { return 1; }'))));
  sub := (public.submit_work(b, t_api, 'widget() is exported from src/widget.ts.') ->> 'submission_id')::uuid;
  j := (select to_jsonb(s) from public.submissions s where s.id = sub);
  out := out || jsonb_build_object(
    'ok_submission_cr', j ->> 'change_request_id' is not null
                        and j ->> 'commit_id' = (select head from public.branches where workspace_id = mws and name = 'task/api')
                        and (select status from public.change_requests where id = (j ->> 'change_request_id')::uuid) = 'open'
                        and (select submission_id from public.change_requests where id = (j ->> 'change_request_id')::uuid) = sub,
    'ok_frozen', (select frozen_reason from public.branches where workspace_id = mws and name = 'task/api') is not null
                 and pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', mws, b, 'task/api', 'Sneak',
                                          jsonb_build_array(jsonb_build_object('path', 'x', 'blob', s1))), 'PT409'));

  -- Changes requested: the branch thaws, b pushes again and resubmits, the same change request follows.
  perform public.review_submission(sub, d, null, 'request_changes', 2, 'Add a docstring to widget().');
  out := out || jsonb_build_object(
    'ok_thawed', (select frozen_reason from public.branches where workspace_id = mws and name = 'task/api') is null);
  perform public.ws_commit(mws, b, 'task/api', null, 'Docstring', jsonb_build_array(
            jsonb_build_object('path', 'src/widget.ts', 'blob', pg_temp.blob(mws, b, E'/** A widget. */\nexport function widget() { return 1; }'))));
  sub2 := (public.submit_work(b, t_api, 'Added the docstring.') ->> 'submission_id')::uuid;
  out := out || jsonb_build_object(
    'ok_same_cr', (select change_request_id from public.submissions where id = sub2) = (j ->> 'change_request_id')::uuid
                  and (select count(*) from public.change_requests where workspace_id = mws) = 1);

  -- Verified: merges into protected main by itself.
  perform public.review_submission(sub2, d, null, 'approve', 5, 'Meets the criteria, docstring included.');
  cr := (j ->> 'change_request_id')::uuid;
  out := out || jsonb_build_object(
    'ok_task_done', (select status from public.tasks where id = t_api) = 'done',
    'ok_auto_merged', (select status from public.change_requests where id = cr) = 'merged'
                      and (select verified_at from public.change_requests where id = cr) is not null
                      and public.ws_manifest(public.ws_resolve_ref(mws, 'main')) ? 'src/widget.ts',
    'ok_thawed_after', (select frozen_reason from public.branches where workspace_id = mws and name = 'task/api') is null,
    'ok_system_merge_label', public.cr_json(cr) ->> 'merged_by' is null
                             and exists (select 1 from public.activity where mission_id = mid and kind = 'cr_merged'
                                                                     and summary like 'Verified work merged into %'));

  raise exception 'PHASE10_RESULT %', out::text;
exception when others then
  if sqlerrm like 'PHASE10_RESULT%' then
    raise;
  end if;
  raise exception 'PHASE10_FAILED (%): % | so far: %', sqlstate, sqlerrm, out::text;
end $test$;
