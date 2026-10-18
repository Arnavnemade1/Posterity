-- Release guards: declared capabilities are not provider identity evidence.
create table public.agent_lab_verifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  lab text not null check (lab ~ '^[a-z0-9][a-z0-9.-]{0,59}$'),
  models jsonb not null check (jsonb_typeof(models)='array' and jsonb_array_length(models)>0),
  method text not null default 'operator_verified' check (method='operator_verified'),
  evidence_url text not null check (evidence_url ~ '^https://[^[:space:]]+$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  verified_by text not null check (char_length(btrim(verified_by)) between 3 and 120),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at>verified_at and expires_at<=verified_at+interval '7 days'),
  revoked_at timestamptz,
  revocation_reason text
);
create index agent_lab_verification_lookup on public.agent_lab_verifications(agent_id,expires_at) where revoked_at is null;
alter table public.agent_lab_verifications enable row level security;
create policy lab_verifications_public on public.agent_lab_verifications for select using (true);
grant select on public.agent_lab_verifications to anon,authenticated;
grant all on public.agent_lab_verifications to service_role;
-- Only the service operator may record evidence. No REST/MCP agent tool can call this.
create function public.record_lab_verification(p_agent uuid,p_lab text,p_models jsonb,p_evidence_url text,p_evidence_sha256 text,p_verified_by text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.agent_lab_verifications; mf jsonb;
begin
  select manifest into mf from public.agent_manifests where agent_id=p_agent;
  if mf is null or mf->>'lab' is distinct from p_lab or not ((mf->'models') @> p_models and p_models @> (mf->'models')) then
    raise exception 'Evidence must match the declared provider and exact model set' using errcode='PT400';
  end if;
  insert into public.agent_lab_verifications(agent_id,lab,models,evidence_url,evidence_sha256,verified_by,expires_at)
  values(p_agent,p_lab,p_models,p_evidence_url,p_evidence_sha256,p_verified_by,p_expires_at) returning * into v;
  return to_jsonb(v);
end $$;
create function public.revoke_lab_verification(p_verification uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 2000 then raise exception 'Revocation needs a reason' using errcode='PT400'; end if;
  update public.agent_lab_verifications set revoked_at=now(),revocation_reason=p_reason where id=p_verification and revoked_at is null;
end $$;
create function public.agent_lab_identity(p_agent uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('status',case when v.id is null then 'self_declared' else 'operator_verified' end,
    'claimed_lab',mf.manifest->>'lab','verified_lab',v.lab,'verification',to_jsonb(v))
  from public.agent_manifests mf left join lateral (
    select * from public.agent_lab_verifications av where av.agent_id=mf.agent_id and av.revoked_at is null
      and av.expires_at>now() and av.lab=mf.manifest->>'lab'
      and av.models @> (mf.manifest->'models') and (mf.manifest->'models') @> av.models
    order by av.verified_at desc,av.id limit 1
  ) v on true where mf.agent_id=p_agent
$$;
create function public.verified_agent_lab(p_agent uuid) returns text
language sql stable security definer set search_path='' as $$
  select public.agent_lab_identity(p_agent)->>'verified_lab'
$$;
-- Evidence snapshots survive expiry/revocation and are labelled historical, never current proof.
alter table public.ensemble_members add column lab_evidence jsonb;
alter table public.submissions add column lab_evidence jsonb;
create function public.snapshot_ensemble_lab() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.lab_evidence:=public.agent_lab_identity(new.agent_id);
  if exists(select 1 from public.ensembles where id=new.ensemble_id and coalesce((spec->>'distinct_labs')::boolean,true))
    and coalesce(new.lab_evidence->>'status','self_declared')<>'operator_verified' then
    raise exception 'Distinct-lab roles require current operator-verified provider evidence' using errcode='PT409';
  end if;
  return new;
end $$;
create trigger ensemble_lab_snapshot before insert on public.ensemble_members for each row execute function public.snapshot_ensemble_lab();
create function public.snapshot_submission_labs() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.ensembles;
begin
  select * into e from public.ensembles where task_id=new.task_id;
  if not found then return new; end if;
  -- Fail closed even if trust expires between join and submission.
  if coalesce((e.spec->>'distinct_labs')::boolean,true) and (
    exists(select 1 from public.ensemble_members em where em.ensemble_id=e.id and em.state='active' and public.verified_agent_lab(em.agent_id) is null)
    or (select count(distinct public.verified_agent_lab(em.agent_id)) from public.ensemble_members em where em.ensemble_id=e.id and em.state='active')<>jsonb_array_length(e.spec->'roles')) then
    raise exception 'Renew provider verification before submitting a distinct-lab ensemble' using errcode='PT409';
  end if;
  select jsonb_agg(jsonb_build_object('agent_id',em.agent_id,'role',em.role,'identity',public.agent_lab_identity(em.agent_id)))
    into new.lab_evidence from public.ensemble_members em where em.ensemble_id=e.id and em.state='active';
  return new;
end $$;
create trigger ensemble_submission_labs before insert on public.submissions for each row execute function public.snapshot_submission_labs();
create function public.lab_verification_readiness() returns jsonb
language sql stable security definer set search_path='' as $$
  with verified as (select distinct public.verified_agent_lab(m.agent_id) as lab from public.agent_manifests m join public.agents a on a.id=m.agent_id where a.status='active' and a.paused_at is null),
  labs as (select coalesce(jsonb_agg(lab order by lab),'[]') as names,count(*) as n from verified where lab is not null)
  select jsonb_build_object('trust_level','operator_verified','verified_labs',names,'verified_lab_count',n,
    'four_lab_roster_ready',n>=4,'execution_attested',false,
    'claim_limit','Operator-checked provider roster only; no cryptographic proof of individual model execution') from labs
$$;

create or replace function public.ensemble_role_fits(p_agent uuid,p_ensemble uuid,p_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select
   a.status='active' and a.paused_at is null and (a.availability='available' or exists(select 1 from public.ensemble_members current_member where current_member.ensemble_id=e.id and current_member.agent_id=a.id and current_member.state='active' and a.availability='busy'))
   and e.status in ('recruiting','active') and t.status in ('open','claimed') and ms.status='active'
   and (ms.budget_tokens is null or ms.tokens_used<ms.budget_tokens)
   and mf.manifest->'roles' ? p_role
   and mf.manifest->'capabilities' @> to_jsonb(t.required_capabilities)
   and (cardinality(t.required_capabilities)>0 or t.kind='other' or mf.manifest->'capabilities' ? t.kind)
   and mf.manifest->'capabilities' @> coalesce(r->'capabilities','[]'::jsonb)
   and mf.manifest->'tools' @> coalesce(r->'tools','[]'::jsonb)
   and mf.manifest->'languages' @> coalesce(r->'languages','[]'::jsonb)
   and (mf.manifest->>'context_window')::int >= coalesce((r->>'min_context_tokens')::int,1)
   and not exists(select 1 from public.agent_capability_reliability cr where cr.agent_id=a.id and cr.unavailable_until>now()
     and (cr.capability='context' or cr.capability=any(t.required_capabilities) or coalesce(r->'capabilities','[]') ? cr.capability or coalesce(r->'tools','[]') ? cr.capability or (cardinality(t.required_capabilities)=0 and cr.capability=t.kind)))
   and (not coalesce((e.spec->>'distinct_labs')::boolean,true) or (
     public.verified_agent_lab(a.id) is not null and not exists(
       select 1 from public.ensemble_members em where em.ensemble_id=e.id and em.state='active'
         and em.agent_id<>a.id and public.verified_agent_lab(em.agent_id)=public.verified_agent_lab(a.id))))
 from public.agents a join public.agent_manifests mf on mf.agent_id=a.id
 cross join public.ensembles e join public.tasks t on t.id=e.task_id join public.missions ms on ms.id=t.mission_id
 cross join lateral jsonb_array_elements(e.spec->'roles') r
 where a.id=p_agent and e.id=p_ensemble and r->>'role'=p_role),false)
$$;


create or replace function public.ensemble_view(p_ensemble uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.ensembles;
begin
  select * into e from public.ensembles where id=p_ensemble;
  if not found then raise exception 'Ensemble not found' using errcode='PT404'; end if;
  return to_jsonb(e)||jsonb_build_object(
    'members',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('handle',public.agent_handle(m.agent_id)) order by m.joined_at),'[]') from public.ensemble_members m where m.ensemble_id=e.id),
    'contributions',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('agent_id',m.agent_id,'role',m.role,
      'scores',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.ensemble_scores s where s.contribution_id=c.id)) order by c.created_at),'[]')
      from public.ensemble_contributions c join public.ensemble_members m on m.id=c.member_id where c.ensemble_id=e.id and c.round=e.round),
    'submissions',(select coalesce(jsonb_agg(jsonb_build_object('submission_id',s.id,'status',s.status,'score_avg',s.score_avg,'lab_evidence',s.lab_evidence,
      'attributions',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('contribution',to_jsonb(ec),'agent_id',em.agent_id,'role',em.role,'lab',em.lab)),'[]') from public.ensemble_attributions a join public.ensemble_contributions ec on ec.id=a.contribution_id join public.ensemble_members em on em.id=ec.member_id where a.submission_id=s.id),
      'settlement',(select to_jsonb(st) from public.ensemble_settlements st where st.submission_id=s.id)) order by s.created_at desc),'[]') from public.submissions s where s.task_id=e.task_id));
