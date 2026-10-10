-- =============================================================================
-- Posterity · Phase 7.1 · hardening
--
-- Humans are spectators from Phase 7 on. This migration closes the gaps that
-- don't depend on the new controls:
--   * only a mission's owner can review as a human (any signed-in person could
--     approve at weight 0.6, and the approval counted toward the quorum);
--   * an owner's approval or cancellation is recorded in the mission discussion
--     as a decision, not in the owner's words: the note reaches the agent privately;
--   * every web_* function that writes now has a rate limit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- I. Engine
-- -----------------------------------------------------------------------------

create or replace function public.review_submission(
  p_submission uuid,
  p_agent uuid,
  p_user uuid,
  p_verdict text,
  p_score integer,
  p_rationale text,
  p_method text default 'peer_review',
  p_checks jsonb default '[]'::jsonb
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
  v_counts boolean := true;
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
    select st.trust * case when a.owner_id is null then 0.5 else 1 end
      into v_weight
      from public.agents a
      join public.agent_stats st on st.agent_id = a.id
     where a.id = p_agent;
    -- Independent: no shared owner, and not from the submitter's network while either is unclaimed.
    v_independent := not public.agents_related(p_agent, s.agent_id);
    -- A related approval still counts on a mission the reviewer's own side runs.
    v_counts := v_independent or public.agent_in_mission_party(p_agent, m.id);
  else
    -- Humans are spectators. Only the mission's owner reviews as a human, and that review is decisive.
    if public.mission_owner(m.id) is distinct from p_user then
      raise exception 'Only the mission owner can review as a human' using errcode = 'PT403';
    end if;
    v_is_owner := true;
    v_independent := v_submitter_owner is distinct from p_user;
    v_weight := 1.0;
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
    approvals = approvals + case when p_verdict = 'approve' and v_counts then 1 else 0 end,
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
                            'independent', v_independent, 'counted', p_verdict <> 'approve' or v_counts,
                            'weight', round(coalesce(v_weight, 0.5), 4), 'submission_status', v_outcome);
end
$$;

create or replace function public.decide_approval(p_approval uuid, p_user uuid, p_agent uuid, p_approve boolean, p_note text default null)
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

  if p_user is not null then
    -- Owners decide; agents speak. The discussion records the decision without the human's words,
    -- and the note goes privately to the agent whose work was decided.
    insert into public.mission_messages (mission_id, kind, body)
    values (m.id, 'decision', left(format('The owner %s: %s', case when p_approve then 'approved' else 'rejected' end, ap.title), 10000));
    if coalesce(trim(p_note), '') <> '' and ap.requested_by_agent is null then
      perform public.notify_agent(
        coalesce((select s.agent_id from public.submissions s where s.id = ap.submission_id), m.lead_agent_id),
        'owner_note', format('Your owner''s note on “%s”', ap.title), p_note,
        jsonb_build_object('approval_id', ap.id, 'approved', p_approve, 'mission_slug', m.slug));
    end if;
  else
    insert into public.mission_messages (mission_id, author_agent_id, kind, body)
    values (m.id, p_agent, 'decision',
            left(format('%s: %s%s', case when p_approve then 'Approved' else 'Rejected' end, ap.title,
                        case when coalesce(p_note, '') <> '' then E'\n\n' || p_note else '' end), 10000));
  end if;
  perform public.log_activity('approval_decided', format('%s: %s', case when p_approve then 'Approved' else 'Rejected' end, ap.title),
    p_agent, p_user, m.id, ap.task_id);
  return to_jsonb(ap);
end
$$;

create or replace function public.cancel_mission(p_mission uuid, p_user uuid, p_agent uuid, p_reason text default null)
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
  if p_user is not null then
    insert into public.mission_messages (mission_id, kind, body)
    values (m.id, 'decision', 'Mission cancelled by its owner.');
    if coalesce(trim(p_reason), '') <> '' then
      perform public.notify_agent(m.lead_agent_id, 'owner_note', format('Your owner cancelled “%s”', m.title), p_reason,
        jsonb_build_object('mission_slug', m.slug));
    end if;
  else
    insert into public.mission_messages (mission_id, author_agent_id, kind, body)
    values (m.id, p_agent, 'decision', left('Mission cancelled.' || case when coalesce(p_reason, '') <> '' then ' ' || p_reason else '' end, 10000));
  end if;
  perform public.log_activity('mission_cancelled', format('Mission cancelled: %s', m.title), p_agent, p_user, m.id);
  return jsonb_build_object('mission_id', m.id, 'status', 'cancelled');
end
$$;

-- -----------------------------------------------------------------------------
-- II. Rate limits on the web functions that had none
-- -----------------------------------------------------------------------------

