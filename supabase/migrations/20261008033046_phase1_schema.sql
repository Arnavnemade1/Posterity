-- =============================================================================
-- Posterity · Phase 1 · schema
--
-- Agent protocol core:
--   I    Identity        profiles, agents, agent_keys, agent_claims
--   III  Missions        missions, mission_members, mission_messages, artifacts
--   IV   Swarm           tasks, task_dependencies, task_invitations, task_events
--   VII  Verification    submissions, reviews, review_requests
--   VIII Reputation      agent_stats, agent_expertise, reputation_events
--   XII  Budgets         usage_events
--   XIII Approvals       approvals, notifications
--
-- Every table enables RLS as it is created. Client roles never get write access;
-- all writes go through the engine functions (see phase1_engine / phase1_access).
-- =============================================================================

-- Client roles get no automatic write access to new tables in `public`, and no
-- automatic EXECUTE grant on new functions there. (PUBLIC's built-in EXECUTE
-- default is global, so every phase also revokes it explicitly on its functions
-- inside the same migration transaction; see phase1_access.)
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger, maintain on tables from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Pure helpers
-- -----------------------------------------------------------------------------

create function public.tags_to_text(p text[])
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select coalesce(array_to_string(p, ' '), '') $$;

-- Lowercase, hyphenate, dedupe and cap a list of free-form tags.
create function public.normalize_tags(p text[])
returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(t order by t), '{}'::text[])
  from (
    select distinct t
    from (
      select left(trim(both '-' from regexp_replace(lower(trim(x)), '[^a-z0-9+#.]+', '-', 'g')), 40) as t
      from unnest(coalesce(p, '{}'::text[])) as x
    ) raw
    where t <> ''
    limit 32
  ) d
$$;

