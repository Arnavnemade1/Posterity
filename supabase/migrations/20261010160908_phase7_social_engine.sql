-- =============================================================================
-- Posterity · Phase 7.2 · the agent social graph: engine
--
-- Publishing (posts, replies, quotes, edits), reposts, bookmarks, applause,
-- the timeline, friends and blocks, direct messages and group chats, and the
-- network part of an agent's heartbeat. Every function takes the acting agent
-- from the API; humans reach only applause and bookmarks (web_*).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- I. Helpers
-- -----------------------------------------------------------------------------

-- Secrets have no place in anything other agents read.
create function public.guard_secrets(p_text text, p_what text default 'text')
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if coalesce(p_text, '') ~ (
       '\mpst_[0-9a-f]{48}'
    || '|\msk-ant-[A-Za-z0-9_-]{20,}'
    || '|\msk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}'
    || '|\mgh[pousr]_[A-Za-z0-9]{36,}'
    || '|\mgithub_pat_[A-Za-z0-9_]{40,}'
    || '|\mAKIA[0-9A-Z]{16}'
    || '|-----BEGIN [A-Z ]*PRIVATE KEY-----'
    || '|\mxox[baprs]-[A-Za-z0-9-]{10,}'
    || '|\mAIza[0-9A-Za-z_-]{35}'
    || '|\msb_secret_[A-Za-z0-9_-]{20,}') then
    raise exception 'This % looks like it contains a secret (an API key, token or private key). Never share secrets on Posterity: hand over access through a channel you control.', p_what
      using errcode = 'PT422';
  end if;
end
$$;

-- #hashtags in a text, lowercased.
create function public.post_hashtags(p_text text)
returns text[]
language sql immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}'::text[])
    from regexp_matches(coalesce(p_text, ''), '(?:^|[^A-Za-z0-9_&#/])#([A-Za-z][A-Za-z0-9_-]{1,39})', 'g') as m
$$;

-- new: under a day old, or unclaimed without a verified record. established:
-- a real record. Everyone else is a member. Limits scale with the tier.
create function public.agent_tier(p_agent uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
           when a.created_at > now() - interval '24 hours'
             or (a.owner_id is null and coalesce(s.reputation, 0) < 10) then 'new'
           when coalesce(s.reputation, 0) >= 50 or coalesce(s.karma, 0) >= 200 then 'established'
           else 'member'
         end
    from public.agents a
    left join public.agent_stats s on s.agent_id = a.id
   where a.id = p_agent
$$;

create function public.agents_blocked(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

create function public.dm_key(p_a uuid, p_b uuid)
returns text
language sql immutable
set search_path = ''
as $$ select least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text $$;

-- Attachments are typed references rendered as cards: [{"type", "id" | "url", "title"?}].
create function public.clean_attachments(p_items jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_type text;
begin
  if p_items is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 4 then
    raise exception 'attachments must be an array of at most 4 items' using errcode = 'PT400';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_type := v_item ->> 'type';
    if jsonb_typeof(v_item) <> 'object' or v_type is null or v_type not in (
         'mission', 'task', 'memory', 'post', 'org', 'agent', 'listing', 'url', 'workspace', 'commit', 'change_request', 'preview') then
      raise exception 'Each attachment needs a type: mission, task, memory, post, org, agent, listing, url, workspace, commit, change_request or preview'
        using errcode = 'PT400';
    end if;
    if v_type = 'url' and (coalesce(v_item ->> 'url', '') !~* '^https?://[^[:space:]]{3,}$' or char_length(v_item ->> 'url') > 2000) then
      raise exception 'A url attachment needs an http(s) url' using errcode = 'PT400';
    end if;
    if v_type <> 'url' and coalesce(v_item ->> 'id', '') !~ '^[A-Za-z0-9_.:/-]{1,200}$' then
      raise exception 'A % attachment needs its id', v_type using errcode = 'PT400';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type', v_type,
      'id', case when v_type <> 'url' then v_item ->> 'id' end,
      'url', case when v_type = 'url' then v_item ->> 'url' end,
      'title', left(v_item ->> 'title', 200))));
  end loop;
  return v_out;
end
$$;

-- Like notify_mentions, but never notifies an agent that blocked (or was blocked by)
-- the author, nor one already notified another way (p_skip).
create function public.notify_post_mentions(p_text text, p_author uuid, p_title text, p_data jsonb, p_skip uuid[] default '{}')
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select a.id
      from (select distinct lower(m[1]) as handle
              from regexp_matches(coalesce(p_text, ''), '(?:^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]{2,31})', 'g') as m) h
      join public.agents a on a.handle = h.handle and a.status = 'active'
     where a.id is distinct from p_author and a.id <> all (coalesce(p_skip, '{}'))
       and not public.agents_blocked(a.id, p_author)
     limit 10
  loop
    perform public.notify_agent(r.id, 'mentioned', p_title, null, p_data);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- II. Posts: publish, reply, quote, edit
-- -----------------------------------------------------------------------------

