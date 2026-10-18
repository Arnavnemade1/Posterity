-- Local transactional regression for provider trust and advertised merge policy.
begin;
create function pg_temp.release_fails(q text, expected text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate=expected; end $$;
do $$
declare a uuid; b uuid; c uuid; m uuid; t uuid; e uuid; ws uuid; cr uuid; proof uuid; accepted uuid; solo uuid; mf jsonb; j jsonb; h text; digest text;
begin
  mf:='{"schema_version":1,"lab":"openai","models":["fixture-model"],"tools":[],"languages":[],"capabilities":["analysis"],"context_window":1000,"strengths":[],"roles":["proposer","critic","synthesizer"]}';
  a:=(public.register_manifest_agent('198.51.100.1','release-a',p_manifest=>mf)->'agent'->>'id')::uuid;
  b:=(public.register_manifest_agent('198.51.101.1','release-b',p_manifest=>mf)->'agent'->>'id')::uuid;
  c:=(public.register_manifest_agent('198.51.102.1','release-c',p_manifest=>mf||'{"lab":"anthropic"}')->'agent'->>'id')::uuid;
  insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id)
    values('release-trust','Trust regression','Verify provenance','active',c,c) returning id into m;
  t:=public.insert_task_from_json(m,'{"key":"trust","title":"Trust role matching","kind":"analysis","ensemble":{"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}}','open');
  select id into e from public.ensembles where task_id=t;
  assert not public.ensemble_role_fits(a,e,'proposer'),'self-declaration cannot fill distinct-lab role';
  assert pg_temp.release_fails(format('select public.ensemble_join(%L,%L,%L)',a,e,'proposer'),'PT409'),'manual join fails closed';
  assert public.agent_lab_identity(a)->>'status'='self_declared','identity honestly labelled';
  assert not has_table_privilege('authenticated','public.agent_lab_verifications','INSERT'),'no self attestation writes';
  assert not has_function_privilege('anon','public.record_lab_verification(uuid,text,jsonb,text,text,text,timestamptz)','EXECUTE'),'no anonymous attestation';
  assert pg_temp.release_fails(format('select public.record_lab_verification(%L,%L,%L,%L,%L,%L,now()+interval %L)',a,'anthropic','["fixture-model"]','https://fixtures.invalid/evidence',repeat('a',64),'test-operator','1 day'),'PT400'),'proof must match provider';
  perform public.record_lab_verification(am.agent_id,am.manifest->>'lab',am.manifest->'models','https://fixtures.invalid/evidence',repeat('a',64),'local-test-operator',now()+interval '1 day')
    from public.agent_manifests am where am.agent_id=any(array[a,b,c]);
  assert public.ensemble_role_fits(a,e,'proposer'),'verified provider eligible';
  perform public.ensemble_join(a,e,'proposer');
  assert not public.ensemble_role_fits(b,e,'critic'),'two products from same provider are one lab';
  assert public.ensemble_role_fits(c,e,'critic'),'different verified provider fits';
  perform public.set_capability_manifest(c,mf||'{"lab":"anthropic","models":["changed-model"]}');
  assert not public.ensemble_role_fits(c,e,'critic'),'model change invalidates proof';
  perform public.set_capability_manifest(c,mf||'{"lab":"anthropic"}');
  select id into proof from public.agent_lab_verifications where agent_id=c;
  perform public.revoke_lab_verification(proof,'Test compromised provenance');
  assert not public.ensemble_role_fits(c,e,'critic'),'revocation invalidates proof';
  j:=public.record_lab_verification(c,'anthropic','["fixture-model"]','https://fixtures.invalid/renewed',repeat('b',64),'local-test-operator',now()+interval '1 day');
  update public.agent_lab_verifications set verified_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=(j->>'id')::uuid;
  assert not public.ensemble_role_fits(c,e,'critic'),'expired evidence fails closed';
  assert (select lab_evidence->>'status'='operator_verified' from public.ensemble_members where agent_id=a and ensemble_id=e),'membership keeps historical proof';
  update public.ensembles set spec=jsonb_set(spec,'{distinct_labs}','false') where id=e;
  assert public.ensemble_role_fits(c,e,'critic'),'ordinary ensembles remain manifest-only';
  assert not (public.lab_verification_readiness()->>'four_lab_roster_ready')::boolean,'labels cannot inflate demo readiness';

  ws:=(public.create_workspace(a,'Release approvals')->>'id')::uuid;
  perform public.ws_set_member(ws,a,'release-b','writer');
  perform public.ws_create_branch(ws,a,'proposal','main');
  digest:=encode(extensions.digest(convert_to('content','UTF8'),'sha256'),'hex');
  perform public.ws_add_blob(ws,a,digest,encode(extensions.digest(convert_to('blob 7','UTF8')||'\x00'::bytea||convert_to('content','UTF8'),'sha1'),'hex'),7,false,'content',null);
  perform public.ws_commit(ws,a,'proposal',null,'Proposed change',jsonb_build_array(jsonb_build_object('path','a.txt','blob',digest)));
  cr:=(public.open_change_request(ws,a,'proposal','main','Enforce advertised quorum')->>'id')::uuid;
  assert (public.cr_approval_state(cr)->>'required')::int=1,'workspace default advertised';
  assert not (select protected from public.branches where workspace_id=ws and name='main'),'target is unprotected';
  assert pg_temp.release_fails(format('select public.merge_change_request(%L,%L)',cr,a),'PT409'),'unprotected CR enforces quorum';
  update public.change_requests set verified_at=now() where id=cr;
  assert cardinality(public.cr_merge_blockers(cr,null))>0,'system and verified marker cannot bypass';
  perform public.review_change_request(cr,b,'approve','Independent exact commit review');
  assert (public.cr_approval_state(cr)->>'approvals')::int=1,'independent review counted';
  assert cardinality(public.cr_merge_blockers(cr,null))=0,'real review permits system merge';
  solo:=public.insert_task_from_json(m,'{"key":"accepted-proof","title":"Accepted review proof","kind":"analysis"}','open');
  insert into public.submissions(task_id,mission_id,agent_id,summary,status,commit_id)
    values(solo,m,a,'Accepted exact head evidence','accepted',(select head_commit from public.change_requests where id=cr)) returning id into accepted;
  insert into public.reviews(submission_id,task_id,mission_id,reviewer_agent_id,verdict,rationale,independent)
    values(accepted,solo,m,b,'approve','Exact head independently reviewed',true);
  update public.change_requests set submission_id=accepted where id=cr;
  assert (public.cr_approval_state(cr)->>'submission_approvals')::int=1,'accepted exact-head task review is evidence';
  assert (public.cr_approval_state(cr)->>'approvals')::int=1,'same reviewer counted once across review channels';
  perform public.ws_set_branch_rules(ws,a,'main','{"required_approvals":2}');
  assert cardinality(public.cr_merge_blockers(cr,null))>0,'accepted status cannot waive a higher quorum';
  perform public.ws_set_branch_rules(ws,a,'main','{"required_approvals":1}');
  perform public.ws_commit(ws,a,'proposal',null,'New head',jsonb_build_array(jsonb_build_object('path','b.txt','blob',digest)));
  assert (public.cr_approval_state(cr)->>'approvals')::int=0,'stale head approvals cannot count';
  perform public.review_change_request(cr,b,'request_changes','Latest head needs correction');
  assert cardinality(public.cr_merge_blockers(cr,a))>0,'request changes blocks';
  perform public.review_change_request(cr,b,'approve','Latest head independently verified');
  assert public.merge_change_request(cr,a)->>'status'='merged','current independent review satisfies advertised policy';
  raise notice 'PHASE13_RELEASE: provider and approval regressions passed';
end $$;
rollback;
