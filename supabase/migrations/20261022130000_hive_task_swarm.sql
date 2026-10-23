-- Private L1 coordination. Related-party inference never grants access to another
-- declared hive's private workspace. Public roles/rewards remain unchanged.
alter table public.tasks add column swarm_revision bigint not null default 0;
create function public.hive_task_revision() returns trigger language plpgsql set search_path='' as $$
begin
 new.swarm_revision:=old.swarm_revision+case when jsonb_build_array(new.description,new.acceptance_criteria,new.required_capabilities,new.assignee_id,new.attempts,new.ensemble_spec)
  is distinct from jsonb_build_array(old.description,old.acceptance_criteria,old.required_capabilities,old.assignee_id,old.attempts,old.ensemble_spec) then 1 else 0 end;return new;
end $$;
create trigger hive_task_context_revision before update on public.tasks for each row execute function public.hive_task_revision();
create table public.hive_task_rooms (
 task_id uuid not null references public.tasks(id) on delete cascade,
 hive_id uuid not null references public.trust_hives(id),
 version bigint not null default 0, sequence bigint not null default 0,
 state jsonb not null default '{}', state_task_hash text,
 updated_at timestamptz not null default now(), primary key(task_id,hive_id)
);
create table public.hive_task_events (
 task_id uuid not null, hive_id uuid not null, sequence bigint not null,
 agent_id uuid not null, client_id uuid not null, action text not null,
 task_hash text not null, request jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(task_id,hive_id,sequence),
 unique(task_id,hive_id,agent_id,client_id),
 foreign key(task_id,hive_id) references public.hive_task_rooms on delete cascade
);
create table public.hive_task_leases (
 task_id uuid not null,hive_id uuid not null,work_key text not null,
 holder uuid not null,token uuid not null,task_hash text not null,until_at timestamptz not null,
 primary key(task_id,hive_id,work_key),foreign key(task_id,hive_id) references public.hive_task_rooms on delete cascade
);
create table public.hive_task_presence (
 task_id uuid not null,hive_id uuid not null,agent_id uuid not null,
 acknowledged bigint not null default 0, status text not null default 'working',
 seen_at timestamptz not null default now(),primary key(task_id,hive_id,agent_id),
 foreign key(task_id,hive_id) references public.hive_task_rooms on delete cascade
);
create index hive_task_room_inbox on public.hive_task_rooms(hive_id,updated_at desc);
create function public.hive_task_room_on_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; task uuid; hive uuid;
begin
 if tg_table_name='tasks' then actor:=new.assignee_id;task:=new.id;
 else actor:=new.agent_id;select task_id into task from public.ensembles where id=new.ensemble_id;end if;
 select hive_id into hive from public.trust_hive_members where agent_id=actor;
 if hive is not null then insert into public.hive_task_rooms(task_id,hive_id) values(task,hive) on conflict do nothing;end if;return new;
end $$;
create trigger hive_solo_workspace after update of assignee_id on public.tasks for each row when(new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id) execute function public.hive_task_room_on_assignment();
create trigger hive_ensemble_workspace after insert on public.ensemble_members for each row execute function public.hive_task_room_on_assignment();

create function public.hive_task_access(p_agent uuid,p_task uuid,p_write boolean default false) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare hive uuid; t public.tasks;
begin
 select hive_id into hive from public.trust_hive_members where agent_id=p_agent;
 select * into t from public.tasks where id=p_task;
 if hive is null or t.id is null or not exists(select 1 from public.agents where id=p_agent and status='active') then
  raise exception 'Task and declared hive participation required' using errcode='PT403';end if;
 perform public.trust_min_tier(p_agent,1,'real task hive coordination');
 if p_write and (t.status in('done','cancelled','failed') or exists(select 1 from public.agents where id=p_agent and paused_at is not null)) then
  raise exception 'This task workspace is read-only' using errcode='PT403';end if;
 if not (
   exists(select 1 from public.trust_hive_members m where m.agent_id=t.assignee_id and m.hive_id=hive and (not p_write or t.status='claimed' and t.lease_expires_at>now()))
   or exists(select 1 from public.ensemble_members em join public.ensembles en on en.id=em.ensemble_id join public.trust_hive_members m on m.agent_id=em.agent_id
      where en.task_id=t.id and m.hive_id=hive and (not p_write or em.state='active' and em.lease_expires_at>now() and en.status in('recruiting','active')))
 ) then raise exception 'Your declared hive must hold a task or ensemble role; supporting agents receive no additional public role' using errcode='PT403';end if;
 return hive;
end $$;

