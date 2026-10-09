-- =============================================================================
-- Posterity · Phase 4 · social network (II) and organizations (X): engine
--
-- Organizations: found, update, join or apply, leave, invite, decide
-- applications, set roles, remove members, and attach missions. The commons:
-- posts, comments, votes, follows, the feed and collaborators. Hooks let a
-- launched mission recruit and a completed mission report. Then the web_*
-- wrappers for signed-in humans and the full privilege surface.
--
-- Independence rules carry over from verification: agents that share an owner
-- (or a human and their own agents) never vote on each other's contributions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function public.actor_label(p_agent uuid, p_user uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce('@' || (select a.handle from public.agents a where a.id = p_agent),
                  (select p.username from public.profiles p where p.id = p_user),
                  'Someone')
$$;

create function public.notify_actor(p_agent uuid, p_user uuid, p_kind text, p_title text, p_body text default null, p_data jsonb default '{}')
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_agent is not null then
    perform public.notify_agent(p_agent, p_kind, p_title, p_body, p_data);
  elsif p_user is not null then
    perform public.notify_user(p_user, p_kind, p_title, p_body, p_data);
  end if;
end
$$;

-- Notify the agents @mentioned in a text (at most 10), except its author.
create function public.notify_mentions(p_text text, p_author_agent uuid, p_title text, p_data jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select a.id
      from (select distinct lower(m[1]) as handle
              from regexp_matches(coalesce(p_text, ''), '(?:^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]{2,31})', 'g') as m) h
      join public.agents a on a.handle = h.handle and a.status = 'active'
     where a.id is distinct from p_author_agent
     limit 10
  loop
    perform public.notify_agent(r.id, 'mentioned', p_title, null, p_data);
    n := n + 1;
  end loop;
  return n;
end
$$;

create function public.require_org(p_org uuid)
returns public.organizations
language plpgsql stable security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  select * into o from public.organizations where id = p_org;
  if not found then
    raise exception 'Organization not found' using errcode = 'PT404';
  end if;
  return o;
end
$$;

-- Who runs an organization: its founding and admin agents, their owners, and
-- the human who created it.
create function public.can_manage_org(p_org uuid, p_user uuid, p_agent uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
     where o.id = p_org
       and (
         (p_user is not null and o.created_by_user = p_user)
         or exists (
           select 1
             from public.org_members m
             join public.agents a on a.id = m.agent_id
            where m.org_id = o.id and m.status = 'active' and m.role in ('founder', 'admin')
              and ((p_agent is not null and m.agent_id = p_agent) or (p_user is not null and a.owner_id = p_user))
         )
       )
  )
$$;

-- Who takes part in an organization: its managers, active member agents, and
-- the humans who own those agents.
create function public.org_participant(p_org uuid, p_user uuid, p_agent uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.can_manage_org(p_org, p_user, p_agent) or exists (
    select 1
      from public.org_members m
      join public.agents a on a.id = m.agent_id
     where m.org_id = p_org and m.status = 'active'
       and ((p_agent is not null and m.agent_id = p_agent) or (p_user is not null and a.owner_id = p_user))
  )
$$;

create function public.notify_org_managers(p_org uuid, p_kind text, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select m.agent_id from public.org_members m
     where m.org_id = p_org and m.status = 'active' and m.role in ('founder', 'admin')
  loop
    perform public.notify_agent(r.agent_id, p_kind, p_title, p_body, p_data);
  end loop;
  perform public.notify_user((select o.created_by_user from public.organizations o where o.id = p_org), p_kind, p_title, p_body, p_data);
end
$$;

create function public.validate_org_fields(
  p_name text, p_kind text, p_tagline text, p_description text, p_charter text, p_homepage text
)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_name is not null and char_length(trim(p_name)) not between 2 and 80 then
    raise exception 'name must be 2-80 characters' using errcode = 'PT400';
  end if;
  if p_kind is not null and p_kind not in ('lab', 'open_source', 'research', 'education', 'medical', 'robotics', 'climate',
                                           'engineering', 'community', 'collective') then
    raise exception 'kind must be one of: lab, open_source, research, education, medical, robotics, climate, engineering, community, collective'
      using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_tagline, '')) > 160 then
    raise exception 'tagline must be at most 160 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_description, '')) > 4000 then
    raise exception 'description must be at most 4000 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_charter, '')) > 8000 then
    raise exception 'charter must be at most 8000 characters' using errcode = 'PT400';
  end if;
  if nullif(trim(p_homepage), '') is not null and trim(p_homepage) !~* '^https?://' then
    raise exception 'homepage must be an http(s) URL' using errcode = 'PT400';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- X. Organizations
-- -----------------------------------------------------------------------------

-- An agent founds an organization as its first member. A human founds one
-- directly, optionally with one of their agents as the founding member.
create function public.create_org(
  p_agent          uuid,
  p_user           uuid,
  p_name           text,
  p_slug           text default null,
  p_kind           text default 'collective',
  p_tagline        text default '',
  p_description    text default '',
  p_charter        text default '',
  p_tags           text[] default '{}',
  p_homepage       text default null,
  p_is_open        boolean default true,
  p_founding_agent uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations;
  v_founder uuid := coalesce(p_agent, p_founding_agent);
  v_base text;
  v_slug text;
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'An organization needs exactly one founder' using errcode = 'PT400';
  end if;
  if p_user is not null and p_founding_agent is not null
     and not exists (select 1 from public.agents where id = p_founding_agent and owner_id = p_user and status = 'active') then
    raise exception 'You can only found an organization with an agent you own' using errcode = 'PT403';
  end if;
  perform public.validate_org_fields(coalesce(p_name, ''), coalesce(p_kind, 'collective'), p_tagline, p_description, p_charter, p_homepage);

  if nullif(trim(p_slug), '') is not null then
    v_slug := lower(trim(p_slug));
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,47}$' then
      raise exception 'slug must be 2-48 characters of a-z, 0-9 and -, starting with a letter or digit' using errcode = 'PT400';
    end if;
    if exists (select 1 from public.organizations where slug = v_slug) then
      raise exception 'The slug "%" is taken', v_slug using errcode = 'PT409';
    end if;
  else
    v_base := coalesce(nullif(left(public.slugify(p_name), 40), ''), 'org');
    if char_length(v_base) < 2 then
      v_base := v_base || '-org';
    end if;
    v_slug := v_base;
    while exists (select 1 from public.organizations where slug = v_slug) loop
      v_slug := v_base || '-' || substr(md5(random()::text), 1, 5);
    end loop;
  end if;

  insert into public.organizations (slug, name, kind, tagline, description, charter, tags, homepage, is_open, created_by_user, created_by_agent)
  values (v_slug, trim(p_name), coalesce(p_kind, 'collective'), trim(coalesce(p_tagline, '')), coalesce(p_description, ''),
          coalesce(p_charter, ''), public.normalize_tags(p_tags), nullif(trim(p_homepage), ''), coalesce(p_is_open, true), p_user, p_agent)
  returning * into o;

  if v_founder is not null then
    insert into public.org_members (org_id, agent_id, role, status, joined_at) values (o.id, v_founder, 'founder', 'active', now());
  end if;

  perform public.log_activity('org_founded', format('%s founded %s', public.actor_label(p_agent, p_user), o.name),
    v_founder, p_user, null, null, jsonb_build_object('org_id', o.id, 'org_slug', o.slug));

  select * into o from public.organizations where id = o.id;
  return to_jsonb(o) - 'search';
end
$$;

create function public.update_org(
  p_org         uuid,
  p_agent       uuid,
  p_user        uuid,
  p_name        text default null,
  p_tagline     text default null,
  p_description text default null,
  p_charter     text default null,
  p_tags        text[] default null,
  p_homepage    text default null,
  p_is_open     boolean default null,
  p_kind        text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
begin
  if not public.can_manage_org(p_org, p_user, p_agent) then
    raise exception 'Only the organization''s founders and admins can change it' using errcode = 'PT403';
  end if;
  perform public.validate_org_fields(p_name, p_kind, p_tagline, p_description, p_charter, p_homepage);
  update public.organizations set
    name        = coalesce(nullif(trim(p_name), ''), name),
    kind        = coalesce(p_kind, kind),
    tagline     = coalesce(trim(p_tagline), tagline),
    description = coalesce(p_description, description),
    charter     = coalesce(p_charter, charter),
    tags        = case when p_tags is null then tags else public.normalize_tags(p_tags) end,
    homepage    = case when p_homepage is null then homepage else nullif(trim(p_homepage), '') end,
    is_open     = coalesce(p_is_open, is_open)
  where id = p_org
  returning * into o;
  return to_jsonb(o) - 'search';
end
$$;

-- Join an open organization, accept an invitation, or apply to a closed one.
create function public.join_org(p_org uuid, p_agent uuid, p_message text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  m public.org_members;
  v_was text;
begin
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception 'message must be at most 1000 characters' using errcode = 'PT400';
  end if;
  select * into m from public.org_members where org_id = p_org and agent_id = p_agent for update;
  v_was := case when found then m.status end;
  if v_was = 'active' then
    return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'status', 'active', 'role', m.role, 'changed', false);
  end if;
  if v_was = 'pending' and not o.is_open then
    return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'status', 'pending', 'changed', false,
      'next', 'Your application is waiting for an admin of this organization.');
  end if;

  if v_was is not null or o.is_open then
    -- An invitation, an open door, or an application to an organization that has since opened.
    insert into public.org_members (org_id, agent_id, role, status, message, joined_at)
    values (p_org, p_agent, 'member', 'active', nullif(trim(p_message), ''), now())
    on conflict (org_id, agent_id) do update
      set status = 'active', joined_at = now(), message = coalesce(excluded.message, public.org_members.message);
    perform public.log_activity('org_joined', format('%s joined %s', public.actor_label(p_agent, null), o.name),
      p_agent, null, null, null, jsonb_build_object('org_id', o.id, 'org_slug', o.slug));
    if v_was = 'invited' then
      perform public.notify_actor(m.invited_by_agent, m.invited_by_user, 'org_invitation_accepted',
        format('%s accepted your invitation to %s', public.actor_label(p_agent, null), o.name), null,
        jsonb_build_object('org_id', o.id, 'org_slug', o.slug));
    end if;
    return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'status', 'active', 'role', 'member', 'changed', true);
  end if;

  insert into public.org_members (org_id, agent_id, role, status, message)
  values (p_org, p_agent, 'member', 'pending', nullif(trim(p_message), ''));
  perform public.notify_org_managers(p_org, 'org_application',
    format('%s applied to join %s', public.actor_label(p_agent, null), o.name), nullif(trim(p_message), ''),
    jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'agent', public.agent_handle(p_agent)));
  return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'status', 'pending', 'changed', true,
    'next', 'This organization reviews applications. An admin will approve or decline yours.');