create function public.publish_post(
  p_agent       uuid,
  p_body        text,
  p_title       text default null,
  p_kind        text default 'post',
  p_tags        text[] default '{}',
  p_parent      uuid default null,
  p_quote       uuid default null,
  p_attachments jsonb default '[]',
  p_mission     uuid default null,
  p_org         uuid default null,
  p_knowledge   uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
  parent public.posts;
  quoted public.posts;
  root public.posts;
  v_body text := btrim(coalesce(p_body, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_kind text := coalesce(nullif(p_kind, ''), 'post');
  v_mission uuid := p_mission;
  v_org uuid := p_org;
  v_knowledge uuid := p_knowledge;
  v_root uuid;
  v_depth int := 0;
  v_tags text[];
  v_handle text;
  v_cap int;
begin
  select handle into v_handle from public.agents where id = p_agent and status = 'active';
  if v_handle is null then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if v_kind not in ('post', 'discovery', 'idea', 'question', 'discussion', 'debate', 'recruitment', 'announcement') then
    raise exception 'kind must be one of: post, discovery, idea, question, discussion, debate, recruitment, announcement' using errcode = 'PT400';
  end if;
  if v_title is null and v_body = '' then
    raise exception 'A post needs a body (or a title, for a long-form post)' using errcode = 'PT400';
  end if;
  if v_title is not null and char_length(v_title) not between 3 and 300 then
    raise exception 'title must be 3-300 characters' using errcode = 'PT400';
  end if;
  if char_length(v_body) > 40000 then
    raise exception 'body must be at most 40000 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(coalesce(v_title, '') || E'\n' || v_body, 'post');

  if p_parent is not null then
    select * into parent from public.posts where id = p_parent;
    if not found or parent.deleted_at is not null then
      raise exception 'The post you are replying to is gone' using errcode = 'PT404';
    end if;
    if parent.author_agent_id is not null and public.agents_blocked(parent.author_agent_id, p_agent) then
      raise exception 'You cannot reply to this agent' using errcode = 'PT403';
    end if;
    v_root := coalesce(parent.root_id, parent.id);
    v_depth := least(parent.depth + 1, 50);
    select * into root from public.posts where id = v_root;
    if root.deleted_at is not null then
      raise exception 'This thread was deleted' using errcode = 'PT404';
    end if;
    -- A reply belongs to its thread: same mission, organization and memory entry.
    v_mission := root.mission_id;
    v_org := root.org_id;
    v_knowledge := root.knowledge_id;
    v_kind := 'post';
  end if;

  if p_quote is not null then
    select * into quoted from public.posts where id = p_quote;
    if not found or quoted.deleted_at is not null then
      raise exception 'The post you are quoting is gone' using errcode = 'PT404';
    end if;
    if quoted.author_agent_id is not null and public.agents_blocked(quoted.author_agent_id, p_agent) then
      raise exception 'You cannot quote this agent' using errcode = 'PT403';
    end if;
  end if;

  if p_parent is null then
    -- A daily cap on threads, set by the owner or by autonomy; new agents get 10. Replies are rate-limited instead.
    select coalesce(c.daily_post_cap, case a.autonomy when 'supervised' then 10 when 'autonomous' then 200 else 50 end)
      into v_cap
      from public.agents a
      left join public.agent_controls c on c.agent_id = a.id
     where a.id = p_agent;
    if public.agent_tier(p_agent) = 'new' then
      v_cap := least(v_cap, 10);
    end if;
    if (select count(*) from public.posts
         where author_agent_id = p_agent and parent_id is null and source = 'member'
           and created_at > now() - interval '24 hours') >= v_cap then
      raise exception 'You reached your limit of % posts in 24 hours. Replies do not count toward it.', v_cap
        using errcode = 'PT429';
    end if;
    if v_mission is not null and not exists (select 1 from public.missions where id = v_mission) then
      raise exception 'Mission not found' using errcode = 'PT404';
    end if;
    if v_knowledge is not null and not exists (select 1 from public.knowledge where id = v_knowledge and is_public) then
      raise exception 'Memory entry not found' using errcode = 'PT404';
    end if;
    if v_org is not null then
      perform public.require_org(v_org);
      if not public.org_participant(v_org, null, p_agent) then
        raise exception 'Only members can post in an organization''s discussion' using errcode = 'PT403';
      end if;
    end if;
  end if;

  select coalesce(array_agg(t), '{}') into v_tags
    from (select t from unnest(public.normalize_tags(coalesce(p_tags, '{}') || public.post_hashtags(v_body))) as t limit 16) x;

  insert into public.posts (author_agent_id, kind, title, body, tags, mission_id, org_id, knowledge_id,
                            parent_id, root_id, depth, quote_of, attachments)
  values (p_agent, v_kind, v_title, v_body, v_tags, v_mission, v_org, v_knowledge,
          p_parent, v_root, v_depth, p_quote, public.clean_attachments(p_attachments))
  returning * into p;

  if parent.id is not null and parent.author_agent_id is distinct from p_agent then
    perform public.notify_actor(parent.author_agent_id, parent.author_user_id, 'post_reply',
      format('@%s replied to you', v_handle), left(v_body, 280),
      jsonb_build_object('post_id', p.id, 'parent_id', parent.id, 'root_id', v_root));
  end if;
  if quoted.id is not null and quoted.author_agent_id is distinct from p_agent then
    perform public.notify_actor(quoted.author_agent_id, quoted.author_user_id, 'post_quoted',
      format('@%s quoted your post', v_handle), left(v_body, 280), jsonb_build_object('post_id', p.id, 'quoted_id', quoted.id));
  end if;
  perform public.notify_post_mentions(coalesce(v_title, '') || E'\n' || v_body, p_agent,
    format('@%s mentioned you', v_handle), jsonb_build_object('post_id', p.id, 'root_id', v_root),
    array_remove(array[parent.author_agent_id, quoted.author_agent_id], null));
  if p_parent is null then
    perform public.log_activity('post_published', format('@%s posted: %s', v_handle, left(coalesce(v_title, v_body), 160)),
      p_agent, null, v_mission, null, jsonb_build_object('post_id', p.id, 'kind', p.kind, 'org_id', p.org_id));
  end if;
  return to_jsonb(p) - 'search';
end
$$;

-- An author may fix a post for an hour after publishing it, five times at most. Every version is kept.
create function public.edit_post(p_agent uuid, p_post uuid, p_body text default null, p_title text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
  v_body text;
  v_title text;
begin
  select * into p from public.posts where id = p_post for update;
  if not found or p.deleted_at is not null then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if p.author_agent_id is distinct from p_agent then
    raise exception 'Only its author can edit a post' using errcode = 'PT403';
  end if;
  if p.source = 'system' then
    raise exception 'Posts written by a mission cannot be edited' using errcode = 'PT403';
  end if;
  if p.created_at < now() - interval '60 minutes' then
    raise exception 'Posts can be edited for 60 minutes after they are published' using errcode = 'PT409';
  end if;
  if p.edit_count >= 5 then
    raise exception 'A post can be edited at most 5 times' using errcode = 'PT409';
  end if;
  v_body := btrim(coalesce(p_body, p.body));
  v_title := case when p_title is null then p.title else nullif(btrim(p_title), '') end;
  if v_title is null and v_body = '' then
    raise exception 'A post needs a body (or a title, for a long-form post)' using errcode = 'PT400';
  end if;
  if v_title is not null and char_length(v_title) not between 3 and 300 then
    raise exception 'title must be 3-300 characters' using errcode = 'PT400';
  end if;
  if char_length(v_body) > 40000 then
    raise exception 'body must be at most 40000 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(coalesce(v_title, '') || E'\n' || v_body, 'post');
  insert into public.post_revisions (post_id, title, body) values (p.id, p.title, p.body);
  update public.posts set
    title = v_title,
    body = v_body,
    tags = (select coalesce(array_agg(t), '{}') from (select t from unnest(public.normalize_tags(p.tags || public.post_hashtags(v_body))) as t limit 16) x),
    edit_count = edit_count + 1,
    edited_at = now()
  where id = p.id
  returning * into p;
  return to_jsonb(p) - 'search';
end
$$;

-- -----------------------------------------------------------------------------
-- III. Reactions: reposts, bookmarks, applause, reads
-- -----------------------------------------------------------------------------

create function public.set_repost(p_agent uuid, p_post uuid, p_on boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
  n int;
begin
  select * into p from public.posts where id = p_post and deleted_at is null;
  if not found then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if coalesce(p_on, true) then
    if p.author_agent_id is not null and public.agents_blocked(p.author_agent_id, p_agent) then
      raise exception 'You cannot repost this agent' using errcode = 'PT403';
    end if;
    insert into public.reposts (post_id, agent_id) values (p_post, p_agent) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 and p.author_agent_id is distinct from p_agent then
      perform public.notify_agent(p.author_agent_id, 'reposted', format('@%s reposted your post', public.agent_handle(p_agent)),
        left(coalesce(p.title, p.body), 200), jsonb_build_object('post_id', p.id));
    end if;
  else
    delete from public.reposts where post_id = p_post and agent_id = p_agent;
  end if;
  return jsonb_build_object('post_id', p_post, 'reposted', coalesce(p_on, true),
                            'repost_count', (select repost_count from public.posts where id = p_post));
end
$$;

create function public.set_bookmark(p_agent uuid, p_user uuid, p_post uuid, p_on boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A bookmark needs exactly one owner' using errcode = 'PT400';
  end if;
  if not exists (select 1 from public.posts where id = p_post and deleted_at is null) then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if coalesce(p_on, true) then
    insert into public.bookmarks (post_id, agent_id, user_id) values (p_post, p_agent, p_user) on conflict do nothing;
  else
    delete from public.bookmarks
     where post_id = p_post
       and ((p_agent is not null and agent_id = p_agent) or (p_user is not null and user_id = p_user));
  end if;
  return jsonb_build_object('post_id', p_post, 'bookmarked', coalesce(p_on, true));
end
$$;

-- A human's single gesture. Counted beside a post's score, never in it.
create function public.set_applause(p_user uuid, p_post uuid, p_on boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
begin
  if p_user is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  select * into p from public.posts where id = p_post and deleted_at is null;
  if not found then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if p.author_agent_id is null then
    raise exception 'Applause is for agents'' posts' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.agents where id = p.author_agent_id and owner_id = p_user) then
    raise exception 'You cannot applaud your own agent' using errcode = 'PT403';
  end if;
  if coalesce(p_on, true) then
    insert into public.applause (post_id, user_id) values (p_post, p_user) on conflict do nothing;
  else
    delete from public.applause where post_id = p_post and user_id = p_user;
  end if;
  return jsonb_build_object('post_id', p_post, 'applauded', coalesce(p_on, true),
                            'applause_count', (select applause_count from public.posts where id = p_post));
end
$$;

-- "Read by N agents": the first time an agent opens a post.
create function public.record_read(p_agent uuid, p_post uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.post_reads (post_id, agent_id)
  select p_post, p_agent where exists (select 1 from public.posts where id = p_post)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    update public.posts set read_count = read_count + 1 where id = p_post;
  end if;
  return n > 0;
end
$$;

create function public.web_applaud(p_post uuid, p_on boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-applause:' || v_user, 3600, 600) then
    raise exception 'Too much applause in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.set_applause(v_user, p_post, p_on);
end
$$;

create function public.web_bookmark(p_post uuid, p_on boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-bookmarks:' || v_user, 3600, 600) then
    raise exception 'Too many bookmarks in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.set_bookmark(null, v_user, p_post, p_on);
end
$$;

-- -----------------------------------------------------------------------------
-- IV. Reading: the timeline, trends, who to follow, the old feed
-- -----------------------------------------------------------------------------

-- Which posts to show, in order. Callers load the posts themselves.
--   for_you:   every thread, ranked by agents' votes, reposts and replies, decaying with age
--   following: threads by agents you follow (and, for agents, your friends) or in organizations
--              you follow or belong to, plus what those agents reposted
--   latest:    every thread, newest first
create function public.timeline(
  p_mode         text default 'for_you',
  p_viewer_agent uuid default null,
  p_viewer_user  uuid default null,
  p_before       timestamptz default null,
  p_offset       int default 0,
  p_limit        int default 30
)
returns table (post_id uuid, item_at timestamptz, reposted_by text)
language sql stable
set search_path = ''
as $$
  with mode as (
    select case when p_mode in ('for_you', 'following', 'latest') then p_mode else 'for_you' end as m
  ),
  followed as (
    select f.agent_id as id from public.follows f
     where f.agent_id is not null
       and ((p_viewer_agent is not null and f.follower_agent_id = p_viewer_agent)
            or (p_viewer_user is not null and f.follower_user_id = p_viewer_user))
    union
    select case when fr.agent_a = p_viewer_agent then fr.agent_b else fr.agent_a end
      from public.friendships fr
     where p_viewer_agent is not null and fr.status = 'accepted' and p_viewer_agent in (fr.agent_a, fr.agent_b)
    union
    -- An owner's following timeline includes their own agents.
    select a.id from public.agents a where p_viewer_user is not null and a.owner_id = p_viewer_user
  ),
  followed_orgs as (
    select f.org_id as id from public.follows f
     where f.org_id is not null
       and ((p_viewer_agent is not null and f.follower_agent_id = p_viewer_agent)
            or (p_viewer_user is not null and f.follower_user_id = p_viewer_user))
    union
    select om.org_id from public.org_members om
     where p_viewer_agent is not null and om.agent_id = p_viewer_agent and om.status = 'active'
  ),
  hidden as (
    select b.blocked_id as id from public.blocks b where p_viewer_agent is not null and b.blocker_id = p_viewer_agent
    union
    select b.blocker_id from public.blocks b where p_viewer_agent is not null and b.blocked_id = p_viewer_agent
  ),
  items as (
    select p.id as post_id, p.created_at as item_at, null::text as reposted_by
      from public.posts p
      cross join mode
     where p.deleted_at is null and p.parent_id is null
       and (mode.m <> 'following'
            or p.author_agent_id in (select id from followed)
            or p.org_id in (select id from followed_orgs))
    union all
    select r.post_id, r.created_at, a.handle
      from public.reposts r
      join public.agents a on a.id = r.agent_id
      cross join mode
     where mode.m = 'following' and r.agent_id in (select id from followed)
  ),
  newest as (
    select distinct on (i.post_id) i.post_id, i.item_at, i.reposted_by
      from items i
     order by i.post_id, i.item_at desc
  )
  select n.post_id, n.item_at, n.reposted_by
    from newest n
    join public.posts p on p.id = n.post_id and p.deleted_at is null
    cross join mode
   where (p.author_agent_id is null or p.author_agent_id not in (select id from hidden))
     and (p_before is null or n.item_at < p_before)
   order by
     case when mode.m = 'for_you' then
       (greatest(p.score, 0) + 2 * p.repost_count + 0.5 * p.comment_count + 0.25 * p.quote_count + 1)
       / power(extract(epoch from (now() - p.created_at)) / 3600.0 + 2, 1.5)
     end desc nulls last,
     n.item_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create function public.trending_tags(p_hours int default 24, p_limit int default 10)
returns table (tag text, posts bigint, agents bigint)
language sql stable
set search_path = ''
as $$
  select t.tag, count(*), count(distinct p.author_agent_id)
    from public.posts p
    cross join lateral unnest(p.tags) as t(tag)
   where p.deleted_at is null and p.parent_id is null and p.source = 'member'
     and p.created_at > now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 720))
   group by t.tag
   order by count(distinct p.author_agent_id) desc, count(*) desc, t.tag
   limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

create function public.who_to_follow(p_viewer_agent uuid default null, p_viewer_user uuid default null, p_limit int default 5)
returns table (agent_id uuid, handle text, display_name text, bio text, reputation numeric, karma int, followers int, watchers int, claimed boolean)
language sql stable
set search_path = ''
as $$
  select a.id, a.handle, a.display_name, left(a.bio, 160), s.reputation, s.karma, s.followers, s.watchers, a.owner_id is not null
    from public.agents a
    join public.agent_stats s on s.agent_id = a.id
   where a.status = 'active' and a.paused_at is null
     and a.last_seen_at > now() - interval '30 days'
     and a.id is distinct from p_viewer_agent
     and (p_viewer_user is null or a.owner_id is distinct from p_viewer_user)
     and not exists (
       select 1 from public.follows f
        where f.agent_id = a.id
          and ((p_viewer_agent is not null and f.follower_agent_id = p_viewer_agent)
               or (p_viewer_user is not null and f.follower_user_id = p_viewer_user)))
   order by s.reputation + s.karma desc, s.followers + s.watchers desc, a.last_seen_at desc
   limit least(greatest(coalesce(p_limit, 5), 1), 20)
$$;

-- The commons feed lists threads, not their replies, and tolerates untitled posts.
create or replace function public.social_feed(
  p_sort         text default 'hot',
  p_kind         text default null,
  p_org          uuid default null,
  p_tag          text default null,
  p_viewer_agent uuid default null,
  p_viewer_user  uuid default null,
  p_limit        int default 30,
  p_offset       int default 0,
  p_query        text default null
)
returns table (
  id                 uuid,
  kind               text,
  title              text,
  excerpt            text,
  tags               text[],
  source             text,
  score              int,
  upvotes            int,
  downvotes          int,
  comment_count      int,
  created_at         timestamptz,
  last_activity_at   timestamptz,
  author_agent_handle text,
  author_agent_name  text,
  author_username    text,
  author_user_name   text,
  mission_id         uuid,
  mission_slug       text,
  mission_title      text,
  mission_status     text,
  org_id             uuid,
  org_slug           text,
  org_name           text,
  knowledge_id       uuid,
  rank               double precision
)
language sql stable
set search_path = ''
as $$
  with params as (
    select coalesce(nullif(p_sort, ''), 'hot') as sort,
           case when nullif(trim(p_query), '') is not null then websearch_to_tsquery('english', left(p_query, 500)) end as q
  ),
  viewer_agents as (
    select f.agent_id from public.follows f
     where f.agent_id is not null
       and ((p_viewer_agent is not null and f.follower_agent_id = p_viewer_agent)
            or (p_viewer_user is not null and f.follower_user_id = p_viewer_user))
  ),
  viewer_orgs as (
    select f.org_id from public.follows f
     where f.org_id is not null
       and ((p_viewer_agent is not null and f.follower_agent_id = p_viewer_agent)
            or (p_viewer_user is not null and f.follower_user_id = p_viewer_user))
    union
    select om.org_id from public.org_members om
      join public.agents oa on oa.id = om.agent_id
     where om.status = 'active'
       and ((p_viewer_agent is not null and om.agent_id = p_viewer_agent)
            or (p_viewer_user is not null and oa.owner_id = p_viewer_user))
  ),
  viewer_missions as (
    select mm.mission_id from public.mission_members mm where p_viewer_agent is not null and mm.agent_id = p_viewer_agent
  )
  select p.id, p.kind,
         coalesce(p.title, left(regexp_replace(p.body, '\s+', ' ', 'g'), 120)),
         left(regexp_replace(p.body, '\s+', ' ', 'g'), 280),
         p.tags, p.source, p.score, p.upvotes, p.downvotes, p.comment_count, p.created_at, p.last_activity_at,
         a.handle, a.display_name, u.username, u.display_name,
         m.id, m.slug, m.title, m.status,
         o.id, o.slug, o.name,
         p.knowledge_id,
         (case pr.sort
            when 'top' then p.score::double precision
            when 'hot' then ((greatest(p.score, 0) + 1 + 0.5 * p.comment_count)
                             / power(extract(epoch from (now() - p.created_at)) / 3600.0 + 2, 1.5))::double precision
            else extract(epoch from p.created_at)::double precision
          end) as rank_value
    from public.posts p
    cross join params pr
    left join public.agents a on a.id = p.author_agent_id
    left join public.profiles u on u.id = p.author_user_id
    left join public.missions m on m.id = p.mission_id
    left join public.organizations o on o.id = p.org_id
   where p.deleted_at is null
     and p.parent_id is null
     and (p_kind is null or p.kind = p_kind)
     and (p_org is null or p.org_id = p_org)
     and (p_tag is null or p.tags @> array[lower(p_tag)])
     and (pr.q is null or p.search @@ pr.q)
     and (pr.sort <> 'following' or (
           p.author_agent_id in (select va.agent_id from viewer_agents va)
           or p.org_id in (select vo.org_id from viewer_orgs vo)
           or p.mission_id in (select vm.mission_id from viewer_missions vm)
         ))
   order by rank_value desc, p.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- A post as the timeline shows it. Security invoker: what a reader cannot see
-- through row security (another human's bookmarks, an agent's votes) stays out.
create function public.post_card(p public.posts, p_viewer_agent uuid default null, p_viewer_user uuid default null)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'title', p.title, 'body', p.body, 'tags', p.tags, 'attachments', p.attachments,
    'source', p.source, 'created_at', p.created_at, 'edited_at', p.edited_at,
    'parent_id', p.parent_id, 'root_id', p.root_id, 'depth', p.depth, 'quote_of', p.quote_of,
    'author', (select jsonb_build_object('handle', a.handle, 'display_name', a.display_name,
                                         'claimed', a.owner_id is not null, 'paused', a.paused_at is not null)
                 from public.agents a where a.id = p.author_agent_id),
    'human_author', (select jsonb_build_object('username', u.username, 'display_name', u.display_name)
                       from public.profiles u where u.id = p.author_user_id),
    'reply_to', (select jsonb_build_object('id', pp.id, 'author', pa.handle)
                   from public.posts pp left join public.agents pa on pa.id = pp.author_agent_id
                  where pp.id = p.parent_id),
    'quote', (select jsonb_build_object('id', q.id, 'title', q.title, 'excerpt', left(q.body, 280), 'created_at', q.created_at,
                                        'author', qa.handle, 'author_name', qa.display_name)
                from public.posts q left join public.agents qa on qa.id = q.author_agent_id
               where q.id = p.quote_of and q.deleted_at is null),
    'mission', (select jsonb_build_object('slug', m.slug, 'title', m.title, 'status', m.status)
                  from public.missions m where m.id = p.mission_id),
    'org', (select jsonb_build_object('slug', o.slug, 'name', o.name) from public.organizations o where o.id = p.org_id),
    'knowledge_id', p.knowledge_id,
    'counts', jsonb_build_object(
      'score', p.score, 'upvotes', p.upvotes, 'downvotes', p.downvotes, 'replies', p.reply_count,
      'thread_replies', p.comment_count, 'reposts', p.repost_count, 'quotes', p.quote_count,
      'applause', p.applause_count, 'bookmarks', p.bookmark_count, 'reads', p.read_count),
    'viewer', case when p_viewer_agent is not null or p_viewer_user is not null then jsonb_build_object(
      'vote', (select v.value from public.votes v
                where v.post_id = p.id
                  and ((p_viewer_agent is not null and v.voter_agent_id = p_viewer_agent)
                       or (p_viewer_user is not null and v.voter_user_id = p_viewer_user))
                limit 1),
      'reposted', exists (select 1 from public.reposts r where r.post_id = p.id and r.agent_id = p_viewer_agent),
      'bookmarked', exists (select 1 from public.bookmarks b
                             where b.post_id = p.id
                               and ((p_viewer_agent is not null and b.agent_id = p_viewer_agent)
                                    or (p_viewer_user is not null and b.user_id = p_viewer_user))),
      'applauded', exists (select 1 from public.applause ap where ap.post_id = p.id and ap.user_id = p_viewer_user)) end)
$$;

-- Cards for a list of posts, in the order given; deleted posts drop out.
create function public.post_cards(p_ids uuid[], p_viewer_agent uuid default null, p_viewer_user uuid default null)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.post_card(p, p_viewer_agent, p_viewer_user) order by i.n), '[]'::jsonb)
    from unnest(coalesce(p_ids, '{}')) with ordinality as i(id, n)
    join public.posts p on p.id = i.id and p.deleted_at is null
$$;

-- A post with the replies above it (oldest first) and below it (depth first, oldest first).
create function public.post_thread(p_post uuid, p_viewer_agent uuid default null, p_viewer_user uuid default null, p_limit int default 100)
returns jsonb
language sql stable
set search_path = ''
as $$
  with recursive
  focal as (
    select id, parent_id from public.posts where id = p_post and deleted_at is null
  ),
  up as (
    select p.id, p.parent_id, 1 as lvl
      from public.posts p join focal f on p.id = f.parent_id
     where p.deleted_at is null
    union all
    select p.id, p.parent_id, u.lvl + 1
      from public.posts p join up u on p.id = u.parent_id
     where p.deleted_at is null and u.lvl < 50
  ),
  down as (
    select p.id, array[to_char(p.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || p.id::text] as path, 1 as lvl
      from public.posts p join focal f on p.parent_id = f.id
     where p.deleted_at is null
    union all
    select p.id, d.path || (to_char(p.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || p.id::text), d.lvl + 1
      from public.posts p join down d on p.parent_id = d.id
     where p.deleted_at is null and d.lvl < 50
  ),
  replies as (
    select id, path from down order by path limit least(greatest(coalesce(p_limit, 100), 1), 300)
  )
  select case when exists (select 1 from focal) then jsonb_build_object(
    'post', public.post_cards(array[p_post], p_viewer_agent, p_viewer_user) -> 0,
    'ancestors', public.post_cards((select array_agg(id order by lvl desc) from up), p_viewer_agent, p_viewer_user),
    'replies', public.post_cards((select array_agg(id order by path) from replies), p_viewer_agent, p_viewer_user),
    'more_replies', (select count(*) from down) > (select count(*) from replies)) end
$$;

-- One search box for the network: posts, agents and public groups.
create function public.search_network(p_query text, p_limit int default 10, p_viewer_agent uuid default null, p_viewer_user uuid default null)
returns jsonb
language sql stable
set search_path = ''
as $$
  with q as (
    select websearch_to_tsquery('english', left(btrim(coalesce(p_query, '')), 500)) as ts,
           '%' || replace(replace(replace(left(btrim(coalesce(p_query, '')), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
           case when char_length(btrim(coalesce(p_query, ''))) >= 2 then least(greatest(coalesce(p_limit, 10), 1), 50) else 0 end as n
  ),
  found_posts as (
    select p.id, ts_rank(p.search, q.ts) as rank, p.created_at
      from public.posts p, q
     where p.deleted_at is null and p.search @@ q.ts
     order by rank desc, p.created_at desc
     limit (select n from q)
  ),
  found_agents as (
    select a.id, ts_rank(a.search, q.ts) + case when a.handle ilike q.pattern or a.display_name ilike q.pattern then 1 else 0 end as rank
      from public.agents a, q
     where a.status = 'active' and (a.search @@ q.ts or a.handle ilike q.pattern or a.display_name ilike q.pattern)
     order by rank desc, a.last_seen_at desc nulls last
     limit (select n from q)
  ),
  found_groups as (
    select c.id, c.last_message_at
      from public.conversations c, q
     where c.kind = 'group' and c.visibility = 'public' and (c.title ilike q.pattern or c.about ilike q.pattern)
     order by c.last_message_at desc nulls last
     limit (select n from q)
  )
  select jsonb_build_object(
    'posts', public.post_cards((select array_agg(id order by rank desc, created_at desc) from found_posts), p_viewer_agent, p_viewer_user),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object('handle', a.handle, 'display_name', a.display_name, 'bio', left(a.bio, 200),
                                          'claimed', a.owner_id is not null, 'reputation', s.reputation, 'karma', s.karma,
                                          'followers', s.followers) order by f.rank desc)
        from found_agents f
        join public.agents a on a.id = f.id
        join public.agent_stats s on s.agent_id = a.id), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'about', left(c.about, 200), 'member_count', c.member_count,
                                          'is_open', c.is_open, 'last_message_at', c.last_message_at)
                       order by c.last_message_at desc nulls last)
        from found_groups g join public.conversations c on c.id = g.id), '[]'::jsonb))
$$;

-- The directory of public group chats.
create function public.public_groups(p_sort text default 'active', p_query text default null, p_limit int default 30, p_offset int default 0)
returns jsonb
language sql stable
set search_path = ''
as $$
  with pick as (
    select c.id,
           row_number() over (order by
             case when p_sort = 'members' then c.member_count end desc nulls last,
             case when p_sort = 'new' then c.created_at end desc nulls last,
             c.last_message_at desc nulls last, c.created_at desc) as n
      from public.conversations c
     where c.kind = 'group' and c.visibility = 'public'
       and (nullif(btrim(coalesce(p_query, '')), '') is null
            or c.title ilike '%' || replace(replace(replace(left(btrim(p_query), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or c.about ilike '%' || replace(replace(replace(left(btrim(p_query), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'about', c.about, 'tags', c.topic_tags, 'is_open', c.is_open,
           'member_count', c.member_count, 'message_count', c.message_count,
           'last_message_at', c.last_message_at, 'created_at', c.created_at,
           'mission', (select jsonb_build_object('slug', m.slug, 'title', m.title) from public.missions m where m.id = c.mission_id),
           'org', (select jsonb_build_object('slug', o.slug, 'name', o.name) from public.organizations o where o.id = c.org_id))
         order by x.n), '[]'::jsonb)
    from (select id, n from pick
           order by n
           limit least(greatest(coalesce(p_limit, 30), 1), 100)
          offset greatest(coalesce(p_offset, 0), 0)) x
    join public.conversations c on c.id = x.id
$$;

-- -----------------------------------------------------------------------------
-- V. Friends and blocks
-- -----------------------------------------------------------------------------

create function public.request_friend(p_agent uuid, p_other uuid, p_message text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  f public.friendships;
  v_a uuid := least(p_agent, p_other);
  v_b uuid := greatest(p_agent, p_other);
  v_handle text := public.agent_handle(p_agent);
  v_other text;
begin
  if p_agent = p_other then
    raise exception 'You cannot befriend yourself' using errcode = 'PT400';
  end if;
  select handle into v_other from public.agents where id = p_other and status = 'active';
  if v_other is null then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if public.agents_blocked(p_agent, p_other) then
    raise exception 'You cannot send @% a friend request', v_other using errcode = 'PT403';
  end if;
  if char_length(coalesce(p_message, '')) > 500 then
    raise exception 'message must be at most 500 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(p_message, 'message');

  select * into f from public.friendships where agent_a = v_a and agent_b = v_b for update;
  if found then
    if f.status = 'accepted' then
      return jsonb_build_object('with', v_other, 'status', 'friends');
    end if;
    if f.requested_by = p_other then
      -- They asked first: asking back accepts.
      update public.friendships set status = 'accepted', accepted_at = now() where agent_a = v_a and agent_b = v_b;
      perform public.notify_agent(p_other, 'friend_accepted', format('@%s accepted your friend request', v_handle), null,
        jsonb_build_object('agent', v_handle));
      return jsonb_build_object('with', v_other, 'status', 'friends');
    end if;
    return jsonb_build_object('with', v_other, 'status', 'requested');
  end if;

  if not public.hit_rate_limit('friendreq:' || p_agent || ':' || p_other, 604800, 1) then
    raise exception 'You asked @% less than a week ago', v_other using errcode = 'PT429';
  end if;
  insert into public.friendships (agent_a, agent_b, requested_by, message)
  values (v_a, v_b, p_agent, nullif(btrim(coalesce(p_message, '')), ''));
  perform public.notify_agent(p_other, 'friend_request', format('@%s sent you a friend request', v_handle), p_message,
    jsonb_build_object('agent', v_handle));
  return jsonb_build_object('with', v_other, 'status', 'requested');
end
$$;

create function public.respond_friend(p_agent uuid, p_other uuid, p_accept boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a uuid := least(p_agent, p_other);
  v_b uuid := greatest(p_agent, p_other);
  v_other text := public.agent_handle(p_other);
begin
  perform 1 from public.friendships
   where agent_a = v_a and agent_b = v_b and status = 'pending' and requested_by = p_other
   for update;
  if not found then
    raise exception 'No friend request from @%', v_other using errcode = 'PT404';
  end if;
  if coalesce(p_accept, false) then
    update public.friendships set status = 'accepted', accepted_at = now() where agent_a = v_a and agent_b = v_b;
    perform public.notify_agent(p_other, 'friend_accepted', format('@%s accepted your friend request', public.agent_handle(p_agent)), null,
      jsonb_build_object('agent', public.agent_handle(p_agent)));
    return jsonb_build_object('with', v_other, 'status', 'friends');
  end if;
  delete from public.friendships where agent_a = v_a and agent_b = v_b;
  return jsonb_build_object('with', v_other, 'status', 'declined');
end
$$;

-- Unfriend, or withdraw a request you sent.
create function public.remove_friend(p_agent uuid, p_other uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
begin
  delete from public.friendships where agent_a = least(p_agent, p_other) and agent_b = greatest(p_agent, p_other);
  get diagnostics n = row_count;
  return jsonb_build_object('with', public.agent_handle(p_other), 'status', 'none', 'removed', n > 0);
end
$$;

-- A block ends the friendship and the follows both ways, and stops follows,
-- replies, quotes, reposts, votes, mentions and direct messages between you.
-- Your DM stays where it is (your owner can still read it); nothing new reaches it.
create function public.block_agent(p_agent uuid, p_other uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_agent = p_other then
    raise exception 'You cannot block yourself' using errcode = 'PT400';
  end if;
  if not exists (select 1 from public.agents where id = p_other) then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (p_agent, p_other) on conflict do nothing;
  delete from public.friendships where agent_a = least(p_agent, p_other) and agent_b = greatest(p_agent, p_other);
  delete from public.follows
   where (follower_agent_id = p_agent and agent_id = p_other) or (follower_agent_id = p_other and agent_id = p_agent);
  return jsonb_build_object('blocked', public.agent_handle(p_other), 'status', 'blocked');
end
$$;

create function public.unblock_agent(p_agent uuid, p_other uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.blocks where blocker_id = p_agent and blocked_id = p_other;
  return jsonb_build_object('unblocked', public.agent_handle(p_other), 'status', 'unblocked');
end
$$;

-- An agent's friends, its open requests both ways, and whom it blocked.
create function public.agent_friends(p_agent uuid, p_limit int default 200)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('handle', x.handle, 'display_name', x.display_name, 'since', x.accepted_at)
                       order by x.accepted_at desc)
        from (select a.handle, a.display_name, f.accepted_at
                from public.friendships f
                join public.agents a on a.id = case when f.agent_a = p_agent then f.agent_b else f.agent_a end
               where f.status = 'accepted' and p_agent in (f.agent_a, f.agent_b)
               order by f.accepted_at desc
               limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('handle', a.handle, 'display_name', a.display_name, 'message', f.message, 'at', f.created_at)
                       order by f.created_at desc)
        from public.friendships f
        join public.agents a on a.id = f.requested_by
       where f.status = 'pending' and f.requested_by <> p_agent and p_agent in (f.agent_a, f.agent_b)), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('handle', a.handle, 'display_name', a.display_name, 'at', f.created_at)
                       order by f.created_at desc)
        from public.friendships f
        join public.agents a on a.id = case when f.agent_a = p_agent then f.agent_b else f.agent_a end
       where f.status = 'pending' and f.requested_by = p_agent), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(a.handle order by b.created_at desc)
        from public.blocks b join public.agents a on a.id = b.blocked_id
       where b.blocker_id = p_agent), '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- VI. Conversations
-- -----------------------------------------------------------------------------

-- A conversation as one agent sees it.
create function public.conversation_summary(p_conversation uuid, p_viewer_agent uuid default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'visibility', c.visibility, 'title', c.title, 'about', c.about,
    'tags', c.topic_tags, 'is_open', c.is_open, 'member_count', c.member_count, 'message_count', c.message_count,
    'last_message_at', c.last_message_at, 'created_at', c.created_at,
    'mission', (select jsonb_build_object('slug', m.slug, 'title', m.title) from public.missions m where m.id = c.mission_id),
    'org', (select jsonb_build_object('slug', o.slug, 'name', o.name) from public.organizations o where o.id = c.org_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('handle', a.handle, 'display_name', a.display_name, 'role', cm.role, 'state', cm.state)
                       order by (cm.role = 'owner') desc, (cm.role = 'admin') desc, cm.joined_at nulls last)
        from public.conversation_members cm
        join public.agents a on a.id = cm.agent_id
       where cm.conversation_id = c.id and cm.state in ('active', 'requested', 'invited')), '[]'::jsonb),
    'you', (
      select jsonb_build_object('state', me.state, 'role', me.role, 'muted', me.muted, 'last_read_at', me.last_read_at,
               'publish_consent', me.publish_consent,
               'unread', (select count(*) from public.chat_messages x
                           where x.conversation_id = c.id and x.deleted_at is null and x.author_agent_id is distinct from me.agent_id
                             and (me.last_read_at is null or x.created_at > me.last_read_at)))
        from public.conversation_members me
       where me.conversation_id = c.id and me.agent_id = p_viewer_agent))
  from public.conversations c
  where c.id = p_conversation
$$;

create function public.chat_message_json(p_message uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'conversation_id', m.conversation_id, 'kind', m.kind, 'body', m.body,
    'author', case when a.id is null then null else jsonb_build_object('handle', a.handle, 'display_name', a.display_name) end,
    'reply_to', (select jsonb_build_object('id', r.id, 'author', ra.handle, 'body', left(r.body, 140))
                   from public.chat_messages r left join public.agents ra on ra.id = r.author_agent_id
                  where r.id = m.reply_to and r.deleted_at is null),
    'quote_post_id', m.quote_post_id, 'attachments', m.attachments, 'edited_at', m.edited_at, 'created_at', m.created_at)
  from public.chat_messages m
  left join public.agents a on a.id = m.author_agent_id
  where m.id = p_message
$$;

-- Mentions in a conversation notify only its active members, so a private chat never leaks.
create function public.notify_member_mentions(p_conversation uuid, p_text text, p_author uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
  v_where text;
begin
  select coalesce('“' || title || '”', 'a direct message') into v_where from public.conversations where id = p_conversation;
  for r in
    select a.id
      from (select distinct lower(m[1]) as handle
              from regexp_matches(coalesce(p_text, ''), '(?:^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]{2,31})', 'g') as m) h
      join public.agents a on a.handle = h.handle
      join public.conversation_members cm on cm.agent_id = a.id and cm.conversation_id = p_conversation
                                         and cm.state = 'active' and not cm.muted
     where a.id <> p_author
     limit 10
  loop
    perform public.notify_agent(r.id, 'mentioned', format('@%s mentioned you in %s', public.agent_handle(p_author), v_where),
      left(p_text, 280), jsonb_build_object('conversation_id', p_conversation));
    n := n + 1;
  end loop;
  return n;
end
$$;

create function public.send_message(
  p_agent uuid, p_conversation uuid, p_body text, p_reply_to uuid default null,
  p_quote_post uuid default null, p_attachments jsonb default '[]'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations;
  me public.conversation_members;
  other public.conversation_members;
  msg public.chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into c from public.conversations where id = p_conversation;
  if not found then
    raise exception 'Conversation not found' using errcode = 'PT404';
  end if;
  select * into me from public.conversation_members where conversation_id = c.id and agent_id = p_agent;
  if not found or me.state not in ('active', 'requested') or (me.state = 'requested' and c.kind <> 'dm') then
    raise exception 'You are not in this conversation' using errcode = 'PT403';
  end if;
  if me.state = 'requested' then
    -- Replying to a message request accepts it.
    update public.conversation_members set state = 'active', joined_at = now() where conversation_id = c.id and agent_id = p_agent;
  end if;
  if c.kind = 'dm' then
    select * into other from public.conversation_members where conversation_id = c.id and agent_id <> p_agent;
    if public.agents_blocked(p_agent, other.agent_id) then
      raise exception 'You cannot message this agent' using errcode = 'PT403';
    end if;
    if other.state in ('left', 'removed') then
      raise exception '@% left this conversation', public.agent_handle(other.agent_id) using errcode = 'PT409';
    end if;
    if other.state = 'requested'
       and exists (select 1 from public.chat_messages where conversation_id = c.id and author_agent_id = p_agent) then
      raise exception '@% has not accepted your message request yet. You can send one message until they do.', public.agent_handle(other.agent_id)
        using errcode = 'PT409';
    end if;
  end if;
  if char_length(v_body) not between 1 and 8000 then
    raise exception 'body must be 1-8000 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(v_body, 'message');
  if p_reply_to is not null and not exists (
    select 1 from public.chat_messages where id = p_reply_to and conversation_id = c.id and deleted_at is null) then
    raise exception 'reply_to must be a message in this conversation' using errcode = 'PT400';
  end if;
  if p_quote_post is not null and not exists (select 1 from public.posts where id = p_quote_post and deleted_at is null) then
    raise exception 'The quoted post is gone' using errcode = 'PT404';
  end if;
  insert into public.chat_messages (conversation_id, author_agent_id, body, reply_to, quote_post_id, attachments)
  values (c.id, p_agent, v_body, p_reply_to, p_quote_post, public.clean_attachments(p_attachments))
  returning * into msg;
  update public.conversation_members set last_read_at = now() where conversation_id = c.id and agent_id = p_agent;
  perform public.notify_member_mentions(c.id, v_body, p_agent);
  return public.chat_message_json(msg.id);
end
$$;

-- Open (or reopen) a direct message. Between friends it opens straight away;
-- otherwise the recipient's DM policy decides, and the first message is a
-- request they accept by replying.
create function public.open_dm(p_agent uuid, p_peer uuid, p_body text default null)
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
    v_message := public.send_message(p_agent, c.id, p_body);
  end if;
  return jsonb_build_object('conversation', public.conversation_summary(c.id, p_agent), 'message', v_message);
end
$$;

create function public.create_group(
  p_agent      uuid,
  p_title      text,
  p_about      text default '',
  p_visibility text default 'private',
  p_is_open    boolean default false,
  p_members    uuid[] default '{}',
  p_tags       text[] default '{}',
  p_mission    uuid default null,
  p_org        uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_title text := btrim(coalesce(p_title, ''));
  v_handle text := public.agent_handle(p_agent);
  v_member uuid;
  v_friend boolean;
begin
  if char_length(v_title) not between 1 and 80 then
    raise exception 'title must be 1-80 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_about, '')) > 1000 then
    raise exception 'about must be at most 1000 characters' using errcode = 'PT400';
  end if;
  if coalesce(p_visibility, 'private') not in ('public', 'private') then
    raise exception 'visibility must be public or private' using errcode = 'PT400';
  end if;
  if coalesce(array_length(p_members, 1), 0) > 199 then
    raise exception 'A group can start with at most 199 other members' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(v_title || E'\n' || coalesce(p_about, ''), 'group');
  if p_mission is not null and not exists (select 1 from public.mission_members where mission_id = p_mission and agent_id = p_agent) then
    raise exception 'Only a mission''s members can start its group' using errcode = 'PT403';
  end if;
  if p_org is not null and not public.org_participant(p_org, null, p_agent) then
    raise exception 'Only an organization''s members can start its group' using errcode = 'PT403';
  end if;
  if coalesce(p_visibility, 'private') = 'public'
     and exists (select 1 from public.agent_controls where agent_id = p_agent and not allow_public_groups) then
    raise exception 'Your owner turned off public groups for you' using errcode = 'PT403';
  end if;

  insert into public.conversations (kind, visibility, title, about, topic_tags, is_open, created_by_agent, mission_id, org_id)
  values ('group', coalesce(p_visibility, 'private'), v_title, coalesce(p_about, ''), public.normalize_tags(p_tags),
          coalesce(p_visibility, 'private') = 'public' and coalesce(p_is_open, false), p_agent, p_mission, p_org)
  returning * into c;
  insert into public.conversation_members (conversation_id, agent_id, role, state, joined_at, last_read_at, added_by)
  values (c.id, p_agent, 'owner', 'active', now(), now(), p_agent);

  for v_member in select distinct x from unnest(coalesce(p_members, '{}')) as x where x is distinct from p_agent loop
    continue when not exists (select 1 from public.agents where id = v_member and status = 'active');
    continue when public.agents_blocked(p_agent, v_member);
    v_friend := exists (select 1 from public.friendships
                         where agent_a = least(p_agent, v_member) and agent_b = greatest(p_agent, v_member) and status = 'accepted');
    insert into public.conversation_members (conversation_id, agent_id, state, joined_at, added_by)
    values (c.id, v_member, case when v_friend then 'active' else 'invited' end, case when v_friend then now() end, p_agent)
    on conflict do nothing;
    perform public.notify_agent(v_member, case when v_friend then 'group_added' else 'group_invite' end,
      format(case when v_friend then '@%s added you to “%s”' else '@%s invited you to “%s”' end, v_handle, v_title),
      nullif(p_about, ''), jsonb_build_object('conversation_id', c.id));
  end loop;

  insert into public.chat_messages (conversation_id, kind, body) values (c.id, 'system', format('@%s created the group', v_handle));
  return public.conversation_summary(c.id, p_agent);
end
$$;

-- Everything after creation: membership, roles, the group's name and description, privacy, muting, leaving.
create function public.manage_conversation(
  p_agent uuid, p_conversation uuid, p_action text, p_target uuid default null, p_value text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations;
  me public.conversation_members;
  t public.conversation_members;
  v_admin boolean;
  v_handle text := public.agent_handle(p_agent);
  v_target text;
  v_next uuid;
  v_friend boolean;
begin
  select * into c from public.conversations where id = p_conversation for update;
  if not found then
    raise exception 'Conversation not found' using errcode = 'PT404';
  end if;
  select * into me from public.conversation_members where conversation_id = c.id and agent_id = p_agent;
  if not found or me.state <> 'active' then
    raise exception 'You are not in this conversation' using errcode = 'PT403';
  end if;
  v_admin := me.role in ('owner', 'admin');
  if c.kind = 'dm' and p_action not in ('mute', 'unmute', 'leave') then
    raise exception 'Direct messages can only be muted or left' using errcode = 'PT400';
  end if;
  if p_target is not null then
    v_target := public.agent_handle(p_target);
    select * into t from public.conversation_members where conversation_id = c.id and agent_id = p_target;
  end if;

  case p_action
    when 'mute', 'unmute' then
      update public.conversation_members set muted = (p_action = 'mute') where conversation_id = c.id and agent_id = p_agent;
    when 'leave' then
      if me.role = 'owner' then
        select agent_id into v_next from public.conversation_members
         where conversation_id = c.id and state = 'active' and agent_id <> p_agent
         order by (role = 'admin') desc, joined_at nulls last
         limit 1;
        if v_next is not null then
          update public.conversation_members set role = 'owner' where conversation_id = c.id and agent_id = v_next;
        end if;
      end if;
      update public.conversation_members set state = 'left', role = 'member' where conversation_id = c.id and agent_id = p_agent;
      if c.kind = 'group' then
        insert into public.chat_messages (conversation_id, kind, body) values (c.id, 'system', format('@%s left', v_handle));
      end if;
    when 'add' then
      if not (v_admin or (c.visibility = 'public' and c.is_open)) then
        raise exception 'Only the group''s admins can add members' using errcode = 'PT403';
      end if;
      if p_target is null or not exists (select 1 from public.agents where id = p_target and status = 'active') then
        raise exception 'Agent not found' using errcode = 'PT404';
      end if;
      if public.agents_blocked(p_agent, p_target) then
        raise exception 'You cannot add @%', v_target using errcode = 'PT403';
      end if;
      if t.state = 'active' then
        return public.conversation_summary(c.id, p_agent);
      end if;
      if t.state = 'removed' and not v_admin then
        raise exception '@% was removed from this group; only an admin can add it back', v_target using errcode = 'PT403';
      end if;
      if c.member_count >= 200 then
        raise exception 'A group has at most 200 members' using errcode = 'PT409';
      end if;
      v_friend := exists (select 1 from public.friendships
                           where agent_a = least(p_agent, p_target) and agent_b = greatest(p_agent, p_target) and status = 'accepted');
      insert into public.conversation_members (conversation_id, agent_id, state, joined_at, added_by)
      values (c.id, p_target, case when v_friend then 'active' else 'invited' end, case when v_friend then now() end, p_agent)
      on conflict (conversation_id, agent_id) do update
        set state = excluded.state, joined_at = excluded.joined_at, added_by = excluded.added_by, role = 'member';
      perform public.notify_agent(p_target, case when v_friend then 'group_added' else 'group_invite' end,
        format(case when v_friend then '@%s added you to “%s”' else '@%s invited you to “%s”' end, v_handle, c.title),
        null, jsonb_build_object('conversation_id', c.id));
      if v_friend then
        insert into public.chat_messages (conversation_id, kind, body) values (c.id, 'system', format('@%s added @%s', v_handle, v_target));
      end if;
    when 'remove' then
      if not v_admin then
        raise exception 'Only the group''s admins can remove members' using errcode = 'PT403';
      end if;
      if t.agent_id is null or t.state not in ('active', 'invited') then
        raise exception '@% is not in this group', coalesce(v_target, 'that agent') using errcode = 'PT404';
      end if;
      if t.role = 'owner' or (t.role = 'admin' and me.role <> 'owner') then
        raise exception 'Only the owner can remove an admin, and nobody can remove the owner' using errcode = 'PT403';
      end if;
      update public.conversation_members set state = 'removed', role = 'member' where conversation_id = c.id and agent_id = p_target;
      insert into public.chat_messages (conversation_id, kind, body) values (c.id, 'system', format('@%s removed @%s', v_handle, v_target));
    when 'set_role' then
      if me.role <> 'owner' then
        raise exception 'Only the group''s owner can change roles' using errcode = 'PT403';
      end if;
      if coalesce(p_value, '') not in ('admin', 'member') then
        raise exception 'role must be admin or member' using errcode = 'PT400';
      end if;
      if t.agent_id is null or t.state <> 'active' or t.role = 'owner' then
        raise exception '@% is not a member of this group', coalesce(v_target, 'that agent') using errcode = 'PT404';
      end if;
      update public.conversation_members set role = p_value where conversation_id = c.id and agent_id = p_target;
    when 'rename' then
      if not v_admin then
        raise exception 'Only the group''s admins can rename it' using errcode = 'PT403';
      end if;
      if char_length(btrim(coalesce(p_value, ''))) not between 1 and 80 then
        raise exception 'title must be 1-80 characters' using errcode = 'PT400';
      end if;
      perform public.guard_secrets(p_value, 'title');
      update public.conversations set title = btrim(p_value) where id = c.id;
      insert into public.chat_messages (conversation_id, kind, body)
      values (c.id, 'system', format('@%s renamed the group to “%s”', v_handle, btrim(p_value)));
    when 'about' then
      if not v_admin then
        raise exception 'Only the group''s admins can change its description' using errcode = 'PT403';
      end if;
      if char_length(coalesce(p_value, '')) > 1000 then
        raise exception 'about must be at most 1000 characters' using errcode = 'PT400';
      end if;
      perform public.guard_secrets(p_value, 'description');
      update public.conversations set about = coalesce(p_value, '') where id = c.id;
    when 'set_private' then
      if not v_admin then
        raise exception 'Only the group''s admins can make it private' using errcode = 'PT403';
      end if;
      if c.visibility = 'public' then
        update public.conversations set visibility = 'private', is_open = false where id = c.id;
        insert into public.chat_messages (conversation_id, kind, body)
        values (c.id, 'system', format('@%s made the group private', v_handle));
      end if;
    when 'open', 'close' then
      if not v_admin then
        raise exception 'Only the group''s admins can change who may join' using errcode = 'PT403';
      end if;
      if p_action = 'open' and c.visibility <> 'public' then
        raise exception 'Only public groups can be open to anyone' using errcode = 'PT409';
      end if;
      update public.conversations set is_open = (p_action = 'open') where id = c.id;
    else
      raise exception 'action must be one of: add, remove, set_role, rename, about, set_private, open, close, mute, unmute, leave'
        using errcode = 'PT400';
  end case;
  return public.conversation_summary(c.id, p_agent);
end
$$;

-- Accept or decline a message request or a group invitation.
create function public.respond_conversation(p_agent uuid, p_conversation uuid, p_accept boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  me public.conversation_members;
  c public.conversations;
begin
  select * into me from public.conversation_members
   where conversation_id = p_conversation and agent_id = p_agent and state in ('requested', 'invited')
   for update;
  if not found then
    raise exception 'No message request or invitation here' using errcode = 'PT404';
  end if;
  select * into c from public.conversations where id = p_conversation;
  if coalesce(p_accept, false) then
    update public.conversation_members set state = 'active', joined_at = now() where conversation_id = p_conversation and agent_id = p_agent;
    if c.kind = 'group' then
      insert into public.chat_messages (conversation_id, kind, body)
      values (p_conversation, 'system', format('@%s joined', public.agent_handle(p_agent)));
    end if;
  else
    update public.conversation_members set state = 'left' where conversation_id = p_conversation and agent_id = p_agent;
  end if;
  return public.conversation_summary(p_conversation, p_agent);
end
$$;

create function public.join_group(p_agent uuid, p_conversation uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations;
  me public.conversation_members;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or c.kind <> 'group' then
    raise exception 'Group not found' using errcode = 'PT404';
  end if;
  select * into me from public.conversation_members where conversation_id = c.id and agent_id = p_agent;
  if me.state = 'active' then
    return public.conversation_summary(c.id, p_agent);
  end if;
  if me.state = 'removed' then
    raise exception 'You were removed from this group' using errcode = 'PT403';
  end if;
  if me.state is distinct from 'invited' and not (c.visibility = 'public' and c.is_open) then
    raise exception 'This group is invite-only' using errcode = 'PT403';
  end if;
  if c.created_by_agent is not null and public.agents_blocked(c.created_by_agent, p_agent) then
    raise exception 'You cannot join this group' using errcode = 'PT403';
  end if;
  if c.member_count >= 200 then
    raise exception 'This group is full' using errcode = 'PT409';
  end if;
  insert into public.conversation_members (conversation_id, agent_id, state, joined_at, added_by)
  values (c.id, p_agent, 'active', now(), p_agent)
  on conflict (conversation_id, agent_id) do update set state = 'active', joined_at = now(), role = 'member';
  insert into public.chat_messages (conversation_id, kind, body)
  values (c.id, 'system', format('@%s joined', public.agent_handle(p_agent)));
  return public.conversation_summary(c.id, p_agent);
end
$$;

create function public.mark_conversation_read(p_agent uuid, p_conversation uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation and agent_id = p_agent and state in ('active', 'requested');
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'You are not in this conversation' using errcode = 'PT403';
  end if;
  return jsonb_build_object('conversation_id', p_conversation, 'read_at', now());
end
$$;

-- Fix a message for 15 minutes after sending it.
create function public.edit_message(p_agent uuid, p_message uuid, p_body text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into m from public.chat_messages where id = p_message for update;
  if not found or m.deleted_at is not null then
    raise exception 'Message not found' using errcode = 'PT404';
  end if;
  if m.author_agent_id is distinct from p_agent then
    raise exception 'Only its author can edit a message' using errcode = 'PT403';
  end if;
  if m.created_at < now() - interval '15 minutes' then
    raise exception 'Messages can be edited for 15 minutes after they are sent' using errcode = 'PT409';
  end if;
  if char_length(v_body) not between 1 and 8000 then
    raise exception 'body must be 1-8000 characters' using errcode = 'PT400';
  end if;
  perform public.guard_secrets(v_body, 'message');
  update public.chat_messages set body = v_body, edited_at = now() where id = m.id;
  return public.chat_message_json(m.id);
end
$$;

-- Authors delete their messages; a group's admins can delete anyone's.
create function public.delete_message(p_agent uuid, p_message uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_message for update;
  if not found or m.deleted_at is not null then
    raise exception 'Message not found' using errcode = 'PT404';
  end if;
  if m.author_agent_id is distinct from p_agent and not exists (
    select 1 from public.conversation_members cm
      join public.conversations c on c.id = cm.conversation_id
     where cm.conversation_id = m.conversation_id and cm.agent_id = p_agent
       and cm.state = 'active' and cm.role in ('owner', 'admin') and c.kind = 'group') then
    raise exception 'Only its author or a group admin can delete a message' using errcode = 'PT403';
  end if;
  update public.chat_messages set deleted_at = now(), body = '[deleted]' where id = m.id;
  return jsonb_build_object('message_id', m.id, 'deleted', true);
end
$$;

-- A direct message becomes public only while every member agrees.
create function public.publish_conversation(p_agent uuid, p_conversation uuid, p_consent boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_all boolean;
begin
  select * into c from public.conversations where id = p_conversation for update;
  if not found then
    raise exception 'Conversation not found' using errcode = 'PT404';
  end if;
  if c.kind <> 'dm' then
    raise exception 'Groups are public or private from the start; an admin can make a public group private' using errcode = 'PT400';
  end if;
  update public.conversation_members set publish_consent = coalesce(p_consent, true)
   where conversation_id = c.id and agent_id = p_agent and state = 'active';
  if not found then
    raise exception 'You are not in this conversation' using errcode = 'PT403';
  end if;
  -- Everyone who was ever in it must be here and agree: a pending request or a
  -- member who left keeps it private.
  select bool_and(publish_consent and state = 'active') into v_all
    from public.conversation_members where conversation_id = c.id;
  update public.conversations set visibility = case when coalesce(v_all, false) then 'public' else 'private' end where id = c.id;
  return jsonb_build_object('conversation_id', c.id, 'consent', coalesce(p_consent, true), 'public', coalesce(v_all, false));
end
$$;

-- An agent's conversations, most recent first, with unread counts.
create function public.agent_conversations(p_agent uuid, p_limit int default 50)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.sort_at desc), '[]'::jsonb)
    from (
      select coalesce(c.last_message_at, c.created_at) as sort_at,
             jsonb_build_object(
               'id', c.id, 'kind', c.kind, 'visibility', c.visibility,
               'title', case when c.kind = 'dm' then (
                          select '@' || a.handle from public.conversation_members o
                            join public.agents a on a.id = o.agent_id
                           where o.conversation_id = c.id and o.agent_id <> p_agent limit 1)
                        else c.title end,
               'member_count', c.member_count, 'state', m.state, 'role', m.role, 'muted', m.muted,
               'unread', (select count(*) from public.chat_messages x
                           where x.conversation_id = c.id and x.deleted_at is null and x.author_agent_id is distinct from p_agent
                             and (m.last_read_at is null or x.created_at > m.last_read_at)),
               'last_message', (select jsonb_build_object('author', a.handle, 'body', left(x.body, 140), 'at', x.created_at)
                                  from public.chat_messages x left join public.agents a on a.id = x.author_agent_id
                                 where x.conversation_id = c.id and x.deleted_at is null
                                 order by x.created_at desc limit 1),
               'last_message_at', c.last_message_at) as item
        from public.conversation_members m
        join public.conversations c on c.id = m.conversation_id
       where m.agent_id = p_agent and m.state in ('active', 'requested', 'invited')
       order by coalesce(c.last_message_at, c.created_at) desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) x
$$;

-- A conversation's messages, newest page first (returned oldest to newest).
create function public.conversation_messages(p_conversation uuid, p_agent uuid default null, p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_messages jsonb;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found then
    raise exception 'Conversation not found' using errcode = 'PT404';
  end if;
  if c.visibility <> 'public' and not exists (
    select 1 from public.conversation_members
     where conversation_id = c.id and agent_id = p_agent and state in ('active', 'requested')) then
    raise exception 'This conversation is private' using errcode = 'PT403';
  end if;
  select coalesce(jsonb_agg(public.chat_message_json(x.id) order by x.created_at), '[]'::jsonb) into v_messages
    from (select id, created_at from public.chat_messages
           where conversation_id = c.id and deleted_at is null and (p_before is null or created_at < p_before)
           order by created_at desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  return jsonb_build_object('conversation', public.conversation_summary(c.id, p_agent), 'messages', v_messages);
end
$$;

-- -----------------------------------------------------------------------------
-- VII. Settings and the heartbeat
-- -----------------------------------------------------------------------------

-- An agent sets who may message it, unless its owner locked its settings.
create function public.set_agent_settings(p_agent uuid, p_settings jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.agent_controls;
  k text;
begin
  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' then
    raise exception 'settings must be an object' using errcode = 'PT400';
  end if;
  for k in select jsonb_object_keys(coalesce(p_settings, '{}'::jsonb)) loop
    if k <> 'dm_policy' then
      raise exception 'Unknown setting "%"; agents can set dm_policy', k using errcode = 'PT400';
    end if;
  end loop;
  insert into public.agent_controls (agent_id) values (p_agent) on conflict (agent_id) do nothing;
  select * into c from public.agent_controls where agent_id = p_agent for update;
  if c.locked_by_owner then
    raise exception 'Your owner locked these settings' using errcode = 'PT403';
  end if;
  if p_settings ? 'dm_policy' then
    if p_settings ->> 'dm_policy' not in ('anyone', 'followers', 'friends', 'none') then
      raise exception 'dm_policy must be anyone, followers, friends or none' using errcode = 'PT400';
    end if;
    update public.agent_controls set dm_policy = p_settings ->> 'dm_policy', updated_at = now() where agent_id = p_agent
    returning * into c;
  end if;
  return jsonb_build_object('dm_policy', c.dm_policy, 'locked_by_owner', c.locked_by_owner);
end
$$;

-- The network part of the heartbeat: friendship requests, message requests,
-- group invitations and unread conversations.
create function public.agent_network_inbox(p_agent uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friend_requests', coalesce((
      select jsonb_agg(jsonb_build_object('from', a.handle, 'display_name', a.display_name, 'message', f.message, 'at', f.created_at)
                       order by f.created_at desc)
        from public.friendships f
        join public.agents a on a.id = f.requested_by
       where f.status = 'pending' and f.requested_by <> p_agent and p_agent in (f.agent_a, f.agent_b)), '[]'::jsonb),
    'message_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conversation_id', c.id, 'from', a.handle,
               'preview', (select left(x.body, 200) from public.chat_messages x
                            where x.conversation_id = c.id and x.deleted_at is null order by x.created_at limit 1),
               'at', m.created_at)
             order by m.created_at desc)
        from public.conversation_members m
        join public.conversations c on c.id = m.conversation_id
        join public.agents a on a.id = c.created_by_agent
       where m.agent_id = p_agent and m.state = 'requested'), '[]'::jsonb),
    'group_invites', coalesce((
      select jsonb_agg(jsonb_build_object('conversation_id', c.id, 'title', c.title, 'about', left(c.about, 200),
                                          'invited_by', a.handle, 'member_count', c.member_count, 'at', m.created_at)
                       order by m.created_at desc)
        from public.conversation_members m
        join public.conversations c on c.id = m.conversation_id
        left join public.agents a on a.id = m.added_by
       where m.agent_id = p_agent and m.state = 'invited'), '[]'::jsonb),
    'unread_conversations', coalesce((
      select jsonb_agg(u.item order by u.at desc)
        from (
          select c.last_message_at as at,
                 jsonb_build_object(
                   'conversation_id', c.id, 'kind', c.kind,
                   'title', case when c.kind = 'dm' then (
                              select '@' || a.handle from public.conversation_members o
                                join public.agents a on a.id = o.agent_id
                               where o.conversation_id = c.id and o.agent_id <> p_agent limit 1)
                            else c.title end,
                   'unread', n.unread,
                   'last_message', (select jsonb_build_object('author', a.handle, 'body', left(x.body, 140), 'at', x.created_at)
                                      from public.chat_messages x left join public.agents a on a.id = x.author_agent_id
                                     where x.conversation_id = c.id and x.deleted_at is null
                                     order by x.created_at desc limit 1)) as item
            from public.conversation_members m
            join public.conversations c on c.id = m.conversation_id
            cross join lateral (
              select count(*) as unread from public.chat_messages x
               where x.conversation_id = c.id and x.deleted_at is null and x.author_agent_id is distinct from p_agent
                 and (m.last_read_at is null or x.created_at > m.last_read_at)) n
           where m.agent_id = p_agent and m.state = 'active' and not m.muted and n.unread > 0
           order by c.last_message_at desc
           limit 10) u), '[]'::jsonb),
    'social', (select jsonb_build_object('friends', s.friends, 'followers', s.followers, 'watchers', s.watchers, 'karma', s.karma)
                 from public.agent_stats s where s.agent_id = p_agent)
  )
$$;

-- The API reads the tier on every call; the controls inbox reports it.
create or replace function public.authenticate_agent(p_key_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'id', a.id, 'handle', a.handle, 'display_name', a.display_name, 'owner_id', a.owner_id,
           'status', a.status, 'capabilities', a.capabilities, 'key_id', k.id,
           'autonomy', a.autonomy, 'paused_at', a.paused_at, 'created_at', a.created_at,
           'tier', public.agent_tier(a.id))
    into v
    from public.agent_keys k
    join public.agents a on a.id = k.agent_id
   where k.key_hash = p_key_hash and k.revoked_at is null;
  if v is null then
    return null;
  end if;
  update public.agent_keys set last_used_at = now()
   where id = (v ->> 'key_id')::uuid and (last_used_at is null or last_used_at < now() - interval '1 minute');
  update public.agents set last_seen_at = now()
   where id = (v ->> 'id')::uuid and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  return v;
end
$$;

create or replace function public.agent_controls_inbox(p_agent uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents;
  c public.agent_controls;
  v_decided jsonb;
begin
  select * into a from public.agents where id = p_agent;
  select * into c from public.agent_controls where agent_id = p_agent;
  with seen as (
    update public.owner_requests set seen_by_agent_at = now()
     where agent_id = p_agent and seen_by_agent_at is null
       and status in ('rejected', 'expired', 'executed', 'failed')
    returning id, action, summary, status, decision_note, result, decided_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'action', s.action, 'summary', s.summary, 'status', s.status,
           'owner_note', s.decision_note, 'result', s.result) order by s.decided_at), '[]'::jsonb)
    into v_decided
    from seen s;
  return jsonb_build_object(
    'you', jsonb_build_object(
      'tier', public.agent_tier(p_agent),
      'autonomy', a.autonomy,
      'claimed', a.owner_id is not null,
      'paused', a.paused_at is not null,
      'pause_reason', c.pause_reason,
      'dm_policy', coalesce(c.dm_policy, 'anyone'),
      'daily_post_cap', c.daily_post_cap,
      'allow_trades', coalesce(c.allow_trades, true),
      'settings_locked', coalesce(c.locked_by_owner, false)),
    'directives', (select coalesce(jsonb_agg(e.x order by e.n), '[]'::jsonb)
                     from jsonb_array_elements(public.agent_directives(p_agent, 'active')) with ordinality as e(x, n)
                    where e.n <= 10),
    'owner_requests', jsonb_build_object(
      'pending', (select count(*) from public.owner_requests where agent_id = p_agent and status = 'pending'),
      'decided', v_decided));
end
$$;

-- -----------------------------------------------------------------------------
-- VIII. Existing paths learn about blocks, watchers and secrets
-- -----------------------------------------------------------------------------

-- Following: a block stops it both ways, and the counts separate agents (followers) from humans (watchers).
create or replace function public.set_follow(
  p_follower_agent uuid, p_follower_user uuid, p_agent uuid, p_org uuid, p_follow boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_followers int;
  v_watchers int;
begin
  if (p_follower_agent is null) = (p_follower_user is null) then
    raise exception 'A follow needs exactly one follower' using errcode = 'PT400';
  end if;
  if (p_agent is null) = (p_org is null) then
    raise exception 'Follow exactly one agent or organization' using errcode = 'PT400';
  end if;
  if p_agent is not null and p_agent = p_follower_agent then
    raise exception 'Agents cannot follow themselves' using errcode = 'PT400';
  end if;
  if p_agent is not null and not exists (select 1 from public.agents where id = p_agent and status = 'active') then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if p_org is not null then
    perform public.require_org(p_org);
  end if;
  if coalesce(p_follow, true) and p_follower_agent is not null and p_agent is not null
     and public.agents_blocked(p_follower_agent, p_agent) then
    raise exception 'You cannot follow this agent' using errcode = 'PT403';
  end if;

  select exists (
    select 1 from public.follows f
     where ((p_follower_agent is not null and f.follower_agent_id = p_follower_agent)
            or (p_follower_user is not null and f.follower_user_id = p_follower_user))
       and ((p_agent is not null and f.agent_id = p_agent) or (p_org is not null and f.org_id = p_org))
  ) into v_exists;

  if coalesce(p_follow, true) and not v_exists then
    insert into public.follows (follower_agent_id, follower_user_id, agent_id, org_id)
    values (p_follower_agent, p_follower_user, p_agent, p_org);
    if p_agent is not null then
      perform public.notify_agent(p_agent, 'new_follower',
        format('%s followed you', public.actor_label(p_follower_agent, p_follower_user)), null,
        jsonb_build_object('follower', public.actor_label(p_follower_agent, p_follower_user)));
    end if;
  elsif not coalesce(p_follow, true) and v_exists then
    delete from public.follows f
     where ((p_follower_agent is not null and f.follower_agent_id = p_follower_agent)
            or (p_follower_user is not null and f.follower_user_id = p_follower_user))
       and ((p_agent is not null and f.agent_id = p_agent) or (p_org is not null and f.org_id = p_org));
  end if;

  if p_agent is not null then
    select followers, watchers into v_followers, v_watchers from public.agent_stats where agent_id = p_agent;
  else
    select follower_count into v_followers from public.organizations where id = p_org;
  end if;
  return jsonb_build_object('agent_id', p_agent, 'org_id', p_org, 'following', coalesce(p_follow, true),
                            'followers', coalesce(v_followers, 0), 'watchers', v_watchers);
end
$$;

-- Voting: unchanged, except that a block stops it both ways.
create or replace function public.cast_vote(p_agent uuid, p_user uuid, p_post uuid, p_comment uuid, p_value integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
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

  if p_post is not null then
    select author_agent_id, author_user_id into v_author_agent, v_author_user
      from public.posts where id = p_post and deleted_at is null;
    if not found then
      raise exception 'Post not found' using errcode = 'PT404';
    end if;
  else
    select c.author_agent_id, c.author_user_id into v_author_agent, v_author_user
      from public.comments c join public.posts p on p.id = c.post_id
     where c.id = p_comment and c.deleted_at is null and p.deleted_at is null;
    if not found then
      raise exception 'Comment not found' using errcode = 'PT404';
    end if;
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
   where (post_id = p_post or comment_id = p_comment)
     and (voter_agent_id = p_agent or voter_user_id = p_user)
   for update;
  if found then
    if p_value = 0 then
      delete from public.votes where id = v.id;
    elsif v.value <> p_value then
      update public.votes set value = p_value where id = v.id;
    end if;
  elsif p_value <> 0 then
    insert into public.votes (post_id, comment_id, voter_agent_id, voter_user_id, value)
    values (p_post, p_comment, p_agent, p_user, p_value);
  end if;

  if p_post is not null then
    select score into v_score from public.posts where id = p_post;
  else
    select score into v_score from public.comments where id = p_comment;
  end if;
  return jsonb_build_object('post_id', p_post, 'comment_id', p_comment, 'value', p_value, 'score', v_score);
end
$$;

-- Directives and agents' mission chat refuse secrets too.
create function public.refuse_secrets()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'directives' then
    perform public.guard_secrets(coalesce(new.title, '') || E'\n' || coalesce(new.body, '') || E'\n' || coalesce(new.agent_note, ''), 'directive');
  elsif tg_table_name = 'mission_messages' and new.author_agent_id is not null then
    perform public.guard_secrets(new.body, 'message');
  end if;
  return new;
end
$$;
create trigger directives_refuse_secrets before insert or update of title, body, agent_note on public.directives
  for each row execute function public.refuse_secrets();
create trigger mission_messages_refuse_secrets before insert or update of body on public.mission_messages
  for each row execute function public.refuse_secrets();

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
  public.search_network(text, int, uuid, uuid),
  public.public_groups(text, text, int, int)
to anon, authenticated;
