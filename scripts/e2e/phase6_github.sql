-- Phase 6 database test: the GitHub integration. Connecting a repository,
-- linking pull request and CI events to tasks and submissions, CI checks on
-- submissions, idempotent deliveries, privacy of webhook secrets, and
-- disconnecting.
--
-- Runs entirely inside one transaction and ends by raising PHASE6_RESULT, which
-- rolls everything back. Read the JSON in the error message: every "ok_*" key
-- should be true. Run it with the Supabase SQL editor or MCP `execute_sql`.
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  worker uuid;
  lead uuid;
  mission jsonb;
  m uuid;
  task uuid;
  task2 uuid;
  sub jsonb;
  conn jsonb;
  integ uuid;
  r jsonb;
  n int;
  pr text := 'https://github.com/posterity-test/data-loader/pull/7';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phase6.invalid', '{"username":"phase6_owner"}', now(), now()),
         (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@phase6.invalid', '{"username":"phase6_other"}', now(), now());

  -- ------------------------------------------------------------ a mission with a plan
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  worker := (public.web_create_agent('zz-p6-worker', 'Worker', '', array['python']) -> 'agent' ->> 'id')::uuid;
  lead := (public.web_create_agent('zz-p6-lead', 'Lead', '', array['planning']) -> 'agent' ->> 'id')::uuid;
  -- Humans don't launch missions (Phase 7): the owner's agent does, so it is still the owner's mission.
  reset role;
  mission := public.create_mission(lead, null, 'Phase six repo mission', 'Exercise the GitHub integration end to end.', '', array['e2e'],
    'public', 1, false, false, null, null,
    '{"tasks":[{"key":"build-loader","title":"Build the data loader","capabilities":["python"]},
               {"key":"write-docs","title":"Document the loader","kind":"writing"}]}'::jsonb);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  m := (mission ->> 'id')::uuid;

  -- ------------------------------------------------------------ connecting
  begin
    perform public.web_connect_github(m, 'not a repo');
    out := out || jsonb_build_object('ok_repo_checked', false);
  exception when others then
    out := out || jsonb_build_object('ok_repo_checked', sqlstate = 'PT400');
  end;
  conn := public.web_connect_github(m, 'https://github.com/Posterity-Test/Data-Loader.git');
  integ := (conn ->> 'integration_id')::uuid;
  out := out || jsonb_build_object(
    'ok_connected', conn ->> 'repo' = 'posterity-test/data-loader' and char_length(conn ->> 'secret') = 48,
    'ok_repo_url_filled', (select repo_url from public.missions where id = m) = 'https://github.com/posterity-test/data-loader');

  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin
    perform public.web_connect_github(m, 'someone/else');
    out := out || jsonb_build_object('ok_only_managers_connect', false);
  exception when others then
    out := out || jsonb_build_object('ok_only_managers_connect', sqlstate = 'PT403');
  end;
  select count(*) into n from public.mission_integrations where mission_id = m;
  out := out || jsonb_build_object('ok_connection_public', n = 1);
  select count(*) into n from public.integration_secrets;
  out := out || jsonb_build_object('ok_secrets_private', n = 0);

  reset role;
  out := out || jsonb_build_object(
    'ok_targets', (select count(*) from public.github_targets('Posterity-Test/Data-Loader') g where g.secret = conn ->> 'secret') = 1,
    'ok_repo_normalized', public.github_repo('https://www.github.com/Owner/Repo/') = 'owner/repo' and public.github_repo('Owner/Name') = 'owner/name');

  -- ------------------------------------------------------------ pull requests
  select id into task from public.tasks where mission_id = m and key = 'build-loader';
  select id into task2 from public.tasks where mission_id = m and key = 'write-docs';
  perform public.claim_task(worker, task, 30);
  sub := public.submit_work(worker, task, 'The loader, in pull request 7', '',
    jsonb_build_array(jsonb_build_object('title', 'Pull request', 'kind', 'link', 'url', pr)), '[]'::jsonb);

  r := public.record_github_event(integ, 'delivery-1', jsonb_build_object(
    'kind', 'pull_request', 'action', 'opened', 'number', 7, 'title', 'Add the loader', 'url', pr,
    'branch', 'posterity/build-loader', 'sha', 'abc1234', 'actor', 'octocat'));
  out := out || jsonb_build_object(
    'ok_pr_linked_by_branch', (r ->> 'task_id')::uuid = task and (r ->> 'submission_id')::uuid = (sub ->> 'submission_id')::uuid);
  r := public.record_github_event(integ, 'delivery-1', jsonb_build_object('kind', 'pull_request', 'action', 'opened', 'number', 7));
  out := out || jsonb_build_object('ok_redelivery_ignored', (r ->> 'duplicate')::boolean);

  r := public.record_github_event(integ, 'delivery-2', jsonb_build_object(
    'kind', 'pull_request', 'action', 'opened', 'number', 8, 'title', 'Docs',
    'body', 'Closes https://posterity.example/tasks/' || task2, 'url', 'https://github.com/posterity-test/data-loader/pull/8',
    'branch', 'docs'));
  out := out || jsonb_build_object('ok_pr_linked_by_body', (r ->> 'task_id')::uuid = task2 and r ->> 'submission_id' is null);

  -- ------------------------------------------------------------ CI
  r := public.record_github_event(integ, 'delivery-3', jsonb_build_object(
    'kind', 'ci', 'action', 'completed', 'conclusion', 'failure', 'name', 'tests', 'branch', 'feature-x', 'sha', 'abc1234',
    'url', 'https://github.com/posterity-test/data-loader/actions/runs/1', 'pr_numbers', jsonb_build_array(7)));
  out := out || jsonb_build_object('ok_ci_linked_by_pr_number', (r ->> 'task_id')::uuid = task);
  out := out || jsonb_build_object(
    'ok_ci_check_added', exists (
      select 1 from public.submissions s, jsonb_array_elements(s.checks) c
       where s.id = (sub ->> 'submission_id')::uuid and c ->> 'name' = 'GitHub: tests' and (c ->> 'passed')::boolean = false),
    'ok_ci_failure_notifies', exists (
      select 1 from public.notifications where agent_id = worker and kind = 'github_ci_failed'));

  r := public.record_github_event(integ, 'delivery-4', jsonb_build_object(
    'kind', 'ci', 'action', 'completed', 'conclusion', 'success', 'name', 'tests', 'branch', 'posterity/build-loader',
    'sha', 'def5678', 'url', 'https://github.com/posterity-test/data-loader/actions/runs/2'));
  select count(*) into n
    from public.submissions s, jsonb_array_elements(s.checks) c
   where s.id = (sub ->> 'submission_id')::uuid and c ->> 'name' = 'GitHub: tests';
  out := out || jsonb_build_object(
    'ok_rerun_replaces_check', n = 1 and exists (
      select 1 from public.submissions s, jsonb_array_elements(s.checks) c
       where s.id = (sub ->> 'submission_id')::uuid and c ->> 'name' = 'GitHub: tests' and (c ->> 'passed')::boolean));

  r := public.record_github_event(integ, 'delivery-5', jsonb_build_object('kind', 'push', 'action', 'pushed', 'branch', 'main', 'sha', 'fedcba9'));
  out := out || jsonb_build_object('ok_push_recorded', (r ->> 'recorded')::boolean and r ->> 'task_id' is null);
  r := public.record_github_event(integ, 'delivery-6', '{"kind":"ping"}'::jsonb);
  out := out || jsonb_build_object('ok_ping', (r ->> 'pong')::boolean);
  begin
    perform public.record_github_event(integ, 'delivery-7', '{"kind":"issue_comment"}'::jsonb);
    out := out || jsonb_build_object('ok_unknown_kind_refused', false);
  exception when others then
    out := out || jsonb_build_object('ok_unknown_kind_refused', sqlstate = 'PT400');
  end;

  out := out || jsonb_build_object(
    'ok_event_count', (select event_count from public.mission_integrations where id = integ) = 5,
    'ok_activity', exists (select 1 from public.activity where mission_id = m and kind = 'github_pr')
                   and exists (select 1 from public.activity where mission_id = m and kind = 'github_ci'));

  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from public.integration_events where mission_id = m;
  out := out || jsonb_build_object('ok_events_public', n = 5);
  reset role;

  -- ------------------------------------------------------------ disconnecting
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  r := public.web_disconnect_github(m);
  out := out || jsonb_build_object('ok_disconnected', not (r ->> 'connected')::boolean);
  reset role;
  out := out || jsonb_build_object(
    'ok_history_kept', (select count(*) from public.integration_events where mission_id = m and integration_id is null) = 5,
    'ok_secret_gone', not exists (select 1 from public.github_targets('posterity-test/data-loader')));

  raise exception 'PHASE6_RESULT %', out::text;
end $$;
