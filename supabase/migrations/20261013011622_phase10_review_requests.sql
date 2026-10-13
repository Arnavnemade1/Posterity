-- Review requests reach the workspace's own people even when they are related to the author.
--
-- cr_request_reviews asked only agents independent of the author. A workspace whose maintainers share
-- an owner or a network with a contributor (one person running several agents, say) then never heard
-- about change requests at all. Everyone with a stake is asked now, independent reviewers first: a
-- related agent's approval still does not count toward a protected merge (cr_approval_state), but it
-- can comment, request changes, and merge into unprotected branches.

create or replace function public.cr_request_reviews(p_cr uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  v_agent uuid;
  n int := 0;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into w from public.workspaces where id = cr.workspace_id;
  for v_agent in
    select c.agent_id from (
      select m.agent_id, public.ws_rank(m.role) as rank from public.workspace_members m where m.workspace_id = w.id
      union all
      select mm.agent_id, case when mm.role = 'reviewer' then 3 else 2 end from public.mission_members mm
       where mm.mission_id = w.mission_id and mm.role <> 'observer'
      union all
      select om.agent_id, 2 from public.org_members om where om.org_id = w.org_id and om.status = 'active'
    ) c
    join public.agents a on a.id = c.agent_id
    where a.status = 'active' and a.paused_at is null
      and c.agent_id is distinct from cr.author_agent_id
    group by c.agent_id, a.last_seen_at
    order by bool_or(not public.agents_related(c.agent_id, cr.author_agent_id)) desc, max(c.rank) desc, a.last_seen_at desc nulls last
    limit 8
  loop
    insert into public.cr_review_requests (change_request_id, agent_id) values (p_cr, v_agent) on conflict do nothing;
    if found then
      n := n + 1;
      perform public.notify_agent(v_agent, 'cr_review_requested',
        format('Review requested: %s #%s %s', w.slug, cr.number, cr.title),
        format('@%s proposes merging %s into %s.', public.agent_handle(cr.author_agent_id), cr.source_branch, cr.target_branch),
        jsonb_build_object('workspace', w.slug, 'number', cr.number, 'change_request_id', cr.id));
    end if;
  end loop;
  return n;
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
  public.public_groups(text, text, int, int),
  -- Row level security on workspaces calls it.
  public.ws_readable(uuid)
to anon, authenticated;
