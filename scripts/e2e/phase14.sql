-- Rollback-only security and behavior tests for advisory orchestration.
begin;
create function pg_temp.p14_fails(q text,expected text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate=expected; end $$;
do $$
declare lead uuid; newcomer uuid; veteran uuid; outsider uuid; m uuid; m2 uuid; m3 uuid; duplicate_run uuid; duplicate_offer uuid; membership record; third uuid; t uuid; new_task uuid; prior_task uuid; sub uuid;
  policy uuid; run uuid; offer uuid; other_offer uuid; plan_id uuid; result jsonb; mf jsonb; total int; i int; e uuid; saved text; owner uuid:=gen_random_uuid();
begin
 -- Isolate the sampling universe without persisting any change to existing identities.
 update public.agents set availability='away';
 mf:='{"schema_version":1,"lab":"test-lab","models":["fixture"],"capabilities":["analysis","p14-domain"],"tools":[],"languages":["en"],"context_window":32000,"strengths":[],"roles":["proposer","critic","synthesizer"]}';
 lead:=(public.register_manifest_agent('198.51.150.1','p14-lead',p_manifest=>mf||'{"capabilities":["planning"]}')->'agent'->>'id')::uuid;
 newcomer:=(public.register_manifest_agent('198.51.151.1','p14-new',p_manifest=>mf)->'agent'->>'id')::uuid;
 veteran:=(public.register_manifest_agent('198.51.152.1','p14-veteran',p_manifest=>mf)->'agent'->>'id')::uuid;
 outsider:=(public.register_manifest_agent('198.51.153.1','p14-outsider',p_manifest=>mf||'{"capabilities":["writing"]}')->'agent'->>'id')::uuid;
 insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,review_quorum,requires_final_approval)
 values('p14-advisory','Advisory test','Verify recommendations are optional','active',lead,lead,1,false) returning id into m;
 assert pg_temp.p14_fails(format('select public.run_orchestration(%L,%L)',m,lead),'PT409'),'policy must precede matching';
 assert pg_temp.p14_fails(format('select public.set_orchestration_policy(%L,%L,%L,0.2,true,%L)',m,outsider,'{"quality":1,"speed":0,"cost":0}','Attempt to change another mission'),'PT403'),'outsider cannot set objective';
 assert pg_temp.p14_fails(format('select public.set_orchestration_policy(%L,%L,%L,0.2,true,%L)',m,lead,'{"quality":0.7,"speed":0.7,"cost":0}','Invalid objective normalization'),'PT400'),'objective must sum to one';
 result:=public.set_orchestration_policy(m,lead,'{"quality":1,"speed":0,"cost":0}',1,true,'Explore fitting newcomers explicitly'); policy:=(result->>'id')::uuid;
 assert pg_temp.p14_fails(format('update public.orchestration_policies set exploration=0 where id=%L',policy),'PT403'),'policy immutable';
 for i in 1..5 loop
   prior_task:=public.insert_task_from_json(m,jsonb_build_object('key','prior-'||i,'title','Prior independently rewarded work','kind','analysis','capabilities',jsonb_build_array('p14-domain')),'done');
   insert into public.submissions(task_id,mission_id,agent_id,summary,status) values(prior_task,m,veteran,'Prior work fixture','accepted') returning id into sub;
   perform public.award(veteran,'submission_accepted',10,m,prior_task,sub,'{p14-domain}','Independent prior fixture');
 end loop;
 update public.agent_stats set reputation=10000 where agent_id=veteran;
 insert into public.agent_capability_reliability(agent_id,capability,successes) values(veteran,'p14-domain',100);
 for i in 1..4 loop
   new_task:=public.insert_task_from_json(m,jsonb_build_object('key','ready-'||i,'title','Ready advisory work','kind','analysis','capabilities',jsonb_build_array('p14-domain'),'acceptance_criteria','The result must pass independent review'),'open');
 end loop;
 perform public.insert_task_from_json(m,'{"key":"missing-criteria","title":"No explicit acceptance","kind":"analysis"}','open');
 perform public.insert_task_from_json(m,'{"key":"blocked","title":"Dependency still blocked","kind":"analysis","capabilities":["p14-domain"],"acceptance_criteria":"Await prerequisite"}','blocked');
 select count(*) into total from public.reputation_events;
 result:=public.run_orchestration(m,lead);run:=(result->>'run_id')::uuid;
 assert (result->>'suggestions')::int=4,'ready tasks suggested';
 assert (result->>'skipped_missing_criteria')::int=1,'missing criteria reported explicitly';
 assert (select count(*)=3 from public.orchestration_candidates where run_id=run and selected and agent_id=newcomer),'exploration includes newcomer without exceeding virtual capacity';
 assert (select count(*)=1 from public.orchestration_candidates where run_id=run and selected and agent_id=veteran),'experienced agent uses remaining slot';
 assert (select count(*)=total from public.reputation_events),'matching issues no reputation';
 assert not exists(select 1 from public.tasks where mission_id=m and assignee_id is not null),'suggestions do not assign work';
 assert not exists(select 1 from public.ensemble_members em join public.ensembles en on en.id=em.ensemble_id join public.tasks ta on ta.id=en.task_id where ta.mission_id=m),'suggestions do not join ensembles';
 assert (select count(*)=4 from public.orchestration_slots where run_id=run),'blocked or unspecified work not suggested';
 assert (select count(*)=16 from public.orchestration_candidates where run_id=run),'every sampled candidate logged for every slot';
 assert (select count(*)=4 from public.orchestration_agent_snapshots where run_id=run),'agent evidence deduplicated across slots';
 assert pg_temp.p14_fails(format('update public.orchestration_candidates set selected=false where run_id=%L',run),'PT403'),'decision log immutable';
 assert pg_temp.p14_fails(format('delete from public.orchestration_runs where id=%L',run),'PT403'),'run cannot be deleted directly';
 assert pg_temp.p14_fails(format('select public.run_orchestration(%L,%L)',m,lead),'PT429'),'run rate bounded';
 assert jsonb_array_length(public.orchestration_run_view(run,2,0)->'candidates')=2,'audit pages bounded';
 assert jsonb_array_length(public.orchestration_run_view(run,100,100)->'candidates')=0,'audit pagination works';
 assert (public.orchestration_fit(newcomer,new_task,'solo')->>'cost_known')::boolean=false,'missing cost stays explicitly unknown';
 assert (public.orchestration_fit(veteran,new_task,'solo')->>'newcomer')::boolean=false,'verified veteran distinguished from newcomer';
 select oc.id,oc.task_id into offer,t from public.orchestration_candidates oc where oc.run_id=run and oc.selected and oc.agent_id=newcomer order by oc.task_id limit 1;
 assert pg_temp.p14_fails(format('select public.orchestration_respond(%L,%L,%L,%L)',outsider,offer,'followed','Trying to report another agent assignment'),'PT403'),'feedback restricted to recipient';
 assert pg_temp.p14_fails(format('select public.orchestration_respond(%L,%L,%L,%L)',newcomer,offer,'followed','No actual assignment exists yet'),'PT409'),'followed requires actual claim';
 update public.tasks set acceptance_criteria='Changed acceptance criteria after matching' where id=t;
 assert not exists(select 1 from jsonb_array_elements(public.orchestration_inbox(newcomer)->'suggestions') o where o->>'suggestion_id'=offer::text),'changed acceptance invalidates advice';
 update public.tasks set acceptance_criteria=(select task_snapshot->>'acceptance_criteria' from public.orchestration_candidates where id=offer) where id=t;
 update public.tasks set attempts=attempts+1 where id=t;
 assert not exists(select 1 from jsonb_array_elements(public.orchestration_inbox(newcomer)->'suggestions') o where o->>'suggestion_id'=offer::text),'a new attempt cannot revive stale advice';
 update public.tasks set attempts=attempts-1 where id=t;
 perform public.claim_task(newcomer,t);
 perform public.orchestration_respond(newcomer,offer,'followed','I used the existing claim endpoint');
 -- Duplicate offers may exist across runs; one actual assignment counts once.
 begin
   insert into public.orchestration_runs(mission_id,policy_id,created_at,expires_at) values(m,policy,now()-interval '2 minutes',now()+interval '1 hour') returning id into duplicate_run;
   insert into public.orchestration_candidates(run_id,task_id,ensemble_id,role,agent_id,eligible,reason,snapshot_id,signals,score,draw,selected,explored,exploration_pool,task_snapshot)
   select duplicate_run,task_id,ensemble_id,role,agent_id,eligible,reason,snapshot_id,signals,score,draw,selected,explored,exploration_pool,task_snapshot
   from public.orchestration_candidates where id=offer returning id into duplicate_offer;
   assert pg_temp.p14_fails(format('select public.orchestration_respond(%L,%L,%L,%L)',newcomer,duplicate_offer,'followed','Duplicate attribution of the same actual claim'),'PT409'),'outcome observations cannot be counted twice';
   raise exception 'Rollback duplicate observation fixture' using errcode='P1401';
 exception when sqlstate 'P1401' then null; end;
 result:=public.submit_work(newcomer,t,'Independent advisory result','Meets the criteria','[]','[]',null,100,'fixture'); sub:=(result->>'submission_id')::uuid;
 perform public.review_submission(sub,outsider,null,'approve',5,'Independently checked the declared criteria');
 result:=public.orchestration_metrics(m);
 assert (result->>'independently_verified_outcomes')::int=1,'metrics join actual independently reviewed output';
 assert (result->>'unknown_outcomes')::int=3,'unobserved suggestions remain unknown';
 assert (result->>'mean_reported_tokens')::numeric=100,'metrics label actual reported tokens';
 assert (result->>'mission_reported_tokens')::numeric=100 and (result->>'mission_usage_events')::int=1,'per-mission reported cost remains queryable';
 select id into other_offer from public.orchestration_candidates where run_id=run and selected and agent_id=newcomer and id<>offer limit 1;
 perform public.orchestration_respond(newcomer,other_offer,'appeal','The proposed assignment appears mismatched');
 result:=public.orchestration_respond(newcomer,other_offer,'decline','I am declining this optional recommendation');
 assert (public.orchestration_respond(newcomer,other_offer,'decline','A retry cannot rewrite the original reason')->>'id')=result->>'id','feedback retry idempotent';
 assert not exists(select 1 from jsonb_array_elements(public.orchestration_inbox(newcomer)->'suggestions') x where x->>'suggestion_id'=other_offer::text),'decline removes suggestion';
 assert jsonb_array_length(public.orchestration_run_view(run)->'feedback')=3,'appeals and declines visible in audit';
 result:=public.propose_orchestration_plan(m,lead,'{"tasks":[{"key":"proposed","title":"Proposed subtask","kind":"analysis","acceptance_criteria":"A reviewer checks the evidence"}]}');
 assert not (result->>'materialized')::boolean and not exists(select 1 from public.tasks where mission_id=m and key='proposed'),'decomposition remains an advisory proposal';
 assert pg_temp.p14_fails(format('select public.propose_orchestration_plan(%L,%L,%L)',m,lead,'{"tasks":[{"key":"missing","title":"Missing acceptance"}]}'),'PT400'),'decomposition needs explicit criteria';
 perform public.set_orchestration_policy(m,lead,'{"quality":0.6,"speed":0.2,"cost":0.2}',0.2,false,'Disable advice without changing ordinary claims');
 assert jsonb_array_length(public.orchestration_inbox(veteran)->'suggestions')=0,'policy revision invalidates old advice';
 select id into t from public.tasks where mission_id=m and key='missing-criteria';
 perform public.claim_task(veteran,t);
 assert (select assignee_id=veteran from public.tasks where id=t),'ordinary self-claim works without enabled advice';

 -- Optional advice failures cannot break the base heartbeat.
 select pg_get_functiondef('public.orchestration_inbox(uuid)'::regprocedure) into saved;
 execute 'create or replace function public.orchestration_inbox(p_agent uuid) returns jsonb language plpgsql stable security definer set search_path='''' as $broken$ begin raise exception ''simulated advisory outage''; end $broken$';
 result:=public.agent_full_heartbeat(lead);
 assert result ? 'you' and result ? 'code' and (result->'orchestration'->>'unavailable')::boolean,'heartbeat survives advisory outage';
 execute saved;

 -- Human ownership constrains the policy authority of a delegated lead.
 insert into auth.users(id,instance_id,aud,role,email,raw_user_meta_data,created_at,updated_at)
 values(owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p14-owner@fixture.invalid','{}',now(),now());
 insert into public.missions(slug,title,objective,status,created_by_user,lead_agent_id) values('p14-owned','Owned advisory','Owner governs the policy','active',owner,lead) returning id into m2;
 assert not public.orchestration_manager(m2,lead),'unrelated lead cannot change owner policy';
 update public.agents set owner_id=owner where id=lead;
 assert public.orchestration_manager(m2,lead),'owning lead can act under owner control';

 -- Ensemble formation respects existing manifests, provider verification and role vacancies.
 perform public.set_orchestration_policy(m2,lead,'{"quality":1,"speed":0,"cost":0}',0,true,'Recommend a provider-diverse ensemble');
 t:=public.insert_task_from_json(m2,'{"key":"team","title":"Form advisory ensemble","kind":"analysis","capabilities":["p14-domain"],"acceptance_criteria":"Independently reviewed synthesis","ensemble":{"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}}','open');
 select id into e from public.ensembles where task_id=t;
 result:=public.run_orchestration(m2,lead);
 assert (result->>'suggestions')::int=0,'unverified labels cannot fill diverse ensemble';
 assert (select count(*)=3 from public.orchestration_slots where run_id=(result->>'run_id')::uuid and selected_agent is null),'unmatched roles explicitly logged';
 assert not exists(select 1 from public.ensemble_members where ensemble_id=e),'matcher cannot bypass provider trust';

 third:=(public.register_manifest_agent('198.51.154.1','p14-third',p_manifest=>mf||'{"lab":"lab-three"}')->'agent'->>'id')::uuid;
 perform public.set_capability_manifest(newcomer,mf||'{"lab":"lab-one"}');
 perform public.set_capability_manifest(veteran,mf||'{"lab":"lab-two"}');
 perform public.record_lab_verification(am.agent_id,am.manifest->>'lab',am.manifest->'models','https://fixtures.invalid/p14-provider',repeat('a',64),'local-auditor',now()+interval '1 day')
 from public.agent_manifests am where am.agent_id=any(array[newcomer,veteran,third]);
 insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id) values('p14-verified-team','Verified team','Recommend fitting verified providers','active',lead,lead) returning id into m3;
 perform public.set_orchestration_policy(m3,lead,'{"quality":1,"speed":0,"cost":0}',0,true,'Use verified provider evidence for ensemble fit');
 t:=public.insert_task_from_json(m3,'{"key":"verified-team","title":"Form verified ensemble","kind":"analysis","capabilities":["p14-domain"],"acceptance_criteria":"Independently reviewed synthesis","ensemble":{"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}}','open');
 result:=public.run_orchestration(m3,lead);run:=(result->>'run_id')::uuid;
 assert (result->>'suggestions')::int=3,'full fitting ensemble recommended';
 assert (select count(distinct agent_id)=3 and count(distinct signals->>'verified_lab')=3 from public.orchestration_candidates where run_id=run and selected),'planned ensemble has distinct identities and verified providers';
 assert not exists(select 1 from public.ensemble_members em join public.ensembles en on en.id=em.ensemble_id where en.task_id=t),'forming a proposal never joins roles';
 for membership in select c.agent_id,c.ensemble_id,c.role from public.orchestration_candidates c where c.run_id=run and c.selected loop
   perform public.ensemble_join(membership.agent_id,membership.ensemble_id,membership.role);
 end loop;
 assert not public.orchestration_task_ready(t),'fully occupied teams do not mask ready tasks';
 select id into offer from public.agent_lab_verifications where agent_id=third and revoked_at is null limit 1;
 perform public.revoke_lab_verification(offer,'Fixture provider evidence revoked');
 perform public.ensemble_refresh((select en.id from public.ensembles en where en.task_id=t));
 assert public.orchestration_task_ready(t),'trust-layer reopening makes replacements routable';
 assert not exists(select 1 from jsonb_array_elements(public.orchestration_inbox(third)->'suggestions') o where o->>'run_id'=run::text),'provider revocation hides stale ensemble advice';
 assert not has_function_privilege('posterity_orchestrator','public.run_orchestration(uuid,uuid)','EXECUTE'),'network runner cannot impersonate mission agents';
 assert not has_function_privilege('posterity_orchestrator','public.claim_task(uuid,uuid,integer)','EXECUTE'),'network runner cannot claim work';
 assert not has_function_privilege('posterity_orchestrator','public.review_submission(uuid,uuid,uuid,text,integer,text,text,jsonb)','EXECUTE'),'network runner cannot verify work';
 assert not has_function_privilege('posterity_orchestrator','public.record_lab_verification(uuid,text,jsonb,text,text,text,timestamptz)','EXECUTE'),'network runner cannot attest provider identity';
 assert not has_function_privilege('posterity_orchestrator','public.award(uuid,text,numeric,uuid,uuid,uuid,text[],text)','EXECUTE'),'network runner cannot mint reputation';
 assert not has_table_privilege('posterity_orchestrator','public.reputation_events','INSERT'),'network runner cannot forge ledger';
 set local role posterity_orchestrator;
 result:=public.orchestration_policy(m3);
 assert result->>'operator'='network-advisory-v1','dedicated runner can read declared criteria';
 assert pg_temp.p14_fails(format('select public.run_network_orchestration(%L)',m3),'PT429'),'dedicated runner can execute matching while retaining rate limits';
 reset role;
 assert not has_function_privilege('authenticated','public.run_orchestration(uuid,uuid)','EXECUTE'),'browser cannot impersonate matcher';
 assert not has_table_privilege('anon','public.orchestration_candidates','INSERT'),'anonymous cannot forge decisions';
 assert not has_function_privilege('anon','public.set_orchestration_policy(uuid,uuid,jsonb,numeric,boolean,text)','EXECUTE'),'policy writes private';
 raise notice 'PHASE14: policy governance, audit integrity, exploration, capacity, feedback, verified observations, trust constraints and outage fallback passed';
end $$;
rollback;
