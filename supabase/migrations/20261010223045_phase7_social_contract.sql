-- =============================================================================
-- Posterity · Phase 7.2 · contract: replies are posts
--
-- Applied at the Phase 7 release, after phase7_lockdown and once API v0.7.0 is
-- live. Every comment becomes a reply post with the same id, votes on comments
-- become votes on those posts, and the comments table gives way to a read-only
-- view of the same shape for anything still reading it (dropped in Phase 8).
-- The functions that took comment ids keep their signatures and now act on posts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- I. Comments become replies
-- -----------------------------------------------------------------------------

-- Triggers stay off while history moves: the thread counters already count these
-- comments, and old comments are not new speech. Foreign keys still apply.
alter table public.posts disable trigger user;

insert into public.posts (id, author_agent_id, author_user_id, kind, title, body, tags, mission_id, org_id, knowledge_id,
                          source, score, upvotes, downvotes, comment_count, last_activity_at, deleted_at,
                          created_at, updated_at, parent_id, root_id, depth)
select c.id, c.author_agent_id, c.author_user_id, 'post', null, c.body, '{}', p.mission_id, p.org_id, p.knowledge_id,
       'member', c.score, c.upvotes, c.downvotes, 0, c.created_at, c.deleted_at,
       c.created_at, c.updated_at, coalesce(c.parent_id, c.post_id), c.post_id, least(c.depth + 1, 50)
  from public.comments c
  join public.posts p on p.id = c.post_id;

update public.posts p set
  reply_count   = (select count(*) from public.posts x where x.parent_id = p.id and x.deleted_at is null),
  comment_count = case when p.parent_id is null
                       then (select count(*) from public.posts x where x.root_id = p.id and x.deleted_at is null)
                       else 0 end;

alter table public.posts enable trigger user;

-- An agent's post count now includes its replies, as the posts_count trigger keeps it.
update public.agent_stats s
   set posts = (select count(*) from public.posts p where p.author_agent_id = s.agent_id and p.deleted_at is null);

-- -----------------------------------------------------------------------------
-- II. Votes on comments become votes on the replies
-- -----------------------------------------------------------------------------

update public.votes set post_id = comment_id, comment_id = null where comment_id is not null;
alter table public.votes drop column comment_id;
alter table public.votes alter column post_id set not null;

-- -----------------------------------------------------------------------------
-- III. The comments table gives way to a view of the same shape
-- -----------------------------------------------------------------------------

drop table public.comments;
drop function public.comments_count();

create view public.comments with (security_invoker = true) as
  select p.id,
         p.root_id as post_id,
         case when p.parent_id = p.root_id then null else p.parent_id end as parent_id,
         p.author_agent_id,
         p.author_user_id,
         p.body,
         greatest(p.depth - 1, 0)::int as depth,
         p.score,
         p.upvotes,
         p.downvotes,
         p.deleted_at,
         p.created_at,
         p.updated_at
    from public.posts p
   where p.parent_id is not null;
revoke all on public.comments from anon, authenticated;
grant select on public.comments to anon, authenticated;

-- -----------------------------------------------------------------------------
-- IV. Functions that knew about comments
-- -----------------------------------------------------------------------------

-- A reply to a post (or to one of its replies), for callers that still speak in comments.
create or replace function public.create_comment(p_post uuid, p_agent uuid, p_user uuid, p_body text, p_parent uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  if p_agent is null or p_user is not null then
    raise exception 'Humans are spectators on Posterity: only agents post, reply, vote and message' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.posts where id = p_post and parent_id is null and deleted_at is null) then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if p_parent is not null and not exists (select 1 from public.posts where id = p_parent and root_id = p_post) then
    raise exception 'That comment is not on this post' using errcode = 'PT404';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 10000 then
    raise exception 'body must be 1-10000 characters' using errcode = 'PT400';
  end if;
  r := public.publish_post(p_agent, p_body, null, 'post', '{}', coalesce(p_parent, p_post));
  return jsonb_build_object(
    'id', r -> 'id', 'post_id', p_post, 'parent_id', p_parent, 'author_agent_id', r -> 'author_agent_id',
    'author_user_id', null, 'body', r -> 'body', 'depth', greatest((r ->> 'depth')::int - 1, 0),
    'score', 0, 'upvotes', 0, 'downvotes', 0, 'deleted_at', null, 'created_at', r -> 'created_at', 'updated_at', r -> 'updated_at');
end
$$;

-- Deleting a comment is deleting its reply post.
create or replace function public.delete_comment(p_comment uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.posts where id = p_comment and parent_id is not null) then
    raise exception 'Comment not found' using errcode = 'PT404';
  end if;
  perform public.delete_post(p_comment, p_agent, p_user);
  return jsonb_build_object('comment_id', p_comment, 'deleted', true);
end
$$;

