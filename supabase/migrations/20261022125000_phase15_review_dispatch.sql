-- A new submission starts its own review window even after an earlier review.
-- Preserve immutable prepared draws and the original function privileges.
create or replace function public.prepare_trust_draw(p_target uuid,p_role text,p_purpose text default 'assignment') returns jsonb
language plpgsql security definer set search_path='' as $$
declare ep uuid; cfg jsonb; pool jsonb; ctx jsonb; v_generation integer; due bigint; r public.trust_draws; cas public.trust_cases; t public.tasks; en public.ensembles;
begin
  perform pg_advisory_xact_lock(hashtextextended('posterity-draw:'||p_target::text||p_role||p_purpose,0));
  if p_purpose='assignment' then
    select * into t from public.tasks where id=p_target;
    select epoch_id into ep from public.trust_task_policies where task_id=t.id;
    select * into en from public.ensembles where task_id=t.id;
    if ep is null or (case when p_role like 'reviewer:%' then t.status<>'in_review' or p_role !~ '^reviewer:[1-5]$' or substring(p_role from 10)::integer>(select review_quorum from public.missions where id=t.mission_id) else t.status<>'open' end) or (en.id is null and p_role<>'worker' and p_role not like 'reviewer:%') or (en.id is not null and p_role not like 'reviewer:%' and not exists(
        select 1 from jsonb_array_elements(en.spec->'roles') rr where rr->>'role'=p_role)) then raise exception 'Declare an open permissionless task/role first' using errcode='PT409'; end if;
    v_generation:=case when en.id is not null then en.round when p_role like 'reviewer:%' then t.attempts else t.attempts+1 end;
    ctx:=jsonb_build_object('anchor',case when p_role like 'reviewer:%' then greatest((select max(created_at) from public.reviews where task_id=t.id),(select max(created_at) from public.submissions where task_id=t.id)) else coalesce((select max(created_at) from public.ensemble_recoveries where ensemble_id=en.id),(select max(created_at) from public.task_events where task_id=t.id and kind in('reopened','expired')),(select declared_at from public.trust_task_policies where task_id=t.id)) end,'task_id',t.id,'mission_id',t.mission_id,'attempt',t.attempts,'round',en.round,'criteria',t.acceptance_criteria,'capabilities',t.required_capabilities,'spec',en.spec);
    select jsonb_agg(jsonb_build_object('hive_id',h,'agents',ids) order by h) into pool from (
      select public.agent_hive(a.id) h,jsonb_agg(a.id order by a.id) ids from public.agents a
        where public.trust_work_eligible(a.id,t.id,p_role) and (case when en.id is null or p_role like 'reviewer:%' then a.capabilities @> t.required_capabilities
          else public.ensemble_role_fits_pre15(a.id,en.id,p_role) end)
        group by public.agent_hive(a.id)) candidates;
  elsif p_purpose in('jury','appeal_jury') then
    select * into cas from public.trust_cases where id=p_target;
    select epoch_id into ep from public.trust_standing where agent_id=cas.agent_id;
    if ep is null or (p_purpose='jury' and cas.status<>'open') or (p_purpose='appeal_jury' and (cas.appealed_at is null or cas.resolved_at is not null)) then raise exception 'Open protocol case or pending appeal required' using errcode='PT409'; end if;
    v_generation:=1; ctx:=jsonb_build_object('case_id',cas.id,'evidence_hash',cas.evidence_hash,'subject',cas.agent_id,'appeal',cas.appeal,'anchor',case when p_purpose='appeal_jury' then cas.appealed_at else cas.created_at end);
    select jsonb_agg(jsonb_build_object('hive_id',h,'agents',ids) order by h) into pool from (
      select public.agent_hive(s.agent_id) h,jsonb_agg(s.agent_id order by s.agent_id) ids from public.trust_standing s join public.trust_accounts a on a.agent_id=s.agent_id
        join public.agents ag on ag.id=s.agent_id
      where s.epoch_id=ep and s.tier=2 and not s.expelled and not a.frozen and ag.status='active' and ag.paused_at is null and not public.agents_related(s.agent_id,cas.agent_id)
        and not exists(select 1 from public.trust_vouches v where v.vouchee=cas.agent_id and v.released_at is null and public.agents_related(v.voucher,s.agent_id))
        and not exists(select 1 from public.trust_cases c where c.agent_id=s.agent_id and (c.status='open' or c.appealed_at is not null and c.resolved_at is null))
        and (p_purpose<>'appeal_jury' or not exists(select 1 from public.trust_jury_votes v where v.case_id=cas.id and public.agents_related(v.juror,s.agent_id)))
      group by public.agent_hive(s.agent_id)) candidates;
  else raise exception 'Unsupported draw purpose' using errcode='PT400'; end if;
  select * into r from public.trust_draws where purpose=p_purpose and target_id=p_target and role=p_role and trust_draws.generation=v_generation;
  if found then return to_jsonb(r); end if;
  if jsonb_array_length(coalesce(pool,'[]')) not between 1 and 512 then raise exception 'Eligible hive pool must contain 1-512 hives; do not truncate it silently' using errcode='PT409'; end if;
  cfg:=public.trust_cfg(ep);
  due:=floor((extract(epoch from (ctx->>'anchor')::timestamptz)-(cfg->>'beacon_genesis')::bigint)/(cfg->>'beacon_period')::bigint)::bigint+ceil((cfg->>'beacon_delay_seconds')::numeric/(cfg->>'beacon_period')::numeric)::bigint+1;
  if to_timestamp((cfg->>'beacon_genesis')::bigint+(due-1)*(cfg->>'beacon_period')::bigint)<=statement_timestamp() then raise exception 'Dispatch commitment window elapsed; record an evidenced new task/round instead of silently rerolling' using errcode='PT409'; end if;
  insert into public.trust_draws(epoch_id,purpose,target_id,role,generation,pool,pool_hash,context,beacon_round,beacon_due)
    values(ep,p_purpose,p_target,p_role,v_generation,pool,encode(extensions.digest(pool::text||ctx::text,'sha256'),'hex'),ctx,due,
      to_timestamp((cfg->>'beacon_genesis')::bigint+(due-1)*(cfg->>'beacon_period')::bigint)) returning * into r;
  return to_jsonb(r);
end $$;

notify pgrst,'reload schema';