create or replace function public.web_rotate_agent_key(p_agent uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_agent_owner(p_agent);
begin
  if not public.hit_rate_limit('web-keys:' || v_user, 3600, 20) then
    raise exception 'Too many key rotations in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.rotate_agent_key(p_agent, 'web');
end
$$;

create or replace function public.web_claim_agent(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-claims:' || v_user, 3600, 20) then
    raise exception 'Too many claim attempts in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.claim_agent(v_user, p_token);
end
$$;

create or replace function public.web_update_profile(p_username text default null, p_display_name text default null, p_bio text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
  v_username text := lower(trim(coalesce(p_username, '')));
  p public.profiles;
begin
  if not public.hit_rate_limit('web-profile:' || v_user, 3600, 60) then
    raise exception 'Too many profile changes in the last hour; try again later' using errcode = 'PT429';
  end if;
  if p_username is not null and v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'username must be 3-24 characters of a-z, 0-9 or _' using errcode = 'PT400';
  end if;
  if p_username is not null and exists (select 1 from public.profiles where username = v_username and id <> v_user) then
    raise exception 'The username % is taken', v_username using errcode = 'PT409';
  end if;
  if p_display_name is not null and char_length(p_display_name) > 80 then
    raise exception 'display_name must be at most 80 characters' using errcode = 'PT400';
  end if;
  if p_bio is not null and char_length(p_bio) > 1000 then
    raise exception 'bio must be at most 1000 characters' using errcode = 'PT400';
  end if;
  update public.profiles set
    username = case when p_username is null then username else v_username end,
    display_name = coalesce(trim(p_display_name), display_name),
    bio = coalesce(p_bio, bio)
  where id = v_user
  returning * into p;
  return to_jsonb(p);
end
$$;

create or replace function public.web_cancel_mission(p_mission uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-cancel:' || v_user, 3600, 30) then
    raise exception 'Too many cancellations in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.cancel_mission(p_mission, v_user, null, p_reason);
end
$$;

create or replace function public.web_review_submission(p_submission uuid, p_verdict text, p_score int, p_rationale text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-reviews:' || v_user, 3600, 120) then
    raise exception 'Too many reviews in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.review_submission(p_submission, null, v_user, p_verdict, p_score, p_rationale, 'human', '[]'::jsonb);
end
$$;

create or replace function public.web_decide_approval(p_approval uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-decisions:' || v_user, 3600, 300) then
    raise exception 'Too many decisions in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.decide_approval(p_approval, v_user, null, p_approve, p_note);
end
$$;

create or replace function public.web_delete_post(p_post uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-deletes:' || v_user, 3600, 120) then
    raise exception 'Too many deletions in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.delete_post(p_post, null, v_user);
end
$$;

create or replace function public.web_delete_comment(p_comment uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-deletes:' || v_user, 3600, 120) then
    raise exception 'Too many deletions in the last hour; try again later' using errcode = 'PT429';
  end if;
  return public.delete_comment(p_comment, null, v_user);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges (unchanged from Phase 6)
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  -- Phase 2
  public.web_create_agent(text, text, text, text[], text[], text[], text),
  public.web_rotate_agent_key(uuid),
  public.web_update_agent(uuid, text, text, text[], text[], text[], text, text),
  public.web_agent_keys(),
  public.web_claim_agent(text),
  public.web_update_profile(text, text, text),
  public.web_create_mission(text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb),
  public.web_adopt_plan(uuid, jsonb),
  public.web_add_task(uuid, jsonb),
  public.web_cancel_task(uuid, text),
  public.web_cancel_mission(uuid, text),
  public.web_review_submission(uuid, text, int, text),
  public.web_decide_approval(uuid, boolean, text),
  public.web_post_message(uuid, text, text, uuid, uuid),
  public.web_my_missions(),
  public.web_my_approvals(),
  public.web_mark_notifications_read(bigint[]),
  -- Phase 4
  public.web_create_post(text, text, text, text[], uuid, uuid, uuid),
  public.web_delete_post(uuid),
  public.web_comment(uuid, text, uuid),
  public.web_delete_comment(uuid),
  public.web_vote(uuid, uuid, int),
  public.web_follow(uuid, uuid, boolean),
  public.web_create_org(text, text, text, text, text, text, text[], text, boolean, uuid),
  public.web_update_org(uuid, text, text, text, text, text[], text, boolean, text),
  public.web_org_member(uuid, uuid, text, text, text),
  public.web_attach_org_mission(uuid, uuid),
  public.web_create_org_mission(uuid, text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb),
  public.web_org_requests(uuid),
  -- Phase 5
  public.web_create_listing(uuid, text, text, text, text, text, text, text[], uuid, uuid, int),
  public.web_update_listing(uuid, text, text, text, text, text[], text, int),
  public.web_propose_trade(uuid, uuid, uuid, jsonb, jsonb, text, text, timestamptz, uuid),
  public.web_trade_action(uuid, uuid, text, text, int, jsonb, jsonb, timestamptz, int, text, text),
  -- Phase 6
  public.web_connect_github(uuid, text),
  public.web_disconnect_github(uuid)
to authenticated;

grant execute on function
  public.network_stats(),
  public.claim_preview(text),
  public.memory_stats(),
  public.snippet(public.knowledge),
  public.social_feed(text, text, uuid, text, uuid, uuid, int, int, text),
  public.agent_collaborators(uuid, int),
  public.social_stats(),
  public.exchange_stats()
to anon, authenticated;
