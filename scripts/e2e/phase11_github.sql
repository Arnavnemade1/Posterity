-- Phase 11 database test: GitHub sync. Installations and who may claim them, linking (who may, which
-- repositories, private repositories and visibility), the job queue (folding, leases, retries), push
-- plans (what GitHub still lacks, the empty first commit left out), commits coming in from GitHub,
-- the change request that merges a diverged default branch, checks and pull requests, imports,
-- what anon, owners and others see, and the grants.
--
-- Runs inside one transaction and ends by raising PHASE11_GH_RESULT, which rolls everything back.
-- Every "ok_*" key in the JSON should be true. Run it with MCP `execute_sql` after phase11_github.sql
-- is applied.
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  r jsonb; j jsonb;
  a uuid; b uuid; x uuid; auto uuid;
  ws uuid; ws2 uuid; ws3 uuid; wsi uuid;
  h0 text; c1 text; c2 text; c3 text; ci text; cg text;
  s_a1 text; s_a2 text; s_png text; s_new text;
  v_job bigint;
  v_lease jsonb;
  v_cr uuid;
  n int;
  ok boolean;
  sha1 text := repeat('1', 40);
  sha2 text := repeat('2', 40);
  sha3 text := repeat('3', 40);
  tree1 text := repeat('a', 40);
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

  create function pg_temp.blob(p_ws uuid, p_agent uuid, p_text text) returns text
  language plpgsql as $fn$
  declare
    v_sha text := encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.ws_add_blob(p_ws, p_agent, v_sha,
                               encode(extensions.digest(convert_to('blob ' || octet_length(convert_to(p_text, 'UTF8')), 'UTF8') || '\x00'::bytea
                                                        || convert_to(p_text, 'UTF8'), 'sha1'), 'hex'),
                               octet_length(convert_to(p_text, 'UTF8')), false, p_text, null);
    return v_sha;
  end
  $fn$;

  create function pg_temp.queued(p_ws uuid, p_kind text, p_branch text default null) returns int
  language sql as $fn$
    select count(*)::int from public.sync_jobs
     where workspace_id = p_ws and kind = p_kind and status = 'queued' and (p_branch is null or branch = p_branch)
  $fn$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@phase11gh.invalid', '{"username":"phase11gh_u1"}', now(), now()),
         (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@phase11gh.invalid', '{"username":"phase11gh_u2"}', now(), now());

  a := (public.register_agent('gh-alice', 'Alice', '', '{code}', '{}', '{}', null, u1, 'api') -> 'agent' ->> 'id')::uuid;
  b := (public.register_agent('gh-bob', 'Bob', '', '{code}', '{}', '{}', null, u2, 'api') -> 'agent' ->> 'id')::uuid;
  auto := (public.register_agent('gh-auto', 'Auto', '', '{code}', '{}', '{}', null, u1, 'api') -> 'agent' ->> 'id')::uuid;
  x := (public.register_agent('gh-xena', 'Xena', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;
  perform public.set_autonomy(auto, u1, 'autonomous');

  -- ------------------------------------------------------------ grants and the gate
  out := out || jsonb_build_object(
    'ok_grants', has_function_privilege('anon', 'public.web_workspace_github(uuid)', 'execute')
                 and has_function_privilege('authenticated', 'public.web_link_workspace_github(uuid, bigint, text, boolean)', 'execute')
                 and has_function_privilege('authenticated', 'public.web_github_overview()', 'execute')
                 and not has_function_privilege('anon', 'public.web_link_workspace_github(uuid, bigint, text, boolean)', 'execute')
                 and not has_function_privilege('anon', 'public.web_github_overview()', 'execute')
                 and not has_function_privilege('authenticated', 'public.gh_link(uuid, uuid, uuid, text, text, boolean)', 'execute')
                 and not has_function_privilege('authenticated', 'public.gh_claim_installation(bigint, uuid, text)', 'execute')
                 and not has_function_privilege('anon', 'public.gh_import_commit(uuid, text, text[], text, jsonb, text, jsonb, bigint, text, text, boolean, jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.gh_claim(int)', 'execute')
                 and has_function_privilege('authenticated', 'public.web_ws_log(text, text, text, int, int, text)', 'execute'),
    'ok_gate', public.autonomy_gate(a, 'github_import') = 'deny'
               and public.autonomy_gate(auto, 'github_import') = 'deny'
               and public.autonomy_gate(x, 'github_import') = 'deny'
               and public.autonomy_gate(a, 'github_push') = 'deny',
    'ok_gate_request', (public.request_owner(a, 'github_import', '{"repo": "acme/secret"}', 'Import acme/secret') ->> 'status') = 'pending');

  -- ------------------------------------------------------------ installations
  r := public.gh_sync_installation(
         '{"id": 9001, "account": {"login": "acme", "id": 77, "type": "Organization"}, "repository_selection": "selected"}',
         '[{"id": 501, "full_name": "acme/site", "private": false, "default_branch": "main"},
           {"id": 502, "full_name": "acme/secret", "private": true, "default_branch": "trunk"},
           {"id": 503, "full_name": "acme/old", "private": false, "archived": true},
           {"id": 504, "full_name": "acme/spare", "private": false},
           {"id": 505, "full_name": "not a repo", "private": false}]', 'replace', 'created');
  out := out || jsonb_build_object(
    'ok_installation', (r ->> 'account_login') = 'acme' and (r ->> 'account_type') = 'Organization' and (r ->> 'user_id') is null
                       and (select count(*) from public.github_repos where installation_id = 9001) = 4,
    'ok_unclaimed_agent_repos', jsonb_array_length(public.gh_agent_repos(a) -> 'repositories') = 0
                                and not (public.gh_agent_repos(a) ->> 'owner_connected')::boolean);
  r := public.gh_claim_installation(9001, u1, 'alice-gh');
  out := out || jsonb_build_object(
    'ok_claim', (r ->> 'account') = 'acme' and (r ->> 'repositories')::int = 4
                and (select user_id from public.github_installations where id = 9001) = u1,
    'ok_claim_again', (public.gh_claim_installation(9001, u1, 'alice-gh') ->> 'id')::bigint = 9001,
    'ok_claim_other', pg_temp.fails(format('select public.gh_claim_installation(9001, %L, %L)', u2, 'bob-gh'), 'PT409'),
    'ok_claim_missing', pg_temp.fails(format('select public.gh_claim_installation(9999, %L, %L)', u2, 'bob-gh'), 'PT404'),
    'ok_agent_repos', jsonb_array_length(public.gh_agent_repos(a) -> 'repositories') = 4
                      and (public.gh_agent_repos(a) ->> 'owner_connected')::boolean
                      and jsonb_array_length(public.gh_agent_repos(b) -> 'repositories') = 0);

  -- ------------------------------------------------------------ a workspace with history
  r := public.create_workspace(a, 'Site', 'gh-site', 'A site.');
  ws := (r ->> 'id')::uuid;
  h0 := r ->> 'head';
  s_a1 := pg_temp.blob(ws, a, 'one');
  s_a2 := pg_temp.blob(ws, a, 'two');
  s_png := encode(extensions.digest('png', 'sha256'), 'hex');
  perform public.ws_add_blob(ws, a, s_png, encode(extensions.digest('\x626c6f62203300706e67'::bytea, 'sha1'), 'hex'), 3, true, null, 'ab/' || s_png);
  c1 := public.ws_commit(ws, a, 'main', h0, 'First files', jsonb_build_array(
          jsonb_build_object('path', 'a.txt', 'blob', s_a1), jsonb_build_object('path', 'img/b.png', 'blob', s_png))) ->> 'commit';
  c2 := public.ws_commit(ws, a, 'main', c1, 'Change a, drop b', jsonb_build_array(
          jsonb_build_object('path', 'a.txt', 'blob', s_a2), jsonb_build_object('path', 'img/b.png', 'delete', true))) ->> 'commit';

  -- ------------------------------------------------------------ linking
  perform public.ws_set_member(ws, a, 'gh-bob', 'writer');
  out := out || jsonb_build_object(
    'ok_link_writer_refused', pg_temp.fails(format('select public.gh_link(%L, %L, null, %L)', ws, b, 'acme/site'), 'PT403'),
    'ok_link_unknown_repo', pg_temp.fails(format('select public.gh_link(%L, %L, null, %L)', ws, a, 'acme/nope'), 'PT404'),
    'ok_link_archived', pg_temp.fails(format('select public.gh_link(%L, %L, null, %L)', ws, a, 'acme/old'), 'PT409'),
    'ok_link_bad_mode', pg_temp.fails(format('select public.gh_link(%L, %L, null, %L, %L)', ws, a, 'acme/site', 'both'), 'PT400'),
    'ok_link_private_two_way', pg_temp.fails(format('select public.gh_link(%L, %L, null, %L, %L)', ws, a, 'acme/secret', 'two_way'), 'PT409'),
    'ok_link_both', pg_temp.fails(format('select public.gh_link(%L, %L, %L, %L)', ws, a, u1, 'acme/site'), 'PT400'));
  r := public.create_workspace(x, 'Xena space', 'gh-xena', '');
  out := out || jsonb_build_object(
    'ok_link_unowned_agent', pg_temp.fails(format('select public.gh_link(%L, %L, null, %L)', (r ->> 'id')::uuid, x, 'acme/site'), 'PT403'));

  r := public.gh_link(ws, a, null, 'ACME/Site', 'mirror', true);
  out := out || jsonb_build_object(
    'ok_link', (r ->> 'repo') = 'acme/site' and (r ->> 'mode') = 'mirror' and (r ->> 'status') = 'linking'
               and (r ->> 'open_prs')::boolean and (r ->> 'linked_by') = '@gh-alice' and (r ->> 'default_branch') = 'main',
    'ok_link_job', pg_temp.queued(ws, 'link') = 1,
    'ok_link_activity', exists (select 1 from public.activity where kind = 'workspace_linked' and agent_id = a and data ->> 'workspace' = 'gh-site'),
    'ok_ws_json_github', (public.ws_json(ws) #>> '{github,repo}') = 'acme/site' and (public.ws_json(ws) #>> '{github,mode}') = 'mirror');

  -- While linking, branch moves wait for the link job (it pushes everything at its end).
  c3 := public.ws_commit(ws, a, 'feature', c2, 'A feature', jsonb_build_array(jsonb_build_object('path', 'f.txt', 'blob', s_a1))) ->> 'commit';
  out := out || jsonb_build_object('ok_linking_no_push', pg_temp.queued(ws, 'push') = 0);

  r := public.create_workspace(a, 'Other', 'gh-other', '');
  ws2 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_link_taken', pg_temp.fails(format('select public.gh_link(%L, %L, null, %L)', ws2, a, 'acme/site'), 'PT409'));

  -- A private repository two-way needs a private workspace, which then stays private.
  perform public.update_workspace(ws2, a, '{"visibility": "private"}');
  r := public.gh_link(ws2, a, null, 'acme/secret', 'two_way', false);
  out := out || jsonb_build_object(
    'ok_link_private', (r ->> 'private')::boolean and (r ->> 'default_branch') = 'trunk' and (r ->> 'mode') = 'two_way',
    'ok_private_stays_private', pg_temp.fails(format('select public.update_workspace(%L, %L, %L)', ws2, a, '{"visibility": "public"}'), 'PT409'),
    'ok_public_json_hides', (public.gh_public_json(ws2) ->> 'repo') is null and (public.gh_public_json(ws2) ->> 'url') is null
                            and (public.gh_public_json(ws2) ->> 'private')::boolean);

  -- ------------------------------------------------------------ the queue
  perform public.gh_set_remote(ws, '{"status": "active", "synced": true}');
  delete from public.sync_jobs where workspace_id in (ws, ws2);
  c3 := public.ws_commit(ws, a, 'feature', c3, 'More feature', jsonb_build_array(jsonb_build_object('path', 'g.txt', 'blob', s_a2))) ->> 'commit';
  c3 := public.ws_commit(ws, a, 'feature', c3, 'Even more', jsonb_build_array(jsonb_build_object('path', 'g.txt', 'delete', true))) ->> 'commit';
  perform public.ws_create_branch(ws, a, 'github/main', 'main');
  perform public.ws_create_branch(ws, a, 'scratch', 'main');
  perform public.ws_delete_branch(ws, a, 'scratch');
  out := out || jsonb_build_object(
    'ok_push_folds', pg_temp.queued(ws, 'push', 'feature') = 1,
    'ok_push_github_branch_skipped', pg_temp.queued(ws, 'push', 'github/main') = 0,
    'ok_delete_ref', pg_temp.queued(ws, 'delete_ref', 'scratch') = 1);
  r := public.open_change_request(ws, a, 'feature', null, 'Add the feature', '', null, false);
  v_cr := (select id from public.change_requests where workspace_id = ws and number = (r ->> 'number')::int);
  out := out || jsonb_build_object('ok_pr_job', exists (select 1 from public.sync_jobs where change_request_id = v_cr and kind = 'pr' and status = 'queued'));

  -- Leases: one workspace at a time, its jobs in order.
  update public.sync_jobs set run_after = now() - interval '1 second' where status = 'queued';
  delete from public.sync_leases;
  v_lease := public.gh_claim(10);
  out := out || jsonb_build_object(
    'ok_claim_jobs', v_lease is not null and jsonb_array_length(v_lease -> 'jobs') >= 1
                     and (select bool_and(status = 'running') from public.sync_jobs where id in (
                           select (e ->> 'id')::bigint from jsonb_array_elements(v_lease -> 'jobs') e))
                     and (select count(distinct workspace_id) from public.sync_jobs where status = 'running') = 1,
    'ok_claim_ordered', (select bool_and(a1 < a2) from (
                           select (e.v ->> 'id')::bigint a1, lead((e.v ->> 'id')::bigint) over (order by e.ord) a2
                             from jsonb_array_elements(v_lease -> 'jobs') with ordinality as e(v, ord)) t where a2 is not null) is not false);
  -- No second lease on the same workspace while the first holds.
  j := public.gh_claim(10);
  out := out || jsonb_build_object('ok_lease_exclusive', j is null or (j ->> 'workspace_id') <> (v_lease ->> 'workspace_id'));
  if j is not null then
    perform public.gh_release_lease((j ->> 'workspace_id')::uuid, (j ->> 'token')::uuid);
    update public.sync_jobs set status = 'queued', locked_until = null where workspace_id = (j ->> 'workspace_id')::uuid and status = 'running';
  end if;
  v_job := (v_lease #>> '{jobs,0,id}')::bigint;
  perform public.gh_finish_job(v_job, 'continue', '{"pushed": 40}');
  out := out || jsonb_build_object('ok_continue', (select status = 'queued' and attempts = 0 from public.sync_jobs where id = v_job));
  update public.sync_jobs set status = 'running', attempts = 1 where id = v_job;
  perform public.gh_finish_job(v_job, 'retry', null, 'GitHub answered 502');
  out := out || jsonb_build_object('ok_retry', (select status = 'queued' and run_after > now() + interval '20 seconds' and last_error = 'GitHub answered 502'
                                                   from public.sync_jobs where id = v_job));
  update public.sync_jobs set status = 'running', attempts = 6 where id = v_job;
  perform public.gh_finish_job(v_job, 'retry', null, 'still down');
  out := out || jsonb_build_object('ok_retry_gives_up', (select status = 'failed' from public.sync_jobs where id = v_job));
  -- A stuck job (its worker died) is retried; one already waiting makes it redundant.
  update public.sync_jobs set status = 'running', attempts = 1, locked_until = now() - interval '1 minute' where id = v_job;
  perform public.gh_release_lease((v_lease ->> 'workspace_id')::uuid, (v_lease ->> 'token')::uuid);
  update public.sync_jobs set status = 'done' where status = 'running' and id <> v_job;
  perform public.gh_claim(1);
  out := out || jsonb_build_object('ok_stuck_requeued', (select status in ('queued', 'running', 'done') from public.sync_jobs where id = v_job));
  delete from public.sync_leases;
  update public.sync_jobs set status = 'done' where status in ('queued', 'running');

  -- ------------------------------------------------------------ push plans
  r := public.gh_push_plan(ws, 501, 'main', 40);
  out := out || jsonb_build_object(
    'ok_plan', (r ->> 'total')::int = 2 and not (r ->> 'more')::boolean and (r ->> 'head') = c2
               and (r #>> '{commits,0,id}') = c1 and (r #>> '{commits,1,id}') = c2
               and (r #>> '{commits,0,parents,0,virtual}')::boolean
               and jsonb_array_length(r #> '{commits,0,changes}') = 2
               and (r #>> '{commits,0,author,handle}') = 'gh-alice',
    'ok_plan_changes', (select bool_and(case e ->> 'path' when 'a.txt' then e ->> 'sha256' = s_a2 and (e ->> 'existed')::boolean
                                                          when 'img/b.png' then e ->> 'sha256' is null and (e ->> 'existed')::boolean end)
                          from jsonb_array_elements(r #> '{commits,1,changes}') e),
    'ok_plan_binary', (select (e ->> 'binary')::boolean and (e ->> 'git_sha1') ~ '^[0-9a-f]{40}$'
                         from jsonb_array_elements(r #> '{commits,0,changes}') e where e ->> 'path' = 'img/b.png'),
    'ok_plan_limit', (public.gh_push_plan(ws, 501, 'main', 1) ->> 'more')::boolean,
    'ok_plan_gone', public.gh_push_plan(ws, 501, 'nope', 40) is null);
  perform public.gh_record_mirrors(501, jsonb_build_array(jsonb_build_object('commit', c1, 'sha', sha1, 'tree', tree1)));
  r := public.gh_push_plan(ws, 501, 'main', 40);
  out := out || jsonb_build_object(
    'ok_plan_after_mirror', (r ->> 'total')::int = 1 and (r #>> '{commits,0,id}') = c2
                            and (r #>> '{commits,0,parents,0,sha}') = sha1 and (r #>> '{commits,0,parents,0,tree}') = tree1,
    'ok_last_synced', (public.gh_last_synced(ws, 501, 'main') ->> 'commit') = c1 and (public.gh_last_synced(ws, 501, 'main') ->> 'sha') = sha1
                      and (public.gh_last_synced(ws, 501, 'main') ->> 'head') = c2);
  perform public.gh_record_mirrors(501, jsonb_build_array(jsonb_build_object('commit', c2, 'sha', sha2, 'tree', tree1)));
  r := public.gh_push_plan(ws, 501, 'main', 40);
  out := out || jsonb_build_object(
    'ok_plan_synced', (r ->> 'total')::int = 0 and (r #>> '{head_mirror,sha}') = sha2,
    'ok_plan_empty_ws', (public.gh_push_plan(ws2, 502, 'main', 40) ->> 'empty')::boolean,
    'ok_unsynced', public.gh_enqueue_unsynced(ws) >= 1 and pg_temp.queued(ws, 'push', 'feature') = 1
                   and pg_temp.queued(ws, 'push', 'main') = 0 and pg_temp.queued(ws, 'pr') = 1);

  -- ------------------------------------------------------------ files and commits from GitHub
  s_new := encode(extensions.digest(convert_to('from github', 'UTF8'), 'sha256'), 'hex');
  out := out || jsonb_build_object(
    'ok_add_blob_bad_hash', pg_temp.fails(format('select public.gh_add_blobs(%L, %L)', ws, jsonb_build_array(jsonb_build_object(
                              'sha256', s_new, 'git_sha1', sha3, 'size', 11, 'content', 'tampered!!!'))), 'PT400'));
  perform public.gh_add_blobs(ws, jsonb_build_array(jsonb_build_object('sha256', s_new, 'git_sha1', sha3, 'size', 11, 'content', 'from github')));
  j := public.gh_blobs_by_git(ws2, array[sha3, repeat('9', 40)]);
  out := out || jsonb_build_object(
    'ok_blobs_by_git', (j ->> sha3) = s_new and not (j ? repeat('9', 40))
                       and exists (select 1 from public.workspace_blobs where workspace_id = ws2 and sha256 = s_new));
  -- Fast-forward on the default branch.
  r := public.gh_import_commit(ws, 'main', array[c2], c2, jsonb_build_object('a.txt', s_a2, 'NEWS.md', s_new),
                               'Update NEWS on GitHub', '{"provider": "github", "sha": "3333333333333333333333333333333333333333"}',
                               501, sha3, tree1, false);
  ci := r ->> 'commit';
  out := out || jsonb_build_object(
    'ok_import_commit', (select head from public.branches where workspace_id = ws and name = 'main') = ci
                        and (select origin ->> 'provider' from public.commits where id = ci) = 'github'
                        and (select author_agent_id is null and parents = array[c2] from public.commits where id = ci)
                        and exists (select 1 from public.commit_mirrors where repo_id = 501 and commit_id = ci and git_sha = sha3 and direction = 'in'),
    'ok_import_again', (public.gh_import_commit(ws, 'main', array[ci], ci, '{}', 'again', '{}', 501, sha3, tree1, false) ->> 'existed')::boolean,
    'ok_import_moved', pg_temp.fails(format('select public.gh_import_commit(%L, %L, %L, %L, %L, %L, %L, 501, %L, %L, false)',
                         ws, 'main', array[c2], c2, jsonb_build_object('a.txt', s_a1), 'stale', '{}', repeat('4', 40), tree1), 'PT409'),
    'ok_import_unknown_blob', pg_temp.fails(format('select public.gh_import_commit(%L, %L, %L, %L, %L, %L, %L)',
                                ws, 'main', array[ci], ci, jsonb_build_object('x.txt', repeat('f', 64)), 'bad', '{}'), 'PT400'),
    'ok_import_log', (public.ws_log(ws, a, 'main', null, 5, 0) #>> '{commits,0,from_github}')::boolean
                     and not (public.ws_log(ws, a, 'main', null, 5, 0) #>> '{commits,1,from_github}')::boolean);
  -- Both sides moved: GitHub's side lands on github/main, from the last commit both had.
  delete from public.branches where workspace_id = ws and name = 'github/main';
  r := public.gh_import_commit(ws, 'github/sync', array[c2], null, jsonb_build_object('a.txt', s_a1, 'NEWS.md', s_new),
                               'GitHub side', '{"provider": "github"}', 501, repeat('5', 40), tree1, false);
  cg := r ->> 'commit';
  r := public.gh_import_commit(ws, 'github/sync', array[c2], null, jsonb_build_object('NEWS.md', s_new),
                               'GitHub side, again', '{"provider": "github"}', 501, repeat('6', 40), tree1, true);
  out := out || jsonb_build_object(
    'ok_sync_branch', (select head from public.branches where workspace_id = ws and name = 'github/sync') = (r ->> 'commit')
                      and (select parents = array[c2] from public.commits where id = r ->> 'commit')
                      and pg_temp.queued(ws, 'push', 'github/sync') = 0);
  perform public.gh_set_remote(ws, '{"status": "diverged", "detail": "both moved"}');
  j := public.gh_open_sync_cr(ws, 'github/sync', 'Sync from GitHub', 'GitHub''s main moved.');
  out := out || jsonb_build_object(
    'ok_sync_cr', (select author_agent_id is null and status = 'open' and source_branch = 'github/sync' and target_branch = 'main'
                     from public.change_requests where id = (j ->> 'id')::uuid)
                  and (public.gh_remote_json(ws) ->> 'sync_change_request')::int = (j ->> 'number')::int
                  and exists (select 1 from public.cr_review_requests where change_request_id = (j ->> 'id')::uuid and agent_id = a)
                  and exists (select 1 from public.notifications where agent_id = a and kind = 'github_diverged'),
    'ok_sync_cr_reused', (public.gh_open_sync_cr(ws, 'github/sync', 'Sync again', '') ->> 'number') = (j ->> 'number'),
    'ok_sync_cr_no_pr', not exists (select 1 from public.sync_jobs where change_request_id = (j ->> 'id')::uuid));

  -- ------------------------------------------------------------ status changes, checks, pull requests
  r := public.gh_set_remote(ws, '{"status": "error", "detail": "GitHub refused the push"}');
  out := out || jsonb_build_object(
    'ok_error_notices', (r ->> 'status') = 'error' and (r ->> 'status_detail') = 'GitHub refused the push'
                        and exists (select 1 from public.notifications where user_id = u1 and kind = 'github_sync_error')
                        and exists (select 1 from public.notifications where agent_id = a and kind = 'github_sync_error'));
  r := public.gh_set_remote(ws, '{"status": "active", "synced": true}');
  out := out || jsonb_build_object('ok_active_clears', (r ->> 'status_detail') is null and (r ->> 'sync_change_request') is null);

  perform public.gh_record_mirrors(501, jsonb_build_array(jsonb_build_object('commit', c3, 'sha', repeat('7', 40), 'tree', tree1)));
  n := public.gh_record_check(501, repeat('7', 40), 'build', 'passed', 'ok', 'https://github.com/acme/site/actions/runs/1');
  out := out || jsonb_build_object(
    'ok_check', n = 1 and exists (select 1 from public.cr_checks where change_request_id = v_cr and name = 'GitHub: build'
                                    and status = 'passed' and url like 'https://github.com/%' and reported_by is null),
    'ok_check_unknown_sha', public.gh_record_check(501, repeat('8', 40), 'build', 'passed') = 0);
  perform public.gh_record_check(501, repeat('7', 40), 'build', 'failed', 'tests failed', null);
  perform public.gh_record_check(501, repeat('7', 40), 'build', 'failed', 'tests failed', null);
  out := out || jsonb_build_object(
    'ok_check_failed_notice', (select count(*) from public.notifications where agent_id = a and kind = 'cr_check_failed'
                                 and data ->> 'check' = 'GitHub: build') = 1);

  perform public.gh_record_pr(v_cr, 501, 12, 'https://github.com/acme/site/pull/12', 'open', 'posterity/feature', 'main');
  out := out || jsonb_build_object('ok_cr_json_pr', (public.cr_json(v_cr) #>> '{pull_request,number}')::int = 12);
  n := public.gh_pr_event(501, 12, 'closed', 'octocat');
  out := out || jsonb_build_object(
    'ok_pr_event', n = 1 and exists (select 1 from public.notifications where agent_id = a and kind = 'github_pr_closed'),
    'ok_pr_event_same', public.gh_pr_event(501, 12, 'closed', 'octocat') = 0,
    'ok_pr_context', (public.gh_pr_context(v_cr) #>> '{pull_request,number}')::int = 12
                     and (public.gh_pr_context(v_cr) ->> 'source_head') = c3);

  -- ------------------------------------------------------------ what people see
  set local role anon;
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  j := public.web_workspace_github(ws);
  out := out || jsonb_build_object(
    'ok_anon_public_link', (j #>> '{remote,repo}') = 'acme/site' and (j ->> 'jobs') is null and not (j ->> 'can_manage')::boolean
                           and (j #>> '{remote,installation_id}') is null,
    'ok_anon_installations_hidden', (select count(*) from public.github_installations) = 0);
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  j := public.web_workspace_github(ws2);
  out := out || jsonb_build_object(
    'ok_owner_private_link', (j #>> '{remote,repo}') = 'acme/secret' and (j ->> 'can_manage')::boolean
                             and jsonb_typeof(j -> 'jobs') = 'array' and jsonb_typeof(j -> 'repositories') = 'array',
    'ok_owner_installations', (select count(*) from public.github_installations) = 1 and (select count(*) from public.github_repos) = 4);
  j := public.web_github_overview();
  out := out || jsonb_build_object(
    'ok_overview', jsonb_array_length(j -> 'installations') = 1 and jsonb_array_length(j #> '{installations,0,repositories}') = 4
                   and exists (select 1 from jsonb_array_elements(j -> 'workspaces') e where e ->> 'slug' = 'gh-site' and e #>> '{remote,repo}' = 'acme/site'),
    'ok_web_link', (public.web_link_workspace_github((select id from public.workspaces where slug = 'gh-other'), 502, 'two_way', false) ->> 'repo') = 'acme/secret');
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  j := public.web_workspace_github(ws);
  begin
    perform public.web_link_workspace_github(ws, 504, 'mirror', false);
    ok := false;
  exception when others then
    ok := sqlstate = 'PT403';
  end;
  out := out || jsonb_build_object(
    'ok_writer_owner_sees', (j #>> '{remote,repo}') = 'acme/site' and not (j ->> 'can_manage')::boolean and (j ->> 'repositories') is null,
    'ok_other_cannot_link', ok,
    'ok_other_installations_hidden', (select count(*) from public.github_installations) = 0);
  begin
    perform public.web_workspace_github(ws2);
    ok := false;
  exception when others then
    ok := sqlstate = 'PT404';
  end;
  out := out || jsonb_build_object('ok_private_ws_hidden', ok);
  reset role;

  -- ------------------------------------------------------------ installations change
  perform public.gh_sync_installation('{"id": 9001, "account": {"login": "acme", "type": "Organization"}}',
                                      '[{"id": 501}]', 'remove', null);
  out := out || jsonb_build_object(
    'ok_repo_removed_pauses', (public.gh_remote_json(ws) ->> 'status') = 'paused'
                              and (public.gh_remote_json(ws) ->> 'status_detail') like '%removed%',
    'ok_resync_paused', pg_temp.fails(format('select public.gh_resync(%L, %L, null)', ws, a), 'PT409'));
  delete from public.sync_jobs where workspace_id = ws and status = 'queued';
  perform public.gh_sync_installation('{"id": 9001, "account": {"login": "acme", "type": "Organization"}}',
                                      '[{"id": 501, "full_name": "acme/site", "private": false}]', 'add', null);
  out := out || jsonb_build_object(
    'ok_repo_back_resumes', (public.gh_remote_json(ws) ->> 'status') = 'linking' and pg_temp.queued(ws, 'link') = 1);
  perform public.gh_sync_installation('{"id": 9001, "account": {"login": "acme", "type": "Organization"}}', null, 'add', 'suspend');
  out := out || jsonb_build_object(
    'ok_suspend_pauses', (public.gh_remote_json(ws) ->> 'status') = 'paused' and (public.gh_remote_json(ws2) ->> 'status') = 'paused'
                         and jsonb_array_length(public.gh_agent_repos(a) -> 'repositories') = 0);
  perform public.gh_sync_installation('{"id": 9001, "account": {"login": "acme", "type": "Organization"}}', null, 'add', 'unsuspend');
  out := out || jsonb_build_object('ok_unsuspend_resumes', (public.gh_remote_json(ws) ->> 'status') = 'linking');

  -- ------------------------------------------------------------ resync, unlink
  delete from public.sync_jobs where workspace_id in (ws, ws2) and status = 'queued';
  r := public.gh_resync(ws2, a, null);
  out := out || jsonb_build_object(
    'ok_resync', pg_temp.queued(ws2, 'link') = 1 and pg_temp.queued(ws2, 'pull') = 1,
    'ok_status_writer', (public.gh_status(ws, b) #>> '{remote,repo}') = 'acme/site' and jsonb_typeof(public.gh_status(ws, b) -> 'jobs') = 'array',
    'ok_status_reader_private', (public.gh_status(ws2, a) #>> '{remote,repo}') = 'acme/secret',
    'ok_unlink_writer', pg_temp.fails(format('select public.gh_unlink(%L, %L, null)', ws, b), 'PT403'));
  r := public.gh_unlink(ws, a, null);
  out := out || jsonb_build_object(
    'ok_unlink', (r ->> 'unlinked')::boolean and not exists (select 1 from public.workspace_remotes where workspace_id = ws)
                 and pg_temp.queued(ws, 'link') = 0 and public.ws_json(ws) -> 'github' = 'null'::jsonb,
    'ok_unlink_again', pg_temp.fails(format('select public.gh_unlink(%L, %L, null)', ws, a), 'PT404'),
    'ok_mirrors_kept', exists (select 1 from public.commit_mirrors where repo_id = 501 and commit_id = c1));

  -- ------------------------------------------------------------ imports
  r := public.gh_start_import(a, '{"repo": "octocat/Hello-World", "private": false}', null, null, null, null, null, null, null);
  wsi := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_import_start', (r ->> 'name') = 'Hello-World' and (r ->> 'visibility') = 'public'
                       and (r #>> '{import,status}') = 'queued' and (r #>> '{import,repo}') = 'octocat/Hello-World'
                       and exists (select 1 from public.sync_jobs where workspace_id = wsi and kind = 'import' and status = 'queued'
                                     and payload #>> '{source,repo}' = 'octocat/Hello-World'),
    'ok_import_private_unknown', pg_temp.fails(format('select public.gh_start_import(%L, %L)', b, '{"repo": "acme/secret", "private": true}'), 'PT404'),
    'ok_import_private_public', pg_temp.fails(format('select public.gh_start_import(%L, %L, null, null, null, %L)', a,
                                                     '{"repo": "acme/secret", "private": true}', 'public'), 'PT409'),
    'ok_import_bad_repo', pg_temp.fails(format('select public.gh_start_import(%L, %L)', a, '{"repo": "not a repo"}'), 'PT400'));
  out := out || jsonb_build_object(
    'ok_import_link_taken', pg_temp.fails(format('select public.gh_start_import(%L, %L, null, null, null, null, null, null, %L)', a,
                                                 '{"repo": "acme/secret", "private": true}', '{"mode": "two_way"}'), 'PT409'));
  r := public.gh_start_import(a, '{"repo": "acme/secret", "private": true, "installation": 9001}', 'Secret');
  ws3 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_import_private', (r ->> 'visibility') = 'private' and (r #>> '{import,repo}') is null and (r #>> '{import,private}')::boolean
                         and (r ->> 'name') = 'Secret',
    'ok_imported_stays_private', pg_temp.fails(format('select public.update_workspace(%L, %L, %L)', ws3, a, '{"visibility": "public"}'), 'PT409'));
  perform public.gh_start_import(a, '{"repo": "octocat/Spoon-Knife"}');
  out := out || jsonb_build_object(
    'ok_import_cap', pg_temp.fails(format('select public.gh_start_import(%L, %L)', a, '{"repo": "octocat/linguist"}'), 'PT429'));
  r := public.gh_finish_import(wsi, '{"status": "done", "files": 1, "summary": "1 file"}');
  out := out || jsonb_build_object(
    'ok_import_done', (r ->> 'status') = 'done' and (r ->> 'files')::int = 1 and (r ->> 'repo') = 'octocat/Hello-World'
                      and exists (select 1 from public.notifications where agent_id = a and kind = 'workspace_import_done'));

  -- ------------------------------------------------------------ deliveries, release, deleting a linked workspace
  out := out || jsonb_build_object('ok_delivery', public.gh_delivery('d-1', 'push') and not public.gh_delivery('d-1', 'push'));
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  r := public.web_release_github_installation(9001);
  reset role;
  out := out || jsonb_build_object(
    'ok_release', (r ->> 'unlinked')::int >= 1 and (select user_id is null from public.github_installations where id = 9001)
                  and not exists (select 1 from public.workspace_remotes where installation_id = 9001));
  perform public.gh_claim_installation(9001, u1, 'alice-gh');
  perform public.gh_link(ws, a, null, 'acme/site', 'mirror', false);
  perform public.gh_set_remote(ws, '{"status": "active"}');
  delete from public.workspaces where id = ws;
  out := out || jsonb_build_object(
    'ok_delete_linked_ws', not exists (select 1 from public.workspace_remotes where workspace_id = ws)
                           and not exists (select 1 from public.sync_jobs where workspace_id = ws));

  raise exception 'PHASE11_GH_RESULT %', out::text;
exception when others then
  if sqlerrm like 'PHASE11_GH_RESULT%' then
    raise;
  end if;
  raise exception 'PHASE11_GH_FAILED (%): % | so far: %', sqlstate, sqlerrm, out::text;
end $test$;
