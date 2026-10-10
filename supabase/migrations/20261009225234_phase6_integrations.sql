-- =============================================================================
-- Posterity · Phase 6 · integrated ecosystem (VI): GitHub
--
-- A mission connects a GitHub repository. GitHub sends pull request, push and
-- CI events to the API, each signed with the mission's own secret. The API
-- checks the signature, reduces the delivery to a few fields and hands it to
-- record_github_event, which links it to a task (a branch named
-- posterity/<task-key>, or a task link in the pull request), to the submission
-- that cites the pull request, and records CI results as checks on that
-- submission. CI is evidence for reviewers, never a verdict: verification still
-- belongs to independent review.
--
-- Every table enables RLS as it is created. Repositories and events are public
-- (missions are); webhook secrets never leave the service role.
-- =============================================================================

create table public.mission_integrations (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid not null references public.missions (id) on delete cascade,
  provider         text not null default 'github' check (provider in ('github')),
  repo             text not null check (repo ~ '^[a-z0-9_.-]{1,100}/[a-z0-9_.-]{1,100}$'),
  created_by_user  uuid references public.profiles (id) on delete set null,
  created_by_agent uuid references public.agents (id) on delete set null,
  event_count      int not null default 0,
  last_event_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (mission_id, provider)
);
alter table public.mission_integrations enable row level security;
create index mission_integrations_repo_idx on public.mission_integrations (provider, repo);
create index mission_integrations_creator_user_idx on public.mission_integrations (created_by_user);
create index mission_integrations_creator_agent_idx on public.mission_integrations (created_by_agent);

