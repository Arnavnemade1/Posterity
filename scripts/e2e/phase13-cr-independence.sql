-- Local rollback-only regressions for the Phase 13 security audit recovery contract.
begin;
create function pg_temp.recovery_fails(q text, expected text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate=expected; end $$;
do $$
declare mf jsonb; a uuid; b uuid; c uuid; replacement uuid; reviewer uuid; m uuid; t uuid; e uuid; i int;
  ws uuid; cr uuid; digest text; draft uuid; synthesis uuid; critique uuid; recovery uuid; sub uuid; result jsonb; checks jsonb; budget numeric;
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

 ws:=(public.create_workspace(c,'Ensemble review audit')->>'id')::uuid;
 update public.workspaces set mission_id=m where id=ws;
 perform public.ws_set_member(ws,c,'audit13-proposer','writer');
 perform public.ws_create_branch(ws,c,'proposal','main');
 digest:=encode(extensions.digest(convert_to('content','UTF8'),'sha256'),'hex');
 perform public.ws_add_blob(ws,c,digest,encode(extensions.digest(convert_to('blob 7','UTF8')||'\x00'::bytea||convert_to('content','UTF8'),'sha1'),'hex'),7,false,'content',null);
 perform public.ws_commit(ws,c,'proposal',null,'Proposed ensemble code',jsonb_build_array(jsonb_build_object('path','a.txt','blob',digest)));

 -- Record an approval before linking the task to model legacy approvals.
 cr:=(public.open_change_request(ws,c,'proposal','main','Ensemble approval boundary')->>'id')::uuid;
 perform public.review_change_request(cr,a,'approve','Approval before ensemble linkage');
 assert (public.cr_approval_state(cr)->>'approvals')::int=1,'solo CR behavior retained';
 update public.change_requests set task_id=t where id=cr;
 assert (public.cr_approval_state(cr)->>'approvals')::int=0,'legacy participant approval excluded';
 assert cardinality(public.cr_merge_blockers(cr,null))>0,'system merge cannot use participant approval';
 assert pg_temp.recovery_fails(format('select public.review_change_request(%L,%L,%L,%L)',cr,a,'approve','Participant approves own ensemble'),'PT403'),'participant cannot approve';
 assert pg_temp.recovery_fails(format('select public.review_change_request(%L,%L,%L,%L)',cr,a,'request_changes','Participant blocks own ensemble'),'PT403'),'participant cannot veto through CR review';
 perform public.review_change_request(cr,a,'comment','Participant feedback remains available');
 update public.change_requests set owner_groups='[{"owners":["audit13-proposer"],"paths":1}]' where id=cr;
 assert not (public.cr_owner_state(cr)->>'satisfied')::boolean,'participant cannot satisfy code-owner review';
 perform public.ensemble_leave(a,e,'Former member must remain excluded');
 assert not public.ensemble_cr_reviewer_eligible(cr,a),'former participant excluded';
 update public.agent_origins set network=(select network from public.agent_origins where agent_id=b) where agent_id=replacement;
 assert not public.ensemble_cr_reviewer_eligible(cr,replacement),'related outsider excluded';
 assert pg_temp.recovery_fails(format('select public.review_change_request(%L,%L,%L,%L)',cr,replacement,'approve','Related outsider approves ensemble'),'PT403'),'related outsider cannot approve';
 -- Source-branch linkage protects CRs even if callers omit the optional task ID.
 update public.change_requests set task_id=null where id=cr;
 update public.branches set task_id=t where workspace_id=ws and name='proposal';
 assert not public.ensemble_cr_reviewer_eligible(cr,a),'source branch prevents omitted-task bypass';
 assert (public.cr_approval_state(cr)->>'approvals')::int=0,'branch linkage excludes legacy approvals';
 perform public.review_change_request(cr,reviewer,'approve','Independent reviewer checked the ensemble change');
 assert (public.cr_approval_state(cr)->>'approvals')::int=1,'independent reviewer counts';
 update public.change_requests set owner_groups='[]' where id=cr;
 assert cardinality(public.cr_merge_blockers(cr,null))=0,'independent exact-head review allows system merge';
 perform public.set_change_request_state(cr,c,'close');
 cr:=(public.open_change_request(ws,c,'proposal','main','Branch linked ensemble review')->>'id')::uuid;
 assert (select e=any(ensemble_ids) from public.change_requests where id=cr),'source branch provenance captured without task argument';
 perform public.set_change_request_state(cr,c,'close');
 update public.branches set task_id=null where workspace_id=ws and name='proposal';
 perform public.set_change_request_state(cr,c,'reopen');
 assert not public.ensemble_cr_reviewer_eligible(cr,a),'branch recreation and CR reopen cannot erase provenance';
 assert not has_function_privilege('authenticated','public.ensemble_cr_review_guard()','EXECUTE'),'guard private';
 raise notice 'PHASE13_CR: participant, former member, related agent, legacy approvals, code owners and branch linkage protected';
end $$;
rollback;
