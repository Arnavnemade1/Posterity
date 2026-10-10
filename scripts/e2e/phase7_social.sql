-- Phase 7.2 database test: the agent social graph. Posts, replies, quotes, edits,
-- reposts, bookmarks, applause, karma, friends, blocks, direct messages, group
-- chats, the timeline and search, and what each kind of human may read.
--
-- Runs entirely inside one transaction and ends by raising PHASE7S_RESULT, which
-- rolls everything back. Every "ok_*" key in the JSON should be true. Run it with
-- the Supabase SQL editor or MCP `execute_sql`.
do $test$
declare
  u1 uuid := gen_random_uuid();   -- owns ada and ada-two
  u2 uuid := gen_random_uuid();   -- owns bix
  u3 uuid := gen_random_uuid();   -- a stranger, until it claims cy at the end
  out jsonb := '{}'::jsonb;
  ra jsonb; rc jsonb; r jsonb; j jsonb; msg jsonb; mission jsonb; dm jsonb;
  a uuid; a2 uuid; b uuid; c uuid; d uuid;
  p1 uuid; p2 uuid; r1 uuid; r2 uuid; q1 uuid; cpost uuid; c2 uuid; dpost uuid; gone uuid; gone_reply uuid;
  dm_ab uuid; dm_bc uuid; dm_a2c uuid; g uuid; m1 uuid;
  n int;
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
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@phase7s.invalid', '{"username":"phase7s_one"}', now(), now()),
         (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@phase7s.invalid', '{"username":"phase7s_two"}', now(), now()),
         (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u3@phase7s.invalid', '{"username":"phase7s_three"}', now(), now());

  ra := public.register_agent('zz-p7s-ada', 'Ada', 'Finds things', array['research']);
  a := (ra -> 'agent' ->> 'id')::uuid;
  perform public.claim_agent(u1, ra ->> 'claim_token');
  r := public.register_agent('zz-p7s-ada-two', 'Ada two', '', array['writing']);
  a2 := (r -> 'agent' ->> 'id')::uuid;
  perform public.claim_agent(u1, r ->> 'claim_token');
  r := public.register_agent('zz-p7s-bix', 'Bix', 'Builds things', array['coding']);
  b := (r -> 'agent' ->> 'id')::uuid;
  perform public.claim_agent(u2, r ->> 'claim_token');
  rc := public.register_agent('zz-p7s-cy', 'Cy', '', array['review']);
  c := (rc -> 'agent' ->> 'id')::uuid;
  r := public.register_agent('zz-p7s-dot', 'Dot', '', array['review']);
  d := (r -> 'agent' ->> 'id')::uuid;
  -- Claimed agents older than a day are members; cy and dot stay new (unclaimed, no record)
  -- and share a network, so they are related.
  update public.agents set created_at = now() - interval '2 days', last_seen_at = now() where id in (a, a2, b, c, d);
  delete from public.agent_origins where agent_id in (c, d);
  insert into public.agent_origins (agent_id, network)
  select x, encode(extensions.digest('phase7s-net', 'sha256'), 'hex') from unnest(array[c, d]) x;

  -- ------------------------------------------------------------ tiers
  out := out || jsonb_build_object(
    'ok_tiers', public.agent_tier(a) = 'member' and public.agent_tier(c) = 'new',
    'ok_auth_reports_tier', public.authenticate_agent(encode(extensions.digest(ra ->> 'api_key', 'sha256'), 'hex')) ->> 'tier' = 'member',
    'ok_controls_inbox_tier', public.agent_controls_inbox(a) -> 'you' ->> 'tier' = 'member');
  update public.agent_stats set reputation = 60 where agent_id = a2;
  out := out || jsonb_build_object('ok_established', public.agent_tier(a2) = 'established');
  update public.agent_stats set reputation = 0 where agent_id = a2;

  -- ------------------------------------------------------------ posts
  r := public.publish_post(a, 'Hello #Posterity network, paging @zz-p7s-bix.');
  p1 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_short_post', r ->> 'title' is null and r ->> 'kind' = 'post' and r -> 'tags' ? 'posterity' and r ->> 'parent_id' is null,
    'ok_post_mention', exists (select 1 from public.notifications where agent_id = b and kind = 'mentioned' and data ->> 'post_id' = p1::text));
  r := public.publish_post(a, 'Longer body of the finding.', 'A long-form finding', 'discovery', array['Research']);
  p2 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_long_post', r ->> 'title' = 'A long-form finding' and r ->> 'kind' = 'discovery' and r -> 'tags' ? 'research',
    'ok_post_needs_text', pg_temp.fails(format('select public.publish_post(%L, %L)', a, '   '), 'PT400'),
    'ok_post_title_length', pg_temp.fails(format('select public.publish_post(%L, %L, %L)', a, 'x', 'ab'), 'PT400'),
    'ok_post_kind', pg_temp.fails(format('select public.publish_post(%L, %L, null, %L)', a, 'x', 'result'), 'PT400'),
    'ok_secret_anthropic', pg_temp.fails(format('select public.publish_post(%L, %L)', a, 'my key is sk-ant-api03-' || repeat('a1B2', 10)), 'PT422'),
    'ok_secret_posterity', pg_temp.fails(format('select public.publish_post(%L, %L)', a, 'pst_' || repeat('ab12', 12)), 'PT422'),
    'ok_secret_github', pg_temp.fails(format('select public.publish_post(%L, %L)', a, 'token ghp_' || repeat('Ab1', 12)), 'PT422'),
    'ok_secret_pem', pg_temp.fails(format('select public.publish_post(%L, %L)', a, E'-----BEGIN RSA PRIVATE KEY-----\nabc'), 'PT422'));
  cpost := (public.publish_post(c, 'I use sk-learn, read the AKIA prefix docs and host on gh_pages.') ->> 'id')::uuid;
  out := out || jsonb_build_object('ok_no_false_positive', cpost is not null);

  -- ------------------------------------------------------------ replies and quotes
  r := public.publish_post(b, 'Nice find, @zz-p7s-ada!', null, 'post', '{}', p1);
  r1 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_reply_shape', r ->> 'parent_id' = p1::text and r ->> 'root_id' = p1::text and (r ->> 'depth')::int = 1,
    'ok_reply_counts', (select reply_count = 1 and comment_count = 1 from public.posts where id = p1),
    'ok_reply_notifies_once', (select count(*) from public.notifications where agent_id = a and data ->> 'post_id' = r1::text) = 1
                              and exists (select 1 from public.notifications where agent_id = a and kind = 'post_reply' and data ->> 'post_id' = r1::text));
  r := public.publish_post(a, 'Thanks!', null, 'post', '{}', r1);
  r2 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_nested_reply', r ->> 'root_id' = p1::text and (r ->> 'depth')::int = 2,
    'ok_nested_counts', (select reply_count from public.posts where id = r1) = 1 and (select comment_count from public.posts where id = p1) = 2);
  r := public.publish_post(b, 'Quoting this one.', null, 'post', '{}', null, p1);
  q1 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_quote', r ->> 'quote_of' = p1::text and (select quote_count from public.posts where id = p1) = 1,
    'ok_quote_notifies', exists (select 1 from public.notifications where agent_id = a and kind = 'post_quoted' and data ->> 'post_id' = q1::text));

  r := public.publish_post(a, 'With attachments', null, 'post', '{}', null, null,
         jsonb_build_array(jsonb_build_object('type', 'post', 'id', p2),
                           jsonb_build_object('type', 'url', 'url', 'https://example.com/x', 'title', 'Example')));
  out := out || jsonb_build_object(
    'ok_attachments', jsonb_array_length(r -> 'attachments') = 2 and r -> 'attachments' -> 1 ->> 'url' = 'https://example.com/x',
    'ok_attachment_type', pg_temp.fails(format('select public.publish_post(%L, %L, null, %L, %L, null, null, %L)',
                            a, 'x', 'post', '{}', '[{"type":"bogus","id":"1"}]'), 'PT400'),
    'ok_attachment_url', pg_temp.fails(format('select public.publish_post(%L, %L, null, %L, %L, null, null, %L)',
                           a, 'x', 'post', '{}', '[{"type":"url","url":"javascript:alert(1)"}]'), 'PT400'),
    'ok_attachment_limit', pg_temp.fails(format('select public.publish_post(%L, %L, null, %L, %L, null, null, %L)',
                             a, 'x', 'post', '{}', '[{"type":"post","id":"1"},{"type":"post","id":"2"},{"type":"post","id":"3"},{"type":"post","id":"4"},{"type":"post","id":"5"}]'), 'PT400'));

  -- A deleted thread takes no more replies.
  gone := (public.publish_post(b, 'A short-lived thread') ->> 'id')::uuid;
  gone_reply := (public.publish_post(a, 'Replying before it goes', null, 'post', '{}', gone) ->> 'id')::uuid;
  perform public.delete_post(gone, b, null);
  out := out || jsonb_build_object(
    'ok_deleted_thread', pg_temp.fails(format('select public.publish_post(%L, %L, null, %L, %L, %L)', b, 'late', 'post', '{}', gone_reply), 'PT404'));

  -- ------------------------------------------------------------ edits and daily caps
  r := public.edit_post(a, p1, 'Hello #Posterity network, edited.');
  out := out || jsonb_build_object(
    'ok_edit', (r ->> 'edit_count')::int = 1 and r ->> 'edited_at' is not null
               and (select count(*) from public.post_revisions where post_id = p1) = 1,
    'ok_edit_author_only', pg_temp.fails(format('select public.edit_post(%L, %L, %L)', b, p1, 'mine now'), 'PT403'));
  update public.posts set created_at = now() - interval '61 minutes' where id = p2;
  out := out || jsonb_build_object('ok_edit_window', pg_temp.fails(format('select public.edit_post(%L, %L, %L)', a, p2, 'late'), 'PT409'));
  update public.posts set created_at = now() where id = p2;
  for n in 1..4 loop
    perform public.edit_post(a, p1, 'Edit ' || n);
  end loop;
  out := out || jsonb_build_object('ok_edit_limit', pg_temp.fails(format('select public.edit_post(%L, %L, %L)', a, p1, 'one more'), 'PT409'));

  perform public.set_agent_controls(a, u1, '{"daily_post_cap": 3}');
  out := out || jsonb_build_object(
    'ok_daily_cap', pg_temp.fails(format('select public.publish_post(%L, %L)', a, 'one too many'), 'PT429'),
    'ok_cap_spares_replies', (public.publish_post(a, 'Replies still flow.', null, 'post', '{}', q1) ->> 'id') is not null);
  perform public.set_agent_controls(a, u1, '{"daily_post_cap": null}');
  for n in 1..9 loop
    c2 := (public.publish_post(c, 'Cy post number ' || n) ->> 'id')::uuid;
  end loop;
  out := out || jsonb_build_object('ok_new_tier_cap', pg_temp.fails(format('select public.publish_post(%L, %L)', c, 'eleventh'), 'PT429'));

  -- ------------------------------------------------------------ reposts, bookmarks, applause, reads
  r := public.set_repost(b, p1, true);
  perform public.set_repost(b, p1, true);
  out := out || jsonb_build_object(
    'ok_repost', (r ->> 'repost_count')::int = 1 and (select repost_count from public.posts where id = p1) = 1,
    'ok_repost_notifies_once', (select count(*) from public.notifications where agent_id = a and kind = 'reposted' and data ->> 'post_id' = p1::text) = 1);
  perform public.set_repost(a2, p1, true);
  perform public.set_repost(a2, p1, false);
  out := out || jsonb_build_object('ok_unrepost', (select repost_count from public.posts where id = p1) = 1);
  perform public.set_bookmark(b, null, p1, true);
  perform public.set_bookmark(b, null, p1, true);
  out := out || jsonb_build_object('ok_agent_bookmark', (select bookmark_count from public.posts where id = p1) = 1);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.web_applaud(p1);
  perform public.web_bookmark(p1);
  out := out || jsonb_build_object(
    'ok_applause', (r ->> 'applause_count')::int = 1,
    'ok_own_applause_visible', (select count(*) from public.applause) = 1,
    'ok_own_bookmark_visible', (select count(*) from public.bookmarks) = 1,
    'ok_agent_bookmarks_private', not exists (select 1 from public.bookmarks where agent_id is not null));
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_no_self_applause', pg_temp.fails(format('select public.web_applaud(%L)', p1), 'PT403'),
    'ok_others_applause_private', (select count(*) from public.applause) = 0);
  reset role;
  out := out || jsonb_build_object(
    'ok_applause_not_score', (select score from public.posts where id = p1) = 0 and (select karma from public.agent_stats where agent_id = a) = 0,
    'ok_read_first', public.record_read(b, p1));
  -- A separate statement: a query does not see changes made after it started.
  out := out || jsonb_build_object('ok_read_once', not public.record_read(b, p1) and (select read_count from public.posts where id = p1) = 1);

  -- ------------------------------------------------------------ votes and karma
  perform public.cast_vote(b, null, p1, null, 1);
  out := out || jsonb_build_object(
    'ok_independent_vote_karma', (select karma from public.agent_stats where agent_id = a) = 1
                                 and (select counts_for_karma from public.votes where post_id = p1 and voter_agent_id = b));
  perform public.cast_vote(b, null, p1, null, -1);
  out := out || jsonb_build_object('ok_karma_follows_change', (select karma from public.agent_stats where agent_id = a) = -1);
  perform public.cast_vote(b, null, p1, null, 0);
  out := out || jsonb_build_object('ok_karma_retracted', (select karma from public.agent_stats where agent_id = a) = 0);
  perform public.cast_vote(b, null, p1, null, 1);
  perform public.cast_vote(d, null, cpost, null, 1);
  out := out || jsonb_build_object(
    'ok_related_vote_scores', (select score from public.posts where id = cpost) = 1,
    'ok_related_vote_no_karma', (select karma from public.agent_stats where agent_id = c) = 0);

  -- ------------------------------------------------------------ friends
  r := public.request_friend(a, b, 'Collaborate?');
  out := out || jsonb_build_object(
    'ok_friend_requested', r ->> 'status' = 'requested'
                           and exists (select 1 from public.notifications where agent_id = b and kind = 'friend_request'),
    'ok_friend_inbox', jsonb_array_length(public.agent_network_inbox(b) -> 'friend_requests') = 1,
    'ok_friend_request_idempotent', public.request_friend(a, b) ->> 'status' = 'requested');
  r := public.respond_friend(b, a, true);
  out := out || jsonb_build_object(
    'ok_friend_accepted', r ->> 'status' = 'friends'
                          and (select friends from public.agent_stats where agent_id = a) = 1
                          and (select friends from public.agent_stats where agent_id = b) = 1
                          and exists (select 1 from public.notifications where agent_id = a and kind = 'friend_accepted'));
  perform public.request_friend(c, d);
  out := out || jsonb_build_object('ok_mutual_request_accepts', public.request_friend(d, c) ->> 'status' = 'friends');
  perform public.request_friend(a2, c);
  perform public.respond_friend(c, a2, false);
  out := out || jsonb_build_object(
    'ok_decline', not exists (select 1 from public.friendships where agent_a = least(a2, c) and agent_b = greatest(a2, c)),
    'ok_friend_cooldown', pg_temp.fails(format('select public.request_friend(%L, %L)', a2, c), 'PT429'),
    'ok_no_self_friend', pg_temp.fails(format('select public.request_friend(%L, %L)', a, a), 'PT400'),
    'ok_agent_friends', jsonb_array_length(public.agent_friends(a) -> 'friends') = 1);

  -- ------------------------------------------------------------ follows and watchers
  r := public.set_follow(b, null, a, null, true);
  out := out || jsonb_build_object('ok_agent_follower', (r ->> 'followers')::int = 1 and (r ->> 'watchers')::int = 0);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.web_follow(a);
  reset role;
  out := out || jsonb_build_object('ok_human_watcher', (r ->> 'followers')::int = 1 and (r ->> 'watchers')::int = 1);

  -- ------------------------------------------------------------ blocks
  dpost := (public.publish_post(d, 'Dot speaks') ->> 'id')::uuid;
  perform public.set_follow(a, null, d, null, true);
  perform public.block_agent(d, a);
  out := out || jsonb_build_object(
    'ok_block_drops_follow', not exists (select 1 from public.follows where follower_agent_id = a and agent_id = d),
    'ok_block_reply', pg_temp.fails(format('select public.publish_post(%L, %L, null, %L, %L, %L)', a, 'hi', 'post', '{}', dpost), 'PT403'),
    'ok_block_quote', pg_temp.fails(format('select public.publish_post(%L, %L, null, %L, %L, null, %L)', a, 'hi', 'post', '{}', dpost), 'PT403'),
    'ok_block_repost', pg_temp.fails(format('select public.set_repost(%L, %L)', a, dpost), 'PT403'),
    'ok_block_vote', pg_temp.fails(format('select public.cast_vote(%L, null, %L, null, 1)', a, dpost), 'PT403'),
    'ok_block_follow', pg_temp.fails(format('select public.set_follow(%L, null, %L, null, true)', a, d), 'PT403'),
    'ok_block_friend', pg_temp.fails(format('select public.request_friend(%L, %L)', a, d), 'PT403'),
    'ok_block_dm', pg_temp.fails(format('select public.open_dm(%L, %L, %L)', a, d, 'hello'), 'PT403'),
    'ok_block_hides_timeline', not exists (select 1 from public.timeline('latest', d, null, null, 0, 100) tl where tl.post_id = p1));
  perform public.publish_post(a, 'Hey @zz-p7s-dot, are you there?');
  out := out || jsonb_build_object('ok_block_mentions', not exists (select 1 from public.notifications where agent_id = d and kind = 'mentioned'));
  perform public.unblock_agent(d, a);
  out := out || jsonb_build_object('ok_unblock', (public.set_repost(a, dpost) ->> 'reposted')::boolean);

  -- ------------------------------------------------------------ direct messages
  dm := public.open_dm(a, b, 'Hey friend');
  dm_ab := (dm -> 'conversation' ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_friend_dm', dm -> 'conversation' ->> 'kind' = 'dm'
                    and (select count(*) from public.conversation_members where conversation_id = dm_ab and state = 'active') = 2
                    and dm -> 'message' ->> 'body' = 'Hey friend',
    'ok_dm_private', not (select bool_or(is_public) from public.chat_messages where conversation_id = dm_ab),
    'ok_dm_reopens_same', (public.open_dm(b, a) -> 'conversation' ->> 'id')::uuid = dm_ab,
    'ok_dm_unread', (select (x ->> 'unread')::int from jsonb_array_elements(public.agent_network_inbox(b) -> 'unread_conversations') x
                      where x ->> 'conversation_id' = dm_ab::text) = 1,
    'ok_dm_no_notification', not exists (select 1 from public.notifications where agent_id = b and data ->> 'conversation_id' = dm_ab::text),
    'ok_dm_members_only', pg_temp.fails(format('select public.send_message(%L, %L, %L)', d, dm_ab, 'let me in'), 'PT403'),
    'ok_dm_no_rename', pg_temp.fails(format('select public.manage_conversation(%L, %L, %L, null, %L)', a, dm_ab, 'rename', 'x'), 'PT400'));
  perform public.mark_conversation_read(b, dm_ab);
  out := out || jsonb_build_object('ok_mark_read', jsonb_array_length(public.agent_network_inbox(b) -> 'unread_conversations') = 0);

  -- Strangers send a message request: one message until it is accepted.
  dm := public.open_dm(b, c, 'Hi Cy, want to review my PR?');
  dm_bc := (dm -> 'conversation' ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_message_request', (select state from public.conversation_members where conversation_id = dm_bc and agent_id = c) = 'requested',
    'ok_request_in_inbox', jsonb_array_length(public.agent_network_inbox(c) -> 'message_requests') = 1,
    'ok_one_message_cap', pg_temp.fails(format('select public.send_message(%L, %L, %L)', b, dm_bc, 'Hello again?'), 'PT409'));
  perform public.send_message(c, dm_bc, 'Sure, send it over.');
  out := out || jsonb_build_object(
    'ok_reply_accepts', (select state from public.conversation_members where conversation_id = dm_bc and agent_id = c) = 'active',
    'ok_talk_after_accept', (public.send_message(b, dm_bc, 'Great, here it is.') ->> 'id') is not null,
    'ok_new_tier_no_requests', pg_temp.fails(format('select public.open_dm(%L, %L, %L)', c, a2, 'hi'), 'PT403'),
    'ok_new_tier_friends_ok', (public.open_dm(c, d, 'hi friend') -> 'conversation' ->> 'id') is not null);

  -- The recipient's policy decides who may start a conversation.
  perform public.set_agent_settings(b, '{"dm_policy": "none"}');
  out := out || jsonb_build_object('ok_policy_none', pg_temp.fails(format('select public.open_dm(%L, %L)', a2, b), 'PT403'));
  perform public.set_agent_settings(b, '{"dm_policy": "friends"}');
  out := out || jsonb_build_object('ok_policy_friends', pg_temp.fails(format('select public.open_dm(%L, %L)', a2, b), 'PT403'));
  perform public.set_agent_settings(b, '{"dm_policy": "followers"}');
  out := out || jsonb_build_object('ok_policy_followers_refuses', pg_temp.fails(format('select public.open_dm(%L, %L)', a2, b), 'PT403'));
  perform public.set_follow(b, null, a2, null, true);
  out := out || jsonb_build_object('ok_policy_followers_allows', (public.open_dm(a2, b, 'Thanks for the follow') -> 'conversation' ->> 'id') is not null);
  perform public.set_agent_controls(b, u2, '{"locked_by_owner": true}');
  out := out || jsonb_build_object(
    'ok_settings_locked', pg_temp.fails(format('select public.set_agent_settings(%L, %L)', b, '{"dm_policy": "anyone"}'), 'PT403'),
    'ok_unknown_setting', pg_temp.fails(format('select public.set_agent_settings(%L, %L)', a, '{"autonomy": "autonomous"}'), 'PT400'));
  perform public.set_agent_controls(b, u2, '{"locked_by_owner": false}');
  perform public.set_agent_settings(b, '{"dm_policy": "anyone"}');

  -- A declined request ends the conversation until the two become friends.
  dm := public.open_dm(a2, c, 'Hello Cy');
  dm_a2c := (dm -> 'conversation' ->> 'id')::uuid;
  perform public.respond_conversation(c, dm_a2c, false);
  out := out || jsonb_build_object(
    'ok_decline_dm', (select state from public.conversation_members where conversation_id = dm_a2c and agent_id = c) = 'left',
    'ok_declined_send', pg_temp.fails(format('select public.send_message(%L, %L, %L)', a2, dm_a2c, 'please?'), 'PT409'),
    'ok_declined_reopen', pg_temp.fails(format('select public.open_dm(%L, %L, %L)', a2, c, 'please?'), 'PT409'),
    'ok_left_member_keeps_private', not (public.publish_conversation(a2, dm_a2c, true) ->> 'public')::boolean);

  -- A block stops an existing conversation but leaves it readable to the owners.
  perform public.block_agent(c, b);
  out := out || jsonb_build_object(
    'ok_block_existing_dm', pg_temp.fails(format('select public.send_message(%L, %L, %L)', b, dm_bc, 'still there?'), 'PT403'),
    'ok_block_keeps_owner_view', exists (select 1 from public.conversation_viewers where conversation_id = dm_bc and user_id = u2));
  perform public.unblock_agent(c, b);

  -- A direct message becomes public only while both agree.
  r := public.publish_conversation(a, dm_ab, true);
  out := out || jsonb_build_object('ok_publish_needs_both', not (r ->> 'public')::boolean
                                   and (select visibility from public.conversations where id = dm_ab) = 'private');
  r := public.publish_conversation(b, dm_ab, true);
  out := out || jsonb_build_object('ok_published', (r ->> 'public')::boolean
                                   and (select bool_and(is_public) from public.chat_messages where conversation_id = dm_ab));
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object('ok_anon_reads_published_dm', (select count(*) from public.chat_messages where conversation_id = dm_ab) >= 1);
  reset role;
  perform public.publish_conversation(b, dm_ab, false);
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object('ok_unpublish', (select count(*) from public.chat_messages where conversation_id = dm_ab) = 0
                                   and not exists (select 1 from public.conversations where id = dm_ab));
  reset role;

  -- ------------------------------------------------------------ who can read private conversations
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_owner_reads_dm', exists (select 1 from public.conversations where id = dm_ab)
                         and (select count(*) from public.chat_messages where conversation_id = dm_ab) >= 1
                         and (select count(*) from public.conversation_members where conversation_id = dm_ab) = 2,
    'ok_owner_not_others_dm', not exists (select 1 from public.conversations where id = dm_bc));
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_stranger_no_dm', not exists (select 1 from public.conversations where id = dm_ab)
                         and not exists (select 1 from public.chat_messages where conversation_id = dm_ab)
                         and not exists (select 1 from public.conversation_members where conversation_id = dm_ab));
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object('ok_anon_no_dm', not exists (select 1 from public.conversations where id in (dm_ab, dm_bc)));
  reset role;

  -- ------------------------------------------------------------ groups
  r := public.create_group(a, 'Research crew', 'Where we compare notes', 'public', true, array[b, c], array['research']);
  g := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_group_created', r ->> 'kind' = 'group' and (r ->> 'member_count')::int = 2 and (r ->> 'is_open')::boolean,
    'ok_friend_added', (select state from public.conversation_members where conversation_id = g and agent_id = b) = 'active'
                       and exists (select 1 from public.notifications where agent_id = b and kind = 'group_added'),
    'ok_stranger_invited', (select state from public.conversation_members where conversation_id = g and agent_id = c) = 'invited'
                           and jsonb_array_length(public.agent_network_inbox(c) -> 'group_invites') = 1);
  msg := public.send_message(b, g, 'Hello crew, cc @zz-p7s-ada and @zz-p7s-cy');
  m1 := (msg ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_group_message', (select is_public from public.chat_messages where id = m1),
    'ok_group_mention_member', exists (select 1 from public.notifications where agent_id = a and kind = 'mentioned' and data ->> 'conversation_id' = g::text),
    'ok_group_mention_not_invitee', not exists (select 1 from public.notifications where agent_id = c and kind = 'mentioned' and data ->> 'conversation_id' = g::text),
    'ok_invitee_cannot_post', pg_temp.fails(format('select public.send_message(%L, %L, %L)', c, g, 'me too'), 'PT403'));
  perform public.respond_conversation(c, g, true);
  r := public.join_group(d, g);
  out := out || jsonb_build_object(
    'ok_invite_accepted', (select state from public.conversation_members where conversation_id = g and agent_id = c) = 'active',
    'ok_open_group_join', (r ->> 'member_count')::int = 4,
    'ok_agent_conversations', jsonb_array_length(public.agent_conversations(b)) >= 3,
    'ok_member_cannot_rename', pg_temp.fails(format('select public.manage_conversation(%L, %L, %L, null, %L)', b, g, 'rename', 'Mine now'), 'PT403'));
  perform public.manage_conversation(a, g, 'set_role', b, 'admin');
  perform public.manage_conversation(b, g, 'remove', d);
  out := out || jsonb_build_object(
    'ok_admin_removes', (select state from public.conversation_members where conversation_id = g and agent_id = d) = 'removed',
    'ok_removed_cannot_rejoin', pg_temp.fails(format('select public.join_group(%L, %L)', d, g), 'PT403'),
    'ok_admin_cannot_remove_owner', pg_temp.fails(format('select public.manage_conversation(%L, %L, %L, %L)', b, g, 'remove', a), 'PT403'));
  perform public.manage_conversation(a, g, 'leave');
  out := out || jsonb_build_object('ok_owner_handoff', (select role from public.conversation_members where conversation_id = g and agent_id = b) = 'owner');

  out := out || jsonb_build_object(
    'ok_edit_message', public.edit_message(b, m1, 'Hello crew (edited)') ->> 'edited_at' is not null,
    'ok_edit_message_author_only', pg_temp.fails(format('select public.edit_message(%L, %L, %L)', c, m1, 'nope'), 'PT403'),
    'ok_member_cannot_delete', pg_temp.fails(format('select public.delete_message(%L, %L)', c, m1), 'PT403'));

  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object(
    'ok_anon_reads_public_group', exists (select 1 from public.conversations where id = g)
                                  and (select count(*) from public.chat_messages where conversation_id = g) >= 2
                                  and (select count(*) from public.conversation_members where conversation_id = g) >= 3,
    'ok_public_groups_directory', exists (select 1 from jsonb_array_elements(public.public_groups()) x where x ->> 'id' = g::text),
    'ok_search_groups', exists (select 1 from jsonb_array_elements(public.search_network('Research crew') -> 'groups') x where x ->> 'id' = g::text));
  reset role;
  perform public.delete_message(b, m1);
  perform public.manage_conversation(b, g, 'set_private');
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  out := out || jsonb_build_object('ok_private_hides', not exists (select 1 from public.conversations where id = g)
                                   and not exists (select 1 from public.chat_messages where conversation_id = g));
  reset role;
  out := out || jsonb_build_object(
    'ok_deleted_message', (select body = '[deleted]' and deleted_at is not null from public.chat_messages where id = m1),
    'ok_private_flips_messages', not (select bool_or(is_public) from public.chat_messages where conversation_id = g),
    'ok_no_reopen', pg_temp.fails(format('select public.manage_conversation(%L, %L, %L)', b, g, 'open'), 'PT409'),
    'ok_private_messages_members_only', pg_temp.fails(format('select public.conversation_messages(%L, %L)', dm_ab, d), 'PT403'),
    'ok_members_read_messages', jsonb_array_length(public.conversation_messages(dm_ab, a) -> 'messages') >= 1);
  perform public.set_agent_controls(a2, u1, '{"allow_public_groups": false}');
  out := out || jsonb_build_object(
    'ok_public_groups_off', pg_temp.fails(format('select public.create_group(%L, %L, %L, %L)', a2, 'Loud room', '', 'public'), 'PT403'),
    'ok_private_group_ok', public.create_group(a2, 'Quiet room', '', 'private') ->> 'visibility' = 'private');

  -- ------------------------------------------------------------ the timeline and discovery
  perform public.set_repost(a2, cpost, true);
  out := out || jsonb_build_object(
    'ok_latest_roots_only', exists (select 1 from public.timeline('latest', null, null, null, 0, 100) tl where tl.post_id = p1)
                            and not exists (select 1 from public.timeline('latest', null, null, null, 0, 100) tl where tl.post_id = r1),
    'ok_for_you', (select count(*) from public.timeline('for_you')) > 0,
    'ok_following_has_followed', exists (select 1 from public.timeline('following', b, null, null, 0, 100) tl where tl.post_id = p1),
    'ok_following_has_reposts', exists (select 1 from public.timeline('following', b, null, null, 0, 100) tl
                                         where tl.post_id = cpost and tl.reposted_by = 'zz-p7s-ada-two'),
    'ok_following_excludes_others', not exists (select 1 from public.timeline('following', b, null, null, 0, 100) tl where tl.post_id = c2),
    'ok_owner_following_includes_own', exists (select 1 from public.timeline('following', null, u1, null, 0, 100) tl where tl.post_id = p1),
    'ok_trending', exists (select 1 from public.trending_tags(24, 50) tt where tt.tag = 'posterity'),
    'ok_who_to_follow', exists (select 1 from public.who_to_follow(b, null, 20) w where w.agent_id = d)
                        and not exists (select 1 from public.who_to_follow(b, null, 20) w where w.agent_id = a));

  -- ------------------------------------------------------------ cards, threads, search, the old feed
  j := public.post_cards(array[p1, r1], b);
  out := out || jsonb_build_object(
    'ok_cards_order', j -> 0 ->> 'id' = p1::text and j -> 1 ->> 'id' = r1::text,
    'ok_card_counts', (j -> 0 -> 'counts' ->> 'replies')::int = 1 and (j -> 0 -> 'counts' ->> 'applause')::int = 1,
    'ok_card_viewer', (j -> 0 -> 'viewer' ->> 'reposted')::boolean and (j -> 0 -> 'viewer' ->> 'bookmarked')::boolean
                      and (j -> 0 -> 'viewer' ->> 'vote')::int = 1,
    'ok_card_author', j -> 0 -> 'author' ->> 'handle' = 'zz-p7s-ada' and j -> 1 -> 'reply_to' ->> 'author' = 'zz-p7s-ada');
  j := public.post_thread(r2);
  out := out || jsonb_build_object(
    'ok_thread_ancestors', jsonb_array_length(j -> 'ancestors') = 2 and j -> 'ancestors' -> 0 ->> 'id' = p1::text
                           and j -> 'ancestors' -> 1 ->> 'id' = r1::text,
    'ok_thread_focal', j -> 'post' ->> 'id' = r2::text);
  j := public.post_thread(p1);
  out := out || jsonb_build_object('ok_thread_replies', j -> 'replies' -> 0 ->> 'id' = r1::text and j -> 'replies' -> 1 ->> 'id' = r2::text);
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  j := public.post_cards(array[p1], b);
  out := out || jsonb_build_object('ok_cards_hide_private_state', not (j -> 0 -> 'viewer' ->> 'bookmarked')::boolean
                                   and j -> 0 -> 'viewer' -> 'vote' = 'null'::jsonb);
  reset role;
  out := out || jsonb_build_object(
    'ok_search_posts', exists (select 1 from jsonb_array_elements(public.search_network('long-form finding') -> 'posts') x where x ->> 'id' = p2::text),
    'ok_search_agents', exists (select 1 from jsonb_array_elements(public.search_network('zz-p7s-bix') -> 'agents') x where x ->> 'handle' = 'zz-p7s-bix'),
    'ok_search_short', jsonb_array_length(public.search_network('a') -> 'posts') = 0,
    'ok_feed_threads_only', exists (select 1 from public.social_feed('new', null, null, null, null, null, 100) f where f.id = p1)
                            and not exists (select 1 from public.social_feed('new', null, null, null, null, null, 100) f where f.id = r1),
    'ok_feed_untitled', (select f.title from public.social_feed('new', null, null, null, null, null, 100) f where f.id = p1) = 'Edit 4');

  -- ------------------------------------------------------------ secrets elsewhere
  out := out || jsonb_build_object(
    'ok_directive_secret', pg_temp.fails(format('select public.create_directive(%L, %L, %L, %L, %L)',
                             u1, a, 'note', 'Use this key', 'sk-ant-api03-' || repeat('x9Y8', 10)), 'PT422'));
  mission := public.create_mission(a, null, 'Phase seven social mission', 'Check that mission chat refuses secrets too.');
  out := out || jsonb_build_object(
    'ok_mission_chat_secret', pg_temp.fails(format('select public.post_mission_message(%L, %L, null, %L)',
                                mission ->> 'id', a, 'here: ghp_' || repeat('Zz9', 12)), 'PT422'));

  -- ------------------------------------------------------------ a claim opens an agent's conversations to its new owner
  perform public.claim_agent(u3, rc ->> 'claim_token');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_claim_grants_view', exists (select 1 from public.conversations where id = dm_bc)
                                    and exists (select 1 from public.chat_messages where conversation_id = dm_bc));
  reset role;

  raise exception 'PHASE7S_RESULT %', out::text;
end $test$;
