-- Rollback-only regressions for private coordination across public role changes.
begin;
create function pg_temp.swarm_fails(q text, expected text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate=expected; end $$;
do $$
declare a uuid; helper uuid; hive uuid; mission uuid; task uuid; ensemble uuid; mf jsonb;
 hash text; changed text; lease jsonb; frame jsonb;
begin
 mf:='{"schema_version":1,"lab":"swarm-audit","models":["fixture"],"tools":[],"languages":[],"capabilities":["analysis"],"context_window":1000,"strengths":[],"roles":["proposer"]}';
 a:=(public.register_manifest_agent('198.19.20.1','audit-swarm-worker',p_manifest=>mf)->'agent'->>'id')::uuid;
 helper:=(public.register_manifest_agent('198.19.21.1','audit-swarm-helper',p_manifest=>mf)->'agent'->>'id')::uuid;
 insert into public.trust_hives(name,operator_key,substrate_hash,declaration)
 values('Swarm audit hive',repeat('9',64),repeat('8',64),'Local rollback-only fixtures share exactly one declared operator and substrate.') returning id into hive;
 insert into public.trust_hive_members(agent_id,hive_id) values(a,hive),(helper,hive);
 insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,requires_final_approval)
 values('audit-swarm-lifecycle','Private coordination audit','Check the original objective','active',a,a,false) returning id into mission;
 task:=public.insert_task_from_json(mission,'{"key":"lifecycle","title":"Exercise role lifecycle","kind":"analysis","capabilities":["analysis"],"ensemble":{"distinct_labs":false,"roles":[{"role":"proposer"},{"role":"critic"},{"role":"synthesizer"}]}}','open');
 select id into ensemble from public.ensembles where task_id=task;
 perform public.ensemble_join(a,ensemble,'proposer');
 hash:=public.hive_task_context(task)->>'task_hash';
 lease:=public.hive_swarm_write(helper,task,'claim','{"work_key":"parser","ttl_seconds":30}',gen_random_uuid(),hash);
 perform public.ensemble_join(a,ensemble,'proposer');
 assert public.hive_task_context(task)->>'task_hash'=hash,'ordinary public lease renewal preserves private work context';
 perform public.ensemble_leave(a,ensemble,'Replace the public role while a helper is still working');
 perform public.ensemble_join(a,ensemble,'proposer');
 changed:=public.hive_task_context(task)->>'task_hash';
 assert changed<>hash,'rejoining a public role cannot resurrect private work tokens';
 assert pg_temp.swarm_fails(format('select public.hive_swarm_write(%L,%L,%L,%L::jsonb,%L,%L)',helper,task,'renew',jsonb_build_object('work_key','parser','token',lease->>'token'),gen_random_uuid(),hash),'PT409'),'old private lease is fenced after public role replacement';
 lease:=public.hive_swarm_write(helper,task,'claim','{"work_key":"parser","ttl_seconds":30}',gen_random_uuid(),changed);
 assert lease->>'token' is not null,'fresh context can reclaim the old work key immediately';
 hash:=changed;
 update public.missions set objective='Check a changed objective' where id=mission;
 update public.missions set objective='Check the original objective' where id=mission;
 changed:=public.hive_task_context(task)->>'task_hash';
 assert changed<>hash,'restoring an objective cannot resurrect an old context';
 frame:=public.hive_swarm_sync(helper,task);
 assert (frame->>'writable')::boolean is true,'active hive helpers receive writable coordination frames';
 assert not has_function_privilege('service_role','public.hive_swarm_write_v15_2(uuid,uuid,text,jsonb,uuid,text,bigint)','EXECUTE'),'the API role cannot bypass the public-context locks';
 assert not has_function_privilege('anon','public.hive_swarm_write(uuid,uuid,text,jsonb,uuid,text,bigint)','EXECUTE'),'anonymous callers cannot publish private coordination';
 assert not has_function_privilege('authenticated','public.hive_swarm_write(uuid,uuid,text,jsonb,uuid,text,bigint)','EXECUTE'),'browser callers cannot impersonate a private hive publisher';
 update public.ensembles set status='in_review' where id=ensemble;
 frame:=public.hive_swarm_sync(helper,task);
 assert (frame->>'writable')::boolean is false,'review rooms remain readable and advertise that writes are closed';
 assert pg_temp.swarm_fails(format('select public.hive_swarm_write(%L,%L,%L,%L::jsonb,%L,%L)',helper,task,'pulse','{"acknowledged":0}',gen_random_uuid(),changed),'PT403'),'review rooms refuse new presence writes';
 update public.ensembles set status='recruiting' where id=ensemble;
 update public.agents set paused_at=now() where id=helper;
 assert (public.hive_swarm_sync(helper,task)->>'writable')::boolean is false,'paused helpers can read without attempting presence writes';
 raise notice 'PASS private coordination lifecycle and read-only regressions';
end $$;
rollback;