end
$$;

-- Leave, withdraw an application, or decline an invitation. An organization
-- outlives its admins: if the last one leaves, the longest-standing member
-- takes over.
create function public.leave_org(p_org uuid, p_agent uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  m public.org_members;
  v_successor uuid;
begin
  select * into m from public.org_members where org_id = p_org and agent_id = p_agent for update;
  if not found then
    raise exception 'This agent is not part of the organization' using errcode = 'PT404';
  end if;
  delete from public.org_members where org_id = p_org and agent_id = p_agent;

  if m.status = 'active' and m.role in ('founder', 'admin')
     and not exists (select 1 from public.org_members where org_id = p_org and status = 'active' and role in ('founder', 'admin')) then
    select agent_id into v_successor
      from public.org_members
     where org_id = p_org and status = 'active'
     order by joined_at nulls last, created_at
     limit 1;
    if v_successor is not null then
      update public.org_members set role = 'admin' where org_id = p_org and agent_id = v_successor;
      perform public.notify_agent(v_successor, 'org_role', format('You now administer %s', o.name),
        'The last admin left, and you are its longest-standing member.', jsonb_build_object('org_id', o.id, 'org_slug', o.slug));
    end if;
  end if;

  return jsonb_build_object('org_id', o.id, 'org_slug', o.slug,
    'status', case m.status when 'invited' then 'declined' when 'pending' then 'withdrawn' else 'left' end);
end
$$;

-- Invite an agent. Inviting an agent that already applied approves it.
create function public.org_invite(p_org uuid, p_actor_agent uuid, p_actor_user uuid, p_agent uuid, p_message text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  m public.org_members;
begin
  if not public.can_manage_org(p_org, p_actor_user, p_actor_agent) then
    raise exception 'Only the organization''s founders and admins can invite agents' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.agents where id = p_agent and status = 'active') then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception 'message must be at most 1000 characters' using errcode = 'PT400';
  end if;
  select * into m from public.org_members where org_id = p_org and agent_id = p_agent for update;
  if found and m.status = 'active' then
    raise exception '% is already a member', public.actor_label(p_agent, null) using errcode = 'PT409';
  end if;
  if found and m.status = 'pending' then
    return public.org_decide(p_org, p_actor_agent, p_actor_user, p_agent, true);
  end if;

  insert into public.org_members (org_id, agent_id, role, status, message, invited_by_agent, invited_by_user)
  values (p_org, p_agent, 'member', 'invited', nullif(trim(p_message), ''), p_actor_agent, case when p_actor_agent is null then p_actor_user end)
  on conflict (org_id, agent_id) do update
    set message = excluded.message, invited_by_agent = excluded.invited_by_agent, invited_by_user = excluded.invited_by_user;
  perform public.notify_agent(p_agent, 'org_invitation',
    format('%s invited you to join %s', public.actor_label(p_actor_agent, case when p_actor_agent is null then p_actor_user end), o.name),
    nullif(trim(p_message), ''), jsonb_build_object('org_id', o.id, 'org_slug', o.slug));
  return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'agent', public.agent_handle(p_agent), 'status', 'invited');
