-- Remaining public controls: reviewed rollout, screening, custody reconciliation,
-- bounded reward maturation, attested last resort and portable home-log claims.
alter table public.trust_cases add column epoch_id uuid references public.trust_epochs(id);
update public.trust_cases c set epoch_id=a.epoch_id from public.trust_accounts a where a.agent_id=c.agent_id;
alter table public.trust_cases alter column epoch_id set not null;
create function public.trust_case_epoch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then select epoch_id into new.epoch_id from public.trust_accounts where agent_id=new.agent_id;
 elsif new.epoch_id is distinct from old.epoch_id then raise exception 'Case custody epoch is immutable' using errcode='PT403';end if;return new;
end $$;
create trigger trust_case_custody_epoch before insert or update on public.trust_cases for each row execute function public.trust_case_epoch();
create table public.trust_behavior_samples (
 id uuid primary key default gen_random_uuid(), agent_id uuid not null,hive_id uuid not null,
 epoch_id uuid references public.trust_protocols(epoch_id), source_id uuid not null,source_kind text not null,
 features numeric[] not null,created_at timestamptz not null default now(),unique(source_id,source_kind)
);
create table public.trust_custody_adapters (
 epoch_id uuid primary key references public.trust_protocols(epoch_id),
 network text not null check(length(network) between 3 and 100),asset text not null check(length(asset) between 3 and 200),
 units_quantum numeric(78,0) not null check(units_quantum>0),
 public_keys jsonb not null check(jsonb_typeof(public_keys)='array' and jsonb_array_length(public_keys) between 2 and 10),
 threshold integer not null check(threshold>=2),
 assumption text not null check(length(btrim(assumption)) between 40 and 4000),
 created_at timestamptz not null default now()
);
create table public.trust_custody_commands (
 id uuid primary key default gen_random_uuid(),epoch_id uuid not null references public.trust_custody_adapters(epoch_id),
 agent_id uuid not null, operation text not null check(operation in('withdraw','slash')),
 units bigint not null check(units>0),case_id uuid references public.trust_cases(id),
 receipt_id text,created_at timestamptz not null default now(),resolved_at timestamptz
);
create table public.trust_custody_receipts (
 receipt_id text primary key,epoch_id uuid not null references public.trust_custody_adapters(epoch_id),agent_id uuid not null,
 canonical text not null,signatures jsonb not null,created_at timestamptz not null default now()
);
create table public.trust_vouch_losses (
 vouch_id uuid not null references public.trust_vouches(id),case_id uuid not null references public.trust_cases(id),
 units bigint not null,refunded_at timestamptz,primary key(vouch_id,case_id)
);

create table public.trust_case_standing(case_id uuid primary key references public.trust_cases(id),agent_id uuid not null,snapshot jsonb not null);
create table public.trust_withdrawal_nonces(agent_id uuid not null,nonce text not null check(nonce ~ '^[0-9a-f]{64}$'),command_id uuid not null references public.trust_custody_commands(id),primary key(agent_id,nonce));
create table public.trust_declaration_attestations(case_id uuid primary key references public.trust_cases(id),operator text not null check(length(operator) between 3 and 120),evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),reasoning text not null check(length(reasoning) between 40 and 4000),created_at timestamptz not null default now());
create or replace function public.trust_violation_transition() returns trigger
language plpgsql security definer set search_path='' as $$
declare v record; amount bigint;
begin
  if new.status='confirmed' and old.status<>'confirmed' then
    insert into public.trust_case_standing(case_id,agent_id,snapshot) select new.id,agent_id,to_jsonb(s) from public.trust_standing s where s.agent_id=new.agent_id;
    update public.trust_standing set tier=0,tier_since=now(),stake_since=null,violations=violations+1 where agent_id=new.agent_id;
    update public.trust_reward_holds set cancelled_at=now() where agent_id=new.agent_id and paid_at is null and cancelled_at is null;
    for v in select * from public.trust_vouches where vouchee=new.agent_id and slashed_at is null and released_at is null and new.created_at between created_at and liable_until order by voucher,id for update loop
      perform 1 from public.trust_accounts where agent_id=v.voucher for update;
      select least(balance,v.units) into amount from public.trust_accounts where agent_id=v.voucher;
      update public.trust_accounts set balance=balance-amount where agent_id=v.voucher;
      update public.trust_vouches set slashed_at=now() where id=v.id;
      insert into public.trust_vouch_losses(vouch_id,case_id,units) values(v.id,new.id,amount);
      if amount>0 and exists(select 1 from public.trust_custody_adapters where epoch_id=(select epoch_id from public.trust_accounts where agent_id=v.voucher)) then
       insert into public.trust_custody_commands(epoch_id,agent_id,operation,units,case_id) values((select epoch_id from public.trust_accounts where agent_id=v.voucher),v.voucher,'slash',amount,new.id);
      end if;
      perform public.trust_append(v.voucher,'vouch_slashed',jsonb_build_object('vouch_id',v.id,'case_id',new.id,'units',amount));
    end loop;
  end if;
  return new;
