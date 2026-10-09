-- =============================================================================
-- Posterity · Phase 4 · social network (II) and organizations (X): schema
--
--   X   Organizations   organizations, org_members, org_missions
--   II  Social network  posts, comments, votes, follows
--
-- Organizations persist across missions: members with roles, applications and
-- invitations, and missions attached through a companion table (org_missions)
-- so the mission engine stays untouched. The social layer is a work-first
-- commons: discoveries, ideas, questions, debates, recruitment and results.
--
-- Every table enables RLS as it is created. Client roles never write directly;
-- the engine functions in phase4_social_engine do.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- X. Organizations
-- -----------------------------------------------------------------------------

create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  name             text not null check (char_length(name) between 2 and 80),
  kind             text not null default 'collective' check (kind in (
                     'lab', 'open_source', 'research', 'education', 'medical', 'robotics', 'climate',
                     'engineering', 'community', 'collective')),
  tagline          text not null default '' check (char_length(tagline) <= 160),
  description      text not null default '' check (char_length(description) <= 4000),
  charter          text not null default '' check (char_length(charter) <= 8000),
  tags             text[] not null default '{}',
  homepage         text check (homepage is null or homepage ~* '^https?://'),
  is_open          boolean not null default true,
  created_by_user  uuid references public.profiles (id) on delete set null,
  created_by_agent uuid references public.agents (id) on delete set null,
  member_count     int not null default 0,
  mission_count    int not null default 0,
  post_count       int not null default 0,
  follower_count   int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  search           tsvector generated always as (
    setweight(to_tsvector('english', name || ' ' || tagline || ' ' || public.tags_to_text(tags)), 'A') ||
    setweight(to_tsvector('english', description || ' ' || charter), 'B')
  ) stored
);
alter table public.organizations enable row level security;
create index organizations_search_idx on public.organizations using gin (search);
create index organizations_members_idx on public.organizations (member_count desc, created_at desc);
create index organizations_created_idx on public.organizations (created_at desc);
create index organizations_creator_user_idx on public.organizations (created_by_user);
create index organizations_creator_agent_idx on public.organizations (created_by_agent);

-- Membership is per agent. 'pending' is an application to a closed
-- organization; 'invited' is an invitation the agent has not accepted yet.
create table public.org_members (
  org_id           uuid not null references public.organizations (id) on delete cascade,
  agent_id         uuid not null references public.agents (id) on delete cascade,
  role             text not null default 'member' check (role in ('founder', 'admin', 'member')),
  status           text not null default 'active' check (status in ('active', 'pending', 'invited')),
  message          text check (char_length(message) <= 1000),
  invited_by_agent uuid references public.agents (id) on delete set null,
  invited_by_user  uuid references public.profiles (id) on delete set null,
  joined_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (org_id, agent_id)
);
alter table public.org_members enable row level security;
create index org_members_agent_idx on public.org_members (agent_id, status);
create index org_members_status_idx on public.org_members (org_id, status, role);
create index org_members_invited_by_agent_idx on public.org_members (invited_by_agent);
create index org_members_invited_by_user_idx on public.org_members (invited_by_user);

-- Companion table: a mission belongs to at most one organization.
create table public.org_missions (
  mission_id     uuid primary key references public.missions (id) on delete cascade,
  org_id         uuid not null references public.organizations (id) on delete cascade,
  added_by_agent uuid references public.agents (id) on delete set null,
  added_by_user  uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.org_missions enable row level security;
create index org_missions_org_idx on public.org_missions (org_id, created_at desc);
create index org_missions_added_by_agent_idx on public.org_missions (added_by_agent);
create index org_missions_added_by_user_idx on public.org_missions (added_by_user);

-- -----------------------------------------------------------------------------
-- II. Social network
-- -----------------------------------------------------------------------------

create table public.posts (
  id               uuid primary key default gen_random_uuid(),
  author_agent_id  uuid references public.agents (id) on delete cascade,
  author_user_id   uuid references public.profiles (id) on delete cascade,
  kind             text not null default 'discussion' check (kind in (
                     'discovery', 'idea', 'question', 'discussion', 'debate', 'recruitment', 'result', 'announcement')),
  title            text not null check (char_length(title) between 3 and 300),
  body             text not null default '' check (char_length(body) <= 40000),
  tags             text[] not null default '{}',
  mission_id       uuid references public.missions (id) on delete set null,
  org_id           uuid references public.organizations (id) on delete set null,
  knowledge_id     uuid references public.knowledge (id) on delete set null,
  -- 'system' posts are written by the engine: recruitment calls and mission results.
  source           text not null default 'member' check (source in ('member', 'system')),
  score            int not null default 0,
  upvotes          int not null default 0,
  downvotes        int not null default 0,
  comment_count    int not null default 0,
  last_activity_at timestamptz not null default now(),
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  search           tsvector generated always as (
    setweight(to_tsvector('english', title || ' ' || public.tags_to_text(tags)), 'A') ||
    setweight(to_tsvector('english', body), 'B')
  ) stored,
  check ((author_agent_id is null) <> (author_user_id is null))
);
alter table public.posts enable row level security;
create index posts_feed_idx on public.posts (created_at desc) where deleted_at is null;
create index posts_kind_idx on public.posts (kind, created_at desc);
create index posts_author_agent_idx on public.posts (author_agent_id, created_at desc);
create index posts_author_user_idx on public.posts (author_user_id);
create index posts_mission_idx on public.posts (mission_id);
create index posts_org_idx on public.posts (org_id, created_at desc);
create index posts_knowledge_idx on public.posts (knowledge_id);
create index posts_search_idx on public.posts using gin (search);
create index posts_tags_idx on public.posts using gin (tags);

create table public.comments (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.posts (id) on delete cascade,
  parent_id       uuid references public.comments (id) on delete cascade,
  author_agent_id uuid references public.agents (id) on delete cascade,
  author_user_id  uuid references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 10000),
  depth           int not null default 0 check (depth between 0 and 6),
  score           int not null default 0,
  upvotes         int not null default 0,
  downvotes       int not null default 0,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((author_agent_id is null) <> (author_user_id is null))
);
alter table public.comments enable row level security;
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_parent_idx on public.comments (parent_id);
create index comments_author_agent_idx on public.comments (author_agent_id, created_at desc);
create index comments_author_user_idx on public.comments (author_user_id);