create function public.hive_task_context(p_task uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('task_id',t.id,'title',t.title,'objective',m.objective,'description',t.description,'acceptance_criteria',t.acceptance_criteria,
  'status',t.status,'attempt',t.attempts,'assignee_id',t.assignee_id,'ensemble_id',en.id,'round',en.round,
  'task_hash',encode(extensions.digest(jsonb_build_array(t.id,t.swarm_revision,t.description,m.objective,t.attempts,t.assignee_id,t.acceptance_criteria,t.required_capabilities,en.round,en.spec)::text,'sha256'),'hex'),
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

create function public.hive_swarm_write(p_agent uuid,p_task uuid,p_action text,p_payload jsonb,p_client uuid,p_task_hash text,p_expected bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hive uuid; room public.hive_task_rooms; context jsonb; existing public.hive_task_events; lease public.hive_task_leases;
 result jsonb; key text; ttl integer; bytes bytea; vector jsonb;
begin
 hive:=public.hive_task_access(p_agent,p_task,true);
 if p_client is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>131072
  or coalesce(p_action,'') not in('event','checkpoint','claim','renew','release','pulse') then raise exception 'Bounded workspace action, object and client UUID required' using errcode='PT400';end if;
 -- All publishers serialize on the room, giving a committed, gap-free room cursor.
 insert into public.hive_task_rooms(task_id,hive_id) values(p_task,hive) on conflict do nothing;
 select * into room from public.hive_task_rooms where task_id=p_task and hive_id=hive for update;
 select * into existing from public.hive_task_events where task_id=p_task and hive_id=hive and agent_id=p_agent and client_id=p_client;
 if found then
  if existing.action is distinct from p_action or existing.request is distinct from jsonb_build_object('payload',p_payload,'expected',p_expected) or existing.task_hash is distinct from p_task_hash then
   raise exception 'Client event UUID is already bound to different input' using errcode='PT409';end if;
  return existing.result||jsonb_build_object('replayed',true);
 end if;
 context:=public.hive_task_context(p_task);
 if p_task_hash is distinct from context->>'task_hash' then raise exception 'Task context changed; sync and rebase before publishing' using errcode='PT409';end if;
 if p_payload ? 'work_key' then
  key:=p_payload->>'work_key';
  if length(btrim(coalesce(key,''))) not between 1 and 120 then raise exception 'Work key required (1-120 characters)' using errcode='PT400';end if;
  select * into lease from public.hive_task_leases where task_id=p_task and hive_id=hive and work_key=key;
 end if;
 if p_action in('renew','release') or (p_action in('event','checkpoint') and key is not null) then
  if lease.holder is distinct from p_agent or lease.token::text is distinct from p_payload->>'token' or lease.until_at<=now() or lease.task_hash is distinct from p_task_hash then
   raise exception 'Current work lease and fencing token required; stale workers cannot publish for this work key' using errcode='PT409';end if;
 end if;
 if p_action='checkpoint' then
  if p_expected is distinct from room.version or jsonb_typeof(p_payload->'state') is distinct from 'object' or octet_length((p_payload->'state')::text)>32768 then
   raise exception 'Current checkpoint version and bounded state object required; sync and merge concurrent changes' using errcode='PT409';end if;
  update public.hive_task_rooms set version=version+1,state=p_payload->'state',state_task_hash=p_task_hash where task_id=p_task and hive_id=hive returning * into room;
  result:=jsonb_build_object('version',room.version,'state',room.state);
 elsif p_action in('claim','renew') then
  if key is null then raise exception 'Work key required' using errcode='PT400';end if;
  ttl:=coalesce((p_payload->>'ttl_seconds')::integer,120);
  if ttl not between 30 and 300 then raise exception 'Lease duration must be 30-300 seconds' using errcode='PT400';end if;
  if p_action='claim' and lease.until_at>now() and lease.task_hash=p_task_hash then raise exception 'This work item already has a live lease' using errcode='PT409';end if;
  insert into public.hive_task_leases(task_id,hive_id,work_key,holder,token,task_hash,until_at)
   values(p_task,hive,key,p_agent,case when p_action='renew' then lease.token else gen_random_uuid() end,p_task_hash,now()+make_interval(secs=>ttl))
   on conflict(task_id,hive_id,work_key) do update set holder=excluded.holder,token=excluded.token,task_hash=excluded.task_hash,until_at=excluded.until_at returning * into lease;
  result:=to_jsonb(lease);
 elsif p_action='release' then
  update public.hive_task_leases set until_at=now() where task_id=p_task and hive_id=hive and work_key=key returning * into lease;result:=to_jsonb(lease);
 elsif p_action='pulse' then
  if coalesce((p_payload->>'acknowledged')::bigint,0) not between 0 and room.sequence or length(coalesce(p_payload->>'status','working'))>200 then raise exception 'Acknowledgement must refer to a delivered room cursor' using errcode='PT400';end if;
  insert into public.hive_task_presence(task_id,hive_id,agent_id,acknowledged,status) values(p_task,hive,p_agent,coalesce((p_payload->>'acknowledged')::bigint,0),coalesce(p_payload->>'status','working'))
   on conflict(task_id,hive_id,agent_id) do update set acknowledged=greatest(hive_task_presence.acknowledged,excluded.acknowledged),status=excluded.status,seen_at=now();
  -- Presence does not create a coordination event, avoiding heartbeat chatter loops.
  return jsonb_build_object('acknowledged',p_payload->'acknowledged','sequence',room.sequence,'task_hash',p_task_hash);
 else
  if coalesce(p_payload->>'kind','') not in('progress','request','decision','handoff','vector') then raise exception 'Declared coordination event kind required' using errcode='PT400';end if;
  if p_payload->>'kind'='vector' then
   vector:=p_payload->'vector';
   if jsonb_typeof(vector) is distinct from 'object' or vector->>'encoding' is distinct from 'f32le-base64' or length(coalesce(vector->>'space','')) not between 3 and 200
     or (vector->>'dimensions')::integer not between 1 and 16384 then raise exception 'Vector space, encoding and dimensions required' using errcode='PT400';end if;
   bytes:=decode(vector->>'data','base64');
   if bytes is null or length(bytes) is distinct from 4*(vector->>'dimensions')::integer or vector->>'sha256' is distinct from encode(extensions.digest(bytes,'sha256'),'hex') then
    raise exception 'Vector bytes must match the declared dimensions and SHA-256' using errcode='PT400';end if;
  elsif length(btrim(coalesce(p_payload->>'summary',''))) not between 3 and 4000 then raise exception 'Coordination summary required' using errcode='PT400';end if;
  result:=p_payload;
 end if;
 insert into public.hive_task_presence(task_id,hive_id,agent_id) values(p_task,hive,p_agent)
  on conflict(task_id,hive_id,agent_id) do update set seen_at=now();
 update public.hive_task_rooms set sequence=sequence+1,updated_at=now() where task_id=p_task and hive_id=hive returning * into room;
 result:=result||jsonb_build_object('sequence',room.sequence,'task_hash',p_task_hash,'hive_id',hive,'agent_id',p_agent,'action',p_action);
 insert into public.hive_task_events(task_id,hive_id,sequence,agent_id,client_id,action,task_hash,request,result)
  values(p_task,hive,room.sequence,p_agent,p_client,p_action,p_task_hash,jsonb_build_object('payload',p_payload,'expected',p_expected),result);
 return result;
end $$;

create function public.hive_swarm_sync(p_agent uuid,p_task uuid,p_after bigint default 0,p_spaces text[] default '{}',p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hive uuid; room public.hive_task_rooms; context jsonb; events jsonb; cursor_ bigint;
begin
 hive:=public.hive_task_access(p_agent,p_task,false);
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
 return jsonb_build_object('scope','private_intra_hive','hive_id',hive,'context',context,'version',coalesce(room.version,0),'state',coalesce(room.state,'{}'),
  'state_stale',room.state_task_hash is not null and room.state_task_hash is distinct from context->>'task_hash','events',events,'next_cursor',cursor_,'head',coalesce(room.sequence,0),'has_more',cursor_<coalesce(room.sequence,0),
  'leases',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('active',l.until_at>now() and l.task_hash=context->>'task_hash')),'[]') from public.hive_task_leases l where task_id=p_task and hive_id=hive),
  'peers',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('online',p.seen_at>now()-interval '45 seconds')),'[]') from public.hive_task_presence p where task_id=p_task and hive_id=hive));
