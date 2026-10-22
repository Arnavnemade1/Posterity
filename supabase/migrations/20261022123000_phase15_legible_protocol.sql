-- L2 carries legible reasons; opaque intra-agent/intra-hive cognition is not evidence.
alter table public.ensemble_contributions add column accountability_wire text;
alter table public.ensemble_contributions add column vector_hash text check(vector_hash ~ '^[0-9a-f]{64}$');
alter table public.ensemble_commitments add column algorithm text not null default 'text-v1' check(algorithm in('text-v1','accountable-v1'));
create table public.ensemble_sealing (ensemble_id uuid primary key references public.ensembles(id) on delete cascade,created_at timestamptz not null default now());
create table public.ensemble_admissibility (
 sequence bigint generated always as identity unique,
 id uuid primary key default gen_random_uuid(), contribution_id uuid not null references public.ensemble_contributions(id) on delete cascade,
 critic uuid not null, admissible boolean not null, reasoning text not null check(length(btrim(reasoning)) between 40 and 4000),created_at timestamptz not null default now()
);
create function public.ensemble_is_sealed(p_ensemble uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ensemble_sealing where ensemble_id=p_ensemble) or exists(select 1 from public.trust_tasks t join public.ensembles e on e.task_id=t.task_id where e.id=p_ensemble and t.sealed)
$$;
create function public.hive_sealing_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.agent_hive(new.agent_id) is not null then
  if exists(select 1 from public.ensemble_contributions where ensemble_id=new.ensemble_id) and not exists(select 1 from public.ensemble_sealing where ensemble_id=new.ensemble_id) then
   raise exception 'Declare hive and seal the round before any inter-hive evidence' using errcode='PT409'; end if;
  insert into public.ensemble_sealing(ensemble_id) values(new.ensemble_id) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger hive_sealed_roles before insert on public.ensemble_members for each row execute function public.hive_sealing_guard();
create function public.validate_accountability(p_wire text) returns void language plpgsql immutable set search_path='' as $$
declare a jsonb; k text; value jsonb;
begin
 if p_wire is null or octet_length(p_wire)>32000 then raise exception 'Legible accountability required (max 32000 UTF-8 bytes)' using errcode='PT400'; end if;
 a:=p_wire::jsonb;
 if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'reasoning') is distinct from 'string' or length(btrim(a->>'reasoning')) not between 40 and 8000 then raise exception 'Critic-engageable legible reasoning required' using errcode='PT400'; end if;
 foreach k in array array['claims','assumptions','evidence','uncertainties'] loop
  if jsonb_typeof(a->k) is distinct from 'array' or jsonb_array_length(a->k)>32 or (k='claims' and jsonb_array_length(a->k)=0) then raise exception 'Declare claims, assumptions, evidence and uncertainties explicitly' using errcode='PT400'; end if;
  for value in select * from jsonb_array_elements(a->k) loop
   if jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 3 and 2000 then raise exception 'Accountability fields must contain legible text' using errcode='PT400'; end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_object_keys(a) f where f not in('reasoning','claims','assumptions','evidence','uncertainties')) then raise exception 'Opaque or undeclared accountability fields are inadmissible' using errcode='PT400'; end if;
end $$;
create function public.accountable_draft_digest(p_e uuid,p_round integer,p_member uuid,p_kind text,p_summary text,p_content text,p_nonce text,p_wire text,p_vector text,p_algorithm text) returns text
language plpgsql immutable set search_path='' as $$
declare base text;
begin
 base:=public.sealed_text_digest(p_e,p_round,p_member,p_kind,p_summary,p_content,p_nonce);
 if p_algorithm='text-v1' then return base; end if;
 if p_algorithm<>'accountable-v1' or p_wire is null then return null; end if;
 return encode(extensions.digest(convert_to('posterity-accountable-v1:'||base||':'||octet_length(convert_to(p_wire,'UTF8'))||':'||p_wire||':'||coalesce(p_vector,''),'UTF8'),'sha256'),'hex');
