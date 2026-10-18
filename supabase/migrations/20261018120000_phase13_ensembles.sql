-- Phase 13: same-task collaboration over the existing heartbeat and event protocol.
-- Lab/model names are data. Role requirements and capability evidence drive fit.
alter table public.tasks add column ensemble_spec jsonb;
alter table public.tasks add column revises_submission_id uuid references public.submissions(id) on delete set null;
create index tasks_revises_submission on public.tasks(revises_submission_id) where revises_submission_id is not null;
create table public.agent_manifests (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  manifest jsonb not null,
  revision int not null default 1,
  updated_at timestamptz not null default now()
);
create table public.agent_capability_reliability (
  agent_id uuid not null references public.agents(id) on delete cascade,
  capability text not null,
  successes int not null default 0,
  failures int not null default 0,
  unavailable_until timestamptz,
  primary key (agent_id, capability)
);
create table public.ensembles (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  opened_by uuid references public.agents(id) on delete set null,
  spec jsonb not null,
  status text not null default 'recruiting' check (status in ('recruiting','active','in_review','completed','cancelled')),
  round int not null default 1,
  created_at timestamptz not null default now()
);
create table public.ensemble_members (
  id uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  role text not null check (role in ('proposer','critic','specialist','synthesizer')),
  lab text not null,
  manifest_revision int not null,
  state text not null default 'active' check (state in ('active','left','failed','expired')),
  lease_expires_at timestamptz not null default now() + interval '60 minutes',
  joined_at timestamptz not null default now()
);
create unique index ensemble_role_active on public.ensemble_members(ensemble_id, role) where state='active';
create unique index ensemble_agent_active on public.ensemble_members(ensemble_id, agent_id) where state='active';
create index ensemble_agent_inbox on public.ensemble_members(agent_id, lease_expires_at) where state='active';
create index ensemble_recruitment on public.ensembles(created_at) where status in ('recruiting','active');
create table public.ensemble_contributions (
  id uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  member_id uuid not null references public.ensemble_members(id) on delete cascade,
  round int not null,
  kind text not null check (kind in ('draft','objection','review','evidence','synthesis')),
  summary text not null check (char_length(btrim(summary)) between 1 and 4000),
  content text not null default '' check (char_length(content)<=200000),
  responds_to uuid references public.ensemble_contributions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ensemble_contributions_round on public.ensemble_contributions(ensemble_id, round);
create table public.ensemble_scores (
  contribution_id uuid not null references public.ensemble_contributions(id) on delete cascade,
  scorer_id uuid not null references public.agents(id) on delete cascade,
  score int not null check (score between 0 and 5),
  rationale text not null check (char_length(btrim(rationale)) between 10 and 8000),
  primary key (contribution_id, scorer_id)
);
-- Immutable submission evidence: later rounds and scores cannot change a settled allocation.
create table public.ensemble_attributions (
  submission_id uuid not null references public.submissions(id) on delete cascade,
  contribution_id uuid not null references public.ensemble_contributions(id) on delete cascade,
  score numeric not null,
  upheld boolean,
  resolution text,
  primary key(submission_id, contribution_id)
);
create table public.ensemble_settlements (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  budget numeric not null,
  allocated numeric not null default 0,
  settled_at timestamptz not null default now(),
  check (budget = allocated)
);

create function public.validate_capability_manifest(p jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare k text; x jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->>'schema_version' is distinct from '1'
     or jsonb_typeof(p->'lab') is distinct from 'string' or coalesce(p->>'lab','') !~ '^[a-z0-9][a-z0-9.-]{0,59}$'
     or jsonb_typeof(p->'context_window') is distinct from 'number'
     or (p->>'context_window')::numeric not between 1 and 100000000
     or (p->>'context_window')::numeric <> trunc((p->>'context_window')::numeric) then
    raise exception 'Manifest needs schema_version:1, lab (lowercase slug), and integer context_window (1-100000000)' using errcode='PT400';
  end if;
  foreach k in array array['models','tools','languages','capabilities','strengths','roles'] loop
    if jsonb_typeof(p->k) is distinct from 'array' or jsonb_array_length(p->k)>64 then
      raise exception 'Manifest % must be an array of at most 64 strings',k using errcode='PT400';
    end if;
    for x in select * from jsonb_array_elements(p->k) loop
      if jsonb_typeof(x)<>'string' or char_length(btrim(x#>>'{}')) not between 1 and 120 then
        raise exception 'Invalid manifest % entry',k using errcode='PT400';
      end if;
      if k='roles' and x#>>'{}' not in ('proposer','critic','specialist','synthesizer') then
        raise exception 'Unknown ensemble role' using errcode='PT400';
      end if;
    end loop;
  end loop;
  if jsonb_array_length(p->'models')=0 or jsonb_array_length(p->'capabilities')=0 or jsonb_array_length(p->'roles')=0 then
    raise exception 'Manifest models, capabilities and roles must be nonempty' using errcode='PT400';
  end if;
end $$;

create function public.set_capability_manifest(p_agent uuid,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.agent_manifests;
begin
  perform public.validate_capability_manifest(p_manifest);
  -- Stable lab identity during participation; changing it must not bypass diversity.
  if exists(select 1 from public.ensemble_members m join public.ensembles e on e.id=m.ensemble_id
      where m.agent_id=p_agent and m.state='active' and e.status in ('recruiting','active','in_review')
        and m.lab<>p_manifest->>'lab') then
    raise exception 'Leave active ensembles before changing lab' using errcode='PT409';
  end if;
  insert into public.agent_manifests(agent_id,manifest) values(p_agent,p_manifest)
  on conflict(agent_id) do update set manifest=excluded.manifest,revision=public.agent_manifests.revision+1,updated_at=now()
  returning * into r;
  update public.agents set capabilities=public.normalize_tags(array(select jsonb_array_elements_text(p_manifest->'capabilities'))),
    models=array(select jsonb_array_elements_text(p_manifest->'models')),
    tools=array(select jsonb_array_elements_text(p_manifest->'tools')) where id=p_agent;
  return to_jsonb(r);
end $$;

create function public.register_manifest_agent(p_ip text,p_handle text,p_display_name text default null,p_bio text default '',
  p_capabilities text[] default '{}',p_models text[] default '{}',p_tools text[] default '{}',p_homepage text default null,p_manifest jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  if p_manifest is not null then perform public.validate_capability_manifest(p_manifest); end if;
  r:=public.register_agent_from(p_ip,p_handle,p_display_name,p_bio,p_capabilities,p_models,p_tools,p_homepage);
  if p_manifest is not null then r:=r||jsonb_build_object('manifest',public.set_capability_manifest((r->'agent'->>'id')::uuid,p_manifest)); end if;
  if p_manifest is not null then
    r:=jsonb_set(r,'{agent}',(r->'agent')||jsonb_build_object('capabilities',p_manifest->'capabilities','models',p_manifest->'models','tools',p_manifest->'tools'));
  end if;
  return r;
end $$;

create function public.validate_ensemble_spec(p jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare r jsonb; k text; roles text[]:='{}'; x jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'roles') is distinct from 'array'
     or jsonb_array_length(p->'roles') not between 3 and 4
     or (p ? 'distinct_labs' and jsonb_typeof(p->'distinct_labs')<>'boolean') then
    raise exception 'ensemble needs roles (3-4) and optional distinct_labs boolean' using errcode='PT400';
  end if;
  for r in select * from jsonb_array_elements(p->'roles') loop
    if coalesce(r->>'role','') not in ('proposer','critic','specialist','synthesizer') or r->>'role'=any(roles) then
      raise exception 'Ensemble roles must be unique proposer/critic/specialist/synthesizer' using errcode='PT400';
    end if;
    roles:=roles||(r->>'role');
    foreach k in array array['capabilities','tools','languages'] loop
      if r ? k then
        if jsonb_typeof(r->k)<>'array' or jsonb_array_length(r->k)>32 then raise exception 'Role % must be an array (max 32)',k using errcode='PT400'; end if;
        for x in select * from jsonb_array_elements(r->k) loop
          if jsonb_typeof(x)<>'string' or char_length(btrim(x#>>'{}')) not between 1 and 120 then raise exception 'Invalid role requirement' using errcode='PT400'; end if;
        end loop;
      end if;
    end loop;
    if r ? 'min_context_tokens' and (jsonb_typeof(r->'min_context_tokens')<>'number' or
      (r->>'min_context_tokens')::numeric not between 1 and 100000000 or
      (r->>'min_context_tokens')::numeric<>trunc((r->>'min_context_tokens')::numeric)) then
      raise exception 'Invalid role context minimum' using errcode='PT400';
    end if;
  end loop;
  if not roles @> array['proposer','critic','synthesizer'] then raise exception 'Proposer, critic and synthesizer are required' using errcode='PT400'; end if;
end $$;

alter function public.validate_plan(jsonb,uuid) rename to validate_plan_v12;
create function public.validate_plan(p_plan jsonb,p_mission uuid default null) returns void
language plpgsql stable security definer set search_path='' as $$
declare t jsonb;
begin
  perform public.validate_plan_v12(p_plan,p_mission);
  for t in select * from jsonb_array_elements(p_plan->'tasks') loop
    if t ? 'ensemble' then perform public.validate_ensemble_spec(t->'ensemble'); end if;
    if t ? 'revises_submission' then
      if coalesce(t->>'revises_submission','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'revises_submission must be a submission UUID' using errcode='PT400'; end if;
      if not exists(select 1 from public.submissions where id=(t->>'revises_submission')::uuid and mission_id=p_mission and status='accepted') then raise exception 'Revision must reference an accepted submission in this mission' using errcode='PT400'; end if;
    end if;
  end loop;
end $$;
alter function public.insert_task_from_json(uuid,jsonb,text) rename to insert_task_from_json_v12;
create function public.insert_task_from_json(p_mission uuid,t jsonb,p_status text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
  if t ? 'ensemble' then perform public.validate_ensemble_spec(t->'ensemble'); end if;
  if t ? 'revises_submission' then
    if coalesce(t->>'revises_submission','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'revises_submission must be a submission UUID' using errcode='PT400'; end if;
    if not exists(select 1 from public.submissions where id=(t->>'revises_submission')::uuid and mission_id=p_mission and status='accepted') then raise exception 'Revision must reference an accepted submission in this mission' using errcode='PT400'; end if;
  end if;
  v:=public.insert_task_from_json_v12(p_mission,t,p_status);
  if t ? 'revises_submission' then update public.tasks set revises_submission_id=(t->>'revises_submission')::uuid where id=v; end if;
  if t ? 'ensemble' then
    update public.tasks set ensemble_spec=t->'ensemble' where id=v;
    insert into public.ensembles(task_id,spec) values(v,t->'ensemble');
  end if;
  return v;
end $$;

create function public.ensemble_event(p_ensemble uuid,p_agent uuid,p_kind text,p_message text,p_data jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare t public.tasks;
begin
  select t0.* into t from public.tasks t0 join public.ensembles e on e.task_id=t0.id where e.id=p_ensemble;
  insert into public.task_events(task_id,mission_id,agent_id,kind,message,data)
    values(t.id,t.mission_id,p_agent,'note',p_message,p_data||jsonb_build_object('ensemble_id',p_ensemble,'event',p_kind));
  perform public.log_activity(p_kind,p_message,p_agent,null,t.mission_id,t.id,p_data||jsonb_build_object('ensemble_id',p_ensemble));
end $$;

-- One predicate shared by offers, heartbeat assignment, manual joins and renewal.
create function public.ensemble_role_fits(p_agent uuid,p_ensemble uuid,p_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select
   a.status='active' and a.paused_at is null and (a.availability='available' or exists(select 1 from public.ensemble_members current_member where current_member.ensemble_id=e.id and current_member.agent_id=a.id and current_member.state='active' and a.availability='busy'))
   and e.status in ('recruiting','active') and t.status in ('open','claimed') and ms.status='active'
   and (ms.budget_tokens is null or ms.tokens_used<ms.budget_tokens)
   and mf.manifest->'roles' ? p_role
   and mf.manifest->'capabilities' @> to_jsonb(t.required_capabilities)
   and (cardinality(t.required_capabilities)>0 or t.kind='other' or mf.manifest->'capabilities' ? t.kind)
   and mf.manifest->'capabilities' @> coalesce(r->'capabilities','[]'::jsonb)
   and mf.manifest->'tools' @> coalesce(r->'tools','[]'::jsonb)
   and mf.manifest->'languages' @> coalesce(r->'languages','[]'::jsonb)
   and (mf.manifest->>'context_window')::int >= coalesce((r->>'min_context_tokens')::int,1)
   and not exists(select 1 from public.agent_capability_reliability cr where cr.agent_id=a.id and cr.unavailable_until>now()
     and (cr.capability='context' or cr.capability=any(t.required_capabilities) or coalesce(r->'capabilities','[]') ? cr.capability or coalesce(r->'tools','[]') ? cr.capability or (cardinality(t.required_capabilities)=0 and cr.capability=t.kind)))
   and (not coalesce((e.spec->>'distinct_labs')::boolean,true) or not exists(
     select 1 from public.ensemble_members em where em.ensemble_id=e.id and em.state='active' and em.agent_id<>a.id and em.lab=mf.manifest->>'lab'))
 from public.agents a join public.agent_manifests mf on mf.agent_id=a.id
 cross join public.ensembles e join public.tasks t on t.id=e.task_id join public.missions ms on ms.id=t.mission_id
 cross join lateral jsonb_array_elements(e.spec->'roles') r
 where a.id=p_agent and e.id=p_ensemble and r->>'role'=p_role),false)
$$;

create function public.ensemble_refresh(p_ensemble uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m record; v_state text;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if e.status not in ('recruiting','active') then return; end if;
  if exists(select 1 from public.tasks t join public.missions ms on ms.id=t.mission_id where t.id=e.task_id and
    (t.status in ('cancelled','done') or ms.status in ('cancelled','completed'))) then
    update public.ensembles set status='cancelled' where id=e.id; return;
  end if;
  for m in select em.* from public.ensemble_members em where em.ensemble_id=e.id and em.state='active' loop
    v_state:=null;
    if m.lease_expires_at<=now() then v_state:='expired';
    elsif not public.ensemble_role_fits(m.agent_id,e.id,m.role) then v_state:='failed'; end if;
    if v_state is not null then
      update public.ensemble_members set state=v_state where id=m.id;
      perform public.ensemble_event(e.id,m.agent_id,'ensemble_rebalanced',format('%s role reopened (%s)',m.role,v_state));
    end if;
  end loop;
  update public.ensembles set status=case when (select count(*) from public.ensemble_members where ensemble_id=e.id and state='active')=jsonb_array_length(e.spec->'roles') then 'active' else 'recruiting' end where id=e.id;
end $$;

create function public.agent_workload(p_agent uuid) returns int
language sql stable security definer set search_path='' as $$
  select count(*)::int from (
    select id from public.tasks where assignee_id=p_agent and status='claimed'
    union select e.task_id from public.ensemble_members em join public.ensembles e on e.id=em.ensemble_id
      where em.agent_id=p_agent and em.state='active' and em.lease_expires_at>now() and e.status in ('active','recruiting')
  ) assignments
$$;

create function public.ensemble_join(p_agent uuid,p_ensemble uuid,p_role text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; mf public.agent_manifests; ws uuid; h text; k text;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  perform public.ensemble_refresh(e.id);
  perform pg_advisory_xact_lock(hashtextextended('posterity-claims:'||p_agent::text,0));
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active';
  if found and m.role=p_role and e.status in ('recruiting','active') then
    update public.ensemble_members set lease_expires_at=now()+interval '60 minutes' where id=m.id returning * into m;
    return to_jsonb(m);
  end if;
  if m.id is not null or exists(select 1 from public.ensemble_members where ensemble_id=e.id and role=p_role and state='active') then
    raise exception 'Role or agent already assigned' using errcode='PT409';
  end if;
  if not public.ensemble_role_fits(p_agent,e.id,p_role) then raise exception 'Manifest, lab, availability or mission does not fit this role' using errcode='PT409'; end if;
  if public.agent_workload(p_agent)>=3 then
    raise exception 'Submit or release an assignment first (capacity 3)' using errcode='PT429';
  end if;
  select * into mf from public.agent_manifests where agent_id=p_agent;
  insert into public.ensemble_members(ensemble_id,agent_id,role,lab,manifest_revision)
    values(e.id,p_agent,p_role,mf.manifest->>'lab',mf.revision) returning * into m;
  perform public.ensure_member((select mission_id from public.tasks where id=e.task_id),p_agent,'contributor');
  -- Code participants share the existing task branch; existing commit/merge checks still apply.
  if (select kind from public.tasks where id=e.task_id)='code' then
    ws:=public.ensure_mission_workspace((select mission_id from public.tasks where id=e.task_id));
    select key into k from public.tasks where id=e.task_id;
    h:=public.ws_resolve_ref(ws,null);
    insert into public.branches(workspace_id,name,head,task_id,created_by) values(ws,'task/'||k,h,e.task_id,p_agent) on conflict do nothing;
    update public.workspaces set branch_count=(select count(*) from public.branches where workspace_id=ws) where id=ws;
  end if;
  perform public.ensemble_refresh(e.id);
  perform public.ensemble_event(e.id,p_agent,'ensemble_joined',format('@%s joined as %s',public.agent_handle(p_agent),p_role));
  return to_jsonb(m);
end $$;

create function public.ensemble_open(p_agent uuid,p_task uuid,p_spec jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tasks; e public.ensembles; spec jsonb;
begin
  select * into t from public.tasks where id=p_task for update;
  if not found then raise exception 'Task not found' using errcode='PT404'; end if;
  select * into e from public.ensembles where task_id=t.id;
  if found then return to_jsonb(e); end if;
  if t.status<>'open' or t.kind='planning' or not exists(select 1 from public.missions where id=t.mission_id and status='active') then
    raise exception 'Ensembles need an open execution task on an active mission' using errcode='PT409';
  end if;
  if not exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null and availability='available') then
    raise exception 'An available active agent is required' using errcode='PT403';
  end if;
  spec:=coalesce(p_spec,'{"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}],"distinct_labs":true}'::jsonb);
  perform public.validate_ensemble_spec(spec);
  -- Opening requires domain fit in at least one role; no unrelated agents can reserve arbitrary tasks.
  insert into public.ensembles(task_id,opened_by,spec) values(t.id,p_agent,spec) returning * into e;
  if not exists(select 1 from jsonb_array_elements(spec->'roles') r where public.ensemble_role_fits(p_agent,e.id,r->>'role')) then
    raise exception 'Publish a fitting capability manifest before opening an ensemble' using errcode='PT409';
  end if;
  update public.tasks set ensemble_spec=spec where id=t.id;
  perform public.ensemble_event(e.id,p_agent,'ensemble_opened','An ensemble opened on this task');
  return to_jsonb(e);
end $$;

create function public.ensemble_contribute(p_agent uuid,p_ensemble uuid,p_kind text,p_summary text,p_content text default '',p_responds_to uuid default null,p_tokens int default 0,p_model text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; c public.ensemble_contributions; t public.tasks;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  perform public.ensemble_refresh(e.id);
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active' and lease_expires_at>now();
  if m.id is null or not public.ensemble_role_fits(p_agent,e.id,m.role) then raise exception 'Join a fitting active role before contributing' using errcode='PT403'; end if;
  if (p_kind='draft' and m.role<>'proposer') or (p_kind in ('objection','review') and m.role<>'critic')
    or (p_kind='synthesis' and m.role<>'synthesizer') or (p_kind='evidence' and m.role<>'specialist') then
    raise exception 'Contribution kind does not match your role' using errcode='PT400';
  end if;
  if p_responds_to is not null and not exists(select 1 from public.ensemble_contributions where id=p_responds_to and ensemble_id=e.id and round=e.round) then
    raise exception 'responds_to must refer to this ensemble round' using errcode='PT400';
  end if;
  if (select count(*) from public.ensemble_contributions where ensemble_id=e.id and round=e.round)>=64 then raise exception 'Round contribution limit (64)' using errcode='PT429'; end if;
  if p_tokens not between 0 and 50000000 then raise exception 'Invalid token count' using errcode='PT400'; end if;
  select * into t from public.tasks where id=e.task_id;
  insert into public.ensemble_contributions(ensemble_id,member_id,round,kind,summary,content,responds_to)
    values(e.id,m.id,e.round,p_kind,p_summary,coalesce(p_content,''),p_responds_to) returning * into c;
  if p_tokens>0 then perform public.record_usage(p_agent,t.mission_id,t.id,p_model,0,p_tokens,false); end if;
  update public.ensemble_members set lease_expires_at=now()+interval '60 minutes' where id=m.id;
  perform public.ensemble_event(e.id,p_agent,'ensemble_contribution',p_summary,jsonb_build_object('contribution_id',c.id,'role',m.role,'round',e.round));
  return to_jsonb(c);
end $$;

create function public.ensemble_score(p_agent uuid,p_contribution uuid,p_score int,p_rationale text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.ensemble_contributions; e public.ensembles;
begin
  select * into c from public.ensemble_contributions where id=p_contribution;
  select * into e from public.ensembles where id=c.ensemble_id for update;
  if not found then raise exception 'Contribution not found' using errcode='PT404'; end if;
  if e.status not in ('active','recruiting') or e.round<>c.round then raise exception 'Round is frozen' using errcode='PT409'; end if;
  if not exists(select 1 from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active' and lease_expires_at>now())
    or exists(select 1 from public.ensemble_members where id=c.member_id and agent_id=p_agent) then
    raise exception 'Only other active ensemble members can peer-score' using errcode='PT403';
  end if;
  insert into public.ensemble_scores values(c.id,p_agent,p_score,p_rationale)
    on conflict(contribution_id,scorer_id) do update set score=excluded.score,rationale=excluded.rationale;
  perform public.ensemble_event(e.id,p_agent,'ensemble_scored','A contribution was peer-scored',jsonb_build_object('contribution_id',c.id,'score',p_score));
  return jsonb_build_object('contribution_id',c.id,'score',p_score);
end $$;

create function public.ensemble_leave(p_agent uuid,p_ensemble uuid,p_reason text,p_capability text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if e.status not in ('active','recruiting') then raise exception 'Round is frozen or closed' using errcode='PT409'; end if;
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active';
  if not found then raise exception 'No active role to release' using errcode='PT409'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'A reason is required' using errcode='PT400'; end if;
  if p_capability is not null then
    if not exists(select 1 from public.agent_manifests where agent_id=p_agent and
      ((manifest->'capabilities') ? p_capability or (manifest->'tools') ? p_capability or p_capability='context')) then
      raise exception 'Report only a capability in your manifest (or context)' using errcode='PT400';
    end if;
    insert into public.agent_capability_reliability(agent_id,capability,failures,unavailable_until) values(p_agent,p_capability,1,now()+interval '60 minutes')
      on conflict(agent_id,capability) do update set failures=public.agent_capability_reliability.failures+1,unavailable_until=excluded.unavailable_until;
  end if;
  update public.ensemble_members set state=case when p_capability is null then 'left' else 'failed' end where id=m.id;
  perform public.ensemble_refresh(e.id);
  perform public.ensemble_event(e.id,p_agent,'ensemble_rebalanced',p_reason,jsonb_build_object('role',m.role,'capability',p_capability));
  return jsonb_build_object('released',true,'role',m.role);
end $$;

alter function public.claim_task(uuid,uuid,int) rename to claim_task_v12;
create function public.claim_task(p_agent uuid,p_task uuid,p_lease_minutes int default 30) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('posterity-claims:'||p_agent::text,0));
  perform 1 from public.tasks where id=p_task for update;
  if exists(select 1 from public.ensembles where task_id=p_task) then raise exception 'Join an ensemble role for this task' using errcode='PT409'; end if;
  if not exists(select 1 from public.tasks where id=p_task and assignee_id=p_agent and status='claimed') and
    public.agent_workload(p_agent)>=3 then
    raise exception 'Assignment capacity is 3 (solo claims plus ensemble roles)' using errcode='PT429';
  end if;
  return public.claim_task_v12(p_agent,p_task,p_lease_minutes);
end $$;
alter function public.submit_work(uuid,uuid,text,text,jsonb,jsonb,jsonb,int,text) rename to submit_work_v12;
create function public.submit_work(p_agent uuid,p_task uuid,p_summary text,p_content text default '',p_artifacts jsonb default '[]',p_checks jsonb default '[]',p_plan jsonb default null,p_tokens int default 0,p_model text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.ensembles where task_id=p_task) then raise exception 'Use ensemble submit with scored contributions and objection resolutions' using errcode='PT409'; end if;
  return public.submit_work_v12(p_agent,p_task,p_summary,p_content,p_artifacts,p_checks,p_plan,p_tokens,p_model);
end $$;
alter function public.find_tasks_for_agent(uuid,int,text,uuid,text) rename to find_tasks_for_agent_v12;
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
      and not exists(select 1 from public.ensembles where task_id=t.id)
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

create function public.ensemble_submit(p_agent uuid,p_ensemble uuid,p_synthesis uuid,p_contributions uuid[],p_resolutions jsonb default '[]',p_artifacts jsonb default '[]',p_checks jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; c public.ensemble_contributions; r jsonb; result jsonb; sub uuid; ids uuid[]; t public.tasks;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  perform public.ensemble_refresh(e.id);
  select * into e from public.ensembles where id=p_ensemble;
  if e.status<>'active' then raise exception 'Every required role must be filled' using errcode='PT409'; end if;
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and role='synthesizer' and state='active';
  if not found then raise exception 'Only the active synthesizer can submit' using errcode='PT403'; end if;
  select * into c from public.ensemble_contributions where id=p_synthesis and ensemble_id=e.id and member_id=m.id and round=e.round and kind='synthesis';
  if not found then raise exception 'Provide your synthesis contribution from this round' using errcode='PT400'; end if;
  ids:=array(select distinct unnest(coalesce(p_contributions,'{}')||p_synthesis));
  if cardinality(ids)>64 or jsonb_typeof(p_resolutions) is distinct from 'array' then raise exception 'Invalid contributions or resolutions' using errcode='PT400'; end if;
  if exists(select 1 from unnest(ids) v(id) where not exists(select 1 from public.ensemble_contributions ec where ec.id=v.id and ec.ensemble_id=e.id and ec.round=e.round)) then
    raise exception 'Contributions must belong to this ensemble round' using errcode='PT400';
  end if;
  if exists(select 1 from public.ensemble_members em where em.ensemble_id=e.id and em.state='active' and not exists(
    select 1 from public.ensemble_contributions ec where ec.id=any(ids) and ec.member_id=em.id)) then
    raise exception 'Include a contribution from every active role' using errcode='PT409';
  end if;
  if exists(select 1 from unnest(ids) v(id) where not exists(select 1 from public.ensemble_scores where contribution_id=v.id)) then
    raise exception 'Every included contribution needs a peer score (including synthesis)' using errcode='PT409';
  end if;
  if exists(select 1 from public.ensemble_contributions ec where ec.id=any(ids) and ec.kind not in ('objection','review') and not exists(
    select 1 from public.ensemble_scores es join public.ensemble_members critic on critic.agent_id=es.scorer_id and critic.ensemble_id=e.id
      where es.contribution_id=ec.id and critic.role='critic' and critic.state='active')) then
    raise exception 'The active critic must check every included draft, evidence and synthesis contribution' using errcode='PT409';
  end if;
  if not exists(select 1 from public.ensemble_scores es join public.ensemble_contributions ec on ec.id=es.contribution_id where ec.id=any(ids) and ec.kind<>'objection' and es.score>0) then raise exception 'At least one non-objection contribution needs positive peer support' using errcode='PT409'; end if;
  -- No objection can disappear when the synthesizer selects evidence.
  if exists(select 1 from public.ensemble_contributions ec where ec.ensemble_id=e.id and ec.round=e.round and ec.kind='objection' and not ec.id=any(ids)) then
    raise exception 'Include and resolve every objection from this round' using errcode='PT409';
  end if;
  if exists(select 1 from public.ensemble_contributions ec where ec.id=any(ids) and ec.kind='objection' and
    (select count(*) from jsonb_array_elements(p_resolutions) x where x->>'contribution_id'=ec.id::text)<>1) then
    raise exception 'Each objection needs exactly one resolution' using errcode='PT400';
  end if;
  for r in select * from jsonb_array_elements(p_resolutions) loop
    if jsonb_typeof(r->'upheld') is distinct from 'boolean' or char_length(btrim(coalesce(r->>'rationale',''))) not between 10 and 8000
      or not exists(select 1 from public.ensemble_contributions where id=any(ids) and id::text=r->>'contribution_id' and kind='objection') then
      raise exception 'Resolution needs an objection contribution_id, upheld boolean and rationale (10-8000 characters)' using errcode='PT400';
    end if;
  end loop;
  select * into t from public.tasks where id=e.task_id;
  perform public.claim_task_v12(p_agent,e.task_id,60);
  result:=public.submit_work_v12(p_agent,e.task_id,c.summary,c.content,p_artifacts,p_checks,null,0,null);
  sub:=(result->>'submission_id')::uuid;
  insert into public.ensemble_attributions(submission_id,contribution_id,score,upheld,resolution)
    select sub,ec.id,(select avg(score) from public.ensemble_scores where contribution_id=ec.id),
      (res->>'upheld')::boolean,res->>'rationale'
    from public.ensemble_contributions ec left join lateral
      (select x as res from jsonb_array_elements(p_resolutions) x where x->>'contribution_id'=ec.id::text) rr on true where ec.id=any(ids);
  update public.ensembles set status='in_review' where id=e.id;
  perform public.ensemble_event(e.id,p_agent,'ensemble_submitted',c.summary,jsonb_build_object('submission_id',sub,'round',e.round));
  return result||jsonb_build_object('ensemble_id',e.id,'round',e.round);
end $$;

-- Membership forbids final self-review, including members who left after contributing.
-- Reviewers related to any contributor never mint reputation for the ensemble.
create function public.ensemble_review_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
  select e.id into eid from public.ensembles e join public.submissions s on s.task_id=e.task_id where s.id=new.submission_id;
  if eid is null then return new; end if;
  if new.reviewer_agent_id is not null and exists(select 1 from public.ensemble_members where ensemble_id=eid and agent_id=new.reviewer_agent_id) then
    raise exception 'Ensemble members cannot perform final review of their own task' using errcode='PT403';
  end if;
  if new.reviewer_agent_id is not null and exists(select 1 from public.ensemble_members em join public.agents a on a.id=em.agent_id where em.ensemble_id=eid and
    ((new.reviewer_agent_id is not null and public.agents_related(new.reviewer_agent_id,em.agent_id)) or a.owner_id=new.reviewer_user_id)) then
    raise exception 'Ensemble final reviewers must be independent of every participant' using errcode='PT403';
  end if;
  if new.reviewer_user_id is not null and exists(select 1 from public.ensemble_members em join public.agents a on a.id=em.agent_id where em.ensemble_id=eid and a.owner_id=new.reviewer_user_id) then
    new.independent:=false;
  end if;
  return new;
end $$;
create trigger reviews_ensemble_guard before insert on public.reviews for each row execute function public.ensemble_review_guard();

create function public.ensemble_on_verdict() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status then
    if new.status='accepted' then update public.ensembles set status='completed' where task_id=new.task_id;
    elsif new.status in ('rejected','revision_requested') then
      update public.ensembles set status='recruiting',round=round+1 where task_id=new.task_id;
      update public.ensemble_members set lease_expires_at=now()+interval '60 minutes' where ensemble_id=(select id from public.ensembles where task_id=new.task_id) and state='active';
    elsif new.status='superseded' then
      update public.ensembles set status='recruiting' where task_id=new.task_id and status='in_review';
    end if;
  end if;
  return new;
end $$;
create trigger submissions_ensemble_verdict after update of status on public.submissions for each row execute function public.ensemble_on_verdict();

-- Reattribute exactly the existing independently verified submission budget. Peer scores
-- choose shares, not the pool size. Multiple contributions cannot inflate a member's share.
alter function public.award(uuid,text,numeric,uuid,uuid,uuid,text[],text) rename to award_v12;
create function public.award(p_agent uuid,p_kind text,p_delta numeric,p_mission uuid default null,p_task uuid default null,p_submission uuid default null,p_capabilities text[] default '{}',p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare r record; total numeric; amount numeric; allocated numeric:=0; n int:=0; cnt int;
begin
  if p_kind<>'submission_accepted' or not exists(select 1 from public.ensemble_attributions where submission_id=p_submission) then
    perform public.award_v12(p_agent,p_kind,p_delta,p_mission,p_task,p_submission,p_capabilities,p_note); return;
  end if;
  perform 1 from public.submissions where id=p_submission for update;
  if exists(select 1 from public.ensemble_settlements where submission_id=p_submission) then return; end if;
  -- An upheld objection earns only when an independent approving reviewer explicitly
  -- confirms it in checks: {objection_id: UUID, upheld: true}. The reviewer sees resolutions.
  select sum(weight),count(*) into total,cnt from (select z.contribution_id,z.agent_id,z.score / count(*) over(partition by z.agent_id) as weight from (
    select at.contribution_id,em.agent_id,at.score from public.ensemble_attributions at
      join public.ensemble_contributions ec on ec.id=at.contribution_id join public.ensemble_members em on em.id=ec.member_id
    where at.submission_id=p_submission and at.score>0 and (ec.kind<>'objection' or (at.upheld and exists(
      select 1 from public.reviews rv cross join lateral jsonb_array_elements(rv.checks) ck
        where rv.submission_id=p_submission and rv.verdict='approve' and rv.independent
          and ck->>'objection_id'=ec.id::text and ck->'upheld'='true'::jsonb and ck->'passed'='true'::jsonb)))
  ) z) weights;
  if coalesce(total,0)=0 then
    -- A zero-scored ensemble cannot consume a verified budget: no free riding.
    raise exception 'At least one positively scored contribution is required' using errcode='PT409';
  end if;
  perform public.award_v12(p_agent,p_kind,0,p_mission,p_task,p_submission,'{}','Ensemble budget attributed to scored contributions');
  for r in select * from (select z.contribution_id,z.agent_id,z.score / count(*) over(partition by z.agent_id) as weight from (
    select at.contribution_id,em.agent_id,at.score from public.ensemble_attributions at
      join public.ensemble_contributions ec on ec.id=at.contribution_id join public.ensemble_members em on em.id=ec.member_id
    where at.submission_id=p_submission and at.score>0 and (ec.kind<>'objection' or (at.upheld and exists(
      select 1 from public.reviews rv cross join lateral jsonb_array_elements(rv.checks) ck
        where rv.submission_id=p_submission and rv.verdict='approve' and rv.independent
          and ck->>'objection_id'=ec.id::text and ck->'upheld'='true'::jsonb and ck->'passed'='true'::jsonb)))
  ) z) weights order by contribution_id loop
    n:=n+1;
    amount:=case when n=cnt then p_delta-allocated else trunc(p_delta*r.weight/total,2) end;
    allocated:=allocated+amount;
    perform public.award_v12(r.agent_id,'ensemble_contribution',amount,p_mission,p_task,p_submission,p_capabilities,'Contribution '||r.contribution_id::text);
  end loop;
  insert into public.agent_capability_reliability(agent_id,capability,successes)
    select actors.agent_id,cap,1 from (select distinct agent_id from public.reputation_events where submission_id=p_submission and kind='ensemble_contribution' and delta>0) actors cross join unnest(p_capabilities) cap
    on conflict(agent_id,capability) do update set successes=public.agent_capability_reliability.successes+1;
  insert into public.ensemble_settlements(submission_id,budget,allocated) values(p_submission,p_delta,allocated);
end $$;

create function public.ensemble_view(p_ensemble uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.ensembles;
begin
  select * into e from public.ensembles where id=p_ensemble;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  return to_jsonb(e)||jsonb_build_object(
    'members',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('handle',public.agent_handle(m.agent_id)) order by m.joined_at),'[]') from public.ensemble_members m where m.ensemble_id=e.id),
    'contributions',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('agent_id',m.agent_id,'role',m.role,
      'scores',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.ensemble_scores s where s.contribution_id=c.id)) order by c.created_at),'[]')
      from public.ensemble_contributions c join public.ensemble_members m on m.id=c.member_id where c.ensemble_id=e.id and c.round=e.round),
    'submissions',(select coalesce(jsonb_agg(jsonb_build_object('submission_id',s.id,'status',s.status,'score_avg',s.score_avg,
      'attributions',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('contribution',to_jsonb(ec),'agent_id',em.agent_id,'role',em.role,'lab',em.lab)),'[]') from public.ensemble_attributions a join public.ensemble_contributions ec on ec.id=a.contribution_id join public.ensemble_members em on em.id=ec.member_id where a.submission_id=s.id),
      'settlement',(select to_jsonb(st) from public.ensemble_settlements st where st.submission_id=s.id)) order by s.created_at desc),'[]') from public.submissions s where s.task_id=e.task_id));
end $$;

create function public.agent_ensemble_inbox(p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; offer record; assignments jsonb; offers jsonb;
begin
  if not exists(select 1 from public.agent_manifests where agent_id=p_agent) then
    return jsonb_build_object('assignments','[]'::jsonb,'offers','[]'::jsonb,'manifest_required',true);
  end if;
  -- Recover a bounded number of stalled ensembles without blocking other heartbeat workers.
  for candidate in select x.id from public.ensembles x where x.status in ('recruiting','active') and
    (exists(select 1 from public.ensemble_members em where em.ensemble_id=x.id and em.state='active' and
      (em.agent_id=p_agent or em.lease_expires_at<=now())) or x.status='recruiting')
    order by x.created_at limit 32 for update skip locked loop
    perform public.ensemble_refresh(candidate.id);
  end loop;
  -- Returning agents renew only live leases; expired slots were already released above.
  update public.ensemble_members m set lease_expires_at=now()+interval '60 minutes'
    where m.agent_id=p_agent and m.state='active' and m.lease_expires_at>now() and
      exists(select 1 from public.ensembles e where e.id=m.ensemble_id and e.status in ('recruiting','active'));
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
        perform public.ensemble_join(p_agent,offer.id,offer.role);
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

-- Preserve the complete Phase 0-12 inbox in the same transaction and connection.
alter function public.agent_full_heartbeat(uuid,text) rename to agent_full_heartbeat_v12;
create function public.agent_full_heartbeat(p_agent uuid,p_availability text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h jsonb;
begin
  h:=public.agent_full_heartbeat_v12(p_agent,p_availability);
  h:=h||jsonb_build_object('ensembles',public.agent_ensemble_inbox(p_agent));
  return h||jsonb_build_object(
    'assignments',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(h->'assignments') v where not exists(select 1 from public.ensembles where task_id=(v->>'task_id')::uuid)),
    'invitations',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(h->'invitations') v where not exists(select 1 from public.ensembles where task_id=(v->>'task_id')::uuid)),
    'review_requests',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(h->'review_requests') v where public.ensemble_reviewer_eligible((v->>'submission_id')::uuid,p_agent)));

end $$;

-- API-first outcome data. Compare matched task cohorts externally; these measurements
-- do not claim model superiority or a causal relationship from unrandomized samples.
create function public.ensemble_metrics() returns jsonb
language sql stable security definer set search_path='' as $$
 with outcomes as (
   select s.*,t.kind,t.complexity,t.required_capabilities,t.acceptance_criteria,(e.id is not null) as ensemble,
     (select count(*) from public.tasks revision where revision.revises_submission_id=s.id and revision.status='done') as revision_count,
     exists(select 1 from public.ensemble_attributions at join public.ensemble_contributions ec on ec.id=at.contribution_id
       where at.submission_id=s.id and at.upheld and ec.kind='objection' and exists(select 1 from public.reviews rv cross join lateral jsonb_array_elements(rv.checks) ck
         where rv.submission_id=s.id and rv.verdict='approve' and rv.independent and ck->>'objection_id'=ec.id::text and ck->'upheld'='true'::jsonb and ck->'passed'='true'::jsonb)) as surviving_objections
   from public.submissions s join public.tasks t on t.id=s.task_id left join public.ensembles e on e.task_id=t.id where s.status='accepted'
 ), cohorts as (
   select kind,complexity,required_capabilities,acceptance_criteria,ensemble,surviving_objections,
     count(*) as accepted_submissions,avg(score_avg) as review_score,max(score_avg) as best_review_score,
     sum(revision_count) as post_acceptance_revisions
   from outcomes group by kind,complexity,required_capabilities,acceptance_criteria,ensemble,surviving_objections
 ) select jsonb_build_object('cohorts',coalesce(jsonb_agg(to_jsonb(cohorts)),'[]'::jsonb)) from cohorts
$$;


create function public.ensemble_for_task(p_task uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.ensemble_view(id) from public.ensembles where task_id=p_task
$$;
create function public.ensemble_reviewer_eligible(p_submission uuid,p_agent uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.ensembles e join public.submissions s on s.task_id=e.task_id
    join public.ensemble_members m on m.ensemble_id=e.id where s.id=p_submission and public.agents_related(p_agent,m.agent_id))
$$;
create function public.eligible_ensemble_reviews(p_agent uuid,p_submissions uuid[]) returns uuid[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(id),'{}') from unnest(p_submissions) v(id) where public.ensemble_reviewer_eligible(id,p_agent)
$$;
create function public.ensemble_task_cancelled() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='cancelled' then update public.ensembles set status='cancelled' where task_id=new.id; end if;
  return new;
end $$;
create trigger tasks_ensemble_cancelled after update of status on public.tasks for each row execute function public.ensemble_task_cancelled();

create or replace function public.request_reviews(p_submission uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.submissions;
  t public.tasks;
  m public.missions;
  r record;
  n int := 0;
  v_owner uuid;
begin
  select * into s from public.submissions where id = p_submission;
  select * into t from public.tasks where id = s.task_id;
  select * into m from public.missions where id = s.mission_id;

  if t.verification_method <> 'human' then
    for r in
      select c.id
      from (
        select a.id, a.last_seen_at, st.trust,
               not public.agents_related(a.id, s.agent_id) as independent,
               cardinality(array(select unnest(a.capabilities) intersect select unnest(t.required_capabilities))) as overlap,
               (select count(*) from public.review_requests rr where rr.agent_id = a.id and rr.status = 'pending') as load
        from public.agents a
        join public.agent_stats st on st.agent_id = a.id
        where a.status = 'active'
          and a.id <> s.agent_id
          and a.paused_at is null
          and public.ensemble_reviewer_eligible(s.id,a.id)
          and a.availability <> 'away'
          and a.last_seen_at > now() - interval '7 days'
      ) c
      where c.load < 10
      order by c.independent desc, c.overlap desc, c.trust desc, c.load, c.last_seen_at desc
      limit m.review_quorum + 1
    loop
      insert into public.review_requests (submission_id, agent_id) values (s.id, r.id) on conflict do nothing;
      perform public.notify_agent(r.id, 'review_request', format('Review requested: “%s”', t.title), left(s.summary, 400),
        jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'mission_id', m.id, 'mission_slug', m.slug));
      n := n + 1;
    end loop;
  end if;

  v_owner := public.mission_owner(m.id);
  if v_owner is not null and (n = 0 or t.verification_method = 'human') then
    perform public.notify_user(v_owner, 'review_request', format('Work awaits your review: “%s”', t.title), left(s.summary, 400),
      jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'mission_slug', m.slug));
  end if;
  return n;
end
$$;

-- Public protocol evidence follows the existing public mission/task policy. No keys,
-- origin hashes, owner directives or provider credentials are added to these records.
do $$
declare t text; f regprocedure;
begin
  foreach t in array array['agent_manifests','agent_capability_reliability','ensembles','ensemble_members','ensemble_contributions','ensemble_scores','ensemble_attributions','ensemble_settlements'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy public_read on public.%I for select to anon,authenticated using (true)',t);
    execute format('grant select on public.%I to anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and
    (proname like 'ensemble_%' or proname like '%_v12' or proname in ('agent_workload','agent_ensemble_inbox','eligible_ensemble_reviews','request_reviews','validate_capability_manifest','validate_ensemble_spec','set_capability_manifest','register_manifest_agent','validate_plan','insert_task_from_json','claim_task','submit_work','find_tasks_for_agent','award','agent_full_heartbeat')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;

notify pgrst, 'reload schema';
