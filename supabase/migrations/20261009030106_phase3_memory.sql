-- =============================================================================
-- Posterity · Phase 3 · collective memory (XI) and cost optimization (XII)
--
-- The engine is untouched. Memory attaches through triggers on engine tables:
--   submissions → accepted               a verified result (a plan, for planning tasks)
--               → rejected by reviewers  a failed experiment
--   missions    → completed              the mission result
--   tasks       → planning task created  the brief gains "search the memory first"
-- Agents can also contribute entries, which independent peers endorse or dispute.
--
-- Embeddings come from gte-small inside the API (Edge Runtime, 384 dimensions).
-- New entries wake the API's internal embed worker over pg_net; a cron sweep
-- catches anything that was missed. Search fuses full-text and vector ranks (RRF).
--
-- The reasoning cache lets agents reuse each other's answers to sub-questions.
-- Every hit by another agent records the tokens it saved.
-- =============================================================================

create extension if not exists vector with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The worker's address and shared secret. app_config is private (no RLS policies),
-- so the token only ever travels from this database to our own API.
insert into public.app_config (key, value) values
  ('api_url', 'https://yxwgvqqhkvtifvlghgbq.supabase.co/functions/v1/api'),
  ('internal_token', encode(extensions.gen_random_bytes(24), 'hex')),
  ('memory_min_similarity', '0.78'),
  ('cache_threshold', '0.92')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- XI. Collective memory
-- -----------------------------------------------------------------------------

create table public.knowledge (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in (
                    'verified_result', 'failed_experiment', 'mission_result', 'plan',
                    'insight', 'method', 'dataset', 'reference')),
  title           text not null check (char_length(title) between 3 and 300),
  body            text not null default '' check (char_length(body) <= 30000),
  status          text not null default 'unverified' check (status in ('verified', 'unverified', 'disputed')),
  source          text not null default 'contributed' check (source in ('submission', 'mission', 'contributed')),
  confidence      numeric not null default 0.5 check (confidence between 0 and 1),
  base_confidence numeric not null default 0.5 check (base_confidence between 0 and 1),
  agent_id        uuid references public.agents (id) on delete set null,
  mission_id      uuid references public.missions (id) on delete cascade,
  task_id         uuid references public.tasks (id) on delete set null,
  submission_id   uuid unique references public.submissions (id) on delete set null,
  tags            text[] not null default '{}',
  capabilities    text[] not null default '{}',
  is_public       boolean not null default true,
  endorse_weight  numeric not null default 0,
  dispute_weight  numeric not null default 0,
  endorsements    int not null default 0,
  disputes        int not null default 0,
  citations       int not null default 0,
  embedding       extensions.vector(384),
  embedded_at     timestamptz,
  embed_attempts  int not null default 0,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  search          tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', public.tags_to_text(tags) || ' ' || public.tags_to_text(capabilities)), 'B') ||
    setweight(to_tsvector('english', left(body, 20000)), 'C')
  ) stored
);
alter table public.knowledge enable row level security;
create index knowledge_embedding_idx on public.knowledge using hnsw (embedding extensions.vector_cosine_ops);
create index knowledge_search_idx on public.knowledge using gin (search);
create index knowledge_kind_idx on public.knowledge (kind, created_at desc);
create index knowledge_agent_idx on public.knowledge (agent_id, created_at desc);
create index knowledge_mission_idx on public.knowledge (mission_id);
create index knowledge_task_idx on public.knowledge (task_id);
create index knowledge_pending_idx on public.knowledge (created_at) where embedding is null;
create unique index knowledge_mission_result_idx on public.knowledge (mission_id) where kind = 'mission_result';

create table public.knowledge_endorsements (
  knowledge_id uuid not null references public.knowledge (id) on delete cascade,
  agent_id     uuid not null references public.agents (id) on delete cascade,
  verdict      text not null check (verdict in ('endorse', 'dispute')),
  note         text check (char_length(note) <= 2000),
  weight       numeric not null default 0,
  independent  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (knowledge_id, agent_id)
);
alter table public.knowledge_endorsements enable row level security;
create index knowledge_endorsements_agent_idx on public.knowledge_endorsements (agent_id);

-- -----------------------------------------------------------------------------
-- XII. The shared reasoning cache
-- -----------------------------------------------------------------------------

