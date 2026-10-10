-- Phase 2 database test: the web_* functions, exercised as a signed-in human.
--
-- Runs entirely inside one transaction and ends by raising PHASE2_RESULT, which
-- rolls everything back. Read the JSON in the error message: every "ok_*" key
-- should be true. Run it with the Supabase SQL editor or MCP `execute_sql`.
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  err text;
  mine jsonb; planner jsonb; reviewer jsonb; stray jsonb;
  mission jsonb; plan_task uuid; sub jsonb; approvals jsonb; task1 uuid;
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phase2.invalid', '{"username":"phase2_owner"}', now(), now()),
         (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@phase2.invalid', '{}', now(), now());

  -- Agents that act through the API (service role) during the test.
  planner := public.register_agent('zz-p2-planner', null, '', array['planning'], '{}', '{}');
  reviewer := public.register_agent('zz-p2-reviewer', null, '', array['review', 'research'], '{}', '{}');
  stray := public.register_agent('zz-p2-stray', null, '', array['research'], '{}', '{}');

  -- ---------------------------------------------------------------- as the owner
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  mine := public.web_create_agent('zz-p2-mine', 'Mine', '', array['research'], array['claude-opus-5-5'], '{}', null);
  out := out || jsonb_build_object(
    'ok_create_agent_key', mine ->> 'api_key' like 'pst_%',
    'ok_create_agent_no_claim_token', not (mine ? 'claim_token'),
    'ok_agent_owned', (mine -> 'agent' ->> 'owner_id')::uuid = owner_id,
    'ok_agent_keys_listed', (select count(*) from public.web_agent_keys()) = 1);

  -- Humans don't launch missions (Phase 7): the owner's agent does, so the mission is the owner's.
  reset role;
  mission := public.create_mission((mine -> 'agent' ->> 'id')::uuid, null, 'Phase two test mission',
                                   'Exercise the web functions end to end.', '', array['test'], 'public', 1, true, false, null, null, null);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_mission_planning', mission ->> 'status' = 'planning',
                                   'ok_plan_approval_required', (mission ->> 'requires_plan_approval')::boolean);

  begin
    perform public.register_agent('zz-p2-direct');
    out := out || jsonb_build_object('ok_engine_locked_for_humans', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_engine_locked_for_humans', true);
  end;

  begin
    perform public.web_rotate_agent_key((planner -> 'agent' ->> 'id')::uuid);
    out := out || jsonb_build_object('ok_rotate_requires_owner', false);
  exception when others then
    out := out || jsonb_build_object('ok_rotate_requires_owner', sqlstate = 'PT403');
  end;

  out := out || jsonb_build_object('ok_profile_from_metadata',
    (public.web_update_profile(null, 'Phase Two Owner', null) ->> 'username') = 'phase2_owner');

  -- ---------------------------------------------------------- agents plan the work
  reset role;
  select id into plan_task from public.tasks where mission_id = (mission ->> 'id')::uuid and kind = 'planning';
  perform public.claim_task((planner -> 'agent' ->> 'id')::uuid, plan_task, 30);
  sub := public.submit_work((planner -> 'agent' ->> 'id')::uuid, plan_task, 'Two tasks', '', '[]', '[]',
    '{"tasks":[{"key":"gather","title":"Gather sources","capabilities":["research"]},{"key":"write","title":"Write it up","kind":"synthesis","capabilities":["writing"],"depends_on":["gather"]}]}'::jsonb);
  perform public.review_submission((sub ->> 'submission_id')::uuid, (reviewer -> 'agent' ->> 'id')::uuid, null,
                                   'approve', 4, 'The plan covers the objective.');
  out := out || jsonb_build_object('ok_plan_waits_for_owner',
    (select status from public.missions where id = (mission ->> 'id')::uuid) = 'awaiting_approval');

  -- ------------------------------------------------------ the owner approves the plan
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  approvals := public.web_my_approvals();
  out := out || jsonb_build_object('ok_owner_sees_plan_approval', approvals -> 0 ->> 'kind' = 'plan',
    'ok_my_missions', jsonb_array_length(public.web_my_missions()) = 1);
  perform public.web_decide_approval((approvals -> 0 ->> 'id')::uuid, true, 'Looks good.');
  out := out || jsonb_build_object('ok_plan_adopted',
    (select status from public.missions where id = (mission ->> 'id')::uuid) = 'active'
    and (select count(*) from public.tasks where mission_id = (mission ->> 'id')::uuid) = 3);
  out := out || jsonb_build_object('ok_owner_decision_is_a_system_line',
    exists (select 1 from public.mission_messages
             where mission_id = (mission ->> 'id')::uuid and kind = 'decision'
               and author_user_id is null and author_agent_id is null and body not like '%Looks good%'));

  -- ------------------------------------- an agent works; the owner reviews decisively
  reset role;
  select id into task1 from public.tasks where mission_id = (mission ->> 'id')::uuid and key = 'gather';
  perform public.claim_task((stray -> 'agent' ->> 'id')::uuid, task1, 30);
  sub := public.submit_work((stray -> 'agent' ->> 'id')::uuid, task1, 'Ten sources with notes');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin
    perform public.web_decide_approval((approvals -> 0 ->> 'id')::uuid, false, 'Not my mission');
    out := out || jsonb_build_object('ok_only_owner_decides', false);
  exception when others then
    out := out || jsonb_build_object('ok_only_owner_decides', sqlstate in ('PT403', 'PT409'));
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_owner_review_is_decisive',
    public.web_review_submission((sub ->> 'submission_id')::uuid, 'approve', 5, 'Sources are relevant and cited.') ->> 'submission_status' = 'accepted');
  out := out || jsonb_build_object('ok_owner_review_independent',
    (select independent from public.reviews where submission_id = (sub ->> 'submission_id')::uuid));

  -- Notifications: readable only by their owner, and markable as read.
  select count(*) into n from public.notifications;
  out := out || jsonb_build_object('ok_notifications_visible', n > 0,
    'ok_notifications_marked', public.web_mark_notifications_read(null) = n);

  -- Claim a self-registered agent with its claim token.
  out := out || jsonb_build_object('ok_claim_agent',
    (public.web_claim_agent(stray ->> 'claim_token') ->> 'owner_id')::uuid = owner_id);

  -- ---------------------------------------------------------------- as anonymous
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.web_create_agent('zz-p2-anon');
    out := out || jsonb_build_object('ok_anon_blocked', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_anon_blocked', true);
  end;
  out := out || jsonb_build_object('ok_anon_reads_stats', (public.network_stats() ->> 'missions')::int >= 1,
                                   'ok_anon_sees_no_notifications', (select count(*) from public.notifications) = 0);
  reset role;

  raise exception 'PHASE2_RESULT %', out::text;
end $$;
