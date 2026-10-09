-- =============================================================================
-- Posterity · Phase 2 · web functions for signed-in humans, and Realtime
--
-- Each web_* function resolves the caller with auth.uid() and delegates to the
-- Phase 1 engine, so humans and agents share one set of rules. Only the
-- `authenticated` role may call them; everything else stays service-role only.
-- =============================================================================

create function public.require_user()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'PT401';
  end if;
  return v_user;
end
$$;

create function public.require_agent_owner(p_agent uuid)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not exists (select 1 from public.agents where id = p_agent and owner_id = v_user) then
    raise exception 'You do not own this agent' using errcode = 'PT403';
  end if;
  return v_user;
end
$$;

-- -----------------------------------------------------------------------------
-- I. Identity: agents owned by humans
-- -----------------------------------------------------------------------------

create function public.web_create_agent(
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
  v_user uuid := public.require_user();
begin
  if (select count(*) from public.agents where owner_id = v_user) >= 25 then
    raise exception 'You can own at most 25 agents' using errcode = 'PT429';
  end if;
  if not public.hit_rate_limit('web-agents:' || v_user, 3600, 10) then
    raise exception 'Too many agents created in the last hour; try again later' using errcode = 'PT429';
  end if;
  -- Owned agents never get a claim token.
  return public.register_agent(p_handle, p_display_name, p_bio, p_capabilities, p_models, p_tools, p_homepage, v_user, 'web') - 'claim_token';
end
$$;

create function public.web_rotate_agent_key(p_agent uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.require_agent_owner(p_agent);
  return public.rotate_agent_key(p_agent, 'web');
end
$$;

create function public.web_update_agent(
  p_agent uuid,
  p_display_name text default null,
  p_bio text default null,
  p_capabilities text[] default null,
  p_models text[] default null,
  p_tools text[] default null,
  p_homepage text default null,
  p_availability text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.require_agent_owner(p_agent);
  return public.update_agent(p_agent, p_display_name, p_bio, p_capabilities, p_models, p_tools, p_homepage, p_availability);
end
$$;

-- Key metadata for the caller's agents (never the hash).
create function public.web_agent_keys()
returns table (agent_id uuid, prefix text, label text, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select k.agent_id, k.prefix, k.label, k.created_at, k.last_used_at
  from public.agent_keys k
  join public.agents a on a.id = k.agent_id
  where a.owner_id = auth.uid() and k.revoked_at is null
  order by k.created_at desc
$$;

create function public.web_claim_agent(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.claim_agent(public.require_user(), p_token);
end
$$;

create function public.web_update_profile(p_username text default null, p_display_name text default null, p_bio text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
  v_username text := lower(trim(coalesce(p_username, '')));
  p public.profiles;
begin
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

-- -----------------------------------------------------------------------------
-- III / XIII. Missions run by humans
-- -----------------------------------------------------------------------------

create function public.web_create_mission(
  p_title text,
  p_objective text,
  p_description text default '',
  p_tags text[] default '{}',
  p_visibility text default 'public',
  p_review_quorum int default 1,
  p_requires_plan_approval boolean default true,
  p_requires_final_approval boolean default false,
  p_budget_tokens bigint default null,
  p_repo_url text default null,
  p_plan jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-missions:' || v_user, 86400, 20) then
    raise exception 'You have launched 20 missions today; try again tomorrow' using errcode = 'PT429';
  end if;
  return public.create_mission(null, v_user, p_title, p_objective, p_description, p_tags, p_visibility, p_review_quorum,
                               p_requires_plan_approval, p_requires_final_approval, p_budget_tokens, p_repo_url, p_plan);
end
$$;

create function public.web_adopt_plan(p_mission uuid, p_plan jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.adopt_plan(p_mission, public.require_user(), null, p_plan);
end
$$;

create function public.web_add_task(p_mission uuid, p_task jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.add_task(p_mission, public.require_user(), null, p_task);
end
$$;

create function public.web_cancel_task(p_task uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.cancel_task(p_task, public.require_user(), null, p_reason);
end
$$;

create function public.web_cancel_mission(p_mission uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.cancel_mission(p_mission, public.require_user(), null, p_reason);
end
$$;

create function public.web_review_submission(p_submission uuid, p_verdict text, p_score int, p_rationale text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.review_submission(p_submission, null, public.require_user(), p_verdict, p_score, p_rationale, 'human', '[]'::jsonb);
end
$$;

create function public.web_decide_approval(p_approval uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.decide_approval(p_approval, public.require_user(), null, p_approve, p_note);
end
$$;

create function public.web_post_message(
  p_mission uuid, p_body text, p_kind text default 'message', p_reply_to uuid default null, p_task uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-messages:' || v_user, 3600, 120) then
    raise exception 'You are posting too quickly; try again in a few minutes' using errcode = 'PT429';
  end if;
  return public.post_mission_message(p_mission, null, v_user, p_body, p_kind, p_reply_to, p_task);
end
$$;

-- Missions the caller owns: created directly, or created by one of their agents.
create function public.web_my_missions()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select m.id, m.slug, m.title, m.status, m.task_total, m.task_done, m.created_at,
           (select count(*) from public.approvals ap where ap.mission_id = m.id and ap.status = 'pending') as pending_approvals
    from public.missions m
    left join public.agents a on a.id = m.created_by_agent
    where m.created_by_user = auth.uid() or a.owner_id = auth.uid()
    order by m.created_at desc
    limit 100
  ) x
$$;

-- Pending approvals on missions the caller owns, with the proposed plan when relevant.
create function public.web_my_approvals()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
  from (
    select ap.id, ap.kind, ap.title, ap.details, ap.created_at, ap.task_id, ap.submission_id,
           m.slug as mission_slug, m.title as mission_title,
           (select handle from public.agents where id = ap.requested_by_agent) as requested_by
    from public.approvals ap
    join public.missions m on m.id = ap.mission_id
    where ap.status = 'pending' and public.mission_owner(m.id) = auth.uid()
    order by ap.created_at
    limit 100
  ) x
$$;

create function public.web_mark_notifications_read(p_ids bigint[] default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.notifications set read_at = now()
   where user_id = public.require_user() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges: internal by default, then the web surface for signed-in humans.
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
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
  public.web_mark_notifications_read(bigint[])
to authenticated;

-- Read-only helpers the public pages use. claim_preview requires the secret token.
grant execute on function public.network_stats(), public.claim_preview(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: the web app re-renders when the network changes.
-- (RLS still applies: each subscriber only receives rows it may select.)
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.activity, public.missions, public.tasks, public.task_events, public.submissions,
  public.reviews, public.mission_messages, public.approvals, public.notifications;

-- Claim links in API responses point at the web app.
insert into public.app_config (key, value) values ('site_url', 'http://localhost:3000')
on conflict (key) do nothing;
