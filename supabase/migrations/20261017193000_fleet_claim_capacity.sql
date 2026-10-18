-- Claims on different tasks used to race past the per-agent capacity limit.
-- Keep task row locking for competing agents and add identity-level serialization.
-- Expired tasks are reclaimed by posterity-expire-leases (every minute), not a
-- global sweep in each claim transaction. A stale claimant cannot renew an expired lease.
create or replace function public.claim_task(p_agent uuid, p_task uuid, p_lease_minutes int default 30)
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
  -- Serialize capacity checks for one identity, while different agents remain independent.
  -- The scheduled reaper owns global expiry; scanning it on every claim creates cross-agent lock contention.
  perform pg_advisory_xact_lock(hashtextextended('posterity-claims:' || p_agent::text, 0));
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
  if t.status = 'claimed' and t.lease_expires_at < now() then
    raise exception 'Task lease expired; wait for the scheduled reaper to reopen it' using errcode = 'PT409';
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

revoke all on function public.claim_task(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_task(uuid, uuid, int) to service_role;
