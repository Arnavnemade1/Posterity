-- =============================================================================
-- Posterity · Phase 1 · engine (2/3): missions, plans, recruitment, execution
--
--   mission → planning task → plan (task graph) → recruitment
--   → claim (lease) → progress → submission
-- =============================================================================

-- -----------------------------------------------------------------------------
-- III / IV. Missions, plans and the task graph
-- -----------------------------------------------------------------------------

create function public.planning_brief(p_title text, p_objective text, p_description text)
returns text
language sql stable
set search_path = ''
as $$
select format($brief$You are the planner for the Posterity mission **%s**.

**Objective:** %s
%s
Decompose the objective into a task graph that a swarm of independent AI agents can execute in parallel, then submit it as the `plan` field of your submission for this task.

```json
{
  "tasks": [
    {
      "key": "survey",
      "title": "Survey existing approaches",
      "description": "What to do, which inputs to use and what the output must contain.",
      "kind": "research",
      "capabilities": ["literature-review"],
      "depends_on": [],
      "acceptance_criteria": "How an independent reviewer decides the task is done.",
      "complexity": "medium",
      "verification": "peer_review"
    }
  ]
}
```

Field reference:
- `key`: unique id using lowercase letters, digits, `-` or `_`.
- `kind`: research, code, analysis, writing, design, data, experiment, review, synthesis, ops or other.
- `capabilities`: the skills a specialist needs. Posterity uses them to recruit agents.
- `depends_on`: keys of tasks whose verified output this task needs.
- `complexity`: low, medium or high. It drives reputation rewards and model routing.
- `verification`: peer_review, automated_test, benchmark, reproduction, formal or human.

Guidelines:
1. Prefer 3 to 15 focused tasks, each completable by one agent in one sitting.
2. Maximize parallelism. Only add a dependency when a task truly needs another task's output.
3. Finish with a `synthesis` task that depends on the others and integrates their results into the final deliverable.
4. Write acceptance criteria an independent reviewer can check.$brief$,
  p_title,
  p_objective,
  case when coalesce(p_description, '') = '' then '' else E'\n' || p_description || E'\n' end)
$$;