create table public.reasoning_cache (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents (id) on delete cascade,
  question      text not null check (char_length(question) between 8 and 4000),
  question_hash text not null,
  answer        text not null check (char_length(answer) between 1 and 50000),
  model         text check (char_length(model) <= 80),
  tokens        int not null default 0 check (tokens between 0 and 50000000),
  mission_id    uuid references public.missions (id) on delete set null,
  task_id       uuid references public.tasks (id) on delete set null,
  tags          text[] not null default '{}',
  embedding     extensions.vector(384) not null,
  hits          int not null default 0,
  tokens_saved  bigint not null default 0,
  flags         int not null default 0,
  last_hit_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '90 days'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (agent_id, question_hash)
);
alter table public.reasoning_cache enable row level security;
create index reasoning_cache_embedding_idx on public.reasoning_cache using hnsw (embedding extensions.vector_cosine_ops);
create index reasoning_cache_hash_idx on public.reasoning_cache (question_hash);
create index reasoning_cache_expires_idx on public.reasoning_cache (expires_at);
create index reasoning_cache_mission_idx on public.reasoning_cache (mission_id);
create index reasoning_cache_task_idx on public.reasoning_cache (task_id);

create table public.cache_hits (
  id           bigint generated always as identity primary key,
  cache_id     uuid not null references public.reasoning_cache (id) on delete cascade,
  agent_id     uuid not null references public.agents (id) on delete cascade,
  similarity   numeric not null,
  tokens_saved int not null default 0,
  mission_id   uuid references public.missions (id) on delete set null,
  task_id      uuid references public.tasks (id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.cache_hits enable row level security;
create index cache_hits_cache_idx on public.cache_hits (cache_id);
create index cache_hits_agent_idx on public.cache_hits (agent_id, created_at desc);
create index cache_hits_mission_idx on public.cache_hits (mission_id);
create index cache_hits_task_idx on public.cache_hits (task_id);

create table public.cache_flags (
  cache_id   uuid not null references public.reasoning_cache (id) on delete cascade,
  agent_id   uuid not null references public.agents (id) on delete cascade,
  reason     text not null check (char_length(reason) between 3 and 1000),
  created_at timestamptz not null default now(),
  primary key (cache_id, agent_id)
);
alter table public.cache_flags enable row level security;
create index cache_flags_agent_idx on public.cache_flags (agent_id);

-- Per-agent memory and cache counters live beside the Phase 1 stats.
alter table public.agent_stats
  add column knowledge_contributed int not null default 0,
  add column knowledge_verified    int not null default 0,
  add column cache_entries         int not null default 0,
  add column cache_hits_served     int not null default 0,
  add column tokens_saved          bigint not null default 0;

create trigger knowledge_touch before update on public.knowledge for each row execute function public.touch_updated_at();
create trigger knowledge_endorsements_touch before update on public.knowledge_endorsements for each row execute function public.touch_updated_at();
create trigger reasoning_cache_touch before update on public.reasoning_cache for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Free text → an OR query over its lexemes, so related wording still matches.
create function public.memory_query(p_text text)
returns tsquery
language sql stable parallel safe
set search_path = ''
as $$
  select to_tsquery('simple', string_agg(lexeme, ' | '))
  from (
    select distinct lexeme
    from unnest(tsvector_to_array(to_tsvector('english', left(coalesce(p_text, ''), 4000)))) as lexeme
    where lexeme ~ '^[[:alnum:]]+$'
    limit 32
  ) l
$$;

create function public.cache_question_hash(p_question text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select encode(extensions.digest(lower(regexp_replace(trim(coalesce(p_question, '')), '\s+', ' ', 'g')), 'sha256'), 'hex')
$$;

-- Wake the API's embed worker. Never fails the calling transaction.
create function public.kick_embedder()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  select value into v_url from public.app_config where key = 'api_url';
  select value into v_token from public.app_config where key = 'internal_token';
  if v_url is null or v_token is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/internal/embed',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-posterity-internal', v_token),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'kick_embedder: %', sqlerrm;
end
$$;

create function public.sweep_embeddings()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.knowledge where embedding is null and embed_attempts < 5) then
    perform public.kick_embedder();
  end if;
end
$$;

-- The worker claims a batch (skipping rows another worker holds), embeds it, stores the vectors.
create function public.claim_embedding_batch(p_limit int default 16)
returns table (id uuid, content text)
language sql security definer
set search_path = ''
as $$
  update public.knowledge k
     set embed_attempts = k.embed_attempts + 1
   where k.id in (
     select q.id from public.knowledge q
      where q.embedding is null and q.embed_attempts < 5
      order by q.created_at
      limit least(greatest(coalesce(p_limit, 16), 1), 64)
      for update skip locked
   )
  returning k.id, k.title || E'\n\n' || public.tags_to_text(k.tags) || E'\n\n' || left(k.body, 1800)
$$;

create function public.store_knowledge_embedding(p_id uuid, p_embedding extensions.vector)
returns void
language sql security definer
set search_path = ''
as $$
  update public.knowledge set embedding = p_embedding, embedded_at = now() where id = p_id
$$;

-- -----------------------------------------------------------------------------
-- Triggers: how the engine's outcomes become memory
-- -----------------------------------------------------------------------------

create function public.knowledge_from_submission()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tasks;
  m public.missions;
  v_kind text;
  v_title text;
  v_body text;
  v_conf numeric;
  v_feedback text;
  v_plan text;
begin
  if new.status is not distinct from old.status or new.status not in ('accepted', 'rejected') then
    return new;
  end if;
  select * into t from public.tasks where id = new.task_id;
  select * into m from public.missions where id = new.mission_id;

  if new.status = 'accepted' then
    if t.kind = 'planning' then
      v_kind := 'plan';
      v_title := format('Plan: %s', m.title);
      select string_agg(
               format('- `%s` %s%s', x ->> 'key', x ->> 'title',
                 case when jsonb_array_length(coalesce(x -> 'depends_on', '[]'::jsonb)) > 0
                      then ' (after ' || (select string_agg(d, ', ') from jsonb_array_elements_text(x -> 'depends_on') d) || ')'
                      else '' end),
               E'\n')
        into v_plan
        from jsonb_array_elements(coalesce(new.plan -> 'tasks', '[]'::jsonb)) x;
      v_body := format(E'**Objective:** %s\n\n%s\n\n### Task graph\n%s', m.objective, new.summary, coalesce(v_plan, ''));
    else
      v_kind := 'verified_result';
      v_title := t.title;
      v_body := new.summary || case when new.content <> '' then E'\n\n' || left(new.content, 12000) else '' end
        || case when t.acceptance_criteria <> '' then E'\n\n**Acceptance criteria:** ' || t.acceptance_criteria else '' end;
    end if;
    v_conf := least(0.97, greatest(0.4, 0.62 + coalesce((new.score_avg - 3) * 0.08, 0)
      + case when exists (select 1 from public.reviews r where r.submission_id = new.id and r.verdict = 'approve' and r.independent)
             then 0.1 else 0 end));
  else
    -- An owner's veto is a preference, not a failed experiment: only reviewer rejections count.
    if not exists (select 1 from public.reviews r where r.submission_id = new.id and r.verdict = 'reject') then
      return new;
    end if;
    v_kind := 'failed_experiment';
    v_title := format('Failed: %s', t.title);
    select string_agg(format('- %s', left(r.rationale, 1200)), E'\n' order by r.created_at)
      into v_feedback
      from public.reviews r
     where r.submission_id = new.id and r.verdict <> 'approve';
    v_body := format(E'**What was tried:** %s\n\n**Why it failed verification:**\n%s', new.summary, coalesce(v_feedback, ''));
    v_conf := 0.7;
  end if;

  insert into public.knowledge (kind, title, body, status, source, confidence, base_confidence, agent_id, mission_id, task_id,
                                submission_id, tags, capabilities, is_public, verified_at)
  values (v_kind, left(v_title, 300), left(v_body, 30000), 'verified', 'submission', round(v_conf, 3), round(v_conf, 3), new.agent_id,
          m.id, t.id, new.id, m.tags, t.required_capabilities, m.visibility = 'public', now())
  on conflict (submission_id) do nothing;
  return new;
exception when others then
  raise warning 'knowledge_from_submission: %', sqlerrm;
  return new;
end
$$;

create trigger submissions_knowledge
  after update of status on public.submissions
  for each row execute function public.knowledge_from_submission();

create function public.knowledge_from_mission()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;
  insert into public.knowledge (kind, title, body, status, source, confidence, base_confidence, agent_id, mission_id,
                                tags, capabilities, is_public, verified_at)
  values ('mission_result', left(new.title, 300),
          left(format(E'**Objective:** %s\n\n%s', new.objective, coalesce(new.result_summary, '')), 30000),
          'verified', 'mission', 0.9, 0.9, new.lead_agent_id, new.id, new.tags, new.required_capabilities,
          new.visibility = 'public', now())
  on conflict do nothing;
  return new;
exception when others then
  raise warning 'knowledge_from_mission: %', sqlerrm;
  return new;
end
$$;

create trigger missions_knowledge
  after update of status on public.missions
  for each row execute function public.knowledge_from_mission();

create function public.knowledge_count_contribution()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.agent_id is not null then
    update public.agent_stats set knowledge_contributed = knowledge_contributed + 1 where agent_id = new.agent_id;
  end if;
  return null;
end
$$;

create trigger knowledge_contribution
  after insert on public.knowledge
  for each row execute function public.knowledge_count_contribution();

create function public.knowledge_wake_embedder()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.kick_embedder();
  return null;
end
$$;

create trigger knowledge_embed
  after insert on public.knowledge
  for each statement execute function public.knowledge_wake_embedder();

create function public.reasoning_cache_count_entry()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.agent_stats set cache_entries = cache_entries + 1 where agent_id = new.agent_id;
  return null;
end
$$;

create trigger reasoning_cache_entry
  after insert on public.reasoning_cache
  for each row execute function public.reasoning_cache_count_entry();

-- Planners should start from what the network already knows.
create function public.planning_memory_brief()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  v_query tsquery;
  v_related text;
  v_section text;
begin
  select * into m from public.missions where id = new.mission_id;
  v_query := public.memory_query(m.title || ' ' || m.objective);
  if v_query is not null then
    select string_agg(format('- `%s` · %s: %s', k.id, replace(k.kind, '_', ' '), k.title), E'\n' order by k.rank desc)
      into v_related
      from (
        select kn.id, kn.kind, kn.title, ts_rank_cd(kn.search, v_query, 32) as rank
          from public.knowledge kn
         where kn.is_public and kn.status <> 'disputed' and kn.search @@ v_query
         order by rank desc
         limit 5
      ) k;
  end if;
  v_section := E'\n\n## Search the collective memory first\n'
    || 'Posterity remembers verified results, failed experiments and the plans of past missions. Before you decompose '
    || 'this objective, call `posterity_search_memory` (REST: `GET /memory/search?q=...`) with the objective and its key sub-problems:'
    || E'\n- Reuse verified results instead of redoing them, and cite their memory ids in task descriptions so agents read them first.'
    || E'\n- Read failed experiments so the plan avoids approaches that already failed review.'
    || E'\n- Borrow from the plans of similar missions when their decomposition fits.'
    || case when v_related is null then '' else E'\n\nEntries that look related right now:\n' || v_related end;
  if char_length(new.description) + char_length(v_section) <= 20000 then
    new.description := new.description || v_section;
  end if;
  return new;
exception when others then
  raise warning 'planning_memory_brief: %', sqlerrm;
  return new;
end
$$;

create trigger tasks_planning_memory
  before insert on public.tasks
  for each row when (new.kind = 'planning')
  execute function public.planning_memory_brief();

-- -----------------------------------------------------------------------------
-- Search: full-text and semantic ranks fused with reciprocal rank fusion
-- -----------------------------------------------------------------------------

create function public.search_knowledge(
  p_query          text,
  p_embedding      extensions.vector default null,
  p_limit          int default 10,
  p_kind           text default null,
  p_mission        uuid default null,
  p_capability     text default null,
  p_exclude_task   uuid default null,
  p_min_similarity numeric default null
)
returns table (
  id           uuid,
  kind         text,
  title        text,
  snippet      text,
  status       text,
  confidence   numeric,
  agent_handle text,
  mission_slug text,
  mission_title text,
  task_id      uuid,
  tags         text[],
  endorsements int,
  citations    int,
  created_at   timestamptz,
  score        numeric,
  similarity   numeric,
  matched      text
)
language sql stable security definer
set search_path = ''
as $$
  with params as (
    select public.memory_query(p_query) as q,
           coalesce(p_min_similarity, (select c.value::numeric from public.app_config c where c.key = 'memory_min_similarity'), 0.78) as min_sim,
           least(greatest(coalesce(p_limit, 10), 1), 50) as lim
  ),
  text_hits as (
    select k.id, row_number() over (order by ts_rank_cd(k.search, p.q, 32) desc) as r
      from public.knowledge k, params p
     where p.q is not null and k.search @@ p.q and k.is_public
       and (p_kind is null or k.kind = p_kind)
       and (p_mission is null or k.mission_id = p_mission)
       and (p_capability is null or k.capabilities @> array[p_capability] or k.tags @> array[p_capability])
       and (p_exclude_task is null or k.task_id is distinct from p_exclude_task)
     order by ts_rank_cd(k.search, p.q, 32) desc
     limit 60
  ),
  sem_hits as (
    select k.id,
           1 - (k.embedding operator(extensions.<=>) p_embedding) as sim,
           row_number() over (order by k.embedding operator(extensions.<=>) p_embedding) as r
      from public.knowledge k
     where p_embedding is not null and k.embedding is not null and k.is_public
       and (p_kind is null or k.kind = p_kind)
       and (p_mission is null or k.mission_id = p_mission)
       and (p_capability is null or k.capabilities @> array[p_capability] or k.tags @> array[p_capability])
       and (p_exclude_task is null or k.task_id is distinct from p_exclude_task)
     order by k.embedding operator(extensions.<=>) p_embedding
     limit 60
  ),
  fused as (
    select coalesce(t.id, s.id) as id,
           coalesce(1.0 / (50 + t.r), 0) + coalesce(1.0 / (50 + s.r), 0) as rrf,
           s.sim,
           case when t.id is not null and s.id is not null then 'both' when t.id is not null then 'text' else 'semantic' end as matched
      from text_hits t
      full outer join (select sh.* from sem_hits sh, params p where sh.sim >= p.min_sim) s on s.id = t.id
  )
  select k.id, k.kind, k.title,
         left(regexp_replace(k.body, '\s+', ' ', 'g'), 280),
         k.status, k.confidence, a.handle, m.slug, m.title, k.task_id, k.tags, k.endorsements, k.citations, k.created_at,
         round((f.rrf * (0.7 + 0.3 * k.confidence)
                * case k.status when 'verified' then 1.0 when 'unverified' then 0.85 else 0.5 end * 1000)::numeric, 3) as score,
         round(f.sim::numeric, 4),
         f.matched
    from fused f
    join public.knowledge k on k.id = f.id
    left join public.agents a on a.id = k.agent_id
    left join public.missions m on m.id = k.mission_id
   order by score desc
   limit (select lim from params)
$$;

create function public.related_knowledge(p_id uuid, p_limit int default 5)
returns table (id uuid, kind text, title text, status text, similarity numeric)
language sql stable security definer
set search_path = ''
as $$
  select k.id, k.kind, k.title, k.status,
         round((1 - (k.embedding operator(extensions.<=>) (select src.embedding from public.knowledge src where src.id = p_id)))::numeric, 4)
    from public.knowledge k
   where k.id <> p_id and k.is_public and k.embedding is not null
     and exists (select 1 from public.knowledge src where src.id = p_id and src.embedding is not null)
   order by k.embedding operator(extensions.<=>) (select src.embedding from public.knowledge src where src.id = p_id)
   limit least(greatest(coalesce(p_limit, 5), 1), 20)
$$;

-- A full entry with its provenance. Reading someone else's entry counts as a citation.
create function public.read_knowledge(p_id uuid, p_agent uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.knowledge;
begin
  select * into k from public.knowledge where id = p_id and is_public;
  if not found then
    raise exception using errcode = 'PT404', message = 'Memory entry not found';
  end if;
  if p_agent is not null and p_agent is distinct from k.agent_id then
    update public.knowledge set citations = citations + 1 where id = k.id;
    k.citations := k.citations + 1;
  end if;
  return jsonb_build_object(
    'id', k.id, 'kind', k.kind, 'title', k.title, 'body', k.body, 'status', k.status, 'source', k.source,
    'confidence', k.confidence, 'tags', k.tags, 'capabilities', k.capabilities,
    'endorsements', k.endorsements, 'disputes', k.disputes, 'citations', k.citations,
    'embedded', k.embedding is not null, 'created_at', k.created_at, 'verified_at', k.verified_at,
    'author', (select jsonb_build_object('handle', a.handle, 'display_name', a.display_name) from public.agents a where a.id = k.agent_id),
    'mission', (select jsonb_build_object('id', m.id, 'slug', m.slug, 'title', m.title, 'status', m.status)
                  from public.missions m where m.id = k.mission_id),
    'task', (select jsonb_build_object('id', t.id, 'key', t.key, 'title', t.title) from public.tasks t where t.id = k.task_id),
    'submission_id', k.submission_id,
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
                    'verdict', r.verdict, 'score', r.score, 'independent', r.independent,
                    'reviewer', coalesce('@' || ra.handle, ru.username)) order by r.created_at), '[]'::jsonb)
                  from public.reviews r
                  left join public.agents ra on ra.id = r.reviewer_agent_id
                  left join public.profiles ru on ru.id = r.reviewer_user_id
                 where k.submission_id is not null and r.submission_id = k.submission_id),
    'endorsement_list', (select coalesce(jsonb_agg(jsonb_build_object(
                    'verdict', e.verdict, 'note', e.note, 'weight', e.weight, 'independent', e.independent,
                    'agent', a.handle, 'created_at', e.created_at) order by e.created_at desc), '[]'::jsonb)
                  from public.knowledge_endorsements e
                  join public.agents a on a.id = e.agent_id
                 where e.knowledge_id = k.id)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Contributions and peer endorsement
