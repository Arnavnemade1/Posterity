-- Empty old recruiting rooms must not starve an agent's own lease maintenance.
begin;
do $$
declare a uuid; observer uuid; mission uuid; task uuid; ensemble uuid; own_ensemble uuid; mf jsonb; i integer; inbox jsonb;
begin
 mf:='{"schema_version":1,"lab":"maintenance-audit","models":["fixture"],"tools":[],"languages":[],"capabilities":["analysis"],"context_window":1000,"strengths":[],"roles":["proposer"]}';
 a:=(public.register_manifest_agent('198.19.22.1','audit-maintenance-worker',p_manifest=>mf)->'agent'->>'id')::uuid;
 observer:=(public.register_manifest_agent('198.19.23.1','audit-maintenance-observer',p_manifest=>mf)->'agent'->>'id')::uuid;
 insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,requires_final_approval)
 values('audit-maintenance-fleet','Maintenance audit','Check bounded maintenance fairness','active',a,a,false) returning id into mission;
 for i in 1..34 loop
  task:=public.insert_task_from_json(mission,jsonb_build_object('key','slot-'||i,'title','Maintenance slot '||i,'kind','analysis','capabilities',jsonb_build_array('analysis'),
   'ensemble','{"distinct_labs":false,"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}'::jsonb),'open');
  select id into ensemble from public.ensembles where task_id=task;
  update public.ensembles set created_at=now()+i*interval '1 second' where id=ensemble;
  if i=34 then own_ensemble:=ensemble; end if;
 end loop;
 perform public.ensemble_join(a,own_ensemble,'proposer');
 update public.agents set availability='away' where id=a;
 inbox:=public.agent_ensemble_inbox(a);
 assert jsonb_array_length(inbox->'assignments')=0,'older recruiting rooms cannot hide a caller role that no longer fits';
 assert exists(select 1 from public.ensemble_members where ensemble_id=own_ensemble and agent_id=a and state='failed'),'the caller own invalid role reopens in this heartbeat';
 update public.agents set availability='available' where id=a;
 perform public.ensemble_join(a,own_ensemble,'proposer');
 update public.ensemble_members set lease_expires_at=now()-interval '1 second' where ensemble_id=own_ensemble and state='active';
 update public.agents set availability='away' where id=observer;
 perform public.agent_ensemble_inbox(observer);
 assert exists(select 1 from public.ensemble_members where ensemble_id=own_ensemble and agent_id=a and state='expired'),'expired roles take precedence over empty recruiting rooms during bounded recovery';
 raise notice 'PASS ensemble maintenance starvation regressions';
end $$;
rollback;