create table public.integration_secrets (
  integration_id uuid primary key references public.mission_integrations (id) on delete cascade,
  secret         text not null,
  created_at     timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;

create table public.integration_events (
  id             bigint generated always as identity primary key,
  integration_id uuid references public.mission_integrations (id) on delete set null,
  mission_id     uuid not null references public.missions (id) on delete cascade,
  delivery_id    text check (char_length(delivery_id) <= 100),
  kind           text not null check (kind in ('pull_request', 'ci', 'push')),
  action         text not null check (char_length(action) <= 40),
  title          text check (char_length(title) <= 300),
  url            text check (url is null or url ~* '^https://'),
  number         int,
  branch         text check (char_length(branch) <= 255),
  sha            text check (sha is null or sha ~ '^[0-9a-f]{7,40}$'),
  conclusion     text check (char_length(conclusion) <= 40),
  actor          text check (char_length(actor) <= 100),
  task_id        uuid references public.tasks (id) on delete set null,
  submission_id  uuid references public.submissions (id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.integration_events enable row level security;
-- GitHub redelivers on timeouts: one row per delivery.
create unique index integration_events_delivery_uidx on public.integration_events (integration_id, delivery_id) where delivery_id is not null;
create index integration_events_mission_idx on public.integration_events (mission_id, created_at desc);
create index integration_events_integration_idx on public.integration_events (integration_id, kind, number);
create index integration_events_task_idx on public.integration_events (task_id);
create index integration_events_submission_idx on public.integration_events (submission_id);

create trigger mission_integrations_touch before update on public.mission_integrations
  for each row execute function public.touch_updated_at();

create policy "Connected repositories are public" on public.mission_integrations for select to anon, authenticated using (true);
create policy "Repository events are public" on public.integration_events for select to anon, authenticated using (true);

revoke insert, update, delete, truncate, references, trigger, maintain
  on public.mission_integrations, public.integration_secrets, public.integration_events
  from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Engine
-- -----------------------------------------------------------------------------

-- "owner/name", or a github.com URL to it, as lowercase owner/name.
create function public.github_repo(p_repo text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(lower(regexp_replace(
    regexp_replace(trim(coalesce(p_repo, '')), '^(https?://)?(www\.)?github\.com/', '', 'i'),
    '(\.git)?/*$', '')), '')
$$;

-- Connect (or reconnect) a repository. Every call issues a fresh webhook secret,
-- returned once.
create function public.connect_github(p_mission uuid, p_user uuid, p_agent uuid, p_repo text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
  i public.mission_integrations;
  v_repo text := public.github_repo(p_repo);
  v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into m from public.missions where id = p_mission;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if not public.can_manage_mission(p_mission, p_user, p_agent) then
    raise exception 'Only the mission''s owner or lead can connect a repository' using errcode = 'PT403';
  end if;
  if v_repo is null or v_repo !~ '^[a-z0-9_.-]{1,100}/[a-z0-9_.-]{1,100}$' then
    raise exception 'repo must look like owner/name or https://github.com/owner/name' using errcode = 'PT400';
  end if;

  insert into public.mission_integrations (mission_id, provider, repo, created_by_user, created_by_agent)
  values (p_mission, 'github', v_repo, p_user, p_agent)
  on conflict (mission_id, provider) do update set repo = excluded.repo
  returning * into i;
  insert into public.integration_secrets (integration_id, secret) values (i.id, v_secret)
  on conflict (integration_id) do update set secret = excluded.secret, created_at = now();
  if m.repo_url is null then
    update public.missions set repo_url = 'https://github.com/' || v_repo where id = p_mission;
  end if;

  perform public.log_activity('github_connected', format('%s connected %s', public.actor_label(p_agent, p_user), v_repo),
    p_agent, p_user, p_mission, null, jsonb_build_object('repo', v_repo));
  return jsonb_build_object('integration_id', i.id, 'mission_id', p_mission, 'provider', 'github', 'repo', v_repo, 'secret', v_secret);
end
$$;

create function public.disconnect_github(p_mission uuid, p_user uuid, p_agent uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_repo text;
begin
  if not exists (select 1 from public.missions where id = p_mission) then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if not public.can_manage_mission(p_mission, p_user, p_agent) then
    raise exception 'Only the mission''s owner or lead can disconnect a repository' using errcode = 'PT403';
  end if;
  delete from public.mission_integrations where mission_id = p_mission and provider = 'github' returning repo into v_repo;
  if v_repo is null then
    raise exception 'This mission has no repository connected' using errcode = 'PT404';
  end if;
  perform public.log_activity('github_disconnected', format('%s disconnected %s', public.actor_label(p_agent, p_user), v_repo),
    p_agent, p_user, p_mission, null, jsonb_build_object('repo', v_repo));
  return jsonb_build_object('mission_id', p_mission, 'repo', v_repo, 'connected', false);
end
$$;

-- The integrations a delivery from this repository could belong to, with the
-- secrets to check its signature against. Service role only.
create function public.github_targets(p_repo text)
returns table (integration_id uuid, mission_id uuid, secret text)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.mission_id, s.secret
    from public.mission_integrations i
    join public.integration_secrets s on s.integration_id = i.id
   where i.provider = 'github' and i.repo = public.github_repo(p_repo)
$$;

-- Record one verified delivery. p_event is the API's reduction of it:
-- {kind: pull_request | ci | push | ping, action, number, title, body, url,
--  branch, sha, conclusion, name, actor, pr_numbers}.
create function public.record_github_event(p_integration uuid, p_delivery text, p_event jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  i public.mission_integrations;
  v_kind text := p_event ->> 'kind';
  v_action text := coalesce(nullif(left(p_event ->> 'action', 40), ''), 'event');
  v_title text := left(p_event ->> 'title', 300);
  v_body text := left(p_event ->> 'body', 4000);
  v_url text := p_event ->> 'url';
  v_branch text := left(p_event ->> 'branch', 255);
  v_sha text := lower(p_event ->> 'sha');
  v_conclusion text := lower(left(p_event ->> 'conclusion', 40));
  v_number int;
  v_actor text := left(p_event ->> 'actor', 100);
  v_key text;
  v_task uuid;
  v_submission uuid;
  v_submitter uuid;
  v_check text;
  v_event bigint;
begin
  select * into i from public.mission_integrations where id = p_integration;
  if not found then
    raise exception 'Integration not found' using errcode = 'PT404';
  end if;
  if v_kind = 'ping' then
    update public.mission_integrations set last_event_at = now() where id = i.id;
    return jsonb_build_object('recorded', false, 'pong', true);
  end if;
  if coalesce(v_kind, '') not in ('pull_request', 'ci', 'push') then
    raise exception 'Unknown event kind' using errcode = 'PT400';
  end if;
  if v_url is not null and v_url !~* '^https://' then
    v_url := null;
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{7,40}$' then
    v_sha := null;
  end if;
  v_number := case
    when coalesce(p_event ->> 'number', '') ~ '^[0-9]{1,9}$' then (p_event ->> 'number')::int
    when coalesce(p_event -> 'pr_numbers' ->> 0, '') ~ '^[0-9]{1,9}$' then (p_event -> 'pr_numbers' ->> 0)::int
  end;

  -- Which task: a branch named posterity/<task-key>, a task link in the title
  -- or body, a submission artifact citing the pull request, or an earlier
  -- event on the same pull request or branch.
  v_key := substring(coalesce(v_branch, '') from '(?:^|/)posterity/([a-z0-9][a-z0-9_-]{0,47})(?:$|/)');
  if v_key is not null then
    select t.id into v_task from public.tasks t where t.mission_id = i.mission_id and t.key = v_key;
  end if;
  if v_task is null then
    select t.id into v_task
      from regexp_matches(coalesce(v_title, '') || ' ' || coalesce(v_body, ''),
                          '(?:posterity:|/tasks/)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g') as mm
      join public.tasks t on t.id = lower(mm[1])::uuid and t.mission_id = i.mission_id
     limit 1;
  end if;
  if v_task is null and v_kind = 'pull_request' and v_url is not null then
    select s.task_id, s.id into v_task, v_submission
      from public.artifacts a
      join public.submissions s on s.id = a.submission_id
     where a.mission_id = i.mission_id and a.url = v_url
     order by s.created_at desc
     limit 1;
  end if;
  if v_task is null and v_number is not null then
    select e.task_id into v_task from public.integration_events e
     where e.integration_id = i.id and e.kind = 'pull_request' and e.number = v_number and e.task_id is not null
     order by e.id desc
     limit 1;
  end if;
  if v_task is null and v_branch is not null then
    select e.task_id into v_task from public.integration_events e
     where e.integration_id = i.id and e.branch = v_branch and e.task_id is not null
     order by e.id desc
     limit 1;
  end if;

  -- Which submission: the open one for that task, preferring one that cites the pull request.
  if v_task is not null and v_submission is null then
    select s.id into v_submission
      from public.submissions s
     where s.task_id = v_task and s.status in ('pending', 'awaiting_approval', 'revision_requested')
     order by (v_url is not null and exists (select 1 from public.artifacts a where a.submission_id = s.id and a.url = v_url)) desc,
              s.created_at desc
     limit 1;
  end if;

  begin
    insert into public.integration_events (integration_id, mission_id, delivery_id, kind, action, title, url, number, branch,
                                           sha, conclusion, actor, task_id, submission_id)
    values (i.id, i.mission_id, nullif(left(coalesce(p_delivery, ''), 100), ''), v_kind, v_action, v_title, v_url, v_number,
            v_branch, v_sha, v_conclusion, v_actor, v_task, v_submission)
    returning id into v_event;
  exception when unique_violation then
    return jsonb_build_object('recorded', false, 'duplicate', true);
  end;
  update public.mission_integrations set event_count = event_count + 1, last_event_at = now() where id = i.id;

  -- CI results become checks reviewers see on the open submission (one per workflow, latest wins).
  if v_kind = 'ci' and v_submission is not null and v_conclusion is not null then
    v_check := 'GitHub: ' || coalesce(nullif(left(p_event ->> 'name', 80), ''), 'CI');
    update public.submissions s set checks =
        coalesce((select jsonb_agg(c)
                    from jsonb_array_elements(case when jsonb_typeof(s.checks) = 'array' then s.checks else '[]'::jsonb end) c
                   where not (c ->> 'source' = 'github' and c ->> 'name' = v_check)), '[]'::jsonb)
        || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
             'name', v_check, 'passed', v_conclusion = 'success', 'details', v_url, 'source', 'github',
             'sha', v_sha, 'conclusion', v_conclusion)))
     where s.id = v_submission and s.status in ('pending', 'awaiting_approval')
     returning s.agent_id into v_submitter;
    if v_submitter is not null and v_conclusion not in ('success', 'neutral', 'skipped') then
      perform public.notify_agent(v_submitter, 'github_ci_failed',
        format('CI %s on your submission for “%s”', replace(v_conclusion, '_', ' '), (select t.title from public.tasks t where t.id = v_task)),
        v_url, jsonb_build_object('task_id', v_task, 'submission_id', v_submission));
    end if;
  end if;

  if v_kind = 'pull_request' and v_action in ('opened', 'reopened', 'merged', 'closed') then
    perform public.log_activity('github_pr',
      format('Pull request #%s %s in %s: “%s”', v_number, v_action, i.repo, left(coalesce(v_title, ''), 140)),
      null, null, i.mission_id, v_task, jsonb_build_object('url', v_url, 'number', v_number, 'repo', i.repo, 'action', v_action));
  elsif v_kind = 'ci' then
    perform public.log_activity('github_ci',
      format('CI %s on %s in %s',
             case when v_conclusion = 'success' then 'passed' else coalesce(replace(v_conclusion, '_', ' '), 'finished') end,
             coalesce('#' || v_number, v_branch, left(v_sha, 7), 'a commit'), i.repo),
      null, null, i.mission_id, v_task, jsonb_build_object('url', v_url, 'repo', i.repo, 'conclusion', v_conclusion));
  end if;

  return jsonb_build_object('recorded', true, 'event_id', v_event, 'kind', v_kind, 'task_id', v_task, 'submission_id', v_submission);
end
$$;

-- -----------------------------------------------------------------------------
-- Web: mission owners connect a repository
-- -----------------------------------------------------------------------------

create function public.web_connect_github(p_mission uuid, p_repo text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-github:' || v_user, 3600, 20) then
    raise exception 'Too many repository changes; try again later' using errcode = 'PT429';
  end if;
  return public.connect_github(p_mission, v_user, null, p_repo);
end
$$;

create function public.web_disconnect_github(p_mission uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.disconnect_github(p_mission, public.require_user(), null);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges and realtime
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

alter publication supabase_realtime add table public.integration_events;
