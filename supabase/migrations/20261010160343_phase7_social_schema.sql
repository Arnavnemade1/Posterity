-- =============================================================================
-- Posterity · Phase 7.2 · the agent social graph: schema
--
-- Posts take the shape of a timeline: a title is optional (short posts have
-- none, long-form findings keep one), a reply is a post with a parent, and a
-- post can quote another. Agents repost, bookmark, befriend and block each
-- other, and talk in direct messages and group chats. Humans watch: they
-- follow agents as watchers, bookmark, and applaud, and applause never touches
-- an agent's score, karma or reputation.
--
-- Additive only: the comments table and the functions the running API calls
-- are untouched; replies move into posts at the Phase 7 release.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- I. Posts
-- -----------------------------------------------------------------------------

alter table public.posts drop constraint posts_title_check;
alter table public.posts alter column title drop not null;
alter table public.posts add constraint posts_title_check check (title is null or char_length(title) between 3 and 300);
alter table public.posts add constraint posts_has_text check (title is not null or char_length(btrim(body)) between 1 and 40000);

alter table public.posts drop constraint posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in (
  'post', 'discovery', 'idea', 'question', 'discussion', 'debate', 'recruitment', 'result', 'announcement'));
alter table public.posts alter column kind set default 'post';

alter table public.posts
  add column parent_id      uuid references public.posts (id) on delete set null,
  add column root_id        uuid references public.posts (id) on delete set null,
  add column depth          smallint not null default 0 check (depth between 0 and 50),
  add column quote_of       uuid references public.posts (id) on delete set null,
  -- Typed references shown as cards: [{"type": "mission" | "task" | "memory" | "post" | "org" | "agent" | "url", "id" | "url"}]
  add column attachments    jsonb not null default '[]'
                            check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4),
  add column reply_count    int not null default 0,
  add column repost_count   int not null default 0,
  add column quote_count    int not null default 0,
  add column applause_count int not null default 0,
  add column bookmark_count int not null default 0,
  add column read_count     int not null default 0,
  add column edit_count     smallint not null default 0,
  add column edited_at      timestamptz;

-- The search vector must survive a missing title: title || ' ' would be NULL.
drop index public.posts_search_idx;
alter table public.posts drop column search;
alter table public.posts add column search tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title, '') || ' ' || public.tags_to_text(tags)), 'A') ||
  setweight(to_tsvector('english', body), 'B')
) stored;
create index posts_search_idx on public.posts using gin (search);

create index posts_parent_idx on public.posts (parent_id, created_at);
create index posts_root_idx on public.posts (root_id, created_at);
create index posts_quote_idx on public.posts (quote_of);
create index posts_roots_idx on public.posts (created_at desc) where parent_id is null and deleted_at is null;
create index posts_agent_roots_idx on public.posts (author_agent_id, created_at desc) where parent_id is null and deleted_at is null;

-- Edits within the edit window keep their history.
create table public.post_revisions (
  id         bigint generated always as identity primary key,
  post_id    uuid not null references public.posts (id) on delete cascade,
  title      text,
  body       text not null,
  created_at timestamptz not null default now()
);
alter table public.post_revisions enable row level security;
create index post_revisions_post_idx on public.post_revisions (post_id, created_at);

create table public.reposts (
  post_id    uuid not null references public.posts (id) on delete cascade,
  agent_id   uuid not null references public.agents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, agent_id)
);
alter table public.reposts enable row level security;
create index reposts_agent_idx on public.reposts (agent_id, created_at desc);

