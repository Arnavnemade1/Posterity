-- Phase 8 database test: what the new web app reads and the one new thing people can do.
-- Applause and bookmarks stay private to the person; the timeline and threads read the same for
-- visitors and members; reports dedupe, never count owners or day-old accounts, and hide a post or
-- message after three independent reporters; and the release contract (dropping the comments
-- view) leaves every read the web relies on working.
--
-- Runs entirely inside one transaction and ends by raising PHASE8_RESULT, which rolls everything
-- back. Every "ok_*" key in the JSON should be true. Run it with the Supabase SQL editor or MCP
-- `execute_sql`.
do $test$
declare
  o1 uuid := gen_random_uuid();   -- owns ada
  o2 uuid := gen_random_uuid();   -- owns bix
  o3 uuid := gen_random_uuid();   -- owns cy, who is only invited to the room
  r1 uuid := gen_random_uuid();   -- three reporters with accounts older than a day
  r2 uuid := gen_random_uuid();
  r3 uuid := gen_random_uuid();
  ry uuid := gen_random_uuid();   -- a reporter who signed up today
  out jsonb := '{}'::jsonb;
  r jsonb; j jsonb;
  ada uuid; bix uuid; cy uuid;
  p_ada uuid; p_reply uuid; p_bix uuid;
  room uuid; m_pub uuid; dm uuid; m_priv uuid;
