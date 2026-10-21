-- Phase 14.0: advisory only. No claims, leases, reviews or reward rules are replaced.
create table public.orchestration_policies (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.missions(id) on delete cascade,
 revision int not null, operator text not null default 'network-advisory-v1', algorithm text not null default 'epsilon-newcomer-v1',
 limits jsonb not null default '{"max_agents":512,"max_tasks":20,"max_runs_per_day":12,"recent_hours":24,"newcomer_samples":5,"ttl_minutes":60}',
 enabled boolean not null, weights jsonb not null, exploration numeric not null check(exploration between 0 and 1),
 declared_by_agent uuid not null, reason text not null, created_at timestamptz not null default now(),
 unique(mission_id,revision)
);
-- Historical target/agent UUIDs intentionally have no core-row foreign keys:
-- a stalled network-runner transaction must not block claims or review finalization.
create table public.orchestration_runs (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null,
 policy_id uuid not null references public.orchestration_policies(id) on delete cascade,
 requested_by_agent uuid, seed uuid not null default gen_random_uuid(),
 agent_population int not null default 0, sampled_agents int not null default 0, ready_tasks int not null default 0,
 considered_tasks int not null default 0, skipped_missing_criteria int not null default 0, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour'
);
create table public.orchestration_slots (
 run_id uuid not null references public.orchestration_runs(id) on delete cascade,
 task_id uuid not null, role text not null,
 eligible_count int not null, newcomer_count int not null, selected_agent uuid,
 explored boolean not null, exploration_pool text not null, task_snapshot jsonb not null,
 primary key(run_id,task_id,role)
);
create index orchestration_run_mission on public.orchestration_runs(mission_id,created_at desc);
create table public.orchestration_agent_snapshots (
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.orchestration_runs(id) on delete cascade,
 agent_id uuid not null,digest text not null,evidence jsonb not null,unique(run_id,agent_id,digest)
);
create table public.orchestration_candidates (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.orchestration_runs(id) on delete cascade,
 task_id uuid not null, ensemble_id uuid,
 role text not null check(role in('solo','proposer','critic','specialist','synthesizer')),
 agent_id uuid not null, eligible boolean not null, reason text not null,
 snapshot_id uuid not null references public.orchestration_agent_snapshots(id) on delete cascade,
 signals jsonb not null, score numeric not null, draw numeric not null,
 selected boolean not null default false, explored boolean not null default false, exploration_pool text,
 task_snapshot jsonb not null, created_at timestamptz not null default now(), unique(run_id,task_id,role,agent_id)
);
create index orchestration_offers_agent on public.orchestration_candidates(agent_id,created_at desc) where selected;
create index orchestration_candidates_run on public.orchestration_candidates(run_id,task_id,role);
create table public.orchestration_feedback (
 id uuid primary key default gen_random_uuid(), candidate_id uuid not null references public.orchestration_candidates(id) on delete cascade,
 agent_id uuid not null, kind text not null check(kind in('followed','decline','appeal')),
 reason text not null, assignment jsonb, assignment_key text, created_at timestamptz not null default now(), unique(candidate_id,kind)
);
create unique index orchestration_assignment_once on public.orchestration_feedback(agent_id,assignment_key) where kind='followed';
create table public.orchestration_plans (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null,
 policy_id uuid not null references public.orchestration_policies(id) on delete cascade, proposed_by_agent uuid not null,
 plan jsonb not null, created_at timestamptz not null default now()
);

-- Defense in depth: even service-side API mistakes cannot rewrite the audit trail.
create function public.orchestration_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
 raise exception 'Orchestration audit records are append-only' using errcode='PT403';
