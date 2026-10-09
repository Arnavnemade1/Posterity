-- =============================================================================
-- Posterity · Phase 3 · tuning from live calibration of gte-small
--
-- Measured on the live corpus: unrelated text scores 0.69-0.80 cosine similarity,
-- related text 0.81-0.91, paraphrased questions 0.93-0.99, and different questions
-- about neighbouring subjects up to 0.90. So:
--   * semantic memory hits need 0.82;
--   * strict full-text matches (every query term) stand alone, loose matches (any
--     term) only boost results the semantic side found;
--   * cache hits need 0.92 (agents may not go below 0.90), and never serve an
--     answer about a different specific thing (versions, model names, numbers);
--   * a claimed embedding batch is leased for two minutes so overlapping workers
--     don't embed the same rows twice.
-- =============================================================================

update public.app_config set value = '0.82' where key = 'memory_min_similarity';
update public.app_config set value = '0.92' where key = 'cache_threshold';

alter table public.knowledge add column embed_claimed_at timestamptz;

create or replace function public.claim_embedding_batch(p_limit int default 16)
returns table (id uuid, content text)
language sql security definer
set search_path = ''
as $$
  update public.knowledge k
     set embed_attempts = k.embed_attempts + 1,
         embed_claimed_at = now()
   where k.id in (
     select q.id from public.knowledge q
      where q.embedding is null and q.embed_attempts < 5
        and (q.embed_claimed_at is null or q.embed_claimed_at < now() - interval '2 minutes')
      order by q.created_at
      limit least(greatest(coalesce(p_limit, 16), 1), 64)
      for update skip locked
   )
  returning k.id, k.title || E'\n\n' || public.tags_to_text(k.tags) || E'\n\n' || left(k.body, 1800)
$$;

-- Tokens that pin a question to one specific thing: anything with a digit or a hyphen
-- (versions, model names, years, quantities).
create function public.specific_terms(p_text text)
returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct m[1]), '{}')
    from regexp_matches(lower(coalesce(p_text, '')), '([a-z0-9]*[0-9][a-z0-9._-]*[a-z0-9]|[a-z0-9]+(?:-[a-z0-9]+)+)', 'g') as m
$$;

-- Two questions are about different things when each names a specific term the other lacks.
create function public.terms_conflict(p_a text, p_b text)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select exists (select 1 from unnest(public.specific_terms(p_a)) t where t <> all (public.specific_terms(p_b)))
     and exists (select 1 from unnest(public.specific_terms(p_b)) t where t <> all (public.specific_terms(p_a)))
$$;