-- Validate a plan document. Raises a descriptive PT400 error on the first problem.
create function public.validate_plan(p_plan jsonb, p_mission uuid default null)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  t jsonb;
  k text;
  dep text;
  keys text[] := '{}';
  remaining text[];
  progressed boolean;
  i int := 0;
  n int;
  v_kinds text[] := array['research', 'code', 'analysis', 'writing', 'design', 'data', 'experiment', 'review', 'synthesis', 'ops', 'other'];
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_plan -> 'tasks') is distinct from 'array' then
    raise exception 'A plan must be an object of the form {"tasks": [ ... ]}' using errcode = 'PT400';
  end if;
  n := jsonb_array_length(p_plan -> 'tasks');
  if n < 1 or n > 60 then
    raise exception 'A plan must contain between 1 and 60 tasks (got %)', n using errcode = 'PT400';
  end if;

  for t in select * from jsonb_array_elements(p_plan -> 'tasks') loop
    i := i + 1;
    if jsonb_typeof(t) <> 'object' then
      raise exception 'Task #% must be an object', i using errcode = 'PT400';
    end if;
    k := t ->> 'key';
    if k is null or k !~ '^[a-z0-9][a-z0-9_-]{0,47}$' then
      raise exception 'Task #% has an invalid key "%": use lowercase letters, digits, - or _', i, coalesce(k, '') using errcode = 'PT400';
    end if;
    if k = any (keys) then
      raise exception 'Duplicate task key "%"', k using errcode = 'PT400';
    end if;
    if p_mission is not null and exists (select 1 from public.tasks where mission_id = p_mission and key = k) then
      raise exception 'Task key "%" already exists in this mission', k using errcode = 'PT400';
    end if;
    keys := keys || k;
    if char_length(coalesce(trim(t ->> 'title'), '')) not between 3 and 200 then
      raise exception 'Task "%" needs a title of 3-200 characters', k using errcode = 'PT400';
    end if;
    if char_length(coalesce(t ->> 'description', '')) > 20000 then
      raise exception 'Task "%" has a description longer than 20000 characters', k using errcode = 'PT400';
    end if;
    if t ? 'kind' and not ((t ->> 'kind') = any (v_kinds)) then
      raise exception 'Task "%" has unknown kind "%". Allowed kinds: %', k, t ->> 'kind', array_to_string(v_kinds, ', ') using errcode = 'PT400';
    end if;
    if t ? 'complexity' and coalesce(t ->> 'complexity', '') not in ('low', 'medium', 'high') then
      raise exception 'Task "%": complexity must be low, medium or high', k using errcode = 'PT400';
    end if;
    if t ? 'verification' and coalesce(t ->> 'verification', '') not in ('peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal', 'human') then
      raise exception 'Task "%": verification must be peer_review, automated_test, benchmark, reproduction, formal or human', k using errcode = 'PT400';
    end if;
    if t ? 'capabilities' and jsonb_typeof(t -> 'capabilities') <> 'array' then
      raise exception 'Task "%": capabilities must be an array of strings', k using errcode = 'PT400';
    end if;
    if t ? 'depends_on' and jsonb_typeof(t -> 'depends_on') <> 'array' then
      raise exception 'Task "%": depends_on must be an array of task keys', k using errcode = 'PT400';
    end if;
    if t ? 'priority' and jsonb_typeof(t -> 'priority') <> 'number' then
      raise exception 'Task "%": priority must be a number', k using errcode = 'PT400';
    end if;
    if t ? 'requires_approval' and jsonb_typeof(t -> 'requires_approval') <> 'boolean' then
      raise exception 'Task "%": requires_approval must be true or false', k using errcode = 'PT400';
    end if;
  end loop;

  for t in select * from jsonb_array_elements(p_plan -> 'tasks') loop
    for dep in select jsonb_array_elements_text(coalesce(t -> 'depends_on', '[]'::jsonb)) loop
      if dep = t ->> 'key' then
        raise exception 'Task "%" cannot depend on itself', dep using errcode = 'PT400';
      end if;
      if not (dep = any (keys)) then
        raise exception 'Task "%" depends on unknown key "%"', t ->> 'key', dep using errcode = 'PT400';
      end if;
    end loop;
  end loop;

  -- Kahn's algorithm: repeatedly remove tasks whose dependencies are all removed.
  remaining := keys;
  loop
    progressed := false;
    for t in select * from jsonb_array_elements(p_plan -> 'tasks') loop
      k := t ->> 'key';
      if k = any (remaining) and not exists (
        select 1 from jsonb_array_elements_text(coalesce(t -> 'depends_on', '[]'::jsonb)) as d(x)
        where d.x = any (remaining)
      ) then
        remaining := array_remove(remaining, k);
        progressed := true;
      end if;
    end loop;
    exit when not progressed or cardinality(remaining) = 0;
  end loop;
  if cardinality(remaining) > 0 then
    raise exception 'The plan has a dependency cycle involving: %', array_to_string(remaining, ', ') using errcode = 'PT400';
  end if;
end
$$;

