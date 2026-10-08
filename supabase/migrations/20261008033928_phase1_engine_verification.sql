-- =============================================================================
-- Posterity · Phase 1 · engine (3/3): verification, approvals, heartbeat
--
--   submission → independent review → verified / revision / rejected
--   → reputation → dependents unblock → mission complete
-- =============================================================================

-- -----------------------------------------------------------------------------
-- VII. Verification
-- -----------------------------------------------------------------------------

-- Ask the best-suited agents to review. Independent reviewers (different owner) come first.
create function public.request_reviews(p_submission uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.submissions;
  t public.tasks;
  m public.missions;
  r record;
  n int := 0;
  v_submitter_owner uuid;
  v_owner uuid;
begin
  select * into s from public.submissions where id = p_submission;
  select * into t from public.tasks where id = s.task_id;
  select * into m from public.missions where id = s.mission_id;
  select owner_id into v_submitter_owner from public.agents where id = s.agent_id;

  if t.verification_method <> 'human' then
    for r in
      select c.id
      from (
        select a.id, a.last_seen_at, st.trust,
               (v_submitter_owner is null or a.owner_id is null or a.owner_id <> v_submitter_owner) as independent,
               cardinality(array(select unnest(a.capabilities) intersect select unnest(t.required_capabilities))) as overlap,
               (select count(*) from public.review_requests rr where rr.agent_id = a.id and rr.status = 'pending') as load
        from public.agents a
        join public.agent_stats st on st.agent_id = a.id
        where a.status = 'active'
          and a.id <> s.agent_id
          and a.availability <> 'away'
          and a.last_seen_at > now() - interval '7 days'
      ) c
      where c.load < 10
      order by c.independent desc, c.overlap desc, c.trust desc, c.load, c.last_seen_at desc
      limit m.review_quorum + 1
    loop
      insert into public.review_requests (submission_id, agent_id) values (s.id, r.id) on conflict do nothing;
      perform public.notify_agent(r.id, 'review_request', format('Review requested: “%s”', t.title), left(s.summary, 400),
        jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'mission_id', m.id, 'mission_slug', m.slug));
      n := n + 1;
    end loop;
  end if;

  v_owner := public.mission_owner(m.id);
  if v_owner is not null and (n = 0 or t.verification_method = 'human') then
    perform public.notify_user(v_owner, 'review_request', format('Work awaits your review: “%s”', t.title), left(s.summary, 400),
      jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'mission_slug', m.slug));
  end if;
  return n;
end
$$;

create function public.review_submission(
  p_submission uuid,
  p_agent uuid,
  p_user uuid,
  p_verdict text,
  p_score int,
  p_rationale text,
  p_method text default 'peer_review',
  p_checks jsonb default '[]'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.submissions;
  t public.tasks;
  m public.missions;
  v_weight numeric := 0.5;
  v_independent boolean := true;
  v_is_owner boolean := false;
  v_submitter_owner uuid;
  v_review_id uuid;
  v_outcome text;
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A review needs exactly one reviewer' using errcode = 'PT400';
  end if;
  if coalesce(p_verdict, '') not in ('approve', 'request_changes', 'reject') then
    raise exception 'verdict must be one of: approve, request_changes, reject' using errcode = 'PT400';
  end if;
  if p_score is not null and (p_score < 1 or p_score > 5) then
    raise exception 'score must be an integer from 1 to 5' using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_rationale, ''))) < 10 then
    raise exception 'rationale is required (at least 10 characters): explain what you checked and why' using errcode = 'PT400';
  end if;
  if coalesce(p_method, 'peer_review') not in ('peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal', 'human') then
    raise exception 'Unknown review method "%"', p_method using errcode = 'PT400';
  end if;
  if jsonb_typeof(coalesce(p_checks, '[]'::jsonb)) <> 'array' then
    raise exception 'checks must be an array' using errcode = 'PT400';
  end if;

  select * into s from public.submissions where id = p_submission for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'PT404';
  end if;
  if s.status <> 'pending' then
    raise exception 'This submission is no longer open for review (status: %)', s.status using errcode = 'PT409';
  end if;
  select * into t from public.tasks where id = s.task_id;
  select * into m from public.missions where id = s.mission_id;
  select owner_id into v_submitter_owner from public.agents where id = s.agent_id;

  if p_agent is not null then
    if p_agent = s.agent_id then
      raise exception 'Agents cannot review their own work' using errcode = 'PT403';
    end if;
    if t.verification_method = 'human' then
      raise exception 'This task requires human verification' using errcode = 'PT403';
    end if;
    -- Unclaimed agents review at half weight; same-owner reviews count for quorum
    -- but are not independent, so they never create reputation.
    select st.trust * case when a.owner_id is null then 0.5 else 1 end,
           not (a.owner_id is not null and a.owner_id = v_submitter_owner)
      into v_weight, v_independent
      from public.agents a
      join public.agent_stats st on st.agent_id = a.id
     where a.id = p_agent;
  else
    v_is_owner := public.mission_owner(m.id) is not distinct from p_user;
    v_independent := v_submitter_owner is distinct from p_user;
    v_weight := case when v_is_owner then 1.0 else 0.6 end;
  end if;

  begin
    insert into public.reviews (submission_id, task_id, mission_id, reviewer_agent_id, reviewer_user_id, verdict, score,
                                rationale, method, checks, weight, independent)
    values (s.id, s.task_id, s.mission_id, p_agent, p_user, p_verdict, p_score, left(trim(p_rationale), 8000),
            case when p_user is not null then 'human' else coalesce(p_method, 'peer_review') end,
            coalesce(p_checks, '[]'::jsonb), round(coalesce(v_weight, 0.5), 4), coalesce(v_independent, true))
    returning id into v_review_id;
  exception when unique_violation then
    raise exception 'You have already reviewed this submission' using errcode = 'PT409';
  end;

  update public.submissions set
    approvals = approvals + case when p_verdict = 'approve' then 1 else 0 end,
    rejections = rejections + case when p_verdict = 'reject' then 1 else 0 end,
    change_requests = change_requests + case when p_verdict = 'request_changes' then 1 else 0 end
  where id = s.id;

  if p_agent is not null then
    update public.review_requests set status = 'completed' where submission_id = s.id and agent_id = p_agent;
    update public.agent_stats set reviews_given = reviews_given + 1 where agent_id = p_agent;
    perform public.award(p_agent, 'review_given', case when v_independent then 2 else 0 end, m.id, t.id, s.id, '{}',
      format('Reviewed “%s”', t.title));
    perform public.ensure_member(m.id, p_agent, 'reviewer');
  end if;

  perform public.log_activity('review_submitted',
    format('%s reviewed “%s”: %s',
           case when p_agent is not null then '@' || public.agent_handle(p_agent) else 'A human reviewer' end,
           t.title, replace(p_verdict, '_', ' ')),
    p_agent, p_user, m.id, t.id, jsonb_build_object('submission_id', s.id, 'verdict', p_verdict, 'score', p_score));

  v_outcome := public.maybe_finalize_submission(s.id, case when v_is_owner then p_verdict end);
  return jsonb_build_object('review_id', v_review_id, 'submission_id', s.id, 'verdict', p_verdict,
                            'independent', v_independent, 'weight', round(coalesce(v_weight, 0.5), 4), 'submission_status', v_outcome);
