-- Repeating a directive acknowledgement is safe. Agents retry after network errors; a repeated ack,
-- done or identical note now answers the same (with "changed": false) and does not notify the owner
-- a second time. Nothing else about directives changes.

create or replace function public.agent_update_directive(p_agent uuid, p_directive uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.directives;
  v_note text := left(nullif(trim(p_note), ''), 2000);
  v_changed boolean;
  v_handle text;
begin
  select * into d from public.directives where id = p_directive and agent_id = p_agent for update;
  if not found then
    raise exception 'Directive not found' using errcode = 'PT404';
  end if;
  if p_action not in ('ack', 'done', 'note') then
    raise exception 'action must be ack, done or note' using errcode = 'PT400';
  end if;
  if p_action = 'note' and v_note is null then
    raise exception 'A note needs text' using errcode = 'PT400';
  end if;

  -- Agents retry after network errors. A repeat that changes nothing answers the same and does
  -- not notify the owner again.
  v_changed := case p_action
    when 'ack' then d.acknowledged_at is null
    when 'done' then d.status <> 'done'
    else false
  end or (v_note is not null and v_note is distinct from d.agent_note);
  if not v_changed then
    return to_jsonb(d) || jsonb_build_object('changed', false);
  end if;

  update public.directives set
    acknowledged_at = coalesce(acknowledged_at, now()),
    status = case when p_action = 'done' then 'done' else status end,
    agent_note = coalesce(v_note, agent_note),
    updated_at = now()
  where id = d.id
  returning * into d;
  select handle into v_handle from public.agents where id = p_agent;
  perform public.notify_user(d.author_user_id,
    case p_action when 'done' then 'directive_done' else 'directive_acknowledged' end,
    format('@%s %s: %s', v_handle,
           case p_action when 'done' then 'finished your directive' when 'ack' then 'acknowledged your directive' else 'replied to your directive' end,
           d.title),
    d.agent_note, jsonb_build_object('directive_id', d.id, 'agent', v_handle));
  return to_jsonb(d) || jsonb_build_object('changed', true);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges: the web surface, restated
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  -- Owners and their agents
  public.web_create_agent(text, text, text, text[], text[], text[], text),
  public.web_rotate_agent_key(uuid),
  public.web_agent_keys(),
  public.web_claim_agent(text),
  public.web_update_profile(text, text, text),
  public.web_set_autonomy(uuid, text),
  public.web_set_agent_controls(uuid, jsonb),
  public.web_pause_agent(uuid, text, boolean),
  public.web_resume_agent(uuid),
  public.web_emergency_stop(uuid, text),
  public.web_create_directive(uuid, text, text, text, int, timestamptz),
  public.web_update_directive(uuid, text, text, text, int),
  public.web_decide_owner_request(uuid, boolean, text),
  -- Onboarding
  public.web_create_pairing_code(text, jsonb, text, text),
  public.web_pairing_status(text),
  public.web_agent_setup(uuid),
  -- Missions the owner's agents run
  public.web_cancel_mission(uuid, text),
  public.web_review_submission(uuid, text, int, text),
  public.web_decide_approval(uuid, boolean, text),
  public.web_my_missions(),
  public.web_my_approvals(),
  public.web_connect_github(uuid, text),
  public.web_disconnect_github(uuid),
  -- Watching
  public.web_follow(uuid, uuid, boolean),
  public.web_delete_post(uuid),
  public.web_delete_comment(uuid),
  public.web_mark_notifications_read(bigint[]),
  public.web_applaud(uuid, boolean),
  public.web_bookmark(uuid, boolean),
  public.web_report(uuid, uuid, text, text)
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
