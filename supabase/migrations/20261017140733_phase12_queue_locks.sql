-- Phase 12: merge queues without deadlocks.
--
-- A queue run takes the queue's lock, then changes change request rows (refreshing those aimed at the
-- branch it moved, marking one landed). Reviews, checks, merges and the code worker's refreshes hold a
-- change request's row first. So that the two never wait on each other, only queue runs wait for a
-- queue's lock: everything else tries it and moves on when another run holds it, and the API (or the
-- sweep, every minute) then moves the queue along in a call of its own. Merging a change request no
-- longer locks a branch that has a queue.

-- Move a queue along if nobody else is: true when it ran.
create function public.ws_queue_try(p_ws uuid, p_target text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('posterity-queue:' || p_ws || ':' || p_target, 0)) then
    return false;
  end if;
  perform public.ws_queue_process(p_ws, p_target);
  return true;
end
$$;

-- Move every queue of a workspace along, waiting for each in turn (in one order, so two of these never
-- wait on each other). Call it on its own, holding nothing else.
create function public.ws_queue_kick(p_ws uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target text;
  v_res jsonb := '{}'::jsonb;
begin
  for v_target in select distinct target_branch from public.merge_queue
                   where workspace_id = p_ws and status in ('waiting', 'queued', 'testing')
                   order by target_branch loop
    v_res := v_res || jsonb_build_object(v_target, public.ws_queue_process(p_ws, v_target));
  end loop;
  return v_res;
end
$$;

-- Put a change request in its target's queue. It waits while its requirements are unmet, lines up once
-- they are met, and lands in order. p_system: verified work (no approvals needed). Without p_method,
-- the branch's first merge method.
create or replace function public.cr_enqueue(p_cr uuid, p_agent uuid, p_method text default null, p_system boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  b public.branches;
  v_id bigint;
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
begin
  select * into cr from public.change_requests where id = p_cr;
  if not found then
    raise exception 'Change request not found' using errcode = 'PT404';
  end if;
  if v_method is not null and v_method not in ('merge', 'squash', 'rebase') then
    raise exception 'method must be merge, squash or rebase' using errcode = 'PT400';
  end if;
  if p_agent is not null then
    perform public.ws_assert_read(cr.workspace_id, p_agent);
    if public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 2 and p_agent is distinct from cr.author_agent_id then
      raise exception 'Only the author and writers can queue a change request' using errcode = 'PT403';
    end if;
  end if;
  if cr.status = 'draft' then
    raise exception 'Change request #% is a draft; mark it ready first', cr.number using errcode = 'PT409';
  end if;
  if cr.status <> 'open' then
    raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
  end if;
  select * into b from public.branches where workspace_id = cr.workspace_id and name = cr.target_branch;
  if not found then
    raise exception 'The target branch "%" no longer exists', cr.target_branch using errcode = 'PT409';
  end if;
  v_method := coalesce(v_method, b.merge_methods[1]);
  if not (v_method = any (b.merge_methods)) then
    if coalesce(p_system, false) then
      v_method := b.merge_methods[1];
    else
      raise exception '"%" takes % merges', b.name, array_to_string(b.merge_methods, ' or ') using errcode = 'PT409';
    end if;
  end if;
  select id into v_id from public.merge_queue where change_request_id = p_cr and status in ('waiting', 'queued', 'testing');
  if v_id is null then
    insert into public.merge_queue (workspace_id, target_branch, change_request_id, method, system, enqueued_by)
    values (cr.workspace_id, cr.target_branch, p_cr, v_method, coalesce(p_system, false), p_agent)
    returning id into v_id;
  else
    update public.merge_queue set method = v_method, system = system or coalesce(p_system, false), updated_at = now()
     where id = v_id;
  end if;
  perform public.ws_queue_try(cr.workspace_id, cr.target_branch);
  return public.cr_queue_json(v_id);
end
$$;

create or replace function public.cr_dequeue(p_cr uuid, p_agent uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  q public.merge_queue;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into q from public.merge_queue where change_request_id = p_cr and status in ('waiting', 'queued', 'testing');
  if not found then
    raise exception 'Change request #% is not in a merge queue', cr.number using errcode = 'PT404';
  end if;
  perform public.ws_assert_read(cr.workspace_id, p_agent);
  if p_agent is distinct from cr.author_agent_id and p_agent is distinct from q.enqueued_by
     and public.ws_rank(public.ws_role(cr.workspace_id, p_agent)) < 3 then
    raise exception 'Only the author, whoever queued it, or a maintainer can take it out of the queue' using errcode = 'PT403';
  end if;
  perform public.ws_queue_finish(q.id, 'cancelled', coalesce(nullif(btrim(p_reason), ''), format('Taken out by @%s', public.ws_handle(p_agent))));
  perform public.ws_queue_try(cr.workspace_id, cr.target_branch);
  return public.cr_queue_json(q.id);
end
$$;

-- Move the queue a change request is in, if it is in one and nobody else is moving it; never fails or
-- waits.
create or replace function public.ws_queue_touch(p_cr uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.merge_queue;
begin
  select * into q from public.merge_queue where change_request_id = p_cr and status in ('waiting', 'queued', 'testing');
  if found then
    begin
      perform public.ws_queue_try(q.workspace_id, q.target_branch);
    exception when others then
      raise warning 'ws_queue_touch %: %', p_cr, sqlerrm;
    end;
  end if;
end
$$;

-- After the worker stored results: refresh what waited on it, move stacks and queues along.
create or replace function public.code_after(p_workspaces uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  r record;
  n int := 0;
begin
  for v in select id from public.change_requests
            where workspace_id = any (coalesce(p_workspaces, '{}')) and status in ('draft', 'open')
              and (mergeable is null or needs_refresh)
            order by updated_at limit 50 loop
    begin
      perform public.cr_refresh(v);
      n := n + 1;
    exception when others then
      raise warning 'code_after refresh %: %', v, sqlerrm;
    end;
  end loop;
  for v in select id from public.change_requests
            where workspace_id = any (coalesce(p_workspaces, '{}')) and restack_from is not null and status in ('draft', 'open') loop
    begin
      perform public.cr_restack_one(v);
    exception when others then
      raise warning 'code_after restack %: %', v, sqlerrm;
    end;
  end loop;
  for r in select distinct workspace_id, target_branch from public.merge_queue
            where workspace_id = any (coalesce(p_workspaces, '{}')) and status in ('waiting', 'queued', 'testing') loop
    begin
      perform public.ws_queue_try(r.workspace_id, r.target_branch);
    exception when others then
      raise warning 'code_after queue %/%: %', r.workspace_id, r.target_branch, sqlerrm;
    end;
  end loop;
  return n;
end
$$;

-- Every minute: queues, stale change requests, stacks to move, verified work waiting on line merges,
-- and the worker's jobs.
create or replace function public.code_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  r record;
begin
  -- Queues first, while this transaction holds no change request rows: a queue's lock always comes
  -- before the rows it changes.
  for r in select distinct workspace_id, target_branch from public.merge_queue
            where status in ('waiting', 'queued', 'testing')
            order by workspace_id, target_branch limit 20 loop
    begin
      perform public.ws_queue_process(r.workspace_id, r.target_branch);
    exception when others then
      raise warning 'code_sweep queue %/%: %', r.workspace_id, r.target_branch, sqlerrm;
    end;
  end loop;
  for v in select id from public.change_requests where needs_refresh and status in ('draft', 'open')
            order by updated_at limit 25 loop
    begin
      perform public.cr_refresh(v);
    exception when others then
      raise warning 'code_sweep refresh %: %', v, sqlerrm;
    end;
  end loop;
  for v in select id from public.change_requests where restack_from is not null and status in ('draft', 'open')
            order by updated_at limit 10 loop
    begin
      perform public.cr_restack_one(v);
    exception when others then
      raise warning 'code_sweep restack %: %', v, sqlerrm;
    end;
  end loop;
  for v in select cr.id from public.change_requests cr
            where cr.status = 'open' and cr.verified_at is not null and cr.mergeable is true
              and exists (select 1 from public.submissions s where s.id = cr.submission_id and s.commit_id = cr.head_commit)
              and not exists (select 1 from public.merge_queue q where q.change_request_id = cr.id and q.status in ('waiting', 'queued', 'testing'))
            order by cr.updated_at limit 10 loop
    begin
      perform public.merge_change_request(v, null, null, null, true);
    exception when others then
      raise warning 'code_sweep merge %: %', v, sqlerrm;
    end;
  end loop;
  if exists (select 1 from public.merge_jobs where locked_until is null or locked_until < now()) then
    perform public.kick_code_worker();
  end if;
end
$$;

-- Merge a change request, by its target's rules. A branch with a merge queue takes it into the queue
-- instead (status "queued" or "waiting", with why). p_agent null is the system merging verified work:
-- peer review of the submission stands in for change request approvals. Without p_method (and for the
-- system, when the branch does not take it) the branch's first merge method is used.
create or replace function public.merge_change_request(p_cr uuid, p_agent uuid, p_message text default null, p_method text default null,
                                                       p_pending_ok boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  b public.branches;
  v_src text;
  v_reasons text[];
  v_land jsonb;
  v_entry jsonb;
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'Change request not found' using errcode = 'PT404';
  end if;
  select * into w from public.workspaces where id = cr.workspace_id;
  if p_agent is not null then
    perform public.ws_assert_read(w.id, p_agent);
    if public.ws_rank(public.ws_role(w.id, p_agent)) < 2 then
      raise exception 'Only writers of % can merge change requests', w.slug using errcode = 'PT403';
    end if;
  end if;
  if v_method is not null and v_method not in ('merge', 'squash', 'rebase') then
    raise exception 'method must be merge, squash or rebase' using errcode = 'PT400';
  end if;
  if cr.status = 'draft' then
    raise exception 'Change request #% is a draft; mark it ready first', cr.number using errcode = 'PT409';
  end if;
  if cr.status <> 'open' then
    raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
  end if;
  perform public.cr_refresh(p_cr);
  select * into cr from public.change_requests where id = p_cr;
  if cr.status = 'merged' then
    return public.cr_json(p_cr);
  end if;
  -- A branch with a queue is never locked here: its queue run takes the queue's lock first, then the
  -- branch and the change requests.
  select * into b from public.branches where workspace_id = w.id and name = cr.target_branch;
  select head into v_src from public.branches where workspace_id = w.id and name = cr.source_branch;
  if b.head is null or v_src is null then
    raise exception 'A branch of this change request no longer exists' using errcode = 'PT409';
  end if;
  if v_method is null or (p_agent is null and not v_method = any (b.merge_methods)) then
    v_method := b.merge_methods[1];
  end if;
  if b.merge_queue then
    v_entry := public.cr_enqueue(p_cr, p_agent, v_method, p_agent is null);
    return public.cr_json(p_cr) || jsonb_build_object('status', 'queued', 'queue', v_entry);
  end if;
  select * into b from public.branches where workspace_id = w.id and name = cr.target_branch for update;
  v_reasons := public.cr_merge_blockers(p_cr, p_agent, false, v_method);
  if cardinality(v_reasons) > 0 then
    raise exception '%', v_reasons[1] using errcode = 'PT409', detail = jsonb_build_object('blocked', to_jsonb(v_reasons))::text;
  end if;
  v_land := public.cr_land(p_cr, p_agent, p_message, v_method, p_pending_ok);
  if v_land ->> 'status' = 'pending' then
    return public.cr_json(p_cr) || jsonb_build_object('status', 'pending', 'pending', v_land -> 'pending');
  end if;
  return public.cr_json(p_cr) || jsonb_build_object('fast_forward', (v_land ->> 'fast_forward')::boolean);
end
$$;

revoke execute on function public.ws_queue_try(uuid, text), public.ws_queue_kick(uuid) from public, anon, authenticated;
grant execute on function public.ws_queue_try(uuid, text), public.ws_queue_kick(uuid) to service_role;
