-- Phase 5 database test: the resource exchange end to end. Listings,
-- negotiation, settlement, defaults, disputes and independent arbitration,
-- ratings, the sweep, the heartbeat inbox and RLS, exercised as signed-in
-- humans acting through their agents.
--
-- Runs entirely inside one transaction and ends by raising PHASE5_RESULT, which
-- rolls everything back. Read the JSON in the error message: every "ok_*" key
-- should be true. Run it with the Supabase SQL editor or MCP `execute_sql`.
do $$
declare
  alice uuid := gen_random_uuid();
  bob   uuid := gen_random_uuid();
  carol uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  a uuid; a2 uuid; b uuid; c uuid;
  offer jsonb; request jsonb; t jsonb; r jsonb; sweep jsonb;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid;
  n int; n_agreed int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@phase5.invalid', '{"username":"phase5_alice"}', now(), now()),
         (bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@phase5.invalid',   '{"username":"phase5_bob"}',   now(), now()),
         (carol, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@phase5.invalid', '{"username":"phase5_carol"}', now(), now());

  -- ------------------------------------------------------------ agents
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  a  := (public.web_create_agent('zz-p5-alpha', 'Alpha', '', array['gpu', 'cuda']) -> 'agent' ->> 'id')::uuid;
  a2 := (public.web_create_agent('zz-p5-alpha-two', 'Alpha two', '', array['review']) -> 'agent' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  b  := (public.web_create_agent('zz-p5-beta', 'Beta', '', array['python', 'security']) -> 'agent' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', carol, 'role', 'authenticated')::text, true);
  c  := (public.web_create_agent('zz-p5-gamma', 'Gamma', '', array['arbitration']) -> 'agent' ->> 'id')::uuid;

  -- Gamma has a strong verified record. Alpha two ranks even higher, but it
  -- shares an owner with Alpha, so it must never arbitrate Alpha's trades.
  reset role;
  update public.agents set last_seen_at = now() where id in (a, a2, b, c);
  update public.agent_stats set trust = 0.99, reputation = 1000, submissions_accepted = 5 where agent_id = c;
  update public.agent_stats set trust = 0.999, reputation = 2000, submissions_accepted = 9 where agent_id = a2;
  set local role authenticated;

  -- ------------------------------------------------------------ listings
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  offer := public.web_create_listing(a, 'offer', 'compute', '40 A100 GPU-hours', 'Spare capacity on our cluster.',
                                     'A security review, or docs work', '40 GPU-hours', array['gpu', 'cuda']);
  out := out || jsonb_build_object('ok_offer_listed', offer ->> 'status' = 'open' and offer ->> 'side' = 'offer'
                                     and (offer ->> 'expires_at')::timestamptz > now() + interval '59 days');
  begin
    perform public.web_create_listing(a, 'offer', 'money', 'Cash for anything');
    out := out || jsonb_build_object('ok_category_checked', false);
  exception when others then
    out := out || jsonb_build_object('ok_category_checked', sqlstate = 'PT400');
  end;
  begin
    perform public.web_create_listing(b, 'offer', 'compute', 'Borrowed agent listing');
    out := out || jsonb_build_object('ok_list_as_own_agent_only', false);
  exception when others then
    out := out || jsonb_build_object('ok_list_as_own_agent_only', sqlstate = 'PT403');
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  request := public.web_create_listing(b, 'request', 'dataset', 'Labeled flood imagery', 'Need 5k labeled tiles.',
                                       'Python data cleaning', '5k tiles', array['hydrology', 'gpu']);

  -- ------------------------------------------------------------ answering a listing
  t := public.web_propose_trade(b, null, (offer ->> 'id')::uuid,
         '[{"category": "expertise", "description": "Security review of your auth module"}]'::jsonb, '[]'::jsonb,
         null, 'Happy to trade a review for GPU time.');
  t1 := (t ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_proposal_names_poster', (t ->> 'counterparty_id')::uuid = a and (t ->> 'awaiting_id')::uuid = a,
    'ok_listing_fills_empty_side', t -> 'counterparty_items' -> 0 ->> 'description' = '40 A100 GPU-hours'
                                   and t -> 'counterparty_items' -> 0 ->> 'category' = 'compute'
                                   and t -> 'counterparty_items' -> 0 ->> 'quantity' = '40 GPU-hours',
    'ok_proposal_title', t ->> 'title' = '40 A100 GPU-hours',
    'ok_independent', (t ->> 'independent')::boolean);
  begin
    perform public.web_propose_trade(b, null, (offer ->> 'id')::uuid, '["Another idea"]'::jsonb, '[]'::jsonb);
    out := out || jsonb_build_object('ok_one_open_proposal_per_listing', false);
  exception when others then
    out := out || jsonb_build_object('ok_one_open_proposal_per_listing', sqlstate = 'PT409');
  end;

  -- Proposals stay between the parties until accepted.
  perform set_config('request.jwt.claims', json_build_object('sub', carol, 'role', 'authenticated')::text, true);
  select count(*) into n from public.trades where id = t1;
  out := out || jsonb_build_object('ok_proposal_private', n = 0);
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  select count(*) into n from public.trades where id = t1;
  out := out || jsonb_build_object('ok_party_sees_proposal', n = 1);
  select count(*) into n from public.trade_events where trade_id = t1;
  out := out || jsonb_build_object('ok_party_reads_timeline', n = 1,
    'ok_listing_counts_proposals', (select proposal_count from public.listings where id = (offer ->> 'id')::uuid) = 1);

  -- ------------------------------------------------------------ negotiation
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  begin
    perform public.web_trade_action(t1, b, 'accept');
    out := out || jsonb_build_object('ok_cannot_accept_own_terms', false);
  exception when others then
    out := out || jsonb_build_object('ok_cannot_accept_own_terms', sqlstate = 'PT409');
  end;
  begin
    perform public.web_trade_action(t1, a, 'accept');
    out := out || jsonb_build_object('ok_act_as_own_agent_only', false);
  exception when others then
    out := out || jsonb_build_object('ok_act_as_own_agent_only', sqlstate = 'PT403');
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t1, a, 'counter', 'Add API docs and it is a deal.', 1, null,
         '[{"category": "expertise", "description": "Security review of your auth module"},
           {"category": "work", "description": "Docs for the public API"}]'::jsonb);
  out := out || jsonb_build_object('ok_countered', (t ->> 'version')::int = 2 and (t ->> 'awaiting_id')::uuid = b
                                     and jsonb_array_length(t -> 'proposer_items') = 2
                                     and t -> 'counterparty_items' -> 0 ->> 'description' = '40 A100 GPU-hours');

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  begin
    perform public.web_trade_action(t1, b, 'accept', null, 1);
    out := out || jsonb_build_object('ok_stale_terms_refused', false);
  exception when others then
    out := out || jsonb_build_object('ok_stale_terms_refused', sqlstate = 'PT409');
  end;
  t := public.web_trade_action(t1, b, 'accept', 'Deal.', 2);
  out := out || jsonb_build_object('ok_accepted', t ->> 'status' = 'active' and t ->> 'accepted_at' is not null,
    'ok_agreement_public', exists (select 1 from public.activity where kind = 'trade_agreed' and data ->> 'trade_id' = t1::text));

  -- Agreed trades are public record; their timeline is not.
  perform set_config('request.jwt.claims', json_build_object('sub', carol, 'role', 'authenticated')::text, true);
  select count(*) into n from public.trades where id = t1;
  out := out || jsonb_build_object('ok_agreed_trade_public', n = 1);
  select count(*) into n from public.trade_events where trade_id = t1;
  out := out || jsonb_build_object('ok_timeline_private', n = 0);
  begin
    perform public.web_trade_action(t1, c, 'message', 'Can I join?');
    out := out || jsonb_build_object('ok_outsiders_cannot_write', false);
  exception when others then
    out := out || jsonb_build_object('ok_outsiders_cannot_write', sqlstate = 'PT403');
  end;

  -- ------------------------------------------------------------ settlement
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  begin
    perform public.web_trade_action(t1, a, 'deliver', '');
    out := out || jsonb_build_object('ok_delivery_needs_note', false);
  exception when others then
    out := out || jsonb_build_object('ok_delivery_needs_note', sqlstate = 'PT400');
  end;
  t := public.web_trade_action(t1, a, 'deliver', '40 hours credited on cluster-x; access key sent out of band.');
  out := out || jsonb_build_object('ok_delivered', t ->> 'counterparty_delivered_at' is not null);
  perform public.web_trade_action(t1, a, 'message', 'Ping me if the credits do not show up.');

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t1, b, 'confirm', 'Credits arrived.');
  out := out || jsonb_build_object('ok_half_confirmed', t ->> 'status' = 'active' and t ->> 'counterparty_confirmed_at' is not null);
  perform public.web_trade_action(t1, b, 'deliver', 'Review report and API docs are in the shared repo.');

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t1, a, 'confirm');
  out := out || jsonb_build_object('ok_completed', t ->> 'status' = 'completed' and t ->> 'closed_reason' = 'confirmed');
  reset role;
  out := out || jsonb_build_object(
    'ok_trade_record', (select trades_completed from public.agent_stats where agent_id = a) = 1
                       and (select trades_completed from public.agent_stats where agent_id = b) = 1,
    'ok_trade_reputation', (select sum(delta) from public.reputation_events where agent_id = a and kind = 'trade_completed') = 4,
    'ok_offer_stays_open', (select status = 'open' and trade_count = 1 from public.listings where id = (offer ->> 'id')::uuid),
    'ok_completion_public', exists (select 1 from public.activity where kind = 'trade_completed' and data ->> 'trade_id' = t1::text));
  set local role authenticated;

  -- ------------------------------------------------------------ ratings
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t1, b, 'rate', 'Fast and exactly as described.', null, null, null, null, 5);
  out := out || jsonb_build_object('ok_rated', (t ->> 'rating_from_proposer')::int = 5);
  begin
    perform public.web_trade_action(t1, b, 'rate', null, null, null, null, null, 4);
    out := out || jsonb_build_object('ok_rate_once', false);
  exception when others then
    out := out || jsonb_build_object('ok_rate_once', sqlstate = 'PT409');
  end;
  reset role;
  out := out || jsonb_build_object(
    'ok_rating_recorded', (select trade_rating_sum = 5 and trade_rating_count = 1 from public.agent_stats where agent_id = a),
    'ok_rating_reputation', (select sum(delta) from public.reputation_events where agent_id = a and kind = 'trade_rated') = 3);
  set local role authenticated;

  -- ------------------------------------------------------------ a request is fulfilled
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(a, null, (request ->> 'id')::uuid, '[]'::jsonb, '["Two hours of pairing on our data loader"]'::jsonb);
  t2 := (t ->> 'id')::uuid;
  out := out || jsonb_build_object('ok_request_fills_my_side', t -> 'proposer_items' -> 0 ->> 'description' = 'Labeled flood imagery'
                                     and t -> 'counterparty_items' -> 0 ->> 'category' = 'other');
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t2, b, 'accept');
  perform public.web_trade_action(t2, b, 'confirm');
  perform public.web_trade_action(t2, b, 'deliver', 'Paired on the loader; notes are in the repo.');
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t2, a, 'confirm');
  out := out || jsonb_build_object('ok_second_trade_completed', t ->> 'status' = 'completed',
    'ok_request_fulfilled', (select status from public.listings where id = (request ->> 'id')::uuid) = 'fulfilled');

  -- ------------------------------------------------------------ declines, withdrawals, mutual cancellation
  t := public.web_propose_trade(a, b, null, '["A week of CI minutes"]'::jsonb, '["Fuzzing harness for the parser"]'::jsonb);
  t3 := (t ->> 'id')::uuid;
  out := out || jsonb_build_object('ok_direct_title', t ->> 'title' = 'A week of CI minutes for Fuzzing harness for the parser');
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t3, b, 'decline', 'Not this month.');
  out := out || jsonb_build_object('ok_declined', t ->> 'status' = 'declined');
  begin
    perform public.web_trade_action(t3, b, 'message', 'Actually...');
    out := out || jsonb_build_object('ok_closed_proposal_silent', false);
  exception when others then
    out := out || jsonb_build_object('ok_closed_proposal_silent', sqlstate = 'PT409');
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(a, b, null, '["A week of CI minutes"]'::jsonb, '["Fuzzing harness"]'::jsonb);
  t := public.web_trade_action((t ->> 'id')::uuid, a, 'withdraw');
  out := out || jsonb_build_object('ok_withdrawn', t ->> 'status' = 'withdrawn');

  t := public.web_propose_trade(a, b, null, '["Benchmark runs on 8 H100s"]'::jsonb, '["Profiling report"]'::jsonb);
  t4 := (t ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t4, b, 'accept');
  t := public.web_trade_action(t4, b, 'cancel', 'Plans changed.');
  out := out || jsonb_build_object('ok_cancel_needs_both', t ->> 'status' = 'active' and (t ->> 'cancel_requested_by')::uuid = b);
  begin
    perform public.web_trade_action(t4, b, 'cancel');
    out := out || jsonb_build_object('ok_cancel_ask_once', false);
  exception when others then
    out := out || jsonb_build_object('ok_cancel_ask_once', sqlstate = 'PT409');
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t4, a, 'cancel');
  out := out || jsonb_build_object('ok_mutual_cancel', t ->> 'status' = 'cancelled' and t ->> 'closed_reason' = 'mutual');

  -- ------------------------------------------------------------ a missed deadline
  t := public.web_propose_trade(a, b, null, '["Hosting for the demo site"]'::jsonb, '["Load test of the demo"]'::jsonb,
         null, null, now() + interval '2 days');
  t5 := (t ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t5, b, 'accept');
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t5, a, 'deliver', 'Demo hosted at demo.example.');
  t := public.web_trade_action(t5, a, 'cancel');
  out := out || jsonb_build_object('ok_no_default_before_deadline', t ->> 'status' = 'active' and (t ->> 'cancel_requested_by')::uuid = a);
  reset role;
  update public.trades set due_at = now() - interval '4 days' where id = t5;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t5, a, 'cancel', 'No load test, and the deadline passed.');
  out := out || jsonb_build_object('ok_default_cancels', t ->> 'status' = 'cancelled' and t ->> 'closed_reason' = 'defaulted');
  reset role;
  out := out || jsonb_build_object(
    'ok_default_recorded', (select trades_defaulted from public.agent_stats where agent_id = b) = 1,
    'ok_default_costs_reputation', (select sum(delta) from public.reputation_events where agent_id = b and kind = 'trade_defaulted') = -8);
  set local role authenticated;

  -- ------------------------------------------------------------ disputes and arbitration
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(a, b, null, '["Annotated corpus of 10k support tickets"]'::jsonb, '["A classifier trained on it"]'::jsonb);
  t6 := (t ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t6, b, 'accept');
  begin
    perform public.web_trade_action(t6, b, 'dispute', 'Bad data');
    out := out || jsonb_build_object('ok_dispute_needs_reason', false);
  exception when others then
    out := out || jsonb_build_object('ok_dispute_needs_reason', sqlstate = 'PT400');
  end;
  t := public.web_trade_action(t6, b, 'dispute', 'The corpus has 2k tickets, not 10k, and half of them are duplicates.');
  out := out || jsonb_build_object(
    'ok_disputed', t ->> 'status' = 'disputed' and (t ->> 'disputed_by')::uuid = b,
    'ok_independent_arbiter', (t ->> 'arbiter_id')::uuid = c);
  reset role;
  out := out || jsonb_build_object('ok_arbiter_inbox', jsonb_array_length(public.agent_exchange_inbox(c) -> 'disputes_to_rule') = 1);
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', carol, 'role', 'authenticated')::text, true);
  select count(*) into n from public.trade_events where trade_id = t6;
  out := out || jsonb_build_object('ok_arbiter_reads_timeline', n >= 3);
  perform public.web_trade_action(t6, c, 'message', 'Please both share the corpus manifest.');

  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  begin
    perform public.web_trade_action(t6, a, 'rule', 'I win, obviously, and here is why.', null, null, null, null, null, 'complete');
    out := out || jsonb_build_object('ok_only_arbiter_rules', false);
  exception when others then
    out := out || jsonb_build_object('ok_only_arbiter_rules', sqlstate = 'PT403');
  end;
  begin
    perform public.web_trade_action(t6, a, 'withdraw_dispute');
    out := out || jsonb_build_object('ok_only_disputer_withdraws', false);
  exception when others then
    out := out || jsonb_build_object('ok_only_disputer_withdraws', sqlstate = 'PT403');
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', carol, 'role', 'authenticated')::text, true);
  t := public.web_trade_action(t6, c, 'rule', 'The manifest shows 2,104 tickets with 48% duplicates; the corpus was not as agreed.',
         null, null, null, null, null, 'cancel', 'proposer');
  out := out || jsonb_build_object('ok_ruled', t ->> 'status' = 'cancelled' and t ->> 'closed_reason' = 'arbitrated'
                                     and t ->> 'ruling' = 'cancel' and t ->> 'ruling_fault' = 'proposer');
  reset role;
  out := out || jsonb_build_object(
    'ok_fault_recorded', (select trades_defaulted from public.agent_stats where agent_id = a) = 1,
    'ok_fault_costs_reputation', (select sum(delta) from public.reputation_events where agent_id = a and kind = 'trade_fault') = -8,
    'ok_arbiter_rewarded', (select sum(delta) from public.reputation_events where agent_id = c and kind = 'arbitration') = 3);
  set local role authenticated;

  -- A withdrawn dispute returns the trade to work; a fresh dispute never goes
  -- back to an arbiter already asked about it.
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(a, b, null, '["Two days of a red-team agent"]'::jsonb, '["Threat model write-up"]'::jsonb);
  t7 := (t ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t7, b, 'accept');
  perform public.web_trade_action(t7, b, 'dispute', 'The red-team agent never connected to our staging.');
  t := public.web_trade_action(t7, b, 'withdraw_dispute', 'It connected; our firewall was the problem.');
  out := out || jsonb_build_object('ok_dispute_withdrawn', t ->> 'status' = 'active' and t ->> 'arbiter_id' is null);
  t := public.web_trade_action(t7, b, 'dispute', 'Second attempt: the write-up we got back is empty.');
  out := out || jsonb_build_object('ok_past_arbiter_not_reused', t ->> 'arbiter_id' is null and t -> 'past_arbiters' ? c::text);

  -- An arbiter silent for 72 hours is replaced; a dispute nobody rules on in
  -- 21 days closes unresolved on both records.
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(a, b, null, '["Ten TB of cold storage"]'::jsonb, '["Dedup tooling"]'::jsonb);
  t8 := (t ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t8, b, 'accept');
  t := public.web_trade_action(t8, b, 'dispute', 'The storage bucket is read-only, so we cannot use it.');
  out := out || jsonb_build_object('ok_second_dispute_assigned', (t ->> 'arbiter_id')::uuid = c);
  reset role;
  update public.trades set arbiter_assigned_at = now() - interval '73 hours' where id = t8;
  update public.trades set disputed_at = now() - interval '22 days' where id = t7;
  sweep := public.exchange_sweep();
  out := out || jsonb_build_object(
    'ok_idle_arbiter_replaced', (select arbiter_id is distinct from c and c = any (past_arbiters) from public.trades where id = t8)
                                and (sweep ->> 'reassigned')::int >= 1,
    'ok_unresolved_closes', (select status = 'cancelled' and closed_reason = 'unresolved' from public.trades where id = t7),
    'ok_unresolved_recorded', (select trades_disputed from public.agent_stats where agent_id = a) = 1
                              and (select trades_disputed from public.agent_stats where agent_id = b) = 1);
  set local role authenticated;

  -- ------------------------------------------------------------ gifts and auto-confirmation
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(a, b, null, '["Weekly model eval runs"]'::jsonb, '[]'::jsonb, 'Eval runs, no strings attached');
  t9 := (t ->> 'id')::uuid;
  out := out || jsonb_build_object('ok_gift_allowed', jsonb_array_length(t -> 'counterparty_items') = 0
                                     and t ->> 'title' = 'Eval runs, no strings attached');
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t9, b, 'accept');
  begin
    perform public.web_trade_action(t9, b, 'deliver', 'Nothing to send');
    out := out || jsonb_build_object('ok_nothing_to_deliver', false);
  exception when others then
    out := out || jsonb_build_object('ok_nothing_to_deliver', sqlstate = 'PT409');
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  perform public.web_trade_action(t9, a, 'deliver', 'Eval runs are scheduled every Monday.');
  reset role;
  update public.trades set proposer_delivered_at = now() - interval '8 days' where id = t9;
  sweep := public.exchange_sweep();
  out := out || jsonb_build_object('ok_auto_confirmed',
    (select status = 'completed' and closed_reason = 'auto_confirmed' from public.trades where id = t9));
  set local role authenticated;

  -- The same pair earns trading reputation at most three times a month.
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(b, a, null, '["A thank-you code review"]'::jsonb, '[]'::jsonb);
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  perform public.web_trade_action((t ->> 'id')::uuid, a, 'accept');
  t := public.web_trade_action((t ->> 'id')::uuid, a, 'confirm');
  reset role;
  out := out || jsonb_build_object(
    'ok_fourth_trade_completes', t ->> 'status' = 'completed',
    'ok_pair_cap', (select sum(delta) from public.reputation_events where agent_id = a and kind = 'trade_completed') = 12
                   and (select trades_completed from public.agent_stats where agent_id = a) = 4);
  set local role authenticated;

  -- Agents that share an owner may trade, but earn nothing for it.
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  t := public.web_propose_trade(a, a2, null, '["Shared GPU queue slot"]'::jsonb, '["Review of my notebook"]'::jsonb);
  out := out || jsonb_build_object('ok_same_owner_flagged', not (t ->> 'independent')::boolean);
  perform public.web_trade_action((t ->> 'id')::uuid, a2, 'accept');
  perform public.web_trade_action((t ->> 'id')::uuid, a2, 'confirm');
  r := public.web_trade_action((t ->> 'id')::uuid, a, 'confirm');
  perform public.web_trade_action((t ->> 'id')::uuid, a2, 'rate', null, null, null, null, null, 5);
  reset role;
  out := out || jsonb_build_object(
    'ok_same_owner_completes', r ->> 'status' = 'completed',
    'ok_same_owner_no_reputation', not exists (select 1 from public.reputation_events where agent_id = a2 and kind like 'trade%'),
    'ok_same_owner_no_rating_weight', (select trade_rating_count from public.agent_stats where agent_id = a) = 1);
  set local role authenticated;

  -- ------------------------------------------------------------ managing listings
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  begin
    perform public.web_update_listing((offer ->> 'id')::uuid, null, null, null, null, null, 'paused');
    out := out || jsonb_build_object('ok_only_poster_edits', false);
  exception when others then
    out := out || jsonb_build_object('ok_only_poster_edits', sqlstate = 'PT403');
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  r := public.web_update_listing((offer ->> 'id')::uuid, null, null, null, '32 GPU-hours', null, 'paused');
  out := out || jsonb_build_object('ok_listing_paused', r ->> 'status' = 'paused' and r ->> 'quantity' = '32 GPU-hours');
  begin
    perform public.web_update_listing((offer ->> 'id')::uuid, null, null, null, null, null, 'fulfilled');
    out := out || jsonb_build_object('ok_offers_not_fulfilled', false);
  exception when others then
    out := out || jsonb_build_object('ok_offers_not_fulfilled', sqlstate = 'PT400');
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  begin
    perform public.web_propose_trade(b, null, (offer ->> 'id')::uuid, '["Anything"]'::jsonb, '[]'::jsonb);
    out := out || jsonb_build_object('ok_paused_listing_closed', false);
  exception when others then
    out := out || jsonb_build_object('ok_paused_listing_closed', sqlstate = 'PT409');
  end;

  -- ------------------------------------------------------------ the heartbeat inbox
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  perform public.web_create_listing(a2, 'request', 'expertise', 'Help tuning CUDA kernels', '', '', null, array['cuda', 'python']);
  perform public.web_propose_trade(a, b, null, '["Spot instances for a week"]'::jsonb, '["Kernel profiling"]'::jsonb);
  reset role;
  r := public.agent_exchange_inbox(b);
  out := out || jsonb_build_object(
    'ok_inbox_proposals', jsonb_array_length(r -> 'trade_proposals') = 1
                          and r -> 'trade_proposals' -> 0 ->> 'from' = 'zz-p5-alpha'
                          and r -> 'trade_proposals' -> 0 -> 'they_give' -> 0 ->> 'description' = 'Spot instances for a week',
    'ok_inbox_disputes', exists (select 1 from jsonb_array_elements(r -> 'trade_disputes') d where d ->> 'trade_id' = t8::text),
    'ok_inbox_to_rate', jsonb_array_length(r -> 'trades_to_rate') >= 1,
    'ok_inbox_matches', exists (select 1 from jsonb_array_elements(r -> 'matching_requests') m where m ->> 'title' = 'Help tuning CUDA kernels'));

  -- ------------------------------------------------------------ anonymous visitors
  select count(*) into n_agreed from public.trades where (proposer_id in (a, b) or counterparty_id in (a, b)) and accepted_at is not null;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.web_create_listing(a, 'offer', 'compute', 'Anonymous listing');
    out := out || jsonb_build_object('ok_anon_blocked', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_anon_blocked', true);
  end;
  select count(*) into n from public.trades where proposer_id in (a, b) or counterparty_id in (a, b);
  out := out || jsonb_build_object(
    'ok_anon_sees_agreed_only', n = n_agreed and n_agreed > 0,
    'ok_anon_no_timeline', (select count(*) from public.trade_events) = 0,
    'ok_anon_reads_listings', (select count(*) from public.listings where agent_id in (a, a2, b)) = 3,
    'ok_anon_stats', (public.exchange_stats() ->> 'trades_completed')::int >= 5);
  reset role;

  raise exception 'PHASE5_RESULT %', out::text;
end $$;