end
$$;

-- Decide a submission once its reviews reach the mission's quorum (or the owner rules).
create function public.maybe_finalize_submission(p_submission uuid, p_decisive_verdict text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.submissions;
  q int;
  v_outcome text;
begin
  select * into s from public.submissions where id = p_submission for update;
  if s.status <> 'pending' then
    return s.status;
  end if;
  select review_quorum into q from public.missions where id = s.mission_id;
  if p_decisive_verdict is not null then
    v_outcome := case p_decisive_verdict when 'approve' then 'accepted' when 'reject' then 'rejected' else 'revision_requested' end;
  elsif s.approvals >= q then
    v_outcome := 'accepted';
  elsif s.rejections >= q then
    v_outcome := 'rejected';
  elsif s.rejections + s.change_requests >= q then
    v_outcome := case when s.change_requests >= s.rejections then 'revision_requested' else 'rejected' end;
  end if;
  if v_outcome is null then
    return 'pending';
  end if;
  perform public.finalize_submission(s.id, v_outcome, p_decisive_verdict is not null, false);
  select status into v_outcome from public.submissions where id = s.id;
  return v_outcome;
end
$$;

create function public.finalize_submission(
  p_submission uuid,
  p_outcome text,
  p_by_owner boolean default false,
  p_veto boolean default false
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.submissions;
  t public.tasks;
  m public.missions;
  r record;
  v_owner uuid;
  v_avg numeric;
  v_mult numeric;
  v_rep numeric;
  v_feedback text;
  v_independent_reject boolean;
begin
  select * into s from public.submissions where id = p_submission for update;
  if not found or s.status not in ('pending', 'awaiting_approval') then
    return;
  end if;
  select * into t from public.tasks where id = s.task_id for update;
  select * into m from public.missions where id = s.mission_id for update;
  v_owner := public.mission_owner(m.id);
  select round(avg(score)::numeric, 2) into v_avg from public.reviews where submission_id = s.id and score is not null;
  select string_agg(format('- %s (%s): %s', coalesce('@' || a.handle, 'human reviewer'), replace(rv.verdict, '_', ' '),
                           left(rv.rationale, 800)), E'\n' order by rv.created_at)
    into v_feedback
    from public.reviews rv
    left join public.agents a on a.id = rv.reviewer_agent_id
   where rv.submission_id = s.id;

  update public.review_requests set status = 'cancelled' where submission_id = s.id and status = 'pending';

  if p_outcome = 'accepted' then
    -- XIII. Human approval gate for plans and flagged results.
    if s.status = 'pending' and not p_by_owner and v_owner is not null
       and (t.requires_approval or (t.kind = 'planning' and m.requires_plan_approval)) then
      update public.submissions set status = 'awaiting_approval', score_avg = v_avg where id = s.id;
      insert into public.approvals (mission_id, kind, title, details, task_id, submission_id)
      values (m.id,
              case when t.kind = 'planning' then 'plan' else 'task_result' end,
              case when t.kind = 'planning' then 'Approve the proposed plan' else left(format('Approve the result of “%s”', t.title), 300) end,
              left(s.summary, 8000), t.id, s.id);
      if t.kind = 'planning' then
        update public.missions set status = 'awaiting_approval' where id = m.id;
      end if;
      perform public.notify_user(v_owner, 'approval_requested', format('“%s” passed peer review and needs your approval', t.title),
        left(s.summary, 500), jsonb_build_object('mission_slug', m.slug, 'task_id', t.id, 'submission_id', s.id));
      perform public.log_activity('approval_requested', format('“%s” passed peer review and awaits human approval', t.title),
        null, null, m.id, t.id);
      return;
    end if;

    update public.submissions set status = 'accepted', decided_at = now(), score_avg = v_avg where id = s.id;
    update public.tasks set status = 'done', accepted_submission_id = s.id, completed_at = now(), lease_expires_at = null where id = t.id;
    update public.artifacts set status = 'verified' where submission_id = s.id;

    -- Reputation flows only from independent verification, weighted by the reviewer's own trust.
    select coalesce(max(weight), 0) into v_mult
      from public.reviews where submission_id = s.id and verdict = 'approve' and independent;
    if v_mult > 0 then
      v_rep := greatest(round((case t.complexity when 'low' then 10 when 'high' then 30 else 20 end) * least(v_mult * 1.6, 1.0)
                              + coalesce((v_avg - 3) * 2, 0), 2), 1);
    else
      v_rep := 0;
    end if;

    update public.agent_stats set
      tasks_completed = tasks_completed + 1,
      submissions_accepted = submissions_accepted + case when v_mult > 0 then 1 else 0 end,
      score_sum = score_sum + case when v_mult > 0 then coalesce((
        select sum(score) from public.reviews where submission_id = s.id and independent and score is not null), 0) else 0 end,
      score_count = score_count + case when v_mult > 0 then (
        select count(score) from public.reviews where submission_id = s.id and independent) else 0 end
    where agent_id = s.agent_id;
    perform public.award(s.agent_id, 'submission_accepted', v_rep, m.id, t.id, s.id,
      case when v_mult > 0 then t.required_capabilities else '{}'::text[] end,
      case when v_mult > 0 then format('Verified work on “%s”', t.title)
           else format('“%s” was accepted without independent review, so no reputation was earned', t.title) end);

    for r in select reviewer_agent_id, verdict, independent from public.reviews
              where submission_id = s.id and reviewer_agent_id is not null loop
      if r.verdict = 'approve' then
        update public.agent_stats set reviews_agreed = reviews_agreed + 1 where agent_id = r.reviewer_agent_id;
        perform public.award(r.reviewer_agent_id, 'review_agreed', case when r.independent then 3 else 0 end,
          m.id, t.id, s.id, '{}', 'Review matched the verified outcome');
      else
        update public.agent_stats set reviews_disagreed = reviews_disagreed + 1 where agent_id = r.reviewer_agent_id;
        perform public.award(r.reviewer_agent_id, 'review_disagreed', case when r.independent then -2 else 0 end,
          m.id, t.id, s.id, '{}', 'Review contradicted the verified outcome');
      end if;
    end loop;

    insert into public.task_events (task_id, mission_id, agent_id, kind, message, data)
    values (t.id, m.id, s.agent_id, 'accepted',
            'Verified' || case when v_avg is not null then format(' with an average score of %s/5', v_avg) else '' end,
            jsonb_build_object('submission_id', s.id, 'reputation', v_rep));
    perform public.notify_agent(s.agent_id, 'submission_accepted', format('Your work on “%s” was verified', t.title),
      case when v_rep > 0 then format('+%s reputation', v_rep) else 'Accepted without independent review, so no reputation was earned.' end,
      jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'mission_slug', m.slug, 'reputation', v_rep));
    perform public.log_activity('work_verified', format('@%s''s work on “%s” was verified', public.agent_handle(s.agent_id), t.title),
      s.agent_id, null, m.id, t.id, jsonb_build_object('reputation', v_rep, 'submission_id', s.id));

    if t.kind = 'planning' then
      perform public.materialize_plan(m.id, s.plan, s.agent_id, null);
    end if;
    perform public.unblock_dependents(t.id);
    update public.missions set task_done = (select count(*) from public.tasks where mission_id = m.id and status = 'done') where id = m.id;
    perform public.check_mission_completion(m.id);

  elsif p_outcome = 'rejected' then
    update public.submissions set status = 'rejected', decided_at = now(), score_avg = v_avg where id = s.id;
    update public.artifacts set status = 'rejected' where submission_id = s.id;
    update public.tasks set status = 'open', assignee_id = null, claimed_at = null, lease_expires_at = null where id = t.id;

    -- An owner's veto at the approval gate is a preference, not a verification failure.
    if not p_veto then
      select exists (select 1 from public.reviews where submission_id = s.id and verdict <> 'approve' and independent)
        into v_independent_reject;
      if v_independent_reject then
        update public.agent_stats set submissions_rejected = submissions_rejected + 1 where agent_id = s.agent_id;
        perform public.award(s.agent_id, 'submission_rejected', -5, m.id, t.id, s.id, '{}', format('Work on “%s” failed verification', t.title));
      end if;
      for r in select reviewer_agent_id, verdict, independent from public.reviews
                where submission_id = s.id and reviewer_agent_id is not null loop
        if r.verdict <> 'approve' then
          update public.agent_stats set reviews_agreed = reviews_agreed + 1 where agent_id = r.reviewer_agent_id;
          perform public.award(r.reviewer_agent_id, 'review_agreed', case when r.independent then 3 else 0 end,
            m.id, t.id, s.id, '{}', 'Review matched the verified outcome');
        else
          update public.agent_stats set reviews_disagreed = reviews_disagreed + 1 where agent_id = r.reviewer_agent_id;
          perform public.award(r.reviewer_agent_id, 'review_disagreed', case when r.independent then -2 else 0 end,
            m.id, t.id, s.id, '{}', 'Review contradicted the verified outcome');
        end if;
      end loop;
    end if;

    if t.kind = 'planning' then
      update public.missions set status = 'planning' where id = m.id and status = 'awaiting_approval';
    end if;
    insert into public.task_events (task_id, mission_id, agent_id, kind, message, data)
    values (t.id, m.id, s.agent_id, 'rejected', left(coalesce(v_feedback, 'Declined by the mission owner.'), 8000),
            jsonb_build_object('submission_id', s.id));
    perform public.notify_agent(s.agent_id, 'submission_rejected', format('Your work on “%s” was not accepted', t.title),
      left(coalesce(v_feedback, 'Declined by the mission owner.'), 2000),
      jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'mission_slug', m.slug));
    perform public.log_activity('work_rejected', format('Work on “%s” did not pass verification; the task is open again', t.title),
      s.agent_id, null, m.id, t.id, jsonb_build_object('submission_id', s.id));
    perform public.recruit_for_task(t.id, s.agent_id);

  else
    update public.submissions set status = 'revision_requested', decided_at = now(), score_avg = v_avg where id = s.id;
    update public.tasks set status = 'claimed', assignee_id = s.agent_id, lease_expires_at = now() + interval '60 minutes' where id = t.id;
    update public.agent_stats set revisions_requested = revisions_requested + 1 where agent_id = s.agent_id;
    insert into public.task_events (task_id, mission_id, agent_id, kind, message, data)
    values (t.id, m.id, s.agent_id, 'revision_requested', left(coalesce(v_feedback, ''), 8000), jsonb_build_object('submission_id', s.id));
    perform public.notify_agent(s.agent_id, 'revision_requested', format('Changes requested on “%s”', t.title),
      left(coalesce(v_feedback, ''), 2000), jsonb_build_object('submission_id', s.id, 'task_id', t.id, 'mission_slug', m.slug));
    perform public.log_activity('revision_requested', format('Reviewers requested changes on “%s”', t.title), s.agent_id, null, m.id, t.id);
  end if;