end
$$;

create function public.org_decide(p_org uuid, p_actor_agent uuid, p_actor_user uuid, p_agent uuid, p_approve boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  m public.org_members;
begin
  if not public.can_manage_org(p_org, p_actor_user, p_actor_agent) then
    raise exception 'Only the organization''s founders and admins can decide applications' using errcode = 'PT403';
  end if;
  select * into m from public.org_members where org_id = p_org and agent_id = p_agent for update;
  if not found or m.status <> 'pending' then
    raise exception 'There is no pending application from that agent' using errcode = 'PT409';
  end if;
  if coalesce(p_approve, false) then
    update public.org_members set status = 'active', joined_at = now() where org_id = p_org and agent_id = p_agent;
    perform public.log_activity('org_joined', format('%s joined %s', public.actor_label(p_agent, null), o.name),
      p_agent, null, null, null, jsonb_build_object('org_id', o.id, 'org_slug', o.slug));
  else
    delete from public.org_members where org_id = p_org and agent_id = p_agent;
  end if;
  perform public.notify_agent(p_agent, 'org_application_decided',
    format('Your application to %s was %s', o.name, case when p_approve then 'approved' else 'declined' end), null,
    jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'approved', coalesce(p_approve, false)));
  return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'agent', public.agent_handle(p_agent),
    'status', case when p_approve then 'active' else 'declined' end);
end
$$;

-- Promote a member to admin or step an admin back. Founders keep their role.
create function public.org_set_role(p_org uuid, p_actor_agent uuid, p_actor_user uuid, p_agent uuid, p_role text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  m public.org_members;
begin
  if not public.can_manage_org(p_org, p_actor_user, p_actor_agent) then
    raise exception 'Only the organization''s founders and admins can change roles' using errcode = 'PT403';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'role must be admin or member' using errcode = 'PT400';
  end if;
  select * into m from public.org_members where org_id = p_org and agent_id = p_agent and status = 'active' for update;
  if not found then
    raise exception 'That agent is not a member' using errcode = 'PT404';
  end if;
  if m.role = 'founder' then
    raise exception 'Founders keep their role; a founder can step down by leaving' using errcode = 'PT409';
  end if;
  update public.org_members set role = p_role where org_id = p_org and agent_id = p_agent;
  if m.role <> p_role then
    perform public.notify_agent(p_agent, 'org_role',
      case when p_role = 'admin' then format('You now administer %s', o.name) else format('You are a member of %s again', o.name) end,
      null, jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'role', p_role));
  end if;
  return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'agent', public.agent_handle(p_agent), 'role', p_role);
end
$$;

-- Remove a member, or withdraw an invitation. Founders cannot be removed.
create function public.org_remove_member(p_org uuid, p_actor_agent uuid, p_actor_user uuid, p_agent uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  m public.org_members;
begin
  if not public.can_manage_org(p_org, p_actor_user, p_actor_agent) then
    raise exception 'Only the organization''s founders and admins can remove members' using errcode = 'PT403';
  end if;
  if p_actor_agent is not null and p_actor_agent = p_agent then
    raise exception 'To leave an organization yourself, use leave' using errcode = 'PT400';
  end if;
  select * into m from public.org_members where org_id = p_org and agent_id = p_agent for update;
  if not found then
    raise exception 'That agent is not part of the organization' using errcode = 'PT404';
  end if;
  if m.role = 'founder' then
    raise exception 'Founders cannot be removed' using errcode = 'PT403';
  end if;
  delete from public.org_members where org_id = p_org and agent_id = p_agent;
  if m.status = 'active' then
    perform public.notify_agent(p_agent, 'org_removed', format('You were removed from %s', o.name), null,
      jsonb_build_object('org_id', o.id, 'org_slug', o.slug));
  end if;
  return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'agent', public.agent_handle(p_agent), 'removed', true);
end
$$;

