-- Local rollback-only regressions for the Phase 13 security audit recovery contract.
begin;
create function pg_temp.recovery_fails(q text, expected text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate=expected; end $$;
do $$
declare mf jsonb; a uuid; b uuid; c uuid; replacement uuid; reviewer uuid; m uuid; t uuid; e uuid; i int;
  draft uuid; synthesis uuid; critique uuid; recovery uuid; sub uuid; result jsonb; checks jsonb; budget numeric; human_owner uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
begin
 mf:='{"schema_version":1,"lab":"audit-lab","models":["fixture"],"tools":[],"languages":[],"capabilities":["analysis"],"context_window":1000,"strengths":[],"roles":["proposer","critic","synthesizer"]}';
 a:=(public.register_manifest_agent('198.51.100.1','audit13-proposer',p_manifest=>mf)->'agent'->>'id')::uuid;
 b:=(public.register_manifest_agent('198.51.101.1','audit13-critic',p_manifest=>mf)->'agent'->>'id')::uuid;
 c:=(public.register_manifest_agent('198.51.102.1','audit13-synth',p_manifest=>mf)->'agent'->>'id')::uuid;
 replacement:=(public.register_manifest_agent('198.51.103.1','audit13-replacement',p_manifest=>mf)->'agent'->>'id')::uuid;
 reviewer:=(public.register_manifest_agent('198.51.104.1','audit13-reviewer',p_manifest=>mf)->'agent'->>'id')::uuid;
 insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,review_quorum,requires_final_approval)
 values('audit13-flood','Audit flood','Check bounded recovery','active',a,a,1,false) returning id into m;
 t:=public.insert_task_from_json(m,'{"key":"flood","title":"Check contribution exhaustion","kind":"analysis","ensemble":{"distinct_labs":false,"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}}','open');
 select id into e from public.ensembles where task_id=t;
 perform public.ensemble_join(a,e,'proposer');
 perform public.ensemble_join(b,e,'critic');
 perform public.ensemble_join(c,e,'synthesizer');
 assert not has_function_privilege('anon','public.web_review_submission_evidence(uuid,text,integer,text,jsonb)','EXECUTE'),'anonymous cannot review recovery evidence';
 assert not has_function_privilege('anon','public.recover_ensemble_round(uuid,integer,text,text)','EXECUTE'),'anonymous cannot recover';
 assert not has_function_privilege('authenticated','public.recover_ensemble_round(uuid,integer,text,text)','EXECUTE'),'browser cannot recover';
 assert not has_table_privilege('authenticated','public.ensemble_recoveries','INSERT'),'browser cannot fabricate recovery';
 assert not has_function_privilege('authenticated','public.ensemble_view_v13(uuid)','EXECUTE'),'renamed view remains private';
 assert pg_temp.recovery_fails(format('select public.recover_ensemble_round(%L,1,%L,%L)',e,'operator','No actual exhaustion yet'),'PT409'),'cannot restart an ordinary round';
 for i in 1..16 loop perform public.ensemble_contribute(b,e,'objection','Repeated objection '||i,'A repeated objection consumes the critic budget'); end loop;
 assert pg_temp.recovery_fails(format('select public.ensemble_contribute(%L,%L,%L,%L)',b,e,'objection','Excess objection'),'PT429'),'critic capped at 16';
 draft:=(public.ensemble_contribute(a,e,'draft','Legitimate draft','Proposer capacity survives critic flood')->>'id')::uuid;
 synthesis:=(public.ensemble_contribute(c,e,'synthesis','Legitimate synthesis','Synthesizer capacity survives critic flood')->>'id')::uuid;
 perform public.ensemble_leave(b,e,'Leaving after filling the critic budget');
 perform public.ensemble_join(b,e,'critic');
 assert pg_temp.recovery_fails(format('select public.ensemble_contribute(%L,%L,%L,%L)',b,e,'objection','Rejoin excess'),'PT429'),'same identity rejoin cannot reset quota';
 perform public.ensemble_leave(b,e,'Replacement needs a recovery path');
 perform public.ensemble_join(replacement,e,'critic');
 assert pg_temp.recovery_fails(format('select public.ensemble_contribute(%L,%L,%L,%L)',replacement,e,'review','Replacement review'),'PT429'),'replacement cannot silently reset shared role quota';
 assert pg_temp.recovery_fails(format('select public.recover_ensemble_round(%L,2,%L,%L)',e,'operator','A stale or wrong expected round'),'PT409'),'wrong expected round rejected';
 assert pg_temp.recovery_fails(format('select public.recover_ensemble_round(%L,1,null,%L)',e,'Missing operator provenance'),'PT400'),'operator required';
 recovery:=(public.recover_ensemble_round(e,1,'local-auditor','Critic exhausted its budget; preserve objections for independent review')->>'id')::uuid;
 assert (select round=2 from public.ensembles where id=e),'recovery advances round';
 assert pg_temp.recovery_fails(format('select public.recover_ensemble_round(%L,1,%L,%L)',e,'operator','Repeated stale recovery attempt'),'PT409'),'retry cannot restart a second round';
 assert (select count(*)=18 from public.ensemble_contributions where ensemble_id=e and round=1),'all prior contributions retained';
 assert jsonb_array_length(public.ensemble_view(e)->'recoveries'->0->'contributions')=18,'archived evidence exposed to reviewers';
 assert pg_temp.recovery_fails(format('select public.ensemble_score(%L,%L,5,%L)',replacement,draft,'Trying to rewrite archived evidence'),'PT409'),'recovery freezes old peer scores';
 assert not exists(select 1 from public.reputation_events where task_id=t),'restart mints no reputation';
 draft:=(public.ensemble_contribute(a,e,'draft','Recovered draft','Draft addressing archived objections')->>'id')::uuid;
 critique:=(public.ensemble_contribute(replacement,e,'review','Replacement review','Replacement has fresh capacity')->>'id')::uuid;
 synthesis:=(public.ensemble_contribute(c,e,'synthesis','Recovered synthesis','Synthesis addresses the archived objections')->>'id')::uuid;
 perform public.ensemble_score(replacement,draft,5,'Critic checked the recovered draft');
 perform public.ensemble_score(a,critique,5,'Peer checked the replacement review');
 perform public.ensemble_score(replacement,synthesis,5,'Critic checked the recovered synthesis');
 result:=public.ensemble_submit(c,e,synthesis,array[draft,critique,synthesis]);
 sub:=(result->>'submission_id')::uuid;
 assert (select ensemble_recovery_ids=array[recovery] from public.submissions where id=sub),'submission snapshots recovery obligations';
 assert pg_temp.recovery_fails(format('select public.recover_ensemble_round(%L,2,%L,%L)',e,'operator','Cannot restart a pending submission'),'PT409'),'submitted round cannot recover';
 assert pg_temp.recovery_fails(format('select public.review_submission(%L,%L,null,%L,5,%L)',sub,reviewer,'approve','Omitting all archived objections'),'PT409'),'cannot approve without archived evidence';
 assert pg_temp.recovery_fails(format('update public.submissions set status=%L where id=%L','accepted',sub),'PT409'),'finalization cannot bypass evidence review';
 checks:=jsonb_build_array(jsonb_build_object('name','Archived round review','recovery_id',recovery,'passed',true,'objections','[]'::jsonb));
 assert pg_temp.recovery_fails(format('select public.review_submission(%L,%L,null,%L,5,%L,%L,%L::jsonb)',sub,reviewer,'approve','Acknowledgement without objection assessment','peer_review',checks),'PT409'),'every old objection needs a disposition';
 select jsonb_build_array(jsonb_build_object('name','Archived round review','recovery_id',recovery,'passed',true,
   'objections',jsonb_agg(jsonb_build_object('objection_id',id,'upheld',true,'rationale','Independently checked that the final synthesis addresses this objection')))) into checks
 from public.ensemble_contributions where ensemble_id=e and round=1 and kind='objection';
 assert pg_temp.recovery_fails(format('select public.review_submission(%L,%L,null,%L,5,%L,%L,%L::jsonb)',sub,b,'approve','Former attacker cannot become final reviewer','peer_review',checks),'PT403'),'former critic still excluded';
 perform public.review_submission(sub,reviewer,null,'approve',5,'Independently checked current work and every archived objection','peer_review',checks);
 assert (select status='accepted' from public.submissions where id=sub),'independent review completes recovered ensemble';
 select s.budget into budget from public.ensemble_settlements s where submission_id=sub;
 assert budget>0 and budget=(select sum(delta) from public.reputation_events where submission_id=sub and kind in ('submission_accepted','ensemble_contribution')),'recovery preserves reward pool';
 assert not exists(select 1 from public.reputation_events where submission_id=sub and agent_id=b and delta>0),'abandoned-round attacker gains no reward';

 -- Legacy rounds may already contain 64 entries. Model their stored state directly;
 -- production APIs cannot create this state after the quota fix.
 update public.missions set status='active' where id=m;
 t:=public.insert_task_from_json(m,'{"key":"legacy","title":"Legacy exhausted round","kind":"analysis","ensemble":{"distinct_labs":false,"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}}','open');
 select id into e from public.ensembles where task_id=t;
 perform public.ensemble_join(a,e,'proposer'); perform public.ensemble_join(b,e,'critic'); perform public.ensemble_join(c,e,'synthesizer');
 insert into public.ensemble_contributions(ensemble_id,member_id,round,kind,summary)
 select e,em.id,1,'objection','Legacy objection '||n from public.ensemble_members em cross join generate_series(1,64) n where em.ensemble_id=e and em.agent_id=b and em.state='active';
 assert pg_temp.recovery_fails(format('select public.ensemble_contribute(%L,%L,%L,%L)',a,e,'draft','Legacy blocked draft'),'PT429'),'legacy total cap fails closed';
 update public.ensemble_members set lease_expires_at=now()-interval '1 second' where ensemble_id=e and agent_id=b;
 perform public.recover_ensemble_round(e,1,'local-auditor','Recover a round exhausted before the quota migration');
 assert (select state='expired' from public.ensemble_members where ensemble_id=e and agent_id=b),'recovery does not revive expired leases';
 perform public.ensemble_join(replacement,e,'critic');
 critique:=(public.ensemble_contribute(replacement,e,'review','Fresh replacement work','Legacy exhaustion recovered')->>'id')::uuid;
 assert jsonb_array_length(public.ensemble_view(e)->'recoveries'->0->'contributions')=64,'all legacy objections retained';

 -- Human-only recovery remains usable through the owner-authenticated web contract.
 insert into auth.users(id,instance_id,aud,role,email,raw_user_meta_data,created_at,updated_at)
 values(human_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','recovery-owner@fixture.invalid','{}',now(),now()),
       (other_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','recovery-other@fixture.invalid','{}',now(),now());
 update public.missions set created_by_user=human_owner where id=m;
 update public.agents set owner_id=(select id from auth.users where email='recovery-owner@fixture.invalid') where id=a;
 update public.tasks set verification_method='human' where id=t;
 draft:=(public.ensemble_contribute(a,e,'draft','Recovered legacy draft','All archived objections addressed')->>'id')::uuid;
 synthesis:=(public.ensemble_contribute(c,e,'synthesis','Recovered legacy synthesis','All archived objections addressed')->>'id')::uuid;
 perform public.ensemble_score(replacement,draft,5,'Checked the recovered legacy draft');
 perform public.ensemble_score(a,critique,5,'Checked the replacement legacy review');
 perform public.ensemble_score(replacement,synthesis,5,'Checked the recovered legacy synthesis');
 sub:=(public.ensemble_submit(c,e,synthesis,array[draft,critique,synthesis])->>'submission_id')::uuid;
 select r.id into recovery from public.ensemble_recoveries r where r.ensemble_id=e and r.round=1;
 select jsonb_build_array(jsonb_build_object('name','Legacy round review','recovery_id',recovery,'passed',true,
   'objections',jsonb_agg(jsonb_build_object('objection_id',id,'upheld',false,'rationale','The repeated objection is unsupported by the archived evidence')))) into checks
 from public.ensemble_contributions where ensemble_id=e and round=1 and kind='objection';
 set local role authenticated;
 perform set_config('request.jwt.claims',json_build_object('sub',other_id,'role','authenticated')::text,true);
 assert pg_temp.recovery_fails(format('select public.web_review_submission_evidence(%L,%L,5,%L,%L::jsonb)',sub,'approve','An unrelated human attempts review',checks),'PT403'),'web evidence endpoint remains owner-only';
 perform set_config('request.jwt.claims',json_build_object('sub',human_owner,'role','authenticated')::text,true);
 assert jsonb_array_length(public.submission_recovery_evidence(sub)->0->'contributions')=64,'browser sees the exact archived evidence';
 assert pg_temp.recovery_fails(format('select public.web_review_submission(%L,%L,5,%L)',sub,'approve','Old browser call omits archived evidence'),'PT409'),'old owner wrapper cannot bypass recovery';
 perform public.web_review_submission_evidence(sub,'approve',5,'Owner checked the final result against every archived objection',checks);
 reset role;
 assert (select status='accepted' from public.submissions where id=sub),'owner can complete human-only recovered work';
 assert (select not independent from public.reviews where submission_id=sub and reviewer_user_id=human_owner),'owner related to any member is not independent';
 assert (select st.budget=0 from public.ensemble_settlements st where st.submission_id=sub),'related owner recovery creates no reputation';
 raise notice 'PHASE13_RECOVERY: role budgets, operator recovery, archived review, legacy recovery and reward conservation passed';
end $$;
rollback;
