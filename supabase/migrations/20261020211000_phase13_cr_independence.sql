-- Phase 13 audit: CR approval is another final verification surface. Independence
-- must cover the entire ensemble, including departed members, on this surface too.
alter table public.change_requests add column ensemble_ids uuid[] not null default '{}';
-- Preserve observed ensemble provenance across closing/reopening and source-branch
-- recreation. A caller cannot erase review exclusions by dropping optional task links.
create function public.snapshot_cr_ensembles() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous uuid[]:='{}';
begin
  if tg_op='UPDATE' then previous:=old.ensemble_ids; end if;
  select coalesce(array_agg(distinct id),'{}') into new.ensemble_ids from (
    select unnest(previous) as id
    union select e.id from public.ensembles e where e.task_id=new.task_id
      or e.task_id=(select task_id from public.submissions where id=new.submission_id)
      or e.task_id=(select task_id from public.branches where workspace_id=new.workspace_id and name=new.source_branch)
  ) linked;
  return new;
end $$;
create trigger change_requests_ensemble_snapshot before insert or update on public.change_requests
for each row execute function public.snapshot_cr_ensembles();
update public.change_requests cr set ensemble_ids='{}' where
  exists(select 1 from public.ensembles e where e.task_id=cr.task_id
    or e.task_id=(select task_id from public.submissions where id=cr.submission_id)
    or e.task_id=(select task_id from public.branches where workspace_id=cr.workspace_id and name=cr.source_branch));

create function public.ensemble_cr_reviewer_eligible(p_cr uuid,p_agent uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists (
    select 1 from public.change_requests cr
    join public.ensembles e on e.id=any(cr.ensemble_ids) or e.task_id=cr.task_id
      or e.task_id=(select s.task_id from public.submissions s where s.id=cr.submission_id)
      or e.task_id=(select b.task_id from public.branches b where b.workspace_id=cr.workspace_id and b.name=cr.source_branch)
    join public.ensemble_members em on em.ensemble_id=e.id
    where cr.id=p_cr and (em.agent_id=p_agent or public.agents_related(em.agent_id,p_agent))
  )
$$;
create function public.ensemble_cr_review_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.verdict<>'comment' and new.reviewer_agent_id is not null
    and not public.ensemble_cr_reviewer_eligible(new.change_request_id,new.reviewer_agent_id) then
    raise exception 'Ensemble change request reviewers must be independent of every current and former participant' using errcode='PT403';
  end if;
  return new;
end $$;
create trigger cr_reviews_ensemble_guard before insert on public.cr_reviews
for each row execute function public.ensemble_cr_review_guard();
create or replace function public.cr_approval_state(p_cr uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with cr as (select * from public.change_requests where id=p_cr),
  b as (select br.* from public.branches br,cr where br.workspace_id=cr.workspace_id and br.name=cr.target_branch),
  latest as (
    select distinct on (r.reviewer_agent_id) r.reviewer_agent_id,r.verdict,r.commit_id,r.independent
      from public.cr_reviews r,cr where r.change_request_id=cr.id and r.verdict<>'comment' and r.reviewer_agent_id is not null
        and public.ensemble_cr_reviewer_eligible(cr.id,r.reviewer_agent_id)
      order by r.reviewer_agent_id,r.created_at desc,r.id desc
  ), task_reviews as (
    select r.reviewer_agent_id from public.reviews r join public.submissions s on s.id=r.submission_id,cr
      where s.id=cr.submission_id and s.status='accepted' and s.commit_id=cr.head_commit
        and r.verdict='approve' and r.independent and r.reviewer_agent_id is not null
        and public.ensemble_cr_reviewer_eligible(cr.id,r.reviewer_agent_id)
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

create or replace function public.cr_owner_state(p_cr uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  g jsonb;
  v_agents uuid[];
  v_eligible uuid[];
  v_approved uuid;
  v_groups jsonb := '[]'::jsonb;
  v_ok boolean := true;
begin
  select * into cr from public.change_requests where id = p_cr;
  for g in select value from jsonb_array_elements(coalesce(cr.owner_groups, '[]'::jsonb)) loop
    v_agents := public.ws_owner_agents(g -> 'owners');
    select coalesce(array_agg(a), '{}') into v_eligible from unnest(v_agents) a
     where a is distinct from cr.author_agent_id and not public.agents_related(a, cr.author_agent_id)
       and public.ensemble_cr_reviewer_eligible(cr.id,a);
    select l.reviewer_agent_id into v_approved
      from (select distinct on (r.reviewer_agent_id) r.reviewer_agent_id, r.verdict, r.commit_id, r.independent
              from public.cr_reviews r
             where r.change_request_id = cr.id and r.verdict <> 'comment' and r.reviewer_agent_id is not null
               and public.ensemble_cr_reviewer_eligible(cr.id,r.reviewer_agent_id)
             order by r.reviewer_agent_id, r.created_at desc) l
     where l.verdict = 'approve' and l.independent and l.commit_id = cr.head_commit
       and (case when cardinality(v_eligible) > 0 then l.reviewer_agent_id = any (v_eligible)
                 else public.ws_rank(public.ws_role(cr.workspace_id, l.reviewer_agent_id)) >= 3 end)
     limit 1;
    v_ok := v_ok and v_approved is not null;
    v_groups := v_groups || jsonb_build_array(g || jsonb_build_object(
      'approved_by', public.ws_handle(v_approved), 'no_other_owner', cardinality(v_eligible) = 0));
  end loop;
  return jsonb_build_object('groups', v_groups, 'satisfied', v_ok);
end
$$;

revoke all on function public.ensemble_cr_reviewer_eligible(uuid,uuid),public.ensemble_cr_review_guard(),public.snapshot_cr_ensembles() from public,anon,authenticated;
grant execute on function public.ensemble_cr_reviewer_eligible(uuid,uuid),public.ensemble_cr_review_guard(),public.snapshot_cr_ensembles() to service_role;
notify pgrst,'reload schema';