create or replace function public.cache_lookup(
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
  v_best numeric;
  cand record;
  c public.reasoning_cache;
  v_mission uuid;
  v_saved int := 0;
  v_self boolean;
begin
  v_threshold := least(greatest(coalesce(p_threshold,
    (select cfg.value::numeric from public.app_config cfg where cfg.key = 'cache_threshold'), 0.92), 0.9), 1.0);

  select rc.id, 1.0 into v_id, v_sim
    from public.reasoning_cache rc
    join public.agent_stats st on st.agent_id = rc.agent_id
   where rc.question_hash = public.cache_question_hash(p_question)
     and rc.expires_at > now() and rc.flags < 2 and st.trust >= 0.35
   order by (rc.agent_id = p_agent), st.trust desc
   limit 1;

  if v_id is null and p_embedding is not null then
    for cand in
      select rc.id, rc.question, 1 - (rc.embedding operator(extensions.<=>) p_embedding) as sim
        from public.reasoning_cache rc
        join public.agent_stats st on st.agent_id = rc.agent_id
       where rc.expires_at > now() and rc.flags < 2 and st.trust >= 0.35
       order by rc.embedding operator(extensions.<=>) p_embedding
       limit 5
    loop
      v_best := coalesce(v_best, cand.sim);
      exit when cand.sim < v_threshold;
      if not public.terms_conflict(p_question, cand.question) then
        v_id := cand.id;
        v_sim := cand.sim;
        exit;
      end if;
    end loop;
  end if;

  if v_id is null then
    return jsonb_build_object('hit', false, 'best_similarity', round(coalesce(v_best, 0)::numeric, 4), 'threshold', v_threshold);
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

create or replace function public.search_knowledge(
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
    select public.memory_query(p_query) as loose,
           plainto_tsquery('english', left(coalesce(p_query, ''), 1000)) as strict,
           coalesce(p_min_similarity, (select c.value::numeric from public.app_config c where c.key = 'memory_min_similarity'), 0.82) as min_sim,
           least(greatest(coalesce(p_limit, 10), 1), 50) as lim
  ),
  strict_hits as (
    select k.id, row_number() over (order by ts_rank_cd(k.search, p.strict, 32) desc) as r
      from public.knowledge k, params p
     where numnode(p.strict) > 0 and k.search @@ p.strict and k.is_public
       and (p_kind is null or k.kind = p_kind)
       and (p_mission is null or k.mission_id = p_mission)
       and (p_capability is null or k.capabilities @> array[p_capability] or k.tags @> array[p_capability])
       and (p_exclude_task is null or k.task_id is distinct from p_exclude_task)
     order by ts_rank_cd(k.search, p.strict, 32) desc
     limit 60
  ),
  loose_hits as (
    select k.id, row_number() over (order by ts_rank_cd(k.search, p.loose, 32) desc) as r
      from public.knowledge k, params p
     where p.loose is not null and k.search @@ p.loose and k.is_public
       and (p_kind is null or k.kind = p_kind)
       and (p_mission is null or k.mission_id = p_mission)
       and (p_capability is null or k.capabilities @> array[p_capability] or k.tags @> array[p_capability])
       and (p_exclude_task is null or k.task_id is distinct from p_exclude_task)
     order by ts_rank_cd(k.search, p.loose, 32) desc
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
  sem_ok as (
    select sh.* from sem_hits sh, params p where sh.sim >= p.min_sim
  ),
  fused as (
    select ids.id,
           coalesce(1.0 / (50 + st.r), 0) + coalesce(1.0 / (50 + se.r), 0) + coalesce(0.5 / (50 + lo.r), 0) as rrf,
           se.sim,
           case when se.id is not null and (st.id is not null or lo.id is not null) then 'both'
                when se.id is not null then 'semantic'
                else 'text' end as matched
      from (select h.id from strict_hits h union select o.id from sem_ok o) ids
      left join strict_hits st on st.id = ids.id
      left join sem_ok se on se.id = ids.id
      left join loose_hits lo on lo.id = ids.id
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

-- How many of a text's lexemes an entry shares: a cheap relevance floor for full-text-only contexts.
create function public.memory_overlap(p_search tsvector, p_text text)
returns int
language sql stable parallel safe
set search_path = ''
as $$
  select count(*)::int
    from (select distinct l from unnest(tsvector_to_array(to_tsvector('english', left(coalesce(p_text, ''), 4000)))) l) q
   where q.l = any (tsvector_to_array(p_search))
$$;

-- The planning brief lists only entries that share at least three terms with the objective.
create or replace function public.planning_memory_brief()
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
    select string_agg(format('- `%s` · %s: %s', r.id, replace(r.kind, '_', ' '), r.title), E'\n' order by r.overlap desc, r.rank desc)
      into v_related
      from (
        select c.*
          from (
            select kn.id, kn.kind, kn.title, ts_rank_cd(kn.search, v_query, 32) as rank,
                   public.memory_overlap(kn.search, m.title || ' ' || m.objective) as overlap
              from public.knowledge kn
             where kn.is_public and kn.status <> 'disputed' and kn.search @@ v_query
             order by rank desc
             limit 25
          ) c
         where c.overlap >= 3
         order by c.overlap desc, c.rank desc
         limit 5
      ) r;
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

revoke execute on function public.specific_terms(text), public.terms_conflict(text, text), public.memory_overlap(tsvector, text)
  from public, anon, authenticated;
grant execute on function public.specific_terms(text), public.terms_conflict(text, text), public.memory_overlap(tsvector, text)
  to service_role;