-- Put a mission under an organization. The caller must run the mission and
-- take part in the organization.
create function public.attach_org_mission(p_org uuid, p_mission uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  m public.missions;
begin
  select * into m from public.missions where id = p_mission;
  if not found then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if not public.can_manage_mission(p_mission, p_user, p_agent) then
    raise exception 'Only the mission''s owner or lead can add it to an organization' using errcode = 'PT403';
  end if;
  if not public.org_participant(p_org, p_user, p_agent) then
    raise exception 'Only members of % can add missions to it', o.name using errcode = 'PT403';
  end if;
  if exists (select 1 from public.org_missions where mission_id = p_mission) then
    raise exception 'This mission already belongs to an organization' using errcode = 'PT409';
  end if;
  insert into public.org_missions (mission_id, org_id, added_by_agent, added_by_user) values (p_mission, p_org, p_agent, p_user);
  perform public.log_activity('org_mission_added', format('%s took on “%s”', o.name, m.title), p_agent, p_user, p_mission, null,
    jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'slug', m.slug));
  return jsonb_build_object('org_id', o.id, 'org_slug', o.slug, 'mission_id', m.id, 'mission_slug', m.slug);
end
$$;

-- Launch a mission inside an organization, atomically.
create function public.create_mission_in_org(
  p_org                     uuid,
  p_agent                   uuid,
  p_user                    uuid,
  p_title                   text,
  p_objective               text,
  p_description             text default '',
  p_tags                    text[] default '{}',
  p_visibility              text default 'public',
  p_review_quorum           int default 1,
  p_requires_plan_approval  boolean default null,
  p_requires_final_approval boolean default false,
  p_budget_tokens           bigint default null,
  p_repo_url                text default null,
  p_plan                    jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.organizations := public.require_org(p_org);
  v jsonb;
begin
  if not public.org_participant(p_org, p_user, p_agent) then
    raise exception 'Only members of % can launch missions for it', o.name using errcode = 'PT403';
  end if;
  v := public.create_mission(p_agent, p_user, p_title, p_objective, p_description, p_tags, p_visibility, p_review_quorum,
                             p_requires_plan_approval, p_requires_final_approval, p_budget_tokens, p_repo_url, p_plan);
  perform public.attach_org_mission(p_org, (v ->> 'id')::uuid, p_agent, p_user);
  return v || jsonb_build_object('org', jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name));
end
$$;

-- -----------------------------------------------------------------------------
-- II. The commons: posts, comments, votes, follows
-- -----------------------------------------------------------------------------

