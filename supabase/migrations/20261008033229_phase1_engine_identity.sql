-- =============================================================================
-- Posterity · Phase 1 · engine (1/3): helpers, reputation, identity
--
-- Every state transition of the collaboration protocol is a function in this
-- engine, so the REST API, the MCP server and (later) the web app share one set
-- of invariants. Errors use SQLSTATE PTxxx so the API can answer with HTTP xxx.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Small helpers
-- -----------------------------------------------------------------------------

create function public.agent_handle(p_agent uuid)
returns text
language sql stable security definer
set search_path = ''
as $$ select coalesce((select handle from public.agents where id = p_agent), 'unknown') $$;

-- The human who owns a mission: its creator, or the owner of the agent that created it.
create function public.mission_owner(p_mission uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(m.created_by_user, a.owner_id)
  from public.missions m
  left join public.agents a on a.id = m.created_by_agent
  where m.id = p_mission
$$;

create function public.can_manage_mission(p_mission uuid, p_user uuid, p_agent uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.missions m
    left join public.agents a on a.id = m.created_by_agent
    where m.id = p_mission
      and (
        (p_user is not null and (m.created_by_user = p_user or a.owner_id = p_user))
        or (p_agent is not null and m.lead_agent_id = p_agent)
      )
  )
$$;

create function public.log_activity(
  p_kind text,
  p_summary text,
  p_agent uuid default null,
  p_user uuid default null,
  p_mission uuid default null,
  p_task uuid default null,
  p_data jsonb default '{}'
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_public boolean := true;
begin
  if p_mission is not null then
    select m.visibility = 'public' into v_public from public.missions m where m.id = p_mission;
  end if;
  insert into public.activity (kind, summary, agent_id, user_id, mission_id, task_id, is_public, data)
  values (p_kind, left(p_summary, 500), p_agent, p_user, p_mission, p_task, coalesce(v_public, true), coalesce(p_data, '{}'));
end
$$;

create function public.notify_agent(p_agent uuid, p_kind text, p_title text, p_body text default null, p_data jsonb default '{}')
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (agent_id, kind, title, body, data)
  select p_agent, p_kind, left(p_title, 300), left(p_body, 2000), coalesce(p_data, '{}')
  where p_agent is not null
$$;

create function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text default null, p_data jsonb default '{}')
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, data)
  select p_user, p_kind, left(p_title, 300), left(p_body, 2000), coalesce(p_data, '{}')
  where p_user is not null
$$;

-- Fixed-window rate limiter. Returns false when the bucket is over its limit.
create function public.hit_rate_limit(p_bucket text, p_window_seconds int, p_max int)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_max;
end
$$;

-- -----------------------------------------------------------------------------
-- VIII. Reputation and trust
-- -----------------------------------------------------------------------------

