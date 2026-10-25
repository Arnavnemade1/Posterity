-- Fence private work across public-role replacement and concurrent context edits.
-- Renewal alone does not change context; new memberships and changed objectives do.
alter table public.missions add column swarm_revision bigint not null default 0;
create function public.hive_mission_revision() returns trigger language plpgsql set search_path='' as $$
begin
 new.swarm_revision:=old.swarm_revision+case when new.objective is distinct from old.objective then 1 else 0 end;
 return new;
end $$;
create trigger hive_mission_context_revision before update on public.missions
 for each row execute function public.hive_mission_revision();
revoke all on function public.hive_mission_revision() from public,anon,authenticated,service_role;

create or replace function public.hive_task_context(p_task uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('task_id',t.id,'title',t.title,'objective',m.objective,'description',t.description,'acceptance_criteria',t.acceptance_criteria,
  'status',t.status,'attempt',t.attempts,'assignee_id',t.assignee_id,'ensemble_id',en.id,'round',en.round,
  'task_hash',encode(extensions.digest(jsonb_build_array(t.id,t.swarm_revision,m.swarm_revision,t.description,m.objective,t.attempts,t.assignee_id,t.acceptance_criteria,t.required_capabilities,en.round,en.spec,
    (select jsonb_agg(jsonb_build_array(em.id,em.agent_id,em.role,em.state) order by em.id) from public.ensemble_members em where em.ensemble_id=en.id))::text,'sha256'),'hex'),
  'public_activity',encode(extensions.digest(jsonb_build_array(t.status,
    (select max(id) from public.task_events where task_id=t.id),
    (select count(*) from public.ensemble_contributions where ensemble_id=en.id and round=en.round),
    (select jsonb_agg(jsonb_build_array(s.contribution_id,s.scorer_id,s.score,md5(s.rationale)) order by s.contribution_id,s.scorer_id) from public.ensemble_scores s join public.ensemble_contributions c on c.id=s.contribution_id where c.ensemble_id=en.id and c.round=en.round),
    (select max(a.sequence) from public.ensemble_admissibility a join public.ensemble_contributions c on c.id=a.contribution_id where c.ensemble_id=en.id and c.round=en.round),
    (select jsonb_agg(jsonb_build_array(em.id,em.state,c.digest,c.revealed_at) order by em.id) from public.ensemble_members em left join public.ensemble_commitments c on c.member_id=em.id and c.round=en.round where em.ensemble_id=en.id))::text,'sha256'),'hex'),
  'dependencies',(select coalesce(jsonb_agg(jsonb_build_object('task_id',d.id,'title',d.title,'status',d.status,'accepted_submission_id',d.accepted_submission_id)),'[]') from public.task_dependencies td join public.tasks d on d.id=td.depends_on where td.task_id=t.id),
  'phase',case when t.status in('done','cancelled','failed') then 'settled' when en.id is null then 'work' when
    (select count(*) from public.ensemble_members where ensemble_id=en.id and state='active' and lease_expires_at>now())<jsonb_array_length(en.spec->'roles') then 'fill_roles'
    when not public.ensemble_is_sealed(en.id) then 'legible_collaboration'
    when exists(select 1 from public.ensemble_members em where em.ensemble_id=en.id and em.state='active' and not exists(select 1 from public.ensemble_commitments c where c.member_id=em.id and c.round=en.round)) then 'commit'
    when exists(select 1 from public.ensemble_commitments c where c.ensemble_id=en.id and c.round=en.round and c.revealed_at is null) then 'reveal' else 'deliberate' end,
  'roster',(select coalesce(jsonb_agg(jsonb_build_object('agent_id',em.agent_id,'role',em.role,'state',em.state,'lease_expires_at',em.lease_expires_at,
    'committed',exists(select 1 from public.ensemble_commitments c where c.member_id=em.id and c.round=en.round),
    'revealed',exists(select 1 from public.ensemble_commitments c where c.member_id=em.id and c.round=en.round and c.revealed_at is not null))),'[]') from public.ensemble_members em where em.ensemble_id=en.id),
  'assurance','L1 private deliberation only; one hive remains one public party; publish L2 evidence through accountable sealed contributions')
 from public.tasks t join public.missions m on m.id=t.mission_id left join public.ensembles en on en.task_id=t.id where t.id=p_task
$$;

-- Public engine paths lock the task before opening an ensemble and lock the
-- ensemble before changing its roster. Hold both through the private write.
-- NOWAIT makes conflicts retryable without introducing an opposing lock wait
-- against public submission, cancellation, heartbeat or owner-pause operations.
alter function public.hive_swarm_write(uuid,uuid,text,jsonb,uuid,text,bigint) rename to hive_swarm_write_v15_2;
create function public.hive_swarm_write(p_agent uuid,p_task uuid,p_action text,p_payload jsonb,p_client uuid,p_task_hash text,p_expected bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mission uuid;
begin
 select t.mission_id into mission from public.tasks t where t.id=p_task for share nowait;
 perform 1 from public.ensembles e where e.task_id=p_task for share nowait;
 perform 1 from public.missions m where m.id=mission for share nowait;
 perform 1 from public.agents a where a.id=p_agent for share nowait;
 return public.hive_swarm_write_v15_2(p_agent,p_task,p_action,p_payload,p_client,p_task_hash,p_expected);
exception when lock_not_available then
 raise exception 'Public task context is changing; sync and retry the private action with the same client UUID' using errcode='PT409';
end $$;
revoke all on function public.hive_swarm_write_v15_2(uuid,uuid,text,jsonb,uuid,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.hive_swarm_write(uuid,uuid,text,jsonb,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.hive_swarm_write(uuid,uuid,text,jsonb,uuid,text,bigint) to service_role;

create or replace function public.hive_swarm_sync(p_agent uuid,p_task uuid,p_after bigint default 0,p_spaces text[] default '{}',p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hive uuid; room public.hive_task_rooms; context jsonb; events jsonb; cursor_ bigint; writable boolean:=true;
begin
 hive:=public.hive_task_access(p_agent,p_task,false);
 begin
  perform public.hive_task_access(p_agent,p_task,true);
 exception when sqlstate 'PT403' then writable:=false;
 end;
 if p_after<0 or coalesce(array_length(p_spaces,1),0)>16 or p_limit not between 1 and 100 then raise exception 'Bounded cursor, vector spaces and page required' using errcode='PT400';end if;
 select * into room from public.hive_task_rooms where task_id=p_task and hive_id=hive for share;
 if p_after>coalesce(room.sequence,0) then raise exception 'Cursor is ahead of this private room; restart from its current head' using errcode='PT409';end if;
 context:=public.hive_task_context(p_task);
 select coalesce(jsonb_agg(jsonb_build_object('sequence',e.sequence,'agent_id',e.agent_id,'action',e.action,'task_hash',e.task_hash,'created_at',e.created_at,
   'context_stale',e.task_hash is distinct from context->>'task_hash',
   'compatible',case when e.result->>'kind'='vector' then coalesce(e.result->'vector'->>'space'=any(p_spaces),false) and e.task_hash=(context->>'task_hash') else true end,
   'result',case when e.result->>'kind'='vector' and (not coalesce(e.result->'vector'->>'space'=any(p_spaces),false) or e.task_hash is distinct from context->>'task_hash') then
      (e.result-'vector')||jsonb_build_object('vector',(e.result->'vector')-'data','delivery',case when e.task_hash is distinct from context->>'task_hash' then 'stale_context; explicitly rebase before reusing vector state' else 'incompatible_space; request a text summary or an explicit adapter' end) else e.result end) order by e.sequence),'[]'),coalesce(max(e.sequence),p_after)
  into events,cursor_ from (select * from public.hive_task_events where task_id=p_task and hive_id=hive and sequence>p_after order by sequence limit p_limit) e;
 return jsonb_build_object('scope','private_intra_hive','hive_id',hive,'writable',writable,'context',context,'version',coalesce(room.version,0),'state',coalesce(room.state,'{}'),
  'state_stale',room.state_task_hash is not null and room.state_task_hash is distinct from context->>'task_hash','events',events,'next_cursor',cursor_,'head',coalesce(room.sequence,0),'has_more',cursor_<coalesce(room.sequence,0),
  'leases',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('active',l.until_at>now() and l.task_hash=context->>'task_hash') order by l.work_key),'[]') from public.hive_task_leases l where task_id=p_task and hive_id=hive),
  'peers',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('online',p.seen_at>now()-interval '45 seconds') order by p.agent_id),'[]') from public.hive_task_presence p where task_id=p_task and hive_id=hive));
