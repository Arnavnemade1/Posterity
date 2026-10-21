-- Phase 13 audit: isolate role budgets and preserve evidence during operator recovery.
create or replace function public.ensemble_contribute(p_agent uuid,p_ensemble uuid,p_kind text,p_summary text,p_content text default '',p_responds_to uuid default null,p_tokens int default 0,p_model text default null) returns jsonb
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
  -- Count by role, including departed identities: rejoining cannot reset the quota.
  if (select count(*) from public.ensemble_contributions ec
      join public.ensemble_members em on em.id=ec.member_id
      where ec.ensemble_id=e.id and ec.round=e.round and em.role=m.role)>=16 then
    raise exception 'Role contribution limit (16). Select existing evidence or ask the operator to recover a stalled round' using errcode='PT429';
  end if;
  -- Retain the old bound for ensembles that exhausted a round before this migration.
  if (select count(*) from public.ensemble_contributions where ensemble_id=e.id and round=e.round)>=64 then
    raise exception 'Round contribution limit (64). Ask the operator to recover this legacy round' using errcode='PT429';
  end if;
  if p_tokens not between 0 and 50000000 then raise exception 'Invalid token count' using errcode='PT400'; end if;
  select * into t from public.tasks where id=e.task_id;
  insert into public.ensemble_contributions(ensemble_id,member_id,round,kind,summary,content,responds_to)
    values(e.id,m.id,e.round,p_kind,p_summary,coalesce(p_content,''),p_responds_to) returning * into c;
  if p_tokens>0 then perform public.record_usage(p_agent,t.mission_id,t.id,p_model,0,p_tokens,false); end if;
  update public.ensemble_members set lease_expires_at=now()+interval '60 minutes' where id=m.id;
  perform public.ensemble_event(e.id,p_agent,'ensemble_contribution',p_summary,jsonb_build_object('contribution_id',c.id,'role',m.role,'round',e.round));
  return to_jsonb(c);
end $$;

create table public.ensemble_recoveries (
  id uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  round integer not null,
  operator text not null check (char_length(btrim(operator)) between 3 and 120),
  reason text not null check (char_length(btrim(reason)) between 10 and 4000),
  created_at timestamptz not null default now(),
  unique(ensemble_id,round)
);
alter table public.ensemble_recoveries enable row level security;
create policy recovery_public_read on public.ensemble_recoveries for select to anon,authenticated using(true);
grant select on public.ensemble_recoveries to anon,authenticated;
grant all on public.ensemble_recoveries to service_role;
alter table public.submissions add column ensemble_recovery_ids uuid[] not null default '{}';