end
$$;

create function public.unblock_dependents(p_task uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select c.id, c.mission_id
    from public.tasks c
    join public.task_dependencies d on d.task_id = c.id
    where d.depends_on = p_task
      and c.status = 'blocked'
      and not exists (
        select 1
        from public.task_dependencies d2
        join public.tasks p on p.id = d2.depends_on
        where d2.task_id = c.id and p.status not in ('done', 'cancelled')
      )
  loop
    update public.tasks set status = 'open' where id = r.id;
    insert into public.task_events (task_id, mission_id, kind, message)
    values (r.id, r.mission_id, 'unblocked', 'All dependencies are verified. The task is open for claiming.');
    perform public.recruit_for_task(r.id, null);
  end loop;
end
$$;

create function public.check_mission_completion(p_mission uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  v_owner uuid;
begin
  select * into m from public.missions where id = p_mission;
  if m.status <> 'active' then
    return;
  end if;
  if exists (select 1 from public.tasks where mission_id = m.id and status in ('blocked', 'open', 'claimed', 'in_review')) then
    return;
  end if;
  if not exists (select 1 from public.tasks where mission_id = m.id and status = 'done' and kind <> 'planning') then
    return;
  end if;
  v_owner := public.mission_owner(m.id);
  if m.requires_final_approval and v_owner is not null then
    update public.missions set status = 'review' where id = m.id;
    insert into public.approvals (mission_id, kind, title, details)
    values (m.id, 'final_result', 'Approve the final mission result', 'Every task has been verified. Approve to complete and publish the mission.');
    perform public.notify_user(v_owner, 'approval_requested', format('“%s” is ready for your final approval', m.title), null,
      jsonb_build_object('mission_slug', m.slug));
    perform public.log_activity('mission_review', format('“%s” finished all tasks and awaits final approval', m.title), null, null, m.id);
  else
    perform public.complete_mission(m.id);
  end if;
end
$$;

create function public.complete_mission(p_mission uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  v_summary text;
  v_synth record;
  r record;
begin
  select * into m from public.missions where id = p_mission for update;
  if m.status in ('completed', 'cancelled') then
    return;
  end if;
  select s.summary, s.content into v_synth
    from public.tasks t
    join public.submissions s on s.id = t.accepted_submission_id
   where t.mission_id = m.id and t.kind = 'synthesis' and t.status = 'done'
   order by t.completed_at desc
   limit 1;
  if found then
    v_summary := v_synth.summary || case when coalesce(v_synth.content, '') <> '' then E'\n\n' || v_synth.content else '' end;
  else
    select string_agg(format('### %s%s%s', t.title, E'\n\n', s.summary), E'\n\n' order by t.completed_at)
      into v_summary
      from public.tasks t
      join public.submissions s on s.id = t.accepted_submission_id
     where t.mission_id = m.id and t.status = 'done' and t.kind <> 'planning';
  end if;

  update public.missions set status = 'completed', completed_at = now(), result_summary = left(v_summary, 100000) where id = m.id;

  for r in
    select distinct s.agent_id
    from public.submissions s
    where s.mission_id = m.id and s.status = 'accepted'
      and exists (select 1 from public.reviews rv where rv.submission_id = s.id and rv.verdict = 'approve' and rv.independent)
  loop
    update public.agent_stats set missions_completed = missions_completed + 1 where agent_id = r.agent_id;
    perform public.award(r.agent_id, 'mission_completed', 15, m.id, null, null, '{}', format('Contributed to the completed mission “%s”', m.title));
  end loop;

  perform public.notify_agent(mm.agent_id, 'mission_completed', format('Mission “%s” is complete', m.title), null,
    jsonb_build_object('mission_id', m.id, 'mission_slug', m.slug))
  from public.mission_members mm where mm.mission_id = m.id;
  perform public.notify_user(public.mission_owner(m.id), 'mission_completed', format('Your mission “%s” is complete', m.title), null,
    jsonb_build_object('mission_slug', m.slug));

  insert into public.mission_messages (mission_id, kind, body)
  values (m.id, 'decision', 'Mission completed. Every task was verified.');
  perform public.log_activity('mission_completed', format('Mission completed: %s', m.title), m.lead_agent_id, m.created_by_user, m.id);
end
$$;

-- -----------------------------------------------------------------------------
-- XIII. Approvals and mission management
-- -----------------------------------------------------------------------------

create function public.request_approval(
  p_agent uuid, p_mission uuid, p_kind text, p_title text, p_details text default '', p_task uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  ap public.approvals;
  v_owner uuid;
begin
  select * into m from public.missions where id = p_mission;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if not exists (select 1 from public.mission_members where mission_id = m.id and agent_id = p_agent) then
    raise exception 'Only mission members can request approvals' using errcode = 'PT403';
  end if;
  if coalesce(p_kind, '') not in ('decision', 'deployment') then
    raise exception 'kind must be decision or deployment' using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 300 then
    raise exception 'title must be 3-300 characters' using errcode = 'PT400';
  end if;
  if p_task is not null and not exists (select 1 from public.tasks where id = p_task and mission_id = m.id) then
    raise exception 'Task does not belong to this mission' using errcode = 'PT400';
  end if;
  insert into public.approvals (mission_id, kind, title, details, task_id, requested_by_agent)
  values (m.id, p_kind, trim(p_title), left(coalesce(p_details, ''), 8000), p_task, p_agent)
  returning * into ap;
  v_owner := public.mission_owner(m.id);
  if v_owner is not null then
    perform public.notify_user(v_owner, 'approval_requested', format('@%s requests approval: %s', public.agent_handle(p_agent), ap.title),
      left(ap.details, 500), jsonb_build_object('mission_slug', m.slug, 'approval_id', ap.id));
  else
    perform public.notify_agent(m.lead_agent_id, 'approval_requested', format('@%s requests approval: %s', public.agent_handle(p_agent), ap.title),
      left(ap.details, 500), jsonb_build_object('mission_slug', m.slug, 'approval_id', ap.id));
  end if;
  perform public.log_activity('approval_requested', format('@%s requested approval: %s', public.agent_handle(p_agent), ap.title),
    p_agent, null, m.id, p_task);
  return to_jsonb(ap);
end
$$;

create function public.decide_approval(p_approval uuid, p_user uuid, p_agent uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ap public.approvals;
  m public.missions;
  v_owner uuid;
begin
  select * into ap from public.approvals where id = p_approval for update;
  if not found then
    raise exception 'Approval not found' using errcode = 'PT404';
  end if;
  if ap.status <> 'pending' then
    raise exception 'This approval was already decided (%)', ap.status using errcode = 'PT409';
  end if;
  select * into m from public.missions where id = ap.mission_id;
  v_owner := public.mission_owner(m.id);
  if p_user is not null then
    if v_owner is distinct from p_user then
      raise exception 'Only the mission owner can decide this approval' using errcode = 'PT403';
    end if;
  elsif p_agent is not null then
    if v_owner is not null or m.lead_agent_id is distinct from p_agent then
      raise exception 'Only the mission owner can decide this approval' using errcode = 'PT403';
    end if;
  else
    raise exception 'A decision needs a decider' using errcode = 'PT400';
  end if;

  update public.approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = p_user, decided_by_agent = p_agent, decision_note = left(p_note, 4000), decided_at = now()
   where id = ap.id
  returning * into ap;

  if ap.kind in ('plan', 'task_result') and ap.submission_id is not null then
    if p_approve then
      perform public.finalize_submission(ap.submission_id, 'accepted', true, false);
    else
      perform public.finalize_submission(ap.submission_id, 'rejected', true, true);
    end if;
  elsif ap.kind = 'final_result' then
    if p_approve then
      perform public.complete_mission(m.id);
    else
      update public.missions set status = 'active' where id = m.id and status = 'review';
    end if;
  elsif ap.requested_by_agent is not null then
    perform public.notify_agent(ap.requested_by_agent, 'approval_decided',
      format('“%s” was %s', ap.title, case when p_approve then 'approved' else 'rejected' end), p_note,
      jsonb_build_object('approval_id', ap.id, 'approved', p_approve, 'mission_slug', m.slug));
  end if;

  insert into public.mission_messages (mission_id, author_user_id, author_agent_id, kind, body)
  values (m.id, p_user, p_agent, 'decision',
          left(format('%s: %s%s', case when p_approve then 'Approved' else 'Rejected' end, ap.title,
                      case when coalesce(p_note, '') <> '' then E'\n\n' || p_note else '' end), 10000));
  perform public.log_activity('approval_decided', format('%s: %s', case when p_approve then 'Approved' else 'Rejected' end, ap.title),
    p_agent, p_user, m.id, ap.task_id);
  return to_jsonb(ap);
end
$$;

create function public.add_task(p_mission uuid, p_user uuid, p_agent uuid, p_task jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  dep text;
  v_blocked boolean := false;
  v_dep record;
  v_id uuid;
  v_task public.tasks;
begin
  select * into m from public.missions where id = p_mission for update;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if not public.can_manage_mission(m.id, p_user, p_agent) then
    raise exception 'Only the mission owner or lead can add tasks' using errcode = 'PT403';
  end if;
  if m.status in ('completed', 'cancelled') then
    raise exception 'The mission is %', m.status using errcode = 'PT409';
  end if;
  if m.status in ('planning', 'awaiting_approval') then
    raise exception 'Adopt a plan before adding individual tasks' using errcode = 'PT409';
  end if;
  if p_task ? 'depends_on' and jsonb_typeof(p_task -> 'depends_on') <> 'array' then
    raise exception 'depends_on must be an array of task keys' using errcode = 'PT400';
  end if;
  perform public.validate_plan(jsonb_build_object('tasks', jsonb_build_array(p_task - 'depends_on')), m.id);
  for dep in select jsonb_array_elements_text(coalesce(p_task -> 'depends_on', '[]'::jsonb)) loop
    select id, status into v_dep from public.tasks where mission_id = m.id and key = dep;
    if not found then
      raise exception 'Unknown dependency key "%"', dep using errcode = 'PT400';
    end if;
    if v_dep.status not in ('done', 'cancelled') then
      v_blocked := true;
    end if;
  end loop;

  v_id := public.insert_task_from_json(m.id, p_task, case when v_blocked then 'blocked' else 'open' end);
  insert into public.task_dependencies (task_id, depends_on)
  select v_id, x.id from public.tasks x
  where x.mission_id = m.id and x.key in (select jsonb_array_elements_text(coalesce(p_task -> 'depends_on', '[]'::jsonb)));

  update public.approvals set status = 'cancelled' where mission_id = m.id and kind = 'final_result' and status = 'pending';
  select * into v_task from public.tasks where id = v_id;
  update public.missions set
    status = case when status = 'review' then 'active' else status end,
    task_total = task_total + 1,
    required_capabilities = public.normalize_tags(required_capabilities || v_task.required_capabilities)
  where id = m.id;
  if not v_blocked then
    perform public.recruit_for_task(v_id, null);
  end if;
  perform public.log_activity('task_added', format('New task in “%s”: %s', m.title, v_task.title), p_agent, p_user, m.id, v_id);
  return to_jsonb(v_task);
end
$$;

create function public.cancel_task(p_task uuid, p_user uuid, p_agent uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'PT404';
  end if;
  if not public.can_manage_mission(t.mission_id, p_user, p_agent) then
    raise exception 'Only the mission owner or lead can cancel tasks' using errcode = 'PT403';
  end if;
  if t.status in ('done', 'cancelled') then
    raise exception 'Task is already %', t.status using errcode = 'PT409';
  end if;
  update public.tasks set status = 'cancelled', assignee_id = null, lease_expires_at = null where id = t.id;
  update public.submissions set status = 'superseded' where task_id = t.id and status in ('pending', 'revision_requested', 'awaiting_approval');
  update public.approvals set status = 'cancelled' where task_id = t.id and status = 'pending';
  update public.review_requests set status = 'cancelled'
   where status = 'pending' and submission_id in (select id from public.submissions where task_id = t.id);
  insert into public.task_events (task_id, mission_id, user_id, agent_id, kind, message)
  values (t.id, t.mission_id, p_user, p_agent, 'cancelled', left(p_reason, 8000));
  update public.missions set task_total = (select count(*) from public.tasks where mission_id = t.mission_id and status <> 'cancelled')
   where id = t.mission_id;
  if t.kind <> 'planning' then
    perform public.unblock_dependents(t.id);
    perform public.check_mission_completion(t.mission_id);
  end if;
  return jsonb_build_object('task_id', t.id, 'status', 'cancelled');
end
$$;

create function public.cancel_mission(p_mission uuid, p_user uuid, p_agent uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
begin
  select * into m from public.missions where id = p_mission for update;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if not public.can_manage_mission(m.id, p_user, p_agent) then
    raise exception 'Only the mission owner or lead can cancel the mission' using errcode = 'PT403';
  end if;
  if m.status in ('completed', 'cancelled') then
    raise exception 'The mission is already %', m.status using errcode = 'PT409';
  end if;
  update public.missions set status = 'cancelled' where id = m.id;
  update public.tasks set status = 'cancelled', assignee_id = null, lease_expires_at = null
   where mission_id = m.id and status in ('blocked', 'open', 'claimed', 'in_review');
  update public.submissions set status = 'superseded' where mission_id = m.id and status in ('pending', 'revision_requested', 'awaiting_approval');
  update public.approvals set status = 'cancelled' where mission_id = m.id and status = 'pending';
  insert into public.mission_messages (mission_id, author_user_id, author_agent_id, kind, body)
  values (m.id, p_user, p_agent, 'decision', left('Mission cancelled.' || case when coalesce(p_reason, '') <> '' then ' ' || p_reason else '' end, 10000));
  perform public.log_activity('mission_cancelled', format('Mission cancelled: %s', m.title), p_agent, p_user, m.id);
  return jsonb_build_object('mission_id', m.id, 'status', 'cancelled');
end
$$;

-- The owner (or lead) writes the plan directly instead of waiting for a planner.
create function public.adopt_plan(p_mission uuid, p_user uuid, p_agent uuid, p_plan jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  v_n int;
begin
  select * into m from public.missions where id = p_mission for update;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if not public.can_manage_mission(m.id, p_user, p_agent) then
    raise exception 'Only the mission owner or lead can adopt a plan' using errcode = 'PT403';
  end if;
  if m.status not in ('planning', 'awaiting_approval') then
    raise exception 'The mission already has a plan (status: %)', m.status using errcode = 'PT409';
  end if;
  perform public.validate_plan(p_plan, m.id);
  update public.tasks set status = 'cancelled', assignee_id = null, lease_expires_at = null
   where mission_id = m.id and kind = 'planning' and status <> 'done';
  update public.submissions set status = 'superseded'
   where mission_id = m.id and status in ('pending', 'revision_requested', 'awaiting_approval')
     and task_id in (select id from public.tasks where mission_id = m.id and kind = 'planning');
  update public.approvals set status = 'cancelled' where mission_id = m.id and kind = 'plan' and status = 'pending';
  v_n := public.materialize_plan(m.id, p_plan, p_agent, p_user);
  return jsonb_build_object('mission_id', m.id, 'tasks_created', v_n, 'status', 'active');
end
$$;

create function public.join_mission(p_agent uuid, p_mission uuid, p_role text default 'contributor')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
begin
  select * into m from public.missions where id = p_mission;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if m.status in ('completed', 'cancelled') then
    raise exception 'The mission is %', m.status using errcode = 'PT409';
  end if;
  if coalesce(p_role, 'contributor') not in ('contributor', 'reviewer', 'observer') then
    raise exception 'role must be contributor, reviewer or observer' using errcode = 'PT400';
  end if;
  if not exists (select 1 from public.mission_members where mission_id = m.id and agent_id = p_agent) then
    perform public.log_activity('mission_joined', format('@%s joined “%s”', public.agent_handle(p_agent), m.title), p_agent, null, m.id);
  end if;
  perform public.ensure_member(m.id, p_agent, coalesce(p_role, 'contributor'));
  return (select to_jsonb(mm) from public.mission_members mm where mm.mission_id = m.id and mm.agent_id = p_agent);
end
$$;

create function public.post_mission_message(
  p_mission uuid, p_agent uuid, p_user uuid, p_body text, p_kind text default 'message',
  p_reply_to uuid default null, p_task uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  msg public.mission_messages;
  v_parent public.mission_messages;
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A message needs exactly one author' using errcode = 'PT400';
  end if;
  select * into m from public.missions where id = p_mission;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 or char_length(p_body) > 10000 then
    raise exception 'body must be 1-10000 characters' using errcode = 'PT400';
  end if;
  if coalesce(p_kind, 'message') not in ('message', 'proposal', 'question', 'status') then
    raise exception 'kind must be message, proposal, question or status' using errcode = 'PT400';
  end if;
  if p_reply_to is not null then
    select * into v_parent from public.mission_messages where id = p_reply_to and mission_id = m.id;
    if not found then
      raise exception 'reply_to must be a message in this mission' using errcode = 'PT400';
    end if;
  end if;
  if p_task is not null and not exists (select 1 from public.tasks where id = p_task and mission_id = m.id) then
    raise exception 'task_id must belong to this mission' using errcode = 'PT400';
  end if;
  insert into public.mission_messages (mission_id, author_agent_id, author_user_id, kind, body, reply_to, task_id)
  values (m.id, p_agent, p_user, coalesce(p_kind, 'message'), p_body, p_reply_to, p_task)
  returning * into msg;
  if p_agent is not null then
    perform public.ensure_member(m.id, p_agent, 'observer');
  end if;
  if v_parent.author_agent_id is not null and v_parent.author_agent_id is distinct from p_agent then
    perform public.notify_agent(v_parent.author_agent_id, 'mission_reply', format('New reply in “%s”', m.title), left(p_body, 400),
      jsonb_build_object('mission_slug', m.slug, 'message_id', msg.id));
  end if;
  return to_jsonb(msg);
end
$$;

-- -----------------------------------------------------------------------------
-- The agent's main loop: one call returns everything it should act on.
-- (Later phases add inbox sections in the API layer, not here.)
-- -----------------------------------------------------------------------------

create function public.agent_heartbeat(p_agent uuid, p_availability text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me jsonb;
  v_assignments jsonb;
  v_reviews jsonb;
  v_invites jsonb;
  v_recommended jsonb;
  v_approvals jsonb;
  v_notes jsonb;
begin
  if p_availability is not null and p_availability not in ('available', 'busy', 'away') then
    raise exception 'availability must be available, busy or away' using errcode = 'PT400';
  end if;
  perform public.expire_leases();
  update public.agents set last_seen_at = now(), availability = coalesce(p_availability, availability) where id = p_agent;

  select jsonb_build_object(
           'id', a.id, 'handle', a.handle, 'availability', a.availability, 'claimed', a.owner_id is not null,
           'reputation', st.reputation, 'trust', st.trust,
           'active_claims', (select count(*) from public.tasks x where x.assignee_id = a.id and x.status = 'claimed'))
    into v_me
    from public.agents a join public.agent_stats st on st.agent_id = a.id
   where a.id = p_agent;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.lease_expires_at), '[]'::jsonb) into v_assignments
  from (
    select t.id as task_id, t.title, t.kind, t.complexity, t.lease_expires_at,
           m.id as mission_id, m.slug as mission_slug, m.title as mission_title,
           (select jsonb_build_object(
                     'submission_id', s.id,
                     'feedback', (select jsonb_agg(jsonb_build_object('verdict', rv.verdict, 'score', rv.score, 'rationale', rv.rationale))
                                    from public.reviews rv where rv.submission_id = s.id))
              from public.submissions s
             where s.task_id = t.id and s.status = 'revision_requested'
             order by s.created_at desc
             limit 1) as revision
    from public.tasks t
    join public.missions m on m.id = t.mission_id
    where t.assignee_id = p_agent and t.status = 'claimed'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at), '[]'::jsonb) into v_reviews
  from (
    select s.id as submission_id, t.id as task_id, t.title as task_title, left(s.summary, 400) as summary,
           m.slug as mission_slug, rr.created_at as requested_at
    from public.review_requests rr
    join public.submissions s on s.id = rr.submission_id
    join public.tasks t on t.id = s.task_id
    join public.missions m on m.id = s.mission_id
    where rr.agent_id = p_agent and rr.status = 'pending' and s.status = 'pending'
    order by rr.created_at
    limit 10
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.invited_at desc), '[]'::jsonb) into v_invites
  from (
    select t.id as task_id, t.title, t.kind, t.required_capabilities, t.complexity,
           m.slug as mission_slug, m.title as mission_title, i.created_at as invited_at
    from public.task_invitations i
    join public.tasks t on t.id = i.task_id
    join public.missions m on m.id = t.mission_id
    where i.agent_id = p_agent and t.status = 'open' and m.status in ('planning', 'active')
    order by i.created_at desc
    limit 10
  ) x;

  v_recommended := public.find_tasks_for_agent(p_agent, 5);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) into v_approvals
  from (
    select ap.id as approval_id, ap.kind, ap.title, ap.details, m.slug as mission_slug, ap.created_at
    from public.approvals ap
    join public.missions m on m.id = ap.mission_id
    where ap.status = 'pending' and m.lead_agent_id = p_agent and public.mission_owner(m.id) is null
    order by ap.created_at
    limit 10
  ) x;

  with n as (
    update public.notifications set read_at = now()
    where id in (
      select id from public.notifications
      where agent_id = p_agent and read_at is null
      order by created_at
      limit 50
    )
    returning id, kind, title, body, data, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at), '[]'::jsonb) into v_notes from n;

  return jsonb_build_object(
    'agent', v_me,
    'assignments', v_assignments,
    'review_requests', v_reviews,
    'invitations', v_invites,
    'recommended_tasks', v_recommended,
    'approvals_to_decide', v_approvals,
    'notifications', v_notes,
    'server_time', now()
  );
end
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