end $$;


-- Approval requirements apply to every CR, including unprotected targets and system queues.
-- Accepted task reviews of the exact pinned head are evidence, not a blanket verified bypass.
create or replace function public.cr_approval_state(p_cr uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with cr as (select * from public.change_requests where id=p_cr),
  b as (select br.* from public.branches br,cr where br.workspace_id=cr.workspace_id and br.name=cr.target_branch),
  latest as (
    select distinct on (r.reviewer_agent_id) r.reviewer_agent_id,r.verdict,r.commit_id,r.independent
      from public.cr_reviews r,cr where r.change_request_id=cr.id and r.verdict<>'comment' and r.reviewer_agent_id is not null
      order by r.reviewer_agent_id,r.created_at desc,r.id desc
  ), task_reviews as (
    select r.reviewer_agent_id from public.reviews r join public.submissions s on s.id=r.submission_id,cr
      where s.id=cr.submission_id and s.status='accepted' and s.commit_id=cr.head_commit
        and r.verdict='approve' and r.independent and r.reviewer_agent_id is not null
        and not exists(select 1 from latest l where l.reviewer_agent_id=r.reviewer_agent_id and l.verdict='request_changes')
  ), approvers as (
    select reviewer_agent_id from latest,cr where verdict='approve' and independent and commit_id=cr.head_commit
    union select reviewer_agent_id from task_reviews
  )
  select jsonb_build_object(
    'approvals',(select count(*) from approvers),
    'submission_approvals',(select count(*) from task_reviews),
    'required',coalesce((select required_approvals from b),(select w.required_approvals from public.workspaces w,cr where w.id=cr.workspace_id)),
    'requirements_enforced',true,'policy_scope','all_change_requests',
    'direct_writes_allowed',not coalesce((select protected from b),false),
    'changes_requested_by',coalesce((select jsonb_agg(public.agent_handle(reviewer_agent_id)) from latest where verdict='request_changes'),'[]'),
    'verified',coalesce((select cr.verified_at is not null and exists(select 1 from public.submissions s where s.id=cr.submission_id and s.status='accepted' and s.commit_id=cr.head_commit) from cr),false),
    'unresolved_comments',(select count(*) from public.cr_comments c,cr where c.change_request_id=cr.id and c.path is not null and c.reply_to is null and c.resolved_at is null),
    'owners',public.cr_owner_state(p_cr)||jsonb_build_object('required',coalesce((select require_owner_review from b),false)),
    'checks',public.cr_checks_state(p_cr,(select head_commit from cr),coalesce((select required_checks from b),'{}')),
    'files',coalesce(((select merge_state from cr)->>'files')::int,0),'max_files',(select max_change_files from b))
$$;

create or replace function public.cr_merge_blockers(p_cr uuid, p_agent uuid, p_skip_checks boolean default false, p_method text default 'merge')
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  b public.branches;
  v_state jsonb;
  v_reasons text[] := '{}';
  v_missing text;
begin
  select * into cr from public.change_requests where id = p_cr;
  select * into b from public.branches where workspace_id = cr.workspace_id and name = cr.target_branch;
  if not found then
    return array[format('The target branch "%s" no longer exists', cr.target_branch)];
  end if;
  v_state := public.cr_approval_state(p_cr);
  if not (coalesce(p_method, 'merge') = any (b.merge_methods)) then
    v_reasons := v_reasons || format('"%s" takes %s merges; pass method: %s', b.name, array_to_string(b.merge_methods, ' or '), b.merge_methods[1]);
  end if;
  if jsonb_array_length(v_state -> 'changes_requested_by') > 0 then
    v_reasons := v_reasons || format('Changes were requested by %s; they must approve before this merges',
      (select string_agg('@' || h, ', ') from jsonb_array_elements_text(v_state -> 'changes_requested_by') as h));
  end if;
  if (v_state ->> 'approvals')::int < (v_state ->> 'required')::int then
    v_reasons := v_reasons || format('"%s" needs %s independent approval(s) of the latest commit, and has %s',
      b.name, v_state ->> 'required', v_state ->> 'approvals');
  end if;
  if b.require_owner_review and not (v_state -> 'owners' ->> 'satisfied')::boolean then
    select string_agg(format('%s (%s file%s)', (select string_agg('@' || o, ' or ') from jsonb_array_elements_text(g -> 'owners') o),
                             g ->> 'paths', case when (g ->> 'paths')::int = 1 then '' else 's' end), '; ')
      into v_missing
      from jsonb_array_elements(v_state -> 'owners' -> 'groups') g where g ->> 'approved_by' is null;
    v_reasons := v_reasons || format('"%s" needs a code owner''s approval of the latest commit from %s', b.name, v_missing);
  end if;
  if not coalesce(p_skip_checks, false) and cardinality(b.required_checks) > 0
     and jsonb_array_length(v_state -> 'checks' -> 'passed') < cardinality(b.required_checks) then
    select string_agg(x, ', ') into v_missing from (
      select n || ' (failed)' as x from jsonb_array_elements_text(v_state -> 'checks' -> 'failed') n
      union all
      select n || ' (not reported yet)' from jsonb_array_elements_text(v_state -> 'checks' -> 'pending') n) y;
    v_reasons := v_reasons || format('"%s" needs these checks to pass on the latest commit: %s', b.name, v_missing);
  end if;
  if b.max_change_files is not null and (v_state ->> 'files')::int > b.max_change_files then
    v_reasons := v_reasons || format('This change touches %s files; "%s" takes at most %s per change request. Split it into a stack: smaller change requests, each aimed at the previous one''s branch',
      v_state ->> 'files', b.name, b.max_change_files);
  end if;
  return v_reasons;
end
$$;

-- New functions are private RPCs; public reads go through the model-neutral API.
do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in (
    'record_lab_verification','revoke_lab_verification','agent_lab_identity','verified_agent_lab',
    'snapshot_ensemble_lab','snapshot_submission_labs','lab_verification_readiness') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
