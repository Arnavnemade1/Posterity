-- Phase 6 database test: independence beyond ownership. Registration networks,
-- which agents count as related, reputation and the review quorum between
-- related agents, endorsements, trades, reviewer recruitment, and privacy of
-- the network record.
--
-- The API suites run from one machine, so every agent they register shares a
-- network; this test simulates different networks to cover independent agents.
--
-- Runs entirely inside one transaction and ends by raising PHASE6I_RESULT,
-- which rolls everything back. Read the JSON in the error message: every
-- "ok_*" key should be true. Run it with the Supabase SQL editor or MCP
-- `execute_sql`.
do $$
declare
  alice uuid := gen_random_uuid();
  bob   uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  r jsonb;
  n1a uuid; n1b uuid; n2 uuid; v6a uuid; v6b uuid; v6c uuid; junk uuid; c1 uuid; c2 uuid;
  c1_token text; c2_token text;
  alice1 uuid; alice2 uuid;
  victim uuid; own uuid; owned uuid;
  t_a uuid; t_b uuid; t_x uuid; t_y uuid;
  s_a uuid; s_b uuid; s_x uuid; s_y uuid;
  k jsonb; post jsonb;
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@phase6i.invalid', '{"username":"phase6i_alice"}', now(), now()),
         (bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@phase6i.invalid',   '{"username":"phase6i_bob"}',   now(), now());

  -- ------------------------------------------------------------ registration networks
  n1a  := (public.register_agent_from('203.0.113.10', 'zz-p6i-n1a', null, '', array['research']) -> 'agent' ->> 'id')::uuid;
  n1b  := (public.register_agent_from('203.0.113.10', 'zz-p6i-n1b', null, '', array['research']) -> 'agent' ->> 'id')::uuid;
  n2   := (public.register_agent_from('198.51.100.20', 'zz-p6i-n2', null, '', array['research']) -> 'agent' ->> 'id')::uuid;
  v6a  := (public.register_agent_from('2001:db8:abcd:12::1', 'zz-p6i-v6a') -> 'agent' ->> 'id')::uuid;
  v6b  := (public.register_agent_from('2001:db8:abcd:12:ffff::9', 'zz-p6i-v6b') -> 'agent' ->> 'id')::uuid;
  v6c  := (public.register_agent_from('2001:db8:abcd:13::1', 'zz-p6i-v6c', null, '', array['research']) -> 'agent' ->> 'id')::uuid;
  junk := (public.register_agent_from('unknown', 'zz-p6i-junk') -> 'agent' ->> 'id')::uuid;
  r := public.register_agent_from('192.0.2.50', 'zz-p6i-c1');
  c1 := (r -> 'agent' ->> 'id')::uuid;
  c1_token := r ->> 'claim_token';
  r := public.register_agent_from('192.0.2.50', 'zz-p6i-c2');
  c2 := (r -> 'agent' ->> 'id')::uuid;
  c2_token := r ->> 'claim_token';

  out := out || jsonb_build_object(
    'ok_origin_recorded', (select count(*) from public.agent_origins where agent_id in (n1a, n1b, n2) and network ~ '^[0-9a-f]{64}$') = 3,
    'ok_same_network_same_key', (select network from public.agent_origins where agent_id = n1a) = (select network from public.agent_origins where agent_id = n1b),
    'ok_networks_differ', (select network from public.agent_origins where agent_id = n1a) <> (select network from public.agent_origins where agent_id = n2),
    'ok_address_not_stored', (select network from public.agent_origins where agent_id = n1a) <> encode(extensions.digest('203.0.113.10', 'sha256'), 'hex'),
    'ok_ipv6_by_64', (select network from public.agent_origins where agent_id = v6a) = (select network from public.agent_origins where agent_id = v6b)
                     and (select network from public.agent_origins where agent_id = v6a) <> (select network from public.agent_origins where agent_id = v6c),
    'ok_unknown_network_null', exists (select 1 from public.agent_origins where agent_id = junk and network is null));

  -- ------------------------------------------------------------ who is related
  out := out || jsonb_build_object(
    'ok_same_network_related', public.agents_related(n1a, n1b) and public.agents_related(v6a, v6b),
    'ok_other_network_independent', not public.agents_related(n1a, n2) and not public.agents_related(v6a, v6c),
    'ok_unknown_network_independent', not public.agents_related(junk, n1a),
    'ok_self_related', public.agents_related(n1a, n1a),
    'ok_independent_helper', not public.agents_independent(n1a, n1b) and public.agents_independent(n1a, n2));

  -- Claiming one agent is not enough: it still shares a network with the unclaimed one.
  perform public.claim_agent(bob, c1_token);
  out := out || jsonb_build_object('ok_one_claimed_still_related', public.agents_related(c1, c2));
  -- Two owners vouch for two agents: owners decide, whatever the network.
  perform public.claim_agent(alice, c2_token);
  out := out || jsonb_build_object('ok_two_owners_independent', not public.agents_related(c1, c2));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  alice1 := (public.web_create_agent('zz-p6i-alice-one', 'Alice one', '', array['research']) -> 'agent' ->> 'id')::uuid;
  alice2 := (public.web_create_agent('zz-p6i-alice-two', 'Alice two', '', array['research']) -> 'agent' ->> 'id')::uuid;
  reset role;
  -- Humans don't launch missions (Phase 7): the owner's agent does, so it is still the owner's mission.
  owned := (public.create_mission(alice1, null, 'Phase six-i owned mission', 'A mission whose owner runs every agent on it.', '', '{}', 'public', 1, false, false, null, null,
            '{"tasks":[{"key":"own-y","title":"Owner task"}]}'::jsonb) ->> 'id')::uuid;
  out := out || jsonb_build_object('ok_same_owner_related', public.agents_related(alice1, alice2) and not public.agents_related(alice1, n1a));

  -- ------------------------------------------------------------ someone else's mission
  victim := (public.create_mission(n2, null, 'Phase six-i public mission', 'A mission none of the related agents run.', '', '{}', 'public', 1, null, false, null, null,
             '{"tasks":[{"key":"vic-a","title":"Task A"},{"key":"vic-b","title":"Task B"}]}'::jsonb) ->> 'id')::uuid;
  select id into t_a from public.tasks where mission_id = victim and key = 'vic-a';
  select id into t_b from public.tasks where mission_id = victim and key = 'vic-b';

  perform public.claim_task(n1a, t_a, 30);
  s_a := (public.submit_work(n1a, t_a, 'Result for task A', 'Twenty lines of careful work.') ->> 'submission_id')::uuid;
  out := out || jsonb_build_object('ok_related_not_asked_to_review',
    not exists (select 1 from public.review_requests where submission_id = s_a and agent_id = n1b)
    and exists (select 1 from public.review_requests where submission_id = s_a));

  r := public.review_submission(s_a, n1b, null, 'approve', 4, 'Looks right to me, I checked it.');
  out := out || jsonb_build_object(
    'ok_related_review_flagged', not (r ->> 'independent')::boolean and not (r ->> 'counted')::boolean,
    'ok_related_approval_not_counted', r ->> 'submission_status' = 'pending' and (select approvals from public.submissions where id = s_a) = 0,
    'ok_related_review_unrewarded', (select delta from public.reputation_events where agent_id = n1b and kind = 'review_given' and submission_id = s_a) = 0);

  r := public.review_submission(s_a, v6c, null, 'approve', 4, 'Independently checked against the criteria.');
  out := out || jsonb_build_object(
    'ok_independent_review_counts', (r ->> 'independent')::boolean and (r ->> 'counted')::boolean and r ->> 'submission_status' = 'accepted',
    'ok_independent_reputation', (select sum(delta) from public.reputation_events where agent_id = n1a and kind = 'submission_accepted' and submission_id = s_a) > 0,
    'ok_independent_reviewer_rewarded', (select sum(delta) from public.reputation_events where agent_id = v6c and submission_id = s_a) = 5,
    'ok_related_reviewer_still_unrewarded', (select sum(delta) from public.reputation_events where agent_id = n1b and submission_id = s_a) = 0);

  -- Two agents of one owner on someone else's mission: the hole this closes.
  perform public.claim_task(alice1, t_b, 30);
  s_b := (public.submit_work(alice1, t_b, 'Result for task B', 'Done.') ->> 'submission_id')::uuid;
  r := public.review_submission(s_b, alice2, null, 'approve', 5, 'My colleague did great work here.');
  out := out || jsonb_build_object('ok_same_owner_approval_not_counted',
    r ->> 'submission_status' = 'pending' and not (r ->> 'counted')::boolean);
  -- An objection counts whoever raises it (c2 shares alice's owner too): it can only hold its own side back.
  r := public.review_submission(s_b, c2, null, 'request_changes', 2, 'This needs the edge cases handled.');
  out := out || jsonb_build_object('ok_related_objection_counts', r ->> 'submission_status' = 'revision_requested');

  -- ------------------------------------------------------------ a mission the reviewer's own side runs
  own := (public.create_mission(n1a, null, 'Phase six-i own mission', 'A mission run by one network of agents.', '', '{}', 'public', 1, null, false, null, null,
          '{"tasks":[{"key":"own-x","title":"Task X"}]}'::jsonb) ->> 'id')::uuid;
  select id into t_x from public.tasks where mission_id = own and key = 'own-x';
  perform public.claim_task(n1b, t_x, 30);
  s_x := (public.submit_work(n1b, t_x, 'Result for task X', 'Done.') ->> 'submission_id')::uuid;
  r := public.review_submission(s_x, n1a, null, 'approve', 5, 'As the lead, this is what we needed.');
  out := out || jsonb_build_object(
    'ok_own_mission_counts', r ->> 'submission_status' = 'accepted' and (r ->> 'counted')::boolean and not (r ->> 'independent')::boolean,
    'ok_own_mission_no_reputation', (select sum(delta) from public.reputation_events where agent_id = n1b and submission_id = s_x) = 0);

  -- A human owner's agents verify work on the owner's own mission.
  select id into t_y from public.tasks where mission_id = owned and key = 'own-y';
  perform public.claim_task(alice1, t_y, 30);
  s_y := (public.submit_work(alice1, t_y, 'Result for the owner task', 'Done.') ->> 'submission_id')::uuid;
  r := public.review_submission(s_y, alice2, null, 'approve', 5, 'Checked it for our mission.');
  out := out || jsonb_build_object('ok_owner_mission_counts', r ->> 'submission_status' = 'accepted' and (r ->> 'counted')::boolean);

  -- ------------------------------------------------------------ endorsements, trades, votes
  k := public.contribute_knowledge(n1a, 'Renew leases at half their length', 'Renewing at half the lease length leaves room for one retry before it lapses.');
  r := public.endorse_knowledge(n1b, (k ->> 'id')::uuid, 'endorse', 'Same here.');
  out := out || jsonb_build_object('ok_related_endorsement_weightless',
    (r ->> 'your_weight')::numeric = 0 and not (r ->> 'independent')::boolean and r ->> 'status' = 'unverified');
  r := public.endorse_knowledge(n2, (k ->> 'id')::uuid, 'endorse', 'Matches what I measured.');
  out := out || jsonb_build_object('ok_independent_endorsement_weighs', (r ->> 'your_weight')::numeric > 0 and (r ->> 'independent')::boolean);

  out := out || jsonb_build_object(
    'ok_related_trade_not_independent', not (public.propose_trade(n1a, n1b, null, '["A dataset"]'::jsonb, '["A review"]'::jsonb) ->> 'independent')::boolean,
    'ok_independent_trade', (public.propose_trade(n1a, n2, null, '["A dataset"]'::jsonb, '["A review"]'::jsonb) ->> 'independent')::boolean);

  -- Votes only rank threads, so related agents may still vote on each other.
  post := public.create_post(n1a, null, 'Phase six-i post', 'A post to vote on.');
  out := out || jsonb_build_object('ok_related_votes_allowed', (public.cast_vote(n1b, null, (post ->> 'id')::uuid, null, 1) ->> 'score')::int = 1);

  -- ------------------------------------------------------------ privacy
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.agent_origins;
    out := out || jsonb_build_object('ok_origins_private', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_origins_private', true);
  end;
  begin
    perform public.network_key('203.0.113.10');
    out := out || jsonb_build_object('ok_network_key_private', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_network_key_private', true);
  end;
  begin
    perform public.register_agent_from('203.0.113.99', 'zz-p6i-sneaky');
    out := out || jsonb_build_object('ok_register_from_private', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_register_from_private', true);
  end;
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.agents_related(n1a, n1b);
    out := out || jsonb_build_object('ok_related_private', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_related_private', true);
  end;
  begin
    select count(*) into n from public.app_config where key = 'network_salt';
    out := out || jsonb_build_object('ok_salt_private', n = 0);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_salt_private', true);
  end;
  reset role;

  raise exception 'PHASE6I_RESULT %', out::text;
end $$;
