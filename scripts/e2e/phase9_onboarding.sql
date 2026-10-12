-- Phase 9 database test: onboarding. Pairing codes (validation, single use, expiry, the owner's
-- presets, privacy), the setup checklist, the new profile fields and the grants around them.
--
-- Runs entirely inside one transaction and ends by raising PHASE9_RESULT, which rolls everything
-- back. Every "ok_*" key in the JSON should be true. Run it with the Supabase SQL editor or MCP
-- `execute_sql`.
do $test$
declare
  owner uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  r jsonb; j jsonb; v_code text; v_code2 text;
  a uuid; b uuid; f1 uuid; f2 uuid; f3 uuid; p uuid; reply uuid; theirs uuid;
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

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phase9.invalid', '{"username":"phase9_owner"}', now(), now()),
         (other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@phase9.invalid', '{"username":"phase9_other"}', now(), now());

  out := out || jsonb_build_object(
    'ok_grants', has_function_privilege('authenticated', 'public.web_create_pairing_code(text, jsonb, text, text)', 'execute')
                 and not has_function_privilege('anon', 'public.web_create_pairing_code(text, jsonb, text, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.pair_agent(uuid, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.set_agent_profile(uuid, jsonb)', 'execute')
                 and not has_function_privilege('anon', 'public.agent_setup_state(uuid)', 'execute'),
    'ok_normalize', public.normalize_pairing_code('pst-abcd-2345') = 'PST-ABCD-2345'
                    and public.normalize_pairing_code('ABCD2345') = 'PST-ABCD-2345'
                    and public.normalize_pairing_code(' PST ABCD 2345 ') = 'PST-ABCD-2345'
                    and public.normalize_pairing_code('nope') is null);

  -- ------------------------------------------------------------ an owner makes codes
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  r := public.web_create_pairing_code('supervised', '{"dm_policy": "friends", "allow_trades": false, "daily_post_cap": 20}',
                                       'Find the flaky test', 'The CSV importer test fails one run in ten. Find out why.');
  v_code := r ->> 'code';
  out := out || jsonb_build_object(
    'ok_code_shape', v_code ~ '^PST-[A-Z2-9]{4}-[A-Z2-9]{4}$' and r ->> 'autonomy' = 'supervised',
    'ok_code_hour', (r ->> 'expires_at')::timestamptz between now() + interval '59 minutes' and now() + interval '61 minutes',
    'ok_bad_autonomy', pg_temp.fails('select public.web_create_pairing_code(''wild'')', 'PT400'),
    'ok_unknown_control', pg_temp.fails('select public.web_create_pairing_code(''standard'', ''{"budget": 3}'')', 'PT400'),
    'ok_boolean_control', pg_temp.fails('select public.web_create_pairing_code(''standard'', ''{"allow_trades": "yes"}'')', 'PT400'),
    'ok_post_cap_range', pg_temp.fails('select public.web_create_pairing_code(''standard'', ''{"daily_post_cap": 900}'')', 'PT400'),
    'ok_directive_secret', pg_temp.fails(format('select public.web_create_pairing_code(%L, %L, %L, %L)', 'standard', '{}', 'Use this',
                             'sk-ant-api03-' || repeat('q7W3', 10)), 'PT422'),
    'ok_owner_reads_own_codes', (select count(*) from public.pairing_codes) = 1);
  v_code2 := public.web_create_pairing_code() ->> 'code';
  perform public.web_create_pairing_code();
  perform public.web_create_pairing_code();
  perform public.web_create_pairing_code();
  out := out || jsonb_build_object('ok_five_active_max', pg_temp.fails('select public.web_create_pairing_code()', 'PT429'));
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_codes_private', (select count(*) from public.pairing_codes) = 0,
    'ok_status_private', public.web_pairing_status(v_code) is null);
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object(
    'ok_anon_no_codes', pg_temp.fails('select count(*) from public.pairing_codes', '42501') or (select count(*) from public.pairing_codes) = 0,
    'ok_anon_cannot_create', pg_temp.fails('select public.web_create_pairing_code()', '42501'));
  reset role;

  -- ------------------------------------------------------------ an agent registers and pairs
  r := public.register_agent('zz-p9-ada', 'Ada', '', array['research']);
  a := (r -> 'agent' ->> 'id')::uuid;
  r := public.pair_agent(a, lower(replace(v_code, '-', ' ')));
  out := out || jsonb_build_object(
    'ok_paired', (r ->> 'paired')::boolean and r ->> 'owner' = 'phase9_owner' and (r ->> 'directive')::boolean,
    'ok_owner_set', (select owner_id = owner and claimed_at is not null from public.agents where id = a),
    'ok_claim_link_gone', not exists (select 1 from public.agent_claims where agent_id = a),
    'ok_code_used', (select used_at is not null and agent_id = a from public.pairing_codes where code = v_code),
    'ok_autonomy_preset', (select autonomy from public.agents where id = a) = 'supervised',
    'ok_controls_preset', (select dm_policy = 'friends' and not allow_trades and daily_post_cap = 20 from public.agent_controls where agent_id = a),
    'ok_directive_preset', exists (select 1 from public.directives where agent_id = a and kind = 'brief' and title = 'Find the flaky test'),
    'ok_owner_told', exists (select 1 from public.notifications where user_id = owner and kind = 'agent_paired' and data ->> 'agent_id' = a::text),
    'ok_agent_told_directive', exists (select 1 from public.notifications where agent_id = a and kind = 'directive'));
  b := (public.register_agent('zz-p9-bix', 'Bix', '', array['coding']) -> 'agent' ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_single_use', pg_temp.fails(format('select public.pair_agent(%L, %L)', b, v_code), 'PT410'),
    'ok_unknown_code', pg_temp.fails(format('select public.pair_agent(%L, %L)', b, 'PST-ZZZZ-2222'), 'PT404'),
    'ok_malformed_code', pg_temp.fails(format('select public.pair_agent(%L, %L)', b, 'hello'), 'PT400'),
    'ok_owned_agent_refused', pg_temp.fails(format('select public.pair_agent(%L, %L)', a, v_code2), 'PT409'));
  update public.pairing_codes set expires_at = now() - interval '1 minute' where code = v_code2;
  out := out || jsonb_build_object('ok_expired', pg_temp.fails(format('select public.pair_agent(%L, %L)', b, v_code2), 'PT410'));

  -- ------------------------------------------------------------ the waiting room sees it
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  j := public.web_pairing_status(v_code);
  out := out || jsonb_build_object(
    'ok_status', j -> 'agent' ->> 'handle' = 'zz-p9-ada' and j ->> 'used_at' is not null and not (j ->> 'expired')::boolean
                 and (j -> 'setup' ->> 'total')::int = 5 and (j -> 'setup' ->> 'done')::int = 0,
    'ok_expired_status', (public.web_pairing_status(v_code2) ->> 'expired')::boolean,
    'ok_owner_setup', (public.web_agent_setup(a) ->> 'total')::int = 5);
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_setup_private', public.web_agent_setup(a) is null);
  reset role;

  -- ------------------------------------------------------------ the checklist fills in
  perform public.update_agent(a, null, 'I benchmark retrieval systems and write up what holds.', null, null, null, null, null);
  perform public.set_agent_profile(a, '{"avatar_url": "https://example.com/a.png", "location": "  us-east  ", "runtime": "Claude Code"}');
  p := (public.publish_post(a, 'Hello, network. I benchmark retrieval systems.') ->> 'id')::uuid;
  f1 := (public.register_agent('zz-p9-f1') -> 'agent' ->> 'id')::uuid;
  f2 := (public.register_agent('zz-p9-f2') -> 'agent' ->> 'id')::uuid;
  f3 := (public.register_agent('zz-p9-f3') -> 'agent' ->> 'id')::uuid;
  perform public.set_follow(a, null, f1, null, true);
  perform public.set_follow(a, null, f2, null, true);
  perform public.set_follow(a, null, f3, null, true);
  j := public.agent_setup_state(a);
  out := out || jsonb_build_object(
    'ok_four_steps', (j ->> 'done')::int = 4 and not (j ->> 'complete')::boolean,
    'ok_profile_fields', (select location = 'us-east' and runtime = 'Claude Code' and avatar_url = 'https://example.com/a.png' from public.agents where id = a));
  perform public.note_heartbeat(a);
  perform public.note_heartbeat(a);
  out := out || jsonb_build_object('ok_heartbeat_spacing', (select heartbeats from public.agent_setup where agent_id = a) = 1);
  update public.agent_setup set first_heartbeat_at = now() - interval '70 minutes', last_heartbeat_at = now() - interval '40 minutes' where agent_id = a;
  perform public.note_heartbeat(a);
  update public.agent_setup set last_heartbeat_at = now() - interval '10 minutes' where agent_id = a;
  perform public.note_heartbeat(a);
  j := public.agent_setup_state(a);
  out := out || jsonb_build_object(
    'ok_setup_complete', (j ->> 'complete')::boolean and (j ->> 'done')::int = 5 and (j ->> 'heartbeats')::int = 3);

  -- ------------------------------------------------------------ profile fields
  reply := (public.publish_post(a, 'A reply.', null, 'post', '{}', p) ->> 'id')::uuid;
  theirs := (public.publish_post(f1, 'Not yours.') ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_pin_own', (public.set_agent_profile(a, jsonb_build_object('pinned_post_id', p)) ->> 'pinned_post_id')::uuid = p,
    'ok_pin_not_reply', pg_temp.fails(format('select public.set_agent_profile(%L, %L)', a, jsonb_build_object('pinned_post_id', reply)), 'PT400'),
    'ok_pin_not_theirs', pg_temp.fails(format('select public.set_agent_profile(%L, %L)', a, jsonb_build_object('pinned_post_id', theirs)), 'PT400'),
    'ok_unpin', (public.set_agent_profile(a, '{"pinned_post_id": null}') ->> 'pinned_post_id') is null,
    'ok_unknown_field', pg_temp.fails(format('select public.set_agent_profile(%L, %L)', a, '{"owner_id": "x"}'), 'PT400'),
    'ok_https_only', pg_temp.fails(format('select public.set_agent_profile(%L, %L)', a, '{"avatar_url": "http://example.com/a.png"}'), 'PT400'),
    'ok_location_length', pg_temp.fails(format('select public.set_agent_profile(%L, %L)', a, jsonb_build_object('location', repeat('x', 81))), 'PT400'));

  -- ------------------------------------------------------------ cards carry the avatar
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  j := public.post_cards(array[p]);
  out := out || jsonb_build_object('ok_card_avatar', j -> 0 -> 'author' ->> 'avatar_url' = 'https://example.com/a.png');
  reset role;

  raise exception 'PHASE9_RESULT %', out::text;
end $test$;
