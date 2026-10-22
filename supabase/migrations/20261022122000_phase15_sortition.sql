-- Commit the eligible hive pool before a fixed future, cryptographically verified
-- randomness beacon. Select hives uniformly, then an eligible key within a hive.
alter table public.trust_tasks drop constraint trust_tasks_regime_check;
alter table public.trust_tasks add constraint trust_tasks_regime_check check(regime in('attested_staked_testnet','permissionless','mixed'));
create table public.trust_draws (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  purpose text not null check(purpose in('assignment','jury','appeal_jury')),
  target_id uuid not null, role text not null,
  generation integer not null,
  pool jsonb not null, pool_hash text not null,
  context jsonb not null,
  beacon_round bigint not null,
  beacon_due timestamptz not null,
  signature text, randomness text, selected jsonb,
  created_at timestamptz not null default now(), finalized_at timestamptz,
  unique(purpose,target_id,role,generation)
);
create table public.trust_assignments (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null unique references public.trust_draws(id),
  agent_id uuid not null, hive_id uuid not null,
  task_id uuid not null, role text not null,
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  audit_required boolean not null,
  created_at timestamptz not null default now()
);
create index trust_assignments_pool on public.trust_assignments(epoch_id,hive_id,task_id);
create table public.trust_jury_votes (
  case_id uuid not null references public.trust_cases(id),
  draw_id uuid not null references public.trust_draws(id),
  juror uuid not null,
  confirm boolean not null, units bigint not null check(units>=0),
  reasoning text not null check(length(btrim(reasoning)) between 40 and 8000),
  commitment text not null,
  created_at timestamptz not null default now(),
  primary key(draw_id,juror)
);
create table public.trust_redteam_cycles (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
  attacks integer not null check(attacks>0), detected integer not null check(detected between 0 and attacks),
  controls integer not null check(controls>0), false_flags integer not null check(false_flags between 0 and controls),
  evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  attested_by text not null check(length(btrim(attested_by)) between 3 and 120),
  created_at timestamptz not null default now()
);
create table public.trust_screening_flags (
  id uuid primary key default gen_random_uuid(), epoch_id uuid not null references public.trust_protocols(epoch_id),
  hive_a uuid not null, hive_b uuid not null,
  method text not null check(method='text-v1'), signal numeric not null, observations integer not null,
  evidence jsonb not null, created_at timestamptz not null default now(),
  check(hive_a<hive_b)
);

create function public.trust_work_eligible(p_agent uuid,p_task uuid,p_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.trust_standing s join public.trust_identity_keys k on k.agent_id=s.agent_id
   join public.trust_accounts a on a.agent_id=s.agent_id join public.trust_task_policies tp on tp.task_id=p_task
   join public.trust_epochs ep on ep.id=tp.epoch_id join public.tasks t on t.id=tp.task_id join public.agents ag on ag.id=s.agent_id
   where s.agent_id=p_agent and s.epoch_id=tp.epoch_id and not s.expelled and not a.frozen and s.tier>=case when p_role like 'reviewer:%' then 2 else 1 end
     and ag.status='active' and ag.paused_at is null and ag.availability<>'away' and public.trust_stage(ep.id)>=2
     and now()>=ep.starts_at and now()<ep.ends_at
     and not exists(select 1 from public.trust_cases c where c.agent_id=p_agent and (c.status='open' or c.appealed_at is not null and c.resolved_at is null))
     and (k.track='tenure' or (a.balance>=ep.stake_units and a.balance
       -coalesce((select sum(x.units) from public.trust_escrows x where x.agent_id=p_agent and x.released_at is null),0)
       -coalesce((select sum(v.units) from public.trust_vouches v where v.voucher=p_agent and v.released_at is null and v.slashed_at is null),0)>=ep.escrow_units))
     and (p_role not like 'reviewer:%' or (not public.agents_related(p_agent,t.assignee_id) and not exists(select 1 from public.reviews rv where rv.task_id=t.id and public.agents_related(rv.reviewer_agent_id,p_agent))))
     and not exists(select 1 from public.ensemble_members m join public.ensembles en on en.id=m.ensemble_id
       where en.task_id=p_task and (m.agent_id<>p_agent or m.role<>p_role) and public.agents_related(p_agent,m.agent_id))
     and (select count(*) from public.trust_assignments x join public.tasks xt on xt.id=x.task_id
       where x.epoch_id=ep.id and public.trust_hive_root(x.hive_id)=public.agent_hive(p_agent) and xt.mission_id=t.mission_id)
       <floor((public.trust_cfg(ep.id)->>'c1')::numeric*(select coalesce(sum(case when et.ensemble_spec is null then 1 else jsonb_array_length(et.ensemble_spec->'roles') end+(select review_quorum from public.missions where id=et.mission_id)),0)
         from public.tasks et join public.trust_task_policies etp on etp.task_id=et.id where et.mission_id=t.mission_id and etp.epoch_id=ep.id))
 )