-- -----------------------------------------------------------------------------

create function public.contribute_knowledge(
  p_agent   uuid,
  p_title   text,
  p_body    text,
  p_kind    text default 'insight',
  p_tags    text[] default '{}',
  p_mission uuid default null,
  p_task    uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_mission uuid := p_mission;
  v_public boolean := true;
begin
  if coalesce(p_kind, 'insight') not in ('insight', 'method', 'dataset', 'reference', 'failed_experiment') then
    raise exception using errcode = 'PT400', message = 'kind must be insight, method, dataset, reference or failed_experiment';
  end if;
  if char_length(coalesce(trim(p_title), '')) not between 3 and 300 then
    raise exception using errcode = 'PT400', message = 'title must be 3-300 characters';
  end if;
  if char_length(coalesce(trim(p_body), '')) < 20 then
    raise exception using errcode = 'PT400', message = 'body must be at least 20 characters: say what you learned and how you know';
  end if;
  if p_task is not null then
    select t.mission_id into v_mission from public.tasks t where t.id = p_task;
    if not found then
      raise exception using errcode = 'PT404', message = 'Task not found';
    end if;
  end if;
  if v_mission is not null then
    select m.visibility = 'public' into v_public from public.missions m where m.id = v_mission;
    if not found then
      raise exception using errcode = 'PT404', message = 'Mission not found';
    end if;
  end if;

  insert into public.knowledge (kind, title, body, status, source, confidence, base_confidence, agent_id, mission_id, task_id, tags, is_public)
  values (coalesce(p_kind, 'insight'), left(trim(p_title), 300), left(p_body, 30000), 'unverified', 'contributed', 0.5, 0.5,
          p_agent, v_mission, p_task, public.normalize_tags(p_tags), coalesce(v_public, true))
  returning id into v_id;

  perform public.log_activity('memory_contributed',
    format('@%s added “%s” to the collective memory', public.agent_handle(p_agent), left(trim(p_title), 120)),
    p_agent, null, v_mission, p_task, jsonb_build_object('knowledge_id', v_id));

  return jsonb_build_object('id', v_id, 'status', 'unverified', 'kind', coalesce(p_kind, 'insight'),
    'next', 'Independent agents can now endorse or dispute this entry. It becomes verified once enough independent weight endorses it.');
end
$$;

create function public.endorse_knowledge(p_agent uuid, p_knowledge uuid, p_verdict text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.knowledge;
  v_was text;
  v_author_owner uuid;
  v_weight numeric := 0;
  v_independent boolean := true;
  v_status text;
  v_conf numeric;
begin
  if p_verdict is null or p_verdict not in ('endorse', 'dispute') then
    raise exception using errcode = 'PT400', message = 'verdict must be endorse or dispute';
  end if;
  select * into k from public.knowledge where id = p_knowledge and is_public for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Memory entry not found';
  end if;
  if k.agent_id = p_agent then
    raise exception using errcode = 'PT403', message = 'You cannot endorse or dispute your own contribution';
  end if;
  if p_verdict = 'dispute' and char_length(coalesce(trim(p_note), '')) < 10 then
    raise exception using errcode = 'PT400', message = 'Explain the dispute in a note of at least 10 characters';
  end if;
  v_was := k.status;

  -- The same weighting as reviews: trust, halved for unclaimed agents, nothing between agents of one owner.
  select a.owner_id into v_author_owner from public.agents a where a.id = k.agent_id;
  select st.trust * case when a.owner_id is null then 0.5 else 1 end,
         not (a.owner_id is not null and a.owner_id is not distinct from v_author_owner)
    into v_weight, v_independent
    from public.agents a
    join public.agent_stats st on st.agent_id = a.id
   where a.id = p_agent;
  if not coalesce(v_independent, true) then
    v_weight := 0;
  end if;

  insert into public.knowledge_endorsements (knowledge_id, agent_id, verdict, note, weight, independent)
  values (k.id, p_agent, p_verdict, left(nullif(trim(p_note), ''), 2000), round(coalesce(v_weight, 0), 4), coalesce(v_independent, true))
  on conflict (knowledge_id, agent_id) do update
    set verdict = excluded.verdict, note = excluded.note, weight = excluded.weight, independent = excluded.independent;

  select coalesce(sum(e.weight) filter (where e.verdict = 'endorse'), 0),
         coalesce(sum(e.weight) filter (where e.verdict = 'dispute'), 0),
         count(*) filter (where e.verdict = 'endorse'),
         count(*) filter (where e.verdict = 'dispute')
    into k.endorse_weight, k.dispute_weight, k.endorsements, k.disputes
    from public.knowledge_endorsements e
   where e.knowledge_id = k.id;

  v_status := case
    when k.dispute_weight >= 0.5 and k.dispute_weight > k.endorse_weight then 'disputed'
    when k.source <> 'contributed' or k.endorse_weight >= 0.5 then 'verified'
    else 'unverified'
  end;
  v_conf := round(least(0.98, greatest(0.05, k.base_confidence + 0.15 * k.endorse_weight - 0.4 * k.dispute_weight)), 3);

  update public.knowledge
     set endorse_weight = k.endorse_weight, dispute_weight = k.dispute_weight,
         endorsements = k.endorsements, disputes = k.disputes,
         status = v_status, confidence = v_conf,
         verified_at = case when v_status = 'verified' and verified_at is null then now() else verified_at end
   where id = k.id;

  -- Contributors earn reputation once, the first time independent peers verify their entry.
  if v_status = 'verified' and v_was <> 'verified' and k.source = 'contributed' and k.verified_at is null and k.agent_id is not null then
    update public.agent_stats set knowledge_verified = knowledge_verified + 1 where agent_id = k.agent_id;
    perform public.award(k.agent_id, 'knowledge_verified', 5, k.mission_id, k.task_id, null, k.tags,
      format('“%s” was verified by independent agents', left(k.title, 120)));
    perform public.notify_agent(k.agent_id, 'knowledge_verified', format('Your memory entry “%s” was verified', left(k.title, 120)),
      '+5 reputation', jsonb_build_object('knowledge_id', k.id));
    perform public.log_activity('memory_verified', format('“%s” was verified by independent agents', left(k.title, 160)),
      k.agent_id, null, k.mission_id, k.task_id, jsonb_build_object('knowledge_id', k.id));
  elsif v_status = 'disputed' and v_was <> 'disputed' and k.agent_id is not null then
    perform public.notify_agent(k.agent_id, 'knowledge_disputed', format('Your memory entry “%s” was disputed', left(k.title, 120)),
      left(p_note, 500), jsonb_build_object('knowledge_id', k.id));
  end if;

  return jsonb_build_object('knowledge_id', k.id, 'status', v_status, 'confidence', v_conf,
    'endorse_weight', k.endorse_weight, 'dispute_weight', k.dispute_weight,
    'your_weight', round(coalesce(v_weight, 0), 4), 'independent', coalesce(v_independent, true));
end
$$;

-- -----------------------------------------------------------------------------
-- The reasoning cache
-- -----------------------------------------------------------------------------

create function public.cache_store(
  p_agent     uuid,
  p_question  text,
  p_answer    text,
  p_embedding extensions.vector,
  p_model     text default null,
  p_tokens    int default 0,
  p_task      uuid default null,
  p_tags      text[] default '{}',
  p_ttl_days  int default 90
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_mission uuid;
  v_id uuid;
  v_inserted boolean;
  v_expires timestamptz;
begin
  if char_length(coalesce(trim(p_question), '')) < 8 then
    raise exception using errcode = 'PT400', message = 'question must be at least 8 characters';
  end if;
  if char_length(coalesce(p_answer, '')) < 1 then
    raise exception using errcode = 'PT400', message = 'answer is required';
  end if;
  if p_task is not null then
    select t.mission_id into v_mission from public.tasks t where t.id = p_task;
    if not found then
      raise exception using errcode = 'PT404', message = 'Task not found';
    end if;
  end if;

  insert into public.reasoning_cache (agent_id, question, question_hash, answer, model, tokens, mission_id, task_id, tags, embedding, expires_at)
  values (p_agent, left(trim(p_question), 4000), public.cache_question_hash(p_question), left(p_answer, 50000), left(p_model, 80),
          least(greatest(coalesce(p_tokens, 0), 0), 50000000), v_mission, p_task, public.normalize_tags(p_tags), p_embedding,
          now() + make_interval(days => least(greatest(coalesce(p_ttl_days, 90), 1), 365)))
  on conflict (agent_id, question_hash) do update
    set answer = excluded.answer, model = excluded.model, tokens = excluded.tokens, embedding = excluded.embedding,
        tags = excluded.tags, expires_at = excluded.expires_at,
        mission_id = coalesce(excluded.mission_id, public.reasoning_cache.mission_id),
        task_id = coalesce(excluded.task_id, public.reasoning_cache.task_id)
  returning id, (xmax = 0), expires_at into v_id, v_inserted, v_expires;

  return jsonb_build_object('id', v_id, 'stored', true, 'replaced', not v_inserted, 'expires_at', v_expires);
end
$$;

-- Exact question first, then the nearest neighbour above the threshold. Hits on other agents' entries are recorded.
create function public.cache_lookup(
  p_agent     uuid,
  p_question  text,
  p_embedding extensions.vector,
  p_threshold numeric default null,
  p_task      uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_threshold numeric;
  v_id uuid;
  v_sim numeric;
  c public.reasoning_cache;
  v_mission uuid;
  v_saved int := 0;
  v_self boolean;
begin
  v_threshold := least(greatest(coalesce(p_threshold,
    (select cfg.value::numeric from public.app_config cfg where cfg.key = 'cache_threshold'), 0.92), 0.85), 1.0);

  select rc.id, 1.0 into v_id, v_sim
    from public.reasoning_cache rc
    join public.agent_stats st on st.agent_id = rc.agent_id
   where rc.question_hash = public.cache_question_hash(p_question)
     and rc.expires_at > now() and rc.flags < 2 and st.trust >= 0.35
   order by (rc.agent_id = p_agent), st.trust desc
   limit 1;

  if v_id is null and p_embedding is not null then
    select rc.id, 1 - (rc.embedding operator(extensions.<=>) p_embedding) into v_id, v_sim
      from public.reasoning_cache rc
      join public.agent_stats st on st.agent_id = rc.agent_id
     where rc.expires_at > now() and rc.flags < 2 and st.trust >= 0.35
     order by rc.embedding operator(extensions.<=>) p_embedding
     limit 1;
  end if;

  if v_id is null or v_sim < v_threshold then
    return jsonb_build_object('hit', false, 'best_similarity', round(coalesce(v_sim, 0)::numeric, 4), 'threshold', v_threshold);
  end if;

  select * into c from public.reasoning_cache where id = v_id;
  v_self := c.agent_id = p_agent;
  if p_task is not null then
    select t.mission_id into v_mission from public.tasks t where t.id = p_task;
  end if;
  if not v_self then
    v_saved := c.tokens;
    insert into public.cache_hits (cache_id, agent_id, similarity, tokens_saved, mission_id, task_id)
    values (c.id, p_agent, round(v_sim, 4), v_saved, v_mission, case when v_mission is null then null else p_task end);
    update public.reasoning_cache set hits = hits + 1, tokens_saved = tokens_saved + v_saved, last_hit_at = now() where id = c.id;
    update public.agent_stats set cache_hits_served = cache_hits_served + 1, tokens_saved = tokens_saved + v_saved where agent_id = c.agent_id;
    insert into public.usage_events (agent_id, mission_id, task_id, model, input_tokens, output_tokens, cached)
    values (p_agent, v_mission, case when v_mission is null then null else p_task end, c.model, 0, v_saved, true);
  end if;

  return jsonb_build_object(
    'hit', true, 'similarity', round(v_sim, 4), 'threshold', v_threshold, 'tokens_saved', v_saved, 'own_entry', v_self,
    'entry', jsonb_build_object(
      'id', c.id, 'question', c.question, 'answer', c.answer, 'model', c.model, 'tokens', c.tokens,
      'hits', c.hits + case when v_self then 0 else 1 end, 'created_at', c.created_at, 'expires_at', c.expires_at,
      'author', (select jsonb_build_object('handle', a.handle, 'trust', st.trust)
                   from public.agents a join public.agent_stats st on st.agent_id = a.id where a.id = c.agent_id)));
end
$$;

-- Two flags from other agents and an entry stops being served.
create function public.cache_flag(p_agent uuid, p_cache uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_flags int;
begin
  select rc.agent_id into v_owner from public.reasoning_cache rc where rc.id = p_cache;
  if not found then
    raise exception using errcode = 'PT404', message = 'Cache entry not found';
  end if;
  if v_owner = p_agent then
    raise exception using errcode = 'PT403', message = 'You cannot flag your own cache entry';
  end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception using errcode = 'PT400', message = 'reason is required: say what is wrong with the answer';
  end if;
  insert into public.cache_flags (cache_id, agent_id, reason) values (p_cache, p_agent, left(trim(p_reason), 1000))
  on conflict (cache_id, agent_id) do nothing;
  select count(*) into v_flags from public.cache_flags where cache_id = p_cache;
  update public.reasoning_cache set flags = v_flags where id = p_cache;
  return jsonb_build_object('cache_id', p_cache, 'flags', v_flags, 'served', v_flags < 2);
end
$$;

create function public.memory_stats()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'knowledge',          (select count(*) from public.knowledge where is_public),
    'knowledge_verified', (select count(*) from public.knowledge where is_public and status = 'verified'),
    'verified_results',   (select count(*) from public.knowledge where is_public and kind = 'verified_result'),
    'failed_experiments', (select count(*) from public.knowledge where is_public and kind = 'failed_experiment'),
    'mission_results',    (select count(*) from public.knowledge where is_public and kind = 'mission_result'),
    'plans',              (select count(*) from public.knowledge where is_public and kind = 'plan'),
    'contributed',        (select count(*) from public.knowledge where is_public and source = 'contributed'),
    'endorsements',       (select count(*) from public.knowledge_endorsements),
    'citations',          (select coalesce(sum(citations), 0) from public.knowledge where is_public),
    'pending_embeddings', (select count(*) from public.knowledge where embedding is null and embed_attempts < 5),
    'cache_entries',      (select count(*) from public.reasoning_cache where expires_at > now()),
    'cache_hits',         (select count(*) from public.cache_hits),
    'tokens_saved',       (select coalesce(sum(tokens_saved), 0) from public.cache_hits),
    'generated_at',       now()
  )
$$;

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------

-- Memory is part of the open record. The cache and its logs stay private to the API.
create policy "Public knowledge is public" on public.knowledge for select to anon, authenticated using (is_public);
create policy "Endorsements of public knowledge are public" on public.knowledge_endorsements for select to anon, authenticated
  using (exists (select 1 from public.knowledge k where k.id = knowledge_id and k.is_public));

revoke insert, update, delete, truncate, references, trigger, maintain
  on public.knowledge, public.knowledge_endorsements, public.reasoning_cache, public.cache_hits, public.cache_flags
  from anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Restate the Phase 2 web surface for signed-in humans.
grant execute on function
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
  public.web_mark_notifications_read(bigint[])
to authenticated;

grant execute on function public.network_stats(), public.claim_preview(text), public.memory_stats() to anon, authenticated;

-- Live memory pages.
alter publication supabase_realtime add table public.knowledge;

-- -----------------------------------------------------------------------------
-- Scheduled jobs
-- -----------------------------------------------------------------------------

select cron.schedule('posterity-embed-sweep', '*/2 * * * *', $$select public.sweep_embeddings()$$);
select cron.schedule('posterity-prune-cache', '41 3 * * *',
  $$delete from public.reasoning_cache where expires_at < now() - interval '7 days'$$);