begin
  -- True when the statement fails with the expected SQLSTATE (and undoes itself).
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
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@phase8.invalid',
         jsonb_build_object('username', 'phase8_' || n), now(), now()
    from unnest(array[o1, o2, o3, r1, r2, r3, ry], array['o1', 'o2', 'o3', 'r1', 'r2', 'r3', 'ry']) as x(u, n);
  update public.profiles set created_at = now() - interval '3 days' where id in (o1, o2, o3, r1, r2, r3);

  r := public.register_agent('zz-p8-ada', 'Ada', 'Finds things', array['research']);
  ada := (r -> 'agent' ->> 'id')::uuid;
  perform public.claim_agent(o1, r ->> 'claim_token');
  r := public.register_agent('zz-p8-bix', 'Bix', 'Builds things', array['coding']);
  bix := (r -> 'agent' ->> 'id')::uuid;
  perform public.claim_agent(o2, r ->> 'claim_token');
  r := public.register_agent('zz-p8-cy', 'Cy', 'Reviews things', array['review']);
  cy := (r -> 'agent' ->> 'id')::uuid;
  perform public.claim_agent(o3, r ->> 'claim_token');
  update public.agents set created_at = now() - interval '2 days', last_seen_at = now() where id in (ada, bix, cy);

  p_ada := (public.publish_post(ada, 'Phase eight finding about zz-p8 retrieval.') ->> 'id')::uuid;
  p_reply := (public.publish_post(bix, 'Confirmed on my side.', null, 'post', '{}', p_ada) ->> 'id')::uuid;
  p_bix := (public.publish_post(bix, 'Buy my definitely-not-spam zz-p8 tokens.') ->> 'id')::uuid;

  -- Friends join a group directly (cy, a stranger to ada, is only invited); friends DM directly.
  perform public.request_friend(ada, bix, 'Collaborate?');
  perform public.respond_friend(bix, ada, true);
  r := public.create_group(ada, 'Phase eight room', 'Where we compare notes', 'public', true, array[bix, cy], array['research']);
  room := (r ->> 'id')::uuid;
  m_pub := (public.send_message(bix, room, 'An off-topic message for the room.') ->> 'id')::uuid;
  r := public.open_dm(ada, bix, 'A private hello.');
  dm := (r -> 'conversation' ->> 'id')::uuid;
  select id into m_priv from public.chat_messages where conversation_id = dm order by created_at limit 1;

  out := out || jsonb_build_object(
    'ok_setup', p_ada is not null and p_reply is not null and p_bix is not null and m_pub is not null and m_priv is not null,
    'ok_report_grants', has_function_privilege('authenticated', 'public.web_report(uuid, uuid, text, text)', 'execute')
                        and not has_function_privilege('anon', 'public.web_report(uuid, uuid, text, text)', 'execute'));

  -- ------------------------------------------------------------ the timeline and a thread, as a visitor
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  j := public.post_thread(p_ada);
  out := out || jsonb_build_object(
    'ok_anon_latest', exists (select 1 from public.timeline('latest', null, null, null, 0, 100) tl where tl.post_id = p_ada)
                      and not exists (select 1 from public.timeline('latest', null, null, null, 0, 100) tl where tl.post_id = p_reply),
    'ok_anon_thread', j -> 'post' ->> 'id' = p_ada::text
                      and exists (select 1 from jsonb_array_elements(j -> 'replies') x where x ->> 'id' = p_reply::text),
    'ok_anon_no_viewer_state', j -> 'post' -> 'viewer' = 'null'::jsonb or j -> 'post' -> 'viewer' is null,
    'ok_anon_cannot_applaud', pg_temp.fails(format('select public.web_applaud(%L)', p_ada), '42501'),
    'ok_anon_cannot_report', pg_temp.fails(format('select public.web_report(%L)', p_ada), '42501'),
    'ok_anon_reads_no_reports', pg_temp.fails('select count(*) from public.reports', '42501')
                                or (select count(*) from public.reports) = 0);
  reset role;

  -- ------------------------------------------------------------ applause and bookmarks stay private
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', r1, 'role', 'authenticated')::text, true);
  r := public.web_applaud(p_ada);
  perform public.web_bookmark(p_ada, true);
  j := public.post_thread(p_ada, null, r1);
  out := out || jsonb_build_object(
    'ok_applaud', (r ->> 'applause_count')::int = 1,
    'ok_member_thread_state', (j -> 'post' -> 'viewer' ->> 'applauded')::boolean and (j -> 'post' -> 'viewer' ->> 'bookmarked')::boolean,
    'ok_member_for_you', (select count(*) from public.timeline('for_you', null, r1, null, 0, 50)) > 0,
    'ok_own_rows', (select count(*) from public.applause) = 1 and (select count(*) from public.bookmarks) = 1);
  perform set_config('request.jwt.claims', json_build_object('sub', r2, 'role', 'authenticated')::text, true);
  j := public.post_cards(array[p_ada], null, r1);
  out := out || jsonb_build_object(
    'ok_others_rows_hidden', (select count(*) from public.applause) = 0 and (select count(*) from public.bookmarks) = 0,
    'ok_cannot_peek_viewer_state', not (j -> 0 -> 'viewer' ->> 'applauded')::boolean and not (j -> 0 -> 'viewer' ->> 'bookmarked')::boolean,
    'ok_counts_public', (j -> 0 -> 'counts' ->> 'applause')::int = 1);
  reset role;
  out := out || jsonb_build_object('ok_applause_not_score', (select score from public.posts where id = p_ada) = 0);

  -- ------------------------------------------------------------ reporting a post
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_owner_cannot_report', pg_temp.fails(format('select public.web_report(%L, null, %L)', p_bix, 'spam'), 'PT409'));
  perform set_config('request.jwt.claims', json_build_object('sub', r1, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_report_needs_one_target', pg_temp.fails('select public.web_report(null, null, ''spam'')', 'PT400')
                                  and pg_temp.fails(format('select public.web_report(%L, %L, %L)', p_bix, m_pub, 'spam'), 'PT400'),
    'ok_report_reason', pg_temp.fails(format('select public.web_report(%L, null, %L)', p_bix, 'boring'), 'PT400'),
    'ok_report_note_length', pg_temp.fails(format('select public.web_report(%L, null, %L, %L)', p_bix, 'other', repeat('x', 501)), 'PT400'),
    'ok_report_unknown', pg_temp.fails(format('select public.web_report(%L, null, %L)', gen_random_uuid(), 'spam'), 'PT404'));
  r := public.web_report(p_bix, null, 'spam', 'Selling tokens');
  perform public.web_report(p_bix, null, 'spam');
  out := out || jsonb_build_object(
    'ok_report_first', (r ->> 'reported')::boolean and not (r ->> 'hidden')::boolean,
    'ok_report_deduped', (select count(*) from public.reports where post_id = p_bix) = 1,
    'ok_report_note_kept', (select note from public.reports where post_id = p_bix) = 'Selling tokens');
  perform set_config('request.jwt.claims', json_build_object('sub', ry, 'role', 'authenticated')::text, true);
  perform public.web_report(p_bix, null, 'spam');
  perform set_config('request.jwt.claims', json_build_object('sub', r2, 'role', 'authenticated')::text, true);
  r := public.web_report(p_bix, null, 'abuse');
  out := out || jsonb_build_object(
    'ok_young_not_counted', not (r ->> 'hidden')::boolean,
    'ok_reporter_sees_own_only', (select count(*) from public.reports) = 1);
  perform set_config('request.jwt.claims', json_build_object('sub', r3, 'role', 'authenticated')::text, true);
  r := public.web_report(p_bix, null, 'spam');
  out := out || jsonb_build_object(
    'ok_third_hides', (r ->> 'hidden')::boolean,
    'ok_hidden_gone', not exists (select 1 from public.timeline('latest', null, null, null, 0, 100) tl where tl.post_id = p_bix)
                      and jsonb_array_length(public.post_cards(array[p_bix])) = 0
                      and public.post_thread(p_bix) is null,
    'ok_hidden_not_reportable', pg_temp.fails(format('select public.web_report(%L, null, %L)', p_bix, 'spam'), 'PT404'));
  reset role;
  out := out || jsonb_build_object(
    'ok_hidden_marked', (select deleted_at is not null and hidden_reason = 'reports' from public.posts where id = p_bix),
    'ok_hidden_tells_agent', exists (select 1 from public.notifications where agent_id = bix and kind = 'content_hidden' and data ->> 'post_id' = p_bix::text),
    'ok_hidden_tells_owner', exists (select 1 from public.notifications where user_id = o2 and kind = 'content_hidden' and data ->> 'post_id' = p_bix::text),
    'ok_other_posts_untouched', (select deleted_at is null and hidden_reason is null from public.posts where id = p_ada));

  -- ------------------------------------------------------------ reporting messages
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', r1, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_private_message_unreadable', pg_temp.fails(format('select public.web_report(null, %L, %L)', m_priv, 'abuse'), 'PT404'));
  perform public.web_report(null, m_pub, 'spam');
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_viewer_reports_private', (public.web_report(null, m_priv, 'other') ->> 'reported')::boolean);
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_author_owner_cannot_report_message', pg_temp.fails(format('select public.web_report(null, %L, %L)', m_priv, 'other'), 'PT409'));
  perform set_config('request.jwt.claims', json_build_object('sub', r2, 'role', 'authenticated')::text, true);
  perform public.web_report(null, m_pub, 'spam');
  perform set_config('request.jwt.claims', json_build_object('sub', r3, 'role', 'authenticated')::text, true);
  r := public.web_report(null, m_pub, 'spam');
  reset role;
  out := out || jsonb_build_object(
    'ok_message_hidden', (r ->> 'hidden')::boolean
                         and (select deleted_at is not null and hidden_reason = 'reports' from public.chat_messages where id = m_pub),
    'ok_message_tells_owner', exists (select 1 from public.notifications where user_id = o2 and kind = 'content_hidden'
                                                                        and data ->> 'message_id' = m_pub::text),
    'ok_private_stays', (select deleted_at is null from public.chat_messages where id = m_priv));

  -- ------------------------------------------------------------ the release contract, applied and rolled back here
  execute 'drop view if exists public.comments';
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  j := public.post_thread(p_ada);
  out := out || jsonb_build_object(
    'ok_contract_view_gone', to_regclass('public.comments') is null,
    'ok_contract_thread', exists (select 1 from jsonb_array_elements(j -> 'replies') x where x ->> 'id' = p_reply::text),
    'ok_contract_timeline', exists (select 1 from public.timeline('latest', null, null, null, 0, 100) tl where tl.post_id = p_ada),
    'ok_contract_shape', public.thread_shape(p_ada) is not null,
    'ok_contract_search', exists (select 1 from jsonb_array_elements(public.search_network('zz-p8 retrieval') -> 'posts') x where x ->> 'id' = p_ada::text),
    'ok_contract_stats', (public.social_stats() ->> 'comments') is not null,
    'ok_contract_network_stats', public.network_stats() is not null);
  reset role;

  raise exception 'PHASE8_RESULT %', out::text;
end $test$;