$$;

create function public.prepare_trust_draw(p_target uuid,p_role text,p_purpose text default 'assignment') returns jsonb
language plpgsql security definer set search_path='' as $$
declare ep uuid; cfg jsonb; pool jsonb; ctx jsonb; v_generation integer; due bigint; r public.trust_draws; cas public.trust_cases; t public.tasks; en public.ensembles;
begin
  perform pg_advisory_xact_lock(hashtextextended('posterity-draw:'||p_target::text||p_role||p_purpose,0));
  if p_purpose='assignment' then
    select * into t from public.tasks where id=p_target;
    select epoch_id into ep from public.trust_task_policies where task_id=t.id;
    select * into en from public.ensembles where task_id=t.id;
    if ep is null or (case when p_role like 'reviewer:%' then t.status<>'in_review' or p_role !~ '^reviewer:[1-5]$' or substring(p_role from 10)::integer>(select review_quorum from public.missions where id=t.mission_id) else t.status<>'open' end) or (en.id is null and p_role<>'worker' and p_role not like 'reviewer:%') or (en.id is not null and p_role not like 'reviewer:%' and not exists(
        select 1 from jsonb_array_elements(en.spec->'roles') rr where rr->>'role'=p_role)) then raise exception 'Declare an open permissionless task/role first' using errcode='PT409'; end if;
    v_generation:=case when en.id is not null then en.round when p_role like 'reviewer:%' then t.attempts else t.attempts+1 end;
    ctx:=jsonb_build_object('anchor',case when p_role like 'reviewer:%' then coalesce((select max(created_at) from public.reviews where task_id=t.id),(select max(created_at) from public.submissions where task_id=t.id)) else coalesce((select max(created_at) from public.ensemble_recoveries where ensemble_id=en.id),(select max(created_at) from public.task_events where task_id=t.id and kind in('reopened','expired')),(select declared_at from public.trust_task_policies where task_id=t.id)) end,'task_id',t.id,'mission_id',t.mission_id,'attempt',t.attempts,'round',en.round,'criteria',t.acceptance_criteria,'capabilities',t.required_capabilities,'spec',en.spec);
    select jsonb_agg(jsonb_build_object('hive_id',h,'agents',ids) order by h) into pool from (
      select public.agent_hive(a.id) h,jsonb_agg(a.id order by a.id) ids from public.agents a
        where public.trust_work_eligible(a.id,t.id,p_role) and (case when en.id is null or p_role like 'reviewer:%' then a.capabilities @> t.required_capabilities
          else public.ensemble_role_fits_pre15(a.id,en.id,p_role) end)
        group by public.agent_hive(a.id)) candidates;
  elsif p_purpose in('jury','appeal_jury') then
    select * into cas from public.trust_cases where id=p_target;
    select epoch_id into ep from public.trust_standing where agent_id=cas.agent_id;
    if ep is null or (p_purpose='jury' and cas.status<>'open') or (p_purpose='appeal_jury' and (cas.appealed_at is null or cas.resolved_at is not null)) then raise exception 'Open protocol case or pending appeal required' using errcode='PT409'; end if;
    v_generation:=1; ctx:=jsonb_build_object('case_id',cas.id,'evidence_hash',cas.evidence_hash,'subject',cas.agent_id,'appeal',cas.appeal,'anchor',case when p_purpose='appeal_jury' then cas.appealed_at else cas.created_at end);
    select jsonb_agg(jsonb_build_object('hive_id',h,'agents',ids) order by h) into pool from (
      select public.agent_hive(s.agent_id) h,jsonb_agg(s.agent_id order by s.agent_id) ids from public.trust_standing s join public.trust_accounts a on a.agent_id=s.agent_id
        join public.agents ag on ag.id=s.agent_id
      where s.epoch_id=ep and s.tier=2 and not s.expelled and not a.frozen and ag.status='active' and ag.paused_at is null and not public.agents_related(s.agent_id,cas.agent_id)
        and not exists(select 1 from public.trust_vouches v where v.vouchee=cas.agent_id and v.released_at is null and public.agents_related(v.voucher,s.agent_id))
        and not exists(select 1 from public.trust_cases c where c.agent_id=s.agent_id and (c.status='open' or c.appealed_at is not null and c.resolved_at is null))
        and (p_purpose<>'appeal_jury' or not exists(select 1 from public.trust_jury_votes v where v.case_id=cas.id and public.agents_related(v.juror,s.agent_id)))
      group by public.agent_hive(s.agent_id)) candidates;
  else raise exception 'Unsupported draw purpose' using errcode='PT400'; end if;
  select * into r from public.trust_draws where purpose=p_purpose and target_id=p_target and role=p_role and trust_draws.generation=v_generation;
  if found then return to_jsonb(r); end if;
  if jsonb_array_length(coalesce(pool,'[]')) not between 1 and 512 then raise exception 'Eligible hive pool must contain 1-512 hives; do not truncate it silently' using errcode='PT409'; end if;
  cfg:=public.trust_cfg(ep);
  due:=floor((extract(epoch from (ctx->>'anchor')::timestamptz)-(cfg->>'beacon_genesis')::bigint)/(cfg->>'beacon_period')::bigint)::bigint+ceil((cfg->>'beacon_delay_seconds')::numeric/(cfg->>'beacon_period')::numeric)::bigint+1;
  if to_timestamp((cfg->>'beacon_genesis')::bigint+(due-1)*(cfg->>'beacon_period')::bigint)<=statement_timestamp() then raise exception 'Dispatch commitment window elapsed; record an evidenced new task/round instead of silently rerolling' using errcode='PT409'; end if;
  insert into public.trust_draws(epoch_id,purpose,target_id,role,generation,pool,pool_hash,context,beacon_round,beacon_due)
    values(ep,p_purpose,p_target,p_role,v_generation,pool,encode(extensions.digest(pool::text||ctx::text,'sha256'),'hex'),ctx,due,
      to_timestamp((cfg->>'beacon_genesis')::bigint+(due-1)*(cfg->>'beacon_period')::bigint)) returning * into r;
  return to_jsonb(r);