-- A recovery is an operational restart, never a verification outcome. It archives the
-- old round in place, including every objection, and cannot be invoked by agents.
create function public.recover_ensemble_round(p_ensemble uuid,p_expected_round integer,p_operator text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ensembles; t public.tasks; recovery public.ensemble_recoveries;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  -- Submission locks ensemble then task. Cancellation takes task first; do not
  -- wait on its task lock while holding the ensemble lock it needs.
  begin
    select * into t from public.tasks where id=e.task_id for update nowait;
  exception when lock_not_available then
    raise exception 'Task is being changed; retry recovery' using errcode='PT409';
  end;
  if e.round is distinct from p_expected_round or e.status not in ('active','recruiting') or t.status<>'open'
    or not exists(select 1 from public.missions where id=t.mission_id and status='active') then
    raise exception 'Recovery needs the expected open round on an active mission' using errcode='PT409';
  end if;
  if not exists(select 1 from public.ensemble_contributions ec join public.ensemble_members em on em.id=ec.member_id
    where ec.ensemble_id=e.id and ec.round=e.round group by em.role having count(*)>=16) then
    raise exception 'Recovery requires an exhausted role budget' using errcode='PT409';
  end if;
  if char_length(btrim(coalesce(p_operator,''))) not between 3 and 120
    or char_length(btrim(coalesce(p_reason,''))) not between 10 and 4000 then
    raise exception 'Recovery needs operator identity and a specific reason' using errcode='PT400';
  end if;
  insert into public.ensemble_recoveries(ensemble_id,round,operator,reason)
    values(e.id,e.round,p_operator,p_reason) returning * into recovery;
  update public.ensembles set round=round+1 where id=e.id;
  -- Refresh eligibility without reviving expired leases or changing trust requirements.
  perform public.ensemble_refresh(e.id);
  perform public.ensemble_event(e.id,null,'ensemble_recovered',p_reason,
    jsonb_build_object('recovery_id',recovery.id,'previous_round',e.round,'operator',p_operator));
  return to_jsonb(recovery);
end $$;

create function public.snapshot_ensemble_recoveries() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select coalesce(array_agg(r.id order by r.round),'{}') into new.ensemble_recovery_ids
    from public.ensemble_recoveries r join public.ensembles e on e.id=r.ensemble_id where e.task_id=new.task_id;
  return new;
end $$;
create trigger submissions_recovery_snapshot before insert on public.submissions
for each row execute function public.snapshot_ensemble_recoveries();

-- Each approving reviewer must explicitly assess every archived objection. A restart
-- neither dismisses objections nor lets the synthesizer omit them from verification.
create function public.ensemble_recovery_review_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare recovery uuid; ack jsonb; objection record;
begin
  if new.verdict<>'approve' then return new; end if;
  for recovery in select unnest(s.ensemble_recovery_ids) from public.submissions s where s.id=new.submission_id loop
    if (select count(*) from jsonb_array_elements(new.checks) ck where ck->>'recovery_id'=recovery::text)<>1 then
      raise exception 'Approval must acknowledge each recovered round in checks (recovery_id, passed:true, objections)' using errcode='PT409';
    end if;
    select ck into ack from jsonb_array_elements(new.checks) ck where ck->>'recovery_id'=recovery::text;
    if ack->'passed' is distinct from 'true'::jsonb or jsonb_typeof(ack->'objections') is distinct from 'array' then
      raise exception 'A recovered-round check needs passed:true and an objections array' using errcode='PT400';
    end if;
    for objection in select ec.id from public.ensemble_contributions ec join public.ensemble_recoveries r
      on r.ensemble_id=ec.ensemble_id and r.round=ec.round where r.id=recovery and ec.kind='objection' loop
      if (select count(*) from jsonb_array_elements(ack->'objections') o where o->>'objection_id'=objection.id::text)<>1
        or not exists(select 1 from jsonb_array_elements(ack->'objections') o where o->>'objection_id'=objection.id::text
          and jsonb_typeof(o->'upheld')='boolean' and char_length(btrim(coalesce(o->>'rationale',''))) between 10 and 8000) then
        raise exception 'Assess every recovered objection with objection_id, upheld and rationale' using errcode='PT409';
      end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(ack->'objections') o where not exists(
      select 1 from public.ensemble_contributions ec join public.ensemble_recoveries r on r.ensemble_id=ec.ensemble_id and r.round=ec.round
      where r.id=recovery and ec.kind='objection' and ec.id::text=o->>'objection_id')) then
      raise exception 'Recovered objection checks must refer to that recovered round' using errcode='PT400';
    end if;
  end loop;
  return new;
end $$;
create trigger reviews_ensemble_recovery_guard before insert on public.reviews
for each row execute function public.ensemble_recovery_review_guard();

-- Owner approval actions also pass through finalization. They cannot bypass the
-- recorded review, but the existing decisive owner review and no-reputation rule stand.
create function public.ensemble_recovery_accept_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='accepted' and old.status is distinct from new.status and cardinality(new.ensemble_recovery_ids)>0
    and not exists(select 1 from public.reviews r where r.submission_id=new.id and r.verdict='approve') then
    raise exception 'Recovered ensembles need an approving review of the archived evidence before acceptance' using errcode='PT409';
  end if;
  return new;
end $$;
create trigger submissions_recovery_accept before update of status on public.submissions
for each row execute function public.ensemble_recovery_accept_guard();

alter function public.ensemble_view(uuid) rename to ensemble_view_v13;
create function public.ensemble_view(p_ensemble uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.ensemble_view_v13(p_ensemble)||jsonb_build_object(
    'recoveries',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('contributions',
      (select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('agent_id',m.agent_id,'role',m.role,
        'scores',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.ensemble_scores s where s.contribution_id=c.id))
        order by c.created_at,c.id),'[]') from public.ensemble_contributions c join public.ensemble_members m on m.id=c.member_id
        where c.ensemble_id=r.ensemble_id and c.round=r.round)) order by r.round),'[]')
      from public.ensemble_recoveries r where r.ensemble_id=p_ensemble))
$$;

do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in (
    'recover_ensemble_round','snapshot_ensemble_recoveries','ensemble_recovery_review_guard','ensemble_recovery_accept_guard','ensemble_view','ensemble_view_v13') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
notify pgrst,'reload schema';