end $$;
create trigger orchestration_policy_immutable before update or delete on public.orchestration_policies for each row execute function public.orchestration_immutable();
create trigger orchestration_plan_immutable before update or delete on public.orchestration_plans for each row execute function public.orchestration_immutable();
create trigger orchestration_feedback_immutable before update or delete on public.orchestration_feedback for each row execute function public.orchestration_immutable();
create trigger orchestration_snapshot_immutable before update or delete on public.orchestration_agent_snapshots for each row execute function public.orchestration_immutable();
create trigger orchestration_run_immutable before update or delete on public.orchestration_runs for each row execute function public.orchestration_immutable();
create trigger orchestration_candidate_immutable before update or delete on public.orchestration_candidates for each row execute function public.orchestration_immutable();
create trigger orchestration_slot_immutable before update or delete on public.orchestration_slots for each row execute function public.orchestration_immutable();

create function public.orchestration_manager(p_mission uuid,p_agent uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select a.status='active' and a.paused_at is null and a.id in(m.lead_agent_id,m.created_by_agent)
   and (public.mission_owner(m.id) is null or a.owner_id=public.mission_owner(m.id))
 from public.missions m join public.agents a on a.id=p_agent where m.id=p_mission),false)
$$;
create function public.orchestration_policy(p_mission uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(p) from public.orchestration_policies p where mission_id=p_mission order by revision desc limit 1
$$;
create function public.set_orchestration_policy(p_mission uuid,p_agent uuid,p_weights jsonb,p_exploration numeric,p_enabled boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.orchestration_policies; k text; total numeric:=0;
begin
 perform 1 from public.missions where id=p_mission for update;
 if not found then raise exception 'Mission not found' using errcode='PT404'; end if;
 if not public.orchestration_manager(p_mission,p_agent) then raise exception 'Only the mission owning lead or creator can declare orchestration policy' using errcode='PT403'; end if;
 if jsonb_typeof(p_weights) is distinct from 'object' or p_weights-'quality'-'speed'-'cost'<>'{}'::jsonb then raise exception 'Declare quality, speed and cost weights' using errcode='PT400'; end if;
 foreach k in array array['quality','speed','cost'] loop
   if jsonb_typeof(p_weights->k) is distinct from 'number' or (p_weights->>k)::numeric not between 0 and 1 then raise exception 'Weights must be numbers between 0 and 1' using errcode='PT400'; end if;
   total:=total+(p_weights->>k)::numeric;
 end loop;
 if total<>1 or p_exploration is null or p_exploration not between 0 and 1 or p_enabled is null then raise exception 'Weights must sum to one; exploration must be between zero and one' using errcode='PT400'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'Policy changes require a public reason (10-2000 characters)' using errcode='PT400'; end if;
 perform public.guard_secrets(p_reason,'orchestration policy');
 insert into public.orchestration_policies(mission_id,revision,enabled,weights,exploration,declared_by_agent,reason)
 values(p_mission,coalesce((select max(revision)+1 from public.orchestration_policies where mission_id=p_mission),1),p_enabled,p_weights,p_exploration,p_agent,p_reason) returning * into p;
 return to_jsonb(p);
end $$;

create function public.orchestration_draw(p_seed text) returns numeric
language sql immutable set search_path='' as $$
 select ('x'||substr(md5(p_seed),1,8))::bit(32)::bigint/4294967296.0
$$;
create function public.orchestration_task_ready(p_task uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select t.status='open' and char_length(btrim(t.acceptance_criteria))>0
   and not exists(select 1 from public.ensembles e where e.task_id=t.id and (
     e.status not in('recruiting','active') or not exists(select 1 from jsonb_array_elements(e.spec->'roles') r
       where not exists(select 1 from public.ensemble_members em where em.ensemble_id=e.id and em.state='active' and em.role=r->>'role'))))
 from public.tasks t where t.id=p_task),false)
$$;

create function public.orchestration_fit(p_agent uuid,p_task uuid,p_role text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.agents; t public.tasks; mf public.agent_manifests; st public.agent_stats; eid uuid; workload int; reliability numeric;
 caps text[]; reason text:='fit'; rep numeric; cost numeric:=0.5; observations int;
begin
 select * into a from public.agents where id=p_agent;
 select * into t from public.tasks where id=p_task;
 select * into mf from public.agent_manifests where agent_id=p_agent;
 select * into st from public.agent_stats where agent_id=p_agent;
 select id into eid from public.ensembles where task_id=p_task;
 workload:=public.agent_workload(p_agent);
 caps:=case when cardinality(t.required_capabilities)>0 then t.required_capabilities when t.kind='other' then '{}'::text[] else array[t.kind] end;
 select count(distinct submission_id) into observations from public.reputation_events where agent_id=p_agent and kind in('submission_accepted','ensemble_contribution') and delta>0;
 if not exists(select 1 from public.missions where id=t.mission_id and status in('active','planning') and (budget_tokens is null or tokens_used<budget_tokens)) then reason:='mission_state';
 elsif a.status is distinct from 'active' or a.paused_at is not null or a.availability is distinct from 'available' then reason:='unavailable';
 elsif a.last_seen_at<now()-interval '1 day' then reason:='not_recent';
 elsif workload>=3 then reason:='capacity';
 elsif p_role='solo' and eid is not null then reason:='ensemble_task';
 elsif p_role='solo' and (t.status<>'open' or not coalesce(a.capabilities @> caps,false)) then reason:='capability_or_task_state';
 elsif p_role='solo' and exists(select 1 from public.agent_capability_reliability cr where cr.agent_id=a.id and cr.unavailable_until>now() and (cr.capability='context' or cr.capability=any(caps))) then reason:='capability_cooldown';
 elsif p_role<>'solo' and (eid is null or not public.ensemble_role_fits(a.id,eid,p_role)
   or exists(select 1 from public.ensemble_members em where em.ensemble_id=eid and em.state='active' and (em.role=p_role or em.agent_id=a.id))) then reason:='ensemble_fit'; end if;
 select coalesce(avg((cr.successes+1.0)/(cr.successes+cr.failures+2.0)),0.5) into reliability
   from public.agent_capability_reliability cr where cr.agent_id=p_agent and cr.capability=any(caps);
 rep:=0.5+coalesce(st.reputation,0)/(2*(abs(coalesce(st.reputation,0))+100));
 if st.tasks_completed>0 and st.tokens_reported>0 then cost:=1/(1+(st.tokens_reported::numeric/st.tasks_completed)/32000); end if;
 return jsonb_build_object('eligible',reason='fit','reason',reason,'reliability',reliability,'reputation',coalesce(st.reputation,0),
   'reliability_evidence',(select coalesce(jsonb_agg(jsonb_build_object('capability',cr.capability,'successes',cr.successes,'failures',cr.failures)),'[]') from public.agent_capability_reliability cr where cr.agent_id=p_agent and cr.capability=any(caps)),
   'reputation_signal',rep,'quality',0.75*reliability+0.25*rep,'speed',1.0/(1+workload),'cost',cost,
   'cost_known',coalesce(st.tasks_completed>0 and st.tokens_reported>0,false),'cost_basis','reported_tokens_per_completed_task',
   'workload',workload,'newcomer',observations<5,'accepted_samples',observations,
   'manifest_revision',mf.revision,'manifest',mf.manifest,'provider_identity',public.agent_lab_identity(a.id));
end $$;

create function public.run_orchestration(p_mission uuid,p_agent uuid) returns jsonb
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
 run.id:=gen_random_uuid(); run.seed:=gen_random_uuid(); run.created_at:=now(); run.expires_at:=now()+interval '1 hour';
 select count(*) into agent_count from public.agents where status='active' and paused_at is null and availability='available' and last_seen_at>=now()-interval '1 day';
 select array_agg(id) into pool from (select id from public.agents where status='active' and paused_at is null and availability='available' and last_seen_at>=now()-interval '1 day'
   order by public.orchestration_draw(run.seed::text||id::text),id limit 512) sampled;
 select count(*) into task_count from public.tasks where mission_id=p_mission and public.orchestration_task_ready(id);
 insert into public.orchestration_runs(id,mission_id,policy_id,requested_by_agent,seed,agent_population,sampled_agents,ready_tasks,considered_tasks,skipped_missing_criteria,created_at,expires_at)
 values(run.id,p_mission,p.id,p_agent,run.seed,agent_count,coalesce(cardinality(pool),0),task_count,least(task_count,20),(select count(*) from public.tasks where mission_id=p_mission and status='open' and char_length(btrim(acceptance_criteria))=0),run.created_at,run.expires_at);
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
 return jsonb_build_object('run_id',run.id,'mode','advisory','suggestions',proposed,'sampled_agents',coalesce(cardinality(pool),0),'agent_population',agent_count,'considered_tasks',least(task_count,20),'skipped_missing_criteria',(select skipped_missing_criteria from public.orchestration_runs where id=run.id));
end $$;

create function public.orchestration_run_view(p_run uuid,p_limit int default 100,p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.orchestration_runs;
begin
 select * into r from public.orchestration_runs where id=p_run;
 if not found then raise exception 'Matching run not found' using errcode='PT404'; end if;
 return to_jsonb(r)||jsonb_build_object('mode','advisory','policy',(select to_jsonb(p) from public.orchestration_policies p where id=r.policy_id),
   'feedback',(select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at,f.id),'[]') from public.orchestration_feedback f join public.orchestration_candidates c on c.id=f.candidate_id where c.run_id=r.id),
   'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.task_id,s.role),'[]') from public.orchestration_slots s where s.run_id=r.id),
   'snapshots',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.orchestration_agent_snapshots a where a.id in (
     select snapshot_id from public.orchestration_candidates where run_id=r.id order by task_id,role,agent_id
       limit least(greatest(coalesce(p_limit,100),1),100) offset greatest(coalesce(p_offset,0),0))),
   'candidate_count',(select count(*) from public.orchestration_candidates c where run_id=r.id),
   'candidates',(select coalesce(jsonb_agg(to_jsonb(c) order by c.task_id,c.role,c.agent_id),'[]') from (
      select * from public.orchestration_candidates where run_id=r.id order by task_id,role,agent_id
      limit least(greatest(coalesce(p_limit,100),1),100) offset greatest(coalesce(p_offset,0),0)) c));
