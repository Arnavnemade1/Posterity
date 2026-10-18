-- Phase 12.3 database test: patterns, CODEOWNERS and code owner review, branch rules (approvals,
-- required checks, merge methods, size limits), merge blockers, path claims, the merge queue (waiting,
-- landing, speculative test commits on queue branches, failed checks and rebuilds, conflicts,
-- dequeueing, verified work), stacked change requests, what agents and the web read, and grants.
--
-- Runs entirely inside one transaction and ends by raising PHASE12_COORD_RESULT, which rolls
-- everything back. Every "ok_*" key in the JSON should be true. Run it with the Supabase SQL editor or
-- MCP `execute_sql`, after 20261017133305_phase12_coordination.sql through 20261017140733_phase12_queue_locks.sql
-- are applied.
do $test$
declare
  u1 uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  r jsonb; j jsonb; e jsonb;
  a uuid; b uuid; c uuid; d uuid; x uuid;
  ws uuid; ws2 uuid;
  cr uuid; cr2 uuid; cr3 uuid; cr4 uuid; cr5 uuid; cr6 uuid;
  cra uuid; crb uuid; crc uuid; crd uuid;
  h text; sp2 text; sp3 text;
  n int;
  v_err text;
  v_detail text;
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

  create function pg_temp.sha(p_text text) returns text
  language sql as $fn$ select encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex') $fn$;

  create function pg_temp.git(p_text text) returns text
  language sql as $fn$
    select encode(extensions.digest(convert_to('blob ' || octet_length(convert_to(p_text, 'UTF8')), 'UTF8') || '\x00'::bytea
                                    || convert_to(p_text, 'UTF8'), 'sha1'), 'hex')
  $fn$;

  create function pg_temp.blob(p_ws uuid, p_agent uuid, p_text text) returns text
  language plpgsql as $fn$
  begin
    perform public.ws_add_blob(p_ws, p_agent, pg_temp.sha(p_text), pg_temp.git(p_text),
                               octet_length(convert_to(p_text, 'UTF8')), false, p_text, null);
    return pg_temp.sha(p_text);
  end
  $fn$;

  create function pg_temp.put(p_ws uuid, p_agent uuid, p_branch text, p_path text, p_text text) returns text
  language sql as $fn$
    select public.ws_commit(p_ws, p_agent, p_branch, null, 'Write ' || p_path,
                            jsonb_build_array(jsonb_build_object('path', p_path, 'blob', pg_temp.blob(p_ws, p_agent, p_text)))) ->> 'commit'
  $fn$;

  create function pg_temp.num(p_cr uuid) returns int
  language sql as $fn$ select number from public.change_requests where id = p_cr $fn$;

  create function pg_temp.entry(p_cr uuid) returns public.merge_queue
  language sql as $fn$ select * from public.merge_queue where change_request_id = p_cr order by id desc limit 1 $fn$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@phase12c.invalid', '{"username":"phase12c_u1"}', now(), now());
  a := (public.register_agent('p12c-ada', 'Ada', '', '{code}', '{}', '{}', null, u1, 'api') -> 'agent' ->> 'id')::uuid;
  b := (public.register_agent('p12c-bo', 'Bo', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;
  c := (public.register_agent('p12c-cy', 'Cy', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;
  d := (public.register_agent('p12c-di', 'Di', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;
  x := (public.register_agent('p12c-ed', 'Ed', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;

  -- ------------------------------------------------------------ patterns
  out := out || jsonb_build_object(
    'ok_glob_any_depth', 'c.ts' ~ public.ws_glob_regex('*.ts') and 'a/b/c.ts' ~ public.ws_glob_regex('*.ts')
                         and not ('c.tsx' ~ public.ws_glob_regex('*.ts')),
    'ok_glob_anchored_dir', 'docs/a.md' ~ public.ws_glob_regex('/docs/') and 'docs/x/y.md' ~ public.ws_glob_regex('/docs/')
                            and not ('src/docs/a.md' ~ public.ws_glob_regex('/docs/')) and not ('docs' ~ public.ws_glob_regex('/docs/')),
    'ok_glob_one_level', 'docs/a.md' ~ public.ws_glob_regex('docs/*') and not ('docs/x/y.md' ~ public.ws_glob_regex('docs/*')),
    'ok_glob_dir_anywhere', 'apps/x' ~ public.ws_glob_regex('apps/') and 'src/apps/y' ~ public.ws_glob_regex('apps/'),
    'ok_glob_double_star', 'src/test/a.ts' ~ public.ws_glob_regex('src/**/test/*.ts')
                           and 'src/x/y/test/a.ts' ~ public.ws_glob_regex('src/**/test/*.ts')
                           and not ('lib/test/a.ts' ~ public.ws_glob_regex('src/**/test/*.ts')),
    'ok_glob_name', 'build' ~ public.ws_glob_regex('build') and 'x/build/a' ~ public.ws_glob_regex('build')
                    and not ('builder' ~ public.ws_glob_regex('build')),
    'ok_glob_literal', 'a.b' ~ public.ws_glob_regex('a.b') and not ('axb' ~ public.ws_glob_regex('a.b'))
                       and 'a+(b)' ~ public.ws_glob_regex('a+(b)'),
    'ok_glob_bad', public.ws_glob_regex('') is null and public.ws_glob_regex('a\b') is null and public.ws_glob_regex('/') is null,
    'ok_glob_prefix', public.ws_glob_prefix('src/api/**') = 'src/api/' and public.ws_glob_prefix('*.ts') = ''
                      and public.ws_glob_prefix('/docs/') = 'docs/' and public.ws_glob_prefix('README.md') = '');

  -- ------------------------------------------------------------ code owners
  ws := (public.create_workspace(a, 'Phase Twelve Coord') ->> 'id')::uuid;
  perform public.ws_set_member(ws, a, '@p12c-bo', 'writer');
  perform public.ws_set_member(ws, a, '@p12c-cy', 'writer');
  perform public.ws_set_member(ws, a, '@p12c-di', 'writer');
  perform public.ws_commit(ws, a, 'main', null, 'Start', jsonb_build_array(
    jsonb_build_object('path', '.github/CODEOWNERS',
                       'blob', pg_temp.blob(ws, a, E'# Owners\n*  @p12c-ada\n/src/api/  @p12c-cy  # the API\n*.md  @p12c-bo @org/nobody\nbad\\x @p12c-di\n')),
    jsonb_build_object('path', 'src/api/x.ts', 'blob', pg_temp.blob(ws, a, E'export const x = 1;\n')),
    jsonb_build_object('path', 'lib/y.ts', 'blob', pg_temp.blob(ws, a, 'y')),
    jsonb_build_object('path', 'README.md', 'blob', pg_temp.blob(ws, a, '# Coord'))));
  j := public.ws_path_owners(ws, x, 'main', array['src/api/x.ts', 'README.md', 'lib/y.ts', 'src/api/docs/notes.md']);
  out := out || jsonb_build_object(
    'ok_owners_file', (j ->> 'codeowners')::boolean and jsonb_array_length(j -> 'errors') = 1 and (j -> 'errors' -> 0 ->> 'line')::int = 5,
    'ok_owners_groups', jsonb_array_length(j -> 'groups') = 3
      and exists (select 1 from jsonb_array_elements(j -> 'groups') g where g -> 'owners' = '["p12c-cy"]'::jsonb and (g ->> 'paths')::int = 1)
      and exists (select 1 from jsonb_array_elements(j -> 'groups') g
                   where g -> 'owners' = '["org/nobody", "p12c-bo"]'::jsonb and (g ->> 'paths')::int = 2)
      and exists (select 1 from jsonb_array_elements(j -> 'groups') g where g -> 'owners' = '["p12c-ada"]'::jsonb),
    'ok_owner_agents', public.ws_owner_agents('["p12c-bo", "org/nobody", "nobody-here"]') = array[b],
    'ok_codeowners_cached', exists (select 1 from public.codeowners_rules
                                     where blob_sha = public.ws_codeowners_blob(public.ws_root(public.ws_resolve_ref(ws, 'main')))));

  -- ------------------------------------------------------------ branch rules
  out := out || jsonb_build_object(
    'ok_rules_maintainer_only', pg_temp.fails(format('select public.ws_set_branch_rules(%L, %L, %L, %L)', ws, b, 'main', '{"merge_queue": true}'), 'PT403'),
    'ok_rules_unknown', pg_temp.fails(format('select public.ws_set_branch_rules(%L, %L, %L, %L)', ws, a, 'main', '{"speed": 1}'), 'PT400'),
    'ok_rules_bad_value', pg_temp.fails(format('select public.ws_set_branch_rules(%L, %L, %L, %L)', ws, a, 'main', '{"required_approvals": 9}'), 'PT400')
                          and pg_temp.fails(format('select public.ws_set_branch_rules(%L, %L, %L, %L)', ws, a, 'main', '{"merge_methods": ["octopus"]}'), 'PT400')
                          and pg_temp.fails(format('select public.ws_set_branch_rules(%L, %L, %L, %L)', ws, a, 'main', '{"queue_depth": "deep"}'), 'PT400')
                          and pg_temp.fails(format('select public.ws_set_branch_rules(%L, %L, %L, %L)', ws, a, 'main', '{"merge_methods": []}'), 'PT400'),
    'ok_rules_missing_branch', pg_temp.fails(format('select public.ws_set_branch_rules(%L, %L, %L, %L)', ws, a, 'nope', '{}'), 'PT404'),
    'ok_queue_branch_push', not public.ws_can_push(ws, a, 'queue/main/1') and public.ws_can_push(ws, a, 'feature'),
    'ok_queue_branch_delete', pg_temp.fails(format('select public.ws_delete_branch(%L, %L, %L)', ws, a, 'queue/main/1'), 'PT403'));
  r := public.ws_set_branch_rules(ws, a, 'main', '{"protected": true, "required_approvals": 1, "required_checks": ["ci", "ci"],
                                                   "require_owner_review": true, "max_change_files": 1}');
  out := out || jsonb_build_object(
    'ok_rules_set', (r ->> 'protected')::boolean and r -> 'rules' -> 'required_checks' = '["ci"]'::jsonb
                    and (r -> 'rules' ->> 'require_owner_review')::boolean and (r -> 'rules' ->> 'max_change_files')::int = 1
                    and r -> 'rules' -> 'merge_methods' = '["merge", "squash", "rebase"]'::jsonb and not (r -> 'rules' ->> 'merge_queue')::boolean);

  -- ------------------------------------------------------------ what a change request needs
  perform public.ws_create_branch(ws, b, 'p12c-bo/api', 'main');
  perform public.ws_commit(ws, b, 'p12c-bo/api', null, 'Touch the API and notes', jsonb_build_array(
    jsonb_build_object('path', 'src/api/x.ts', 'blob', pg_temp.blob(ws, b, E'export const x = 2;\n')),
    jsonb_build_object('path', 'notes/a.txt', 'blob', pg_temp.blob(ws, b, 'a'))));
  cr := (public.open_change_request(ws, b, 'p12c-bo/api', 'main', 'API tweak', '') ->> 'id')::uuid;
  j := public.cr_json(cr);
  e := to_jsonb(public.cr_merge_blockers(cr, a, false, 'merge'));
  out := out || jsonb_build_object(
    'ok_cr_owner_groups', jsonb_array_length((select owner_groups from public.change_requests where id = cr)) = 2,
    'ok_owner_review_requested', exists (select 1 from public.cr_review_requests where change_request_id = cr and agent_id = c),
    'ok_blockers_all', jsonb_array_length(e) = 4 and e ->> 0 like '%needs 1 independent approval%'
                       and e ->> 1 like '%code owner%@p12c-cy (1 file)%' and e ->> 2 like '%checks%ci (not reported yet)%'
                       and e ->> 3 like '%touches 2 files%at most 1%',
    'ok_cr_json_blocked', jsonb_array_length(j -> 'blocked_by') = 4 and (j -> 'size' ->> 'files')::int = 2
                          and not (j -> 'size' ->> 'large')::boolean and (j -> 'review_state' -> 'owners' ->> 'required')::boolean
                          and j -> 'review_state' ? 'approvals' and j -> 'review_state' ? 'unresolved_comments');
  begin
    perform public.merge_change_request(cr, a);
    v_err := null;
  exception when others then
    get stacked diagnostics v_err = message_text, v_detail = pg_exception_detail;
  end;
  out := out || jsonb_build_object('ok_merge_blocked', v_err like '%needs 1 independent approval%' and jsonb_array_length(v_detail::jsonb -> 'blocked') = 4);

  perform public.review_change_request(cr, d, 'approve', 'Looks right');
  e := to_jsonb(public.cr_merge_blockers(cr, a, false, 'merge'));
  out := out || jsonb_build_object('ok_non_owner_approval', jsonb_array_length(e) = 3 and e ->> 0 like '%code owner%');
  perform public.review_change_request(cr, c, 'approve', 'The API owner approves');
  e := to_jsonb(public.cr_merge_blockers(cr, a, false, 'merge'));
  out := out || jsonb_build_object('ok_one_owner_of_two', jsonb_array_length(e) = 3 and e ->> 0 like '%@p12c-ada (1 file)%'
                                                          and e ->> 0 not like '%p12c-cy%');
  perform public.review_change_request(cr, a, 'approve', 'The root owner approves');
  perform public.cr_report_check(cr, b, 'ci', 'passed');
  e := to_jsonb(public.cr_merge_blockers(cr, a, false, 'merge'));
  out := out || jsonb_build_object(
    'ok_owners_checks_satisfied', jsonb_array_length(e) = 1 and e ->> 0 like '%touches 2 files%',
    'ok_owner_state', (public.cr_approval_state(cr) -> 'owners' ->> 'satisfied')::boolean
                      and (select count(*) from jsonb_array_elements(public.cr_approval_state(cr) -> 'owners' -> 'groups') g
                            where g ->> 'approved_by' is not null) = 2);
  perform public.ws_set_branch_rules(ws, a, 'main', '{"max_change_files": 5, "merge_methods": ["squash"]}');
  e := to_jsonb(public.cr_merge_blockers(cr, a, false, 'merge'));
  out := out || jsonb_build_object(
    'ok_method_blocked', jsonb_array_length(e) = 1 and e ->> 0 like '%takes squash merges%',
    'ok_method_refused', pg_temp.fails(format('select public.merge_change_request(%L, %L, null, %L)', cr, a, 'merge'), 'PT409'));
  r := public.merge_change_request(cr, a);
  out := out || jsonb_build_object(
    'ok_default_method', r ->> 'status' = 'merged' and (select merge_method from public.change_requests where id = cr) = 'squash'
                         and cardinality((select parents from public.commits where id = public.ws_resolve_ref(ws, 'main'))) = 1);

  r := public.ws_set_branch_rules(ws, a, 'main', '{"merge_methods": ["squash", "merge", "squash"]}');
  out := out || jsonb_build_object('ok_methods_ordered', r -> 'rules' -> 'merge_methods' = '["squash", "merge"]'::jsonb);

  -- ------------------------------------------------------------ path claims
  r := public.ws_claim_paths(ws, b, array['src/api/**'], null, 'Reworking the API', 4);
  e := public.ws_claim_paths(ws, d, array['src/**', '/docs/'], null, null, 2);
  out := out || jsonb_build_object(
    'ok_claim_made', jsonb_array_length(r -> 'claims') = 1 and jsonb_array_length(r -> 'overlaps') = 0
                     and r -> 'claims' -> 0 ->> 'note' = 'Reworking the API',
    'ok_claim_overlap', jsonb_array_length(e -> 'overlaps') = 1 and e -> 'overlaps' -> 0 ->> 'agent' = 'p12c-bo'
                        and e -> 'overlaps' -> 0 ->> 'yours' = 'src/**',
    'ok_claim_notified', exists (select 1 from public.notifications where agent_id = b and kind = 'claim_overlap'),
    'ok_claim_conflicts', jsonb_array_length(public.ws_claim_conflicts(ws, d, array['src/api/x.ts', 'lib/y.ts'])) = 1
                          and public.ws_claim_conflicts(ws, d, array['src/api/x.ts', 'lib/y.ts']) -> 0 ->> 'agent' = 'p12c-bo'
                          and public.ws_claim_conflicts(ws, b, array['src/api/x.ts']) -> 0 ->> 'pattern' = 'src/**'
                          and jsonb_array_length(public.ws_claim_conflicts(ws, b, array['lib/y.ts'])) = 0,
    'ok_claims_listed', jsonb_array_length(public.ws_list_claims(ws, x)) = 3,
    'ok_claim_bad_pattern', pg_temp.fails(format('select public.ws_claim_paths(%L, %L, %L)', ws, b, array['a\b']), 'PT400'),
    'ok_claim_count', pg_temp.fails(format('select public.ws_claim_paths(%L, %L, %L)', ws, b, '{}'::text[]), 'PT400'));
  r := public.ws_claim_paths(ws, b, array['src/api/**'], null, null, 8);
  out := out || jsonb_build_object(
    'ok_claim_renewed', (select count(*) from public.path_claims where workspace_id = ws and agent_id = b and released_at is null) = 1
                        and (select expires_at from public.path_claims where workspace_id = ws and agent_id = b and released_at is null) > now() + interval '7 hours'
                        and (select note from public.path_claims where workspace_id = ws and agent_id = b and released_at is null) = 'Reworking the API');

  perform public.ws_create_branch(ws, d, 'p12c-di/api', 'main');
  perform pg_temp.put(ws, d, 'p12c-di/api', 'src/api/x.ts', E'export const x = 3;\n');
  cr2 := (public.open_change_request(ws, d, 'p12c-di/api', 'main', 'Di edits the API', '') ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_cr_claims_touched', public.cr_json(cr2) -> 'claims_touched' -> 0 ->> 'agent' = 'p12c-bo',
    'ok_claim_touched_notice', exists (select 1 from public.notifications where agent_id = b and kind = 'claim_touched'),
    'ok_inbox_claims', jsonb_array_length(public.agent_code_inbox(b) -> 'touching_your_claims') = 1
                       and jsonb_array_length(public.agent_code_inbox(b) -> 'claims') = 1,
    'ok_inbox_owner', exists (select 1 from jsonb_array_elements(public.agent_code_inbox(c) -> 'review_requests') q
                               where (q ->> 'you_own_files')::boolean and (q ->> 'number')::int = pg_temp.num(cr2)));
  r := public.ws_release_claims(ws, d, null);
  out := out || jsonb_build_object('ok_release', (r ->> 'released')::int = 2 and jsonb_array_length(public.ws_list_claims(ws, x)) = 1);

  -- ------------------------------------------------------------ stacked change requests
  perform public.ws_create_branch(ws, a, 'dev', 'main');
  perform public.ws_set_branch_rules(ws,a,'dev','{"required_approvals":0}');
  perform public.ws_create_branch(ws, b, 'p12c-bo/s1', 'dev');
  perform pg_temp.put(ws, b, 'p12c-bo/s1', 'stack/one.txt', 'one');
  perform public.ws_create_branch(ws, b, 'p12c-bo/s2', 'p12c-bo/s1');
  perform pg_temp.put(ws, b, 'p12c-bo/s2', 'stack/two.txt', 'two');
  cra := (public.open_change_request(ws, b, 'p12c-bo/s1', 'dev', 'Stack one', '') ->> 'id')::uuid;
  crb := (public.open_change_request(ws, b, 'p12c-bo/s2', 'p12c-bo/s1', 'Stack two', '') ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_stack_links', (public.cr_json(crb) -> 'stack' ->> 'depends_on')::int = pg_temp.num(cra)
                      and public.cr_json(cra) -> 'stack' -> 'dependents' = jsonb_build_array(pg_temp.num(crb))
                      and (public.cr_json(crb) -> 'size' ->> 'files')::int = 1);
  r := public.merge_change_request(cra, a, null, 'squash');
  out := out || jsonb_build_object(
    'ok_stack_restacked', (select target_branch from public.change_requests where id = crb) = 'dev'
                          and (select restack_from from public.change_requests where id = crb) is null
                          and public.ws_is_ancestor(public.ws_resolve_ref(ws, 'dev'), public.ws_resolve_ref(ws, 'p12c-bo/s2'))
                          and ((select merge_state from public.change_requests where id = crb) ->> 'files')::int = 1
                          and (select mergeable from public.change_requests where id = crb)
                          and public.ws_file(ws, b, 'p12c-bo/s2', 'stack/two.txt') ->> 'content' = 'two'
                          and public.ws_file(ws, b, 'p12c-bo/s2', 'stack/one.txt') ->> 'content' = 'one',
    'ok_stack_notices', exists (select 1 from public.notifications where agent_id = b and kind = 'cr_retargeted')
                        and exists (select 1 from public.notifications where agent_id = b and kind = 'cr_restacked'));
  perform public.ws_create_branch(ws, b, 'p12c-bo/s3', 'dev');
  perform pg_temp.put(ws, b, 'p12c-bo/s3', 'stack/three.txt', 'three');
  perform public.ws_create_branch(ws, b, 'p12c-bo/s4', 'p12c-bo/s3');
  perform pg_temp.put(ws, b, 'p12c-bo/s4', 'stack/four.txt', 'four');
  crc := (public.open_change_request(ws, b, 'p12c-bo/s3', 'dev', 'Stack three', '') ->> 'id')::uuid;
  crd := (public.open_change_request(ws, b, 'p12c-bo/s4', 'p12c-bo/s3', 'Stack four', '') ->> 'id')::uuid;
  h := public.ws_resolve_ref(ws, 'p12c-bo/s4');
  r := public.merge_change_request(crc, a, null, 'merge');
  out := out || jsonb_build_object(
    'ok_stack_merge_retarget', (select target_branch from public.change_requests where id = crd) = 'dev'
                               and public.ws_resolve_ref(ws, 'p12c-bo/s4') = h
                               and ((select merge_state from public.change_requests where id = crd) ->> 'files')::int = 1
                               and (select mergeable from public.change_requests where id = crd));

  -- ------------------------------------------------------------ the merge queue
  ws2 := (public.create_workspace(a, 'Phase Twelve Queue') ->> 'id')::uuid;
  perform public.ws_set_member(ws2, a, '@p12c-bo', 'writer');
  perform public.ws_set_member(ws2, a, '@p12c-di', 'writer');
  perform pg_temp.put(ws2, a, 'main', 'base.txt', 'base');
  perform public.ws_set_branch_rules(ws2, a, 'main', '{"protected": true, "required_approvals": 1, "merge_queue": true}');
  for n in 1 .. 6 loop
    perform public.ws_create_branch(ws2, b, 'p12c-bo/q' || n, 'main');
    perform pg_temp.put(ws2, b, 'p12c-bo/q' || n, 'q' || n || '.txt', 'q' || n);
  end loop;
  cr := (public.open_change_request(ws2, b, 'p12c-bo/q1', 'main', 'Queue 1', '') ->> 'id')::uuid;
  cr2 := (public.open_change_request(ws2, b, 'p12c-bo/q2', 'main', 'Queue 2', '') ->> 'id')::uuid;
  cr3 := (public.open_change_request(ws2, b, 'p12c-bo/q3', 'main', 'Queue 3', '') ->> 'id')::uuid;
  r := public.merge_change_request(cr, b);
  out := out || jsonb_build_object(
    'ok_queue_waits', r ->> 'status' = 'queued' and r -> 'queue' ->> 'status' = 'waiting' and r -> 'queue' ->> 'reason' like '%approval%'
                      and (select status from public.change_requests where id = cr) = 'open');
  perform public.review_change_request(cr, d, 'approve', 'Fine');
  out := out || jsonb_build_object(
    'ok_queue_lands', (select status from public.change_requests where id = cr) = 'merged'
                      and (select merge_method from public.change_requests where id = cr) = 'fast_forward'
                      and (pg_temp.entry(cr)).status = 'landed' and (select merged_by from public.change_requests where id = cr) = b
                      and public.ws_file(ws2, b, 'main', 'q1.txt') ->> 'content' = 'q1');

  -- With a required check: test commits on queue branches, built one on another.
  perform public.ws_set_branch_rules(ws2, a, 'main', '{"required_checks": ["ci"]}');
  perform public.review_change_request(cr2, d, 'approve', 'Fine');
  perform public.review_change_request(cr3, d, 'approve', 'Fine');
  perform public.merge_change_request(cr2, b);
  perform public.merge_change_request(cr3, b);
  h := public.ws_resolve_ref(ws2, 'main');
  sp2 := (pg_temp.entry(cr2)).spec_commit;
  sp3 := (pg_temp.entry(cr3)).spec_commit;
  out := out || jsonb_build_object(
    'ok_queue_testing', (pg_temp.entry(cr2)).status = 'testing' and (pg_temp.entry(cr3)).status = 'testing'
                        and (pg_temp.entry(cr2)).spec_base = h and (pg_temp.entry(cr3)).spec_base = sp2
                        and h = (select merged_commit from public.change_requests where id = cr)
                        and (select message from public.commits where id = sp2) like 'Merge #%: Queue 2'
                        and public.ws_file(ws2, b, sp3, 'q2.txt') ->> 'content' = 'q2',
    'ok_queue_branches', public.ws_resolve_ref(ws2, 'queue/main/' || pg_temp.num(cr2)) = sp2
                         and public.ws_resolve_ref(ws2, 'queue/main/' || pg_temp.num(cr3)) = sp3,
    'ok_queue_branch_locked', pg_temp.fails(format('select pg_temp.put(%L, %L, %L, %L, %L)', ws2, a, 'queue/main/' || pg_temp.num(cr2), 'x', 'x'), 'PT403'),
    'ok_queue_list', jsonb_array_length(public.ws_queue_list(ws2, x)) = 2
                     and (public.ws_queue_list(ws2, x) -> 0 ->> 'position')::int = 1
                     and (public.ws_queue_list(ws2, x) -> 1 ->> 'position')::int = 2
                     and public.ws_queue_list(ws2, x) -> 0 -> 'checks' -> 'pending' = '["ci"]'::jsonb,
    'ok_queue_notice', exists (select 1 from public.notifications where agent_id = b and kind = 'cr_queue_testing'));
  perform public.cr_report_check(cr3, b, 'ci', 'passed', null, null, sp3);
  out := out || jsonb_build_object(
    'ok_queue_in_order', (select status from public.change_requests where id = cr3) = 'open' and public.ws_resolve_ref(ws2, 'main') = h);
  perform public.cr_report_check(cr2, b, 'ci', 'failed', 'boom', null, sp2);
  out := out || jsonb_build_object(
    'ok_queue_failed', (pg_temp.entry(cr2)).status = 'failed' and (pg_temp.entry(cr2)).reason like 'Checks failed%ci%'
                       and (select status from public.change_requests where id = cr2) = 'open'
                       and not exists (select 1 from public.branches where workspace_id = ws2 and name = 'queue/main/' || pg_temp.num(cr2))
                       and exists (select 1 from public.notifications where agent_id = b and kind = 'cr_queue_failed'),
    'ok_queue_rebuilt', (pg_temp.entry(cr3)).status = 'testing' and (pg_temp.entry(cr3)).spec_base = h
                        and (pg_temp.entry(cr3)).spec_commit <> sp3 and public.ws_resolve_ref(ws2, 'main') = h);
  sp3 := (pg_temp.entry(cr3)).spec_commit;
  perform public.cr_report_check(cr3, b, 'ci', 'passed', null, null, sp3);
  out := out || jsonb_build_object(
    'ok_queue_landed_after_checks', (select status from public.change_requests where id = cr3) = 'merged'
                                    and public.ws_resolve_ref(ws2, 'main') = sp3
                                    and (select merge_method from public.change_requests where id = cr3) = 'merge'
                                    and (pg_temp.entry(cr3)).landed_commit = sp3
                                    and public.ws_file(ws2, b, 'main', 'q3.txt') ->> 'content' = 'q3'
                                    and pg_temp.fails(format('select public.ws_file(%L, %L, %L, %L)', ws2, b, 'main', 'q2.txt'), 'PT404')
                                    and not exists (select 1 from public.branches where workspace_id = ws2 and starts_with(name, 'queue/')));

  -- Taking one out.
  cr4 := (public.open_change_request(ws2, b, 'p12c-bo/q4', 'main', 'Queue 4', '') ->> 'id')::uuid;
  perform public.review_change_request(cr4, d, 'approve', 'Fine');
  perform public.cr_enqueue(cr4, b);
  out := out || jsonb_build_object(
    'ok_dequeue_auth', (pg_temp.entry(cr4)).status = 'testing'
                       and pg_temp.fails(format('select public.cr_dequeue(%L, %L)', cr4, x), 'PT403'));
  r := public.cr_dequeue(cr4, b, 'Not yet');
  out := out || jsonb_build_object(
    'ok_dequeued', r ->> 'status' = 'cancelled' and r ->> 'reason' = 'Not yet'
                   and not exists (select 1 from public.branches where workspace_id = ws2 and starts_with(name, 'queue/'))
                   and pg_temp.fails(format('select public.cr_dequeue(%L, %L)', cr4, b), 'PT404'));

  -- A conflict with what landed ahead of it.
  perform public.ws_set_branch_rules(ws2, a, 'main', '{"required_checks": []}');
  perform public.ws_commit(ws2, b, 'p12c-bo/q5', null, 'Drop base', jsonb_build_array(jsonb_build_object('path', 'base.txt', 'delete', true)));
  perform pg_temp.put(ws2, b, 'p12c-bo/q4', 'base.txt', 'base, edited');
  cr5 := (public.open_change_request(ws2, b, 'p12c-bo/q5', 'main', 'Queue 5', '') ->> 'id')::uuid;
  perform public.review_change_request(cr5, d, 'approve', 'Fine');
  perform public.review_change_request(cr4, d, 'approve', 'Fine again');
  perform public.cr_enqueue(cr5, b, 'squash');
  perform public.cr_enqueue(cr4, b);
  -- The side that deleted base.txt added files, so the code worker first looks for a rename (there is none).
  j := (select payload from public.merge_jobs where kind = 'renames' and workspace_id = ws2 limit 1);
  out := out || jsonb_build_object(
    'ok_queue_waits_worker', (pg_temp.entry(cr4)).status = 'queued' and (pg_temp.entry(cr4)).reason like 'Waiting for the code worker%'
                             and j -> 'deleted' -> 0 ->> 'path' = 'base.txt');
  perform public.code_store_renames(j ->> 'base_root', j ->> 'side_root', '{}');
  perform public.code_after(array[ws2]);
  out := out || jsonb_build_object(
    'ok_queue_squash', (select status from public.change_requests where id = cr5) = 'merged'
                       and (select merge_method from public.change_requests where id = cr5) = 'squash',
    'ok_queue_conflict', (pg_temp.entry(cr4)).status = 'failed' and (pg_temp.entry(cr4)).reason like 'Conflicts with what is ahead of it: base.txt%');

  -- System queue entries enforce the same quorum; the method falls back to branch policy.
  perform public.ws_set_branch_rules(ws2, a, 'main', '{"merge_methods": ["rebase"]}');
  cr6 := (public.open_change_request(ws2, b, 'p12c-bo/q6', 'main', 'Queue 6', '') ->> 'id')::uuid;
  r := public.merge_change_request(cr6, null, null, 'merge', true);
  out := out || jsonb_build_object('ok_system_quorum_enforced',
    (select status from public.change_requests where id=cr6)='open' and (pg_temp.entry(cr6)).status='waiting');
  perform public.review_change_request(cr6,d,'approve','Independently checked system queue work');
  out := out || jsonb_build_object(
    'ok_queue_system', (select status from public.change_requests where id = cr6) = 'merged'
                       and (select merged_by from public.change_requests where id = cr6) is null
                       and (pg_temp.entry(cr6)).system and (pg_temp.entry(cr6)).method = 'rebase'
                       and public.ws_file(ws2, b, 'main', 'q6.txt') ->> 'content' = 'q6',
    'ok_queue_method_refused', pg_temp.fails(format('select public.cr_enqueue(%L, %L, %L)', cr2, b, 'merge'), 'PT409'),
    'ok_ws_detail', public.ws_detail(ws2, x) -> 'branches' -> 0 ->> 'name' = 'main'
                    and (public.ws_detail(ws2, x) -> 'branches' -> 0 -> 'rules' ->> 'merge_queue')::boolean
                    and (public.ws_detail(ws2, x) ->> 'queue')::int = 0);

  -- ------------------------------------------------------------ the web's reads, and grants
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  j := public.web_cr_status('phase-twelve-queue', pg_temp.num(cr3));
  e := public.web_ws_queue('phase-twelve-coord');
  out := out || jsonb_build_object(
    'ok_web_cr_status', j -> 'queue' ->> 'status' = 'landed' and j ? 'review_state' and j ? 'stack' and j ? 'blocked_by'
                        and j -> 'merge_method' #>> '{}' = 'merge',
    'ok_web_ws_queue', jsonb_array_length(e -> 'claims') = 1 and e -> 'queue' = '[]'::jsonb);
  begin
    perform public.web_cr_status('phase-twelve-queue', 999);
    v_err := null;
  exception when others then
    v_err := sqlstate;
  end;
  reset role;
  out := out || jsonb_build_object('ok_web_missing', v_err = 'PT404');
  out := out || jsonb_build_object(
    'ok_grants', has_function_privilege('anon', 'public.web_cr_status(text, int)', 'execute')
                 and has_function_privilege('anon', 'public.web_ws_queue(text)', 'execute')
                 and has_function_privilege('anon', 'public.web_ws_tree(text, text, text)', 'execute')
                 and not has_function_privilege('anon', 'public.ws_queue_process(uuid, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.cr_enqueue(uuid, uuid, text, boolean)', 'execute')
                 and not has_function_privilege('authenticated', 'public.ws_claim_paths(uuid, uuid, text[], uuid, text, int)', 'execute')
                 and not has_function_privilege('anon', 'public.ws_set_branch_rules(uuid, uuid, text, jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.ws_queue_kick(uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.ws_queue_try(uuid, text)', 'execute')
                 and has_function_privilege('service_role', 'public.ws_queue_kick(uuid)', 'execute'),
    'ok_rls', (select relrowsecurity from pg_class where oid = 'public.merge_queue'::regclass)
              and (select relrowsecurity from pg_class where oid = 'public.path_claims'::regclass)
              and (select relrowsecurity from pg_class where oid = 'public.codeowners_rules'::regclass));

  raise exception 'PHASE12_COORD_RESULT %', out::text;
exception when others then
  if sqlerrm like 'PHASE12_COORD_RESULT%' then
    raise;
  end if;
  raise exception 'PHASE12_COORD_FAILED (%): % | so far: %', sqlstate, sqlerrm, out::text;
end $test$;