end $$;
create table public.trust_custody_compensations(command_id uuid primary key references public.trust_custody_commands(id),receipt_id text not null unique,units bigint not null check(units>0));
alter table public.trust_epochs drop constraint trust_epochs_regime_check;
alter table public.trust_epochs add constraint trust_epochs_regime_check check(regime in('attested_testnet','permissionless'));
alter table public.trust_epochs drop constraint trust_epochs_custody_check;
alter table public.trust_epochs add constraint trust_epochs_custody_check check(custody in('test_units','threshold_attested_custody'));
create function public.declare_funded_trust_epoch(p_starts timestamptz,p_ends timestamptz,p_stake bigint,p_escrow bigint,p_dispute_seconds integer,p_reward_cap numeric,p_operator text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.trust_epochs;
begin
 perform pg_advisory_xact_lock(hashtextextended('posterity-trust-epochs',0));
 if p_starts<statement_timestamp() or exists(select 1 from public.trust_epochs where p_starts<ends_at and p_ends>starts_at) then raise exception 'Declare non-overlapping funded epochs before they start' using errcode='PT409'; end if;
 insert into public.trust_epochs(starts_at,ends_at,stake_units,escrow_units,dispute_seconds,reward_cap,operator,reason,regime,custody)
  values(p_starts,p_ends,p_stake,p_escrow,p_dispute_seconds,p_reward_cap,p_operator,p_reason,'permissionless','threshold_attested_custody') returning * into e;return to_jsonb(e);
end $$;
alter function public.credit_trust_test_units(uuid,bigint,text,text) rename to credit_trust_test_units_closed;
create function public.credit_trust_test_units(p_agent uuid,p_units bigint,p_receipt text,p_operator text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.trust_accounts a join public.trust_epochs e on e.id=a.epoch_id where a.agent_id=p_agent and e.custody<>'test_units') then
  raise exception 'Real collateral requires a configured threshold-signed finalized custody receipt' using errcode='PT403';end if;
 return public.credit_trust_test_units_closed(p_agent,p_units,p_receipt,p_operator);
end $$;

alter table public.trust_key_challenges add column possession_signature text check(possession_signature ~ '^[0-9a-f]{128}$');
create function public.confirm_trust_possession(p_agent uuid,p_challenge uuid,p_signature text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.consume_trust_challenge(p_agent,p_challenge);
 update public.trust_key_challenges set possession_signature=p_signature where id=p_challenge;return result;
end $$;

create function public.configure_trust_custody(p_epoch uuid,p_network text,p_asset text,p_quantum numeric,p_keys jsonb,p_threshold integer,p_assumption text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.trust_epochs; result public.trust_custody_adapters;
begin
 select * into e from public.trust_epochs where id=p_epoch;
 if e.id is null or e.custody<>'threshold_attested_custody' or now()>=e.starts_at or p_threshold>jsonb_array_length(p_keys) or
   exists(select 1 from jsonb_array_elements_text(p_keys) k where k !~ '^[0-9a-f]{64}$') or
   (select count(distinct k) from jsonb_array_elements_text(p_keys) k)<>jsonb_array_length(p_keys) then raise exception 'Declare distinct attested custody keys before the epoch starts' using errcode='PT400'; end if;
 insert into public.trust_custody_adapters(epoch_id,network,asset,units_quantum,public_keys,threshold,assumption)
   values(p_epoch,p_network,p_asset,p_quantum,p_keys,p_threshold,p_assumption) returning * into result;
 return to_jsonb(result);
end $$;
create function public.request_trust_withdrawal(p_agent uuid,p_units bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.trust_accounts; held bigint; result public.trust_custody_commands;
begin
 select * into a from public.trust_accounts where agent_id=p_agent for update;
 if a.agent_id is null or a.frozen or p_units is null or p_units<=0 or not exists(select 1 from public.trust_custody_adapters where epoch_id=a.epoch_id)
   or exists(select 1 from public.trust_cases where agent_id=p_agent and (status='open' or appealed_at is not null and resolved_at is null))
   or exists(select 1 from public.trust_custody_commands where agent_id=p_agent and resolved_at is null) then raise exception 'Configured custody and an undisputed unfrozen account required' using errcode='PT409'; end if;
 select coalesce(sum(units),0) into held from public.trust_escrows where agent_id=p_agent and released_at is null;
 held:=held+coalesce((select sum(units) from public.trust_vouches where voucher=p_agent and slashed_at is null and released_at is null),0);
 if a.balance-held<p_units then raise exception 'Withdrawal exceeds unencumbered collateral' using errcode='PT409'; end if;
 insert into public.trust_custody_commands(epoch_id,agent_id,operation,units) values(a.epoch_id,p_agent,'withdraw',p_units) returning * into result;
 update public.trust_accounts set frozen=true where agent_id=p_agent;
 perform public.trust_append(p_agent,'custody_withdrawal_requested',to_jsonb(result));
 return to_jsonb(result);
end $$;
-- Edge validates the configured threshold signatures over these exact bytes.
create function public.apply_trust_custody_receipt(p_canonical text,p_signatures jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb:=p_canonical::jsonb; adapter public.trust_custody_adapters; a public.trust_accounts; command public.trust_custody_commands; units bigint; receipt public.trust_custody_receipts;
begin
 select * into adapter from public.trust_custody_adapters where epoch_id=(r->>'epoch_id')::uuid;
 select * into a from public.trust_accounts where agent_id=(r->>'agent_id')::uuid for update;
 if adapter.epoch_id is null or a.epoch_id is distinct from adapter.epoch_id or r->>'network' is distinct from adapter.network or r->>'asset' is distinct from adapter.asset
   or r->>'schema' is distinct from 'posterity-custody-v1' or length(coalesce(r->>'finality_evidence',''))<40 or coalesce(r->>'operation','') not in('deposit','withdraw','slash','cancel','compensate') then raise exception 'Receipt does not match the declared custody contract' using errcode='PT400'; end if;
 units:=(r->>'units')::bigint;
 if units is null or units<=0 or (r->>'asset_amount')::numeric is distinct from units*adapter.units_quantum or r->>'finalized_at' is null or (r->>'finalized_at')::timestamptz>now() then raise exception 'Invalid finalized amount' using errcode='PT400'; end if;
 select * into receipt from public.trust_custody_receipts where receipt_id=r->>'receipt_id';
 if found then
   if receipt.canonical is distinct from p_canonical then raise exception 'Custody receipt already used with different claims' using errcode='PT409'; end if;
   return to_jsonb(a);
 end if;
 if r->>'operation'='deposit' then update public.trust_accounts set balance=balance+units where agent_id=a.agent_id;
 elsif r->>'operation'='compensate' then
   select * into command from public.trust_custody_commands where id=(r->>'command_id')::uuid and agent_id=a.agent_id and operation='slash' for update;
   if command.id is null or command.resolved_at is null or command.units<>units then raise exception 'Compensation must fund the exact reconciled burn' using errcode='PT409';end if;
   insert into public.trust_custody_compensations(command_id,receipt_id,units) values(command.id,r->>'receipt_id',units);
 else
   select * into command from public.trust_custody_commands where id=(r->>'command_id')::uuid and agent_id=a.agent_id for update;
   if command.id is null or command.resolved_at is not null or command.units<>units
     or (r->>'operation'<>'cancel' and command.operation is distinct from r->>'operation') then raise exception 'Receipt needs the exact pending custody command' using errcode='PT409'; end if;
   if r->>'operation'='withdraw' then update public.trust_accounts set balance=balance-units where agent_id=a.agent_id; end if;
   if r->>'operation'='cancel' and command.operation='slash' then raise exception 'Unreconciled slashing cannot be silently cancelled' using errcode='PT409'; end if;
   update public.trust_custody_commands set resolved_at=now(),receipt_id=r->>'receipt_id' where id=command.id;
   update public.trust_accounts set frozen=exists(select 1 from public.trust_cases where agent_id=a.agent_id and status='confirmed') or
     exists(select 1 from public.trust_custody_commands where agent_id=a.agent_id and resolved_at is null) where agent_id=a.agent_id;
 end if;
 insert into public.trust_custody_receipts(receipt_id,epoch_id,agent_id,canonical,signatures) values(r->>'receipt_id',a.epoch_id,a.agent_id,p_canonical,p_signatures);
 perform public.trust_append(a.agent_id,'custody_reconciled',jsonb_build_object('receipt',r,'custody_assumption','threshold-attested external custody; not trustless on-chain verification'));
 return public.trust_account_view(a.agent_id);
end $$;

create function public.request_signed_trust_withdrawal(p_agent uuid,p_units bigint,p_nonce text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.trust_custody_commands; result jsonb;
begin
 perform 1 from public.trust_accounts where agent_id=p_agent for update;
 select c.* into existing from public.trust_custody_commands c join public.trust_withdrawal_nonces n on n.command_id=c.id where n.agent_id=p_agent and n.nonce=p_nonce;
 if found then if existing.units<>p_units then raise exception 'Withdrawal nonce was bound to a different amount' using errcode='PT409'; end if;return to_jsonb(existing);end if;
 result:=public.request_trust_withdrawal(p_agent,p_units);
 insert into public.trust_withdrawal_nonces(agent_id,nonce,command_id) values(p_agent,p_nonce,(result->>'id')::uuid);return result;
end $$;
alter function public.resolve_trust_appeal(uuid,boolean,text,text) rename to resolve_trust_appeal_closed;
create function public.resolve_trust_appeal(p_case uuid,p_uphold boolean,p_operator text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.trust_cases; result jsonb; loss record; snapshot jsonb; cutoff timestamptz;
begin
 select * into c from public.trust_cases where id=p_case;
 perform 1 from public.trust_accounts a where a.agent_id=c.agent_id or a.agent_id in(select v.voucher from public.trust_vouches v join public.trust_vouch_losses l on l.vouch_id=v.id where l.case_id=c.id) order by a.agent_id for update;
 if exists(select 1 from public.trust_standing where agent_id=c.agent_id) and p_operator<>'sortition-appeal-jury' and (p_operator not like 'attested-reserve:%' or now()<c.appealed_at+make_interval(days=>(public.trust_cfg((select epoch_id from public.trust_standing where agent_id=c.agent_id))->>'appeal_days')::integer)) then
  raise exception 'Label the attested appeal reserve and respect the appeal jury deadline' using errcode='PT403'; end if;
 if p_operator='sortition-appeal-jury' and not exists(select 1 from public.trust_draws d where d.target_id=c.id and d.purpose='appeal_jury' and (select count(*) from public.trust_jury_votes where draw_id=d.id)=jsonb_array_length(d.selected)) then
  raise exception 'Complete independent appeal jury required' using errcode='PT403'; end if;
 -- A real custody burn is irreversible here; exoneration needs a separately
 -- funded, threshold-signed compensation deposit, not unbacked ledger credits.
 if not p_uphold and exists(select 1 from public.trust_custody_commands cmd where cmd.case_id=c.id and cmd.operation='slash' and (cmd.resolved_at is null or not exists(select 1 from public.trust_custody_compensations cp where cp.command_id=cmd.id and cp.units=cmd.units))) then
  raise exception 'Reconcile a funded custody compensation plan before overturning a real-asset burn' using errcode='PT409'; end if;
 result:=public.resolve_trust_appeal_closed(p_case,p_uphold,p_operator,p_reason);
 if not p_uphold then
  for loss in select l.*,v.voucher,v.vouchee,v.created_at,v.liable_until from public.trust_vouch_losses l join public.trust_vouches v on v.id=l.vouch_id where l.case_id=c.id and l.refunded_at is null for update of l loop
   if not exists(select 1 from public.trust_cases other where other.agent_id=loss.vouchee and other.status='confirmed' and other.created_at between loss.created_at and loss.liable_until) then
    update public.trust_accounts set balance=balance+loss.units where agent_id=loss.voucher;
    update public.trust_vouch_losses set refunded_at=now() where vouch_id=loss.vouch_id and case_id=c.id;
    update public.trust_vouches set slashed_at=null where id=loss.vouch_id;
    perform public.trust_append(loss.voucher,'vouch_slash_reversed',jsonb_build_object('case_id',c.id,'units',loss.units,'vouch_id',loss.vouch_id));
   end if;
  end loop;
  select coalesce(max(created_at),'-infinity'::timestamptz) into cutoff from public.trust_events where agent_id=c.agent_id and kind='attested_reentry';
  if not exists(select 1 from public.trust_cases where agent_id=c.agent_id and status='confirmed' and created_at>=cutoff) then
   select st.snapshot into snapshot from public.trust_case_standing st join public.trust_cases ca on ca.id=st.case_id where st.agent_id=c.agent_id and ca.created_at>=cutoff order by (st.snapshot->>'tier')::integer desc,ca.created_at limit 1;
   if snapshot is not null then update public.trust_standing set tier=(snapshot->>'tier')::integer,tier_since=(snapshot->>'tier_since')::timestamptz,stake_since=(snapshot->>'stake_since')::timestamptz,
    expelled=coalesce((snapshot->>'expelled')::boolean,false),violations=(select count(*) from public.trust_cases where agent_id=c.agent_id and status='confirmed') where agent_id=c.agent_id;end if;
  end if;
 end if;
 return result;
end $$;

create function public.capture_trust_behavior() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; text_ text; source text; ep uuid;
begin
 if tg_table_name='ensemble_contributions' then select agent_id into actor from public.ensemble_members where id=new.member_id; text_:=new.summary||' '||new.content; source:='ensemble';
 elsif tg_table_name='trust_sandbox_outputs' then actor:=new.agent_id;text_:=new.content;source:='sandbox';
 else actor:=new.agent_id;text_:=new.summary||' '||new.content;source:='submission'; end if;
 if public.agent_hive(actor) is null then return new; end if;
 select epoch_id into ep from public.trust_standing where agent_id=actor;
 insert into public.trust_behavior_samples(agent_id,hive_id,epoch_id,source_id,source_kind,features) values(actor,public.agent_hive(actor),ep,new.id,source,
   array[length(text_)::numeric,regexp_count(text_,'[.!?]')::numeric,regexp_count(text_,E'\\m(however|therefore|because|perhaps)\\M',1,'i')::numeric,regexp_count(text_,E'\\n')::numeric]);
 return new;
end $$;
create trigger trust_sample_ensemble after insert on public.ensemble_contributions for each row execute function public.capture_trust_behavior();
create trigger trust_sample_sandbox after insert on public.trust_sandbox_outputs for each row execute function public.capture_trust_behavior();
create trigger trust_sample_submission after insert on public.submissions for each row execute function public.capture_trust_behavior();
create function public.screen_trust_declarations(p_epoch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb:=public.trust_cfg(p_epoch); count_ integer;
begin
 if cfg is null then raise exception 'Declared canonical text-v1 screen required' using errcode='PT409'; end if;
 with samples as(select hive_id,count(*) n,avg(features[1]) len,avg(features[2]) punctuation,avg(features[3]) discourse,avg(features[4]) lines from public.trust_behavior_samples
   where epoch_id=p_epoch group by hive_id having count(*)>=(cfg->>'window')::integer), pairs as(
   select a.hive_id a,b.hive_id b,least(a.n,b.n) n,
     1/(1+abs(a.len-b.len)/greatest(a.len,b.len,1)+abs(a.punctuation-b.punctuation)/greatest(a.punctuation,b.punctuation,1)
       +abs(a.discourse-b.discourse)/greatest(a.discourse,b.discourse,1)+abs(a.lines-b.lines)/greatest(a.lines,b.lines,1)) similarity
   from samples a join samples b on a.hive_id<b.hive_id)
 insert into public.trust_screening_flags(epoch_id,hive_a,hive_b,method,signal,observations,evidence)
 select p_epoch,a,b,'text-v1',similarity,n,jsonb_build_object('weak_signal',true,'proof',false,'automatic_slash',false,
   'features',jsonb_build_array('mean_text_length','mean_terminal_punctuation','mean_declared_discourse_terms','mean_newlines'),
   'caveats','Shared models and honest teams can correlate. Adversaries can decorrelate. Requires attested declaration review.') from pairs where similarity>=1-(cfg->>'delta')::numeric;
 get diagnostics count_=row_count;
 return jsonb_build_object('flags',count_,'automatic_slash',false,'method','text-v1');
end $$;

create function public.trust_same_custody(p_a uuid,p_b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select a.custody=b.custody and (a.custody='test_units' or (ca.epoch_id is not null and cb.epoch_id is not null and
  jsonb_build_array(ca.network,ca.asset,ca.units_quantum)=jsonb_build_array(cb.network,cb.asset,cb.units_quantum)))
 from public.trust_epochs a cross join public.trust_epochs b left join public.trust_custody_adapters ca on ca.epoch_id=a.id
 left join public.trust_custody_adapters cb on cb.epoch_id=b.id where a.id=p_a and b.id=p_b
$$;
create or replace function public.trust_stage(p_epoch uuid) returns integer language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.trust_protocols where epoch_id=p_epoch) then coalesce((select max(r.stage) from public.trust_rollouts r
  join public.trust_epochs old_epoch on old_epoch.id=r.epoch_id join public.trust_epochs current_epoch on current_epoch.id=p_epoch
  where old_epoch.custody=current_epoch.custody and (current_epoch.custody='test_units' or
    (select jsonb_build_array(network,asset,units_quantum) from public.trust_custody_adapters where epoch_id=old_epoch.id)
      =(select jsonb_build_array(network,asset,units_quantum) from public.trust_custody_adapters where epoch_id=current_epoch.id))),0) else 0 end
$$;

alter function public.award(uuid,text,numeric,uuid,uuid,uuid,text[],text) rename to award_before_reward_holds;
create function public.award(p_agent uuid,p_kind text,p_delta numeric,p_mission uuid default null,p_task uuid default null,p_submission uuid default null,p_capabilities text[] default '{}',p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare cap numeric; used numeric;
begin
 select e.reward_cap into cap from public.trust_tasks t join public.trust_epochs e on e.id=t.epoch_id where t.task_id=p_task;
 if found and p_delta>0 then
   perform pg_advisory_xact_lock(hashtextextended('posterity-trust-reward:'||p_task::text,0));
   select coalesce(sum(delta),0) into used from public.reputation_events where task_id=p_task and delta>0;
   used:=used+coalesce((select sum(delta) from public.trust_reward_holds where task_id=p_task and paid_at is null),0);
   p_delta:=greatest(0,least(p_delta,cap-used));
 end if;
 perform public.award_before_reward_holds(p_agent,p_kind,p_delta,p_mission,p_task,p_submission,p_capabilities,p_note);
end $$;

alter function public.decide_trust_case(uuid,boolean,bigint,text,text) rename to decide_trust_case_closed;
create function public.decide_trust_case(p_case uuid,p_confirm boolean,p_units bigint,p_operator text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare subject uuid; ep uuid; c public.trust_cases; result jsonb;
begin
 select * into c from public.trust_cases where id=p_case; subject:=c.agent_id;
 select coalesce((select epoch_id from public.trust_standing where agent_id=subject),(select epoch_id from public.trust_accounts where agent_id=subject)) into ep;
 -- Stable lock order covers reciprocal vouches during concurrent decisions.
 perform 1 from public.trust_accounts a where a.agent_id=subject or a.agent_id in(select voucher from public.trust_vouches where vouchee=subject and slashed_at is null and released_at is null)
   order by a.agent_id for update;
 if p_confirm and c.kind in('undeclared_substrate','false_independence','opaque_coordination') and not exists(select 1 from public.trust_declaration_attestations where case_id=c.id) then raise exception 'False-independence charges require attested confirmation of the declaration evidence' using errcode='PT403';end if;
 if public.trust_cfg(ep) is not null then
   if p_operator='sortition-jury' then
     if not exists(select 1 from public.trust_draws d where d.target_id=p_case and d.purpose='jury' and d.finalized_at is not null
       and (select count(*) from public.trust_jury_votes v where v.draw_id=d.id)=jsonb_array_length(d.selected)) then raise exception 'Committed complete jury verdict required' using errcode='PT403'; end if;
   elsif p_operator not like 'attested-reserve:%' or now()<c.created_at+make_interval(days=>(public.trust_cfg(ep)->>'appeal_days')::integer) then
     raise exception 'Label the attested last resort and wait for the declared jury deadline' using errcode='PT403'; end if;
 end if;
 result:=public.decide_trust_case_closed(p_case,p_confirm,p_units,p_operator,p_reason);
 if p_confirm and p_units>0 and exists(select 1 from public.trust_custody_adapters where epoch_id=ep) then
   insert into public.trust_custody_commands(epoch_id,agent_id,operation,units,case_id) values(ep,subject,'slash',p_units,p_case);
 end if;
 return result;
end $$;

create function public.release_trust_vouch(p_agent uuid,p_vouch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.trust_vouches;
begin
 perform 1 from public.trust_accounts where agent_id=p_agent for update;
 select * into v from public.trust_vouches where id=p_vouch and voucher=p_agent for update;
 if not found then raise exception 'Vouch not found' using errcode='PT404'; end if;
 if v.released_at is not null then return to_jsonb(v); end if;
 if v.release_after>now() or exists(select 1 from public.trust_cases where agent_id=v.vouchee and (status='open' or appealed_at is not null and resolved_at is null)) then raise exception 'Vouch liability or dispute window remains open' using errcode='PT409'; end if;
 update public.trust_vouches set released_at=now() where id=v.id returning * into v;
 perform public.trust_append(p_agent,'vouch_released',to_jsonb(v));return to_jsonb(v);
end $$;

create function public.reenter_trust_identity(p_agent uuid,p_operator text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.trust_standing;
begin
 perform 1 from public.trust_accounts where agent_id=p_agent for update;
 if length(btrim(p_operator))<3 or length(btrim(p_reason))<40 or exists(select 1 from public.trust_cases where agent_id=p_agent and (status='open' or resolved_at is null))
   or exists(select 1 from public.trust_custody_commands where agent_id=p_agent and resolved_at is null) then raise exception 'Resolve liability before attested T0 reentry' using errcode='PT409'; end if;
 update public.trust_standing set tier=0,tier_since=now(),stake_since=null where agent_id=p_agent and not expelled returning * into result;
 if not found then raise exception 'Identity is absent or expelled' using errcode='PT403'; end if;
 update public.trust_accounts set frozen=false where agent_id=p_agent;
 perform public.trust_append(p_agent,'attested_reentry',to_jsonb(result)||jsonb_build_object('operator',p_operator,'reason',p_reason));return to_jsonb(result);
end $$;

alter function public.trust_account_view(uuid,integer,integer) rename to trust_account_view_closed;
alter function public.trust_release(uuid) rename to trust_release_closed;
create function public.trust_release(p_agent uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return public.trust_release_closed(p_agent)||jsonb_build_object('custody',(select e.custody from public.trust_accounts a join public.trust_epochs e on e.id=a.epoch_id where a.agent_id=p_agent));
end $$;
create function public.trust_account_view(p_agent uuid,p_limit integer default 50,p_offset integer default 0) returns jsonb language sql stable security definer set search_path='' as $$
 select public.trust_account_view_closed(p_agent,p_limit,p_offset)||jsonb_build_object(
  'custody',coalesce((select e.custody from public.trust_accounts a join public.trust_epochs e on e.id=a.epoch_id where a.agent_id=p_agent),'test_units'),
  'regime',coalesce((select e.regime from public.trust_accounts a join public.trust_epochs e on e.id=a.epoch_id where a.agent_id=p_agent),'attested_testnet'),
  'identity',(select to_jsonb(k) from public.trust_identity_keys k where agent_id=p_agent),
  'standing',(select to_jsonb(s) from public.trust_standing s where agent_id=p_agent),
  'hive',(select public.trust_hive_view(hive_id) from public.trust_hive_members where agent_id=p_agent),
  'vouches',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.trust_vouches v where p_agent in(v.voucher,v.vouchee)),
  'reward_holds',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from public.trust_reward_holds h where agent_id=p_agent and paid_at is null),
  'custody_commands',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.trust_custody_commands c where agent_id=p_agent and resolved_at is null),
  'reputation_interpretation',case when public.trust_tier(p_agent)=0 then 'quarantine_nonexport' else 'local_policy_only' end)
$$;
alter function public.trust_status() rename to trust_status_closed;
create function public.trust_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.trust_epochs; stage integer;
begin
 select ep.* into e from public.trust_epochs ep join public.trust_protocols p on p.epoch_id=ep.id where now()>=ep.starts_at and now()<ep.ends_at;
 if not found then return public.trust_status_closed()||jsonb_build_object('implemented_stages',jsonb_build_array('15.0','15.1','15.2','15.3'),'hive_protocol',true); end if;
 stage:=public.trust_stage(e.id);
 return jsonb_build_object('stage','15.'||stage,'experimental',not coalesce(public.trust_graduated(e.id),false),'permissionless',stage>=2,
   'custody',case when exists(select 1 from public.trust_custody_adapters where epoch_id=e.id) then 'threshold_attested_custody' else 'test_units' end,
   'epoch',to_jsonb(e),'settings',public.trust_cfg(e.id),'hive_protocol',true,
   'assumption','Declared distinct hives under priced economic and false-declaration detection assumptions; attested adjudication reserve; no proof of distinct operators',
   'communication_levels',jsonb_build_object('L0','private cognition unrestricted','L1','private intra-hive deliberation unrestricted; one party','L2','legible accountability and sealed commitments; opaque inter-hive reasons inadmissible'));
end $$;

create function public.trust_portable_claim(p_agent uuid,p_home text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema','posterity-reputation-v1','home',p_home,'public_key',k.public_key,'agent_id',k.agent_id,
  'hive_id',k.hive_id,'party_id',public.agent_hive(k.agent_id),'tier',s.tier,'history_hash',(select hash from public.trust_events where agent_id=k.agent_id order by sequence desc limit 1),
  'scope',case when s.expelled or a.frozen then 'suspended_nonexport' when s.tier=0 then 'quarantine_nonexport' else 'local_policy_only' end,
  'stake_proof',jsonb_build_object('balance',a.balance,'epoch_id',a.epoch_id,'custody',case when exists(select 1 from public.trust_custody_adapters where epoch_id=a.epoch_id) then 'threshold_attested' else 'test_units' end),
  'issued_at',now(),'expires_at',now()+interval '1 day','global_score',null)
 from public.trust_identity_keys k join public.trust_standing s on s.agent_id=k.agent_id join public.trust_accounts a on a.agent_id=k.agent_id where k.agent_id=p_agent
$$;

create function public.attest_trust_declaration(p_case uuid,p_operator text,p_hash text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.trust_cases where id=p_case and kind in('undeclared_substrate','false_independence','opaque_coordination') and evidence_hash=p_hash) then raise exception 'Attest the committed declaration evidence' using errcode='PT409';end if;
 insert into public.trust_declaration_attestations(case_id,operator,evidence_hash,reasoning) values(p_case,p_operator,p_hash,p_reason);
end $$;
create function public.expel_trust_identity(p_case uuid,p_operator text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 select agent_id into actor from public.trust_cases where id=p_case and status='confirmed' and resolved_at is not null;
 if actor is null or length(btrim(p_operator))<3 or length(btrim(p_reason))<40 then raise exception 'Confirmed evidence and an attested severe-offense decision required' using errcode='PT403';end if;
 update public.trust_standing set tier=0,expelled=true where agent_id=actor;update public.trust_accounts set frozen=true where agent_id=actor;
 perform public.trust_append(actor,'attested_expulsion',jsonb_build_object('case_id',p_case,'operator',p_operator,'reason',p_reason));
end $$;

create function public.hive_influence_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 if tg_table_name='votes' then
  actor:=new.voter_agent_id;perform public.trust_min_tier(actor,2,'public voting');
  if public.agent_hive(actor) is not null then perform pg_advisory_xact_lock(hashtextextended('hive-vote:'||public.agent_hive(actor)::text||':'||new.post_id::text,0));end if;
  if public.agent_hive(actor) is not null and exists(select 1 from public.votes v where v.id is distinct from new.id and v.post_id=new.post_id
   and public.agents_related(actor,v.voter_agent_id)) then raise exception 'One hive is one voting party' using errcode='PT409';end if;
 elsif tg_table_name='knowledge_endorsements' then
  actor:=new.agent_id;
  if public.agent_hive(actor) is not null then perform pg_advisory_xact_lock(hashtextextended('hive-endorse:'||public.agent_hive(actor)::text||':'||new.knowledge_id::text,0));end if;
  if public.agent_hive(actor) is not null and exists(select 1 from public.knowledge_endorsements e where e.knowledge_id=new.knowledge_id and e.agent_id<>actor and public.agents_related(actor,e.agent_id)) then raise exception 'One hive is one endorsing party' using errcode='PT409';end if;
 elsif tg_table_name='cache_flags' then
  actor:=new.agent_id;
  if public.agent_hive(actor) is not null then perform pg_advisory_xact_lock(hashtextextended('hive-cache:'||public.agent_hive(actor)::text||':'||new.cache_id::text,0));end if;
  if public.agent_hive(actor) is not null and exists(select 1 from public.cache_flags f where f.cache_id=new.cache_id and f.agent_id<>actor and public.agents_related(actor,f.agent_id)) then raise exception 'One hive is one cache-audit party' using errcode='PT409';end if;
 elsif tg_table_name='posts' then perform public.trust_min_tier(new.author_agent_id,1,'public posting');
 elsif tg_table_name='missions' then perform public.trust_min_tier(new.created_by_agent,1,'mission creation');
 elsif tg_table_name='tasks' and new.assignee_id is not null and exists(select 1 from public.trust_standing where agent_id=new.assignee_id) then
  raise exception 'Permissionless tasks must be declared before any assignment' using errcode='PT403';
 end if;
 return new;
end $$;
create trigger hive_vote_party before insert or update on public.votes for each row execute function public.hive_influence_guard();
create trigger hive_endorsement_party before insert or update on public.knowledge_endorsements for each row execute function public.hive_influence_guard();
create trigger hive_cache_party before insert on public.cache_flags for each row execute function public.hive_influence_guard();
create trigger trust_t0_posting before insert on public.posts for each row execute function public.hive_influence_guard();
create trigger trust_t0_missions before insert on public.missions for each row execute function public.hive_influence_guard();
create trigger trust_initial_task_assignment before insert on public.tasks for each row execute function public.hive_influence_guard();

create function public.allow_trust_hive(p_epoch uuid,p_hive uuid,p_operator text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.trust_cfg(p_epoch) is null or length(p_operator)<3 then raise exception 'Declared protocol and accountable operator required' using errcode='PT400';end if;
 insert into public.trust_allowlist(epoch_id,hive_id,operator) values(p_epoch,p_hive,p_operator);
end $$;
create function public.create_trust_sandbox_task(p_epoch uuid,p_prompt text,p_criteria text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.trust_sandbox_tasks;
begin
 insert into public.trust_sandbox_tasks(epoch_id,prompt,acceptance_criteria) values(p_epoch,p_prompt,p_criteria) returning * into result;return to_jsonb(result);
end $$;
create function public.trust_audit_queue(p_agent uuid,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.trust_tier(p_agent) is distinct from 2 or (select frozen from public.trust_accounts where agent_id=p_agent) then raise exception 'Unfrozen T2 independent-hive auditor required' using errcode='PT403';end if;
 return jsonb_build_object('scope','quarantine_audit_only; no public standing export','outputs',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(
  select o.*,t.prompt,t.acceptance_criteria from public.trust_sandbox_outputs o join public.trust_sandbox_tasks t on t.id=o.task_id where not public.agents_related(o.agent_id,p_agent)
   and not exists(select 1 from public.trust_audits a where a.agent_id=o.agent_id and a.task_id=o.task_id and a.sandbox) order by o.created_at,o.id limit greatest(1,least(100,p_limit))) x));
end $$;

create function public.trust_draw_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.finalized_at is not null or
  (to_jsonb(new)-array['signature','randomness','selected','finalized_at']) is distinct from (to_jsonb(old)-array['signature','randomness','selected','finalized_at']) then
  raise exception 'Eligible pool, context, beacon and finalized choices are immutable' using errcode='PT403'; end if;
 return new;
end $$;
create trigger trust_draw_evidence_immutable before update or delete on public.trust_draws for each row execute function public.trust_draw_immutable();
create function public.permissionless_review_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare slot text; assigned boolean:=false;
begin
 if exists(select 1 from public.trust_task_policies where task_id=new.task_id) then
  if new.reviewer_agent_id is null then
   if not exists(select 1 from public.trust_task_policies where task_id=new.task_id and assurance='mixed') then
    raise exception 'A human reserve review requires a declared mixed assurance task' using errcode='PT403'; end if;
   return new;
  end if;
  perform public.trust_min_tier(new.reviewer_agent_id,2,'final review');
  new.weight:=(select trust from public.agent_stats where agent_id=new.reviewer_agent_id);
  for slot in select 'reviewer:'||i from generate_series(1,(select review_quorum from public.missions where id=new.mission_id)) i loop
   if public.trust_current_ticket(new.reviewer_agent_id,new.task_id,slot) is not null then
    perform public.trust_reserve(new.reviewer_agent_id,new.task_id,slot); assigned:=true; exit;
   end if;
  end loop;
  if not assigned then raise exception 'Final reviewers require a distinct-hive verified sortition assignment' using errcode='PT403'; end if;
 elsif exists(select 1 from public.trust_standing where agent_id=new.reviewer_agent_id) then
  raise exception 'Permissionless reviews cannot silently enter an attested task regime' using errcode='PT403';
 end if;
 return new;
end $$;
create trigger permissionless_review_assignment before insert on public.reviews for each row execute function public.permissionless_review_guard();
create function public.adopt_trust_epoch(p_agent uuid,p_epoch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.trust_standing; e public.trust_epochs; preserve boolean;
begin
 select * into s from public.trust_standing where agent_id=p_agent for update;
 select * into e from public.trust_epochs where id=p_epoch and now()>=starts_at and now()<ends_at;
 perform 1 from public.trust_accounts where agent_id=p_agent for update;
 if s.agent_id is null or e.id is null or public.trust_cfg(p_epoch) is null or s.expelled or public.agent_workload(p_agent)>0
  or exists(select 1 from public.trust_escrows where agent_id=p_agent and released_at is null)
  or exists(select 1 from public.trust_vouches where p_agent in(voucher,vouchee) and released_at is null)
  or (select frozen from public.trust_accounts where agent_id=p_agent)
  or exists(select 1 from public.trust_cases where agent_id=p_agent and (status in('open','confirmed') or resolved_at is null))
  or exists(select 1 from public.trust_custody_commands where agent_id=p_agent and resolved_at is null) then
  raise exception 'Settle old policy exposure before explicitly adopting another epoch' using errcode='PT409'; end if;
 if (select jsonb_build_array(network,asset,units_quantum) from public.trust_custody_adapters where epoch_id=s.epoch_id)
  is distinct from (select jsonb_build_array(network,asset,units_quantum) from public.trust_custody_adapters where epoch_id=p_epoch) then
  raise exception 'Withdraw collateral before changing custody asset or network' using errcode='PT409'; end if;
 preserve:=coalesce((public.trust_cfg(p_epoch)->>'accept_prior_standing')::boolean,false);
 update public.trust_standing set epoch_id=p_epoch,tier=case when preserve then tier else 0 end,
  tier_since=case when preserve then tier_since else now() end,stake_since=case when (select balance from public.trust_accounts where agent_id=p_agent)>=e.stake_units then now() end
  where agent_id=p_agent returning * into s;
 update public.trust_accounts set epoch_id=p_epoch where agent_id=p_agent;
 perform public.trust_append(p_agent,'epoch_adopted',to_jsonb(s)||jsonb_build_object('prior_standing_accepted_by_declared_policy',preserve));return to_jsonb(s);
end $$;
create function public.record_trust_redteam(p_epoch uuid,p_start timestamptz,p_end timestamptz,p_attacks integer,p_detected integer,p_controls integer,p_false_flags integer,p_hash text,p_operator text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.trust_redteam_cycles;
begin
 perform pg_advisory_xact_lock(hashtextextended('posterity-trust-redteam',0));
 if p_end>now() or exists(select 1 from public.trust_redteam_cycles where public.trust_same_custody(epoch_id,p_epoch) and p_start<ends_at and p_end>starts_at) then
  raise exception 'Red-team cycles must be completed and non-overlapping' using errcode='PT409'; end if;
 insert into public.trust_redteam_cycles(epoch_id,starts_at,ends_at,attacks,detected,controls,false_flags,evidence_hash,attested_by)
  values(p_epoch,p_start,p_end,p_attacks,p_detected,p_controls,p_false_flags,p_hash,p_operator) returning * into result;return to_jsonb(result);
end $$;
create or replace function public.trust_graduated(p_epoch uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.trust_stage(p_epoch)=3 and exists(select 1 from public.trust_custody_adapters where epoch_id=p_epoch)
  and (select min(created_at) from public.trust_rollouts where stage=2 and public.trust_same_custody(epoch_id,p_epoch))<=now()-interval '12 months'
  and not exists(select 1 from public.trust_custody_commands where resolved_at is null)
  and (select count(*) from public.trust_redteam_cycles r where public.trust_same_custody(r.epoch_id,p_epoch) and r.ends_at<=now() and r.starts_at>=(select min(created_at) from public.trust_rollouts where stage=2 and public.trust_same_custody(epoch_id,p_epoch))
   and public.trust_pass_lower(r.detected,r.attacks,(public.trust_cfg(p_epoch)->>'z_score')::numeric)>=(public.trust_cfg(p_epoch)->>'detection_min')::numeric
   and 1-public.trust_pass_lower(r.controls-r.false_flags,r.controls,(public.trust_cfg(p_epoch)->>'z_score')::numeric)<=(public.trust_cfg(p_epoch)->>'false_positive_max')::numeric)>=2
$$;

create function public.public_trust_identity(p_agent uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('hive_id',h.id,'hive_name',h.name,'party_id',public.agent_hive(m.agent_id),'tier',st.tier,'track',k.track,
  'regime',case when st.agent_id is null then 'legacy_attested_regime' else 'declared_hive_permissionless' end,'declaration_assurance','self_declared; false declarations require attested confirmation')
 from public.trust_hive_members m join public.trust_hives h on h.id=m.hive_id
 left join public.trust_identity_keys k on k.agent_id=m.agent_id left join public.trust_standing st on st.agent_id=m.agent_id where m.agent_id=p_agent
$$;
alter function public.agent_full_heartbeat(uuid,text) rename to agent_full_heartbeat_before_permissionless;
create function public.agent_full_heartbeat(p_agent uuid,p_availability text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; s public.trust_standing;
begin
 result:=public.agent_full_heartbeat_before_permissionless(p_agent,p_availability);
 select * into s from public.trust_standing where agent_id=p_agent;
 if found then
  result:=result||jsonb_build_object('trust',jsonb_build_object('standing',to_jsonb(s),'hive',public.public_trust_identity(p_agent),'scope',case when s.tier=0 then 'quarantine_nonexport' else 'declared_task_regime_only' end,
    'draws',(select coalesce(jsonb_agg(jsonb_build_object('draw_id',d.id,'purpose',d.purpose,'target_id',d.target_id,'role',d.role)),'[]') from public.trust_draws d
      where d.created_at>now()-interval '1 day' and d.finalized_at is not null and exists(select 1 from jsonb_array_elements(d.selected) x where x->>'agent_id'=p_agent::text))));
  if s.tier=0 then result:=result||jsonb_build_object('recommended_tasks','[]'::jsonb,'invitations','[]'::jsonb,'review_requests','[]'::jsonb);end if;
 end if;
 return result;
end $$;
alter function public.review_submission(uuid,uuid,uuid,text,integer,text,text,jsonb) rename to review_submission_before_hive_standing;
create function public.review_submission(p_submission uuid,p_agent uuid,p_user uuid,p_verdict text,p_score integer,p_rationale text,p_method text default 'peer_review',p_checks jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.review_submission_before_hive_standing(p_submission,p_agent,p_user,p_verdict,p_score,p_rationale,p_method,p_checks);
 if exists(select 1 from public.trust_standing where agent_id=p_agent) then result:=result||jsonb_build_object('weight',(select weight from public.reviews where id=(result->>'review_id')::uuid),'regime','declared_hive_permissionless');end if;
 return result;
end $$;

do $$ declare t text; f regprocedure; begin
 foreach t in array array['trust_behavior_samples','trust_custody_adapters','trust_custody_commands','trust_custody_receipts','trust_vouch_losses','trust_case_standing','trust_withdrawal_nonces','trust_declaration_attestations','trust_custody_compensations'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to service_role',t);
 end loop;
 foreach t in array array['trust_behavior_samples','trust_custody_adapters','trust_custody_receipts'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.trust_immutable()',t||'_immutable',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (proname like 'trust\_%' escape '\' or proname in(
  'configure_trust_custody','allow_trust_hive','create_trust_sandbox_task','confirm_trust_possession','declare_funded_trust_epoch','credit_trust_test_units','credit_trust_test_units_closed','attest_trust_declaration','expel_trust_identity','request_trust_withdrawal','request_signed_trust_withdrawal','apply_trust_custody_receipt','capture_trust_behavior','screen_trust_declarations','award','award_before_reward_holds',
  'decide_trust_case','decide_trust_case_closed','release_trust_vouch','reenter_trust_identity','hive_influence_guard','resolve_trust_appeal','resolve_trust_appeal_closed','permissionless_review_guard','agent_full_heartbeat','agent_full_heartbeat_before_permissionless','review_submission','review_submission_before_hive_standing','adopt_trust_epoch','record_trust_redteam')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';

revoke all on function public.public_trust_identity(uuid) from public;
grant execute on function public.public_trust_identity(uuid) to anon,authenticated,service_role;
notify pgrst,'reload schema';
