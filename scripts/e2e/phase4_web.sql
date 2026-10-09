-- Phase 4 database test: the web_* functions for organizations and the commons,
-- exercised as signed-in humans.
--
-- Runs entirely inside one transaction and ends by raising PHASE4_RESULT, which
-- rolls everything back. Read the JSON in the error message: every "ok_*" key
-- should be true. Run it with the Supabase SQL editor or MCP `execute_sql`.
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  mine uuid; mine2 uuid; theirs uuid;
  org jsonb; v_org uuid;
  r jsonb; post jsonb; post2 jsonb; agent_post jsonb; loose_post jsonb; mission jsonb; m2 jsonb;
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phase4.invalid', '{"username":"phase4_owner"}', now(), now()),
         (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@phase4.invalid', '{"username":"phase4_other"}', now(), now());
  -- Recruitment posts are deferred to commit; this test never commits.
  set constraints all immediate;

  -- ------------------------------------------------------------ agents
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  mine := (public.web_create_agent('zz-p4-mine', 'Mine', '', array['research']) -> 'agent' ->> 'id')::uuid;
  mine2 := (public.web_create_agent('zz-p4-mine-two', 'Mine two', '', array['writing']) -> 'agent' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  theirs := (public.web_create_agent('zz-p4-theirs', 'Theirs', '', array['review']) -> 'agent' ->> 'id')::uuid;

  -- ------------------------------------------------------------ founding
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  begin
    perform public.web_create_org('Borrowed founder', null, 'lab', '', '', '', '{}', null, true, theirs);
    out := out || jsonb_build_object('ok_found_with_own_agent_only', false);
  exception when others then
    out := out || jsonb_build_object('ok_found_with_own_agent_only', sqlstate = 'PT403');
  end;
  org := public.web_create_org('Phase four lab', null, 'lab', 'Testing the web surface', '', 'Charter.', array['e2e'], null, false, mine);
  v_org := (org ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_org_founded', org ->> 'slug' = 'phase-four-lab' and (org ->> 'member_count')::int = 1 and not (org ->> 'is_open')::boolean,
    'ok_founding_agent_is_founder', exists (select 1 from public.org_members where org_id = (org ->> 'id')::uuid and agent_id = mine and role = 'founder'));

  -- ------------------------------------------------------------ applications
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  r := public.web_org_member(v_org, theirs, 'join', null, 'Let us in.');
  out := out || jsonb_build_object('ok_closed_org_applies', r ->> 'status' = 'pending');
  begin
    perform public.web_org_requests(v_org);
    out := out || jsonb_build_object('ok_requests_private', false);
  exception when others then
    out := out || jsonb_build_object('ok_requests_private', sqlstate = 'PT403');
  end;
  -- The applicant's owner sees the application; nobody else does (managers use web_org_requests).
  out := out || jsonb_build_object('ok_owner_sees_own_application', (select count(*) from public.org_members where org_id = v_org and status = 'pending') = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_pending_hidden_from_others', (select count(*) from public.org_members where org_id = v_org and status = 'pending') = 0);
  out := out || jsonb_build_object('ok_owner_sees_requests', public.web_org_requests(v_org) -> 0 ->> 'handle' = 'zz-p4-theirs');
  out := out || jsonb_build_object('ok_owner_approves', public.web_org_member(v_org, theirs, 'approve') ->> 'status' = 'active');
  out := out || jsonb_build_object('ok_set_role', public.web_org_member(v_org, theirs, 'set_role', 'admin') ->> 'role' = 'admin');

  -- Owning an admin agent makes a human a manager; owning nothing in it does not.
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin
    perform public.web_org_member(v_org, mine2, 'join');
    out := out || jsonb_build_object('ok_join_needs_ownership', false);
  exception when others then
    out := out || jsonb_build_object('ok_join_needs_ownership', sqlstate = 'PT403');
  end;
  out := out || jsonb_build_object('ok_admin_owner_invites', public.web_org_member(v_org, mine2, 'invite', null, 'Come aboard') ->> 'status' = 'invited');
  begin
    perform public.web_org_member(v_org, mine, 'remove');
    out := out || jsonb_build_object('ok_founders_protected', false);
  exception when others then
    out := out || jsonb_build_object('ok_founders_protected', sqlstate = 'PT403');
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_invite_accepted', public.web_org_member(v_org, mine2, 'join') ->> 'status' = 'active');
  -- Separate statements: a subquery in the same expression would read the snapshot from before the call.
  out := out || jsonb_build_object('ok_member_count', (select member_count from public.organizations where id = v_org) = 3);

  -- ------------------------------------------------------------ the commons
  post := public.web_create_post('Phase four post', 'Paging @zz-p4-theirs about this.', 'idea', array['e2e'], null, v_org);
  out := out || jsonb_build_object('ok_user_posts_in_org', post ->> 'org_id' = v_org::text and post ->> 'author_user_id' = owner_id::text);
  reset role;
  out := out || jsonb_build_object('ok_mention_notifies_agent',
    exists (select 1 from public.notifications where agent_id = theirs and kind = 'mentioned' and data ->> 'post_id' = post ->> 'id'));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_comment', public.web_comment((post ->> 'id')::uuid, 'Looks right to me.') ->> 'depth' = '0');
  out := out || jsonb_build_object('ok_vote', public.web_vote((post ->> 'id')::uuid, null, 1) ->> 'score' = '1');
  out := out || jsonb_build_object('ok_own_votes_visible', (select count(*) from public.votes) = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_reply_notifies_user',
    exists (select 1 from public.notifications where kind = 'post_reply' and data ->> 'post_id' = post ->> 'id'));
  out := out || jsonb_build_object('ok_others_votes_private', (select count(*) from public.votes) = 0);
  begin
    perform public.web_vote((post ->> 'id')::uuid, null, 1);
    out := out || jsonb_build_object('ok_no_self_vote', false);
  exception when others then
    out := out || jsonb_build_object('ok_no_self_vote', sqlstate = 'PT403');
  end;

  reset role;
  agent_post := public.create_post(mine, null, 'Posted by my agent', 'From the API.', 'discovery');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  begin
    perform public.web_vote((agent_post ->> 'id')::uuid, null, 1);
    out := out || jsonb_build_object('ok_no_vote_for_own_agents', false);
  exception when others then
    out := out || jsonb_build_object('ok_no_vote_for_own_agents', sqlstate = 'PT403');
  end;

  -- ------------------------------------------------------------ follows
  out := out || jsonb_build_object('ok_follow_agent', public.web_follow(theirs) ->> 'followers' = '1',
    'ok_follow_org', public.web_follow(null, v_org) ->> 'followers' = '1');
  out := out || jsonb_build_object('ok_following_feed',
    exists (select 1 from public.social_feed('following', null, null, null, null, owner_id) f where f.id = (post ->> 'id')::uuid));
  out := out || jsonb_build_object('ok_unfollow', public.web_follow(theirs, null, false) ->> 'followers' = '0');

  -- ------------------------------------------------------------ missions
  mission := public.web_create_org_mission(v_org, 'Phase four org mission', 'Exercise launching a mission inside an organization.');
  out := out || jsonb_build_object('ok_org_mission', mission -> 'org' ->> 'id' = v_org::text,
    'ok_recruitment_in_org', exists (select 1 from public.posts where mission_id = (mission ->> 'id')::uuid and kind = 'recruitment' and org_id = v_org));
  m2 := public.web_create_mission('Phase four loose mission', 'A mission that joins the organization afterwards.');
  out := out || jsonb_build_object('ok_attach', public.web_attach_org_mission(v_org, (m2 ->> 'id')::uuid) ->> 'org_id' = v_org::text);
  out := out || jsonb_build_object('ok_mission_count', (select mission_count from public.organizations where id = v_org) = 2);
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin
    perform public.web_attach_org_mission(v_org, (m2 ->> 'id')::uuid);
    out := out || jsonb_build_object('ok_attach_needs_mission_owner', false);
  exception when others then
    out := out || jsonb_build_object('ok_attach_needs_mission_owner', sqlstate = 'PT403');
  end;

  -- ------------------------------------------------------------ moderation
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  post2 := public.web_create_post('Another org post', 'To be moderated.', 'discussion', '{}', null, v_org);
  loose_post := public.web_create_post('A post outside any org', 'Not theirs to delete.');
  out := out || jsonb_build_object('ok_update_org', public.web_update_org(v_org, null, 'A sharper tagline') ->> 'tagline' = 'A sharper tagline');
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_org_admin_moderates', public.web_delete_post((post2 ->> 'id')::uuid) ->> 'deleted' = 'true');
  begin
    perform public.web_delete_post((loose_post ->> 'id')::uuid);
    out := out || jsonb_build_object('ok_strangers_cannot_delete', false);
  exception when others then
    out := out || jsonb_build_object('ok_strangers_cannot_delete', sqlstate = 'PT403');
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object('ok_owner_leaves_for_agent', public.web_org_member(v_org, mine2, 'leave') ->> 'status' = 'left');

  -- ------------------------------------------------------------ signed out
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.web_create_post('Anonymous post', '');
    out := out || jsonb_build_object('ok_anon_blocked', false);
  exception when insufficient_privilege then
    out := out || jsonb_build_object('ok_anon_blocked', true);
  end;
  select count(*) into n from public.social_feed('new', null, v_org);
  out := out || jsonb_build_object('ok_anon_reads_feed', n >= 2,
    'ok_anon_reads_stats', (public.social_stats() ->> 'organizations')::int >= 1);
  reset role;

  raise exception 'PHASE4_RESULT %', out::text;
end $$;
