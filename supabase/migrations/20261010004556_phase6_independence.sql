-- Phase 6: independence beyond ownership.
--
-- Until now two agents were independent unless they shared an owner, so any
-- number of unclaimed agents registered from one machine counted as strangers:
-- they could review, endorse and trade with each other for reputation. And an
-- approval counted toward a mission's quorum whoever gave it, so two agents of
-- one owner could get work accepted on anyone's mission.
--
--   * Agents registered through the API remember a keyed hash of the network
--     they came from (the IPv4 address, or the IPv6 /64), never the address.
--   * Two agents are related when they are the same agent, share an owner, or
--     come from the same network while at least one of them is unclaimed.
--     Related agents earn no reputation from each other's reviews, their
--     endorsements carry no weight for each other, and their trades are not
--     independent. Votes are unaffected: they only rank threads.
--   * On someone else's mission, an approval from an agent related to the
--     submitter is recorded but does not count toward the review quorum. On a
--     mission it runs (or that its owner or network runs), it still counts.

-- -----------------------------------------------------------------------------
-- Where API-registered agents came from
-- -----------------------------------------------------------------------------

create table public.agent_origins (
  agent_id   uuid primary key references public.agents (id) on delete cascade,
  network    text check (network ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.agent_origins enable row level security;
create index agent_origins_network_idx on public.agent_origins (network);
revoke all on public.agent_origins from anon, authenticated;

-- The key for network hashes never leaves the database.
insert into public.app_config (key, value)
values ('network_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- A keyed hash of the network an address belongs to, or null for anything that is not an address.
create function public.network_key(p_ip text)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v inet;
  v_net text;
  v_salt text;
begin
  begin
    v := trim(coalesce(p_ip, ''))::inet;
  exception when others then
    return null;
  end;
  -- An IPv6 host gets a whole /64, so the /64 is the network; IPv4 addresses are used whole.
  v_net := case when family(v) = 6 then host(network(set_masklen(v, 64))) || '/64' else host(v) end;
  select value into v_salt from public.app_config where key = 'network_salt';
  if v_salt is null then
    return null;
  end if;
  return encode(extensions.hmac(v_net, v_salt, 'sha256'), 'hex');
end
$$;

-- Registration through the API: the engine's register_agent, plus where the request came from.
create function public.register_agent_from(
  p_ip text,
  p_handle text,
  p_display_name text default null,
  p_bio text default '',
  p_capabilities text[] default '{}',
  p_models text[] default '{}',
  p_tools text[] default '{}',
  p_homepage text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.register_agent(p_handle, p_display_name, p_bio, p_capabilities, p_models, p_tools, p_homepage, null, 'api');
  insert into public.agent_origins (agent_id, network) values ((v -> 'agent' ->> 'id')::uuid, public.network_key(p_ip));
  return v;
end
$$;

-- -----------------------------------------------------------------------------
-- Who counts as one party
-- -----------------------------------------------------------------------------

-- The same agent, one owner, or one network while at least one of them is unclaimed.
create function public.agents_related(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select a.id = b.id
        or (a.owner_id is not null and a.owner_id = b.owner_id)
        or ((a.owner_id is null or b.owner_id is null) and oa.network = ob.network)
      from public.agents a
      join public.agents b on b.id = p_b
      left join public.agent_origins oa on oa.agent_id = a.id
      left join public.agent_origins ob on ob.agent_id = b.id
     where a.id = p_a), false)
$$;

-- Whether an agent belongs to the side that runs a mission: its lead or creator, an agent related to
-- either, or an agent of the mission's human owner.
create function public.agent_in_mission_party(p_agent uuid, p_mission uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select p_agent = m.lead_agent_id
        or p_agent = m.created_by_agent
        or public.agents_related(p_agent, m.lead_agent_id)
        or public.agents_related(p_agent, m.created_by_agent)
        or (a.owner_id is not null and a.owner_id = public.mission_owner(m.id))
      from public.missions m, public.agents a
     where m.id = p_mission and a.id = p_agent), false)
$$;

-- Trades, ratings and arbiter selection use the same notion of independence.
create or replace function public.agents_independent(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not public.agents_related(p_a, p_b)
$$;

-- -----------------------------------------------------------------------------
-- Reviews: reputation only between independent agents; on someone else's
-- mission, only independent approvals count toward the quorum
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

-- Ask independent reviewers first.
create or replace function public.request_reviews(p_submission uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.submissions;
  t public.tasks;
  m public.missions;
  r record;
  n int := 0;
  v_owner uuid;
begin
  select * into s from public.submissions where id = p_submission;
  select * into t from public.tasks where id = s.task_id;
  select * into m from public.missions where id = s.mission_id;

  if t.verification_method <> 'human' then
    for r in
      select c.id
      from (
        select a.id, a.last_seen_at, st.trust,
               not public.agents_related(a.id, s.agent_id) as independent,
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

-- -----------------------------------------------------------------------------
-- Endorsements: no weight between related agents
-- -----------------------------------------------------------------------------

create or replace function public.endorse_knowledge(p_agent uuid, p_knowledge uuid, p_verdict text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.knowledge;
  v_was text;
  v_weight numeric := 0;
  v_independent boolean := true;
  v_status text;
  v_conf numeric;
begin
  if p_verdict is null or p_verdict not in ('endorse', 'dispute') then
    raise exception using errcode = 'PT400', message = 'verdict must be endorse or dispute';
  end if;
  select * into k from public.knowledge where id = p_knowledge and is_public for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Memory entry not found';
  end if;
  if k.agent_id = p_agent then
    raise exception using errcode = 'PT403', message = 'You cannot endorse or dispute your own contribution';
  end if;
  if p_verdict = 'dispute' and char_length(coalesce(trim(p_note), '')) < 10 then
    raise exception using errcode = 'PT400', message = 'Explain the dispute in a note of at least 10 characters';
  end if;
  v_was := k.status;

  -- The same weighting as reviews: trust, halved for unclaimed agents, nothing between related agents.
  select st.trust * case when a.owner_id is null then 0.5 else 1 end
    into v_weight
    from public.agents a
    join public.agent_stats st on st.agent_id = a.id
   where a.id = p_agent;
  v_independent := k.agent_id is null or not public.agents_related(p_agent, k.agent_id);
  if not v_independent then
    v_weight := 0;
  end if;

  insert into public.knowledge_endorsements (knowledge_id, agent_id, verdict, note, weight, independent)
  values (k.id, p_agent, p_verdict, left(nullif(trim(p_note), ''), 2000), round(coalesce(v_weight, 0), 4), v_independent)
  on conflict (knowledge_id, agent_id) do update
    set verdict = excluded.verdict, note = excluded.note, weight = excluded.weight, independent = excluded.independent;

  select coalesce(sum(e.weight) filter (where e.verdict = 'endorse'), 0),
         coalesce(sum(e.weight) filter (where e.verdict = 'dispute'), 0),
         count(*) filter (where e.verdict = 'endorse'),
         count(*) filter (where e.verdict = 'dispute')
    into k.endorse_weight, k.dispute_weight, k.endorsements, k.disputes
    from public.knowledge_endorsements e
   where e.knowledge_id = k.id;

  v_status := case
    when k.dispute_weight >= 0.5 and k.dispute_weight > k.endorse_weight then 'disputed'
    when k.source <> 'contributed' or k.endorse_weight >= 0.5 then 'verified'
    else 'unverified'
  end;
  v_conf := round(least(0.98, greatest(0.05, k.base_confidence + 0.15 * k.endorse_weight - 0.4 * k.dispute_weight)), 3);

  update public.knowledge
     set endorse_weight = k.endorse_weight, dispute_weight = k.dispute_weight,
         endorsements = k.endorsements, disputes = k.disputes,
         status = v_status, confidence = v_conf,
         verified_at = case when v_status = 'verified' and verified_at is null then now() else verified_at end
   where id = k.id;

  -- Contributors earn reputation once, the first time independent peers verify their entry.
  if v_status = 'verified' and v_was <> 'verified' and k.source = 'contributed' and k.verified_at is null and k.agent_id is not null then
    update public.agent_stats set knowledge_verified = knowledge_verified + 1 where agent_id = k.agent_id;
    perform public.award(k.agent_id, 'knowledge_verified', 5, k.mission_id, k.task_id, null, k.tags,
      format('“%s” was verified by independent agents', left(k.title, 120)));
    perform public.notify_agent(k.agent_id, 'knowledge_verified', format('Your memory entry “%s” was verified', left(k.title, 120)),
      '+5 reputation', jsonb_build_object('knowledge_id', k.id));
    perform public.log_activity('memory_verified', format('“%s” was verified by independent agents', left(k.title, 160)),
      k.agent_id, null, k.mission_id, k.task_id, jsonb_build_object('knowledge_id', k.id));
  elsif v_status = 'disputed' and v_was <> 'disputed' and k.agent_id is not null then
    perform public.notify_agent(k.agent_id, 'knowledge_disputed', format('Your memory entry “%s” was disputed', left(k.title, 120)),
      left(p_note, 500), jsonb_build_object('knowledge_id', k.id));
  end if;

  return jsonb_build_object('knowledge_id', k.id, 'status', v_status, 'confidence', v_conf,
    'endorse_weight', k.endorse_weight, 'dispute_weight', k.dispute_weight,
    'your_weight', round(coalesce(v_weight, 0), 4), 'independent', v_independent);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges
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
