-- Rollback-only custody ledger fixtures. Signature thresholds are independently
-- checked in the Edge crypto tests; these SQL-only calls model that trusted boundary.
begin;
create function pg_temp.custody_fails(q text,expected text) returns boolean language plpgsql as $$
begin execute q;return false;exception when others then if sqlstate<>expected then raise notice 'Unexpected [%] %',sqlstate,sqlerrm;end if;return sqlstate=expected;end $$;
do $$
declare actor uuid; ep uuid; receipt jsonb; withdrawal jsonb; caseid uuid; command uuid; result jsonb;
begin
 actor:=(public.register_manifest_agent('198.23.15.1','p15-custody-fixture')->'agent'->>'id')::uuid;
 ep:=(public.declare_funded_trust_epoch(now()+interval '1 day',now()+interval '2 days',100,20,60,100,'local-reserve','Declare an isolated custody fixture without accepting any real funds')->>'id')::uuid;
 insert into public.trust_protocols(epoch_id,settings,settings_hash) values(ep,'{"appeal_days":1}',repeat('a',64));
 perform public.configure_trust_custody(ep,'fixture-network','fixture-token',10,jsonb_build_array(repeat('1',64),repeat('2',64)),2,'Two independently administered attested custodians certify finalized deposits and external burns.');
 insert into public.trust_accounts(agent_id,epoch_id) values(actor,ep);
 assert pg_temp.custody_fails(format('select public.credit_trust_test_units(%L,100,%L,%L)',actor,'fake-real-credit','local-reserve'),'PT403'),'test credits cannot create real collateral';
 receipt:=jsonb_build_object('schema','posterity-custody-v1','receipt_id','fixture-finalized-deposit','epoch_id',ep,'agent_id',actor,'network','fixture-network','asset','fixture-token','units',100,
   'asset_amount',1000,'finalized_at',now()-interval '1 minute','finality_evidence','Local fixture models a threshold-attested finalized deposit, without receiving real assets.','operation','deposit');
 perform public.apply_trust_custody_receipt(receipt::text,'[]');perform public.apply_trust_custody_receipt(receipt::text,'[]');
 assert (select balance=100 from public.trust_accounts where agent_id=actor),'finalized deposit receipt credits exactly once';
 assert public.trust_account_view(actor)->>'custody'='threshold_attested_custody' and public.trust_release(actor)->>'custody'='threshold_attested_custody','funded accounts and releases cannot be mislabeled as test units';
 assert pg_temp.custody_fails(format('select public.apply_trust_custody_receipt(%L,%L)',(receipt||'{"units":200,"asset_amount":2000}')::text,'[]'),'PT409'),'a receipt cannot be rebound to another amount';
 withdrawal:=public.request_signed_trust_withdrawal(actor,60,repeat('a',64));
 assert public.request_signed_trust_withdrawal(actor,60,repeat('a',64))->>'id'=withdrawal->>'id','signed nonce retry returns the same withdrawal';
 assert pg_temp.custody_fails(format('select public.request_signed_trust_withdrawal(%L,61,%L)',actor,repeat('a',64)),'PT409'),'withdrawal nonce cannot authorize another amount';
 assert pg_temp.custody_fails(format('select public.request_trust_withdrawal(%L,60)',actor),'PT409'),'pending withdrawal prevents collateral reuse';
 receipt:=receipt||jsonb_build_object('receipt_id','fixture-finalized-withdrawal','operation','withdraw','units',60,'asset_amount',600,'command_id',withdrawal->>'id');
 assert pg_temp.custody_fails(format('select public.apply_trust_custody_receipt(%L,%L)',(receipt-'operation')::text,'[]'),'PT400'),'missing operation cannot clear a withdrawal without debiting';
 assert pg_temp.custody_fails(format('select public.apply_trust_custody_receipt(%L,%L)',(receipt-'finalized_at')::text,'[]'),'PT400'),'finality timestamp is mandatory';
 perform public.apply_trust_custody_receipt(receipt::text,'[]');perform public.apply_trust_custody_receipt(receipt::text,'[]');
 assert (select balance=40 and not frozen from public.trust_accounts where agent_id=actor),'withdrawal finality debits once and clears its hold';
 caseid:=(public.open_trust_case(actor,null,'review_fraud',repeat('e',64),'https://fixtures.invalid/custody-case','local-reserve')->>'id')::uuid;
 update public.trust_cases set created_at=now()-interval '2 days' where id=caseid;
 perform public.decide_trust_case(caseid,true,20,'attested-reserve:fixture','Attested evidence established a violation after the configured adjudication deadline.');
 select id into command from public.trust_custody_commands where agent_id=actor and operation='slash';
 assert command is not null,'real-asset slashing creates an auditable external custody command';
 receipt:=receipt||jsonb_build_object('receipt_id','fixture-finalized-burn','operation','slash','units',20,'asset_amount',200,'command_id',command);
 perform public.apply_trust_custody_receipt(receipt::text,'[]');
 perform public.appeal_trust_case(actor,caseid,'The finalized violation evidence has an independently reproducible confound.');
 update public.trust_cases set appealed_at=now()-interval '2 days' where id=caseid;
 assert pg_temp.custody_fails(format('select public.resolve_trust_appeal(%L,false,%L,%L)',caseid,'attested-reserve:appeal','Appeal exoneration must not manufacture unbacked assets after an irreversible burn.'),'PT409'),'irreversible burns require funded compensation';
 receipt:=receipt||jsonb_build_object('receipt_id','fixture-funded-compensation','operation','compensate');
 perform public.apply_trust_custody_receipt(receipt::text,'[]');
 assert (select balance=20 from public.trust_accounts where agent_id=actor),'compensation reserves do not double-credit the stake ledger';
 result:=public.resolve_trust_appeal(caseid,false,'attested-reserve:appeal','The appeal exonerates the identity and the compensation funding is reconciled.');
 assert result->>'status'='dismissed' and (select balance=40 from public.trust_accounts where agent_id=actor),'funded exoneration restores exactly the burned stake';
 assert not has_function_privilege('authenticated','public.apply_trust_custody_receipt(text,jsonb)','EXECUTE'),'agent clients cannot bypass custody verification';
 raise notice 'PHASE15_CUSTODY: finalized receipts, nonces, collateral reuse, burns, appeals and funded compensation passed';
end $$;
rollback;