end $$;
alter function public.ensemble_contribute(uuid,uuid,text,text,text,uuid,integer,text) rename to ensemble_contribute_before_accountability;
create function public.ensemble_contribute_accountable(p_agent uuid,p_ensemble uuid,p_kind text,p_summary text,p_content text default '',p_responds_to uuid default null,p_tokens int default 0,p_model text default null,p_accountability_wire text default null,p_vector_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; c public.ensemble_contributions; t public.tasks;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if exists(select 1 from public.ensemble_sealing where ensemble_id=e.id) then perform public.validate_accountability(p_accountability_wire); end if;
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
  insert into public.ensemble_contributions(ensemble_id,member_id,round,kind,summary,content,responds_to,accountability_wire,vector_hash)
    values(e.id,m.id,e.round,p_kind,p_summary,coalesce(p_content,''),p_responds_to,p_accountability_wire,p_vector_hash) returning * into c;
  if p_tokens>0 then perform public.record_usage(p_agent,t.mission_id,t.id,p_model,0,p_tokens,false); end if;
  update public.ensemble_members set lease_expires_at=now()+interval '60 minutes' where id=m.id;
  perform public.ensemble_event(e.id,p_agent,'ensemble_contribution',p_summary,jsonb_build_object('contribution_id',c.id,'role',m.role,'round',e.round));
  return to_jsonb(c);
end $$;

alter function public.ensemble_commit(uuid,uuid,integer,text) rename to ensemble_commit_before_accountability;
create function public.ensemble_commit_accountable(p_agent uuid,p_ensemble uuid,p_round integer,p_digest text,p_algorithm text default 'text-v1') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; c public.ensemble_commitments; v_roster uuid[];
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  perform public.ensemble_refresh(e.id);
  if e.round is distinct from p_round or not public.ensemble_is_sealed(e.id) then
    raise exception 'Expected a sealed testnet round' using errcode='PT409'; end if;
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active' and lease_expires_at>now();
  if not found or not public.ensemble_role_fits(p_agent,e.id,m.role) then raise exception 'Active fitting role required' using errcode='PT403'; end if;
  select array_agg(id order by id) into v_roster from public.ensemble_members where ensemble_id=e.id and state='active' and lease_expires_at>now();
  if cardinality(v_roster)<>jsonb_array_length(e.spec->'roles') then raise exception 'Fill the complete roster before committing' using errcode='PT409'; end if;
  select * into c from public.ensemble_commitments where ensemble_id=e.id and round=e.round and member_id=m.id;
  if found then
    if c.algorithm is distinct from p_algorithm or c.digest is distinct from p_digest or c.roster is distinct from v_roster then raise exception 'Commitment is immutable' using errcode='PT409'; end if;
    return to_jsonb(c);
  end if;
  if exists(select 1 from public.ensemble_contributions where ensemble_id=e.id and round=e.round)
    or exists(select 1 from public.ensemble_commitments ec where ec.ensemble_id=e.id and ec.round=e.round and ec.roster is distinct from v_roster) then
    raise exception 'Cannot commit after reveal or roster change' using errcode='PT409'; end if;
  if exists(select 1 from public.ensemble_sealing where ensemble_id=e.id) and p_algorithm<>'accountable-v1' then raise exception 'Inter-hive drafts must commit the full legible accountability set' using errcode='PT400'; end if;
  insert into public.ensemble_commitments(ensemble_id,round,member_id,digest,roster,algorithm) values(e.id,e.round,m.id,p_digest,v_roster,p_algorithm) returning * into c;
  if exists(select 1 from public.trust_accounts where agent_id=p_agent) then perform public.trust_append(p_agent,'draft_committed',jsonb_build_object('ensemble_id',e.id,'round',e.round,'member_id',m.id,'digest',p_digest)); end if;
  return to_jsonb(c);
end $$;

alter function public.ensemble_reveal(uuid,uuid,integer,text,text,text,text) rename to ensemble_reveal_before_accountability;
create function public.ensemble_reveal_accountable(p_agent uuid,p_ensemble uuid,p_round integer,p_kind text,p_summary text,p_content text,p_nonce text,p_accountability_wire text default null,p_vector_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; c public.ensemble_commitments; result jsonb;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  if e.round is distinct from p_round or not public.ensemble_is_sealed(e.id) then
    raise exception 'Expected a sealed testnet round' using errcode='PT409'; end if;
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active' and lease_expires_at>now();
  if not found then raise exception 'Active membership required' using errcode='PT403'; end if;
  select * into c from public.ensemble_commitments where ensemble_id=e.id and round=e.round and member_id=m.id;
  if not found then raise exception 'Commit before revealing' using errcode='PT409'; end if;
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{64}$' or c.digest is distinct from public.accountable_draft_digest(e.id,e.round,m.id,p_kind,p_summary,p_content,p_nonce,p_accountability_wire,p_vector_hash,c.algorithm) then
    raise exception 'Draft or nonce does not match commitment' using errcode='PT400'; end if;
  if c.revealed_at is not null then
    select to_jsonb(ec) into result from public.ensemble_contributions ec where ec.id=c.contribution_id;
    return result;
  end if;
  update public.ensemble_commitments set nonce=p_nonce where ensemble_id=e.id and round=e.round and member_id=m.id;
  result:=public.ensemble_contribute_accountable(p_agent,e.id,p_kind,p_summary,p_content,null,0,null,p_accountability_wire,p_vector_hash);
  update public.ensemble_commitments set contribution_id=(result->>'id')::uuid,revealed_at=now() where ensemble_id=e.id and round=e.round and member_id=m.id;
  if exists(select 1 from public.trust_accounts where agent_id=p_agent) then perform public.trust_append(p_agent,'draft_revealed',jsonb_build_object('ensemble_id',e.id,'round',e.round,'contribution_id',result->>'id','digest',c.digest)); end if;
  return result;
end $$;

create or replace function public.sealed_contribution_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; c public.ensemble_commitments; v_roster uuid[];
begin
  select * into e from public.ensembles where id=new.ensemble_id for update;
  if not public.ensemble_is_sealed(e.id) then return new; end if;
  select array_agg(id order by id) into v_roster from public.ensemble_members where ensemble_id=e.id and state='active' and lease_expires_at>now();
  select * into c from public.ensemble_commitments where ensemble_id=e.id and round=e.round and member_id=new.member_id;
  if not found or cardinality(v_roster)<>jsonb_array_length(e.spec->'roles') or c.roster is distinct from v_roster
    or (select count(*) from public.ensemble_commitments ec where ec.ensemble_id=e.id and ec.round=e.round and ec.roster=v_roster)<>cardinality(v_roster) then
    raise exception 'Every current role must commit before any reveal; recover a changed roster' using errcode='PT409'; end if;
  if c.revealed_at is null then
    if c.nonce is null or c.digest is distinct from public.accountable_draft_digest(e.id,e.round,new.member_id,new.kind,new.summary,new.content,c.nonce,new.accountability_wire,new.vector_hash,c.algorithm)
      or new.responds_to is not null then raise exception 'Reveal the exact committed initial draft first' using errcode='PT409'; end if;
  elsif exists(select 1 from public.ensemble_commitments ec where ec.ensemble_id=e.id and ec.round=e.round and ec.revealed_at is null) then
    raise exception 'Every initial draft must be revealed before further deliberation' using errcode='PT409';
  end if;
  return new;
end $$;
create or replace function public.sealed_score_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.ensembles;
begin
  select en.* into e from public.ensembles en join public.ensemble_contributions c on c.ensemble_id=en.id where c.id=new.contribution_id for update of en;
  if exists(select 1 from public.trust_tasks where task_id=e.task_id) and
    exists(select 1 from public.trust_accounts where agent_id=new.scorer_id and frozen) then
    raise exception 'Frozen testnet identities cannot peer-score opted-in work' using errcode='PT403'; end if;
  if public.ensemble_is_sealed(e.id) and (
    exists(select 1 from public.ensemble_commitments c where c.ensemble_id=e.id and c.round=e.round and c.revealed_at is null)
    or not exists(select 1 from public.ensemble_commitments c join public.ensemble_members m on m.id=c.member_id
      where c.ensemble_id=e.id and c.round=e.round and m.agent_id=new.scorer_id and c.revealed_at is not null)) then
    raise exception 'Uncommitted or unrevealed roles cannot score' using errcode='PT403'; end if;
  return new;
end $$;
create or replace function public.recover_sealed_round(p_ensemble uuid,p_round integer,p_operator text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; t public.tasks; c public.ensemble_commitments; v_roster uuid[]; result public.ensemble_recoveries;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  begin
    select * into t from public.tasks where id=e.task_id for update nowait;
  exception when lock_not_available then raise exception 'Task is changing; retry recovery' using errcode='PT409'; end;
  if e.round is distinct from p_round or e.status not in ('active','recruiting') or t.status<>'open'
    or not exists(select 1 from public.missions where id=t.mission_id and status='active')
    or not public.ensemble_is_sealed(e.id) then
    raise exception 'Recovery needs the expected sealed open round' using errcode='PT409'; end if;
  if length(btrim(coalesce(p_operator,''))) not between 3 and 120 or length(btrim(coalesce(p_reason,''))) not between 10 and 4000 then
    raise exception 'Attested operator and specific recovery reason required' using errcode='PT400'; end if;
  perform public.ensemble_refresh(e.id);
  select array_agg(id order by id) into v_roster from public.ensemble_members where ensemble_id=e.id and state='active' and lease_expires_at>now();
  select * into c from public.ensemble_commitments where ensemble_id=e.id and round=e.round limit 1;
  if c.member_id is null or (c.roster is not distinct from v_roster and not exists(select 1 from public.ensemble_commitments ec
      where ec.ensemble_id=e.id and ec.round=e.round and ec.revealed_at is null and ec.committed_at<=now()-interval '60 minutes')) then
    raise exception 'Recovery requires a changed roster or a commitment withheld for 60 minutes' using errcode='PT409'; end if;
  insert into public.ensemble_recoveries(ensemble_id,round,operator,reason) values(e.id,e.round,p_operator,p_reason) returning * into result;
  update public.ensembles set round=round+1 where id=e.id;
  perform public.ensemble_event(e.id,null,'ensemble_recovered',p_reason,jsonb_build_object('recovery_id',result.id,'previous_round',e.round,'sealed',true,'operator',p_operator));
  return to_jsonb(result);
end $$;

create function public.ensemble_contribute(p_agent uuid,p_ensemble uuid,p_kind text,p_summary text,p_content text default '',p_responds_to uuid default null,p_tokens int default 0,p_model text default null) returns jsonb
language sql security definer set search_path='' as $$ select public.ensemble_contribute_accountable(p_agent,p_ensemble,p_kind,p_summary,p_content,p_responds_to,p_tokens,p_model) $$;
create function public.ensemble_commit(p_agent uuid,p_ensemble uuid,p_round integer,p_digest text) returns jsonb
language sql security definer set search_path='' as $$ select public.ensemble_commit_accountable(p_agent,p_ensemble,p_round,p_digest) $$;
create function public.ensemble_reveal(p_agent uuid,p_ensemble uuid,p_round integer,p_kind text,p_summary text,p_content text,p_nonce text) returns jsonb
language sql security definer set search_path='' as $$ select public.ensemble_reveal_accountable(p_agent,p_ensemble,p_round,p_kind,p_summary,p_content,p_nonce) $$;

create function public.assess_ensemble_admissibility(p_agent uuid,p_contribution uuid,p_admissible boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.ensemble_contributions; author uuid; result public.ensemble_admissibility;
begin
 select * into c from public.ensemble_contributions where id=p_contribution;
 select agent_id into author from public.ensemble_members where id=c.member_id;
 if c.id is null or public.agents_related(p_agent,author) or (not exists(select 1 from public.ensemble_members m join public.ensembles e on e.id=m.ensemble_id
   where m.ensemble_id=c.ensemble_id and m.agent_id=p_agent and m.role='critic' and m.state='active' and m.lease_expires_at>now() and e.round=c.round)
   and public.trust_tier(p_agent) is distinct from 2) then raise exception 'Independent critic or T2 reviewer required' using errcode='PT403'; end if;
 perform public.trust_min_tier(p_agent,1,'admissibility assessment');
 perform public.validate_accountability(c.accountability_wire);
 insert into public.ensemble_admissibility(contribution_id,critic,admissible,reasoning) values(c.id,p_agent,p_admissible,p_reason) returning * into result;
 return to_jsonb(result);
end $$;
create function public.vector_admissibility_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.ensemble_contributions; allowed boolean;
begin
 select * into c from public.ensemble_contributions where id=new.contribution_id;
 if c.vector_hash is not null then
  perform public.validate_accountability(c.accountability_wire);
  select a.admissible into allowed from public.ensemble_admissibility a join public.ensemble_members m on m.id=c.member_id
    where a.contribution_id=c.id and not public.agents_related(a.critic,m.agent_id) order by a.sequence desc limit 1;
  if allowed is distinct from true then raise exception 'Vector-derived evidence needs an independent critic-engageable legible summary and affirmative admissibility assessment' using errcode='PT403'; end if;
 end if;
 return new;
end $$;
create trigger vector_reason_admissibility before insert on public.ensemble_attributions for each row execute function public.vector_admissibility_guard();

alter function public.ensemble_view(uuid) rename to ensemble_view_before_hive_protocol;
create function public.ensemble_view(p_ensemble uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.ensemble_view_before_hive_protocol(p_ensemble)||jsonb_build_object('communication_levels',jsonb_build_object(
  'L0','unrestricted intra-agent cognition','L1','unrestricted intra-hive deliberation; hive is one party','L2','legible accountability and sealed commitment only'),
  'sealed',public.ensemble_is_sealed(p_ensemble),
  'admissibility',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]') from public.ensemble_admissibility a join public.ensemble_contributions c on c.id=a.contribution_id where c.ensemble_id=p_ensemble),
  'hives',(select coalesce(jsonb_agg(jsonb_build_object('agent_id',m.agent_id,'hive_id',m.hive_id,'party_id',public.agent_hive(m.agent_id))),'[]') from public.ensemble_members m where m.ensemble_id=p_ensemble))
$$;
do $$ declare t text; f regprocedure; begin
 foreach t in array array['ensemble_sealing','ensemble_admissibility'] loop
  execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in(
  'ensemble_is_sealed','hive_sealing_guard','validate_accountability','accountable_draft_digest','ensemble_contribute','ensemble_commit','ensemble_reveal',
  'ensemble_contribute_accountable','ensemble_commit_accountable','ensemble_reveal_accountable','ensemble_contribute_before_accountability','ensemble_commit_before_accountability','ensemble_reveal_before_accountability','sealed_contribution_guard','sealed_score_guard',
  'recover_sealed_round','assess_ensemble_admissibility','vector_admissibility_guard','ensemble_view','ensemble_view_before_hive_protocol') loop
  execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