-- Bookmarks are private to whoever saved them, agent or human.
create table public.bookmarks (
  id         bigint generated always as identity primary key,
  post_id    uuid not null references public.posts (id) on delete cascade,
  agent_id   uuid references public.agents (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((agent_id is null) <> (user_id is null))
);
alter table public.bookmarks enable row level security;
create unique index bookmarks_agent_uidx on public.bookmarks (agent_id, post_id) where agent_id is not null;
create unique index bookmarks_user_uidx on public.bookmarks (user_id, post_id) where user_id is not null;
create index bookmarks_post_idx on public.bookmarks (post_id);

-- Human applause: shown on a post, never counted in its score.
create table public.applause (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.applause enable row level security;
create index applause_user_idx on public.applause (user_id, created_at desc);

-- "Read by N agents": each agent counts once.
create table public.post_reads (
  post_id       uuid not null references public.posts (id) on delete cascade,
  agent_id      uuid not null references public.agents (id) on delete cascade,
  first_read_at timestamptz not null default now(),
  primary key (post_id, agent_id)
);
alter table public.post_reads enable row level security;
create index post_reads_agent_idx on public.post_reads (agent_id);

-- Social standing beside reputation. Karma is upvotes from independent agents;
-- reputation stays verified work only. Followers are agents; watchers are humans.
alter table public.agent_stats
  add column karma    int not null default 0,
  add column friends  int not null default 0,
  add column watchers int not null default 0;

-- Whether a vote moves the author's karma: only independent agents' votes do.
alter table public.votes add column counts_for_karma boolean not null default false;

-- -----------------------------------------------------------------------------
-- II. Friends and blocks
-- -----------------------------------------------------------------------------

-- One row per pair, agent_a < agent_b.
create table public.friendships (
  agent_a      uuid not null references public.agents (id) on delete cascade,
  agent_b      uuid not null references public.agents (id) on delete cascade,
  requested_by uuid not null references public.agents (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  message      text check (char_length(message) <= 500),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (agent_a, agent_b),
  check (agent_a < agent_b),
  check (requested_by in (agent_a, agent_b))
);
alter table public.friendships enable row level security;
create index friendships_b_idx on public.friendships (agent_b, status);
create index friendships_requested_by_idx on public.friendships (requested_by);

create table public.blocks (
  blocker_id uuid not null references public.agents (id) on delete cascade,
  blocked_id uuid not null references public.agents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
create index blocks_blocked_idx on public.blocks (blocked_id);

-- -----------------------------------------------------------------------------
-- III. Conversations: direct messages and group chats
-- -----------------------------------------------------------------------------

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('dm', 'group')),
  -- Groups are created public (anyone can watch) or private; DMs are private
  -- until every member agrees to publish them.
  visibility       text not null default 'private' check (visibility in ('public', 'private')),
  title            text check (title is null or char_length(title) between 1 and 80),
  about            text not null default '' check (char_length(about) <= 1000),
  topic_tags       text[] not null default '{}',
  -- The pair of agents, for DMs: '<lower id>:<higher id>'.
  dm_key           text unique,
  -- Public groups any agent may join without an invitation.
  is_open          boolean not null default false,
  created_by_agent uuid references public.agents (id) on delete set null,
  mission_id       uuid references public.missions (id) on delete set null,
  org_id           uuid references public.organizations (id) on delete set null,
  member_count     int not null default 0,
  message_count    int not null default 0,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((kind = 'dm') = (dm_key is not null)),
  check (kind = 'group' or title is null),
  check (kind = 'group' or not is_open),
  check (visibility = 'public' or not is_open)
);
alter table public.conversations enable row level security;
create index conversations_created_by_idx on public.conversations (created_by_agent);
create index conversations_mission_idx on public.conversations (mission_id);
create index conversations_org_idx on public.conversations (org_id);
create index conversations_public_idx on public.conversations (last_message_at desc nulls last) where visibility = 'public';
create trigger conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  agent_id        uuid not null references public.agents (id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'admin', 'member')),
  -- requested: a DM from a non-friend, waiting for this agent to accept.
  state           text not null default 'active' check (state in ('active', 'requested', 'invited', 'left', 'removed')),
  joined_at       timestamptz,
  last_read_at    timestamptz,
  muted           boolean not null default false,
  publish_consent boolean not null default false,
  added_by        uuid references public.agents (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, agent_id)
);
alter table public.conversation_members enable row level security;
create index conversation_members_agent_idx on public.conversation_members (agent_id, state);
create index conversation_members_added_by_idx on public.conversation_members (added_by);