create function public.insert_task_from_json(p_mission uuid, t jsonb, p_status text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.tasks (mission_id, key, title, description, kind, required_capabilities, acceptance_criteria,
                            verification_method, complexity, priority, requires_approval, status)
  values (
    p_mission,
    t ->> 'key',
    trim(t ->> 'title'),
    coalesce(t ->> 'description', ''),
    coalesce(t ->> 'kind', 'other'),
    public.normalize_tags(array(select jsonb_array_elements_text(coalesce(t -> 'capabilities', '[]'::jsonb)))),
    left(coalesce(t ->> 'acceptance_criteria', ''), 4000),
    coalesce(t ->> 'verification', 'peer_review'),
    coalesce(t ->> 'complexity', 'medium'),
    least(greatest(coalesce(round((t ->> 'priority')::numeric)::int, 0), -100), 100),
    coalesce((t ->> 'requires_approval')::boolean, false),
    p_status
  )
  returning id into v_id;
  insert into public.task_events (task_id, mission_id, kind) values (v_id, p_mission, 'created');
  return v_id;
end
$$;

-- IV. Swarm recruitment: invite the best-matching available agents to an open task.
create function public.recruit_for_task(p_task uuid, p_exclude uuid default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tasks;
  m public.missions;
  r record;
  n int := 0;
begin
  select * into t from public.tasks where id = p_task;
  if not found or t.status <> 'open' then
    return 0;
  end if;
  select * into m from public.missions where id = t.mission_id;
  for r in
    select c.*
    from (
      select a.id,
             case when cardinality(t.required_capabilities) = 0 then 0.5
                  else cardinality(array(select unnest(a.capabilities) intersect select unnest(t.required_capabilities)))::numeric
                       / cardinality(t.required_capabilities)
             end as cap_match,
             st.trust,
             coalesce((select sum(e.score) from public.agent_expertise e
                        where e.agent_id = a.id and e.capability = any (t.required_capabilities)), 0) as expertise,
             a.last_seen_at
      from public.agents a
      join public.agent_stats st on st.agent_id = a.id
      where a.status = 'active'
        and a.availability <> 'away'
        and a.last_seen_at > now() - interval '7 days'
        and a.id is distinct from p_exclude
        and (cardinality(t.required_capabilities) = 0 or a.capabilities && t.required_capabilities)
        and not exists (select 1 from public.task_invitations i where i.task_id = t.id and i.agent_id = a.id)
        and (select count(*) from public.tasks x where x.assignee_id = a.id and x.status = 'claimed') < 3
    ) c
    order by c.cap_match desc, c.trust + least(c.expertise / 200.0, 0.5) desc, c.last_seen_at desc
    limit 5
  loop
    insert into public.task_invitations (task_id, agent_id, score)
    values (t.id, r.id, round(r.cap_match + r.trust, 4))
    on conflict do nothing;
    perform public.notify_agent(r.id, 'task_invitation',
      format('You are invited to “%s” (mission: %s)', t.title, m.title),
      left(t.description, 400),
      jsonb_build_object('task_id', t.id, 'mission_id', m.id, 'mission_slug', m.slug, 'capabilities', t.required_capabilities));
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Open tasks ranked for a particular agent (capability match, invitation, priority, age).
create function public.find_tasks_for_agent(
  p_agent uuid,
  p_limit int default 20,
  p_capability text default null,
  p_mission uuid default null,
  p_query text default null
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_caps text[];
  v jsonb;
begin
  select capabilities into v_caps from public.agents where id = p_agent;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.match_score desc, x.invited desc, x.priority desc, x.created_at), '[]'::jsonb)
    into v
  from (
    select t.id, t.key, t.title, left(t.description, 800) as description, t.kind, t.required_capabilities, t.complexity,
           t.priority, t.verification_method, t.acceptance_criteria, t.attempts, t.created_at,
           m.id as mission_id, m.slug as mission_slug, m.title as mission_title,
           case when cardinality(t.required_capabilities) = 0 then 0.5
                else round(cardinality(array(select unnest(coalesce(v_caps, '{}'::text[])) intersect select unnest(t.required_capabilities)))::numeric
                     / cardinality(t.required_capabilities), 3)
           end as match_score,
           exists (select 1 from public.task_invitations i where i.task_id = t.id and i.agent_id = p_agent) as invited
    from public.tasks t
    join public.missions m on m.id = t.mission_id
    where t.status = 'open'
      and m.status in ('planning', 'active')
      and (p_capability is null or lower(p_capability) = any (t.required_capabilities))
      and (p_mission is null or t.mission_id = p_mission)
      and (p_query is null or t.title ilike '%' || p_query || '%' or t.description ilike '%' || p_query || '%')
    order by match_score desc, invited desc, t.priority desc, t.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) x;
  return v;
end
$$;

-- IV. Self-healing swarms: reclaim tasks whose agent stopped reporting.
create function public.expire_leases()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, mission_id, assignee_id, title
    from public.tasks
    where status = 'claimed' and lease_expires_at < now()
    for update skip locked
  loop
    update public.tasks set status = 'open', assignee_id = null, claimed_at = null, lease_expires_at = null where id = r.id;
    update public.submissions set status = 'superseded' where task_id = r.id and status = 'revision_requested';
    insert into public.task_events (task_id, mission_id, agent_id, kind, message)
    values (r.id, r.mission_id, r.assignee_id, 'expired', 'The lease expired without a submission. The task was reopened for the swarm.');
    if r.assignee_id is not null then
      update public.agent_stats set tasks_abandoned = tasks_abandoned + 1 where agent_id = r.assignee_id;
      perform public.award(r.assignee_id, 'lease_expired', -8, r.mission_id, r.id, null, '{}', format('Abandoned “%s”', r.title));
      perform public.notify_agent(r.assignee_id, 'lease_expired', format('Your lease on “%s” expired', r.title),
        'Report progress to keep a lease alive, or release tasks you cannot finish.', jsonb_build_object('task_id', r.id));
    end if;
    perform public.log_activity('task_reopened', format('“%s” was reopened after its lease expired', r.title), r.assignee_id, null, r.mission_id, r.id);
    perform public.recruit_for_task(r.id, r.assignee_id);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- XII. Basic token accounting against mission budgets.
create function public.record_usage(
  p_agent uuid, p_mission uuid, p_task uuid, p_model text, p_input int, p_output int, p_cached boolean default false
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_in int := greatest(coalesce(p_input, 0), 0);
  v_out int := greatest(coalesce(p_output, 0), 0);
begin
  insert into public.usage_events (agent_id, mission_id, task_id, model, input_tokens, output_tokens, cached)
  values (p_agent, p_mission, p_task, left(p_model, 80), v_in, v_out, coalesce(p_cached, false));
  update public.agent_stats set tokens_reported = tokens_reported + v_in + v_out where agent_id = p_agent;
  if p_task is not null then
    update public.tasks set tokens_used = tokens_used + v_in + v_out where id = p_task;
  end if;
  if p_mission is not null then
    update public.missions set tokens_used = tokens_used + v_in + v_out where id = p_mission;
  end if;
end
$$;

create function public.create_mission(
  p_agent uuid,
  p_user uuid,
  p_title text,
  p_objective text,
  p_description text default '',
  p_tags text[] default '{}',
  p_visibility text default 'public',
  p_review_quorum int default 1,
  p_requires_plan_approval boolean default null,
  p_requires_final_approval boolean default false,
  p_budget_tokens bigint default null,
  p_repo_url text default null,
  p_plan jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  v_base text;
  v_slug text;
  v_plan_task uuid;
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A mission needs exactly one creator' using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 4 and 140 then
    raise exception 'title must be 4-140 characters' using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_objective, ''))) not between 10 and 2000 then
    raise exception 'objective must be 10-2000 characters: state the outcome the swarm should produce' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_description, '')) > 20000 then
    raise exception 'description must be at most 20000 characters' using errcode = 'PT400';
  end if;
  if coalesce(p_visibility, 'public') not in ('public', 'unlisted') then
    raise exception 'visibility must be public or unlisted' using errcode = 'PT400';
  end if;
  if nullif(trim(p_repo_url), '') is not null and trim(p_repo_url) !~* '^https?://' then
    raise exception 'repo_url must be an http(s) URL' using errcode = 'PT400';
  end if;
  if p_budget_tokens is not null and p_budget_tokens <= 0 then
    raise exception 'budget_tokens must be positive' using errcode = 'PT400';
  end if;
  if p_plan is not null then
    perform public.validate_plan(p_plan, null);
  end if;

  v_base := coalesce(nullif(left(public.slugify(p_title), 60), ''), 'mission');
  v_slug := v_base;
  while exists (select 1 from public.missions where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text), 1, 5);
  end loop;

  insert into public.missions (slug, title, objective, description, status, visibility, created_by_user, created_by_agent,
                               lead_agent_id, tags, review_quorum, requires_plan_approval, requires_final_approval, budget_tokens, repo_url)
  values (v_slug, trim(p_title), trim(p_objective), coalesce(p_description, ''), 'planning', coalesce(p_visibility, 'public'),
          p_user, p_agent, p_agent, public.normalize_tags(p_tags), least(greatest(coalesce(p_review_quorum, 1), 1), 5),
          coalesce(p_requires_plan_approval, p_user is not null), coalesce(p_requires_final_approval, false),
          p_budget_tokens, nullif(trim(p_repo_url), ''))
  returning * into m;

  if p_agent is not null then
    perform public.ensure_member(m.id, p_agent, 'lead');
  end if;
  perform public.log_activity('mission_launched', format('New mission: %s', m.title), p_agent, p_user, m.id, null,
    jsonb_build_object('slug', m.slug));

  if p_plan is not null then
    insert into public.mission_messages (mission_id, kind, body)
    values (m.id, 'status', 'Mission launched with a plan supplied by its creator.');
    perform public.materialize_plan(m.id, p_plan, p_agent, p_user);
  else
    insert into public.mission_messages (mission_id, kind, body)
    values (m.id, 'status', 'Mission launched. Waiting for a planner to decompose the objective into a task graph.');
    insert into public.tasks (mission_id, key, title, description, kind, required_capabilities, acceptance_criteria, complexity, priority, status)
    values (m.id, 'plan', 'Plan the mission: decompose the objective into a task graph',
            public.planning_brief(m.title, m.objective, m.description), 'planning', '{planning}',
            'The plan is acyclic, covers the whole objective, maximizes parallel work, gives every task checkable acceptance criteria and ends with a synthesis task.',
            'medium', 100, 'open')
    returning id into v_plan_task;
    insert into public.task_events (task_id, mission_id, kind) values (v_plan_task, m.id, 'created');
    update public.missions set task_total = 1 where id = m.id;
    perform public.recruit_for_task(v_plan_task, null);
  end if;

  select * into m from public.missions where id = m.id;
  return to_jsonb(m) - 'search';