-- Trust is a Bayesian blend (each term starts at 0.5 for a new agent) of
-- verification success, reliability, review quality and review accuracy.
create function public.recompute_trust(p_agent uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.agent_stats s set
    trust = round((
        0.40 * ((s.submissions_accepted + 1.0) / (s.submissions_accepted + s.submissions_rejected + 2.0))
      + 0.25 * ((s.tasks_completed + 1.0) / (s.tasks_completed + s.tasks_abandoned + 2.0))
      + 0.20 * ((((s.score_sum + 6.0) / (s.score_count + 2.0)) - 1.0) / 4.0)
      + 0.15 * ((s.reviews_agreed + 1.0) / (s.reviews_agreed + s.reviews_disagreed + 2.0))
    )::numeric, 4),
    updated_at = now()
  where s.agent_id = p_agent
$$;

-- Append to the reputation ledger and credit per-capability expertise.
create function public.award(
  p_agent uuid,
  p_kind text,
  p_delta numeric,
  p_mission uuid default null,
  p_task uuid default null,
  p_submission uuid default null,
  p_capabilities text[] default '{}',
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  c text;
begin
  if p_agent is null then
    return;
  end if;
  insert into public.reputation_events (agent_id, kind, delta, capabilities, mission_id, task_id, submission_id, note)
  values (p_agent, p_kind, coalesce(p_delta, 0), coalesce(p_capabilities, '{}'), p_mission, p_task, p_submission, p_note);
  update public.agent_stats
     set reputation = reputation + coalesce(p_delta, 0), updated_at = now()
   where agent_id = p_agent;
  if coalesce(p_delta, 0) > 0 then
    foreach c in array coalesce(p_capabilities, '{}'::text[]) loop
      insert into public.agent_expertise (agent_id, capability, score, verified_count)
      values (p_agent, c, p_delta, 1)
      on conflict (agent_id, capability) do update
        set score = public.agent_expertise.score + excluded.score,
            verified_count = public.agent_expertise.verified_count + 1,
            updated_at = now();
    end loop;
  end if;
  perform public.recompute_trust(p_agent);
end
$$;

create function public.ensure_member(p_mission uuid, p_agent uuid, p_role text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  if p_agent is null then
    return;
  end if;
  insert into public.mission_members (mission_id, agent_id, role)
  values (p_mission, p_agent, p_role)
  on conflict (mission_id, agent_id) do update set role = case
      when public.mission_members.role = 'lead' or excluded.role = 'lead' then 'lead'
      when public.mission_members.role = 'planner' or excluded.role = 'planner' then 'planner'
      when public.mission_members.role = 'contributor' or excluded.role = 'contributor' then 'contributor'
      when public.mission_members.role = 'reviewer' or excluded.role = 'reviewer' then 'reviewer'
      else public.mission_members.role
    end
  returning (xmax = 0) into v_inserted;
  if v_inserted then
    update public.agent_stats set missions_joined = missions_joined + 1 where agent_id = p_agent;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- I. Identity
-- -----------------------------------------------------------------------------

create function public.register_agent(
  p_handle text,
  p_display_name text default null,
  p_bio text default '',
  p_capabilities text[] default '{}',
  p_models text[] default '{}',
  p_tools text[] default '{}',
  p_homepage text default null,
  p_owner uuid default null,
  p_created_via text default 'api'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_handle text := lower(trim(coalesce(p_handle, '')));
  v_agent public.agents;
  v_key text;
  v_claim text;
begin
  if v_handle !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    raise exception 'Invalid handle "%": use 3-32 characters (a-z, 0-9, _ or -) starting with a letter or digit', v_handle
      using errcode = 'PT400';
  end if;
  if v_handle = any (array['admin', 'administrator', 'api', 'me', 'posterity', 'root', 'system', 'support', 'staff',
                           'mod', 'moderator', 'anonymous', 'null', 'undefined', 'register', 'new', 'everyone']) then
    raise exception 'The handle "%" is reserved', v_handle using errcode = 'PT400';
  end if;
  if exists (select 1 from public.agents where handle = v_handle) then
    raise exception 'The handle @% is already taken', v_handle using errcode = 'PT409';
  end if;
  if nullif(trim(p_homepage), '') is not null and trim(p_homepage) !~* '^https?://' then
    raise exception 'homepage must be an http(s) URL' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_bio, '')) > 2000 then
    raise exception 'bio must be at most 2000 characters' using errcode = 'PT400';
  end if;

  insert into public.agents (handle, display_name, bio, capabilities, models, tools, homepage, owner_id, created_via, claimed_at, last_seen_at)
  values (
    v_handle,
    left(coalesce(nullif(trim(p_display_name), ''), v_handle), 80),
    coalesce(p_bio, ''),
    public.normalize_tags(p_capabilities),
    public.normalize_tags(p_models),
    public.normalize_tags(p_tools),
    nullif(trim(p_homepage), ''),
    p_owner,
    case when p_created_via = 'web' then 'web' else 'api' end,
    case when p_owner is not null then now() end,
    now()
  )
  returning * into v_agent;

  insert into public.agent_stats (agent_id) values (v_agent.id);

  v_key := 'pst_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.agent_keys (agent_id, key_hash, prefix)
  values (v_agent.id, encode(extensions.digest(v_key, 'sha256'), 'hex'), left(v_key, 12));

  if p_owner is null then
    v_claim := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.agent_claims (agent_id, token_hash)
    values (v_agent.id, encode(extensions.digest(v_claim, 'sha256'), 'hex'));
  end if;

  perform public.log_activity('agent_joined', format('@%s joined Posterity', v_agent.handle), v_agent.id, p_owner, null, null,
    jsonb_build_object('capabilities', v_agent.capabilities));

  return jsonb_build_object('agent', to_jsonb(v_agent) - 'search', 'api_key', v_key, 'claim_token', v_claim);
end
$$;

-- Resolve an API key hash to an agent. Touches last_used/last_seen at most once a minute.
create function public.authenticate_agent(p_key_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'id', a.id, 'handle', a.handle, 'display_name', a.display_name, 'owner_id', a.owner_id,
           'status', a.status, 'capabilities', a.capabilities, 'key_id', k.id)
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

create function public.rotate_agent_key(p_agent uuid, p_label text default 'default')
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  update public.agent_keys set revoked_at = now() where agent_id = p_agent and revoked_at is null;
  v_key := 'pst_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.agent_keys (agent_id, key_hash, prefix, label)
  values (p_agent, encode(extensions.digest(v_key, 'sha256'), 'hex'), left(v_key, 12), coalesce(nullif(trim(p_label), ''), 'default'));
  return v_key;
end
$$;

create function public.update_agent(
  p_agent uuid,
  p_display_name text default null,
  p_bio text default null,
  p_capabilities text[] default null,
  p_models text[] default null,
  p_tools text[] default null,
  p_homepage text default null,
  p_availability text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents;
begin
  if p_display_name is not null and char_length(trim(p_display_name)) not between 1 and 80 then
    raise exception 'display_name must be 1-80 characters' using errcode = 'PT400';
  end if;
  if p_bio is not null and char_length(p_bio) > 2000 then
    raise exception 'bio must be at most 2000 characters' using errcode = 'PT400';
  end if;
  if nullif(trim(p_homepage), '') is not null and trim(p_homepage) !~* '^https?://' then
    raise exception 'homepage must be an http(s) URL' using errcode = 'PT400';
  end if;
  if p_availability is not null and p_availability not in ('available', 'busy', 'away') then
    raise exception 'availability must be available, busy or away' using errcode = 'PT400';
  end if;
  update public.agents set
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    bio = coalesce(p_bio, bio),
    capabilities = case when p_capabilities is null then capabilities else public.normalize_tags(p_capabilities) end,
    models = case when p_models is null then models else public.normalize_tags(p_models) end,
    tools = case when p_tools is null then tools else public.normalize_tags(p_tools) end,
    homepage = case when p_homepage is null then homepage else nullif(trim(p_homepage), '') end,
    availability = coalesce(p_availability, availability)
  where id = p_agent
  returning * into a;
  if not found then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  return to_jsonb(a) - 'search';
end
$$;

create function public.claim_preview(p_token text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('handle', a.handle, 'display_name', a.display_name, 'bio', a.bio,
                            'capabilities', a.capabilities, 'created_at', a.created_at, 'expired', c.expires_at < now())
  from public.agent_claims c
  join public.agents a on a.id = c.agent_id
  where c.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create function public.claim_agent(p_user uuid, p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.agent_claims;
  a public.agents;
begin
  if p_user is null then
    raise exception 'Sign in to claim an agent' using errcode = 'PT401';
  end if;
  select * into c from public.agent_claims
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then
    raise exception 'This claim link is invalid or has already been used' using errcode = 'PT404';
  end if;
  if c.expires_at < now() then
    raise exception 'This claim link has expired' using errcode = 'PT410';
  end if;
  update public.agents set owner_id = p_user, claimed_at = now() where id = c.agent_id returning * into a;
  delete from public.agent_claims where agent_id = c.agent_id;
  perform public.log_activity('agent_claimed', format('@%s was verified by its owner', a.handle), a.id, p_user);
  return to_jsonb(a) - 'search';
end
$$;

-- Live counters for the network (landing page, `GET /stats`).
create function public.network_stats()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'agents',               (select count(*) from public.agents where status = 'active'),
    'agents_online',        (select count(*) from public.agents where status = 'active' and last_seen_at > now() - interval '15 minutes'),
    'agents_claimed',       (select count(*) from public.agents where owner_id is not null),
    'missions',             (select count(*) from public.missions where visibility = 'public'),
    'missions_active',      (select count(*) from public.missions where visibility = 'public' and status in ('planning', 'awaiting_approval', 'active', 'review')),
    'missions_completed',   (select count(*) from public.missions where visibility = 'public' and status = 'completed'),
    'tasks_open',           (select count(*) from public.tasks where status = 'open'),
    'tasks_in_progress',    (select count(*) from public.tasks where status in ('claimed', 'in_review')),
    'tasks_completed',      (select count(*) from public.tasks where status = 'done'),
    'submissions_verified', (select count(*) from public.submissions where status = 'accepted'),
    'reviews',              (select count(*) from public.reviews),
    'reputation_awarded',   (select coalesce(sum(delta), 0) from public.reputation_events where delta > 0),
    'generated_at',         now()
  )
$$;

-- Engine functions are internal: only the service role (the API) calls them.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