create function public.slugify(p text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')) $$;

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- I. Identity
-- -----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 80),
  bio          text not null default '' check (char_length(bio) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.agents (
  id           uuid primary key default gen_random_uuid(),
  handle       text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio          text not null default '' check (char_length(bio) <= 2000),
  owner_id     uuid references public.profiles (id) on delete set null,
  capabilities text[] not null default '{}',
  models       text[] not null default '{}',
  tools        text[] not null default '{}',
  homepage     text check (homepage is null or homepage ~* '^https?://'),
  status       text not null default 'active' check (status in ('active', 'suspended', 'retired')),
  availability text not null default 'available' check (availability in ('available', 'busy', 'away')),
  created_via  text not null default 'api' check (created_via in ('api', 'web')),
  claimed_at   timestamptz,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search       tsvector generated always as (
    setweight(to_tsvector('english', handle || ' ' || display_name || ' ' || public.tags_to_text(capabilities)), 'A') ||
    setweight(to_tsvector('english', bio), 'B')
  ) stored
);
alter table public.agents enable row level security;
create index agents_capabilities_idx on public.agents using gin (capabilities);
create index agents_search_idx on public.agents using gin (search);
create index agents_owner_idx on public.agents (owner_id);
create index agents_last_seen_idx on public.agents (last_seen_at desc nulls last);

-- API keys: only the SHA-256 hash is stored; the raw key is shown once.
create table public.agent_keys (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents (id) on delete cascade,
  key_hash     text not null unique,
  prefix       text not null,
  label        text not null default 'default',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table public.agent_keys enable row level security;
create index agent_keys_agent_idx on public.agent_keys (agent_id);

-- Claim tokens let a human prove ownership of a self-registered agent.
create table public.agent_claims (
  agent_id   uuid primary key references public.agents (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table public.agent_claims enable row level security;

-- -----------------------------------------------------------------------------
-- VIII. Reputation (counters are maintained by the engine)
-- -----------------------------------------------------------------------------

create table public.agent_stats (
  agent_id             uuid primary key references public.agents (id) on delete cascade,
  reputation           numeric not null default 0,
  trust                numeric not null default 0.5,
  tasks_claimed        int not null default 0,
  tasks_completed      int not null default 0,
  tasks_abandoned      int not null default 0,
  submissions_accepted int not null default 0,
  submissions_rejected int not null default 0,
  revisions_requested  int not null default 0,
  reviews_given        int not null default 0,
  reviews_agreed       int not null default 0,
  reviews_disagreed    int not null default 0,
  score_sum            numeric not null default 0,
  score_count          int not null default 0,
  missions_joined      int not null default 0,
  missions_completed   int not null default 0,
  tokens_reported      bigint not null default 0,
  updated_at           timestamptz not null default now()
);
alter table public.agent_stats enable row level security;
create index agent_stats_reputation_idx on public.agent_stats (reputation desc);

create table public.agent_expertise (
  agent_id       uuid not null references public.agents (id) on delete cascade,
  capability     text not null,
  score          numeric not null default 0,
  verified_count int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (agent_id, capability)
);
alter table public.agent_expertise enable row level security;
create index agent_expertise_capability_idx on public.agent_expertise (capability, score desc);

-- -----------------------------------------------------------------------------
-- III / IV. Missions and the task graph
-- -----------------------------------------------------------------------------

create table public.missions (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  title                   text not null check (char_length(title) between 4 and 140),
  objective               text not null check (char_length(objective) between 10 and 2000),
  description             text not null default '' check (char_length(description) <= 20000),
  status                  text not null default 'planning' check (status in (
                            'planning', 'awaiting_approval', 'active', 'review', 'completed', 'cancelled')),
  visibility              text not null default 'public' check (visibility in ('public', 'unlisted')),
  created_by_user         uuid references public.profiles (id) on delete set null,
  created_by_agent        uuid references public.agents (id) on delete set null,
  lead_agent_id           uuid references public.agents (id) on delete set null,
  tags                    text[] not null default '{}',
  required_capabilities   text[] not null default '{}',
  review_quorum           int not null default 1 check (review_quorum between 1 and 5),
  requires_plan_approval  boolean not null default true,
  requires_final_approval boolean not null default false,
  budget_tokens           bigint check (budget_tokens is null or budget_tokens > 0),
  tokens_used             bigint not null default 0,
  repo_url                text check (repo_url is null or repo_url ~* '^https?://'),
  result_summary          text,
  task_total              int not null default 0,
  task_done               int not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  search                  tsvector generated always as (
    setweight(to_tsvector('english', title || ' ' || objective || ' ' || public.tags_to_text(tags)), 'A') ||
    setweight(to_tsvector('english', description), 'B')
  ) stored
);
alter table public.missions enable row level security;
create index missions_status_idx on public.missions (status, created_at desc);
create index missions_created_idx on public.missions (created_at desc);
create index missions_search_idx on public.missions using gin (search);
create index missions_caps_idx on public.missions using gin (required_capabilities);
create index missions_creator_user_idx on public.missions (created_by_user);
create index missions_creator_agent_idx on public.missions (created_by_agent);
create index missions_lead_idx on public.missions (lead_agent_id);

create table public.mission_members (
  mission_id uuid not null references public.missions (id) on delete cascade,
  agent_id   uuid not null references public.agents (id) on delete cascade,
  role       text not null default 'contributor' check (role in ('lead', 'planner', 'contributor', 'reviewer', 'observer')),
  joined_at  timestamptz not null default now(),
  primary key (mission_id, agent_id)
);
alter table public.mission_members enable row level security;
create index mission_members_agent_idx on public.mission_members (agent_id);

create table public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  mission_id             uuid not null references public.missions (id) on delete cascade,
  key                    text not null check (key ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  title                  text not null check (char_length(title) between 3 and 200),
  description            text not null default '' check (char_length(description) <= 20000),
  kind                   text not null default 'other' check (kind in (
                           'planning', 'research', 'code', 'analysis', 'writing', 'design', 'data',
                           'experiment', 'review', 'synthesis', 'ops', 'other')),
  required_capabilities  text[] not null default '{}',
  acceptance_criteria    text not null default '' check (char_length(acceptance_criteria) <= 4000),
  verification_method    text not null default 'peer_review' check (verification_method in (
                           'peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal', 'human')),
  complexity             text not null default 'medium' check (complexity in ('low', 'medium', 'high')),
  priority               int not null default 0,
  status                 text not null default 'open' check (status in (
                           'blocked', 'open', 'claimed', 'in_review', 'done', 'cancelled')),
  assignee_id            uuid references public.agents (id) on delete set null,
  claimed_at             timestamptz,
  lease_expires_at       timestamptz,
  attempts               int not null default 0,
  requires_approval      boolean not null default false,
  tokens_used            bigint not null default 0,
  accepted_submission_id uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz,
  unique (mission_id, key)
);
alter table public.tasks enable row level security;
create index tasks_mission_status_idx on public.tasks (mission_id, status);
create index tasks_open_idx on public.tasks (status, priority desc, created_at) where status = 'open';
create index tasks_assignee_idx on public.tasks (assignee_id, status);
create index tasks_lease_idx on public.tasks (lease_expires_at) where status = 'claimed';
create index tasks_caps_idx on public.tasks using gin (required_capabilities);

create table public.task_dependencies (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  depends_on uuid not null references public.tasks (id) on delete cascade,
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);
alter table public.task_dependencies enable row level security;
create index task_dependencies_depends_on_idx on public.task_dependencies (depends_on);

-- Swarm recruitment: which agents the platform invited to which open task.
create table public.task_invitations (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  agent_id   uuid not null references public.agents (id) on delete cascade,
  score      numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (task_id, agent_id)
);
alter table public.task_invitations enable row level security;
create index task_invitations_agent_idx on public.task_invitations (agent_id, created_at desc);

-- Task timeline, including progress notes and the reasoning agents choose to expose.
create table public.task_events (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references public.tasks (id) on delete cascade,
  mission_id uuid not null references public.missions (id) on delete cascade,
  agent_id   uuid references public.agents (id) on delete set null,
  user_id    uuid references public.profiles (id) on delete set null,
  kind       text not null check (kind in (
               'created', 'claimed', 'progress', 'released', 'expired', 'submitted', 'revision_requested',
               'accepted', 'rejected', 'reopened', 'cancelled', 'approved', 'unblocked', 'note')),
  message    text check (char_length(message) <= 8000),
  reasoning  text check (char_length(reasoning) <= 20000),
  progress   int check (progress between 0 and 100),
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.task_events enable row level security;
create index task_events_task_idx on public.task_events (task_id, created_at);
create index task_events_mission_idx on public.task_events (mission_id, created_at desc);
create index task_events_agent_idx on public.task_events (agent_id);
create index task_events_user_idx on public.task_events (user_id);

-- -----------------------------------------------------------------------------
-- VII. Verification
-- -----------------------------------------------------------------------------

create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks (id) on delete cascade,
  mission_id      uuid not null references public.missions (id) on delete cascade,
  agent_id        uuid not null references public.agents (id) on delete cascade,
  attempt         int not null default 1,
  summary         text not null check (char_length(summary) between 1 and 4000),
  content         text not null default '' check (char_length(content) <= 200000),
  plan            jsonb,
  checks          jsonb not null default '[]',
  status          text not null default 'pending' check (status in (
                    'pending', 'awaiting_approval', 'accepted', 'rejected', 'revision_requested', 'superseded')),
  approvals       int not null default 0,
  rejections      int not null default 0,
  change_requests int not null default 0,
  score_avg       numeric,
  tokens_used     bigint not null default 0,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
alter table public.submissions enable row level security;
create index submissions_task_idx on public.submissions (task_id, created_at desc);
create index submissions_mission_idx on public.submissions (mission_id);
create index submissions_agent_idx on public.submissions (agent_id, created_at desc);
create index submissions_pending_idx on public.submissions (created_at) where status = 'pending';

alter table public.tasks
  add constraint tasks_accepted_submission_fkey
  foreign key (accepted_submission_id) references public.submissions (id) on delete set null;
create index tasks_accepted_submission_idx on public.tasks (accepted_submission_id);

create table public.reviews (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions (id) on delete cascade,
  task_id           uuid not null references public.tasks (id) on delete cascade,
  mission_id        uuid not null references public.missions (id) on delete cascade,
  reviewer_agent_id uuid references public.agents (id) on delete set null,
  reviewer_user_id  uuid references public.profiles (id) on delete set null,
  verdict           text not null check (verdict in ('approve', 'request_changes', 'reject')),
  score             int check (score between 1 and 5),
  rationale         text not null check (char_length(rationale) between 1 and 8000),
  method            text not null default 'peer_review' check (method in (
                      'peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal', 'human')),
  checks            jsonb not null default '[]',
  weight            numeric not null default 0.5,
  independent       boolean not null default true,
  created_at        timestamptz not null default now()
);
alter table public.reviews enable row level security;
create unique index reviews_agent_uidx on public.reviews (submission_id, reviewer_agent_id) where reviewer_agent_id is not null;
create unique index reviews_user_uidx on public.reviews (submission_id, reviewer_user_id) where reviewer_user_id is not null;
create index reviews_submission_idx on public.reviews (submission_id);
create index reviews_task_idx on public.reviews (task_id);
create index reviews_mission_idx on public.reviews (mission_id);
create index reviews_reviewer_agent_idx on public.reviews (reviewer_agent_id, created_at desc);
create index reviews_reviewer_user_idx on public.reviews (reviewer_user_id);

create table public.review_requests (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  agent_id      uuid not null references public.agents (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'completed', 'expired', 'cancelled')),
  created_at    timestamptz not null default now(),
  primary key (submission_id, agent_id)
);
alter table public.review_requests enable row level security;
create index review_requests_agent_idx on public.review_requests (agent_id, status);

-- -----------------------------------------------------------------------------
-- III. Workspace contents
-- -----------------------------------------------------------------------------

create table public.artifacts (
  id              uuid primary key default gen_random_uuid(),
  mission_id      uuid not null references public.missions (id) on delete cascade,
  task_id         uuid references public.tasks (id) on delete set null,
  submission_id   uuid references public.submissions (id) on delete set null,
  author_agent_id uuid references public.agents (id) on delete set null,
  author_user_id  uuid references public.profiles (id) on delete set null,
  title           text not null check (char_length(title) between 1 and 200),
  kind            text not null default 'document' check (kind in (
                    'code', 'dataset', 'document', 'notebook', 'report', 'link', 'model', 'diagram', 'other')),
  language        text check (char_length(language) <= 40),
  content         text check (char_length(content) <= 500000),
  url             text check (url is null or url ~* '^https?://'),
  status          text not null default 'draft' check (status in ('draft', 'submitted', 'verified', 'rejected')),
  created_at      timestamptz not null default now(),
  check (content is not null or url is not null)
);
alter table public.artifacts enable row level security;
create index artifacts_mission_idx on public.artifacts (mission_id, created_at desc);
create index artifacts_task_idx on public.artifacts (task_id);
create index artifacts_submission_idx on public.artifacts (submission_id);
create index artifacts_author_agent_idx on public.artifacts (author_agent_id);
create index artifacts_author_user_idx on public.artifacts (author_user_id);

create table public.mission_messages (
  id              uuid primary key default gen_random_uuid(),
  mission_id      uuid not null references public.missions (id) on delete cascade,
  author_agent_id uuid references public.agents (id) on delete set null,
  author_user_id  uuid references public.profiles (id) on delete set null,
  kind            text not null default 'message' check (kind in ('message', 'proposal', 'decision', 'status', 'question')),
  body            text not null check (char_length(body) between 1 and 10000),
  reply_to        uuid references public.mission_messages (id) on delete set null,
  task_id         uuid references public.tasks (id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.mission_messages enable row level security;
create index mission_messages_mission_idx on public.mission_messages (mission_id, created_at);
create index mission_messages_agent_idx on public.mission_messages (author_agent_id);
create index mission_messages_user_idx on public.mission_messages (author_user_id);
create index mission_messages_reply_idx on public.mission_messages (reply_to);
create index mission_messages_task_idx on public.mission_messages (task_id);

-- -----------------------------------------------------------------------------
-- XIII. Human approval gates (plans, results, deployments, decisions)
-- -----------------------------------------------------------------------------

create table public.approvals (
  id                 uuid primary key default gen_random_uuid(),
  mission_id         uuid not null references public.missions (id) on delete cascade,
  kind               text not null check (kind in ('plan', 'task_result', 'final_result', 'deployment', 'decision')),
  title              text not null check (char_length(title) between 1 and 300),
  details            text not null default '' check (char_length(details) <= 8000),
  task_id            uuid references public.tasks (id) on delete cascade,
  submission_id      uuid references public.submissions (id) on delete cascade,
  requested_by_agent uuid references public.agents (id) on delete set null,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by         uuid references public.profiles (id) on delete set null,
  decided_by_agent   uuid references public.agents (id) on delete set null,
  decision_note      text check (char_length(decision_note) <= 4000),
  created_at         timestamptz not null default now(),
  decided_at         timestamptz
);
alter table public.approvals enable row level security;
create index approvals_mission_idx on public.approvals (mission_id, status);
create index approvals_task_idx on public.approvals (task_id);
create index approvals_submission_idx on public.approvals (submission_id);
create index approvals_requested_by_idx on public.approvals (requested_by_agent);
create index approvals_decided_by_idx on public.approvals (decided_by);
create index approvals_decided_by_agent_idx on public.approvals (decided_by_agent);

-- -----------------------------------------------------------------------------
-- Ledgers, inboxes and the public activity stream
-- -----------------------------------------------------------------------------

create table public.reputation_events (
  id            bigint generated always as identity primary key,
  agent_id      uuid not null references public.agents (id) on delete cascade,
  kind          text not null,
  delta         numeric not null,
  capabilities  text[] not null default '{}',
  mission_id    uuid references public.missions (id) on delete set null,
  task_id       uuid references public.tasks (id) on delete set null,
  submission_id uuid references public.submissions (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
alter table public.reputation_events enable row level security;
create index reputation_events_agent_idx on public.reputation_events (agent_id, created_at desc);
create index reputation_events_mission_idx on public.reputation_events (mission_id);
create index reputation_events_task_idx on public.reputation_events (task_id);
create index reputation_events_submission_idx on public.reputation_events (submission_id);

create table public.usage_events (
  id            bigint generated always as identity primary key,
  agent_id      uuid not null references public.agents (id) on delete cascade,
  mission_id    uuid references public.missions (id) on delete set null,
  task_id       uuid references public.tasks (id) on delete set null,
  model         text check (char_length(model) <= 80),
  input_tokens  int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cached        boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table public.usage_events enable row level security;
create index usage_events_agent_idx on public.usage_events (agent_id, created_at desc);
create index usage_events_mission_idx on public.usage_events (mission_id);
create index usage_events_task_idx on public.usage_events (task_id);

create table public.notifications (
  id         bigint generated always as identity primary key,
  agent_id   uuid references public.agents (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  check ((agent_id is null) <> (user_id is null))
);
alter table public.notifications enable row level security;
create index notifications_agent_idx on public.notifications (agent_id, created_at desc);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.activity (
  id         bigint generated always as identity primary key,
  kind       text not null,
  summary    text not null,
  agent_id   uuid references public.agents (id) on delete set null,
  user_id    uuid references public.profiles (id) on delete set null,
  mission_id uuid references public.missions (id) on delete cascade,
  task_id    uuid references public.tasks (id) on delete set null,
  is_public  boolean not null default true,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.activity enable row level security;
create index activity_created_idx on public.activity (created_at desc);
create index activity_mission_idx on public.activity (mission_id, created_at desc);
create index activity_agent_idx on public.activity (agent_id, created_at desc);
create index activity_user_idx on public.activity (user_id);
create index activity_task_idx on public.activity (task_id);

-- Operational tables (service role only).
create table public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;

create table public.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limits enable row level security;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger agents_touch before update on public.agents for each row execute function public.touch_updated_at();
create trigger missions_touch before update on public.missions for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

-- New auth user -> profile with a unique username.
create function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1), ''),
    '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(base) < 3 then
    base := base || 'human';
  end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;
  insert into public.profiles (id, username, display_name)
  values (new.id, candidate,
          left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', candidate), 80));
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Functions in this migration are internal: client roles cannot call them.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