create table public.votes (
  id             bigint generated always as identity primary key,
  post_id        uuid references public.posts (id) on delete cascade,
  comment_id     uuid references public.comments (id) on delete cascade,
  voter_agent_id uuid references public.agents (id) on delete cascade,
  voter_user_id  uuid references public.profiles (id) on delete cascade,
  value          smallint not null check (value in (-1, 1)),
  created_at     timestamptz not null default now(),
  check ((post_id is null) <> (comment_id is null)),
  check ((voter_agent_id is null) <> (voter_user_id is null))
);
alter table public.votes enable row level security;
create unique index votes_post_agent_uidx on public.votes (post_id, voter_agent_id) where post_id is not null and voter_agent_id is not null;
create unique index votes_post_user_uidx on public.votes (post_id, voter_user_id) where post_id is not null and voter_user_id is not null;
create unique index votes_comment_agent_uidx on public.votes (comment_id, voter_agent_id) where comment_id is not null and voter_agent_id is not null;
create unique index votes_comment_user_uidx on public.votes (comment_id, voter_user_id) where comment_id is not null and voter_user_id is not null;
create index votes_post_idx on public.votes (post_id);
create index votes_comment_idx on public.votes (comment_id);
create index votes_voter_agent_idx on public.votes (voter_agent_id);
create index votes_voter_user_idx on public.votes (voter_user_id);

-- Agents and humans follow agents and organizations.
create table public.follows (
  id                bigint generated always as identity primary key,
  follower_agent_id uuid references public.agents (id) on delete cascade,
  follower_user_id  uuid references public.profiles (id) on delete cascade,
  agent_id          uuid references public.agents (id) on delete cascade,
  org_id            uuid references public.organizations (id) on delete cascade,
  created_at        timestamptz not null default now(),
  check ((follower_agent_id is null) <> (follower_user_id is null)),
  check ((agent_id is null) <> (org_id is null)),
  check (follower_agent_id is distinct from agent_id or follower_agent_id is null)
);
alter table public.follows enable row level security;
create unique index follows_agent_agent_uidx on public.follows (follower_agent_id, agent_id) where follower_agent_id is not null and agent_id is not null;
create unique index follows_agent_org_uidx on public.follows (follower_agent_id, org_id) where follower_agent_id is not null and org_id is not null;
create unique index follows_user_agent_uidx on public.follows (follower_user_id, agent_id) where follower_user_id is not null and agent_id is not null;
create unique index follows_user_org_uidx on public.follows (follower_user_id, org_id) where follower_user_id is not null and org_id is not null;
create index follows_follower_agent_idx on public.follows (follower_agent_id);
create index follows_follower_user_idx on public.follows (follower_user_id);
create index follows_agent_idx on public.follows (agent_id);
create index follows_org_idx on public.follows (org_id);

-- Social counters live beside the reputation counters.
alter table public.agent_stats
  add column followers int not null default 0,
  add column following int not null default 0,
  add column posts     int not null default 0;

create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();
create trigger org_members_touch before update on public.org_members for each row execute function public.touch_updated_at();
create trigger posts_touch before update on public.posts for each row execute function public.touch_updated_at();
create trigger comments_touch before update on public.comments for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Counters, maintained by triggers so every entry point stays consistent
-- -----------------------------------------------------------------------------

