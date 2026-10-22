-- Phase 15.0: CLOSED TESTNET. Units have no monetary value and do not prove custody.
-- The existing attested regime remains authoritative. No permissionless enrollment,
-- tier promotion, production funds, VRF claim, or new reputation authority is enabled.
create table public.trust_epochs (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null unique,
  ends_at timestamptz not null check (ends_at > starts_at),
  stake_units bigint not null check (stake_units between 1 and 1000000000),
  escrow_units bigint not null check (escrow_units between 1 and stake_units),
  dispute_seconds integer not null check (dispute_seconds between 60 and 2592000),
  reward_cap numeric not null check (reward_cap > 0 and reward_cap <= 1000),
  operator text not null check (length(btrim(operator)) between 3 and 120),
  reason text not null check (length(btrim(reason)) between 10 and 2000),
  regime text not null default 'attested_testnet' check (regime='attested_testnet'),
  custody text not null default 'test_units' check (custody='test_units'),
  created_at timestamptz not null default now()
);
create table public.trust_accounts (
  agent_id uuid primary key, -- Historical keys survive deletion of a live agent.
  epoch_id uuid not null references public.trust_epochs(id),
  balance bigint not null default 0 check (balance >= 0),
  frozen boolean not null default false,
  enrolled_at timestamptz not null default now()
);
create table public.trust_events (
  agent_id uuid not null references public.trust_accounts(agent_id),
  sequence bigint not null,
  kind text not null,
  data jsonb not null,
  previous_hash text not null,
  canonical text not null,
  hash text not null,
  created_at timestamptz not null default now(),
  primary key (agent_id,sequence),
  unique(hash)
);
create table public.trust_receipts (
  receipt text primary key check (length(receipt) between 8 and 200),
  agent_id uuid not null references public.trust_accounts(agent_id),
  units bigint not null check (units between 1 and 1000000000),
  operator text not null check (length(btrim(operator)) between 3 and 120),
  created_at timestamptz not null default now()
);
create table public.trust_tasks (
  task_id uuid primary key, -- No audit foreign key may lock ordinary task transitions.
  epoch_id uuid not null references public.trust_epochs(id),
  regime text not null default 'attested_staked_testnet' check (regime='attested_staked_testnet'),
  sealed boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.trust_escrows (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.trust_accounts(agent_id),
  task_id uuid not null,
  role text not null,
  epoch_id uuid not null references public.trust_epochs(id),
  units bigint not null check (units>0),
  settled_at timestamptz,
  release_after timestamptz,
  released_at timestamptz,
  unique(agent_id,task_id,role)
);
create index trust_encumbered on public.trust_escrows(agent_id) where released_at is null;
create table public.trust_cases (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.trust_accounts(agent_id),
  task_id uuid,
  kind text not null check (kind in ('self_dealing','review_fraud','objection_fraud','correlation')),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  evidence_url text not null check (evidence_url ~ '^https://[^[:space:]]+$' and length(evidence_url) between 9 and 1908),
  operator text not null check (length(btrim(operator)) between 3 and 120),
  status text not null default 'open' check (status in ('open','dismissed','confirmed')),
  slash_units bigint not null default 0 check (slash_units>=0),
  reasoning text,
  appeal text,
  appealed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.ensemble_commitments (
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  round integer not null,
  member_id uuid not null references public.ensemble_members(id) on delete cascade,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  roster uuid[] not null,
  contribution_id uuid references public.ensemble_contributions(id),
  nonce text,
  committed_at timestamptz not null default now(),
  revealed_at timestamptz,
  primary key (ensemble_id,round,member_id)
);

create function public.trust_append(p_agent uuid,p_kind text,p_data jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare n bigint; prev text; wire text; h text;
begin
  perform 1 from public.trust_accounts where agent_id=p_agent for update;
  if not found then raise exception 'Trust account not found' using errcode='PT404'; end if;
  select sequence+1,hash into n,prev from public.trust_events where agent_id=p_agent order by sequence desc limit 1;
  n:=coalesce(n,1); prev:=coalesce(prev,repeat('0',64));
  wire:='posterity-trust-v1:'||p_agent::text||':'||n||':'||prev||':'||p_kind||':'||p_data::text;
  h:=encode(extensions.digest(convert_to(wire,'UTF8'),'sha256'),'hex');
  insert into public.trust_events(agent_id,sequence,kind,data,previous_hash,canonical,hash)
    values(p_agent,n,p_kind,p_data,prev,wire,h);
  return h;
end $$;

create function public.declare_trust_epoch(p_starts timestamptz,p_ends timestamptz,p_stake bigint,p_escrow bigint,
  p_dispute_seconds integer,p_reward_cap numeric,p_operator text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.trust_epochs;
begin
  perform pg_advisory_xact_lock(hashtextextended('posterity-trust-epochs',0));
  if p_starts<statement_timestamp() then raise exception 'Declare epochs before they start' using errcode='PT400'; end if;
  if exists(select 1 from public.trust_epochs where p_starts<ends_at and p_ends>starts_at) then
    raise exception 'Trust epochs cannot overlap' using errcode='PT409'; end if;
  insert into public.trust_epochs(starts_at,ends_at,stake_units,escrow_units,dispute_seconds,reward_cap,operator,reason)
    values(p_starts,p_ends,p_stake,p_escrow,p_dispute_seconds,p_reward_cap,p_operator,p_reason) returning * into e;
  return to_jsonb(e);
end $$;

create function public.trust_status() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('stage','15.0-testnet','experimental',true,'permissionless',false,
    'assumption','Existing attested identities; non-monetary test units. Permissionless Sybil resistance unspecified.',
    'custody','test_units','epoch',(select to_jsonb(e) from public.trust_epochs e where now()>=starts_at and now()<ends_at),
    'blocked_stages',jsonb_build_array('15.1','15.2','15.3'))
$$;

create function public.trust_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Trust declarations and history are append-only' using errcode='PT403'; end $$;
create trigger trust_epoch_immutable before update or delete on public.trust_epochs for each row execute function public.trust_immutable();
create trigger trust_event_immutable before update or delete on public.trust_events for each row execute function public.trust_immutable();
create trigger trust_receipt_immutable before update or delete on public.trust_receipts for each row execute function public.trust_immutable();
create trigger trust_contract_immutable before update or delete on public.trust_tasks for each row execute function public.trust_immutable();

create function public.trust_enroll(p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.trust_epochs; a public.trust_accounts;
begin
  if not exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null and owner_id is not null) then
    raise exception 'Closed testnet enrollment needs an active, claimed attested agent' using errcode='PT403'; end if;
  select * into e from public.trust_epochs where now()>=starts_at and now()<ends_at;
  if not found then raise exception 'No declared active testnet epoch' using errcode='PT409'; end if;
  insert into public.trust_accounts(agent_id,epoch_id) values(p_agent,e.id) on conflict do nothing returning * into a;
  if found then perform public.trust_append(p_agent,'enrolled',jsonb_build_object('epoch_id',e.id,'regime',e.regime,'custody',e.custody));
  else select * into a from public.trust_accounts where agent_id=p_agent; end if;
  return to_jsonb(a);
end $$;

create function public.credit_trust_test_units(p_agent uuid,p_units bigint,p_receipt text,p_operator text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.trust_accounts; r public.trust_receipts;
begin
  select * into a from public.trust_accounts where agent_id=p_agent for update;
  if not found then raise exception 'Enroll first' using errcode='PT404'; end if;
  select * into r from public.trust_receipts where receipt=p_receipt;
  if found then
    if r.agent_id<>p_agent or r.units<>p_units then raise exception 'Receipt already used for different credit' using errcode='PT409'; end if;
    return to_jsonb(a);
  end if;
  insert into public.trust_receipts(receipt,agent_id,units,operator) values(p_receipt,p_agent,p_units,p_operator);
  update public.trust_accounts set balance=balance+p_units where agent_id=p_agent returning * into a;
  perform public.trust_append(p_agent,'test_credit',jsonb_build_object('units',p_units,'receipt',p_receipt,'operator',p_operator));
  return to_jsonb(a);
end $$;

create function public.bind_trust_task(p_task uuid,p_sealed boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tasks; e public.trust_epochs; b public.trust_tasks;
begin
  select * into t from public.tasks where id=p_task for update;
  if not found then raise exception 'Task not found' using errcode='PT404'; end if;
  select * into b from public.trust_tasks where task_id=p_task;
  if found then
    if b.sealed is distinct from p_sealed then raise exception 'Task trust contract is immutable' using errcode='PT409'; end if;
    return to_jsonb(b);
  end if;
  if t.status<>'open' or t.assignee_id is not null or exists(select 1 from public.submissions where task_id=p_task)
    or exists(select 1 from public.ensemble_members m join public.ensembles en on en.id=m.ensemble_id where en.task_id=p_task) then
    raise exception 'Declare trust before any assignment or submission' using errcode='PT409'; end if;
  select * into e from public.trust_epochs where now()>=starts_at and now()<ends_at;
  if not found then raise exception 'No declared active testnet epoch' using errcode='PT409'; end if;
  insert into public.trust_tasks(task_id,epoch_id,sealed) values(p_task,e.id,p_sealed) returning * into b;
  return to_jsonb(b);
end $$;

create function public.trust_reserve(p_agent uuid,p_task uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.trust_tasks; a public.trust_accounts; e public.trust_epochs; held bigint; x public.trust_escrows;
begin
  select * into b from public.trust_tasks where task_id=p_task;
  if not found then return; end if;
  select * into a from public.trust_accounts where agent_id=p_agent for update;
  if not found or a.frozen or not exists(select 1 from public.agents where id=p_agent and owner_id is not null and status='active' and paused_at is null) then
    raise exception 'Task requires an unfrozen, claimed testnet account' using errcode='PT403'; end if;
  select * into e from public.trust_epochs where id=b.epoch_id;
  select * into x from public.trust_escrows where agent_id=p_agent and task_id=p_task and role=p_role;
  if found and x.released_at is null then return; end if;
  if found then raise exception 'Settled escrow cannot be reused' using errcode='PT409'; end if;
  if now()>=e.ends_at or now()<e.starts_at then raise exception 'New assignments require an active task epoch' using errcode='PT409'; end if;
  select coalesce(sum(units),0) into held from public.trust_escrows where agent_id=p_agent and released_at is null;
  if a.balance<e.stake_units or a.balance-held<e.escrow_units then
    raise exception 'Insufficient unencumbered test stake' using errcode='PT409'; end if;
  if exists(select 1 from public.trust_cases where agent_id=p_agent and (status='open' or appealed_at is not null and resolved_at is null)) then
    raise exception 'Open dispute prevents new exposure' using errcode='PT409'; end if;
  insert into public.trust_escrows(agent_id,task_id,role,epoch_id,units) values(p_agent,p_task,p_role,e.id,e.escrow_units);
  perform public.trust_append(p_agent,'reserved',jsonb_build_object('task_id',p_task,'role',p_role,'epoch_id',e.id,'units',e.escrow_units,'regime',b.regime));
end $$;

create function public.trust_assignment_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='tasks' then
    if new.status='claimed' and (old.assignee_id is distinct from new.assignee_id or old.status<>'claimed')
      and not exists(select 1 from public.ensembles where task_id=new.id) then
      perform public.trust_reserve(new.assignee_id,new.id,'worker');
    end if;
  elsif new.state='active' then
    perform public.trust_reserve(new.agent_id,(select task_id from public.ensembles where id=new.ensemble_id),new.role);
  end if;
  return new;
end $$;
create trigger trust_task_assignment before update on public.tasks for each row execute function public.trust_assignment_guard();
create trigger trust_member_assignment before insert on public.ensemble_members for each row execute function public.trust_assignment_guard();

alter function public.ensemble_role_fits(uuid,uuid,text) rename to ensemble_role_fits_pre15;
create function public.ensemble_role_fits(p_agent uuid,p_ensemble uuid,p_role text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.ensemble_role_fits_pre15(p_agent,p_ensemble,p_role) and (
    not exists(select 1 from public.trust_tasks t join public.ensembles e on e.task_id=t.task_id where e.id=p_ensemble)
    or exists(select 1 from public.trust_accounts a join public.agents ag on ag.id=a.agent_id
      join public.ensembles en on en.id=p_ensemble join public.trust_tasks tt on tt.task_id=en.task_id
      join public.trust_epochs ep on ep.id=tt.epoch_id
      where a.agent_id=p_agent and not a.frozen and ag.owner_id is not null and (
        exists(select 1 from public.trust_escrows x where x.agent_id=a.agent_id and x.task_id=tt.task_id and x.role=p_role and x.released_at is null)
        or (now()>=ep.starts_at and now()<ep.ends_at and a.balance>=ep.stake_units
          and a.balance-coalesce((select sum(x.units) from public.trust_escrows x where x.agent_id=a.agent_id and x.released_at is null),0)>=ep.escrow_units
          and not exists(select 1 from public.trust_cases c where c.agent_id=a.agent_id and (c.status='open' or c.appealed_at is not null and c.resolved_at is null))))))
$$;

create function public.trust_submission_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  if tg_table_name='reviews' then actor:=new.reviewer_agent_id; else actor:=new.agent_id; end if;
  if exists(select 1 from public.trust_tasks where task_id=new.task_id) and
    exists(select 1 from public.trust_accounts where agent_id=actor and frozen) then
    raise exception 'Frozen testnet identities cannot submit or review opted-in work' using errcode='PT403'; end if;
  return new;
end $$;
create trigger trust_submission before insert on public.submissions for each row execute function public.trust_submission_guard();
create trigger trust_review before insert on public.reviews for each row execute function public.trust_submission_guard();

create function public.trust_settle_task() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;
begin
  if new.status in ('done','cancelled') and old.status is distinct from new.status then
    -- Account -> escrow is the common lock order for reserve, release and settlement.
    perform 1 from public.trust_accounts a where exists(select 1 from public.trust_escrows x where x.agent_id=a.agent_id and x.task_id=new.id)
      order by a.agent_id for update;
    for r in update public.trust_escrows x set settled_at=now(),release_after=now()+make_interval(secs=>e.dispute_seconds)
      from public.trust_epochs e where x.epoch_id=e.id and x.task_id=new.id and x.settled_at is null returning x.* loop
      perform public.trust_append(r.agent_id,'settled',jsonb_build_object('escrow_id',r.id,'task_id',new.id,'release_after',r.release_after));
    end loop;
  end if;
  return new;
end $$;
create trigger trust_task_settled after update of status on public.tasks for each row execute function public.trust_settle_task();

create function public.trust_release(p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare released bigint:=0; r record;
begin
  perform 1 from public.trust_accounts where agent_id=p_agent for update;
  if not found then raise exception 'Enroll first' using errcode='PT404'; end if;
  if exists(select 1 from public.trust_cases where agent_id=p_agent and (status='open' or appealed_at is not null and resolved_at is null)) then
    raise exception 'Resolve disputes before releasing escrow' using errcode='PT409'; end if;
  for r in update public.trust_escrows set released_at=now() where agent_id=p_agent and released_at is null
    and release_after<=now() returning * loop
    released:=released+r.units;
    perform public.trust_append(p_agent,'released',jsonb_build_object('escrow_id',r.id,'units',r.units));
  end loop;
  return jsonb_build_object('released_units',released,'custody','test_units');
end $$;

create function public.open_trust_case(p_agent uuid,p_task uuid,p_kind text,p_hash text,p_url text,p_operator text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.trust_cases;
begin
  perform 1 from public.trust_accounts where agent_id=p_agent for update;
  if not found then raise exception 'Trust account not found' using errcode='PT404'; end if;
  if p_task is not null and not exists(select 1 from public.trust_escrows where agent_id=p_agent and task_id=p_task) then
    raise exception 'Case task must have accountable exposure' using errcode='PT400'; end if;
  insert into public.trust_cases(agent_id,task_id,kind,evidence_hash,evidence_url,operator)
    values(p_agent,p_task,p_kind,p_hash,p_url,p_operator) returning * into c;
  perform public.trust_append(p_agent,'case_opened',to_jsonb(c));
  return to_jsonb(c);
end $$;

create function public.decide_trust_case(p_case uuid,p_confirm boolean,p_units bigint,p_operator text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.trust_cases; a public.trust_accounts;
begin
  select * into c from public.trust_cases where id=p_case;
  if not found then raise exception 'Case not found' using errcode='PT404'; end if;
  select * into a from public.trust_accounts where agent_id=c.agent_id for update;
  select * into c from public.trust_cases where id=p_case for update;
  if c.status<>'open' or c.appealed_at is not null then raise exception 'Case already decided; use appeal resolution' using errcode='PT409'; end if;
  if p_units is null or p_units<0 or p_units>a.balance or (not p_confirm and p_units<>0)
    or p_confirm is null or length(btrim(coalesce(p_operator,''))) not between 3 and 120
    or length(btrim(coalesce(p_reason,''))) not between 10 and 4000 then
    raise exception 'Decision needs bounded units, attested operator and public reasoning' using errcode='PT400'; end if;
  update public.trust_cases set status=case when p_confirm then 'confirmed' else 'dismissed' end,
    slash_units=p_units,reasoning=p_reason,resolved_at=now() where id=c.id returning * into c;
  if p_confirm then
    update public.trust_accounts set balance=balance-p_units,frozen=true where agent_id=c.agent_id;
  end if;
  perform public.trust_append(c.agent_id,'attested_decision',to_jsonb(c)||jsonb_build_object('decided_by',p_operator));
  return to_jsonb(c);
end $$;

create function public.appeal_trust_case(p_agent uuid,p_case uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.trust_cases;
begin
  perform 1 from public.trust_accounts where agent_id=p_agent for update;
  select * into c from public.trust_cases where id=p_case and agent_id=p_agent for update;
  if not found then raise exception 'Case not found' using errcode='PT404'; end if;
  if c.status<>'confirmed' or c.appealed_at is not null then raise exception 'Only decided cases can be appealed once' using errcode='PT409'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 4000 then raise exception 'Explain the appeal (10-4000 characters)' using errcode='PT400'; end if;
  update public.trust_cases set appeal=p_reason,appealed_at=now(),resolved_at=null where id=c.id returning * into c;
  perform public.trust_append(p_agent,'appeal',to_jsonb(c));
  return to_jsonb(c);
end $$;

create function public.resolve_trust_appeal(p_case uuid,p_uphold boolean,p_operator text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.trust_cases;
begin
  select * into c from public.trust_cases where id=p_case;
  if not found then raise exception 'Case not found' using errcode='PT404'; end if;
  perform 1 from public.trust_accounts where agent_id=c.agent_id for update;
  select * into c from public.trust_cases where id=p_case for update;
  if c.appealed_at is null or c.resolved_at is not null then raise exception 'No pending appeal' using errcode='PT409'; end if;
  if p_uphold is null or length(btrim(coalesce(p_operator,''))) not between 3 and 120
    or length(btrim(coalesce(p_reason,''))) not between 10 and 4000 then raise exception 'Appeal needs attested operator and reasoning' using errcode='PT400'; end if;
  if not p_uphold then update public.trust_accounts set balance=balance+c.slash_units where agent_id=c.agent_id; end if;
  update public.trust_cases set status=case when p_uphold then 'confirmed' else 'dismissed' end,resolved_at=now() where id=c.id returning * into c;
  update public.trust_accounts set frozen=exists(select 1 from public.trust_cases where agent_id=c.agent_id and status='confirmed') where agent_id=c.agent_id;
  perform public.trust_append(c.agent_id,'attested_appeal_decision',to_jsonb(c)||jsonb_build_object('upheld',p_uphold,'operator',p_operator,'reason',p_reason));
  return to_jsonb(c);
end $$;

create function public.trust_account_view(p_agent uuid,p_limit integer default 50,p_offset integer default 0) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('account',(select to_jsonb(a) from public.trust_accounts a where agent_id=p_agent),
    'custody','test_units','regime','attested_testnet',
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by sequence) from (select * from public.trust_events where agent_id=p_agent
      order by sequence limit greatest(1,least(p_limit,100)) offset greatest(p_offset,0)) e),'[]'),
    'head',(select hash from public.trust_events where agent_id=p_agent order by sequence desc limit 1),
    'escrows',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.trust_escrows x where agent_id=p_agent and released_at is null),'[]'),
    'cases',coalesce((select jsonb_agg(to_jsonb(c) order by created_at) from public.trust_cases c where agent_id=p_agent),'[]'))
$$;

-- Initial drafts are bound to the precise roster, round, actor and contribution bytes.
-- A nonce prevents dictionary attacks on short, predictable drafts.
create function public.sealed_text_digest(p_ensemble uuid,p_round integer,p_member uuid,p_kind text,p_summary text,p_content text,p_nonce text) returns text
language sql immutable set search_path='' as $$
  select encode(extensions.digest(convert_to('posterity-sealed-v1:'||p_ensemble::text||':'||p_round||':'||p_member::text||':'||p_kind||':'||
    octet_length(convert_to(p_summary,'UTF8'))||':'||p_summary||':'||octet_length(convert_to(p_content,'UTF8'))||':'||p_content||':'||p_nonce,'UTF8'),'sha256'),'hex')
$$;

create function public.ensemble_commit(p_agent uuid,p_ensemble uuid,p_round integer,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; c public.ensemble_commitments; v_roster uuid[];
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  perform public.ensemble_refresh(e.id);
  if e.round is distinct from p_round or not exists(select 1 from public.trust_tasks where task_id=e.task_id and sealed) then
    raise exception 'Expected a sealed testnet round' using errcode='PT409'; end if;
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active' and lease_expires_at>now();
  if not found or not public.ensemble_role_fits(p_agent,e.id,m.role) then raise exception 'Active fitting role required' using errcode='PT403'; end if;
  select array_agg(id order by id) into v_roster from public.ensemble_members where ensemble_id=e.id and state='active' and lease_expires_at>now();
  if cardinality(v_roster)<>jsonb_array_length(e.spec->'roles') then raise exception 'Fill the complete roster before committing' using errcode='PT409'; end if;
  select * into c from public.ensemble_commitments where ensemble_id=e.id and round=e.round and member_id=m.id;
  if found then
    if c.digest is distinct from p_digest or c.roster is distinct from v_roster then raise exception 'Commitment is immutable' using errcode='PT409'; end if;
    return to_jsonb(c);
  end if;
  if exists(select 1 from public.ensemble_contributions where ensemble_id=e.id and round=e.round)
    or exists(select 1 from public.ensemble_commitments ec where ec.ensemble_id=e.id and ec.round=e.round and ec.roster is distinct from v_roster) then
    raise exception 'Cannot commit after reveal or roster change' using errcode='PT409'; end if;
  insert into public.ensemble_commitments(ensemble_id,round,member_id,digest,roster) values(e.id,e.round,m.id,p_digest,v_roster) returning * into c;
  perform public.trust_append(p_agent,'draft_committed',jsonb_build_object('ensemble_id',e.id,'round',e.round,'member_id',m.id,'digest',p_digest));
  return to_jsonb(c);
end $$;

create function public.sealed_contribution_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; c public.ensemble_commitments; v_roster uuid[];
begin
  select * into e from public.ensembles where id=new.ensemble_id for update;
  if not exists(select 1 from public.trust_tasks where task_id=e.task_id and sealed) then return new; end if;
  select array_agg(id order by id) into v_roster from public.ensemble_members where ensemble_id=e.id and state='active' and lease_expires_at>now();
  select * into c from public.ensemble_commitments where ensemble_id=e.id and round=e.round and member_id=new.member_id;
  if not found or cardinality(v_roster)<>jsonb_array_length(e.spec->'roles') or c.roster is distinct from v_roster
    or (select count(*) from public.ensemble_commitments ec where ec.ensemble_id=e.id and ec.round=e.round and ec.roster=v_roster)<>cardinality(v_roster) then
    raise exception 'Every current role must commit before any reveal; recover a changed roster' using errcode='PT409'; end if;
  if c.revealed_at is null then
    if c.nonce is null or c.digest is distinct from public.sealed_text_digest(e.id,e.round,new.member_id,new.kind,new.summary,new.content,c.nonce)
      or new.responds_to is not null then raise exception 'Reveal the exact committed initial draft first' using errcode='PT409'; end if;
  elsif exists(select 1 from public.ensemble_commitments ec where ec.ensemble_id=e.id and ec.round=e.round and ec.revealed_at is null) then
    raise exception 'Every initial draft must be revealed before further deliberation' using errcode='PT409';
  end if;
  return new;
end $$;
create trigger sealed_contribution before insert on public.ensemble_contributions for each row execute function public.sealed_contribution_guard();

create function public.ensemble_reveal(p_agent uuid,p_ensemble uuid,p_round integer,p_kind text,p_summary text,p_content text,p_nonce text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.ensembles; m public.ensemble_members; c public.ensemble_commitments; result jsonb;
begin
  select * into e from public.ensembles where id=p_ensemble for update;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  if e.round is distinct from p_round or not exists(select 1 from public.trust_tasks where task_id=e.task_id and sealed) then
    raise exception 'Expected a sealed testnet round' using errcode='PT409'; end if;
  select * into m from public.ensemble_members where ensemble_id=e.id and agent_id=p_agent and state='active' and lease_expires_at>now();
  if not found then raise exception 'Active membership required' using errcode='PT403'; end if;
  select * into c from public.ensemble_commitments where ensemble_id=e.id and round=e.round and member_id=m.id;
  if not found then raise exception 'Commit before revealing' using errcode='PT409'; end if;
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{64}$' or c.digest is distinct from public.sealed_text_digest(e.id,e.round,m.id,p_kind,p_summary,p_content,p_nonce) then
    raise exception 'Draft or nonce does not match commitment' using errcode='PT400'; end if;
  if c.revealed_at is not null then
    select to_jsonb(ec) into result from public.ensemble_contributions ec where ec.id=c.contribution_id;
    return result;
  end if;
  update public.ensemble_commitments set nonce=p_nonce where ensemble_id=e.id and round=e.round and member_id=m.id;
  result:=public.ensemble_contribute(p_agent,e.id,p_kind,p_summary,p_content);
  update public.ensemble_commitments set contribution_id=(result->>'id')::uuid,revealed_at=now() where ensemble_id=e.id and round=e.round and member_id=m.id;
  perform public.trust_append(p_agent,'draft_revealed',jsonb_build_object('ensemble_id',e.id,'round',e.round,'contribution_id',result->>'id','digest',c.digest));
  return result;
end $$;

create function public.sealed_score_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.ensembles;
begin
  select en.* into e from public.ensembles en join public.ensemble_contributions c on c.ensemble_id=en.id where c.id=new.contribution_id for update of en;
  if exists(select 1 from public.trust_tasks where task_id=e.task_id) and
    exists(select 1 from public.trust_accounts where agent_id=new.scorer_id and frozen) then
    raise exception 'Frozen testnet identities cannot peer-score opted-in work' using errcode='PT403'; end if;
  if exists(select 1 from public.trust_tasks where task_id=e.task_id and sealed) and (
    exists(select 1 from public.ensemble_commitments c where c.ensemble_id=e.id and c.round=e.round and c.revealed_at is null)
    or not exists(select 1 from public.ensemble_commitments c join public.ensemble_members m on m.id=c.member_id
      where c.ensemble_id=e.id and c.round=e.round and m.agent_id=new.scorer_id and c.revealed_at is not null)) then
    raise exception 'Uncommitted or unrevealed roles cannot score' using errcode='PT403'; end if;
  return new;
end $$;
create trigger sealed_score before insert or update on public.ensemble_scores for each row execute function public.sealed_score_guard();

create function public.recover_sealed_round(p_ensemble uuid,p_round integer,p_operator text,p_reason text) returns jsonb
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
    or not exists(select 1 from public.trust_tasks where task_id=t.id and sealed) then
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

-- Extend the ordinary public evidence response, preserving all Phase 13 recovery data.
alter function public.ensemble_view(uuid) rename to ensemble_view_pre15;
create function public.ensemble_view(p_ensemble uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.ensemble_view_pre15(p_ensemble)||jsonb_build_object(
    'trust_contract',(select to_jsonb(t) from public.trust_tasks t join public.ensembles e on e.task_id=t.task_id where e.id=p_ensemble),
    'commitments',coalesce((select jsonb_agg(to_jsonb(c) order by round,member_id) from public.ensemble_commitments c where ensemble_id=p_ensemble),'[]'))
$$;

-- One declared positive reputation budget per opted-in task, including its reviews.
-- The Phase 13 allocator still splits a bounded pool; peer scores never mint it.
alter function public.award(uuid,text,numeric,uuid,uuid,uuid,text[],text) rename to award_pre15;
create function public.award(p_agent uuid,p_kind text,p_delta numeric,p_mission uuid default null,p_task uuid default null,
  p_submission uuid default null,p_capabilities text[] default '{}',p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare cap numeric; used numeric;
begin
  select e.reward_cap into cap from public.trust_tasks t join public.trust_epochs e on e.id=t.epoch_id where t.task_id=p_task;
  if found and p_delta>0 then
    perform pg_advisory_xact_lock(hashtextextended('posterity-trust-reward:'||p_task::text,0));
    select coalesce(sum(delta),0) into used from public.reputation_events where task_id=p_task and delta>0;
    p_delta:=greatest(0,least(p_delta,cap-used));
  end if;
  perform public.award_pre15(p_agent,p_kind,p_delta,p_mission,p_task,p_submission,p_capabilities,p_note);
end $$;

-- Recommendations disclose the task contract and cannot treat unstaked candidates as
-- currently eligible. Advice still reserves no real capacity or collateral.
alter function public.orchestration_fit(uuid,uuid,text) rename to orchestration_fit_pre15;
create function public.orchestration_fit(p_agent uuid,p_task uuid,p_role text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; contract jsonb;
begin
  result:=public.orchestration_fit_pre15(p_agent,p_task,p_role);
  select to_jsonb(t) into contract from public.trust_tasks t where t.task_id=p_task;
  if contract is not null then
    result:=result||jsonb_build_object('trust_contract',contract);
    if not exists(select 1 from public.trust_accounts a join public.agents ag on ag.id=a.agent_id
        join public.trust_epochs ep on ep.id=(contract->>'epoch_id')::uuid
        where a.agent_id=p_agent and not a.frozen and ag.owner_id is not null and a.balance>=ep.stake_units
          and now()>=ep.starts_at and now()<ep.ends_at
          and a.balance-coalesce((select sum(x.units) from public.trust_escrows x where x.agent_id=a.agent_id and x.released_at is null),0)>=ep.escrow_units)
      or exists(select 1 from public.trust_cases c where c.agent_id=p_agent and (c.status='open' or c.appealed_at is not null and c.resolved_at is null)) then
      result:=result||jsonb_build_object('eligible',false,'reason','test_stake_unavailable');
    end if;
  end if;
  return result;
end $$;

-- Restrict all writes to explicit engine entry points. Administrative functions have
-- no agent transport route. The API service is the labelled attested last resort.
do $$ declare t text; f regprocedure; begin
  foreach t in array array['trust_epochs','trust_accounts','trust_events','trust_receipts','trust_tasks','trust_escrows','trust_cases','ensemble_commitments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (
    proname like 'trust\_%' escape '\' or proname like 'sealed\_%' escape '\' or proname in (
    'declare_trust_epoch','credit_trust_test_units','bind_trust_task','open_trust_case','decide_trust_case','appeal_trust_case',
    'resolve_trust_appeal','ensemble_commit','ensemble_reveal','recover_sealed_round','ensemble_view','ensemble_view_pre15','award','award_pre15',
    'ensemble_role_fits','ensemble_role_fits_pre15','orchestration_fit','orchestration_fit_pre15')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
notify pgrst,'reload schema';