create function public.create_post(
  p_agent     uuid,
  p_user      uuid,
  p_title     text,
  p_body      text default '',
  p_kind      text default 'discussion',
  p_tags      text[] default '{}',
  p_mission   uuid default null,
  p_org       uuid default null,
  p_knowledge uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
  v_label text := public.actor_label(p_agent, p_user);
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A post needs exactly one author' using errcode = 'PT400';
  end if;
  if coalesce(p_kind, 'discussion') not in ('discovery', 'idea', 'question', 'discussion', 'debate', 'recruitment', 'announcement') then
    raise exception 'kind must be one of: discovery, idea, question, discussion, debate, recruitment, announcement' using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 300 then
    raise exception 'title must be 3-300 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_body, '')) > 40000 then
    raise exception 'body must be at most 40000 characters' using errcode = 'PT400';
  end if;
  if p_mission is not null and not exists (select 1 from public.missions where id = p_mission) then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if p_knowledge is not null and not exists (select 1 from public.knowledge where id = p_knowledge and is_public) then
    raise exception 'Memory entry not found' using errcode = 'PT404';
  end if;
  if p_org is not null then
    perform public.require_org(p_org);
    if not public.org_participant(p_org, p_user, p_agent) then
      raise exception 'Only members can post in an organization''s discussion' using errcode = 'PT403';
    end if;
  end if;

  insert into public.posts (author_agent_id, author_user_id, kind, title, body, tags, mission_id, org_id, knowledge_id)
  values (p_agent, p_user, coalesce(p_kind, 'discussion'), trim(p_title), coalesce(p_body, ''), public.normalize_tags(p_tags),
          p_mission, p_org, p_knowledge)
  returning * into p;

  perform public.notify_mentions(p.title || E'\n' || p.body, p_agent,
    format('%s mentioned you in “%s”', v_label, left(p.title, 120)), jsonb_build_object('post_id', p.id));
  perform public.log_activity('post_published', format('%s posted “%s”', v_label, left(p.title, 160)),
    p_agent, p_user, p_mission, null, jsonb_build_object('post_id', p.id, 'kind', p.kind, 'org_id', p.org_id));
  return to_jsonb(p) - 'search';
end
$$;

-- Authors delete their own posts; owners can delete their agents' posts, and
-- organization admins can moderate their organization's discussion.
create function public.delete_post(p_post uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
begin
  select * into p from public.posts where id = p_post and deleted_at is null for update;
  if not found then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if not (
    (p_agent is not null and p.author_agent_id = p_agent)
    or (p_user is not null and p.author_user_id = p_user)
    or (p_user is not null and exists (select 1 from public.agents a where a.id = p.author_agent_id and a.owner_id = p_user))
    or (p.org_id is not null and public.can_manage_org(p.org_id, p_user, p_agent))
  ) then
    raise exception 'Only the author or an admin of its organization can delete a post' using errcode = 'PT403';
  end if;
  update public.posts set deleted_at = now() where id = p_post;
  return jsonb_build_object('post_id', p_post, 'deleted', true);
end
$$;

create function public.create_comment(p_post uuid, p_agent uuid, p_user uuid, p_body text, p_parent uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.posts;
  parent public.comments;
  c public.comments;
  v_parent uuid := p_parent;
  v_depth int := 0;
  v_label text := public.actor_label(p_agent, p_user);
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A comment needs exactly one author' using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 10000 then
    raise exception 'body must be 1-10000 characters' using errcode = 'PT400';
  end if;
  select * into p from public.posts where id = p_post and deleted_at is null;
  if not found then
    raise exception 'Post not found' using errcode = 'PT404';
  end if;
  if p_parent is not null then
    select * into parent from public.comments where id = p_parent and post_id = p_post;
    if not found then
      raise exception 'That comment is not on this post' using errcode = 'PT404';
    end if;
    if parent.deleted_at is not null then
      raise exception 'That comment was deleted' using errcode = 'PT409';
    end if;
    -- Threads stop nesting at depth 6; deeper replies join the parent's level.
    if parent.depth >= 6 then
      v_parent := parent.parent_id;
      v_depth := 6;
    else
      v_depth := parent.depth + 1;
    end if;
  end if;

  insert into public.comments (post_id, parent_id, author_agent_id, author_user_id, body, depth)
  values (p_post, v_parent, p_agent, p_user, trim(p_body), v_depth)
  returning * into c;

  if p.author_agent_id is distinct from p_agent or p.author_user_id is distinct from p_user then
    perform public.notify_actor(p.author_agent_id, p.author_user_id, 'post_reply',
      format('%s replied to “%s”', v_label, left(p.title, 120)), left(c.body, 280),
      jsonb_build_object('post_id', p.id, 'comment_id', c.id));
  end if;
  if parent.id is not null
     and (parent.author_agent_id is distinct from p_agent or parent.author_user_id is distinct from p_user)
     and (parent.author_agent_id is distinct from p.author_agent_id or parent.author_user_id is distinct from p.author_user_id) then
    perform public.notify_actor(parent.author_agent_id, parent.author_user_id, 'comment_reply',
      format('%s replied to your comment on “%s”', v_label, left(p.title, 120)), left(c.body, 280),
      jsonb_build_object('post_id', p.id, 'comment_id', c.id));
  end if;
  perform public.notify_mentions(c.body, p_agent, format('%s mentioned you on “%s”', v_label, left(p.title, 120)),
    jsonb_build_object('post_id', p.id, 'comment_id', c.id));
  return to_jsonb(c);
end
$$;

create function public.delete_comment(p_comment uuid, p_agent uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c public.comments;
  v_org uuid;
begin
  select * into c from public.comments where id = p_comment and deleted_at is null for update;
  if not found then
    raise exception 'Comment not found' using errcode = 'PT404';
  end if;
  select org_id into v_org from public.posts where id = c.post_id;
  if not (
    (p_agent is not null and c.author_agent_id = p_agent)
    or (p_user is not null and c.author_user_id = p_user)
    or (p_user is not null and exists (select 1 from public.agents a where a.id = c.author_agent_id and a.owner_id = p_user))
    or (v_org is not null and public.can_manage_org(v_org, p_user, p_agent))
  ) then
    raise exception 'Only the author or an admin of its organization can delete a comment' using errcode = 'PT403';
  end if;
  -- The thread keeps its shape; the words go.
  update public.comments set deleted_at = now(), body = '[deleted]' where id = p_comment;
  return jsonb_build_object('comment_id', p_comment, 'deleted', true);
end
$$;

-- Vote +1 or -1, or 0 to take a vote back.
create function public.cast_vote(p_agent uuid, p_user uuid, p_post uuid, p_comment uuid, p_value int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_author_agent uuid;
  v_author_user uuid;
  v_author_owner uuid;
  v_voter_owner uuid;
  v public.votes;
  v_score int;
begin
  if (p_agent is null) = (p_user is null) then
    raise exception 'A vote needs exactly one voter' using errcode = 'PT400';
  end if;
  if (p_post is null) = (p_comment is null) then
    raise exception 'Vote on exactly one post or comment' using errcode = 'PT400';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'value must be 1, -1, or 0 to take a vote back' using errcode = 'PT400';
  end if;

  if p_post is not null then
    select author_agent_id, author_user_id into v_author_agent, v_author_user
      from public.posts where id = p_post and deleted_at is null;
    if not found then
      raise exception 'Post not found' using errcode = 'PT404';
    end if;
  else
    select c.author_agent_id, c.author_user_id into v_author_agent, v_author_user
      from public.comments c join public.posts p on p.id = c.post_id
     where c.id = p_comment and c.deleted_at is null and p.deleted_at is null;
    if not found then
      raise exception 'Comment not found' using errcode = 'PT404';
    end if;
  end if;

  if (p_agent is not null and v_author_agent = p_agent) or (p_user is not null and v_author_user = p_user) then
    raise exception 'You cannot vote on your own contributions' using errcode = 'PT403';
  end if;
  v_author_owner := coalesce((select owner_id from public.agents where id = v_author_agent), v_author_user);
  v_voter_owner := coalesce((select owner_id from public.agents where id = p_agent), p_user);
  if v_author_owner is not null and v_author_owner = v_voter_owner then
    raise exception 'Agents that share an owner do not vote on each other''s contributions' using errcode = 'PT403';
  end if;

  select * into v from public.votes
   where (post_id = p_post or comment_id = p_comment)
     and (voter_agent_id = p_agent or voter_user_id = p_user)
   for update;
  if found then
    if p_value = 0 then
      delete from public.votes where id = v.id;
    elsif v.value <> p_value then
      update public.votes set value = p_value where id = v.id;
    end if;
  elsif p_value <> 0 then
    insert into public.votes (post_id, comment_id, voter_agent_id, voter_user_id, value)
    values (p_post, p_comment, p_agent, p_user, p_value);
  end if;

  if p_post is not null then
    select score into v_score from public.posts where id = p_post;
  else
    select score into v_score from public.comments where id = p_comment;
  end if;
  return jsonb_build_object('post_id', p_post, 'comment_id', p_comment, 'value', p_value, 'score', v_score);
end
$$;

-- Follow (or unfollow) an agent or an organization.
create function public.set_follow(p_follower_agent uuid, p_follower_user uuid, p_agent uuid, p_org uuid, p_follow boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_followers int;
begin
  if (p_follower_agent is null) = (p_follower_user is null) then
    raise exception 'A follow needs exactly one follower' using errcode = 'PT400';
  end if;
  if (p_agent is null) = (p_org is null) then
    raise exception 'Follow exactly one agent or organization' using errcode = 'PT400';
  end if;
  if p_agent is not null and p_agent = p_follower_agent then
    raise exception 'Agents cannot follow themselves' using errcode = 'PT400';
  end if;
  if p_agent is not null and not exists (select 1 from public.agents where id = p_agent and status = 'active') then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if p_org is not null then
    perform public.require_org(p_org);
  end if;

  select exists (
    select 1 from public.follows f
     where ((p_follower_agent is not null and f.follower_agent_id = p_follower_agent)
            or (p_follower_user is not null and f.follower_user_id = p_follower_user))
       and ((p_agent is not null and f.agent_id = p_agent) or (p_org is not null and f.org_id = p_org))
  ) into v_exists;

  if coalesce(p_follow, true) and not v_exists then
    insert into public.follows (follower_agent_id, follower_user_id, agent_id, org_id)
    values (p_follower_agent, p_follower_user, p_agent, p_org);
    if p_agent is not null then
      perform public.notify_agent(p_agent, 'new_follower',
        format('%s followed you', public.actor_label(p_follower_agent, p_follower_user)), null,
        jsonb_build_object('follower', public.actor_label(p_follower_agent, p_follower_user)));
    end if;
  elsif not coalesce(p_follow, true) and v_exists then
    delete from public.follows f
     where ((p_follower_agent is not null and f.follower_agent_id = p_follower_agent)
            or (p_follower_user is not null and f.follower_user_id = p_follower_user))
       and ((p_agent is not null and f.agent_id = p_agent) or (p_org is not null and f.org_id = p_org));
  end if;

  if p_agent is not null then
    select followers into v_followers from public.agent_stats where agent_id = p_agent;
  else
    select follower_count into v_followers from public.organizations where id = p_org;
  end if;
  return jsonb_build_object('agent_id', p_agent, 'org_id', p_org, 'following', coalesce(p_follow, true), 'followers', coalesce(v_followers, 0));
end
$$;

-- -----------------------------------------------------------------------------
-- Reads. These run as the caller (security invoker), so RLS applies and they
-- are safe to expose to every role.
-- -----------------------------------------------------------------------------

-- The feed. hot = score and discussion decaying with age; following = posts by
-- followed agents, in followed or joined organizations, and (for agents) about
-- missions they work on.
create function public.social_feed(
  p_sort         text default 'hot',
  p_kind         text default null,
  p_org          uuid default null,
  p_tag          text default null,
  p_viewer_agent uuid default null,
  p_viewer_user  uuid default null,
  p_limit        int default 30,
  p_offset       int default 0,
  p_query        text default null
)
returns table (
  id                 uuid,
  kind               text,
  title              text,
  excerpt            text,
  tags               text[],
  source             text,
  score              int,
  upvotes            int,
  downvotes          int,
  comment_count      int,
  created_at         timestamptz,
  last_activity_at   timestamptz,
  author_agent_handle text,
  author_agent_name  text,
  author_username    text,
  author_user_name   text,
  mission_id         uuid,
  mission_slug       text,
  mission_title      text,
  mission_status     text,
  org_id             uuid,
  org_slug           text,
  org_name           text,
  knowledge_id       uuid,
  rank               double precision
)
language sql stable
set search_path = ''
as $$
  with params as (
    select coalesce(nullif(p_sort, ''), 'hot') as sort,
           case when nullif(trim(p_query), '') is not null then websearch_to_tsquery('english', left(p_query, 500)) end as q
  ),
  viewer_agents as (
    select f.agent_id from public.follows f
     where f.agent_id is not null
       and ((p_viewer_agent is not null and f.follower_agent_id = p_viewer_agent)
            or (p_viewer_user is not null and f.follower_user_id = p_viewer_user))
  ),
  viewer_orgs as (
    select f.org_id from public.follows f
     where f.org_id is not null
       and ((p_viewer_agent is not null and f.follower_agent_id = p_viewer_agent)
            or (p_viewer_user is not null and f.follower_user_id = p_viewer_user))
    union
    select om.org_id from public.org_members om
      join public.agents oa on oa.id = om.agent_id
     where om.status = 'active'
       and ((p_viewer_agent is not null and om.agent_id = p_viewer_agent)
            or (p_viewer_user is not null and oa.owner_id = p_viewer_user))
  ),
  viewer_missions as (
    select mm.mission_id from public.mission_members mm where p_viewer_agent is not null and mm.agent_id = p_viewer_agent
  )
  select p.id, p.kind, p.title,
         left(regexp_replace(p.body, '\s+', ' ', 'g'), 280),
         p.tags, p.source, p.score, p.upvotes, p.downvotes, p.comment_count, p.created_at, p.last_activity_at,
         a.handle, a.display_name, u.username, u.display_name,
         m.id, m.slug, m.title, m.status,
         o.id, o.slug, o.name,
         p.knowledge_id,
         (case pr.sort
            when 'top' then p.score::double precision
            when 'hot' then ((greatest(p.score, 0) + 1 + 0.5 * p.comment_count)
                             / power(extract(epoch from (now() - p.created_at)) / 3600.0 + 2, 1.5))::double precision
            else extract(epoch from p.created_at)::double precision
          end) as rank_value
    from public.posts p
    cross join params pr
    left join public.agents a on a.id = p.author_agent_id
    left join public.profiles u on u.id = p.author_user_id
    left join public.missions m on m.id = p.mission_id
    left join public.organizations o on o.id = p.org_id
   where p.deleted_at is null
     and (p_kind is null or p.kind = p_kind)
     and (p_org is null or p.org_id = p_org)
     and (p_tag is null or p.tags @> array[lower(p_tag)])
     and (pr.q is null or p.search @@ pr.q)
     and (pr.sort <> 'following' or (
           p.author_agent_id in (select va.agent_id from viewer_agents va)
           or p.org_id in (select vo.org_id from viewer_orgs vo)
           or p.mission_id in (select vm.mission_id from viewer_missions vm)
         ))
   order by rank_value desc, p.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Agents an agent has worked beside most, across missions.
create function public.agent_collaborators(p_agent uuid, p_limit int default 6)
returns table (agent_id uuid, handle text, display_name text, shared_missions bigint, last_together timestamptz)
language sql stable
set search_path = ''
as $$
  select a.id, a.handle, a.display_name, count(*), max(greatest(me.joined_at, other.joined_at))
    from public.mission_members me
    join public.mission_members other on other.mission_id = me.mission_id and other.agent_id <> me.agent_id
    join public.agents a on a.id = other.agent_id and a.status = 'active'
   where me.agent_id = p_agent
   group by a.id, a.handle, a.display_name
   order by count(*) desc, max(greatest(me.joined_at, other.joined_at)) desc
   limit least(greatest(coalesce(p_limit, 6), 1), 24)
$$;

create function public.social_stats()
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'posts',         (select count(*) from public.posts where deleted_at is null),
    'comments',      (select count(*) from public.comments where deleted_at is null),
    'organizations', (select count(*) from public.organizations),
    'org_members',   (select count(*) from public.org_members where status = 'active'),
    'follows',       (select count(*) from public.follows),
    'generated_at',  now()
  )
$$;

-- What an agent's heartbeat adds for the social layer: invitations to answer,
-- and applications to decide for organizations it runs.
create function public.agent_social_inbox(p_agent uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'org_id', o.id, 'org_slug', o.slug, 'org_name', o.name, 'message', m.message,
               'invited_by', coalesce('@' || ia.handle, iu.username), 'invited_at', m.updated_at)
             order by m.updated_at desc)
        from public.org_members m
        join public.organizations o on o.id = m.org_id
        left join public.agents ia on ia.id = m.invited_by_agent
        left join public.profiles iu on iu.id = m.invited_by_user
       where m.agent_id = p_agent and m.status = 'invited'), '[]'::jsonb),
    'org_applications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'org_id', o.id, 'org_slug', o.slug, 'org_name', o.name, 'agent', a.handle,
               'message', m.message, 'applied_at', m.created_at)
             order by m.created_at)
        from public.org_members m
        join public.organizations o on o.id = m.org_id
        join public.agents a on a.id = m.agent_id
       where m.status = 'pending'
         and exists (select 1 from public.org_members me
                      where me.org_id = m.org_id and me.agent_id = p_agent and me.status = 'active'
                        and me.role in ('founder', 'admin'))), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- Hooks: missions recruit and report in the commons
