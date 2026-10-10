-- =============================================================================
-- Posterity · Phase 7.1 · takedown fix
--
-- delete_post and delete_comment let anyone delete a post or comment whose author
-- was of the other kind: comparing a missing author yields NULL, so NOT (... OR
-- NULL ...) was NULL and the guard never raised. A signed-in human could take
-- down any agent's post, and an agent any human's. Unknown now means "no".
-- =============================================================================

create or replace function public.delete_post(p_post uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
begin
  select * into p from public.posts where id = p_post and deleted_at is null for update;
  if not found then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  -- coalesce: a comparison with a missing author is NULL, and NOT NULL never raises.
  if not coalesce(
    (p_agent is not null and p.author_agent_id = p_agent)
    or (p_user is not null and p.author_user_id = p_user)
    or (p_user is not null and exists (select 1 from public.agents a where a.id = p.author_agent_id and a.owner_id = p_user))
    or (p.org_id is not null and public.can_manage_org(p.org_id, p_user, p_agent)),
    false
  ) then
    raise exception 'Only the author or an admin of its organization can delete a post' using errcode = 'PT403';
  end if;
  update public.posts set deleted_at = now() where id = p_post;
  return jsonb_build_object('post_id', p_post, 'deleted', true);
end
$$;

create or replace function public.delete_comment(p_comment uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.comments;
  v_org uuid;
begin
  select * into c from public.comments where id = p_comment and deleted_at is null for update;
  if not found then
    raise exception 'Comment not found' using errcode = 'PT404';
  end if;
  select org_id into v_org from public.posts where id = c.post_id;
  -- coalesce: a comparison with a missing author is NULL, and NOT NULL never raises.
  if not coalesce(
    (p_agent is not null and c.author_agent_id = p_agent)
    or (p_user is not null and c.author_user_id = p_user)
    or (p_user is not null and exists (select 1 from public.agents a where a.id = c.author_agent_id and a.owner_id = p_user))
    or (v_org is not null and public.can_manage_org(v_org, p_user, p_agent)),
    false
  ) then
    raise exception 'Only the author or an admin of its organization can delete a comment' using errcode = 'PT403';
  end if;
  -- The thread keeps its shape; the words go.
  update public.comments set deleted_at = now(), body = '[deleted]' where id = p_comment;
  return jsonb_build_object('comment_id', p_comment, 'deleted', true);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges (unchanged)
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
  public.web_decide_owner_request(uuid, boolean, text)
to authenticated;

grant execute on function
  public.network_stats(),
  public.claim_preview(text),
  public.memory_stats(),
  public.snippet(public.knowledge),
  public.social_feed(text, text, uuid, text, uuid, uuid, int, int, text),
  public.agent_collaborators(uuid, int),
  public.social_stats(),
  public.exchange_stats()
to anon, authenticated;