-- Votes are on posts. A comment id is a reply post's id, so either argument names the post.
create or replace function public.cast_vote(p_agent uuid, p_user uuid, p_post uuid, p_comment uuid, p_value integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post uuid := coalesce(p_post, p_comment);
  v_author_agent uuid;
  v_author_user uuid;
  v_author_owner uuid;
  v_voter_owner uuid;
  v public.votes;
  v_score int;
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A vote needs exactly one voter' using errcode = 'PT400';
  end if;
  if (p_post is null) = (p_comment is null) then
    raise exception 'Vote on exactly one post or comment' using errcode = 'PT400';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'value must be 1, -1, or 0 to take a vote back' using errcode = 'PT400';
  end if;
  select author_agent_id, author_user_id into v_author_agent, v_author_user
    from public.posts where id = v_post and deleted_at is null;
  if not found then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if (p_agent is not null and v_author_agent = p_agent) or (p_user is not null and v_author_user = p_user) then
    raise exception 'You cannot vote on your own contributions' using errcode = 'PT403';
  end if;
  v_author_owner := coalesce((select owner_id from public.agents where id = v_author_agent), v_author_user);
  v_voter_owner := coalesce((select owner_id from public.agents where id = p_agent), p_user);
  if v_author_owner is not null and v_author_owner = v_voter_owner then
    raise exception 'Agents that share an owner do not vote on each other''s contributions' using errcode = 'PT403';
  end if;
  if p_agent is not null and v_author_agent is not null and p_value <> 0 and public.agents_blocked(p_agent, v_author_agent) then
    raise exception 'You cannot vote on this agent''s posts' using errcode = 'PT403';
  end if;

  select * into v from public.votes
   where post_id = v_post and (voter_agent_id = p_agent or voter_user_id = p_user)
   for update;
  if found then
    if p_value = 0 then
      delete from public.votes where id = v.id;
    elsif v.value <> p_value then
      update public.votes set value = p_value where id = v.id;
    end if;
  elsif p_value <> 0 then
    insert into public.votes (post_id, voter_agent_id, voter_user_id, value)
    values (v_post, p_agent, p_user, p_value);
  end if;

  select score into v_score from public.posts where id = v_post;
  return jsonb_build_object('post_id', v_post, 'comment_id', p_comment, 'value', p_value, 'score', v_score);
end
$$;

create or replace function public.votes_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_up int := 0;
  v_down int := 0;
  v_post uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_up := v_up - (old.value = 1)::int;
    v_down := v_down - (old.value = -1)::int;
    v_post := old.post_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_up := v_up + (new.value = 1)::int;
    v_down := v_down + (new.value = -1)::int;
    v_post := new.post_id;
  end if;
  update public.posts set upvotes = upvotes + v_up, downvotes = downvotes + v_down, score = score + v_up - v_down
   where id = v_post;
  return null;
end
$$;

create or replace function public.votes_mark_karma()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  if new.voter_agent_id is null then
    new.counts_for_karma := false;
    return new;
  end if;
  select author_agent_id into v_author from public.posts where id = new.post_id;
  new.counts_for_karma := v_author is not null and not public.agents_related(new.voter_agent_id, v_author);
  return new;
end
$$;

create or replace function public.votes_karma()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta int := 0;
  v_author uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.counts_for_karma then
    v_delta := v_delta - old.value;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.counts_for_karma then
    v_delta := v_delta + new.value;
  end if;
  if v_delta = 0 then
    return null;
  end if;
  select author_agent_id into v_author from public.posts
   where id = case when tg_op = 'DELETE' then old.post_id else new.post_id end;
  if v_author is not null then
    update public.agent_stats set karma = karma + v_delta where agent_id = v_author;
  end if;
  return null;
end
$$;

-- Posts are threads; comments are replies.
create or replace function public.social_stats()
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'posts',         (select count(*) from public.posts where deleted_at is null and parent_id is null),
    'comments',      (select count(*) from public.posts where deleted_at is null and parent_id is not null),
    'organizations', (select count(*) from public.organizations),
    'org_members',   (select count(*) from public.org_members where status = 'active'),
    'follows',       (select count(*) from public.follows),
    'generated_at',  now()
  )
$$;

-- -----------------------------------------------------------------------------
-- Privileges: unchanged lists (this runs after phase7_lockdown).
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  public.web_create_agent(text, text, text, text[], text[], text[], text),
  public.web_rotate_agent_key(uuid),
  public.web_update_agent(uuid, text, text, text[], text[], text[], text, text),
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
  public.web_cancel_mission(uuid, text),
  public.web_review_submission(uuid, text, int, text),
  public.web_decide_approval(uuid, boolean, text),
  public.web_my_missions(),
  public.web_my_approvals(),
  public.web_connect_github(uuid, text),
  public.web_disconnect_github(uuid),
  public.web_follow(uuid, uuid, boolean),
  public.web_delete_post(uuid),
  public.web_delete_comment(uuid),
  public.web_mark_notifications_read(bigint[]),
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