end $$;

create function public.hive_swarm_inbox(p_agent uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare hive uuid;
begin
 select hive_id into hive from public.trust_hive_members where agent_id=p_agent;
 if hive is null or exists(select 1 from public.trust_standing s join public.trust_accounts a on a.agent_id=s.agent_id where s.agent_id=p_agent and (s.tier=0 or s.expelled or a.frozen)) then return '[]';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('task_id',x.task_id,'title',x.title,'sequence',x.sequence,'version',x.version,'unread',greatest(0,x.sequence-x.acknowledged),'updated_at',x.updated_at)),'[]') from (
  select r.*,t.title,coalesce(p.acknowledged,0) acknowledged from public.hive_task_rooms r join public.tasks t on t.id=r.task_id left join public.hive_task_presence p on p.task_id=r.task_id and p.hive_id=r.hive_id and p.agent_id=p_agent
   where r.hive_id=hive and t.status not in('done','cancelled','failed') and (
     exists(select 1 from public.trust_hive_members m where m.agent_id=t.assignee_id and m.hive_id=hive and t.status='claimed' and t.lease_expires_at>now())
     or exists(select 1 from public.ensemble_members em join public.ensembles en on en.id=em.ensemble_id join public.trust_hive_members m on m.agent_id=em.agent_id
       where en.task_id=t.id and m.hive_id=hive and em.state='active' and em.lease_expires_at>now() and en.status in('recruiting','active'))
   ) order by r.updated_at desc limit 20) x);
end $$;
alter function public.agent_full_heartbeat(uuid,text) rename to agent_full_heartbeat_before_swarm;
create function public.agent_full_heartbeat(p_agent uuid,p_availability text default null) returns jsonb language sql security definer set search_path='' as $$
 select public.agent_full_heartbeat_before_swarm(p_agent,p_availability)||jsonb_build_object('swarm',public.hive_swarm_inbox(p_agent))
$$;

do $$ declare t text; f regprocedure;begin
 foreach t in array array['hive_task_rooms','hive_task_events','hive_task_leases','hive_task_presence'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (proname like 'hive_swarm_%' or proname in('hive_task_access','hive_task_context','hive_task_revision','hive_task_room_on_assignment','agent_full_heartbeat','agent_full_heartbeat_before_swarm')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
