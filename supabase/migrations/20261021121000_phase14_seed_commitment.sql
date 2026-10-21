-- Prevent a restricted runner from silently grinding random seeds with rollbacks.
-- Existing decisions retain their original seed and are explicitly labelled legacy.
alter table public.orchestration_runs add column ordinal bigint;
alter table public.orchestration_runs add column seed_source text not null default 'legacy_random_v1';
alter table public.orchestration_runs alter column seed_source set default 'policy_and_committed_ordinal_v1';
alter table public.orchestration_runs alter column seed drop default;
create unique index orchestration_run_ordinal on public.orchestration_runs(policy_id,ordinal);

create or replace function public.run_orchestration(p_mission uuid,p_agent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.orchestration_policies; run public.orchestration_runs; slot record; actor uuid; pool uuid[]; candidates jsonb;
 chosen jsonb; chosen_agent uuid; chosen_lab text; selected_agents uuid[]:='{}'; ensemble_agents uuid[]:='{}'; ensemble_labs text[]:='{}'; last_ensemble uuid;
 snap jsonb; fit jsonb; item jsonb; evidence jsonb; snapshot uuid; evidence_hash text; score numeric; explore boolean; cohort text; proposed int:=0; task_count int; agent_count int;
begin
 -- Serialize matching runs only. Policy revisions and core work never take this lock.
 perform pg_advisory_xact_lock(hashtextextended('orchestration:'||p_mission::text,0));
 if p_agent is not null and not public.orchestration_manager(p_mission,p_agent) then raise exception 'Only the owning mission lead or service can run matching' using errcode='PT403'; end if;
 select * into p from public.orchestration_policies where mission_id=p_mission order by revision desc limit 1;
 if not found or not p.enabled then raise exception 'Declare an enabled orchestration policy first' using errcode='PT409'; end if;
 if not exists(select 1 from public.missions where id=p_mission and status in('active','planning') and (budget_tokens is null or tokens_used<budget_tokens)) then raise exception 'Mission is not accepting work' using errcode='PT409'; end if;
 if exists(select 1 from public.orchestration_runs where mission_id=p_mission and created_at>now()-interval '1 minute') then raise exception 'At most one matching run per mission per minute' using errcode='PT429'; end if;
 if (select count(*) from public.orchestration_runs where mission_id=p_mission and created_at>now()-interval '1 day')>=12 then raise exception 'At most twelve advisory runs per mission per day' using errcode='PT429'; end if;
 run.id:=gen_random_uuid();
 select count(*)+1 into run.ordinal from public.orchestration_runs where policy_id=p.id;
 run.seed_source:='policy_and_committed_ordinal_v1';
 run.seed:=md5(p.id::text||':'||run.ordinal::text)::uuid; run.created_at:=now(); run.expires_at:=now()+interval '1 hour';
 select count(*) into agent_count from public.agents where status='active' and paused_at is null and availability='available' and last_seen_at>=now()-interval '1 day';
 select array_agg(id) into pool from (select id from public.agents where status='active' and paused_at is null and availability='available' and last_seen_at>=now()-interval '1 day'
   order by public.orchestration_draw(run.seed::text||id::text),id limit 512) sampled;
 select count(*) into task_count from public.tasks where mission_id=p_mission and public.orchestration_task_ready(id);
 insert into public.orchestration_runs(id,mission_id,policy_id,requested_by_agent,seed,ordinal,seed_source,agent_population,sampled_agents,ready_tasks,considered_tasks,skipped_missing_criteria,created_at,expires_at)
 values(run.id,p_mission,p.id,p_agent,run.seed,run.ordinal,run.seed_source,agent_count,coalesce(cardinality(pool),0),task_count,least(task_count,20),(select count(*) from public.tasks where mission_id=p_mission and status='open' and char_length(btrim(acceptance_criteria))=0),run.created_at,run.expires_at);
 for slot in
   with ready as (select * from public.tasks where mission_id=p_mission and public.orchestration_task_ready(id)
     order by priority desc,created_at,id limit 20)
   select t.*,e.id as eid,coalesce(r->>'role','solo') as role,e.spec,e.round as ensemble_round from ready t left join public.ensembles e on e.task_id=t.id
   left join lateral jsonb_array_elements(e.spec->'roles') r on true
   where e.id is null or (e.status in('recruiting','active') and not exists(select 1 from public.ensemble_members em where em.ensemble_id=e.id and em.state='active' and em.role=r->>'role'))
   order by t.priority desc,t.created_at,t.id,coalesce(r->>'role','solo')
 loop
   if slot.eid is distinct from last_ensemble then ensemble_agents:='{}'; ensemble_labs:='{}'; last_ensemble:=slot.eid; end if;
   candidates:='[]';
   snap:=jsonb_build_object('attempts',slot.attempts,'ensemble_round',slot.ensemble_round,'ensemble_spec',slot.spec,'status',slot.status,'priority',slot.priority,'created_at',slot.created_at,'title',slot.title,'kind',slot.kind,'complexity',slot.complexity,'acceptance_criteria',slot.acceptance_criteria,'capabilities',slot.required_capabilities);
   foreach actor in array coalesce(pool,'{}') loop
     fit:=public.orchestration_fit(actor,slot.id,slot.role);
     evidence:=jsonb_build_object('manifest',fit->'manifest','manifest_revision',fit->'manifest_revision','provider_identity',fit->'provider_identity');
     evidence_hash:=encode(extensions.digest(evidence::text,'sha256'),'hex');
     insert into public.orchestration_agent_snapshots(run_id,agent_id,digest,evidence) values(run.id,actor,evidence_hash,evidence) on conflict do nothing;
     select id into snapshot from public.orchestration_agent_snapshots where run_id=run.id and agent_id=actor and digest=evidence_hash;
     fit:=(fit-'manifest'-'provider_identity')||jsonb_build_object('verified_lab',fit->'provider_identity'->>'verified_lab','provider_status',fit->'provider_identity'->>'status','snapshot_id',snapshot);
     if (fit->>'workload')::int+(select count(*) from unnest(selected_agents) a where a=actor)>=3 then fit:=fit||'{"eligible":false,"reason":"planned_capacity"}'; end if;
     if slot.eid is not null and (actor=any(ensemble_agents) or (coalesce((slot.spec->>'distinct_labs')::boolean,true) and fit->>'verified_lab'=any(ensemble_labs))) then fit:=fit||'{"eligible":false,"reason":"planned_ensemble_conflict"}'; end if;
     score:=(fit->>'quality')::numeric*(p.weights->>'quality')::numeric+(fit->>'speed')::numeric*(p.weights->>'speed')::numeric+(fit->>'cost')::numeric*(p.weights->>'cost')::numeric;
     candidates:=candidates||jsonb_build_array(jsonb_build_object('agent_id',actor,'signals',fit,'score',score,'draw',public.orchestration_draw(run.seed::text||slot.id::text||slot.role||actor::text)));
   end loop;
   explore:=public.orchestration_draw(run.seed::text||slot.id::text||slot.role||':explore')<p.exploration;
   cohort:=case when not explore then 'exploitation' when exists(select 1 from jsonb_array_elements(candidates) c where (c->'signals'->>'eligible')::boolean and (c->'signals'->>'newcomer')::boolean) then 'newcomer' else 'all' end;
   select c into chosen from jsonb_array_elements(candidates) c where (c->'signals'->>'eligible')::boolean
     and (cohort<>'newcomer' or (c->'signals'->>'newcomer')::boolean)
     order by case when explore then 0 else (c->>'score')::numeric end desc,(c->>'draw')::numeric,c->>'agent_id' limit 1;
   chosen_agent:=(chosen->>'agent_id')::uuid;
   insert into public.orchestration_slots(run_id,task_id,role,eligible_count,newcomer_count,selected_agent,explored,exploration_pool,task_snapshot)
   select run.id,slot.id,slot.role,count(*) filter(where (c->'signals'->>'eligible')::boolean),
     count(*) filter(where (c->'signals'->>'eligible')::boolean and (c->'signals'->>'newcomer')::boolean),chosen_agent,explore,cohort,snap
   from jsonb_array_elements(candidates) c;
   for item in select * from jsonb_array_elements(candidates) loop
     insert into public.orchestration_candidates(run_id,task_id,ensemble_id,role,agent_id,eligible,reason,snapshot_id,signals,score,draw,selected,explored,exploration_pool,task_snapshot)
     values(run.id,slot.id,slot.eid,slot.role,(item->>'agent_id')::uuid,(item->'signals'->>'eligible')::boolean,item->'signals'->>'reason',(item->'signals'->>'snapshot_id')::uuid,item->'signals',(item->>'score')::numeric,(item->>'draw')::numeric,
       coalesce(item->>'agent_id'=chosen_agent::text,false),explore,cohort,snap);
   end loop;
   if chosen_agent is not null then
     proposed:=proposed+1; selected_agents:=selected_agents||chosen_agent;
     if slot.eid is not null then ensemble_agents:=ensemble_agents||chosen_agent; chosen_lab:=chosen->'signals'->>'verified_lab'; if chosen_lab is not null then ensemble_labs:=ensemble_labs||chosen_lab; end if; end if;
   end if;
 end loop;
 return jsonb_build_object('run_id',run.id,'seed',run.seed,'ordinal',run.ordinal,'seed_source',run.seed_source,'mode','advisory','suggestions',proposed,'sampled_agents',coalesce(cardinality(pool),0),'agent_population',agent_count,'considered_tasks',least(task_count,20),'skipped_missing_criteria',(select skipped_missing_criteria from public.orchestration_runs where id=run.id));
end $$;

notify pgrst,'reload schema';
