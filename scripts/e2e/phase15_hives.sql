-- Local-only rollback fixtures deliberately simulate elapsed clocks and bootstrap
-- attested audits. They do not assert that production rollout evidence exists.
begin;
create function pg_temp.p15_check_fails(q text,expected text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then
 if sqlstate<>expected then raise notice 'Unexpected [%] %',sqlstate,sqlerrm; end if;return sqlstate=expected;
end $$;
do $$
declare actors uuid[]:='{}'; hives uuid[]:='{}'; a uuid; h uuid; ep uuid; future uuid; m uuid; t uuid; en uuid; r jsonb; cfg jsonb; sample uuid;
 i integer; j integer; challenge jsonb; draw jsonb; drawid uuid; chosen uuid; voter uuid; caseid uuid; vouch uuid; original numeric; nonce text:=repeat('c',64);
 signature text:=repeat('b',96); random text; wire text; member uuid; digest text;
begin
 cfg:=jsonb_build_object('tau0_stake_days',7,'tau0_tenure_days',14,'tau1_days',14,'extended_days',28,'n0',10,'n1',10,'window',10,'vouch_units',50,'vouch_days',60,
  'reward_delay_days',7,'jury_size',3,'appeal_days',7,'z_score',1.96,'p0',0.5,'p1',0.5,'a1',1,'a2',0.1,'c1',1,'delta',0.1,'detection_min',0.8,'false_positive_max',0.05,
  'screening','text-v1','randomness_scheme','drand-bls-unchained-g1-rfc9380','beacon_public_key',repeat('a',192),'beacon_chain_hash',repeat('d',64),'beacon_period',3,'beacon_genesis',1692803367,'beacon_delay_seconds',300,
  'stake_economics','{"p_success":0.1,"extractable":10,"operations":10,"capital_cost":1,"p_slash":0.5,"burned_stake":100,"lost_standing":0,"margin":5}'::jsonb,
  'tenure_economics','{"p_success":0.1,"extractable":10,"operations":10,"capital_cost":0,"p_slash":0.5,"burned_stake":0,"lost_standing":0,"margin":5}'::jsonb);
 future:=(public.declare_trust_epoch(now()+interval '2 days',now()+interval '3 days',100,20,60,100,'local-reserve','Declare a future protocol epoch for validation')->>'id')::uuid;
 assert pg_temp.p15_check_fails(format('select public.declare_trust_protocol(%L,%L)',future,(cfg||'{"a2":1}')::text),'PT400'),'a2 must be lower than a1';
 assert pg_temp.p15_check_fails(format('select public.declare_trust_protocol(%L,%L)',future,(cfg||'{"tenure_economics":{"p_success":1,"extractable":1000,"operations":0,"capital_cost":0,"p_slash":0,"burned_stake":0,"lost_standing":0,"margin":1}}')::text),'PT400'),'insecure no-stake economics rejected';
 perform public.declare_trust_protocol(future,cfg);
 assert pg_temp.p15_check_fails(format('update public.trust_protocols set settings=%L where epoch_id=%L','{}',future),'PT403'),'parameters immutable';
 insert into public.trust_epochs(starts_at,ends_at,stake_units,escrow_units,dispute_seconds,reward_cap,operator,reason)
  values(now()-interval '1 day',now()+interval '365 days',100,20,60,100,'local-reserve','Privileged elapsed-time fixture, not production evidence') returning id into ep;
 insert into public.trust_protocols(epoch_id,settings,settings_hash) values(ep,cfg,encode(extensions.digest(cfg::text,'sha256'),'hex'));
 assert pg_temp.p15_check_fails(format('select public.advance_trust_rollout(%L,2,%L,%L)',ep,'{"sha256":"'||repeat('a',64)||'","reason":"Never skip the required preceding rollout evidence"}','local-reserve'),'PT409'),'rollout cannot skip stages';
 -- Bootstrap only under the local transaction; these are not production attestations.
 insert into public.trust_rollouts(epoch_id,stage,evidence,operator) values(ep,2,'{"fixture":true}','local-reserve');
 for i in 1..8 loop
  a:=(public.register_manifest_agent('198.20.15.'||i,'p15h-'||i,p_manifest=>'{"schema_version":1,"lab":"fixture","models":["fixture"],"capabilities":["analysis"],"tools":[],"languages":["en"],"context_window":32000,"strengths":[],"roles":["proposer","critic","synthesizer"]}')->'agent'->>'id')::uuid;
  actors:=array_append(actors,a);
  if i=2 then h:=hives[1];
  else insert into public.trust_hives(name,operator_key,substrate_hash,declaration) values('Fixture hive '||i,encode(extensions.digest('operator-'||i,'sha256'),'hex'),encode(extensions.digest('substrate-'||i,'sha256'),'hex'),'These identities share this operator and execution substrate; this declared hive is exactly one party.') returning id into h;end if;
  hives:=array_append(hives,h);
  insert into public.trust_hive_members(agent_id,hive_id) values(a,h);
  insert into public.trust_identity_keys(agent_id,public_key,hive_id,track) values(a,encode(extensions.digest('identity-'||i,'sha256'),'hex'),h,case when i=2 then 'tenure' else 'stake' end);
  perform public.enroll_permissionless(a,ep);
  perform public.credit_trust_test_units(a,1000,'p15h-receipt-'||i,'local-reserve');
 end loop;
 assert public.agents_related(actors[1],actors[2]),'a hundred-agent hive is one party';
 assert not public.agents_related(actors[1],actors[3]),'different declared hives remain distinct absent evidence';
 update public.trust_accounts set balance=0 where agent_id=actors[5];
 assert (select stake_since is null from public.trust_standing where agent_id=actors[5]),'unfunding entry stake resets its accelerated clock';
 update public.trust_accounts set balance=1000 where agent_id=actors[5];
 assert pg_temp.p15_check_fails(format('update public.trust_hive_members set hive_id=%L where agent_id=%L',hives[3],actors[1]),'PT403'),'membership cannot be laundered';
 update public.trust_standing set tier=2 where agent_id=actors[8]; -- Local attested bootstrap fixture.
 insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,review_quorum,requires_final_approval)
  values('p15-hive-contract','Hive contract','Exercise permissionless controls','active',actors[8],actors[8],1,false) returning id into m;
 t:=public.insert_task_from_json(m,'{"key":"legacy","title":"Legacy task","kind":"analysis","capabilities":["analysis"]}','open');
 assert pg_temp.p15_check_fails(format('select public.claim_task(%L,%L)',actors[1],t),'PT403'),'T0 cannot claim legacy real work';
 assert pg_temp.p15_check_fails(format('insert into public.knowledge(kind,title,body,agent_id) values(%L,%L,%L,%L)','insight','Sandbox leak','This output must stay quarantined',actors[1]),'PT403'),'T0 cannot export memory';
 perform public.award(actors[1],'submission_accepted',100,m,null,null,'{analysis}','Attempt sandbox standing export');
 assert not exists(select 1 from public.reputation_events where agent_id=actors[1]),'T0 cannot export reputation';
 assert pg_temp.p15_check_fails(format('select public.promote_trust_identity(%L)',actors[1]),'PT409'),'capital cannot purchase tier';
 -- Exactly ten distinct sandbox tasks, all independently attested, with elapsed clocks.
 update public.trust_standing set tier_since=now()-interval '40 days',stake_since=now()-interval '40 days' where agent_id=actors[1];
 for i in 1..10 loop
  insert into public.trust_sandbox_tasks(epoch_id,prompt,acceptance_criteria) values(ep,'Synthetic fixture task number '||i,'Independent attested audit must check the fixture criteria') returning id into sample;
  perform public.submit_sandbox_output(actors[1],sample,'Legible quarantined output with testable evidence for task '||i);
  perform public.record_trust_audit(actors[1],sample,true,true,null,'attested-fixture',repeat('a',64),'Independently checked the synthetic fixture against every criterion');
 end loop;
 r:=public.promote_trust_identity(actors[1]); assert r->>'tier'='1','T0 becomes T1 only after clocks and audited tasks';
 assert not exists(select 1 from public.knowledge where agent_id=actors[1]),'sandbox pass rate did not publish knowledge';
 assert pg_temp.p15_check_fails(format('select public.record_trust_audit(%L,%L,true,true,null,%L,%L,%L)',actors[1],sample,'attested-fixture',repeat('a',64),'Attempt to count one task twice toward promotion'),'23505'),'audit evidence cannot be replayed';
 update public.trust_standing set tier_since=now()-interval '40 days' where agent_id=actors[1];
 for i in 1..10 loop
  t:=public.insert_task_from_json(m,jsonb_build_object('key','audited-real-'||i,'title','Independently settled real fixture','kind','analysis','capabilities',jsonb_build_array('analysis')),'open');
  perform public.bind_permissionless_task(t,ep);
  update public.tasks set status='done',assignee_id=actors[1] where id=t; -- Privileged settled-work fixture.
  perform public.record_trust_audit(actors[1],t,false,true,null,'attested-fixture',repeat('a',64),'Independent attested audit confirms this distinct completed task.');
 end loop;
 r:=public.promote_trust_identity(actors[1]);assert r->>'tier'='2','extended clean record substitutes for incumbent vouch';
 -- Local bootstrap supplies other independent T2 actors for jury/vouch protocol tests.
 update public.trust_standing set tier=2,tier_since=now()-interval '100 days' where agent_id=any(actors[3:8]);
 update public.trust_standing set tier=1,tier_since=now()-interval '100 days' where agent_id=actors[2];
 assert pg_temp.p15_check_fails(format('select public.vouch_trust_identity(%L,%L,%L)',actors[3],actors[3],'A hive cannot vouch for its own identity or standing'),'PT403'),'no self-vouch';
 update public.trust_standing set tier=2 where agent_id=actors[1];
 assert pg_temp.p15_check_fails(format('select public.vouch_trust_identity(%L,%L,%L)',actors[1],actors[2],'Two agents in one hive cannot vouch for one another'),'PT403'),'no intra-hive vouch';
 vouch:=(public.vouch_trust_identity(actors[3],actors[2],'Independent T2 hive accepts financially accountable vouch liability')->>'id')::uuid;
 assert (select units=50 from public.trust_vouches where id=vouch),'vouch encumbers separate declared stake';
 t:=public.insert_task_from_json(m,'{"key":"review-clock","title":"Settled work review dispatch","kind":"analysis","capabilities":["analysis"]}','open');
 perform public.bind_permissionless_task(t,ep);
 -- Privileged clock fixture: review begins long after the work policy was declared.
 execute 'set local session_replication_role=replica';
 update public.trust_task_policies set declared_at=now()-interval '1 hour' where task_id=t;
 update public.tasks set status='in_review',assignee_id=actors[1],attempts=1 where id=t;
 insert into public.submissions(task_id,mission_id,agent_id,summary) values(t,m,actors[1],'Independent review starts at submission, after the original assignment window');
 execute 'set local session_replication_role=origin';
 draw:=public.prepare_trust_draw(t,'reviewer:1');
 assert (draw->>'beacon_due')::timestamptz>now(),'review dispatch uses a fresh submission anchor, not the old work assignment';
 assert not exists(select 1 from jsonb_array_elements(draw->'pool') x where x->>'hive_id'=public.agent_hive(actors[1])::text),'reviewer sortition excludes the author hive';
 t:=public.insert_task_from_json(m,'{"key":"lottery","title":"Hive lottery work","kind":"analysis","capabilities":["analysis"],"ensemble":{"distinct_labs":false,"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}}','open');
 perform public.bind_permissionless_task(t,ep);select id into en from public.ensembles where task_id=t;
 draw:=public.prepare_trust_draw(t,'proposer');drawid:=(draw->>'id')::uuid;
 assert jsonb_array_length(draw->'pool')=7,'two identities in a hive have one lottery entry';
 assert (select jsonb_array_length(x->'agents')=2 from jsonb_array_elements(draw->'pool') x where x->>'hive_id'=public.agent_hive(actors[1])::text),'fleet keys remain eligible within their single party';
 assert public.prepare_trust_draw(t,'proposer')->>'id'=drawid::text,'retry cannot reroll a prepared pool';
 assert pg_temp.p15_check_fails(format('select public.ensemble_join(%L,%L,%L)',actors[1],en,'proposer'),'PT409'),'no unverified assignment ticket';
 random:=encode(extensions.digest(decode(signature,'hex'),'sha256'),'hex');
 assert pg_temp.p15_check_fails(format('select public.finalize_trust_draw(%L,%L,%L)',drawid,signature,random),'PT400'),'future beacon barrier enforced';
 -- Only the local superuser clock fixture bypasses the immutable draw guard.
 execute 'set local session_replication_role=replica';
 update public.trust_draws set beacon_due=now()-interval '1 second',created_at=now()-interval '2 seconds' where id=drawid;
 execute 'set local session_replication_role=origin';
 draw:=public.finalize_trust_draw(drawid,signature,random);chosen:=(draw->'selected'->0->>'agent_id')::uuid;
 member:=(public.ensemble_join(chosen,en,'proposer')->>'id')::uuid;
 assert exists(select 1 from public.trust_assignments where draw_id=drawid and agent_id=chosen),'actual assignment consumes sortition ticket';
 assert pg_temp.p15_check_fails(format('select public.ensemble_contribute(%L,%L,%L,%L,%L)',chosen,en,'draft','Unaccountable reason','An opaque reason cannot cross the L2 boundary'),'PT400'),'L2 requires full legible accountability';
 wire:='{"reasoning":"The critic can check these explicit claims and the stated uncertainty against the cited evidence.","claims":["This proposal is testable"],"assumptions":[],"evidence":["A local fixture demonstrates the boundary"],"uncertainties":["Synthetic work does not establish production security"]}';
 perform public.validate_accountability(wire);
 assert pg_temp.p15_check_fails('select public.validate_accountability(''{"vectors":[1,2,3]}'')','PT400'),'opaque inter-hive neuralese is inadmissible';
 -- A different hive cannot turn a statistical signal directly into a penalty.
 caseid:=(public.open_trust_case(actors[2],null,'correlation',repeat('e',64),'https://fixtures.invalid/hive-audit','attested-fixture')->>'id')::uuid;
 select balance into original from public.trust_accounts where agent_id=actors[2];
 assert pg_temp.p15_check_fails(format('select public.decide_trust_case(%L,true,10,%L,%L)',caseid,'unlabelled-operator','Statistical suspicion cannot bypass the distinct-hive jury'),'PT403'),'no instant statistical slashing';
 draw:=public.prepare_trust_draw(caseid,'juror','jury');drawid:=(draw->>'id')::uuid;
 assert not exists(select 1 from jsonb_array_elements(draw->'pool') x where x->>'hive_id' in(public.agent_hive(actors[2])::text,public.agent_hive(actors[3])::text)),'jury excludes subject and financially liable voucher hives';
 execute 'set local session_replication_role=replica';
 update public.trust_draws set beacon_due=now()-interval '1 second',created_at=now()-interval '2 seconds' where id=drawid;
 execute 'set local session_replication_role=origin';
 draw:=public.finalize_trust_draw(drawid,signature,random);
 assert jsonb_array_length(draw->'selected')=3,'jury has three distinct hives';
 for voter in select (x->>'agent_id')::uuid from jsonb_array_elements(draw->'selected') x loop
  perform public.cast_trust_jury_vote(voter,drawid,false,0,'The shared-model confound is documented; the declaration violation has not been established.');
 end loop;
 r:=public.settle_trust_jury(drawid);
 assert r->>'status'='dismissed','legible jury majority dismisses unsupported accusation';
 assert (select balance=original from public.trust_accounts where agent_id=actors[2]),'flag alone burned no stake';
 -- Simulate an elapsed attested adjudication window; exercise linked voucher
 -- liability and exoneration without manufacturing real collateral.
 update public.trust_vouches set created_at=now()-interval '20 days' where id=vouch;
 caseid:=(public.open_trust_case(actors[2],null,'review_fraud',repeat('f',64),'https://fixtures.invalid/confirmed-audit','attested-fixture')->>'id')::uuid;
 update public.trust_cases set created_at=now()-interval '10 days' where id=caseid;
 r:=public.decide_trust_case(caseid,true,20,'attested-reserve:fixture','Attested confirmation after the declared sortition jury liveness deadline.');
 assert public.trust_tier(actors[2])=0,'evidenced violation demotes immediately';
 assert (select balance=950 from public.trust_accounts where agent_id=actors[3]),'voucher collateral slashed with the violation';
 assert exists(select 1 from public.trust_vouch_losses where vouch_id=vouch and units=50),'voucher loss retained as accountable evidence';
 perform public.appeal_trust_case(actors[2],caseid,'The confirmed review-fraud evidence has a reproducible ground-truth error.');
 update public.trust_cases set appealed_at=now()-interval '10 days' where id=caseid;
 r:=public.resolve_trust_appeal(caseid,false,'attested-reserve:appeal-fixture','Attested appeal corrected the ground truth and exonerated this identity.');
 assert public.trust_tier(actors[2])=1,'exoneration restores prior earned standing';
 assert (select balance=1000 from public.trust_accounts where agent_id=actors[3]),'exoneration restores voucher collateral exactly once';
 caseid:=(public.open_trust_case(actors[2],null,'false_independence',repeat('d',64),'https://fixtures.invalid/declaration-audit','attested-fixture')->>'id')::uuid;
 update public.trust_cases set created_at=now()-interval '10 days' where id=caseid;
 assert pg_temp.p15_check_fails(format('select public.decide_trust_case(%L,true,10,%L,%L)',caseid,'attested-reserve:fixture','A weak text signal alone cannot establish shared undeclared substrate.'),'PT403'),'declaration charges require a separate evidence attestation';
 perform public.attest_trust_declaration(caseid,'attested-fixture',repeat('d',64),'Independent evidence confirms the undeclared common substrate; stylometry only initiated the review.');
 perform public.decide_trust_case(caseid,true,10,'attested-reserve:fixture','Attested evidence confirms the declaration violation after the jury liveness deadline.');
 perform public.link_confirmed_hives(hives[2],hives[4],caseid,'attested-fixture','The attested-confirmed declaration evidence establishes this shared operator boundary.');
 assert public.agents_related(actors[2],actors[4]),'confirmed undeclared substrate joins the party boundary';
 perform public.appeal_trust_case(actors[2],caseid,'An independently verified appeal establishes the declaration evidence was incorrect.');
 update public.trust_cases set appealed_at=now()-interval '10 days' where id=caseid;
 perform public.resolve_trust_appeal(caseid,false,'attested-reserve:appeal-fixture','Independent appeal evidence reverses the false declaration finding while retaining its log.');
 assert not public.agents_related(actors[2],actors[4]),'exoneration stops the inferred hive link without erasing history';
 assert not public.trust_graduated(ep),'no fabricated 12-month graduation';
 assert public.trust_portable_claim(actors[2],'https://home.invalid')->>'global_score' is null,'portability never imports a global score';
 assert not has_function_privilege('anon','public.consume_trust_challenge(uuid,uuid)','EXECUTE'),'possession bypass RPC private';
 assert not has_function_privilege('posterity_orchestrator','public.finalize_trust_draw(uuid,text,text)','EXECUTE'),'advisory matcher cannot forge beacon verification';
 assert not has_table_privilege('authenticated','public.trust_standing','UPDATE'),'stake cannot buy tier through table writes';
 raise notice 'PHASE15_HIVES: declared parties, quarantine, audited promotions, vouches, sortition, legibility, jury and rollout gates passed';
end $$;
rollback;
