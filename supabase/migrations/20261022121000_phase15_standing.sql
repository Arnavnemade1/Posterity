-- Executable stake/tenure ladder. No production parameters or rollout are activated.
create table public.trust_protocols (
  epoch_id uuid primary key references public.trust_epochs(id),
  settings jsonb not null,
  settings_hash text not null,
  declared_at timestamptz not null default now()
);
create table public.trust_rollouts (
  id bigint generated always as identity primary key,
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  stage integer not null check(stage between 0 and 3),
  evidence jsonb not null,
  operator text not null check(length(btrim(operator)) between 3 and 120),
  created_at timestamptz not null default now()
);
create table public.trust_allowlist (
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  hive_id uuid not null references public.trust_hives(id),
  operator text not null check(length(btrim(operator)) between 3 and 120),
  primary key(epoch_id,hive_id)
);
create table public.trust_standing (
  agent_id uuid primary key references public.trust_identity_keys(agent_id),
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  tier integer not null default 0 check(tier between 0 and 2),
  tier_since timestamptz not null default now(),
  stake_since timestamptz,
  violations integer not null default 0,
  expelled boolean not null default false
);
create table public.trust_sandbox_tasks (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  prompt text not null check(length(btrim(prompt)) between 20 and 12000),
  acceptance_criteria text not null check(length(btrim(acceptance_criteria)) between 20 and 12000),
  created_at timestamptz not null default now()
);
create table public.trust_sandbox_outputs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.trust_sandbox_tasks(id),
  agent_id uuid not null references public.trust_standing(agent_id),
  hive_id uuid not null,
  content text not null check(length(btrim(content)) between 20 and 200000),
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique(task_id,agent_id)
);
create table public.trust_audits (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.trust_standing(agent_id),
  task_id uuid not null,
  sandbox boolean not null,
  passed boolean not null,
  reviewer_agent uuid,
  attested_reserve text,
  evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  rationale text not null check(length(btrim(rationale)) between 40 and 8000),
  created_at timestamptz not null default now(),
  check((reviewer_agent is null)<>(attested_reserve is null)),
  unique(agent_id,task_id,sandbox)
);
create table public.trust_vouches (
  id uuid primary key default gen_random_uuid(),
  voucher uuid not null references public.trust_standing(agent_id),
  vouchee uuid not null references public.trust_standing(agent_id),
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  units bigint not null check(units>0),
  reason text not null check(length(btrim(reason)) between 40 and 4000),
  liable_until timestamptz not null,
  release_after timestamptz not null,
  slashed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check(voucher<>vouchee)
);
create unique index trust_one_live_vouch on public.trust_vouches(voucher,vouchee) where released_at is null;
create table public.trust_task_policies (
  task_id uuid primary key,
  epoch_id uuid not null references public.trust_protocols(epoch_id),
  assurance text not null check(assurance in ('permissionless','mixed')),
  declared_at timestamptz not null default now()
);
create table public.trust_reward_holds (
  id bigint generated always as identity primary key,
  agent_id uuid not null,
  kind text not null, delta numeric not null check(delta>=0),
  mission_id uuid, task_id uuid not null, submission_id uuid,
  capabilities text[] not null, note text,
  release_after timestamptz not null,
  paid_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index trust_reward_pending on public.trust_reward_holds(agent_id) where paid_at is null and cancelled_at is null;

create function public.trust_cfg(p_epoch uuid) returns jsonb
language sql stable security definer set search_path='' as $$ select settings from public.trust_protocols where epoch_id=p_epoch $$;
create function public.trust_stage(p_epoch uuid) returns integer
language sql stable security definer set search_path='' as $$
 select coalesce((select stage from public.trust_rollouts where epoch_id=p_epoch order by id desc limit 1),0)
$$;
create function public.declare_trust_protocol(p_epoch uuid,p_settings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.trust_epochs; k text; x jsonb; bound numeric; result public.trust_protocols;
begin
  select * into e from public.trust_epochs where id=p_epoch;
  if not found or e.starts_at<=statement_timestamp() then raise exception 'Declare protocol before its epoch starts' using errcode='PT409'; end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then raise exception 'Explicit protocol settings required' using errcode='PT400'; end if;
  foreach k in array array['tau0_stake_days','tau0_tenure_days','tau1_days','extended_days','n0','n1','window','vouch_units','vouch_days','reward_delay_days','jury_size','appeal_days','beacon_delay_seconds','z_score'] loop
    if jsonb_typeof(p_settings->k) is distinct from 'number' or (p_settings->>k)::numeric<=0 or (p_settings->>k)::numeric>100000 then
      raise exception 'Missing or invalid positive parameter %',k using errcode='PT400'; end if;
  end loop;
  foreach k in array array['n0','n1','window','vouch_units','vouch_days','reward_delay_days','jury_size','appeal_days','beacon_delay_seconds'] loop
    if (p_settings->>k)::numeric<>trunc((p_settings->>k)::numeric) then raise exception 'Integer parameter required: %',k using errcode='PT400'; end if;
  end loop;
  foreach k in array array['p0','p1','a1','a2','c1','delta','detection_min','false_positive_max'] loop
    if jsonb_typeof(p_settings->k) is distinct from 'number' or (p_settings->>k)::numeric<=0 or (p_settings->>k)::numeric>1 then
      raise exception 'Missing or invalid probability %',k using errcode='PT400'; end if;
  end loop;
  if (p_settings->>'beacon_delay_seconds')::integer<30 or (p_settings->>'beacon_delay_seconds')::integer<2*(p_settings->>'beacon_period')::integer
    or (p_settings->>'tau0_stake_days')::numeric>=(p_settings->>'tau0_tenure_days')::numeric
    or (p_settings->>'a2')::numeric>=(p_settings->>'a1')::numeric
    or (p_settings->>'extended_days')::numeric<(p_settings->>'tau1_days')::numeric
    or (p_settings->>'jury_size')::integer<3 or (p_settings->>'jury_size')::integer%2<>1
    or p_settings->>'screening' is distinct from 'text-v1'
    or p_settings->>'randomness_scheme' is distinct from 'drand-bls-unchained-g1-rfc9380'
    or coalesce(p_settings->>'beacon_public_key','') !~ '^[0-9a-f]{192}$'
    or coalesce(p_settings->>'beacon_chain_hash','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_settings->>'beacon_period','') !~ '^[1-9][0-9]{0,5}$'
    or coalesce(p_settings->>'beacon_genesis','') !~ '^[1-9][0-9]{8,11}$' then
    raise exception 'Invalid clocks, sampling, jury, screening or pinned beacon configuration' using errcode='PT400'; end if;
  -- Economic bounds use declared worst-case units/horizon, not refundable principal.
  foreach k in array array['stake_economics','tenure_economics'] loop
    x:=p_settings->k;
    if jsonb_typeof(x) is distinct from 'object' then raise exception 'Both entry tracks require economic bounds' using errcode='PT400'; end if;
    foreach k in array array['p_success','extractable','operations','capital_cost','p_slash','burned_stake','lost_standing','margin'] loop
      if jsonb_typeof(x->k) is distinct from 'number' or (x->>k)::numeric<0 then raise exception 'Invalid economic bound %',k using errcode='PT400'; end if;
    end loop;
    if (x->>'p_success')::numeric>1 or (x->>'p_slash')::numeric>1 or (x->>'margin')::numeric<=0 then raise exception 'Invalid economic probabilities or margin' using errcode='PT400'; end if;
    bound:=(x->>'p_success')::numeric*(x->>'extractable')::numeric-(x->>'operations')::numeric-(x->>'capital_cost')::numeric
      -(x->>'p_slash')::numeric*((x->>'burned_stake')::numeric+(x->>'lost_standing')::numeric);
    if bound>-(x->>'margin')::numeric then raise exception 'Attack-profit bound fails its declared margin' using errcode='PT400'; end if;
  end loop;
  if (p_settings->'tenure_economics'->>'burned_stake')::numeric<>0 then raise exception 'Tenure track has no stake to burn' using errcode='PT400'; end if;
  insert into public.trust_protocols(epoch_id,settings,settings_hash) values(p_epoch,p_settings,encode(extensions.digest(p_settings::text,'sha256'),'hex')) returning * into result;
  return to_jsonb(result);
end $$;

create function public.trust_tier(p_agent uuid) returns integer
language sql stable security definer set search_path='' as $$ select tier from public.trust_standing where agent_id=p_agent and not expelled $$;
create function public.enroll_permissionless(p_agent uuid,p_epoch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.trust_epochs; key public.trust_identity_keys; result public.trust_standing;
begin
  perform pg_advisory_xact_lock(hashtextextended('posterity-trust-key:'||p_agent::text,0));
  select * into e from public.trust_epochs where id=p_epoch and now()>=starts_at and now()<ends_at;
  select * into key from public.trust_identity_keys where agent_id=p_agent;
  if e.id is null or key.agent_id is null or public.trust_cfg(e.id) is null then raise exception 'Active protocol epoch and possession-bound identity required' using errcode='PT409'; end if;
  if e.custody<>'test_units' and not exists(select 1 from public.trust_custody_adapters where epoch_id=e.id) then raise exception 'Configure funded custody before enrollment' using errcode='PT409';end if;
  if public.trust_stage(e.id)<2 and (key.track='tenure' or not exists(select 1 from public.trust_allowlist l
      where l.epoch_id=e.id and public.trust_hive_root(l.hive_id)=public.agent_hive(p_agent))) then
    raise exception 'This stage requires an allowlisted stake-track hive' using errcode='PT403'; end if;
  if not exists(select 1 from public.agents where id=p_agent and status='active' and paused_at is null) then raise exception 'Active identity required' using errcode='PT403'; end if;
  if exists(select 1 from public.reputation_events where agent_id=p_agent and delta>0) then
    raise exception 'Legacy reputation cannot be imported into permissionless standing; use a fresh identity' using errcode='PT409'; end if;
  insert into public.trust_accounts(agent_id,epoch_id) values(p_agent,e.id) on conflict do nothing;
  insert into public.trust_standing(agent_id,epoch_id,stake_since) values(p_agent,e.id,
    case when key.track='stake' and (select balance from public.trust_accounts where agent_id=p_agent)>=e.stake_units then now() end)
    on conflict do nothing returning * into result;
  if found then perform public.trust_append(p_agent,'permissionless_enrolled',jsonb_build_object('epoch_id',e.id,'hive_id',key.hive_id,'track',key.track,'tier',0,'scope','quarantine_nonexport'));
  else select * into result from public.trust_standing where agent_id=p_agent; end if;
  return to_jsonb(result);
end $$;

create function public.trust_stake_clock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.trust_standing s set stake_since=null from public.trust_epochs e,public.trust_identity_keys k
    where s.agent_id=new.agent_id and e.id=s.epoch_id and k.agent_id=s.agent_id and k.track='stake' and new.balance<e.stake_units;
  update public.trust_standing s set stake_since=now() from public.trust_epochs e,public.trust_identity_keys k
    where s.agent_id=new.agent_id and e.id=s.epoch_id and k.agent_id=s.agent_id and k.track='stake' and s.stake_since is null and new.balance>=e.stake_units;
  return new;
end $$;
create trigger trust_stake_activation after update of balance on public.trust_accounts for each row execute function public.trust_stake_clock();

create function public.submit_sandbox_output(p_agent uuid,p_task uuid,p_content text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.trust_standing; t public.trust_sandbox_tasks; output public.trust_sandbox_outputs;
begin
  select * into s from public.trust_standing where agent_id=p_agent;
  select * into t from public.trust_sandbox_tasks where id=p_task;
  if s.agent_id is null or s.tier<>0 or s.expelled or t.epoch_id is distinct from s.epoch_id
    or (select frozen from public.trust_accounts where agent_id=p_agent) then raise exception 'Unfrozen T0 identity and matching sandbox epoch required' using errcode='PT403'; end if;
  if (select count(*) from public.trust_sandbox_outputs o where public.trust_hive_root(o.hive_id)=public.agent_hive(p_agent) and o.created_at>now()-interval '1 day')>=100 then
    raise exception 'Sandbox submissions limited to 100 per hive per day' using errcode='PT429'; end if;
  insert into public.trust_sandbox_outputs(task_id,agent_id,hive_id,content,content_hash)
    values(p_task,p_agent,public.agent_hive(p_agent),p_content,encode(extensions.digest(convert_to(p_content,'UTF8'),'sha256'),'hex')) returning * into output;
  perform public.trust_append(p_agent,'sandbox_output',jsonb_build_object('output_id',output.id,'task_id',p_task,'hash',output.content_hash,'scope','quarantine_nonexport'));
  return to_jsonb(output);
end $$;

create function public.record_trust_audit(p_agent uuid,p_task uuid,p_sandbox boolean,p_passed boolean,p_reviewer uuid,p_reserve text,p_hash text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.trust_audits;
begin
  if (p_reviewer is null)=(p_reserve is null) or p_passed is null then raise exception 'Exactly one accountable auditor and verdict required' using errcode='PT400'; end if;
  if p_reviewer is not null and (public.trust_tier(p_reviewer) is distinct from 2 or public.agents_related(p_agent,p_reviewer)
      or (select frozen from public.trust_accounts where agent_id=p_reviewer)) then raise exception 'T2 independent-hive auditor required' using errcode='PT403'; end if;
  if p_reserve is not null and length(btrim(p_reserve)) not between 3 and 120 then raise exception 'Label the attested reserve' using errcode='PT400'; end if;
  if p_sandbox then
    if not exists(select 1 from public.trust_sandbox_outputs where agent_id=p_agent and task_id=p_task) then raise exception 'Sandbox output not found' using errcode='PT404'; end if;
  elsif not exists(select 1 from public.tasks t join public.trust_task_policies tp on tp.task_id=t.id
      where t.id=p_task and t.status='done' and (t.assignee_id=p_agent or exists(select 1 from public.ensemble_members em
        join public.ensembles en on en.id=em.ensemble_id where en.task_id=t.id and em.agent_id=p_agent) or exists(select 1 from public.reviews rv where rv.task_id=t.id and rv.reviewer_agent_id=p_agent))) then
    raise exception 'Audit requires independently settled permissionless work' using errcode='PT409';
  end if;
  insert into public.trust_audits(agent_id,task_id,sandbox,passed,reviewer_agent,attested_reserve,evidence_hash,rationale)
    values(p_agent,p_task,p_sandbox,p_passed,p_reviewer,p_reserve,p_hash,p_reason) returning * into result;
  perform public.trust_append(p_agent,'audit',to_jsonb(result));
  return to_jsonb(result);
end $$;

create function public.trust_pass_lower(p_pass bigint,p_total bigint,p_z numeric) returns numeric
language sql immutable set search_path='' as $$
  select case when p_total=0 then 0 else ((p_pass::numeric/p_total)+p_z*p_z/(2*p_total)
    -p_z*sqrt((p_pass::numeric/p_total)*(1-p_pass::numeric/p_total)/p_total+p_z*p_z/(4*p_total*p_total)))/(1+p_z*p_z/p_total) end
$$;
create function public.promote_trust_identity(p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.trust_standing; cfg jsonb; key public.trust_identity_keys; successes bigint; total bigint; since timestamptz; days numeric; n bigint; pass numeric; vouched boolean;
begin
  select * into s from public.trust_standing where agent_id=p_agent for update;
  select * into key from public.trust_identity_keys where agent_id=p_agent;
  cfg:=public.trust_cfg(s.epoch_id);
  if s.agent_id is null or s.expelled or s.tier=2 or (select frozen from public.trust_accounts where agent_id=p_agent)
    or exists(select 1 from public.trust_cases where agent_id=p_agent and (status='open' or appealed_at is not null and resolved_at is null)) then
    raise exception 'No eligible clean transition' using errcode='PT409'; end if;
  since:=case when s.tier=0 and key.track='stake' then greatest(s.tier_since,s.stake_since) else s.tier_since end;
  if s.tier=0 and key.track='stake' and (s.stake_since is null or (select balance from public.trust_accounts where agent_id=p_agent)<(select stake_units from public.trust_epochs where id=s.epoch_id)) then
    raise exception 'Fund and retain entry stake before starting its accelerated clock' using errcode='PT409'; end if;
  if s.tier=0 and exists(select 1 from public.trust_sandbox_outputs o where o.agent_id=p_agent and o.created_at>=since and not exists(select 1 from public.trust_audits a where a.agent_id=p_agent and a.task_id=o.task_id and a.sandbox)) then raise exception 'Every T0 output must be independently audited before promotion' using errcode='PT409';end if;
  if s.tier=1 and exists(select 1 from public.trust_assignments x where x.agent_id=p_agent and x.epoch_id=s.epoch_id and x.created_at>=since and x.audit_required
    and not exists(select 1 from public.trust_audits a where a.agent_id=p_agent and a.task_id=x.task_id and not a.sandbox)) then
    raise exception 'Every sampled probation assignment must be independently audited before promotion' using errcode='PT409';end if;
  select count(*),count(*) filter(where passed) into total,successes from public.trust_audits
    where agent_id=p_agent and sandbox=(s.tier=0) and created_at>=since and (case when sandbox then (select epoch_id from public.trust_sandbox_tasks where id=task_id) else (select epoch_id from public.trust_task_policies where trust_task_policies.task_id=trust_audits.task_id) end)=s.epoch_id;
  if s.tier=0 then
    days:=(cfg->>case when key.track='stake' then 'tau0_stake_days' else 'tau0_tenure_days' end)::numeric;
    n:=(cfg->>'n0')::bigint; pass:=(cfg->>'p0')::numeric;
  else
    vouched:=exists(select 1 from public.trust_vouches v where v.vouchee=p_agent and v.slashed_at is null and v.released_at is null and v.liable_until>now()
      and public.trust_tier(v.voucher)=2 and not public.agents_related(v.voucher,p_agent) and not (select frozen from public.trust_accounts where agent_id=v.voucher));
    days:=(cfg->>case when vouched then 'tau1_days' else 'extended_days' end)::numeric;
    n:=(cfg->>'n1')::bigint; pass:=(cfg->>'p1')::numeric;
  end if;
  if now()<since+make_interval(secs=>(days*86400)::double precision) or total<n or public.trust_pass_lower(successes,total,(cfg->>'z_score')::numeric)<pass then
    raise exception 'Tenure, distinct audited tasks or reliability confidence requirement not met' using errcode='PT409'; end if;
  update public.trust_standing set tier=tier+1,tier_since=now() where agent_id=p_agent returning * into s;
  perform public.trust_append(p_agent,'promoted',to_jsonb(s)||jsonb_build_object('audits',total,'pass_lower',public.trust_pass_lower(successes,total,(cfg->>'z_score')::numeric),'vouched',coalesce(vouched,false)));
  return to_jsonb(s);
end $$;

create function public.vouch_trust_identity(p_voucher uuid,p_vouchee uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.trust_standing; a public.trust_accounts; cfg jsonb; held bigint; result public.trust_vouches;
begin
  select * into a from public.trust_accounts where agent_id=p_voucher for update;
  select * into s from public.trust_standing where agent_id=p_vouchee;
  cfg:=public.trust_cfg(s.epoch_id);
  if public.trust_tier(p_voucher) is distinct from 2 or s.agent_id is null or s.tier>1 or a.frozen or a.epoch_id<>s.epoch_id or public.agents_related(p_voucher,p_vouchee)
    or exists(select 1 from public.trust_cases where agent_id in(p_voucher,p_vouchee) and status='open') then raise exception 'Only an independent, unfrozen T2 hive may vouch' using errcode='PT403'; end if;
  select coalesce(sum(units),0) into held from public.trust_escrows where agent_id=p_voucher and released_at is null;
  held:=held+coalesce((select sum(units) from public.trust_vouches where voucher=p_voucher and released_at is null and slashed_at is null),0);
  if a.balance-held<(cfg->>'vouch_units')::bigint then raise exception 'Separate unencumbered vouch stake required' using errcode='PT409'; end if;
  insert into public.trust_vouches(voucher,vouchee,epoch_id,units,reason,liable_until,release_after)
    values(p_voucher,p_vouchee,s.epoch_id,(cfg->>'vouch_units')::bigint,p_reason,now()+make_interval(days=>(cfg->>'vouch_days')::integer),
      now()+make_interval(days=>(cfg->>'vouch_days')::integer,secs=>(select dispute_seconds from public.trust_epochs where id=s.epoch_id))) returning * into result;
  perform public.trust_append(p_voucher,'vouch_locked',to_jsonb(result));
  perform public.trust_append(p_vouchee,'vouched',to_jsonb(result));
  return to_jsonb(result);
end $$;

create function public.trust_violation_transition() returns trigger
language plpgsql security definer set search_path='' as $$
declare v record; amount bigint;
begin
  if new.status='confirmed' and old.status<>'confirmed' then
    update public.trust_standing set tier=0,tier_since=now(),stake_since=null,violations=violations+1 where agent_id=new.agent_id;
    update public.trust_reward_holds set cancelled_at=now() where agent_id=new.agent_id and paid_at is null and cancelled_at is null;
    for v in select * from public.trust_vouches where vouchee=new.agent_id and slashed_at is null and released_at is null and new.created_at<=liable_until order by voucher,id for update loop
      perform 1 from public.trust_accounts where agent_id=v.voucher for update;
      select least(balance,v.units) into amount from public.trust_accounts where agent_id=v.voucher;
      update public.trust_accounts set balance=balance-amount where agent_id=v.voucher;
      update public.trust_vouches set slashed_at=now() where id=v.id;
      perform public.trust_append(v.voucher,'vouch_slashed',jsonb_build_object('vouch_id',v.id,'case_id',new.id,'units',amount));
    end loop;
  end if;
  return new;
end $$;
create trigger trust_demote_on_evidence after update of status on public.trust_cases for each row execute function public.trust_violation_transition();

-- T0 outputs live only in the sandbox tables. These are defense-in-depth guards
-- around every legacy standing/export path, including direct service engine calls.
create function public.trust_min_tier(p_agent uuid,p_required integer,p_action text) returns void
language plpgsql stable security definer set search_path='' as $$
declare s public.trust_standing;
begin
 select * into s from public.trust_standing where agent_id=p_agent;
 if found and (s.expelled or s.tier<p_required or (select frozen from public.trust_accounts where agent_id=p_agent)) then
   raise exception 'Trust tier does not permit %',p_action using errcode='PT403'; end if;
end $$;
create function public.trust_export_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  if tg_table_name='reviews' then actor:=new.reviewer_agent_id;
  elsif tg_table_name='trades' then
    perform public.trust_min_tier(new.proposer_id,2,'exchange'); perform public.trust_min_tier(new.counterparty_id,2,'exchange'); return new;
  elsif tg_table_name='agent_capability_reliability' then actor:=new.agent_id;
    if public.trust_tier(actor)=0 then return null; end if;
  else actor:=new.agent_id; end if;
  perform public.trust_min_tier(actor,case when tg_table_name in('reviews','knowledge_endorsements','cache_flags','post_votes') then 2 else 1 end,tg_table_name);
  return new;
end $$;
create trigger trust_quarantine_knowledge before insert on public.knowledge for each row execute function public.trust_export_guard();
create trigger trust_quarantine_cache before insert on public.reasoning_cache for each row execute function public.trust_export_guard();
create trigger trust_quarantine_endorsement before insert or update on public.knowledge_endorsements for each row execute function public.trust_export_guard();
create trigger trust_quarantine_cache_flags before insert on public.cache_flags for each row execute function public.trust_export_guard();
create trigger trust_quarantine_reviews before insert on public.reviews for each row execute function public.trust_export_guard();
create trigger trust_quarantine_reliability before insert or update on public.agent_capability_reliability for each row execute function public.trust_export_guard();
create trigger trust_quarantine_exchange before insert or update on public.trades for each row execute function public.trust_export_guard();

alter function public.award_v12(uuid,text,numeric,uuid,uuid,uuid,text[],text) rename to award_before_permissionless;
create function public.award_v12(p_agent uuid,p_kind text,p_delta numeric,p_mission uuid default null,p_task uuid default null,p_submission uuid default null,p_capabilities text[] default '{}',p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare s public.trust_standing;
begin
  select * into s from public.trust_standing where agent_id=p_agent;
  if found then
    if s.tier=0 or s.expelled or p_task is null or not exists(select 1 from public.trust_task_policies where task_id=p_task) then return; end if;
    if p_delta>0 then
      insert into public.trust_reward_holds(agent_id,kind,delta,mission_id,task_id,submission_id,capabilities,note,release_after)
        values(p_agent,p_kind,p_delta,p_mission,p_task,p_submission,p_capabilities,p_note,now()+make_interval(days=>(public.trust_cfg(s.epoch_id)->>'reward_delay_days')::integer));
      return;
    end if;
  end if;
  perform public.award_before_permissionless(p_agent,p_kind,p_delta,p_mission,p_task,p_submission,p_capabilities,p_note);
end $$;

create function public.release_trust_rewards(p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; paid numeric:=0;
begin
  perform 1 from public.trust_accounts where agent_id=p_agent for update;
  perform public.trust_min_tier(p_agent,1,'reward maturation');
  if exists(select 1 from public.trust_cases where agent_id=p_agent and (status='open' or appealed_at is not null and resolved_at is null)) then raise exception 'Resolve disputes before reward release' using errcode='PT409'; end if;
  for r in select h.* from public.trust_reward_holds h join public.tasks t on t.id=h.task_id
      where h.agent_id=p_agent and h.paid_at is null and h.cancelled_at is null and h.release_after<=now() and t.status='done'
      and exists(select 1 from public.trust_audits a where a.agent_id=p_agent and a.task_id=h.task_id and not a.sandbox and a.passed)
      order by h.id for update of h loop
    perform public.award_before_permissionless(r.agent_id,r.kind,r.delta,r.mission_id,r.task_id,r.submission_id,r.capabilities,r.note);
    update public.trust_reward_holds set paid_at=now() where id=r.id;
    paid:=paid+r.delta;
    perform public.trust_append(p_agent,'reward_matured',jsonb_build_object('hold_id',r.id,'task_id',r.task_id,'delta',r.delta));
  end loop;
  return jsonb_build_object('released',paid);
end $$;

do $$ declare t text; f regprocedure; begin
 foreach t in array array['trust_protocols','trust_rollouts','trust_allowlist','trust_standing','trust_sandbox_tasks','trust_sandbox_outputs','trust_audits','trust_vouches','trust_task_policies','trust_reward_holds'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
 foreach t in array array['trust_protocols','trust_rollouts','trust_allowlist','trust_sandbox_tasks','trust_sandbox_outputs','trust_audits','trust_task_policies'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.trust_immutable()',t||'_immutable',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (proname like 'trust\_%' escape '\' or proname in(
  'declare_trust_protocol','enroll_permissionless','submit_sandbox_output','record_trust_audit','promote_trust_identity','vouch_trust_identity','release_trust_rewards','award_v12','award_before_permissionless')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