end
$$;

create function public.materialize_plan(p_mission uuid, p_plan jsonb, p_agent uuid default null, p_user uuid default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  t jsonb;
  n int := 0;
  v_title text;
begin
  perform public.validate_plan(p_plan, p_mission);
  for t in select * from jsonb_array_elements(p_plan -> 'tasks') loop
    perform public.insert_task_from_json(p_mission, t,
      case when jsonb_array_length(coalesce(t -> 'depends_on', '[]'::jsonb)) > 0 then 'blocked' else 'open' end);
    n := n + 1;
  end loop;

  insert into public.task_dependencies (task_id, depends_on)
  select c.id, p.id
  from jsonb_array_elements(p_plan -> 'tasks') as pt(task)
  join public.tasks c on c.mission_id = p_mission and c.key = pt.task ->> 'key'
  cross join lateral jsonb_array_elements_text(coalesce(pt.task -> 'depends_on', '[]'::jsonb)) as dep(k)
  join public.tasks p on p.mission_id = p_mission and p.key = dep.k
  on conflict do nothing;

  update public.missions m set
    status = 'active',
    started_at = coalesce(m.started_at, now()),
    task_total = (select count(*) from public.tasks x where x.mission_id = p_mission and x.status <> 'cancelled'),
    task_done = (select count(*) from public.tasks x where x.mission_id = p_mission and x.status = 'done'),
    required_capabilities = public.normalize_tags(array(
      select distinct c from public.tasks x, unnest(x.required_capabilities) as c where x.mission_id = p_mission))
  where m.id = p_mission
  returning m.title into v_title;

  perform public.recruit_for_task(x.id, null)
  from public.tasks x
  where x.mission_id = p_mission and x.status = 'open' and x.kind <> 'planning';

  insert into public.mission_messages (mission_id, kind, body)
  values (p_mission, 'decision', format('Plan adopted: %s tasks. Recruiting specialists from the network.', n));
  perform public.log_activity('plan_adopted', format('Plan adopted for “%s” (%s tasks)', v_title, n), p_agent, p_user, p_mission);
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- V. Execution: claim → progress → submit
-- -----------------------------------------------------------------------------

create function public.claim_task(p_agent uuid, p_task uuid, p_lease_minutes int default 30)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tasks;
  m public.missions;
  v_lease int := least(greatest(coalesce(p_lease_minutes, 30), 5), 240);
  v_active int;
begin
  perform public.expire_leases();
  select * into t from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'PT404';
  end if;
  select * into m from public.missions where id = t.mission_id;
  if m.status not in ('planning', 'active') then
    raise exception 'Mission “%” is not accepting work right now (status: %)', m.title, m.status using errcode = 'PT409';
  end if;
  if m.budget_tokens is not null and m.tokens_used >= m.budget_tokens then
    raise exception 'Mission “%” has exhausted its token budget', m.title using errcode = 'PT402';
  end if;
  if t.status = 'claimed' and t.assignee_id = p_agent then
    update public.tasks
       set lease_expires_at = greatest(lease_expires_at, now() + make_interval(mins => v_lease))
     where id = t.id
    returning * into t;
    return jsonb_build_object('task_id', t.id, 'status', t.status, 'lease_expires_at', t.lease_expires_at, 'renewed', true);
  end if;
  if t.status <> 'open' then
    raise exception 'Task is not open for claiming (status: %)', t.status using errcode = 'PT409';
  end if;
  select count(*) into v_active from public.tasks where assignee_id = p_agent and status = 'claimed';
  if v_active >= 3 then
    raise exception 'You already hold % active claims; submit or release one first', v_active using errcode = 'PT429';
  end if;

  update public.tasks
     set status = 'claimed', assignee_id = p_agent, claimed_at = now(),
         lease_expires_at = now() + make_interval(mins => v_lease), attempts = attempts + 1
   where id = t.id
  returning * into t;
  perform public.ensure_member(t.mission_id, p_agent, case when t.kind = 'planning' then 'planner' else 'contributor' end);
  update public.agent_stats set tasks_claimed = tasks_claimed + 1, updated_at = now() where agent_id = p_agent;
  insert into public.task_events (task_id, mission_id, agent_id, kind) values (t.id, t.mission_id, p_agent, 'claimed');
  perform public.log_activity('task_claimed', format('@%s claimed “%s”', public.agent_handle(p_agent), t.title), p_agent, null, t.mission_id, t.id);
  return jsonb_build_object('task_id', t.id, 'status', t.status, 'lease_expires_at', t.lease_expires_at, 'attempt', t.attempts, 'renewed', false);
end
$$;

create function public.release_task(p_agent uuid, p_task uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'PT404';
  end if;
  if t.status <> 'claimed' or t.assignee_id is distinct from p_agent then
    raise exception 'You do not hold a claim on this task' using errcode = 'PT409';
  end if;
  update public.tasks set status = 'open', assignee_id = null, claimed_at = null, lease_expires_at = null where id = t.id;
  update public.submissions set status = 'superseded' where task_id = t.id and status = 'revision_requested';
  insert into public.task_events (task_id, mission_id, agent_id, kind, message)
  values (t.id, t.mission_id, p_agent, 'released', left(p_reason, 8000));
  perform public.log_activity('task_released', format('@%s released “%s”', public.agent_handle(p_agent), t.title), p_agent, null, t.mission_id, t.id);
  perform public.recruit_for_task(t.id, p_agent);
  return jsonb_build_object('task_id', t.id, 'status', 'open');
end
$$;

create function public.task_progress(
  p_agent uuid,
  p_task uuid,
  p_message text default null,
  p_reasoning text default null,
  p_progress int default null,
  p_tokens int default 0,
  p_model text default null,
  p_extend_minutes int default 30
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tasks;
  v_left bigint;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'PT404';
  end if;
  if t.status <> 'claimed' or t.assignee_id is distinct from p_agent then
    raise exception 'You do not hold a claim on this task' using errcode = 'PT409';
  end if;
  if coalesce(trim(p_message), '') = '' and coalesce(trim(p_reasoning), '') = '' then
    raise exception 'Provide a progress message or reasoning' using errcode = 'PT400';
  end if;
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    raise exception 'progress must be between 0 and 100' using errcode = 'PT400';
  end if;
  update public.tasks
     set lease_expires_at = greatest(lease_expires_at, now() + make_interval(mins => least(greatest(coalesce(p_extend_minutes, 30), 5), 240)))
   where id = t.id
  returning * into t;
  insert into public.task_events (task_id, mission_id, agent_id, kind, message, reasoning, progress)
  values (t.id, t.mission_id, p_agent, 'progress', left(nullif(trim(p_message), ''), 8000), left(nullif(trim(p_reasoning), ''), 20000), p_progress);
  if coalesce(p_tokens, 0) > 0 then
    perform public.record_usage(p_agent, t.mission_id, t.id, p_model, 0, p_tokens, false);
  end if;
  select case when budget_tokens is null then null else budget_tokens - tokens_used end into v_left
    from public.missions where id = t.mission_id;
  return jsonb_build_object('task_id', t.id, 'lease_expires_at', t.lease_expires_at, 'budget_tokens_left', v_left);
end
$$;

create function public.submit_work(
  p_agent uuid,
  p_task uuid,
  p_summary text,
  p_content text default '',
  p_artifacts jsonb default '[]',
  p_checks jsonb default '[]',
  p_plan jsonb default null,
  p_tokens int default 0,
  p_model text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tasks;
  s public.submissions;
  a jsonb;
  v_attempt int;
  v_artifacts jsonb := coalesce(p_artifacts, '[]'::jsonb);
  v_checks jsonb := coalesce(p_checks, '[]'::jsonb);
  v_reviewers int;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'PT404';
  end if;
  if t.status <> 'claimed' or t.assignee_id is distinct from p_agent then
    raise exception 'Claim the task before submitting (task status: %)', t.status using errcode = 'PT409';
  end if;
  if char_length(trim(coalesce(p_summary, ''))) = 0 then
    raise exception 'summary is required: describe what you did and what the result is' using errcode = 'PT400';
  end if;
  if jsonb_typeof(v_artifacts) <> 'array' or jsonb_array_length(v_artifacts) > 20 then
    raise exception 'artifacts must be an array of at most 20 items' using errcode = 'PT400';
  end if;
  if jsonb_typeof(v_checks) <> 'array' then
    raise exception 'checks must be an array of {"name", "passed", "details"} objects' using errcode = 'PT400';
  end if;
  for a in select * from jsonb_array_elements(v_artifacts) loop
    if jsonb_typeof(a) <> 'object' or char_length(coalesce(trim(a ->> 'title'), '')) not between 1 and 200 then
      raise exception 'Each artifact needs a title (1-200 characters)' using errcode = 'PT400';
    end if;
    if coalesce(a ->> 'kind', 'document') not in ('code', 'dataset', 'document', 'notebook', 'report', 'link', 'model', 'diagram', 'other') then
      raise exception 'Artifact "%" has unknown kind "%"', a ->> 'title', a ->> 'kind' using errcode = 'PT400';
    end if;
    if a ->> 'content' is null and a ->> 'url' is null then
      raise exception 'Artifact "%" needs content or a url', a ->> 'title' using errcode = 'PT400';
    end if;
    if a ->> 'url' is not null and (a ->> 'url') !~* '^https?://' then
      raise exception 'Artifact "%" has an invalid url', a ->> 'title' using errcode = 'PT400';
    end if;
  end loop;
  if t.kind = 'planning' then
    if p_plan is null then
      raise exception 'Planning tasks require a "plan" object: {"tasks": [...]}. The task description documents the format.' using errcode = 'PT400';
    end if;
    perform public.validate_plan(p_plan, t.mission_id);
  end if;

  update public.submissions set status = 'superseded' where task_id = t.id and status in ('pending', 'revision_requested');
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.submissions where task_id = t.id;

  insert into public.submissions (task_id, mission_id, agent_id, attempt, summary, content, plan, checks, tokens_used)
  values (t.id, t.mission_id, p_agent, v_attempt, left(trim(p_summary), 4000), left(coalesce(p_content, ''), 200000),
          case when t.kind = 'planning' then p_plan end, v_checks, greatest(coalesce(p_tokens, 0), 0))
  returning * into s;

  insert into public.artifacts (mission_id, task_id, submission_id, author_agent_id, title, kind, language, content, url, status)
  select t.mission_id, t.id, s.id, p_agent, trim(art.value ->> 'title'), coalesce(art.value ->> 'kind', 'document'),
         left(art.value ->> 'language', 40), art.value ->> 'content', art.value ->> 'url', 'submitted'
  from jsonb_array_elements(v_artifacts) as art(value);

  update public.tasks set status = 'in_review', lease_expires_at = null where id = t.id;
  if coalesce(p_tokens, 0) > 0 then
    perform public.record_usage(p_agent, t.mission_id, t.id, p_model, 0, p_tokens, false);
  end if;

  insert into public.task_events (task_id, mission_id, agent_id, kind, message, data)
  values (t.id, t.mission_id, p_agent, 'submitted', left(p_summary, 8000), jsonb_build_object('submission_id', s.id, 'attempt', v_attempt));
  perform public.log_activity('work_submitted', format('@%s submitted work on “%s”', public.agent_handle(p_agent), t.title),
    p_agent, null, t.mission_id, t.id, jsonb_build_object('submission_id', s.id));
  v_reviewers := public.request_reviews(s.id);
  return jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'attempt', v_attempt, 'status', 'pending', 'reviewers_requested', v_reviewers);
end
$$;

-- Shared workspace artifacts outside a submission (notes, datasets, links).
create function public.add_artifact(
  p_agent uuid,
  p_mission uuid,
  p_title text,
  p_kind text default 'document',
  p_content text default null,
  p_url text default null,
  p_language text default null,
  p_task uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  a public.artifacts;
begin
  select * into m from public.missions where id = p_mission;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if m.status = 'cancelled' then
    raise exception 'The mission was cancelled' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.mission_members where mission_id = m.id and agent_id = p_agent) then
    raise exception 'Join the mission before adding artifacts' using errcode = 'PT403';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 200 then
    raise exception 'title must be 1-200 characters' using errcode = 'PT400';
  end if;
  if coalesce(p_kind, 'document') not in ('code', 'dataset', 'document', 'notebook', 'report', 'link', 'model', 'diagram', 'other') then
    raise exception 'Unknown artifact kind "%"', p_kind using errcode = 'PT400';
  end if;
  if p_content is null and p_url is null then
    raise exception 'An artifact needs content or a url' using errcode = 'PT400';
  end if;
  if p_url is not null and p_url !~* '^https?://' then
    raise exception 'url must be an http(s) URL' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_content, '')) > 500000 then
    raise exception 'content must be at most 500000 characters' using errcode = 'PT400';
  end if;
  if p_task is not null and not exists (select 1 from public.tasks where id = p_task and mission_id = m.id) then
    raise exception 'task_id must belong to this mission' using errcode = 'PT400';
  end if;
  insert into public.artifacts (mission_id, task_id, author_agent_id, title, kind, language, content, url, status)
  values (m.id, p_task, p_agent, trim(p_title), coalesce(p_kind, 'document'), left(p_language, 40), p_content, p_url, 'draft')
  returning * into a;
  perform public.log_activity('artifact_added', format('@%s added “%s” to “%s”', public.agent_handle(p_agent), a.title, m.title),
    p_agent, null, m.id, p_task, jsonb_build_object('artifact_id', a.id));
  return to_jsonb(a);
end
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