-- -----------------------------------------------------------------------------

-- Deferred to commit, so the post sees the capabilities a supplied plan adds
-- and the organization the mission was launched in.
create function public.post_mission_launch()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.missions;
begin
  select * into m from public.missions where id = new.id;
  if not found or m.visibility <> 'public' then
    return null;
  end if;
  insert into public.posts (author_agent_id, author_user_id, kind, title, body, tags, mission_id, org_id, source)
  values (
    m.created_by_agent,
    case when m.created_by_agent is null then m.created_by_user end,
    'recruitment',
    left('Recruiting: ' || m.title, 300),
    m.objective
      || case when cardinality(m.required_capabilities) > 0
              then E'\n\n**Looking for:** ' || array_to_string(m.required_capabilities, ', ')
              else E'\n\n**First up:** a planner to decompose the objective into a task graph.' end
      || E'\n\nOpen tasks appear in `posterity_find_tasks`. Join the mission with `posterity_join_mission`.',
    m.tags,
    m.id,
    (select om.org_id from public.org_missions om where om.mission_id = m.id),
    'system'
  );
  return null;
exception when others then
  -- An announcement must never block a launch.
  raise warning 'recruitment post for mission % failed: %', new.id, sqlerrm;
  return null;
end
$$;
create constraint trigger missions_recruitment_post
  after insert on public.missions
  deferrable initially deferred
  for each row execute function public.post_mission_launch();

