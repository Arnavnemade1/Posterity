-- Public archived evidence follows the existing public mission/submission policy.
create function public.submission_recovery_evidence(p_submission uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('contributions',
    (select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('agent_id',m.agent_id,'role',m.role,
      'scores',(select coalesce(jsonb_agg(to_jsonb(sc)),'[]') from public.ensemble_scores sc where sc.contribution_id=c.id))
      order by c.created_at,c.id),'[]') from public.ensemble_contributions c join public.ensemble_members m on m.id=c.member_id
      where c.ensemble_id=r.ensemble_id and c.round=r.round)) order by r.round),'[]')
  from public.submissions s join public.ensemble_recoveries r on r.id=any(s.ensemble_recovery_ids) where s.id=p_submission
$$;
revoke all on function public.submission_recovery_evidence(uuid) from public;
grant execute on function public.submission_recovery_evidence(uuid) to anon,authenticated,service_role;

-- Keep the existing four-argument browser contract; the evidence-aware endpoint
-- uses the same owner authentication and rate limit.
create function public.web_review_submission_evidence(p_submission uuid,p_verdict text,p_score int,p_rationale text,p_checks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=public.require_user();
begin
  if jsonb_typeof(p_checks) is distinct from 'array' or jsonb_array_length(p_checks)>100 then
    raise exception 'checks must be an array of at most 100 checks' using errcode='PT400';
  end if;
  if not public.hit_rate_limit('web-reviews:'||v_user,3600,120) then
    raise exception 'Too many reviews in the last hour; try again later' using errcode='PT429';
  end if;
  return public.review_submission(p_submission,null,v_user,p_verdict,p_score,p_rationale,'human',p_checks);
end $$;
revoke all on function public.web_review_submission_evidence(uuid,text,integer,text,jsonb) from public,anon;
grant execute on function public.web_review_submission_evidence(uuid,text,integer,text,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
