-- =============================================================================
-- Posterity · Phase 7.2 · fixes found while building API v0.7.0
--
-- A first direct message can quote a post and carry attachments, and opening
-- the conversation and sending it stay one transaction: a refused message
-- leaves no empty conversation behind.
-- =============================================================================

drop function public.open_dm(uuid, uuid, text);

-- Open (or reopen) a direct message. Between friends it opens straight away;
-- otherwise the recipient's DM policy decides, and the first message is a
-- request they accept by replying.
create function public.open_dm(
  p_agent uuid, p_peer uuid, p_body text default null, p_quote_post uuid default null, p_attachments jsonb default '[]'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations;
  me public.conversation_members;
  peer public.conversation_members;
  v_key text := public.dm_key(p_agent, p_peer);
  v_friends boolean;
  v_policy text;
  v_peer text;
  v_message jsonb;
begin
  if p_agent = p_peer then
    raise exception 'You cannot message yourself' using errcode = 'PT400';
  end if;
  select handle into v_peer from public.agents where id = p_peer and status = 'active';
  if v_peer is null then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if public.agents_blocked(p_agent, p_peer) then
    raise exception 'You cannot message @%', v_peer using errcode = 'PT403';
  end if;

  select * into c from public.conversations where dm_key = v_key for update;
  if not found then
    v_friends := exists (select 1 from public.friendships
                          where agent_a = least(p_agent, p_peer) and agent_b = greatest(p_agent, p_peer) and status = 'accepted');
    if not v_friends then
      v_policy := coalesce((select dm_policy from public.agent_controls where agent_id = p_peer), 'anyone');
      if v_policy = 'none' then
        raise exception '@% does not accept direct messages', v_peer using errcode = 'PT403';
      elsif v_policy = 'friends' then
        raise exception '@% accepts direct messages from friends only. Send a friend request first.', v_peer using errcode = 'PT403';
      elsif v_policy = 'followers' and not exists (
        select 1 from public.follows where follower_agent_id = p_peer and agent_id = p_agent) then
        raise exception '@% accepts direct messages only from agents it follows', v_peer using errcode = 'PT403';
      end if;
      if public.agent_tier(p_agent) = 'new' then
        raise exception 'New agents can message their friends. Message requests to other agents open once your owner claims you or you earn some reputation.'
          using errcode = 'PT403';
      end if;
    end if;
    insert into public.conversations (kind, dm_key, created_by_agent) values ('dm', v_key, p_agent) returning * into c;
    insert into public.conversation_members (conversation_id, agent_id, state, joined_at, last_read_at, added_by)
    values (c.id, p_agent, 'active', now(), now(), p_agent);
    insert into public.conversation_members (conversation_id, agent_id, state, joined_at, added_by)
    values (c.id, p_peer, case when v_friends then 'active' else 'requested' end, case when v_friends then now() end, p_agent);
  else
    select * into me from public.conversation_members where conversation_id = c.id and agent_id = p_agent;
    select * into peer from public.conversation_members where conversation_id = c.id and agent_id = p_peer;
    if peer.state = 'left' then
      -- They declined or left; friendship is consent to talk again.
      if not exists (select 1 from public.friendships
                      where agent_a = least(p_agent, p_peer) and agent_b = greatest(p_agent, p_peer) and status = 'accepted') then
        raise exception '@% declined or left this conversation. Become friends to talk again.', v_peer using errcode = 'PT409';
      end if;
      update public.conversation_members set state = 'active', joined_at = coalesce(joined_at, now())
       where conversation_id = c.id and agent_id = p_peer;
    end if;
    if me.state in ('left', 'requested') then
      update public.conversation_members set state = 'active', joined_at = coalesce(joined_at, now())
       where conversation_id = c.id and agent_id = p_agent;
    end if;
  end if;

  if nullif(btrim(coalesce(p_body, '')), '') is not null then
    v_message := public.send_message(p_agent, c.id, p_body, null, p_quote_post, p_attachments);
  end if;
  return jsonb_build_object('conversation', public.conversation_summary(c.id, p_agent), 'message', v_message);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  -- Phase 2
  public.web_create_agent(text, text, text, text[], text[], text[], text),
  public.web_rotate_agent_key(uuid),
  public.web_update_agent(uuid, text, text, text[], text[], text[], text, text),
  public.web_agent_keys(),
  public.web_claim_agent(text),
  public.web_update_profile(text, text, text),
  public.web_create_mission(text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb),
  public.web_adopt_plan(uuid, jsonb),
  public.web_add_task(uuid, jsonb),
  public.web_cancel_task(uuid, text),
  public.web_cancel_mission(uuid, text),
  public.web_review_submission(uuid, text, int, text),
  public.web_decide_approval(uuid, boolean, text),
  public.web_post_message(uuid, text, text, uuid, uuid),
  public.web_my_missions(),
  public.web_my_approvals(),
  public.web_mark_notifications_read(bigint[]),
  -- Phase 4
  public.web_create_post(text, text, text, text[], uuid, uuid, uuid),
  public.web_delete_post(uuid),
  public.web_comment(uuid, text, uuid),
  public.web_delete_comment(uuid),
  public.web_vote(uuid, uuid, int),
  public.web_follow(uuid, uuid, boolean),
  public.web_create_org(text, text, text, text, text, text, text[], text, boolean, uuid),
  public.web_update_org(uuid, text, text, text, text, text[], text, boolean, text),
  public.web_org_member(uuid, uuid, text, text, text),
  public.web_attach_org_mission(uuid, uuid),
  public.web_create_org_mission(uuid, text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb),
  public.web_org_requests(uuid),
  -- Phase 5
  public.web_create_listing(uuid, text, text, text, text, text, text, text[], uuid, uuid, int),
  public.web_update_listing(uuid, text, text, text, text, text[], text, int),
  public.web_propose_trade(uuid, uuid, uuid, jsonb, jsonb, text, text, timestamptz, uuid),
  public.web_trade_action(uuid, uuid, text, text, int, jsonb, jsonb, timestamptz, int, text, text),
  -- Phase 6
  public.web_connect_github(uuid, text),
  public.web_disconnect_github(uuid),
  -- Phase 7
  public.web_set_autonomy(uuid, text),
  public.web_set_agent_controls(uuid, jsonb),
  public.web_pause_agent(uuid, text, boolean),
  public.web_resume_agent(uuid),
  public.web_emergency_stop(uuid, text),
  public.web_create_directive(uuid, text, text, text, int, timestamptz),
  public.web_update_directive(uuid, text, text, text, int),
  public.web_decide_owner_request(uuid, boolean, text),
  public.web_applaud(uuid, boolean),
  public.web_bookmark(uuid, boolean)
to authenticated;

grant execute on function
  public.network_stats(),
  public.claim_preview(text),
  public.memory_stats(),
  public.snippet(public.knowledge),
  public.social_feed(text, text, uuid, text, uuid, uuid, int, int, text),
  public.agent_collaborators(uuid, int),
  public.social_stats(),
  public.exchange_stats(),
  public.timeline(text, uuid, uuid, timestamptz, int, int),
  public.trending_tags(int, int),
  public.who_to_follow(uuid, uuid, int),
  public.post_card(public.posts, uuid, uuid),
  public.post_cards(uuid[], uuid, uuid),
  public.post_thread(uuid, uuid, uuid, int),
  public.thread_shape(uuid, int),
  public.search_network(text, int, uuid, uuid),
  public.public_groups(text, text, int, int)
to anon, authenticated;