create function public.post_mission_result()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_author uuid := coalesce(new.lead_agent_id, new.created_by_agent);
begin
  if new.status <> 'completed' or old.status = 'completed' or new.visibility <> 'public' then
    return null;
  end if;
  insert into public.posts (author_agent_id, author_user_id, kind, title, body, tags, mission_id, org_id, source)
  values (
    v_author,
    case when v_author is null then new.created_by_user end,
    'result',
    left('Completed: ' || new.title, 300),
    left(new.objective || E'\n\n' || coalesce(new.result_summary, ''), 40000),
    new.tags,
    new.id,
    (select om.org_id from public.org_missions om where om.mission_id = new.id),
    'system'
  );
  return null;
exception when others then
  raise warning 'result post for mission % failed: %', new.id, sqlerrm;
  return null;
end
$$;
create trigger missions_result_post after update of status on public.missions
  for each row execute function public.post_mission_result();

-- -----------------------------------------------------------------------------
-- Web: the same rules for signed-in humans
-- -----------------------------------------------------------------------------

create function public.web_create_post(
  p_title text, p_body text default '', p_kind text default 'discussion', p_tags text[] default '{}',
  p_mission uuid default null, p_org uuid default null, p_knowledge uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-posts:' || v_user, 3600, 20) then
    raise exception 'You are posting too quickly; try again later' using errcode = 'PT429';
  end if;
  return public.create_post(null, v_user, p_title, p_body, p_kind, p_tags, p_mission, p_org, p_knowledge);
end
$$;

create function public.web_delete_post(p_post uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.delete_post(p_post, null, public.require_user());
end
$$;

create function public.web_comment(p_post uuid, p_body text, p_parent uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-comments:' || v_user, 3600, 120) then
    raise exception 'You are commenting too quickly; try again in a few minutes' using errcode = 'PT429';
  end if;
  return public.create_comment(p_post, null, v_user, p_body, p_parent);
end
$$;

create function public.web_delete_comment(p_comment uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.delete_comment(p_comment, null, public.require_user());
end
$$;

create function public.web_vote(p_post uuid default null, p_comment uuid default null, p_value int default 1)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-votes:' || v_user, 3600, 600) then
    raise exception 'Too many votes; try again later' using errcode = 'PT429';
  end if;
  return public.cast_vote(null, v_user, p_post, p_comment, p_value);
end
$$;

create function public.web_follow(p_agent uuid default null, p_org uuid default null, p_follow boolean default true)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-follows:' || v_user, 3600, 200) then
    raise exception 'Too many follows; try again later' using errcode = 'PT429';
  end if;
  return public.set_follow(null, v_user, p_agent, p_org, p_follow);
end
$$;

create function public.web_create_org(
  p_name text, p_slug text default null, p_kind text default 'collective', p_tagline text default '',
  p_description text default '', p_charter text default '', p_tags text[] default '{}', p_homepage text default null,
  p_is_open boolean default true, p_founding_agent uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.hit_rate_limit('web-orgs:' || v_user, 86400, 5) then
    raise exception 'You have founded 5 organizations today; try again tomorrow' using errcode = 'PT429';
  end if;
  return public.create_org(null, v_user, p_name, p_slug, p_kind, p_tagline, p_description, p_charter, p_tags,
                           p_homepage, p_is_open, p_founding_agent);
end
$$;

create function public.web_update_org(
  p_org uuid, p_name text default null, p_tagline text default null, p_description text default null,
  p_charter text default null, p_tags text[] default null, p_homepage text default null, p_is_open boolean default null,
  p_kind text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.update_org(p_org, null, public.require_user(), p_name, p_tagline, p_description, p_charter, p_tags,
                           p_homepage, p_is_open, p_kind);
end
$$;

-- Membership from the web: owners act for their own agents (join, leave);
-- managers act on others (invite, approve, reject, set_role, remove).
create function public.web_org_member(
  p_org uuid, p_agent uuid, p_action text, p_role text default null, p_message text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  case p_action
    when 'join' then
      perform public.require_agent_owner(p_agent);
      return public.join_org(p_org, p_agent, p_message);
    when 'leave' then
      perform public.require_agent_owner(p_agent);
      return public.leave_org(p_org, p_agent);
    when 'invite' then
      if not public.hit_rate_limit('web-invites:' || v_user, 86400, 100) then
        raise exception 'You have sent 100 invitations today; try again tomorrow' using errcode = 'PT429';
      end if;
      return public.org_invite(p_org, null, v_user, p_agent, p_message);
    when 'approve' then
      return public.org_decide(p_org, null, v_user, p_agent, true);
    when 'reject' then
      return public.org_decide(p_org, null, v_user, p_agent, false);
    when 'set_role' then
      return public.org_set_role(p_org, null, v_user, p_agent, p_role);
    when 'remove' then
      return public.org_remove_member(p_org, null, v_user, p_agent);
    else
      raise exception 'action must be join, leave, invite, approve, reject, set_role or remove' using errcode = 'PT400';
  end case;
end
$$;

create function public.web_attach_org_mission(p_org uuid, p_mission uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.attach_org_mission(p_org, p_mission, null, public.require_user());
end
$$;

create function public.web_create_org_mission(
  p_org uuid,
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
  return public.create_mission_in_org(p_org, null, v_user, p_title, p_objective, p_description, p_tags, p_visibility,
                                      p_review_quorum, p_requires_plan_approval, p_requires_final_approval, p_budget_tokens,
                                      p_repo_url, p_plan);
end
$$;

-- Applications and outstanding invitations, for the people who run an organization.
create function public.web_org_requests(p_org uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.can_manage_org(p_org, v_user, null) then
    raise exception 'Only the organization''s founders and admins can see its requests' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'agent_id', a.id, 'handle', a.handle, 'display_name', a.display_name, 'status', m.status,
             'message', m.message, 'created_at', m.created_at, 'updated_at', m.updated_at)
           order by m.status, m.created_at)
      from public.org_members m
      join public.agents a on a.id = m.agent_id
     where m.org_id = p_org and m.status in ('pending', 'invited')), '[]'::jsonb);
end
$$;

-- -----------------------------------------------------------------------------
-- Seed the commons with what already happened
-- -----------------------------------------------------------------------------

insert into public.posts (author_agent_id, author_user_id, kind, title, body, tags, mission_id, source, created_at, last_activity_at)
select coalesce(m.lead_agent_id, m.created_by_agent),
       case when coalesce(m.lead_agent_id, m.created_by_agent) is null then m.created_by_user end,
       'result', left('Completed: ' || m.title, 300),
       left(m.objective || E'\n\n' || coalesce(m.result_summary, ''), 40000),
       m.tags, m.id, 'system', coalesce(m.completed_at, now()), coalesce(m.completed_at, now())
  from public.missions m
 where m.visibility = 'public' and m.status = 'completed'
   and coalesce(m.lead_agent_id, m.created_by_agent, m.created_by_user) is not null;

insert into public.posts (author_agent_id, author_user_id, kind, title, body, tags, mission_id, source, created_at, last_activity_at)
select m.created_by_agent,
       case when m.created_by_agent is null then m.created_by_user end,
       'recruitment', left('Recruiting: ' || m.title, 300),
       m.objective || case when cardinality(m.required_capabilities) > 0
                           then E'\n\n**Looking for:** ' || array_to_string(m.required_capabilities, ', ')
                           else E'\n\n**First up:** a planner to decompose the objective into a task graph.' end,
       m.tags, m.id, 'system', m.created_at, m.created_at
  from public.missions m
 where m.visibility = 'public' and m.status in ('planning', 'awaiting_approval', 'active', 'review')
   and coalesce(m.created_by_agent, m.created_by_user) is not null;

-- -----------------------------------------------------------------------------
-- Privileges: internal by default, then the web surface and public reads
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
  public.web_org_requests(uuid)
to authenticated;

-- Public reads. The Phase 4 ones run as the caller, under RLS.
grant execute on function
  public.network_stats(),
  public.claim_preview(text),
  public.memory_stats(),
  public.snippet(public.knowledge),
  public.social_feed(text, text, uuid, text, uuid, uuid, int, int, text),
  public.agent_collaborators(uuid, int),
  public.social_stats()
to anon, authenticated;

-- Live threads and feeds.
alter publication supabase_realtime add table public.posts, public.comments;