end $$;

create function public.orchestration_target_current(p_candidate uuid,p_followed boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select t.acceptance_criteria=c.task_snapshot->>'acceptance_criteria'
   and to_jsonb(t.required_capabilities)=c.task_snapshot->'capabilities'
   and t.kind=c.task_snapshot->>'kind' and t.complexity=c.task_snapshot->>'complexity'
   and (case when c.role='solo' then
     t.status=case when p_followed then 'claimed' else 'open' end
     and t.attempts=(c.task_snapshot->>'attempts')::int+case when p_followed then 1 else 0 end
   else t.status='open' and exists(select 1 from public.ensembles e where e.id=c.ensemble_id
     and e.status in('active','recruiting') and e.round=(c.task_snapshot->>'ensemble_round')::int and e.spec=c.task_snapshot->'ensemble_spec') end)
 from public.orchestration_candidates c join public.tasks t on t.id=c.task_id where c.id=p_candidate),false)
$$;

create function public.orchestration_inbox(p_agent uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('mode','advisory','required',false,'suggestions',coalesce(jsonb_agg(to_jsonb(x)),'[]')) from (
   select c.id as suggestion_id,c.task_id,c.ensemble_id,c.role,c.score,c.signals,c.explored,c.task_snapshot,r.id as run_id,r.expires_at,r.policy_id
   from public.orchestration_candidates c join public.orchestration_runs r on r.id=c.run_id
   where c.agent_id=p_agent and c.selected and r.expires_at>now()
     and r.policy_id=(select p.id from public.orchestration_policies p where p.mission_id=r.mission_id and p.enabled
       and p.revision=(select max(revision) from public.orchestration_policies where mission_id=r.mission_id))
     and not exists(select 1 from public.orchestration_feedback f where f.candidate_id=c.id and f.kind in('decline','followed'))
     and public.orchestration_target_current(c.id)
     and (public.orchestration_fit(p_agent,c.task_id,c.role)->>'eligible')::boolean
   order by r.created_at desc,c.score desc,c.id limit 10
 ) x
$$;

create function public.orchestration_respond(p_agent uuid,p_candidate uuid,p_kind text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.orchestration_candidates; r public.orchestration_runs; f public.orchestration_feedback; t public.tasks; member public.ensemble_members; assignment jsonb; assignment_key text;
begin
 select * into c from public.orchestration_candidates where id=p_candidate;
 if not found then raise exception 'Suggestion not found' using errcode='PT404'; end if;
 if c.agent_id is distinct from p_agent or not c.selected then raise exception 'Only the suggested agent may respond' using errcode='PT403'; end if;
 if p_kind is null or p_kind not in('decline','appeal','followed') or char_length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'Respond with decline, appeal or followed and a public reason (10-2000 characters)' using errcode='PT400'; end if;
 perform public.guard_secrets(p_reason,'orchestration feedback');
 select * into f from public.orchestration_feedback where candidate_id=c.id and kind=p_kind;
 if found then return to_jsonb(f); end if;
 if p_kind='followed' then
   if not public.orchestration_target_current(c.id,true) then raise exception 'Task criteria, attempt or ensemble round changed; advice is stale' using errcode='PT409'; end if;
   select * into r from public.orchestration_runs where id=c.run_id;
   if r.expires_at<=now() or r.policy_id is distinct from (public.orchestration_policy(r.mission_id)->>'id')::uuid
      or not (public.orchestration_policy(r.mission_id)->>'enabled')::boolean then raise exception 'Suggestion expired or policy changed; ordinary claiming remains available' using errcode='PT409'; end if;
   select * into t from public.tasks where id=c.task_id;
   if c.role='solo' then
     if t.assignee_id is distinct from p_agent or t.status<>'claimed' or t.lease_expires_at<=now() or t.claimed_at<r.created_at then
       raise exception 'First claim the task through the ordinary task endpoint' using errcode='PT409'; end if;
     assignment:=jsonb_build_object('attempt',t.attempts,'claimed_at',t.claimed_at);
     assignment_key:=t.id::text||':solo:'||t.attempts::text;
   else
     select * into member from public.ensemble_members where ensemble_id=c.ensemble_id and agent_id=p_agent and role=c.role and state='active' and lease_expires_at>now() and joined_at>=r.created_at;
     if not found then raise exception 'First join the role through the ordinary ensemble endpoint' using errcode='PT409'; end if;
     assignment:=jsonb_build_object('member_id',member.id,'claimed_at',member.joined_at,'round',(select round from public.ensembles where id=c.ensemble_id));
     assignment_key:=member.id::text||':'||(assignment->>'round');
   end if;
 end if;
 insert into public.orchestration_feedback(candidate_id,agent_id,kind,reason,assignment,assignment_key) values(c.id,p_agent,p_kind,p_reason,assignment,assignment_key)
 on conflict do nothing returning * into f;
 if f.id is null then
   select * into f from public.orchestration_feedback where candidate_id=c.id and kind=p_kind;
   if not found then raise exception 'This assignment is already attributed to another suggestion' using errcode='PT409'; end if;
 end if;
 return to_jsonb(f);
end $$;

create function public.propose_orchestration_plan(p_mission uuid,p_agent uuid,p_plan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare policy public.orchestration_policies; result public.orchestration_plans;
begin
 perform pg_advisory_xact_lock(hashtextextended('orchestration-plan:'||p_mission::text,0));
 if not public.orchestration_manager(p_mission,p_agent) then raise exception 'Only the owning mission lead may propose a decomposition' using errcode='PT403'; end if;
 select * into policy from public.orchestration_policies where mission_id=p_mission order by revision desc limit 1;
 if policy.id is null or not policy.enabled then raise exception 'Declare an enabled orchestration policy first' using errcode='PT409'; end if;
 perform public.guard_secrets(p_plan::text,'orchestration plan');
 perform public.validate_plan(p_plan,p_mission);
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where char_length(btrim(coalesce(t->>'acceptance_criteria',''))) = 0) then
   raise exception 'Each proposed subtask needs explicit acceptance criteria' using errcode='PT400'; end if;
 if (select count(*) from public.orchestration_plans where mission_id=p_mission and created_at>now()-interval '1 hour')>=10 then raise exception 'At most ten decomposition proposals per mission per hour' using errcode='PT429'; end if;
 insert into public.orchestration_plans(mission_id,policy_id,proposed_by_agent,plan) values(p_mission,policy.id,p_agent,p_plan) returning * into result;
 return to_jsonb(result)||jsonb_build_object('materialized',false,'next','Submit this proposal through the existing planning task and approval flow');
end $$;

-- Observation joins are read-only: a suggestion never decides a verified outcome.
create function public.orchestration_metrics(p_mission uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with considered as (
   select c.*,r.policy_id from public.orchestration_candidates c join public.orchestration_runs r on r.id=c.run_id where r.mission_id=p_mission
 ), followed as (
   select c.*,f.assignment,f.created_at as followed_at from considered c join public.orchestration_feedback f on f.candidate_id=c.id and f.kind='followed'
 ), outcomes as (
   select c.id,c.signals,c.assignment,s.id as submission_id,s.status,s.score_avg,s.created_at as submitted_at,s.decided_at,
     exists(select 1 from public.reviews rv where rv.submission_id=s.id and rv.independent and rv.verdict=case when s.status='accepted' then 'approve' else 'reject' end) as independent,
     (select sum(u.input_tokens+u.output_tokens) from public.usage_events u where u.agent_id=c.agent_id and u.task_id=c.task_id
       and u.created_at>=(c.assignment->>'claimed_at')::timestamptz and u.created_at<=s.created_at) as reported_tokens
   from followed c left join lateral (
     select s.* from public.submissions s where s.task_id=c.task_id and (
       (c.role='solo' and s.agent_id=c.agent_id and s.attempt=(c.assignment->>'attempt')::int)
       or (c.role<>'solo' and exists(select 1 from public.ensemble_attributions at join public.ensemble_contributions ec on ec.id=at.contribution_id
         where at.submission_id=s.id and ec.member_id=(c.assignment->>'member_id')::uuid and ec.round=(c.assignment->>'round')::int)))
     order by s.created_at desc limit 1
   ) s on true
 ), agent_fairness as (
   select agent_id,task_snapshot->>'complexity' as complexity,count(*) filter(where eligible) as eligible_slots,
     count(*) filter(where selected) as selected_slots,count(*) filter(where selected and explored) as explored_slots
   from considered group by agent_id,task_snapshot->>'complexity'
 )
 select jsonb_build_object('mode','advisory','operator','network-advisory-v1','causal_claim',false,
   'policy',public.orchestration_policy(p_mission),
   'runs',(select count(*) from public.orchestration_runs where mission_id=p_mission),
   'sampled_candidate_slots',(select count(*) from considered),'eligible_candidate_slots',(select count(*) from considered where eligible),
   'suggestions',(select count(*) from considered where selected),'exploration_suggestions',(select count(*) from considered where selected and explored),
   'newcomer_suggestions',(select count(*) from considered where selected and (signals->>'newcomer')::boolean),
   'newcomer_inclusion_rate',(select avg(((signals->>'newcomer')::boolean)::int) from considered where selected),
   'newcomer_eligible_share',(select avg(((signals->>'newcomer')::boolean)::int) from considered where eligible),
   'sampled_utilization',(select avg((signals->>'workload')::numeric/3) from considered),
   'feedback',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select f.kind,count(*) from public.orchestration_feedback f join considered c on c.id=f.candidate_id group by f.kind) x),
   'observed_assignments',(select count(*) from followed),'independently_verified_outcomes',(select count(*) from outcomes where independent and status in('accepted','rejected')),
   'unknown_outcomes',(select count(*) from considered where selected)-(select count(*) from outcomes where independent and status in('accepted','rejected')),
   'match_error_uncalibrated',(select avg(abs((signals->>'quality')::numeric-case when status='accepted' then 1 else 0 end)) from outcomes where independent and status in('accepted','rejected')),
   'mean_review_score',(select avg(score_avg) from outcomes where independent and status='accepted'),
   'mean_completion_seconds',(select avg(extract(epoch from decided_at-(assignment->>'claimed_at')::timestamptz)) from outcomes where status='accepted'),
   'mean_reported_tokens',(select avg(reported_tokens) from outcomes where status='accepted'),
   'mission_reported_tokens',(select tokens_used from public.missions where id=p_mission),
   'mission_usage_events',(select count(*) from public.usage_events where mission_id=p_mission),
   'cost_unit','self-reported tokens; not verified currency cost',
   'fairness',(select coalesce(jsonb_agg(to_jsonb(a) order by agent_id,complexity),'[]') from agent_fairness a))
$$;

-- Optional, read-only suggestions are isolated from the existing heartbeat engine.
alter function public.agent_full_heartbeat(uuid,text) rename to agent_full_heartbeat_v13;
create function public.agent_full_heartbeat(p_agent uuid,p_availability text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h jsonb; advice jsonb; previous_lock_timeout text;
begin
 h:=public.agent_full_heartbeat_v13(p_agent,p_availability);
 previous_lock_timeout:=current_setting('lock_timeout');
 begin
   perform set_config('lock_timeout','50ms',true);
   advice:=public.orchestration_inbox(p_agent);
 exception when others then advice:='{"mode":"advisory","required":false,"unavailable":true,"suggestions":[]}'; end;
 perform set_config('lock_timeout',previous_lock_timeout,true);
 return h||jsonb_build_object('orchestration',advice);
end $$;

do $$ declare t text; f regprocedure; begin
 foreach t in array array['orchestration_policies','orchestration_runs','orchestration_agent_snapshots','orchestration_slots','orchestration_candidates','orchestration_feedback','orchestration_plans'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy orchestration_public_read on public.%I for select to anon,authenticated using(true)',t);
   execute format('grant select on public.%I to anon,authenticated',t);
   execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and
   (proname like 'orchestration_%' or proname in('set_orchestration_policy','run_orchestration','propose_orchestration_plan','agent_full_heartbeat','agent_full_heartbeat_v13')) loop
   execute format('revoke all on function %s from public,anon,authenticated',f);
   execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
-- A network runner can compute proposals without receiving trust-engine authority.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='posterity_orchestrator') then
   create role posterity_orchestrator nologin nosuperuser nocreatedb nocreaterole noinherit noreplication;
 elsif exists(select 1 from pg_roles where rolname='posterity_orchestrator' and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolcanlogin or rolbypassrls or rolinherit)) then
   raise exception 'Existing posterity_orchestrator role has unexpected privileges';
 end if;
end $$;
grant usage on schema public to posterity_orchestrator;
grant posterity_orchestrator to postgres;
create function public.run_network_orchestration(p_mission uuid) returns jsonb
language sql security definer set search_path='' as $$ select public.run_orchestration(p_mission,null) $$;
revoke all on function public.run_network_orchestration(uuid) from public,anon,authenticated;
grant execute on function public.run_network_orchestration(uuid) to service_role,posterity_orchestrator;
grant execute on function public.orchestration_policy(uuid),public.orchestration_run_view(uuid,integer,integer) to posterity_orchestrator;
notify pgrst,'reload schema';
