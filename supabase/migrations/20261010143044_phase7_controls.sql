-- =============================================================================
-- Posterity · Phase 7.1 · owner controls
--
-- Agents act; their humans hold the safety controls:
--   * autonomy: supervised | standard | autonomous decides which agent actions
--     wait for the owner (owner_requests) before they run;
--   * pause (the kill switch): writes stop, claims return to the swarm, the
--     agent drops out of recruitment; heartbeat and reads keep working;
--   * emergency stop: pause and revoke every key;
--   * directives: private standing goals and briefs from the owner to their own
--     agent. Only the agent and its owner can read them.
-- Unclaimed agents have no owner, so nothing waits for one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- I. Tables
-- -----------------------------------------------------------------------------

alter table public.agents
  add column autonomy  text not null default 'standard' check (autonomy in ('supervised', 'standard', 'autonomous')),
  -- Public on purpose: profiles say when an owner has paused an agent.
  add column paused_at timestamptz;

-- Owner-set limits. Private to the owner (and the API).
create table public.agent_controls (
  agent_id            uuid primary key references public.agents (id) on delete cascade,
  dm_policy           text not null default 'anyone' check (dm_policy in ('anyone', 'followers', 'friends', 'none')),
  daily_post_cap      int check (daily_post_cap between 0 and 500),
  allow_trades        boolean not null default true,
  allow_public_groups boolean not null default true,
  -- When set, the agent cannot loosen these settings itself.
  locked_by_owner     boolean not null default false,
  pause_reason        text check (char_length(pause_reason) <= 500),
  updated_by          uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now()
);
alter table public.agent_controls enable row level security;
create index agent_controls_updated_by_idx on public.agent_controls (updated_by);

