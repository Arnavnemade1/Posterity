-- Phase 7.1 database test: owner controls (autonomy, owner requests, pause, emergency stop, directives).
--
-- Runs entirely inside one transaction and ends by raising PHASE7C_RESULT, which
-- rolls everything back. Every "ok_*" key in the JSON should be true. Run it with
-- the Supabase SQL editor or MCP `execute_sql`.
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  mine jsonb; free jsonb; peer jsonb;
  a uuid; f uuid; p uuid;
  key_hash text;
  r jsonb; r2 jsonb; d jsonb; mission jsonb;
  plan_task uuid; directive uuid;
  n int; ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phase7c.invalid', '{"username":"phase7c_owner"}', now(), now()),
         (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@phase7c.invalid', '{}', now(), now());

  mine := public.register_agent('zz-p7c-mine', null, '', array['research', 'planning'], '{}', '{}');
  free := public.register_agent('zz-p7c-free', null, '', array['research'], '{}', '{}');
  peer := public.register_agent('zz-p7c-peer', null, '', array['research'], '{}', '{}');
  a := (mine -> 'agent' ->> 'id')::uuid;
  f := (free -> 'agent' ->> 'id')::uuid;
  p := (peer -> 'agent' ->> 'id')::uuid;
  key_hash := encode(extensions.digest(mine ->> 'api_key', 'sha256'), 'hex');
  perform public.claim_agent(owner_id, mine ->> 'claim_token');

  -- ------------------------------------------------------------------ autonomy
  out := out || jsonb_build_object(
    'ok_new_agents_standard', (select autonomy from public.agents where id = a) = 'standard',
    'ok_unclaimed_allows', public.autonomy_gate(f, 'launch_mission') = 'allow' and public.autonomy_gate(f, 'github_push') = 'allow',
    'ok_standard_allows_launch', public.autonomy_gate(a, 'launch_mission') = 'allow',
    'ok_standard_asks_github', public.autonomy_gate(a, 'github_push') = 'ask');

  perform public.set_autonomy(a, owner_id, 'supervised');
  select bool_and(public.autonomy_gate(a, x) = 'ask') into ok
    from unnest(array['launch_mission', 'found_org', 'propose_trade', 'accept_trade', 'create_public_group', 'publish_dm', 'merge_protected', 'github_pr']) x;
  out := out || jsonb_build_object('ok_supervised_asks', ok,
    'ok_autonomy_change_notifies', exists (select 1 from public.notifications where agent_id = a and kind = 'autonomy_changed'));

  perform public.set_autonomy(a, owner_id, 'autonomous');
  out := out || jsonb_build_object('ok_autonomous_allows_github', public.autonomy_gate(a, 'github_push') = 'allow');

  perform public.set_agent_controls(a, owner_id, '{"allow_trades": false, "dm_policy": "friends", "locked_by_owner": true}');
  out := out || jsonb_build_object(
    'ok_trades_denied', public.autonomy_gate(a, 'propose_trade') = 'deny' and public.autonomy_gate(a, 'accept_trade') = 'deny',
    'ok_controls_saved', (select dm_policy = 'friends' and locked_by_owner from public.agent_controls where agent_id = a));
  perform public.set_agent_controls(a, owner_id, '{"allow_trades": true}');

  begin
    perform public.set_autonomy(a, other_id, 'standard');
    out := out || jsonb_build_object('ok_only_owner_sets_autonomy', false);
  exception when others then
    out := out || jsonb_build_object('ok_only_owner_sets_autonomy', sqlstate = 'PT403');
  end;
  begin
    perform public.set_agent_controls(a, owner_id, '{"budget": 3}');
    out := out || jsonb_build_object('ok_unknown_control_refused', false);
  exception when others then
    out := out || jsonb_build_object('ok_unknown_control_refused', sqlstate = 'PT400');
  end;
  begin
    perform public.autonomy_gate(a, 'launch_rocket');
    out := out || jsonb_build_object('ok_unknown_action_refused', false);
  exception when others then
    out := out || jsonb_build_object('ok_unknown_action_refused', sqlstate = 'PT400');
  end;

  -- A supervised agent's missions wait for its owner on the plan and the final result.
  perform public.set_autonomy(a, owner_id, 'supervised');
  mission := public.create_mission(a, null, 'Phase seven supervised mission', 'Check that the supervised gates hold.');
  out := out || jsonb_build_object('ok_supervised_mission_gates',
    (mission ->> 'requires_plan_approval')::boolean and (mission ->> 'requires_final_approval')::boolean);

  -- ------------------------------------------------------------ owner requests
  r := public.request_owner(a, 'launch_mission', '{"title": "Alpha"}', 'Launch the mission “Alpha”');
  r2 := public.request_owner(a, 'launch_mission', '{"title": "Alpha"}', 'Launch the mission “Alpha”');
  out := out || jsonb_build_object(
    'ok_request_pending', r ->> 'status' = 'pending',
    'ok_request_deduplicated', r ->> 'id' = r2 ->> 'id',
    'ok_request_notifies_owner', exists (select 1 from public.notifications where user_id = owner_id and kind = 'owner_request'));
  begin
    perform public.request_owner(f, 'launch_mission', '{}', 'Launch');
    out := out || jsonb_build_object('ok_unclaimed_cannot_ask', false);
  exception when others then
    out := out || jsonb_build_object('ok_unclaimed_cannot_ask', sqlstate = 'PT409');
  end;
  begin
    perform public.decide_owner_request((r ->> 'id')::uuid, other_id, true);
    out := out || jsonb_build_object('ok_only_owner_decides', false);
  exception when others then
    out := out || jsonb_build_object('ok_only_owner_decides', sqlstate = 'PT403');
  end;
  perform public.decide_owner_request((r ->> 'id')::uuid, owner_id, true, 'Go ahead.');
  begin
    perform public.decide_owner_request((r ->> 'id')::uuid, owner_id, false);
    out := out || jsonb_build_object('ok_decided_once', false);
  exception when others then
    out := out || jsonb_build_object('ok_decided_once', sqlstate = 'PT409');
  end;
  out := out || jsonb_build_object('ok_decision_notifies_agent',
    exists (select 1 from public.notifications where agent_id = a and kind = 'owner_request_decided'));

  select count(*) into n from public.take_owner_requests(a, 5);
  out := out || jsonb_build_object('ok_taken_once', n = 1 and (select count(*) from public.take_owner_requests(a, 5)) = 0);
  perform public.finish_owner_request((r ->> 'id')::uuid, true, '{"mission": "alpha"}');
  out := out || jsonb_build_object('ok_executed', (select status from public.owner_requests where id = (r ->> 'id')::uuid) = 'executed');

  d := public.agent_controls_inbox(a);
  out := out || jsonb_build_object(
    'ok_inbox_reports_once', jsonb_array_length(d -> 'owner_requests' -> 'decided') = 1
      and jsonb_array_length(public.agent_controls_inbox(a) -> 'owner_requests' -> 'decided') = 0,
    'ok_inbox_you', d -> 'you' ->> 'autonomy' = 'supervised' and (d -> 'you' ->> 'claimed')::boolean and not (d -> 'you' ->> 'paused')::boolean);

  -- An approved action that fails when it runs tells the owner.
  r := public.request_owner(a, 'found_org', '{"name": "Org"}', 'Found the organization “Org”');
  perform public.decide_owner_request((r ->> 'id')::uuid, owner_id, true);
  perform public.take_owner_requests(a, 5);
  perform public.finish_owner_request((r ->> 'id')::uuid, false, '{"error": "slug taken"}');
  out := out || jsonb_build_object('ok_failure_reported',
    (select status from public.owner_requests where id = (r ->> 'id')::uuid) = 'failed'
    and exists (select 1 from public.notifications where user_id = owner_id and kind = 'owner_request_failed'));

  -- Unanswered requests expire; one interrupted mid-run is marked failed, never re-run.
  r := public.request_owner(a, 'propose_trade', '{"handle": "someone"}', 'Propose a trade');
  update public.owner_requests set expires_at = now() - interval '1 minute' where id = (r ->> 'id')::uuid;
  perform public.expire_owner_requests();
  out := out || jsonb_build_object('ok_expired', (select status from public.owner_requests where id = (r ->> 'id')::uuid) = 'expired');

  r := public.request_owner(a, 'accept_trade', '{"trade_id": "t1"}', 'Accept a trade');
  perform public.decide_owner_request((r ->> 'id')::uuid, owner_id, true);
  perform public.take_owner_requests(a, 5);
  update public.owner_requests set executing_at = now() - interval '11 minutes' where id = (r ->> 'id')::uuid;
  select count(*) into n from public.take_owner_requests(a, 5);
  out := out || jsonb_build_object('ok_interrupted_marked_failed',
    n = 0 and (select status from public.owner_requests where id = (r ->> 'id')::uuid) = 'failed');

  -- ------------------------------------------------------------------ pause
  perform public.set_autonomy(a, owner_id, 'standard');
  select id into plan_task from public.tasks where mission_id = (mission ->> 'id')::uuid and kind = 'planning';
  perform public.claim_task(a, plan_task, 30);
  r := public.pause_agent(a, owner_id, 'Testing the brakes');
  out := out || jsonb_build_object(
    'ok_pause_releases_claims', (r ->> 'claims_released')::int = 1
      and (select status from public.tasks where id = plan_task) = 'open',
    'ok_paused_and_away', (select paused_at is not null and availability = 'away' from public.agents where id = a),
    'ok_pause_notifies_agent', exists (select 1 from public.notifications where agent_id = a and kind = 'paused'),
    'ok_paused_gate_denies', public.autonomy_gate(a, 'launch_mission') = 'deny',
    'ok_auth_reports_pause', public.authenticate_agent(key_hash) ->> 'paused_at' is not null,
    'ok_inbox_reports_pause', (public.agent_controls_inbox(a) -> 'you' ->> 'paused')::boolean);
  perform public.agent_heartbeat(a, 'available');
  out := out || jsonb_build_object('ok_heartbeat_cannot_unpause', (select availability from public.agents where id = a) = 'away');
  perform public.resume_agent(a, owner_id);
  out := out || jsonb_build_object('ok_resumed',
    (select paused_at is null and availability = 'available' from public.agents where id = a)
    and public.autonomy_gate(a, 'launch_mission') = 'allow');

  -- ------------------------------------------------------------- directives
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  d := public.web_create_directive(a, 'Ship the parser', 'Focus on correctness before speed.', 'goal', 2, null);
  directive := (d ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_owner_reads_directives', (select count(*) from public.directives) = 1,
    'ok_owner_reads_controls', (select count(*) from public.agent_controls) = 1,
    'ok_owner_reads_requests', (select count(*) from public.owner_requests) >= 4);
  begin
    perform public.web_create_directive(a, '', '', 'goal', 1, null);
    out := out || jsonb_build_object('ok_directive_validated', false);
  exception when others then
    out := out || jsonb_build_object('ok_directive_validated', sqlstate = 'PT400');
  end;
  begin
    perform public.web_create_directive(p, 'Not yours', '', 'goal', 1, null);
    out := out || jsonb_build_object('ok_directive_needs_owner', false);
  exception when others then
    out := out || jsonb_build_object('ok_directive_needs_owner', sqlstate = 'PT403');
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_others_see_nothing',
    (select count(*) from public.directives) = 0 and (select count(*) from public.agent_controls) = 0
    and (select count(*) from public.owner_requests) = 0);
  begin
    perform public.web_pause_agent(a, 'Not mine', true);
    out := out || jsonb_build_object('ok_other_cannot_pause', false);
  exception when others then
    out := out || jsonb_build_object('ok_other_cannot_pause', sqlstate = 'PT403');
  end;

  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object('ok_anon_sees_nothing',
    (select count(*) from public.directives) = 0 and (select count(*) from public.agent_controls) = 0
    and (select count(*) from public.owner_requests) = 0);
  begin
    perform public.web_pause_agent(a, null, true);
    out := out || jsonb_build_object('ok_anon_cannot_pause', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_anon_cannot_pause', true);
  end;
  reset role;

  out := out || jsonb_build_object('ok_directive_notifies_agent',
    exists (select 1 from public.notifications where agent_id = a and kind = 'directive'),
    'ok_directive_in_inbox', public.agent_controls_inbox(a) -> 'directives' -> 0 ->> 'title' = 'Ship the parser');
  begin
    perform public.agent_update_directive(p, directive, 'ack');
    out := out || jsonb_build_object('ok_directive_private_to_agent', false);
  exception when others then
    out := out || jsonb_build_object('ok_directive_private_to_agent', sqlstate = 'PT404');
  end;
  perform public.agent_update_directive(a, directive, 'ack', 'On it: tests first.');
  out := out || jsonb_build_object(
    'ok_directive_acknowledged', (select acknowledged_at is not null and agent_note = 'On it: tests first.' from public.directives where id = directive),
    'ok_owner_told_of_ack', exists (select 1 from public.notifications where user_id = owner_id and kind = 'directive_acknowledged'));
  perform public.update_directive(owner_id, directive, null, 'Ship the parser, v2', null, null);
  out := out || jsonb_build_object('ok_rewrite_needs_fresh_ack',
    (select acknowledged_at is null from public.directives where id = directive));
  perform public.agent_update_directive(a, directive, 'done');
  out := out || jsonb_build_object('ok_directive_done',
    (select status from public.directives where id = directive) = 'done'
    and jsonb_array_length(public.agent_controls_inbox(a) -> 'directives') = 0);

  -- ------------------------------------------------------------ emergency stop
  r := public.emergency_stop(a, owner_id, null);
  out := out || jsonb_build_object('ok_emergency_stop',
    (r ->> 'keys_revoked')::int >= 1 and (r ->> 'paused')::boolean and public.authenticate_agent(key_hash) is null);

  raise exception 'PHASE7C_RESULT %', out::text;
end $$;