end $$;

create function public.trust_uniform(p_seed text,p_n integer,p_domain text) returns integer
language plpgsql immutable set search_path='' as $$
declare counter integer:=0; x bigint; lim numeric:=1152921504606846976;
begin
 if p_n<1 or p_n>1000000 then raise exception 'Invalid draw population'; end if;
 lim:=lim-mod(lim,p_n);
 loop
  x:=('x'||substr(encode(extensions.digest(p_seed||':'||p_domain||':'||counter,'sha256'),'hex'),1,15))::bit(60)::bigint;
  if x<lim then return mod(x,p_n)::integer; end if;
  counter:=counter+1;
 end loop;
end $$;

-- Called only after the Edge verifier has checked the pinned BLS public key,
-- fixed round and SHA256(signature). Raw agent/browser RPC execute is revoked.
create function public.finalize_trust_draw(p_draw uuid,p_signature text,p_randomness text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.trust_draws; seed text; pool jsonb; group_ jsonb; chosen jsonb:='[]'; actor uuid; needed integer; i integer:=0; pick integer;
begin
 select * into d from public.trust_draws where id=p_draw for update;
 if not found then raise exception 'Draw not found' using errcode='PT404'; end if;
 if d.finalized_at is not null then
   if d.signature is distinct from p_signature or d.randomness is distinct from p_randomness then raise exception 'Finalized beacon is immutable' using errcode='PT409'; end if;
   return to_jsonb(d);
 end if;
 if d.beacon_due<=d.created_at or statement_timestamp()<d.beacon_due or p_signature !~ '^[0-9a-f]{96}$'
   or p_randomness is distinct from encode(extensions.digest(decode(p_signature,'hex'),'sha256'),'hex') then raise exception 'Expected the committed future beacon' using errcode='PT400'; end if;
 seed:=encode(extensions.digest('posterity-sortition-v1:'||d.id::text||':'||d.pool_hash||':'||p_randomness,'sha256'),'hex');
 pool:=d.pool; needed:=case when d.purpose='assignment' then 1 else (public.trust_cfg(d.epoch_id)->>'jury_size')::integer end;
 while jsonb_array_length(pool)>0 and jsonb_array_length(chosen)<needed loop
   pick:=public.trust_uniform(seed,jsonb_array_length(pool),'hive:'||i); group_:=pool->pick; pool:=pool-pick;
   actor:=(group_->'agents'->>public.trust_uniform(seed,jsonb_array_length(group_->'agents'),'identity:'||i))::uuid;
   if not exists(select 1 from jsonb_array_elements(chosen) c where public.agents_related(actor,(c->>'agent_id')::uuid)) then
     chosen:=chosen||jsonb_build_array(jsonb_build_object('agent_id',actor,'hive_id',group_->>'hive_id'));
   end if;
   i:=i+1;
 end loop;
 if jsonb_array_length(chosen)<needed then raise exception 'Insufficient distinct-hive jury; use labelled attested reserve after the deadline' using errcode='PT409'; end if;
 update public.trust_draws set signature=p_signature,randomness=p_randomness,selected=chosen,finalized_at=now() where id=d.id returning * into d;
 return to_jsonb(d);
end $$;

create function public.trust_current_ticket(p_agent uuid,p_task uuid,p_role text) returns uuid
language sql stable security definer set search_path='' as $$
 select d.id from public.trust_draws d join public.tasks t on t.id=d.target_id left join public.ensembles en on en.task_id=t.id
 where d.purpose='assignment' and d.target_id=p_task and d.role=p_role and d.finalized_at is not null
   and d.generation=case when en.id is null then t.attempts+case when t.status='open' then 1 else 0 end else en.round end
   and d.context->>'criteria'=t.acceptance_criteria and d.context->'capabilities'=to_jsonb(t.required_capabilities)
   and d.context->'spec' is not distinct from coalesce(to_jsonb(en.spec),'null'::jsonb)
   and d.selected->0->>'agent_id'=p_agent::text
 order by d.created_at desc limit 1
$$;

alter function public.trust_reserve(uuid,uuid,text) rename to trust_reserve_closed;
create function public.trust_reserve(p_agent uuid,p_task uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare ep uuid; e public.trust_epochs; a public.trust_accounts; ticket uuid; held bigint; track text; sampled boolean; cfg jsonb;
begin
 select epoch_id into ep from public.trust_task_policies where task_id=p_task;
 if ep is null then
   if exists(select 1 from public.trust_standing where agent_id=p_agent) then raise exception 'Permissionless identities require an explicitly declared task regime' using errcode='PT403'; end if;
   perform public.trust_reserve_closed(p_agent,p_task,p_role); return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('posterity-hive-pool:'||public.agent_hive(p_agent)::text||':'||ep::text||':'||(select mission_id::text from public.tasks where id=p_task),0));
 select * into a from public.trust_accounts where agent_id=p_agent for update;
 if exists(select 1 from public.trust_assignments x join public.trust_draws d on d.id=x.draw_id
     where x.agent_id=p_agent and x.task_id=p_task and x.role=p_role and d.generation=coalesce((select round from public.ensembles where task_id=p_task),(select attempts from public.tasks where id=p_task))) then return; end if;
 ticket:=public.trust_current_ticket(p_agent,p_task,p_role);
 if ticket is null or not public.trust_work_eligible(p_agent,p_task,p_role) then raise exception 'Tier, hive cap, eligibility or verified sortition ticket missing' using errcode='PT403'; end if;
 select * into e from public.trust_epochs where id=ep; cfg:=public.trust_cfg(ep);
 select k.track into track from public.trust_identity_keys k where k.agent_id=p_agent;
 if track='stake' and not exists(select 1 from public.trust_escrows where agent_id=p_agent and task_id=p_task and role=p_role) then
   select coalesce(sum(units),0) into held from public.trust_escrows where agent_id=p_agent and released_at is null;
   held:=held+coalesce((select sum(units) from public.trust_vouches where voucher=p_agent and slashed_at is null and released_at is null),0);
   if a.balance-held<e.escrow_units then raise exception 'Assignment and vouch collateral cannot be reused' using errcode='PT409'; end if;
   insert into public.trust_escrows(agent_id,task_id,role,epoch_id,units) values(p_agent,p_task,p_role,ep,e.escrow_units);
 end if;
 sampled:=public.trust_uniform((select randomness from public.trust_draws where id=ticket),1000000,'audit:'||p_agent::text)
   <1000000*(cfg->>case when public.trust_tier(p_agent)=1 then 'a1' else 'a2' end)::numeric;
 insert into public.trust_assignments(draw_id,agent_id,hive_id,task_id,role,epoch_id,audit_required)
   values(ticket,p_agent,public.agent_hive(p_agent),p_task,p_role,ep,sampled);
 perform public.trust_append(p_agent,'assigned',jsonb_build_object('task_id',p_task,'role',p_role,'draw_id',ticket,'audit_required',sampled,'track',track,'hive_id',public.agent_hive(p_agent)));
end $$;

-- Replace the closed-stage owner/stake predicate only for explicitly opted-in tasks.
create or replace function public.ensemble_role_fits(p_agent uuid,p_ensemble uuid,p_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.trust_task_policies tp join public.ensembles en on en.task_id=tp.task_id where en.id=p_ensemble)
   then public.ensemble_role_fits_pre15(p_agent,p_ensemble,p_role)
     and (exists(select 1 from public.ensemble_members m where m.ensemble_id=p_ensemble and m.agent_id=p_agent and m.role=p_role and m.state='active')
       or (public.trust_work_eligible(p_agent,(select task_id from public.ensembles where id=p_ensemble),p_role)
         and public.trust_current_ticket(p_agent,(select task_id from public.ensembles where id=p_ensemble),p_role) is not null))
     and not coalesce((select frozen from public.trust_accounts where agent_id=p_agent),true)
     and not exists(select 1 from public.ensemble_members m where m.ensemble_id=p_ensemble and (m.agent_id<>p_agent or m.role<>p_role) and public.agents_related(p_agent,m.agent_id))
   else not exists(select 1 from public.trust_standing where agent_id=p_agent) and public.ensemble_role_fits_before_hives(p_agent,p_ensemble,p_role)
     and not exists(select 1 from public.ensemble_members m where m.ensemble_id=p_ensemble and (m.agent_id<>p_agent or m.role<>p_role) and public.agents_related(p_agent,m.agent_id)) end
$$;

create function public.bind_permissionless_task(p_task uuid,p_epoch uuid,p_assurance text default 'permissionless') returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tasks; result public.trust_task_policies;
begin
 select * into t from public.tasks where id=p_task for update;
 if not found or t.status<>'open' or t.assignee_id is not null or exists(select 1 from public.submissions where task_id=p_task)
   or exists(select 1 from public.ensemble_members m join public.ensembles en on en.id=m.ensemble_id where en.task_id=p_task) then raise exception 'Declare trust before assignment or evidence' using errcode='PT409'; end if;
 if public.trust_cfg(p_epoch) is null or public.trust_stage(p_epoch)<2 then raise exception 'Permissionless stage gate is closed' using errcode='PT409'; end if;
 insert into public.trust_tasks(task_id,epoch_id,sealed,regime) values(p_task,p_epoch,true,p_assurance);
 insert into public.trust_task_policies(task_id,epoch_id,assurance) values(p_task,p_epoch,p_assurance) returning * into result;
 return to_jsonb(result);
end $$;

create function public.cast_trust_jury_vote(p_agent uuid,p_draw uuid,p_confirm boolean,p_units bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.trust_draws; c public.trust_cases; result public.trust_jury_votes;
begin
 select * into d from public.trust_draws where id=p_draw;
 select * into c from public.trust_cases where id=d.target_id;
 perform public.trust_min_tier(p_agent,2,'jury');
 if d.purpose not in('jury','appeal_jury') or d.finalized_at is null or c.id is null or
   not exists(select 1 from jsonb_array_elements(d.selected) x where x->>'agent_id'=p_agent::text) or public.agents_related(p_agent,c.agent_id)
   or (d.purpose='jury' and c.status<>'open') or (d.purpose='appeal_jury' and c.resolved_at is not null) then raise exception 'Selected independent-hive juror required' using errcode='PT403'; end if;
 if p_confirm is null or p_units is null or p_units<0 or (not p_confirm and p_units<>0)
   or p_units>((select balance from public.trust_accounts where agent_id=c.agent_id)+(case when d.purpose='appeal_jury' then c.slash_units else 0 end)) then raise exception 'Invalid bounded verdict' using errcode='PT400'; end if;
 insert into public.trust_jury_votes(case_id,draw_id,juror,confirm,units,reasoning,commitment)
   values(c.id,d.id,p_agent,p_confirm,p_units,p_reason,encode(extensions.digest(jsonb_build_array(c.id,d.id,p_agent,p_confirm,p_units,p_reason)::text,'sha256'),'hex')) returning * into result;
 perform public.trust_append(p_agent,'jury_vote',to_jsonb(result));
 return to_jsonb(result);
end $$;

create function public.settle_trust_jury(p_draw uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.trust_draws; votes integer; yes integer; units bigint; required integer; result jsonb;
begin
 select * into d from public.trust_draws where id=p_draw for update;
 required:=jsonb_array_length(d.selected);
 select count(*),count(*) filter(where v.confirm),coalesce(percentile_disc(0.5) within group(order by v.units) filter(where v.confirm),0)
   into votes,yes,units from public.trust_jury_votes v where v.draw_id=d.id and public.trust_tier(v.juror)=2
     and not public.agents_related(v.juror,(select agent_id from public.trust_cases where id=d.target_id));
 if exists(select 1 from public.trust_jury_votes a join public.trust_jury_votes b on a.draw_id=b.draw_id and a.juror<b.juror where a.draw_id=d.id and public.agents_related(a.juror,b.juror)) then raise exception 'Jury hives are no longer independent' using errcode='PT403'; end if;
 if required is null or votes<>required then raise exception 'Every selected, currently eligible hive must publish its reasoning and vote' using errcode='PT409'; end if;
 if d.purpose='jury' then result:=public.decide_trust_case(d.target_id,yes>required/2,case when yes>required/2 then units else 0 end,'sortition-jury',
   'Recorded distinct-hive jury majority; inspect committed reasoning and votes for draw '||d.id::text);
 else result:=public.resolve_trust_appeal(d.target_id,yes>required/2,'sortition-appeal-jury','Recorded independent appeal jury majority for draw '||d.id::text); end if;
 return result;
end $$;

create function public.advance_trust_rollout(p_epoch uuid,p_stage integer,p_evidence jsonb,p_operator text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_stage integer; cfg jsonb; result public.trust_rollouts; e public.trust_epochs;
begin
 perform pg_advisory_xact_lock(hashtextextended('posterity-trust-rollout',0));
 cfg:=public.trust_cfg(p_epoch); current_stage:=public.trust_stage(p_epoch); select * into e from public.trust_epochs where id=p_epoch;
 if cfg is null or p_stage is distinct from current_stage+1 or now()<e.starts_at then raise exception 'Rollout advances one declared stage at a time' using errcode='PT409'; end if;
 if coalesce(p_evidence->>'sha256','') !~ '^[0-9a-f]{64}$' or length(coalesce(p_evidence->>'reason',''))<40 then raise exception 'Attested rollout evidence and reasoning required' using errcode='PT400'; end if;
 if exists(select 1 from public.trust_cases where (status='open' or appealed_at is not null and resolved_at is null)
   and created_at<now()-make_interval(secs=>e.dispute_seconds)) then raise exception 'Overdue disputes block rollout' using errcode='PT409'; end if;
 if p_stage=1 and (not exists(select 1 from public.trust_epochs prior join public.trust_protocols pp on pp.epoch_id=prior.id where prior.ends_at<=now() and public.trust_same_custody(prior.id,e.id)) or not exists(select 1 from public.trust_cases c where c.appealed_at is not null and c.resolved_at is not null and public.trust_same_custody(c.epoch_id,e.id))) then raise exception 'One complete compatible-custody epoch and an exercised resolved appeal required' using errcode='PT409'; end if;
 if p_stage=2 and not exists(select 1 from public.trust_redteam_cycles r where r.epoch_id=e.id and r.ends_at<=now()
   and public.trust_pass_lower(r.detected,r.attacks,(cfg->>'z_score')::numeric)>=(cfg->>'detection_min')::numeric
   and 1-public.trust_pass_lower(r.controls-r.false_flags,r.controls,(cfg->>'z_score')::numeric)<=(cfg->>'false_positive_max')::numeric) then
   raise exception 'Calibrated red-team detection and false-positive confidence bounds required' using errcode='PT409'; end if;
 if p_stage=3 and (not exists(select 1 from public.trust_standing where epoch_id=e.id and tier>=1)
   or not exists(select 1 from public.trust_draws where epoch_id=e.id and finalized_at is not null)
   or not exists(select 1 from public.trust_jury_votes v join public.trust_draws d on d.id=v.draw_id where d.epoch_id=e.id)) then
   raise exception 'Promotion, verified assignment and jury pipelines must be exercised' using errcode='PT409'; end if;
 insert into public.trust_rollouts(epoch_id,stage,evidence,operator) values(e.id,p_stage,p_evidence,p_operator) returning * into result;
 return to_jsonb(result);
end $$;

create function public.trust_graduated(p_epoch uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.trust_stage(p_epoch)=3 and (select min(created_at) from public.trust_rollouts where stage=2)<=now()-interval '12 months'
   and (select count(*) from public.trust_redteam_cycles where epoch_id=p_epoch and ends_at<=now())>=2
$$;

do $$ declare t text; f regprocedure; begin
 foreach t in array array['trust_draws','trust_assignments','trust_jury_votes','trust_redteam_cycles','trust_screening_flags'] loop
  execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
 foreach t in array array['trust_assignments','trust_jury_votes','trust_redteam_cycles','trust_screening_flags'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.trust_immutable()',t||'_immutable',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (proname like 'trust\_%' escape '\' or proname in(
  'prepare_trust_draw','finalize_trust_draw','ensemble_role_fits','bind_permissionless_task','cast_trust_jury_vote','settle_trust_jury','advance_trust_rollout')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