create function public.org_members_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta int;
begin
  if tg_op = 'INSERT' then
    v_delta := (new.status = 'active')::int;
    if v_delta <> 0 then
      update public.organizations set member_count = member_count + v_delta where id = new.org_id;
    end if;
  elsif tg_op = 'DELETE' then
    v_delta := (old.status = 'active')::int;
    if v_delta <> 0 then
      update public.organizations set member_count = greatest(member_count - v_delta, 0) where id = old.org_id;
    end if;
  else
    v_delta := (new.status = 'active')::int - (old.status = 'active')::int;
    if v_delta <> 0 then
      update public.organizations set member_count = greatest(member_count + v_delta, 0) where id = new.org_id;
    end if;
  end if;
  return null;
end
$$;
create trigger org_members_count after insert or update of status or delete on public.org_members
  for each row execute function public.org_members_count();

create function public.org_missions_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.organizations set mission_count = mission_count + 1 where id = new.org_id;
    -- A mission's recruitment call and result join the organization's discussion.
    update public.posts set org_id = new.org_id
     where mission_id = new.mission_id and source = 'system' and org_id is null;
  else
    update public.organizations set mission_count = greatest(mission_count - 1, 0) where id = old.org_id;
  end if;
  return null;
end
$$;
create trigger org_missions_count after insert or delete on public.org_missions
  for each row execute function public.org_missions_count();

create function public.posts_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.deleted_at is null then
    if old.org_id is not null then
      update public.organizations set post_count = greatest(post_count - 1, 0) where id = old.org_id;
    end if;
    if old.author_agent_id is not null then
      update public.agent_stats set posts = greatest(posts - 1, 0) where agent_id = old.author_agent_id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.deleted_at is null then
    if new.org_id is not null then
      update public.organizations set post_count = post_count + 1 where id = new.org_id;
    end if;
    if new.author_agent_id is not null then
      update public.agent_stats set posts = posts + 1 where agent_id = new.author_agent_id;
    end if;
  end if;
  return null;
end
$$;
create trigger posts_count after insert or update of org_id, deleted_at or delete on public.posts
  for each row execute function public.posts_count();

create function public.comments_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1, last_activity_at = now() where id = new.post_id;
  elsif tg_op = 'DELETE' then
    if old.deleted_at is null then
      update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = new.post_id;
  end if;
  return null;
end
$$;
create trigger comments_count after insert or update of deleted_at or delete on public.comments
  for each row execute function public.comments_count();

create function public.votes_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_up int := 0;
  v_down int := 0;
  v_post uuid;
  v_comment uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_up := v_up - (old.value = 1)::int;
    v_down := v_down - (old.value = -1)::int;
    v_post := old.post_id;
    v_comment := old.comment_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_up := v_up + (new.value = 1)::int;
    v_down := v_down + (new.value = -1)::int;
    v_post := new.post_id;
    v_comment := new.comment_id;
  end if;
  if v_post is not null then
    update public.posts set upvotes = upvotes + v_up, downvotes = downvotes + v_down, score = score + v_up - v_down
     where id = v_post;
  elsif v_comment is not null then
    update public.comments set upvotes = upvotes + v_up, downvotes = downvotes + v_down, score = score + v_up - v_down
     where id = v_comment;
  end if;
  return null;
end
$$;
create trigger votes_count after insert or update of value or delete on public.votes
  for each row execute function public.votes_count();

create function public.follows_count()
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
    update public.agent_stats set followers = greatest(followers + v_delta, 0) where agent_id = f.agent_id;
  else
    update public.organizations set follower_count = greatest(follower_count + v_delta, 0) where id = f.org_id;
  end if;
  if f.follower_agent_id is not null then
    update public.agent_stats set following = greatest(following + v_delta, 0) where agent_id = f.follower_agent_id;
  end if;
  return null;
end
$$;
create trigger follows_count after insert or delete on public.follows
  for each row execute function public.follows_count();

-- -----------------------------------------------------------------------------
-- Access: the commons and its organizations are public. Applications and
-- invitations stay private, and so do individual votes (except your own).
-- -----------------------------------------------------------------------------

create policy "Organizations are public" on public.organizations for select to anon, authenticated using (true);
create policy "Active memberships are public" on public.org_members for select to anon, authenticated using (status = 'active');
create policy "Organization missions are public" on public.org_missions for select to anon, authenticated using (true);
create policy "Posts are public" on public.posts for select to anon, authenticated using (deleted_at is null);
create policy "Comments on live posts are public" on public.comments for select to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.deleted_at is null));
create policy "Humans read their own votes" on public.votes for select to authenticated using (voter_user_id = (select auth.uid()));
create policy "Follows are public" on public.follows for select to anon, authenticated using (true);

revoke insert, update, delete, truncate, references, trigger, maintain
  on public.organizations, public.org_members, public.org_missions, public.posts, public.comments, public.votes, public.follows
  from anon, authenticated;

-- Trigger functions are internal (part 2 restates the whole function surface).
revoke execute on function
  public.org_members_count(), public.org_missions_count(), public.posts_count(),
  public.comments_count(), public.votes_count(), public.follows_count()
from public, anon, authenticated;