end $$;

-- Spend the bounded maintenance budget on the caller's own roles first, then
-- expired roles. Old empty recruiting rooms must not starve either category.
create or replace function public.agent_ensemble_inbox(p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; offer record; v_authorization jsonb; assignments jsonb; offers jsonb;
begin
  if not exists(select 1 from public.agent_manifests where agent_id=p_agent) then
    return jsonb_build_object('assignments','[]'::jsonb,'offers','[]'::jsonb,'manifest_required',true);
  end if;
  -- Recover a bounded number of stalled ensembles without blocking other heartbeat workers.
  for candidate in select x.id from public.ensembles x where x.status in ('recruiting','active') and
    (exists(select 1 from public.ensemble_members em where em.ensemble_id=x.id and em.state='active' and
      (em.agent_id=p_agent or em.lease_expires_at<=now())) or x.status='recruiting')
    order by
      exists(select 1 from public.ensemble_members em where em.ensemble_id=x.id and em.agent_id=p_agent and em.state='active') desc,
      exists(select 1 from public.ensemble_members em where em.ensemble_id=x.id and em.state='active' and em.lease_expires_at<=now()) desc,
      x.created_at,x.id limit 32 for update skip locked loop
    perform public.ensemble_refresh(candidate.id);
  end loop;
  -- Returning agents renew only live leases; expired slots were already released above.
  update public.ensemble_members m set lease_expires_at=now()+interval '60 minutes'
    where m.agent_id=p_agent and m.state='active' and m.lease_expires_at>now() and
      exists(select 1 from public.ensembles e where e.id=m.ensemble_id and e.status in ('recruiting','active'))
      and public.ensemble_role_fits(p_agent,m.ensemble_id,m.role);
  if exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null and availability='available') then
    for offer in
      select x.id,r->>'role' as role from public.ensembles x join public.tasks t on t.id=x.task_id
      cross join lateral jsonb_array_elements(x.spec->'roles') r
      where x.status in ('active','recruiting') and t.status in ('open','claimed')
        and not exists(select 1 from public.ensemble_members where ensemble_id=x.id and state='active' and (agent_id=p_agent or role=r->>'role'))
        and public.ensemble_role_fits(p_agent,x.id,r->>'role')
      order by t.priority desc,x.created_at,case r->>'role' when 'proposer' then 1 when 'critic' then 2 when 'specialist' then 3 else 4 end limit 10
    loop
      begin
        v_authorization:=public.authorize_standing_action(p_agent,'tasks.claim',jsonb_build_object('action','join','ensemble_id',offer.id,'role',offer.role),'Join ensemble '||offer.id||' as '||offer.role);
        if v_authorization->>'decision'='allow' then perform public.ensemble_join(p_agent,offer.id,offer.role); end if;
        exit;
      exception when sqlstate 'PT409' then null; when sqlstate 'PT429' then exit;
      end;
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('ensemble_id',e.id,'task_id',e.task_id,'title',t.title,'role',m.role,'status',e.status,'round',e.round,'lease_expires_at',m.lease_expires_at,
    'contributions',(select count(*) from public.ensemble_contributions where ensemble_id=e.id and round=e.round))),'[]') into assignments
    from public.ensemble_members m join public.ensembles e on e.id=m.ensemble_id join public.tasks t on t.id=e.task_id
    where m.agent_id=p_agent and m.state='active' and e.status in ('recruiting','active','in_review');
  select coalesce(jsonb_agg(to_jsonb(v)),'[]') into offers from (
    select e.id as ensemble_id,e.task_id,r->>'role' as role from public.ensembles e cross join lateral jsonb_array_elements(e.spec->'roles') r
    where e.status in ('active','recruiting') and public.ensemble_role_fits(p_agent,e.id,r->>'role')
      and not exists(select 1 from public.ensemble_members where ensemble_id=e.id and state='active' and (agent_id=p_agent or role=r->>'role'))
    order by e.created_at limit 10) v;
  return jsonb_build_object('assignments',assignments,'offers',offers,'manifest_required',not exists(select 1 from public.agent_manifests where agent_id=p_agent));
end $$;

notify pgrst,'reload schema';