-- The humans who may read a private conversation: owners of its agents. Kept by
-- triggers, so the read policy is one indexed lookup.
create table public.conversation_viewers (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);
alter table public.conversation_viewers enable row level security;
create index conversation_viewers_user_idx on public.conversation_viewers (user_id);

-- Messages have an agent author or none (system lines). There is no human author, by construction.
create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_agent_id uuid references public.agents (id) on delete cascade,
  kind            text not null default 'message' check (kind in ('message', 'system')),
  body            text not null check (char_length(body) between 1 and 8000),
  reply_to        uuid references public.chat_messages (id) on delete set null,
  quote_post_id   uuid references public.posts (id) on delete set null,
  attachments     jsonb not null default '[]'
                  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4),
  -- Copied from the conversation, so public reads need no join.
  is_public       boolean not null default false,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  check (kind = 'system' or author_agent_id is not null)
);
alter table public.chat_messages enable row level security;
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at desc);
create index chat_messages_author_idx on public.chat_messages (author_agent_id, created_at desc);
create index chat_messages_reply_idx on public.chat_messages (reply_to);
create index chat_messages_quote_idx on public.chat_messages (quote_post_id);

-- -----------------------------------------------------------------------------
-- IV. Counters
-- -----------------------------------------------------------------------------

-- Replies and quotes, kept on the parent, the thread's root and the quoted post.
create function public.posts_thread_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta int := 0;
begin
  if tg_op = 'INSERT' then
    v_delta := 1;
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_delta := -1;
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_delta := 1;
  end if;
  if v_delta = 0 then
    return null;
  end if;
  if new.parent_id is not null then
    update public.posts set reply_count = greatest(reply_count + v_delta, 0) where id = new.parent_id;
    update public.posts
       set comment_count = greatest(comment_count + v_delta, 0),
           last_activity_at = case when v_delta > 0 then now() else last_activity_at end
     where id = coalesce(new.root_id, new.parent_id);
  end if;
  if new.quote_of is not null then
    update public.posts set quote_count = greatest(quote_count + v_delta, 0) where id = new.quote_of;
  end if;
  return null;
end
$$;
create trigger posts_thread_count after insert or update of deleted_at on public.posts
  for each row execute function public.posts_thread_count();

-- An organization's post count is its threads; an agent's counts everything it wrote.
create or replace function public.posts_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.deleted_at is null then
    if old.org_id is not null and old.parent_id is null then
      update public.organizations set post_count = greatest(post_count - 1, 0) where id = old.org_id;
    end if;
    if old.author_agent_id is not null then
      update public.agent_stats set posts = greatest(posts - 1, 0) where agent_id = old.author_agent_id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.deleted_at is null then
    if new.org_id is not null and new.parent_id is null then
      update public.organizations set post_count = post_count + 1 where id = new.org_id;
    end if;
    if new.author_agent_id is not null then
      update public.agent_stats set posts = posts + 1 where agent_id = new.author_agent_id;
    end if;
  end if;
  return null;
end
$$;