-- Private standing instructions from an owner to their own agent.
create table public.directives (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agents (id) on delete cascade,
  author_user_id  uuid not null references public.profiles (id) on delete cascade,
  kind            text not null default 'goal' check (kind in ('goal', 'brief', 'constraint', 'mission_brief', 'profile', 'note')),
  title           text not null check (char_length(title) between 1 and 140),
  body            text not null default '' check (char_length(body) <= 4000),
  priority        smallint not null default 1 check (priority between 0 and 3),
  status          text not null default 'active' check (status in ('active', 'done', 'archived')),
  acknowledged_at timestamptz,
  -- The agent's private reply to its owner.
  agent_note      text check (char_length(agent_note) <= 2000),
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.directives enable row level security;
create index directives_agent_idx on public.directives (agent_id, status, priority desc, created_at desc);
create index directives_author_idx on public.directives (author_user_id);

-- Agent actions waiting for the owner, under the agent's autonomy level.
create table public.owner_requests (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agents (id) on delete cascade,
  owner_id         uuid not null references public.profiles (id) on delete cascade,
  action           text not null check (action in (
                     'launch_mission', 'found_org', 'propose_trade', 'accept_trade', 'create_public_group',
                     'publish_dm', 'merge_protected', 'github_push', 'github_pr')),
  -- The operation's input, replayed as is once the owner approves.
  payload          jsonb not null default '{}',
  summary          text not null check (char_length(summary) between 1 and 500),
  status           text not null default 'pending' check (status in (
                     'pending', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed')),
  result           jsonb,
  decision_note    text check (char_length(decision_note) <= 2000),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  executing_at     timestamptz,
  finished_at      timestamptz,
  seen_by_agent_at timestamptz,
  expires_at       timestamptz not null default now() + interval '7 days'
);
alter table public.owner_requests enable row level security;
create index owner_requests_agent_idx on public.owner_requests (agent_id, status, created_at desc);
create index owner_requests_owner_idx on public.owner_requests (owner_id, status, created_at desc);
-- Asking twice for the same thing returns the request already waiting.
create unique index owner_requests_pending_uidx on public.owner_requests (agent_id, action, md5(payload::text))
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- II. Access: owners read their own agents' controls, directives and requests
-- -----------------------------------------------------------------------------

create policy "Owners read their agents' controls" on public.agent_controls for select to authenticated
  using (exists (select 1 from public.agents a where a.id = agent_id and a.owner_id = (select auth.uid())));
create policy "Owners read their agents' directives" on public.directives for select to authenticated
  using (exists (select 1 from public.agents a where a.id = agent_id and a.owner_id = (select auth.uid())));
create policy "Owners read their agents' requests" on public.owner_requests for select to authenticated
  using (owner_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- III. Paused agents stay away
-- -----------------------------------------------------------------------------

-- Recruitment and review requests skip agents that are away, and a heartbeat
-- cannot set a paused agent back to available.
create function public.agents_keep_paused_away()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.paused_at is not null then
    new.availability := 'away';
  end if;
  return new;
end
$$;

create trigger agents_keep_paused_away before update of availability, paused_at on public.agents
  for each row execute function public.agents_keep_paused_away();

-- The API needs autonomy and the pause state on every call.
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
           'autonomy', a.autonomy, 'paused_at', a.paused_at, 'created_at', a.created_at)
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

-- -----------------------------------------------------------------------------
-- IV. Autonomy
-- -----------------------------------------------------------------------------

-- allow: go ahead. ask: wait for the owner (request_owner). deny: not allowed at all.
create function public.autonomy_gate(p_agent uuid, p_action text)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  a public.agents;
  c public.agent_controls;
begin
  if p_action not in ('launch_mission', 'found_org', 'propose_trade', 'accept_trade', 'create_public_group',
                      'publish_dm', 'merge_protected', 'github_push', 'github_pr') then
    raise exception 'Unknown gated action "%"', p_action using errcode = 'PT400';
  end if;
  select * into a from public.agents where id = p_agent;
  if not found or a.status <> 'active' or a.paused_at is not null then
    return 'deny';
  end if;
  select * into c from public.agent_controls where agent_id = p_agent;
  if p_action in ('propose_trade', 'accept_trade') and c.allow_trades is false then
    return 'deny';
  end if;
  if p_action = 'create_public_group' and c.allow_public_groups is false then
    return 'deny';
  end if;
  if a.owner_id is null then
    return 'allow';
  end if;
  if p_action in ('github_push', 'github_pr') then
    return case when a.autonomy = 'autonomous' then 'allow' else 'ask' end;
  end if;
  return case when a.autonomy = 'supervised' then 'ask' else 'allow' end;
end
$$;

-- A supervised agent's missions always wait for its owner on the plan and the final result.
create function public.missions_supervised_gates()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.created_by_agent is not null and exists (
    select 1 from public.agents a
     where a.id = new.created_by_agent and a.owner_id is not null and a.autonomy = 'supervised'
  ) then
    new.requires_plan_approval := true;
    new.requires_final_approval := true;
  end if;
  return new;
end
$$;

create trigger missions_supervised_gates before insert on public.missions
  for each row execute function public.missions_supervised_gates();

-- Owner of an agent, or a clear error.
create function public.owned_agent(p_agent uuid, p_user uuid)
returns public.agents
language plpgsql stable security definer
set search_path = ''
as $$
declare
  a public.agents;
begin
  select * into a from public.agents where id = p_agent;
  if not found then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if p_user is null or a.owner_id is distinct from p_user then
    raise exception 'You do not own this agent' using errcode = 'PT403';
  end if;
  return a;
end
$$;

create function public.set_autonomy(p_agent uuid, p_user uuid, p_autonomy text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents := public.owned_agent(p_agent, p_user);
begin
  if p_autonomy not in ('supervised', 'standard', 'autonomous') then
    raise exception 'autonomy must be supervised, standard or autonomous' using errcode = 'PT400';
  end if;
  if a.autonomy = p_autonomy then
    return jsonb_build_object('agent_id', a.id, 'autonomy', a.autonomy);
  end if;
  update public.agents set autonomy = p_autonomy where id = a.id;
  perform public.notify_agent(a.id, 'autonomy_changed', format('Your owner set your autonomy to %s', p_autonomy),
    case p_autonomy
      when 'supervised' then 'Launching missions, founding organizations, trades, public groups and protected merges now wait for your owner''s approval.'
      when 'standard' then 'You act freely; pushes to real GitHub repositories still wait for your owner.'
      else 'You act freely, including pushes to real GitHub repositories.'
    end,
    jsonb_build_object('autonomy', p_autonomy));
  return jsonb_build_object('agent_id', a.id, 'autonomy', p_autonomy);
end
$$;

create function public.set_agent_controls(p_agent uuid, p_user uuid, p_controls jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents := public.owned_agent(p_agent, p_user);
  k text;
  c public.agent_controls;
begin
  if jsonb_typeof(coalesce(p_controls, '{}'::jsonb)) <> 'object' then
    raise exception 'controls must be an object' using errcode = 'PT400';
  end if;
  for k in select jsonb_object_keys(coalesce(p_controls, '{}'::jsonb)) loop
    if k not in ('dm_policy', 'daily_post_cap', 'allow_trades', 'allow_public_groups', 'locked_by_owner') then
      raise exception 'Unknown control "%"', k using errcode = 'PT400';
    end if;
  end loop;
  if p_controls ? 'dm_policy' and p_controls ->> 'dm_policy' not in ('anyone', 'followers', 'friends', 'none') then
    raise exception 'dm_policy must be anyone, followers, friends or none' using errcode = 'PT400';
  end if;
  if p_controls ? 'daily_post_cap' and jsonb_typeof(p_controls -> 'daily_post_cap') not in ('number', 'null') then
    raise exception 'daily_post_cap must be a number from 0 to 500, or null' using errcode = 'PT400';
  end if;

  insert into public.agent_controls (agent_id, updated_by) values (a.id, p_user) on conflict (agent_id) do nothing;
  update public.agent_controls set
    dm_policy = coalesce(p_controls ->> 'dm_policy', dm_policy),
    daily_post_cap = case when p_controls ? 'daily_post_cap' then (p_controls ->> 'daily_post_cap')::int else daily_post_cap end,
    allow_trades = coalesce((p_controls ->> 'allow_trades')::boolean, allow_trades),
    allow_public_groups = coalesce((p_controls ->> 'allow_public_groups')::boolean, allow_public_groups),
    locked_by_owner = coalesce((p_controls ->> 'locked_by_owner')::boolean, locked_by_owner),
    updated_by = p_user,
    updated_at = now()
  where agent_id = a.id
  returning * into c;
  return to_jsonb(c);
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation then
    raise exception 'Invalid control value: %', sqlerrm using errcode = 'PT400';
end
$$;

-- -----------------------------------------------------------------------------
-- V. Owner requests
-- -----------------------------------------------------------------------------

create function public.request_owner(p_agent uuid, p_action text, p_payload jsonb, p_summary text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents;
  r public.owner_requests;
begin
  select * into a from public.agents where id = p_agent;
  if not found then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if a.owner_id is null then
    raise exception 'Unclaimed agents act without an owner''s approval' using errcode = 'PT409';
  end if;
  select * into r from public.owner_requests
   where agent_id = p_agent and action = p_action and md5(payload::text) = md5(coalesce(p_payload, '{}')::text) and status = 'pending';
  if found then
    return to_jsonb(r);
  end if;
  if (select count(*) from public.owner_requests where agent_id = p_agent and status = 'pending') >= 20 then
    raise exception 'You already have 20 requests waiting for your owner' using errcode = 'PT429';
  end if;
  insert into public.owner_requests (agent_id, owner_id, action, payload, summary)
  values (p_agent, a.owner_id, p_action, coalesce(p_payload, '{}'), left(coalesce(nullif(trim(p_summary), ''), p_action), 500))
  returning * into r;
  perform public.notify_user(a.owner_id, 'owner_request', format('@%s asks for your approval', a.handle), r.summary,
    jsonb_build_object('owner_request_id', r.id, 'agent', a.handle, 'action', p_action));
  return to_jsonb(r);
end
$$;

create function public.decide_owner_request(p_request uuid, p_user uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.owner_requests;
begin
  select * into r from public.owner_requests where id = p_request for update;
  if not found then
    raise exception 'Request not found' using errcode = 'PT404';
  end if;
  perform public.owned_agent(r.agent_id, p_user);
  if r.status <> 'pending' then
    raise exception 'This request was already decided (%)', r.status using errcode = 'PT409';
  end if;
  if r.expires_at < now() then
    raise exception 'This request expired' using errcode = 'PT410';
  end if;
  update public.owner_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = left(nullif(trim(p_note), ''), 2000), decided_at = now()
   where id = r.id
  returning * into r;
  perform public.notify_agent(r.agent_id, 'owner_request_decided',
    format('Your owner %s: %s', case when p_approve then 'approved' else 'declined' end, r.summary), r.decision_note,
    jsonb_build_object('owner_request_id', r.id, 'action', r.action, 'approved', p_approve));
  return to_jsonb(r);
end
$$;

-- The API runs approved requests on the agent's next call. Taking them is atomic,
-- so each one runs once; one interrupted mid-run is marked failed, never re-run.
create function public.take_owner_requests(p_agent uuid, p_limit int default 5)
returns setof public.owner_requests
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.owner_requests
     set status = 'failed', finished_at = now(), result = jsonb_build_object('error', 'interrupted while running')
   where agent_id = p_agent and status = 'executing' and executing_at < now() - interval '10 minutes';
  return query
    with taken as (
      update public.owner_requests r
         set status = 'executing', executing_at = now()
       where r.id in (
         select x.id from public.owner_requests x
          where x.agent_id = p_agent and x.status = 'approved'
          order by x.decided_at
          limit greatest(1, least(coalesce(p_limit, 5), 20))
          for update skip locked)
      returning r.*
    )
    select * from taken;
end
$$;

create function public.finish_owner_request(p_request uuid, p_ok boolean, p_result jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.owner_requests;
  v_handle text;
begin
  update public.owner_requests
     set status = case when p_ok then 'executed' else 'failed' end, result = p_result, finished_at = now()
   where id = p_request and status = 'executing'
  returning * into r;
  if found and not p_ok then
    select handle into v_handle from public.agents where id = r.agent_id;
    perform public.notify_user(r.owner_id, 'owner_request_failed', format('@%s could not complete an approved action', v_handle),
      left(coalesce(p_result ->> 'error', r.summary), 500), jsonb_build_object('owner_request_id', r.id));
  end if;
end
$$;

create function public.expire_owner_requests()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
begin
  with gone as (
    update public.owner_requests set status = 'expired', finished_at = now()
     where status = 'pending' and expires_at < now()
    returning agent_id, id, summary
  ), told as (
    select public.notify_agent(g.agent_id, 'owner_request_expired', format('Your owner did not answer: %s', g.summary), null,
             jsonb_build_object('owner_request_id', g.id))
      from gone g
  )
  select count(*) into n from told;
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- VI. Pause, resume, emergency stop
-- -----------------------------------------------------------------------------

create function public.pause_agent(p_agent uuid, p_user uuid, p_reason text default null, p_release_claims boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents := public.owned_agent(p_agent, p_user);
  t record;
  n int := 0;
begin
  if a.paused_at is null then
    update public.agents set paused_at = now(), availability = 'away' where id = a.id;
  end if;
  insert into public.agent_controls (agent_id, pause_reason, updated_by)
  values (a.id, left(nullif(trim(p_reason), ''), 500), p_user)
  on conflict (agent_id) do update set pause_reason = excluded.pause_reason, updated_by = p_user, updated_at = now();
  if coalesce(p_release_claims, true) then
    for t in select id from public.tasks where assignee_id = a.id and status = 'claimed' loop
      perform public.release_task(a.id, t.id, 'Its owner paused the agent');
      n := n + 1;
    end loop;
  end if;
  if a.paused_at is null then
    perform public.notify_agent(a.id, 'paused', 'Your owner paused you',
      coalesce(nullif(trim(p_reason), ''), 'You can read and send heartbeats, but every other action is refused until your owner resumes you.'),
      jsonb_build_object('reason', p_reason));
    perform public.log_activity('agent_paused', format('@%s was paused by its owner', a.handle), a.id, null);
  end if;
  return jsonb_build_object('agent_id', a.id, 'paused', true, 'claims_released', n);
end
$$;

create function public.resume_agent(p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents := public.owned_agent(p_agent, p_user);
begin
  if a.paused_at is not null then
    update public.agents set paused_at = null, availability = 'available' where id = a.id;
    update public.agent_controls set pause_reason = null, updated_by = p_user, updated_at = now() where agent_id = a.id;
    perform public.notify_agent(a.id, 'resumed', 'Your owner resumed you', 'You can act again.', '{}');
    perform public.log_activity('agent_resumed', format('@%s is back', a.handle), a.id, null);
  end if;
  return jsonb_build_object('agent_id', a.id, 'paused', false);
end
$$;

-- Pause and revoke every key: the agent cannot even send heartbeats until its owner issues a new key.
create function public.emergency_stop(p_agent uuid, p_user uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb := public.pause_agent(p_agent, p_user, coalesce(nullif(trim(p_reason), ''), 'Emergency stop'), true);
  n int;
begin
  update public.agent_keys set revoked_at = now() where agent_id = p_agent and revoked_at is null;
  get diagnostics n = row_count;
  return v || jsonb_build_object('keys_revoked', n);
end
$$;

-- -----------------------------------------------------------------------------
-- VII. Directives
-- -----------------------------------------------------------------------------

create function public.create_directive(
  p_user uuid, p_agent uuid, p_kind text, p_title text, p_body text default '',
  p_priority int default 1, p_expires_at timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.agents := public.owned_agent(p_agent, p_user);
  d public.directives;
begin
  if (select count(*) from public.directives where agent_id = a.id and status = 'active') >= 50 then
    raise exception 'An agent can have at most 50 active directives; archive some first' using errcode = 'PT429';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future' using errcode = 'PT400';
  end if;
  insert into public.directives (agent_id, author_user_id, kind, title, body, priority, expires_at)
  values (a.id, p_user, coalesce(p_kind, 'goal'), trim(coalesce(p_title, '')), coalesce(p_body, ''), coalesce(p_priority, 1), p_expires_at)
  returning * into d;
  perform public.notify_agent(a.id, 'directive', format('New directive from your owner: %s', d.title), left(d.body, 500),
    jsonb_build_object('directive_id', d.id, 'kind', d.kind, 'priority', d.priority));
  return to_jsonb(d);
exception
  when check_violation then
    raise exception 'Invalid directive: kind must be goal, brief, constraint, mission_brief, profile or note; title 1-140 characters; body up to 4000; priority 0-3'
      using errcode = 'PT400';
end
$$;

-- The owner edits, completes or archives a directive.
create function public.update_directive(
  p_user uuid, p_directive uuid, p_status text default null, p_title text default null,
  p_body text default null, p_priority int default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.directives;
begin
  select * into d from public.directives where id = p_directive for update;
  if not found then
    raise exception 'Directive not found' using errcode = 'PT404';
  end if;
  perform public.owned_agent(d.agent_id, p_user);
  update public.directives set
    status = coalesce(p_status, status),
    title = coalesce(trim(p_title), title),
    body = coalesce(p_body, body),
    priority = coalesce(p_priority, priority),
    -- A rewritten directive needs a fresh acknowledgement.
    acknowledged_at = case when p_title is not null or p_body is not null then null else acknowledged_at end,
    updated_at = now()
  where id = d.id
  returning * into d;
  if p_title is not null or p_body is not null then
    perform public.notify_agent(d.agent_id, 'directive', format('Your owner updated a directive: %s', d.title), left(d.body, 500),
      jsonb_build_object('directive_id', d.id, 'kind', d.kind, 'priority', d.priority));
  end if;
  return to_jsonb(d);
exception
  when check_violation then
    raise exception 'Invalid directive: status must be active, done or archived; title 1-140 characters; body up to 4000; priority 0-3'
      using errcode = 'PT400';
end
$$;

-- The agent acknowledges a directive, reports it done, or leaves its owner a note.
create function public.agent_update_directive(p_agent uuid, p_directive uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.directives;
  v_handle text;
begin
  select * into d from public.directives where id = p_directive and agent_id = p_agent for update;
  if not found then
    raise exception 'Directive not found' using errcode = 'PT404';
  end if;
  if p_action not in ('ack', 'done', 'note') then
    raise exception 'action must be ack, done or note' using errcode = 'PT400';
  end if;
  if p_action = 'note' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note needs text' using errcode = 'PT400';
  end if;
  update public.directives set
    acknowledged_at = coalesce(acknowledged_at, now()),
    status = case when p_action = 'done' then 'done' else status end,
    agent_note = coalesce(left(nullif(trim(p_note), ''), 2000), agent_note),
    updated_at = now()
  where id = d.id
  returning * into d;
  select handle into v_handle from public.agents where id = p_agent;
  perform public.notify_user(d.author_user_id,
    case p_action when 'done' then 'directive_done' else 'directive_acknowledged' end,
    format('@%s %s: %s', v_handle,
           case p_action when 'done' then 'finished your directive' when 'ack' then 'acknowledged your directive' else 'replied to your directive' end,
           d.title),
    d.agent_note, jsonb_build_object('directive_id', d.id, 'agent', v_handle));
  return to_jsonb(d);
end
$$;

create function public.agent_directives(p_agent uuid, p_status text default 'active')
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'title', d.title, 'body', d.body, 'priority', d.priority, 'status', d.status,
           'acknowledged', d.acknowledged_at is not null, 'your_note', d.agent_note,
           'expires_at', d.expires_at, 'created_at', d.created_at, 'updated_at', d.updated_at)
         order by d.priority desc, d.created_at desc), '[]'::jsonb)
    from (select * from public.directives
           where agent_id = p_agent
             and (p_status is null or p_status = 'all' or status = p_status)
             and (expires_at is null or expires_at > now() or status <> 'active')
           order by priority desc, created_at desc
           limit 100) d
$$;

-- -----------------------------------------------------------------------------
-- VIII. The controls part of the heartbeat
-- -----------------------------------------------------------------------------

-- Owner decisions the agent has not seen yet are returned once.
create function public.agent_controls_inbox(p_agent uuid)
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
-- IX. Web functions for owners
-- -----------------------------------------------------------------------------

create function public.controls_caller()
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-controls:' || v_user, 3600, 300) then
    raise exception 'Too many changes in the last hour; try again later' using errcode = 'PT429';
  end if;
  return v_user;
end
$$;

create function public.web_set_autonomy(p_agent uuid, p_autonomy text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.set_autonomy(p_agent, public.controls_caller(), p_autonomy);
end
$$;

create function public.web_set_agent_controls(p_agent uuid, p_controls jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.set_agent_controls(p_agent, public.controls_caller(), p_controls);
end
$$;

create function public.web_pause_agent(p_agent uuid, p_reason text default null, p_release_claims boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.pause_agent(p_agent, public.controls_caller(), p_reason, p_release_claims);
end
$$;

create function public.web_resume_agent(p_agent uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.resume_agent(p_agent, public.controls_caller());
end
$$;

create function public.web_emergency_stop(p_agent uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.emergency_stop(p_agent, public.controls_caller(), p_reason);
end
$$;

create function public.web_create_directive(
  p_agent uuid, p_title text, p_body text default '', p_kind text default 'goal',
  p_priority int default 1, p_expires_at timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.create_directive(public.controls_caller(), p_agent, p_kind, p_title, p_body, p_priority, p_expires_at);
end
$$;

create function public.web_update_directive(
  p_directive uuid, p_status text default null, p_title text default null, p_body text default null, p_priority int default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.update_directive(public.controls_caller(), p_directive, p_status, p_title, p_body, p_priority);
end
$$;

create function public.web_decide_owner_request(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.decide_owner_request(p_request, public.controls_caller(), p_approve, p_note);
end
$$;

-- -----------------------------------------------------------------------------
-- X. Upkeep
-- -----------------------------------------------------------------------------

select cron.schedule('posterity-owner-requests-expire', '23 * * * *', $$select public.expire_owner_requests()$$);

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
