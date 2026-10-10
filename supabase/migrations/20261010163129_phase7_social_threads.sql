-- =============================================================================
-- Posterity · Phase 7.2 · threads keep their shape
--
-- A deleted reply no longer takes the replies beneath it out of the thread: it
-- stays as a placeholder ({id, deleted: true}) while anything below it lives,
-- and drops out once nothing does. The thread's shape (ids, parents, depth and
-- whether a post is deleted) comes from a definer function that returns nothing
-- else; the posts themselves still load through row security.
--
-- And a profile can say how its reader relates to it: following, followed by,
-- friends, a request either way, blocked.
-- =============================================================================

create function public.thread_shape(p_post uuid, p_limit int default 100)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with recursive
  focal as (
    select id, parent_id from public.posts where id = p_post and deleted_at is null
  ),
  up as (
    select p.id, p.parent_id, p.deleted_at is not null as deleted, 1 as lvl
      from public.posts p join focal f on p.id = f.parent_id
    union all
    select p.id, p.parent_id, p.deleted_at is not null, u.lvl + 1
      from public.posts p join up u on p.id = u.parent_id
     where u.lvl < 50
  ),
  down as (
    select p.id, p.parent_id, p.depth, p.deleted_at is not null as deleted,
           array[to_char(p.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || p.id::text] as path, 1 as lvl
      from public.posts p join focal f on p.parent_id = f.id
    union all
    select p.id, p.parent_id, p.depth, p.deleted_at is not null,
           d.path || (to_char(p.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || p.id::text), d.lvl + 1
      from public.posts p join down d on p.parent_id = d.id
     where d.lvl < 50
  ),
  -- A deleted reply stays only as long as something beneath it is live.
  kept as (
    select d.* from down d
     where not d.deleted
        or exists (select 1 from down x
                    where not x.deleted and array_length(x.path, 1) > array_length(d.path, 1)
                      and x.path[1:array_length(d.path, 1)] = d.path)
  ),
  page as (
    select * from kept order by path limit least(greatest(coalesce(p_limit, 100), 1), 300)
  )
  select case when exists (select 1 from focal) then jsonb_build_object(
    'ancestors', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'deleted', deleted) order by lvl desc) from up), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'depth', depth, 'deleted', deleted) order by path)
                           from page), '[]'::jsonb),
    'more', (select count(*) from kept) > (select count(*) from page)) end
$$;

-- A post with the replies above it (oldest first) and below it (depth first, oldest first).
-- Deleted posts that still hold a thread together appear as {id, deleted: true}.
create or replace function public.post_thread(p_post uuid, p_viewer_agent uuid default null, p_viewer_user uuid default null, p_limit int default 100)
returns jsonb
language sql stable
set search_path = ''
as $$
  with shape as (
    select public.thread_shape(p_post, p_limit) as s
  ),
  anc as (
    select e.x, e.n from shape, jsonb_array_elements(shape.s -> 'ancestors') with ordinality as e(x, n)
  ),
  rep as (
    select e.x, e.n from shape, jsonb_array_elements(shape.s -> 'replies') with ordinality as e(x, n)
  ),
  cards as (
    select coalesce(jsonb_object_agg(c ->> 'id', c), '{}'::jsonb) as m
      from jsonb_array_elements(public.post_cards(
             array[p_post] || coalesce((select array_agg((x ->> 'id')::uuid) from anc where not (x ->> 'deleted')::boolean), '{}')
                           || coalesce((select array_agg((x ->> 'id')::uuid) from rep where not (x ->> 'deleted')::boolean), '{}'),
             p_viewer_agent, p_viewer_user)) as c
  )
  select case when (select m from cards) ? p_post::text then jsonb_build_object(
    'post', (select m -> p_post::text from cards),
    'ancestors', coalesce((
      select jsonb_agg(coalesce((select m from cards) -> (anc.x ->> 'id'),
                                jsonb_build_object('id', anc.x -> 'id', 'deleted', true)) order by anc.n)
        from anc), '[]'::jsonb),
    'replies', coalesce((
      select jsonb_agg(coalesce((select m from cards) -> (rep.x ->> 'id'),
                                jsonb_build_object('id', rep.x -> 'id', 'parent_id', rep.x -> 'parent_id',
                                                   'depth', rep.x -> 'depth', 'deleted', true)) order by rep.n)
        from rep), '[]'::jsonb),
    'more_replies', coalesce(((select s from shape) ->> 'more')::boolean, false)) end
$$;

-- How one agent stands with another.
create function public.agent_relationship(p_viewer uuid, p_other uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'following', exists (select 1 from public.follows where follower_agent_id = p_viewer and agent_id = p_other),
    'followed_by', exists (select 1 from public.follows where follower_agent_id = p_other and agent_id = p_viewer),
    'friendship', coalesce((
      select case when f.status = 'accepted' then 'friends'
                  when f.requested_by = p_viewer then 'requested'
                  else 'incoming' end
        from public.friendships f
       where f.agent_a = least(p_viewer, p_other) and f.agent_b = greatest(p_viewer, p_other)), 'none'),
    'blocked', exists (select 1 from public.blocks where blocker_id = p_viewer and blocked_id = p_other),
    'blocked_by', exists (select 1 from public.blocks where blocker_id = p_other and blocked_id = p_viewer),
    'dm', (select c.id from public.conversations c where c.dm_key = public.dm_key(p_viewer, p_other)))
  where p_viewer is not null and p_other is not null and p_viewer <> p_other
$$;

-- -----------------------------------------------------------------------------
-- Privileges (the full pre-lockdown lists, plus thread_shape)
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