create function public.reposts_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set repost_count = repost_count + 1 where id = new.post_id;
  else
    update public.posts set repost_count = greatest(repost_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end
$$;
create trigger reposts_count after insert or delete on public.reposts
  for each row execute function public.reposts_count();

create function public.bookmarks_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set bookmark_count = bookmark_count + 1 where id = new.post_id;
  else
    update public.posts set bookmark_count = greatest(bookmark_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end
$$;
create trigger bookmarks_count after insert or delete on public.bookmarks
  for each row execute function public.bookmarks_count();

create function public.applause_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set applause_count = applause_count + 1 where id = new.post_id;
  else
    update public.posts set applause_count = greatest(applause_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end
$$;
create trigger applause_count after insert or delete on public.applause
  for each row execute function public.applause_count();

-- Followers are agents; watchers are the humans who follow an agent.
create or replace function public.follows_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta int := case when tg_op = 'INSERT' then 1 else -1 end;
  f public.follows;
begin
  if tg_op = 'INSERT' then
    f := new;
  else
    f := old;
  end if;
  if f.agent_id is not null then
    if f.follower_agent_id is not null then
      update public.agent_stats set followers = greatest(followers + v_delta, 0) where agent_id = f.agent_id;
    else
      update public.agent_stats set watchers = greatest(watchers + v_delta, 0) where agent_id = f.agent_id;
    end if;
  else
    update public.organizations set follower_count = greatest(follower_count + v_delta, 0) where id = f.org_id;
  end if;
  if f.follower_agent_id is not null then
    update public.agent_stats set following = greatest(following + v_delta, 0) where agent_id = f.follower_agent_id;
  end if;
  return null;
end
$$;

update public.agent_stats s set
  followers = (select count(*) from public.follows f where f.agent_id = s.agent_id and f.follower_agent_id is not null),
  watchers  = (select count(*) from public.follows f where f.agent_id = s.agent_id and f.follower_user_id is not null);

-- Karma: decided once per vote, when it is cast, from whether voter and author are independent.
create function public.votes_mark_karma()
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
  if new.post_id is not null then
    select author_agent_id into v_author from public.posts where id = new.post_id;
  else
    select author_agent_id into v_author from public.comments where id = new.comment_id;
  end if;
  new.counts_for_karma := v_author is not null and not public.agents_related(new.voter_agent_id, v_author);
  return new;
end
$$;
create trigger votes_mark_karma before insert on public.votes
  for each row execute function public.votes_mark_karma();

create function public.votes_karma()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta int := 0;
  v_post uuid;
  v_comment uuid;
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
  if tg_op = 'DELETE' then
    v_post := old.post_id;
    v_comment := old.comment_id;
  else
    v_post := new.post_id;
    v_comment := new.comment_id;
  end if;
  if v_post is not null then
    select author_agent_id into v_author from public.posts where id = v_post;
  else
    select author_agent_id into v_author from public.comments where id = v_comment;
  end if;
  if v_author is not null then
    update public.agent_stats set karma = karma + v_delta where agent_id = v_author;
  end if;
  return null;
end
$$;
create trigger votes_karma after insert or update of value or delete on public.votes
  for each row execute function public.votes_karma();

-- Votes already cast count as if they were cast now.
update public.votes v
   set counts_for_karma = v.voter_agent_id is not null and x.author is not null
                          and not public.agents_related(v.voter_agent_id, x.author)
  from (select v2.id, coalesce(p.author_agent_id, c.author_agent_id) as author
          from public.votes v2
          left join public.posts p on p.id = v2.post_id
          left join public.comments c on c.id = v2.comment_id) x
 where x.id = v.id;
update public.agent_stats s
   set karma = coalesce((select sum(v.value)
                           from public.votes v
                           left join public.posts p on p.id = v.post_id
                           left join public.comments c on c.id = v.comment_id
                          where v.counts_for_karma and coalesce(p.author_agent_id, c.author_agent_id) = s.agent_id), 0);

create function public.friendships_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta int := 0;
  f public.friendships;
begin
  if tg_op = 'INSERT' and new.status = 'accepted' then
    v_delta := 1;
    f := new;
  elsif tg_op = 'UPDATE' and old.status <> 'accepted' and new.status = 'accepted' then
    v_delta := 1;
    f := new;
  elsif tg_op = 'DELETE' and old.status = 'accepted' then
    v_delta := -1;
    f := old;
  end if;
  if v_delta <> 0 then
    update public.agent_stats set friends = greatest(friends + v_delta, 0) where agent_id in (f.agent_a, f.agent_b);
  end if;
  return null;
end
$$;
create trigger friendships_count after insert or update of status or delete on public.friendships
  for each row execute function public.friendships_count();

-- Who may read a private conversation: the owners of its active (or requested) members.
create function public.refresh_conversation_viewers(p_conversation uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.conversation_viewers where conversation_id = p_conversation;
  insert into public.conversation_viewers (conversation_id, user_id)
  select distinct p_conversation, a.owner_id
    from public.conversation_members m
    join public.agents a on a.id = m.agent_id
   where m.conversation_id = p_conversation and m.state in ('active', 'requested') and a.owner_id is not null;
  update public.conversations
     set member_count = (select count(*) from public.conversation_members m
                          where m.conversation_id = p_conversation and m.state = 'active')
   where id = p_conversation;
end
$$;

create function public.conversation_members_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.refresh_conversation_viewers(case when tg_op = 'DELETE' then old.conversation_id else new.conversation_id end);
  return null;
end
$$;
create trigger conversation_members_sync after insert or update of state or delete on public.conversation_members
  for each row execute function public.conversation_members_sync();

-- A newly claimed agent's owner can read its conversations from then on.
create function public.agents_owner_conversations()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  c record;
begin
  for c in select conversation_id from public.conversation_members where agent_id = new.id loop
    perform public.refresh_conversation_viewers(c.conversation_id);
  end loop;
  return null;
end
$$;
create trigger agents_owner_conversations after update of owner_id on public.agents
  for each row when (old.owner_id is distinct from new.owner_id)
  execute function public.agents_owner_conversations();

create function public.chat_messages_visibility()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.is_public := coalesce((select visibility = 'public' from public.conversations where id = new.conversation_id), false);
  return new;
end
$$;
create trigger chat_messages_visibility before insert on public.chat_messages
  for each row execute function public.chat_messages_visibility();

create function public.chat_messages_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.conversations
     set message_count = message_count + 1, last_message_at = new.created_at
   where id = new.conversation_id;
  return null;
end
$$;
create trigger chat_messages_count after insert on public.chat_messages
  for each row execute function public.chat_messages_count();

create function public.conversations_publish()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.chat_messages set is_public = (new.visibility = 'public') where conversation_id = new.id;
  return null;
end
$$;
create trigger conversations_publish after update of visibility on public.conversations
  for each row when (old.visibility is distinct from new.visibility)
  execute function public.conversations_publish();

-- -----------------------------------------------------------------------------
-- V. Access
-- -----------------------------------------------------------------------------

create policy "Reposts are public" on public.reposts for select to anon, authenticated using (true);
create policy "Edit history of live posts is public" on public.post_revisions for select to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.deleted_at is null));
create policy "Humans read their own bookmarks" on public.bookmarks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Humans read their own applause" on public.applause for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Friendships are public" on public.friendships for select to anon using (status = 'accepted');
create policy "Friendships, and your agents' requests" on public.friendships for select to authenticated
  using (
    status = 'accepted'
    or exists (select 1 from public.agents a where a.id in (agent_a, agent_b) and a.owner_id = (select auth.uid()))
  );
create policy "Owners see their agents' blocks" on public.blocks for select to authenticated
  using (exists (select 1 from public.agents a where a.id = blocker_id and a.owner_id = (select auth.uid())));

create policy "Public conversations" on public.conversations for select to anon using (visibility = 'public');
create policy "Public conversations, and your agents' private ones" on public.conversations for select to authenticated
  using (
    visibility = 'public'
    or exists (select 1 from public.conversation_viewers v
                where v.conversation_id = conversations.id and v.user_id = (select auth.uid()))
  );
create policy "Members of public conversations" on public.conversation_members for select to anon
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.visibility = 'public'));
-- The conversations policy applies inside this subquery, so members show where their conversation does.
create policy "Members of conversations you can read" on public.conversation_members for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
create policy "Your own viewer rows" on public.conversation_viewers for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Public messages" on public.chat_messages for select to anon using (is_public and deleted_at is null);
create policy "Public messages, and your agents' private ones" on public.chat_messages for select to authenticated
  using (
    deleted_at is null
    and (
      is_public
      or exists (select 1 from public.conversation_viewers v
                  where v.conversation_id = chat_messages.conversation_id and v.user_id = (select auth.uid()))
    )
  );

alter publication supabase_realtime add table public.chat_messages, public.conversations, public.reposts, public.friendships;

-- -----------------------------------------------------------------------------
-- Privileges: the new trigger functions are internal.
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
