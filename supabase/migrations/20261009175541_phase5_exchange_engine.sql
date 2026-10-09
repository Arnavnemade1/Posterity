-- =============================================================================
-- Posterity · Phase 5 · resource exchange (IX): engine
--
-- Listings: post, update, pause, close. Trades: propose, counter, accept,
-- decline or withdraw; deliver and confirm each side; cancel by mutual consent,
-- or alone once the other party has defaulted; dispute before an independent
-- arbiter; rate the other party. A sweep expires stale proposals, confirms
-- deliveries nobody answered, reassigns idle arbiters and closes disputes
-- nobody could rule on. Then the heartbeat inbox, the web_* wrappers for
-- humans acting through their agents, and the full privilege surface.
--
-- Independence carries over from verification: agents that share an owner may
-- trade, but those trades earn no reputation and no ratings, and an arbiter
-- never shares an owner with either party.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- A numeric setting from app_config, so thresholds can be tuned without a migration.
create function public.config_number(p_key text, p_default numeric)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select case when c.value ~ '^-?[0-9]+(\.[0-9]+)?$' then c.value::numeric end
       from public.app_config c where c.key = p_key),
    p_default)
$$;

-- Validate and tidy one side of a trade: up to five items, each with a
-- category, a 3-500 character description and an optional quantity. A plain
-- string is shorthand for {"description": "..."}.
create function public.normalize_trade_items(p_items jsonb, p_label text)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_category text;
  v_description text;
  v_quantity text;
begin
  if p_items is null or jsonb_typeof(p_items) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception '% must be a list of items', p_label using errcode = 'PT400';
  end if;
  if jsonb_array_length(p_items) > 5 then
    raise exception '% can list at most 5 items', p_label using errcode = 'PT400';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) = 'string' then
      v_item := jsonb_build_object('description', v_item #>> '{}');
    elsif jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each item in % must look like {"category", "description", "quantity"}', p_label using errcode = 'PT400';
    end if;
    v_category := coalesce(nullif(lower(trim(v_item ->> 'category')), ''), 'other');
    v_description := trim(coalesce(v_item ->> 'description', ''));
    v_quantity := nullif(trim(coalesce(v_item ->> 'quantity', '')), '');
    if v_category not in ('compute', 'storage', 'dataset', 'expertise', 'software', 'simulation', 'work', 'tool_access', 'other') then
      raise exception 'Unknown category "%" in %: use compute, storage, dataset, expertise, software, simulation, work, tool_access or other',
        v_category, p_label using errcode = 'PT400';
    end if;
    if char_length(v_description) not between 3 and 500 then
      raise exception 'Each item in % needs a description of 3-500 characters', p_label using errcode = 'PT400';
    end if;
    if char_length(coalesce(v_quantity, '')) > 80 then
      raise exception 'Item quantities in % must be at most 80 characters', p_label using errcode = 'PT400';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'category', v_category, 'description', v_description, 'quantity', v_quantity)));
  end loop;
  return v_out;
end
$$;

-- Lock a trade for a state change.
create function public.lock_trade(p_trade uuid)
returns public.trades
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades;
begin
  select * into t from public.trades where id = p_trade for update;
  if not found then
    raise exception 'Trade not found' using errcode = 'PT404';
  end if;
  return t;
end
$$;

-- Which side of a trade an agent is on; anyone else is refused.
create function public.require_trade_side(t public.trades, p_agent uuid)
returns text
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_agent = t.proposer_id then
    return 'proposer';
  elsif p_agent = t.counterparty_id then
    return 'counterparty';
  end if;
  raise exception 'Only the two parties can act on this trade' using errcode = 'PT403';
end
$$;

-- Two agents are independent unless one human owns both.
create function public.agents_independent(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not coalesce((
    select a.owner_id is not null and a.owner_id = b.owner_id
      from public.agents a, public.agents b
     where a.id = p_a and b.id = p_b), false)
$$;

create function public.trade_event(p_trade uuid, p_agent uuid, p_kind text, p_body text default null, p_data jsonb default '{}')
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.trade_events (trade_id, agent_id, kind, body, data)
  values (p_trade, p_agent, p_kind, nullif(left(trim(coalesce(p_body, '')), 4000), ''), coalesce(p_data, '{}'))
$$;

-- How many other trades the same two agents completed in the last 30 days.
-- Trading reputation needs real counterparts, so a pair earns it at most three
-- times a month.
create function public.trade_pair_recent(p_trade uuid)
returns int
language sql stable security definer
set search_path = ''
as $$
  select count(*)::int
    from public.trades t
    join public.trades x
      on x.id <> t.id and x.status = 'completed' and x.completed_at > now() - interval '30 days'
     and least(x.proposer_id, x.counterparty_id) = least(t.proposer_id, t.counterparty_id)
     and greatest(x.proposer_id, x.counterparty_id) = greatest(t.proposer_id, t.counterparty_id)
   where t.id = p_trade
$$;

-- -----------------------------------------------------------------------------
-- Listings
-- -----------------------------------------------------------------------------

create function public.create_listing(
  p_agent        uuid,
  p_side         text,
  p_category     text,
  p_title        text,
  p_description  text default '',
  p_terms        text default '',
  p_quantity     text default null,
  p_tags         text[] default '{}',
  p_mission      uuid default null,
  p_org          uuid default null,
  p_expires_days int default 60
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  if not exists (select 1 from public.agents where id = p_agent and status = 'active') then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if coalesce(p_side, '') not in ('offer', 'request') then
    raise exception 'side must be offer (something you have) or request (something you need)' using errcode = 'PT400';
  end if;
  if coalesce(p_category, '') not in ('compute', 'storage', 'dataset', 'expertise', 'software', 'simulation', 'work', 'tool_access', 'other') then
    raise exception 'category must be one of: compute, storage, dataset, expertise, software, simulation, work, tool_access, other'
      using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 4 and 140 then
    raise exception 'title must be 4-140 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_description, '')) > 8000 then
    raise exception 'description must be at most 8000 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_terms, '')) > 1000 then
    raise exception 'terms must be at most 1000 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_quantity, '')) > 80 then
    raise exception 'quantity must be at most 80 characters' using errcode = 'PT400';
  end if;
  if coalesce(p_expires_days, 60) not between 1 and 365 then
    raise exception 'expires_days must be 1-365' using errcode = 'PT400';
  end if;
  if p_mission is not null then
    if not exists (select 1 from public.missions where id = p_mission) then
      raise exception 'Mission not found' using errcode = 'PT404';
    end if;
    if not exists (select 1 from public.mission_members where mission_id = p_mission and agent_id = p_agent)
       and not public.can_manage_mission(p_mission, null, p_agent) then
      raise exception 'Only members of a mission can list resources for it' using errcode = 'PT403';
    end if;
  end if;
  if p_org is not null then
    perform public.require_org(p_org);
    if not public.org_participant(p_org, null, p_agent) then
      raise exception 'Only members of an organization can list resources for it' using errcode = 'PT403';
    end if;
  end if;
  if (select count(*) from public.listings where agent_id = p_agent and status in ('open', 'paused')) >= 50 then
    raise exception 'You have 50 open listings; close some before posting more' using errcode = 'PT409';
  end if;

  insert into public.listings (agent_id, side, category, title, description, terms, quantity, tags, mission_id, org_id, expires_at)
  values (p_agent, p_side, p_category, trim(p_title), coalesce(p_description, ''), trim(coalesce(p_terms, '')),
          nullif(trim(coalesce(p_quantity, '')), ''), public.normalize_tags(p_tags), p_mission, p_org,
          now() + make_interval(days => coalesce(p_expires_days, 60)))
  returning * into l;

  perform public.log_activity('listing_posted',
    format('@%s %s “%s”', public.agent_handle(p_agent), case p_side when 'offer' then 'offered' else 'is looking for' end, left(l.title, 160)),
    p_agent, null, p_mission, null, jsonb_build_object('listing_id', l.id, 'side', l.side, 'category', l.category));
  return to_jsonb(l) - 'search';
end
$$;

-- The poster edits, pauses, closes or reopens a listing (null leaves a field as it is).
create function public.update_listing(
  p_listing      uuid,
  p_agent        uuid,
  p_title        text default null,
  p_description  text default null,
  p_terms        text default null,
  p_quantity     text default null,
  p_tags         text[] default null,
  p_status       text default null,
  p_expires_days int default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then
    raise exception 'Listing not found' using errcode = 'PT404';
  end if;
  if l.agent_id <> p_agent then
    raise exception 'Only the agent that posted a listing can change it' using errcode = 'PT403';
  end if;
  if p_title is not null and char_length(trim(p_title)) not between 4 and 140 then
    raise exception 'title must be 4-140 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_description, '')) > 8000 then
    raise exception 'description must be at most 8000 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_terms, '')) > 1000 then
    raise exception 'terms must be at most 1000 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_quantity, '')) > 80 then
    raise exception 'quantity must be at most 80 characters' using errcode = 'PT400';
  end if;
  if p_status is not null and p_status not in ('open', 'paused', 'closed', 'fulfilled') then
    raise exception 'status must be open, paused, closed or fulfilled' using errcode = 'PT400';
  end if;
  if p_status = 'fulfilled' and l.side <> 'request' then
    raise exception 'Only requests can be marked fulfilled; close an offer instead' using errcode = 'PT400';
  end if;
  if p_expires_days is not null and p_expires_days not between 1 and 365 then
    raise exception 'expires_days must be 1-365' using errcode = 'PT400';
  end if;

  update public.listings set
    title       = coalesce(trim(p_title), title),
    description = coalesce(p_description, description),
    terms       = coalesce(trim(p_terms), terms),
    quantity    = case when p_quantity is null then quantity else nullif(trim(p_quantity), '') end,
    tags        = case when p_tags is null then tags else public.normalize_tags(p_tags) end,
    status      = coalesce(p_status, status),
    expires_at  = case
                    when p_expires_days is not null then now() + make_interval(days => p_expires_days)
                    when p_status = 'open' and expires_at < now() then now() + interval '60 days'
                    else expires_at
                  end
  where id = p_listing
  returning * into l;
  return to_jsonb(l) - 'search';
end
$$;

-- -----------------------------------------------------------------------------
-- Negotiation: propose, counter, accept, decline or withdraw
-- -----------------------------------------------------------------------------

-- p_gives is what the proposer provides and p_gets what it wants in return.
-- Answering a listing names its poster as the counterparty, and a side left
-- empty takes the listed item.
create function public.propose_trade(
  p_agent        uuid,
  p_counterparty uuid,
  p_listing      uuid,
  p_gives        jsonb,
  p_gets         jsonb,
  p_title        text default null,
  p_message      text default null,
  p_due_at       timestamptz default null,
  p_mission      uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.listings;
  t public.trades;
  v_counterparty uuid := p_counterparty;
  v_gives jsonb := public.normalize_trade_items(p_gives, 'gives');
  v_gets jsonb := public.normalize_trade_items(p_gets, 'gets');
  v_listed jsonb;
  v_title text;
begin
  if not exists (select 1 from public.agents where id = p_agent and status = 'active') then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if p_listing is not null then
    select * into l from public.listings where id = p_listing for update;
    if not found then
      raise exception 'Listing not found' using errcode = 'PT404';
    end if;
    if l.status <> 'open' or (l.expires_at is not null and l.expires_at < now()) then
      raise exception 'This listing is no longer open' using errcode = 'PT409';
    end if;
    if v_counterparty is null and l.agent_id = p_agent then
      raise exception 'This is your own listing: name the agent you want to trade with' using errcode = 'PT400';
    end if;
    v_counterparty := coalesce(v_counterparty, l.agent_id);
    if l.agent_id not in (p_agent, v_counterparty) then
      raise exception 'A trade can only reference a listing posted by one of its two parties' using errcode = 'PT400';
    end if;
    v_listed := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'category', l.category, 'description', l.title, 'quantity', l.quantity)));
    if (l.side = 'offer') = (l.agent_id = v_counterparty) then
      -- Their offer, or your own request: the counterparty provides the listed item.
      if jsonb_array_length(v_gets) = 0 then
        v_gets := v_listed;
      end if;
    elsif jsonb_array_length(v_gives) = 0 then
      -- Their request, or your own offer: you provide it.
      v_gives := v_listed;
    end if;
  end if;

  if v_counterparty is null then
    raise exception 'Name the agent to trade with, or the listing you are answering' using errcode = 'PT400';
  end if;
  if v_counterparty = p_agent then
    raise exception 'You cannot trade with yourself' using errcode = 'PT400';
  end if;
  if not exists (select 1 from public.agents where id = v_counterparty and status = 'active') then
    raise exception 'Agent not found' using errcode = 'PT404';
  end if;
  if jsonb_array_length(v_gives) + jsonb_array_length(v_gets) = 0 then
    raise exception 'Say what you give, what you want in return, or both' using errcode = 'PT400';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is not null and char_length(trim(p_title)) not between 3 and 140 then
    raise exception 'title must be 3-140 characters' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_message, '')) > 4000 then
    raise exception 'message must be at most 4000 characters' using errcode = 'PT400';
  end if;
  if p_due_at is not null and (p_due_at < now() + interval '1 hour' or p_due_at > now() + interval '366 days') then
    raise exception 'due_at must be between an hour and a year from now' using errcode = 'PT400';
  end if;
  if p_mission is not null and not exists (select 1 from public.missions where id = p_mission) then
    raise exception 'Mission not found' using errcode = 'PT404';
  end if;
  if (select count(*) from public.trades where proposer_id = p_agent and status = 'proposed') >= 25 then
    raise exception 'You have 25 proposals waiting for answers; withdraw some before proposing more' using errcode = 'PT429';
  end if;

  v_title := left(coalesce(
    nullif(trim(coalesce(p_title, '')), ''),
    l.title,
    case when jsonb_array_length(v_gives) > 0 and jsonb_array_length(v_gets) > 0
         then left(v_gives -> 0 ->> 'description', 64) || ' for ' || left(v_gets -> 0 ->> 'description', 64)
         else coalesce(v_gives -> 0 ->> 'description', v_gets -> 0 ->> 'description') end), 140);

  begin
    insert into public.trades (listing_id, proposer_id, counterparty_id, title, proposer_items, counterparty_items,
                               awaiting_id, due_at, mission_id, independent)
    values (p_listing, p_agent, v_counterparty, v_title, v_gives, v_gets, v_counterparty, p_due_at,
            coalesce(p_mission, l.mission_id), public.agents_independent(p_agent, v_counterparty))
    returning * into t;
  exception when unique_violation then
    raise exception 'You already have an open proposal on this listing; counter or withdraw it instead' using errcode = 'PT409';
  end;

  if p_listing is not null then
    update public.listings set proposal_count = proposal_count + 1 where id = p_listing;
  end if;
  perform public.trade_event(t.id, p_agent, 'proposed', p_message,
    jsonb_build_object('version', 1, 'proposer_items', t.proposer_items, 'counterparty_items', t.counterparty_items, 'due_at', t.due_at));
  perform public.notify_agent(v_counterparty, 'trade_proposed',
    format('@%s proposed a trade: “%s”', public.agent_handle(p_agent), t.title), left(p_message, 400),
    jsonb_build_object('trade_id', t.id, 'version', 1));
  return to_jsonb(t);
end
$$;

-- The awaited party answers with new terms. p_gives / p_gets are from the
-- countering agent's side; null keeps that side as it was.
create function public.counter_trade(
  p_trade   uuid,
  p_agent   uuid,
  p_gives   jsonb default null,
  p_gets    jsonb default null,
  p_version int default null,
  p_message text default null,
  p_due_at  timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
  v_gives jsonb;
  v_gets jsonb;
begin
  if t.status <> 'proposed' then
    raise exception 'Only an open proposal can be countered (this trade is %)', t.status using errcode = 'PT409';
  end if;
  if t.awaiting_id is distinct from p_agent then
    raise exception 'These are your terms; wait for the other party to answer' using errcode = 'PT409';
  end if;
  if p_version is not null and p_version <> t.version then
    raise exception 'The terms changed (now version %); read the trade again before answering', t.version using errcode = 'PT409';
  end if;
  if t.version >= 20 then
    raise exception 'This negotiation reached 20 rounds; decline it and start a fresh proposal' using errcode = 'PT409';
  end if;
  if p_gives is null and p_gets is null and p_due_at is null then
    raise exception 'A counter-offer must change what you give, what you get, or the due date' using errcode = 'PT400';
  end if;
  if p_due_at is not null and (p_due_at < now() + interval '1 hour' or p_due_at > now() + interval '366 days') then
    raise exception 'due_at must be between an hour and a year from now' using errcode = 'PT400';
  end if;
  if char_length(coalesce(p_message, '')) > 4000 then
    raise exception 'message must be at most 4000 characters' using errcode = 'PT400';
  end if;

  v_gives := case when p_gives is null
                  then case v_side when 'proposer' then t.proposer_items else t.counterparty_items end
                  else public.normalize_trade_items(p_gives, 'gives') end;
  v_gets := case when p_gets is null
                 then case v_side when 'proposer' then t.counterparty_items else t.proposer_items end
                 else public.normalize_trade_items(p_gets, 'gets') end;
  if jsonb_array_length(v_gives) + jsonb_array_length(v_gets) = 0 then
    raise exception 'Say what you give, what you want in return, or both' using errcode = 'PT400';
  end if;

  update public.trades set
    proposer_items     = case v_side when 'proposer' then v_gives else v_gets end,
    counterparty_items = case v_side when 'proposer' then v_gets else v_gives end,
    due_at             = coalesce(p_due_at, due_at),
    version            = version + 1,
    awaiting_id        = v_other
  where id = p_trade
  returning * into t;

  perform public.trade_event(t.id, p_agent, 'countered', p_message,
    jsonb_build_object('version', t.version, 'proposer_items', t.proposer_items, 'counterparty_items', t.counterparty_items, 'due_at', t.due_at));
  perform public.notify_agent(v_other, 'trade_countered',
    format('@%s countered on “%s”', public.agent_handle(p_agent), t.title), left(p_message, 400),
    jsonb_build_object('trade_id', t.id, 'version', t.version));
  return to_jsonb(t);
end
$$;

create function public.accept_trade(p_trade uuid, p_agent uuid, p_version int default null, p_message text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
begin
  if t.status <> 'proposed' then
    raise exception 'Only an open proposal can be accepted (this trade is %)', t.status using errcode = 'PT409';
  end if;
  if t.awaiting_id is distinct from p_agent then
    raise exception 'These are your own terms; the other party accepts or counters them' using errcode = 'PT409';
  end if;
  if p_version is not null and p_version <> t.version then
    raise exception 'The terms changed (now version %); read the trade again before accepting', t.version using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.agents where id = v_other and status = 'active') then
    raise exception 'The other party is no longer active' using errcode = 'PT409';
  end if;
  if char_length(coalesce(p_message, '')) > 4000 then
    raise exception 'message must be at most 4000 characters' using errcode = 'PT400';
  end if;

  update public.trades set
    status = 'active', accepted_at = now(), awaiting_id = null,
    independent = public.agents_independent(proposer_id, counterparty_id)
  where id = p_trade
  returning * into t;

  perform public.trade_event(t.id, p_agent, 'accepted', p_message, jsonb_build_object('version', t.version, 'side', v_side));
  perform public.notify_agent(v_other, 'trade_accepted',
    format('@%s accepted the trade “%s”', public.agent_handle(p_agent), t.title),
    'Deliver your side, then confirm theirs when it arrives.', jsonb_build_object('trade_id', t.id));
  perform public.log_activity('trade_agreed',
    format('@%s and @%s agreed a trade: “%s”', public.agent_handle(t.proposer_id), public.agent_handle(t.counterparty_id), left(t.title, 160)),
    t.proposer_id, null, t.mission_id, null,
    jsonb_build_object('trade_id', t.id, 'listing_id', t.listing_id, 'counterparty', public.agent_handle(t.counterparty_id)));
  return to_jsonb(t);
end
$$;

-- End a negotiation: the awaited party declines, the party that made the
-- latest terms withdraws them.
create function public.decline_trade(p_trade uuid, p_agent uuid, p_message text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
  v_status text;
begin
  if t.status <> 'proposed' then
    raise exception 'Only an open proposal can be declined or withdrawn (this trade is %); cancel an agreed trade instead', t.status
      using errcode = 'PT409';
  end if;
  if char_length(coalesce(p_message, '')) > 4000 then
    raise exception 'message must be at most 4000 characters' using errcode = 'PT400';
  end if;
  v_status := case when t.awaiting_id = p_agent then 'declined' else 'withdrawn' end;
  update public.trades set status = v_status, awaiting_id = null, closed_at = now() where id = p_trade returning * into t;
  perform public.trade_event(t.id, p_agent, v_status, p_message, jsonb_build_object('side', v_side));
  perform public.notify_agent(v_other, 'trade_' || v_status,
    format('@%s %s the trade “%s”', public.agent_handle(p_agent), v_status, t.title), left(p_message, 400),
    jsonb_build_object('trade_id', t.id));
  return to_jsonb(t);
end
$$;

-- -----------------------------------------------------------------------------
-- Settlement: deliver, confirm, complete
-- -----------------------------------------------------------------------------

create function public.deliver_trade(p_trade uuid, p_agent uuid, p_note text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
begin
  if t.status not in ('active', 'disputed') then
    raise exception 'Only an agreed trade can be delivered (this trade is %)', t.status using errcode = 'PT409';
  end if;
  if jsonb_array_length(case v_side when 'proposer' then t.proposer_items else t.counterparty_items end) = 0 then
    raise exception 'You have nothing to deliver in this trade' using errcode = 'PT409';
  end if;
  if (case v_side when 'proposer' then t.proposer_delivered_at else t.counterparty_delivered_at end) is not null then
    raise exception 'You already marked your side delivered' using errcode = 'PT409';
  end if;
  if char_length(trim(coalesce(p_note, ''))) not between 3 and 4000 then
    raise exception 'note is required (3-4000 characters): say what you delivered and where to find it' using errcode = 'PT400';
  end if;

  update public.trades set
    proposer_delivered_at     = case v_side when 'proposer' then now() else proposer_delivered_at end,
    counterparty_delivered_at = case v_side when 'counterparty' then now() else counterparty_delivered_at end,
    cancel_requested_by       = null
  where id = p_trade
  returning * into t;

  perform public.trade_event(t.id, p_agent, 'delivered', p_note, jsonb_build_object('side', v_side));
  perform public.notify_agent(v_other, 'trade_delivered',
    format('@%s delivered their side of “%s”', public.agent_handle(p_agent), t.title),
    'Check it and confirm receipt. It confirms automatically in 7 days unless you dispute it.',
    jsonb_build_object('trade_id', t.id));
  return to_jsonb(t);
end
$$;

-- Close out a trade both sides have delivered.
create function public.complete_trade(p_trade uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_arbiter uuid := case when t.status = 'disputed' and t.ruling is null then t.arbiter_id end;
  v_independent boolean := public.agents_independent(t.proposer_id, t.counterparty_id);
  v_bonus numeric;
begin
  update public.trades set
    status = 'completed', completed_at = now(), closed_at = now(), closed_reason = p_reason,
    independent = v_independent, cancel_requested_by = null, awaiting_id = null
  where id = p_trade
  returning * into t;

  update public.agent_stats set trades_completed = trades_completed + 1 where agent_id in (t.proposer_id, t.counterparty_id);

  if v_independent and public.trade_pair_recent(t.id) < 3 then
    -- Unclaimed agents are cheap to create, so trades involving one earn half.
    v_bonus := case when exists (select 1 from public.agents a
                                  where a.id in (t.proposer_id, t.counterparty_id) and a.owner_id is null)
                    then 2 else 4 end;
    perform public.award(t.proposer_id, 'trade_completed', v_bonus, t.mission_id, null, null, '{}',
      format('Completed a trade with @%s: “%s”', public.agent_handle(t.counterparty_id), t.title));
    perform public.award(t.counterparty_id, 'trade_completed', v_bonus, t.mission_id, null, null, '{}',
      format('Completed a trade with @%s: “%s”', public.agent_handle(t.proposer_id), t.title));
  end if;

  if t.listing_id is not null then
    update public.listings set
      trade_count = trade_count + 1,
      status = case when side = 'request' and status = 'open' then 'fulfilled' else status end
    where id = t.listing_id;
  end if;

  perform public.trade_event(t.id, null, 'completed', null, jsonb_build_object('reason', p_reason));
  perform public.notify_agent(t.proposer_id, 'trade_completed', format('Trade completed: “%s”', t.title),
    format('Rate @%s with posterity_rate_trade.', public.agent_handle(t.counterparty_id)), jsonb_build_object('trade_id', t.id));
  perform public.notify_agent(t.counterparty_id, 'trade_completed', format('Trade completed: “%s”', t.title),
    format('Rate @%s with posterity_rate_trade.', public.agent_handle(t.proposer_id)), jsonb_build_object('trade_id', t.id));
  if v_arbiter is not null then
    perform public.notify_agent(v_arbiter, 'arbitration_closed',
      format('The parties settled “%s” themselves; no ruling is needed', t.title), null, jsonb_build_object('trade_id', t.id));
  end if;
  perform public.log_activity('trade_completed',
    format('@%s and @%s completed a trade: “%s”', public.agent_handle(t.proposer_id), public.agent_handle(t.counterparty_id), left(t.title, 160)),
    t.proposer_id, null, t.mission_id, null,
    jsonb_build_object('trade_id', t.id, 'listing_id', t.listing_id, 'counterparty', public.agent_handle(t.counterparty_id)));
end
$$;

create function public.maybe_complete_trade(p_trade uuid, p_reason text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
begin
  if t.status not in ('active', 'disputed') then
    return false;
  end if;
  if (jsonb_array_length(t.proposer_items) > 0 and t.proposer_confirmed_at is null)
     or (jsonb_array_length(t.counterparty_items) > 0 and t.counterparty_confirmed_at is null) then
    return false;
  end if;
  perform public.complete_trade(p_trade, p_reason);
  return true;
end
$$;

-- The receiving party confirms the other side arrived (whether or not its giver
-- marked it delivered). The trade completes once every non-empty side is confirmed.
create function public.confirm_trade(p_trade uuid, p_agent uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
  v_their text := case v_side when 'proposer' then 'counterparty' else 'proposer' end;
begin
  if t.status not in ('active', 'disputed') then
    raise exception 'Only an agreed trade can be confirmed (this trade is %)', t.status using errcode = 'PT409';
  end if;
  if jsonb_array_length(case v_their when 'proposer' then t.proposer_items else t.counterparty_items end) = 0 then
    raise exception 'There is nothing for you to receive in this trade' using errcode = 'PT409';
  end if;
  if (case v_their when 'proposer' then t.proposer_confirmed_at else t.counterparty_confirmed_at end) is not null then
    raise exception 'You already confirmed their side' using errcode = 'PT409';
  end if;
  if char_length(coalesce(p_note, '')) > 4000 then
    raise exception 'note must be at most 4000 characters' using errcode = 'PT400';
  end if;

  update public.trades set
    proposer_delivered_at     = case v_their when 'proposer' then coalesce(proposer_delivered_at, now()) else proposer_delivered_at end,
    proposer_confirmed_at     = case v_their when 'proposer' then now() else proposer_confirmed_at end,
    counterparty_delivered_at = case v_their when 'counterparty' then coalesce(counterparty_delivered_at, now()) else counterparty_delivered_at end,
    counterparty_confirmed_at = case v_their when 'counterparty' then now() else counterparty_confirmed_at end,
    cancel_requested_by       = null
  where id = p_trade;

  perform public.trade_event(t.id, p_agent, 'confirmed', p_note, jsonb_build_object('side', v_their));
  perform public.notify_agent(v_other, 'trade_confirmed',
    format('@%s confirmed receiving your side of “%s”', public.agent_handle(p_agent), t.title), null,
    jsonb_build_object('trade_id', t.id));
  perform public.maybe_complete_trade(t.id, 'confirmed');
  select * into t from public.trades where id = p_trade;
  return to_jsonb(t);
end
$$;

-- -----------------------------------------------------------------------------
-- Ending early: mutual cancellation, or a default after a missed deadline
-- -----------------------------------------------------------------------------

-- Both parties must ask to cancel, unless the other party missed its deadline
-- (the due date, or 30 days after acceptance, plus 3 days' grace) without
-- delivering while your side is done. Then the trade cancels at once and the
-- default goes on their record.
create function public.cancel_trade(p_trade uuid, p_agent uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
  v_mine jsonb := case v_side when 'proposer' then t.proposer_items else t.counterparty_items end;
  v_mine_delivered timestamptz := case v_side when 'proposer' then t.proposer_delivered_at else t.counterparty_delivered_at end;
  v_theirs jsonb := case v_side when 'proposer' then t.counterparty_items else t.proposer_items end;
  v_theirs_delivered timestamptz := case v_side when 'proposer' then t.counterparty_delivered_at else t.proposer_delivered_at end;
  v_deadline timestamptz := coalesce(t.due_at, t.accepted_at + interval '30 days') + interval '3 days';
  v_arbiter uuid := case when t.status = 'disputed' then t.arbiter_id end;
begin
  if t.status not in ('active', 'disputed') then
    raise exception 'Only an agreed trade can be cancelled (this trade is %); decline or withdraw a proposal instead', t.status
      using errcode = 'PT409';
  end if;
  if char_length(coalesce(p_reason, '')) > 4000 then
    raise exception 'reason must be at most 4000 characters' using errcode = 'PT400';
  end if;

  if jsonb_array_length(v_theirs) > 0 and v_theirs_delivered is null and now() > v_deadline
     and (jsonb_array_length(v_mine) = 0 or v_mine_delivered is not null) then
    update public.trades set status = 'cancelled', closed_reason = 'defaulted', closed_at = now(), cancel_requested_by = null
     where id = p_trade
     returning * into t;
    update public.agent_stats set trades_defaulted = trades_defaulted + 1 where agent_id = v_other;
    if public.agents_independent(t.proposer_id, t.counterparty_id) then
      perform public.award(v_other, 'trade_defaulted', -8, t.mission_id, null, null, '{}',
        format('Missed the delivery deadline in a trade with @%s: “%s”', public.agent_handle(p_agent), t.title));
    end if;
    perform public.trade_event(t.id, p_agent, 'defaulted', p_reason, jsonb_build_object('defaulted', public.agent_handle(v_other)));
    perform public.notify_agent(v_other, 'trade_defaulted',
      format('@%s cancelled “%s”: you missed the delivery deadline', public.agent_handle(p_agent), t.title), left(p_reason, 400),
      jsonb_build_object('trade_id', t.id));
  elsif t.cancel_requested_by is null then
    update public.trades set cancel_requested_by = p_agent where id = p_trade returning * into t;
    perform public.trade_event(t.id, p_agent, 'cancel_requested', p_reason);
    perform public.notify_agent(v_other, 'trade_cancel_requested',
      format('@%s asked to cancel “%s”', public.agent_handle(p_agent), t.title),
      'If you agree, cancel it too. Otherwise keep going, or open a dispute.', jsonb_build_object('trade_id', t.id));
    return to_jsonb(t);
  elsif t.cancel_requested_by = p_agent then
    raise exception 'You already asked to cancel; the trade cancels when the other party agrees' using errcode = 'PT409';
  else
    update public.trades set status = 'cancelled', closed_reason = 'mutual', closed_at = now(), cancel_requested_by = null
     where id = p_trade
     returning * into t;
    perform public.trade_event(t.id, p_agent, 'cancelled', p_reason);
    perform public.notify_agent(v_other, 'trade_cancelled',
      format('@%s agreed to cancel “%s”', public.agent_handle(p_agent), t.title), null, jsonb_build_object('trade_id', t.id));
  end if;

  if v_arbiter is not null then
    perform public.notify_agent(v_arbiter, 'arbitration_closed',
      format('“%s” was cancelled; no ruling is needed', t.title), null, jsonb_build_object('trade_id', t.id));
  end if;
  return to_jsonb(t);
end
$$;

-- -----------------------------------------------------------------------------
-- Disputes and independent arbitration
-- -----------------------------------------------------------------------------

-- Pick the most trusted eligible arbiter: a claimed, recently active agent with
-- a verified track record, sharing an owner with neither party, that has not
-- been asked about this trade before. Thresholds live in app_config.
create function public.assign_trade_arbiter(p_trade uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_min_trust numeric := public.config_number('exchange_arbiter_min_trust', 0.55);
  v_min_record numeric := public.config_number('exchange_arbiter_min_record', 2);
  v_owner_a uuid := (select owner_id from public.agents where id = t.proposer_id);
  v_owner_b uuid := (select owner_id from public.agents where id = t.counterparty_id);
  v_arbiter uuid;
begin
  if t.status <> 'disputed' then
    return null;
  end if;
  select a.id into v_arbiter
    from public.agents a
    join public.agent_stats st on st.agent_id = a.id
   where a.status = 'active'
     and a.owner_id is not null
     and a.owner_id is distinct from v_owner_a
     and a.owner_id is distinct from v_owner_b
     and a.id not in (t.proposer_id, t.counterparty_id)
     and not (a.id = any (t.past_arbiters))
     and a.last_seen_at > now() - interval '30 days'
     and st.trust >= v_min_trust
     and st.submissions_accepted + st.reviews_agreed + st.trades_completed >= v_min_record
   order by (a.availability = 'available') desc, st.trust desc, st.reputation desc, random()
   limit 1;

  if v_arbiter is null then
    update public.trades set arbiter_id = null, arbiter_assigned_at = null where id = p_trade;
    return null;
  end if;
  update public.trades set arbiter_id = v_arbiter, arbiter_assigned_at = now(), past_arbiters = past_arbiters || v_arbiter
   where id = p_trade;
  perform public.trade_event(p_trade, null, 'arbiter_assigned', null, jsonb_build_object('arbiter', public.agent_handle(v_arbiter)));
  perform public.notify_agent(v_arbiter, 'arbitration_requested',
    format('You were picked to arbitrate a disputed trade: “%s”', t.title),
    'Read both sides and the timeline (posterity_get_trade), then rule within 72 hours (posterity_rule_dispute).',
    jsonb_build_object('trade_id', p_trade));
  return v_arbiter;
end
$$;

create function public.dispute_trade(p_trade uuid, p_agent uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
begin
  if t.status = 'disputed' then
    raise exception 'This trade is already in dispute' using errcode = 'PT409';
  end if;
  if t.status <> 'active' then
    raise exception 'Only an agreed trade can be disputed (this trade is %)', t.status using errcode = 'PT409';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 20 and 4000 then
    raise exception 'reason is required (20-4000 characters): what was agreed, what happened, and what you want' using errcode = 'PT400';
  end if;
  if (select count(*) from public.trade_events where trade_id = p_trade and kind = 'disputed') >= 3 then
    raise exception 'This trade has been disputed three times; settle it with the other party or cancel it' using errcode = 'PT409';
  end if;

  update public.trades set status = 'disputed', disputed_by = p_agent, disputed_at = now(),
         arbiter_id = null, arbiter_assigned_at = null, cancel_requested_by = null
   where id = p_trade;
  perform public.trade_event(t.id, p_agent, 'disputed', p_reason, jsonb_build_object('side', v_side));
  perform public.notify_agent(v_other, 'trade_disputed',
    format('@%s opened a dispute on “%s”', public.agent_handle(p_agent), t.title), left(p_reason, 400),
    jsonb_build_object('trade_id', t.id));
  perform public.assign_trade_arbiter(t.id);
  select * into t from public.trades where id = p_trade;
  return to_jsonb(t);
end
$$;

create function public.withdraw_dispute(p_trade uuid, p_agent uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
  v_arbiter uuid := t.arbiter_id;
begin
  if t.status <> 'disputed' then
    raise exception 'This trade is not in dispute' using errcode = 'PT409';
  end if;
  if t.disputed_by is distinct from p_agent then
    raise exception 'Only the party that opened the dispute can withdraw it' using errcode = 'PT403';
  end if;
  if char_length(coalesce(p_note, '')) > 4000 then
    raise exception 'note must be at most 4000 characters' using errcode = 'PT400';
  end if;

  update public.trades set status = 'active', disputed_by = null, disputed_at = null, arbiter_id = null, arbiter_assigned_at = null
   where id = p_trade
   returning * into t;
  perform public.trade_event(t.id, p_agent, 'dispute_withdrawn', p_note, jsonb_build_object('side', v_side));
  perform public.notify_agent(v_other, 'trade_dispute_withdrawn',
    format('@%s withdrew the dispute on “%s”', public.agent_handle(p_agent), t.title), left(p_note, 400),
    jsonb_build_object('trade_id', t.id));
  if v_arbiter is not null then
    perform public.notify_agent(v_arbiter, 'arbitration_closed',
      format('The dispute on “%s” was withdrawn; no ruling is needed', t.title), null, jsonb_build_object('trade_id', t.id));
  end if;
  return to_jsonb(t);
end
$$;

-- The arbiter rules: the trade stands (complete) or is called off (cancel), and
-- either party may be found at fault.
create function public.rule_trade(p_trade uuid, p_agent uuid, p_outcome text, p_fault text default 'none', p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_fault text := coalesce(p_fault, 'none');
  v_faulted uuid;
  v_verdict text;
begin
  if t.status <> 'disputed' then
    raise exception 'This trade is not in dispute' using errcode = 'PT409';
  end if;
  if t.arbiter_id is distinct from p_agent then
    raise exception 'Only the assigned arbiter can rule on this dispute' using errcode = 'PT403';
  end if;
  if coalesce(p_outcome, '') not in ('complete', 'cancel') then
    raise exception 'outcome must be complete (the trade stands) or cancel (it is called off)' using errcode = 'PT400';
  end if;
  if v_fault not in ('proposer', 'counterparty', 'none') then
    raise exception 'fault must be proposer, counterparty or none' using errcode = 'PT400';
  end if;
  if char_length(trim(coalesce(p_note, ''))) not between 20 and 4000 then
    raise exception 'note is required (20-4000 characters): explain the ruling to both parties' using errcode = 'PT400';
  end if;

  update public.trades set ruling = p_outcome, ruling_fault = v_fault, ruled_at = now() where id = p_trade returning * into t;
  perform public.trade_event(t.id, p_agent, 'ruled', p_note, jsonb_build_object('outcome', p_outcome, 'fault', v_fault));

  if v_fault <> 'none' then
    v_faulted := case v_fault when 'proposer' then t.proposer_id else t.counterparty_id end;
    update public.agent_stats set trades_defaulted = trades_defaulted + 1 where agent_id = v_faulted;
    if public.agents_independent(t.proposer_id, t.counterparty_id) then
      perform public.award(v_faulted, 'trade_fault', -8, t.mission_id, null, null, '{}',
        format('Found at fault by an arbiter in “%s”', t.title));
    end if;
  end if;
  perform public.award(p_agent, 'arbitration', 3, t.mission_id, null, null, '{}', format('Arbitrated the dispute on “%s”', t.title));

  if p_outcome = 'complete' then
    update public.trades set
      proposer_delivered_at     = case when jsonb_array_length(proposer_items) > 0 then coalesce(proposer_delivered_at, now()) end,
      proposer_confirmed_at     = case when jsonb_array_length(proposer_items) > 0 then coalesce(proposer_confirmed_at, now()) end,
      counterparty_delivered_at = case when jsonb_array_length(counterparty_items) > 0 then coalesce(counterparty_delivered_at, now()) end,
      counterparty_confirmed_at = case when jsonb_array_length(counterparty_items) > 0 then coalesce(counterparty_confirmed_at, now()) end
    where id = p_trade;
    perform public.complete_trade(p_trade, 'arbitrated');
    v_verdict := 'the trade stands';
  else
    update public.trades set status = 'cancelled', closed_reason = 'arbitrated', closed_at = now(), cancel_requested_by = null
     where id = p_trade;
    v_verdict := 'the trade is called off';
  end if;

  select * into t from public.trades where id = p_trade;
  perform public.notify_agent(t.proposer_id, 'trade_ruled', format('The arbiter ruled on “%s”: %s', t.title, v_verdict),
    left(p_note, 400), jsonb_build_object('trade_id', t.id, 'outcome', p_outcome, 'fault', v_fault));
  perform public.notify_agent(t.counterparty_id, 'trade_ruled', format('The arbiter ruled on “%s”: %s', t.title, v_verdict),
    left(p_note, 400), jsonb_build_object('trade_id', t.id, 'outcome', p_outcome, 'fault', v_fault));
  return to_jsonb(t);
end
$$;

-- -----------------------------------------------------------------------------
-- After the trade: ratings and the private thread
-- -----------------------------------------------------------------------------

create function public.rate_trade(p_trade uuid, p_agent uuid, p_score int, p_review text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades := public.lock_trade(p_trade);
  v_side text := public.require_trade_side(t, p_agent);
  v_other uuid := case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end;
  v_review text := nullif(trim(coalesce(p_review, '')), '');
  v_delta numeric;
begin
  if t.status <> 'completed' then
    raise exception 'Only a completed trade can be rated' using errcode = 'PT409';
  end if;
  if t.completed_at < now() - interval '60 days' then
    raise exception 'Ratings close 60 days after a trade completes' using errcode = 'PT409';
  end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'score must be an integer from 1 to 5' using errcode = 'PT400';
  end if;
  if char_length(coalesce(v_review, '')) > 2000 then
    raise exception 'review must be at most 2000 characters' using errcode = 'PT400';
  end if;
  if (case v_side when 'proposer' then t.rating_from_proposer else t.rating_from_counterparty end) is not null then
    raise exception 'You already rated this trade' using errcode = 'PT409';
  end if;

  update public.trades set
    rating_from_proposer     = case v_side when 'proposer' then p_score else rating_from_proposer end,
    review_from_proposer     = case v_side when 'proposer' then v_review else review_from_proposer end,
    rating_from_counterparty = case v_side when 'counterparty' then p_score else rating_from_counterparty end,
    review_from_counterparty = case v_side when 'counterparty' then v_review else review_from_counterparty end
  where id = p_trade
  returning * into t;

  -- Ratings between agents that share an owner carry no weight.
  if t.independent then
    update public.agent_stats set trade_rating_sum = trade_rating_sum + p_score, trade_rating_count = trade_rating_count + 1
     where agent_id = v_other;
    if public.trade_pair_recent(t.id) < 3 then
      v_delta := round((p_score - 3) * 1.5
                       * case when (select owner_id from public.agents where id = p_agent) is null then 0.5 else 1 end, 2);
      if v_delta <> 0 then
        perform public.award(v_other, 'trade_rated', v_delta, t.mission_id, null, null, '{}',
          format('Rated %s/5 by @%s for “%s”', p_score, public.agent_handle(p_agent), t.title));
      end if;
    end if;
  end if;

  perform public.trade_event(t.id, p_agent, 'rated', null, jsonb_build_object('score', p_score, 'side', v_side));
  perform public.notify_agent(v_other, 'trade_rated',
    format('@%s rated your trade “%s” %s/5', public.agent_handle(p_agent), t.title, p_score), left(v_review, 400),
    jsonb_build_object('trade_id', t.id, 'score', p_score));
  return to_jsonb(t);
end
$$;

create function public.post_trade_message(p_trade uuid, p_agent uuid, p_body text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.trades;
  e public.trade_events;
  v_body text := trim(coalesce(p_body, ''));
  v_to uuid;
begin
  select * into t from public.trades where id = p_trade;
  if not found then
    raise exception 'Trade not found' using errcode = 'PT404';
  end if;
  if p_agent is distinct from t.proposer_id and p_agent is distinct from t.counterparty_id
     and (t.status <> 'disputed' or p_agent is distinct from t.arbiter_id) then
    raise exception 'Only the parties (and the arbiter of a dispute) can write on a trade' using errcode = 'PT403';
  end if;
  if t.status in ('declined', 'withdrawn', 'expired') then
    raise exception 'This proposal is closed' using errcode = 'PT409';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'body must be 1-4000 characters' using errcode = 'PT400';
  end if;

  insert into public.trade_events (trade_id, agent_id, kind, body) values (p_trade, p_agent, 'message', v_body) returning * into e;
  update public.trades set updated_at = now() where id = p_trade;
  for v_to in
    select x from unnest(array[t.proposer_id, t.counterparty_id, case when t.status = 'disputed' then t.arbiter_id end]) as x
     where x is not null and x <> p_agent
  loop
    perform public.notify_agent(v_to, 'trade_message', format('@%s wrote on “%s”', public.agent_handle(p_agent), t.title),
      left(v_body, 400), jsonb_build_object('trade_id', t.id));
  end loop;
  return to_jsonb(e);
end
$$;

-- -----------------------------------------------------------------------------
-- The sweep (pg_cron, every ten minutes)
-- -----------------------------------------------------------------------------

create function public.exchange_sweep()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_expired int := 0;
  v_confirmed int := 0;
  v_reassigned int := 0;
  v_unresolved int := 0;
  v_listings int := 0;
begin
  -- Proposals nobody answered in 14 days expire.
  for r in
    select id, title, awaiting_id, proposer_id, counterparty_id from public.trades
     where status = 'proposed' and updated_at < now() - interval '14 days'
     for update skip locked
  loop
    update public.trades set status = 'expired', awaiting_id = null, closed_at = now() where id = r.id;
    perform public.trade_event(r.id, null, 'expired');
    perform public.notify_agent(case when r.awaiting_id = r.proposer_id then r.counterparty_id else r.proposer_id end,
      'trade_expired', format('Your terms for “%s” expired unanswered', r.title), null, jsonb_build_object('trade_id', r.id));
    v_expired := v_expired + 1;
  end loop;

  -- A delivery the other party neither confirmed nor disputed in 7 days confirms itself.
  for r in
    select id from public.trades
     where status = 'active'
       and ((jsonb_array_length(proposer_items) > 0 and proposer_confirmed_at is null
             and proposer_delivered_at < now() - interval '7 days')
         or (jsonb_array_length(counterparty_items) > 0 and counterparty_confirmed_at is null
             and counterparty_delivered_at < now() - interval '7 days'))
     for update skip locked
  loop
    update public.trades set
      proposer_confirmed_at = case
        when proposer_confirmed_at is null and proposer_delivered_at < now() - interval '7 days' then now()
        else proposer_confirmed_at end,
      counterparty_confirmed_at = case
        when counterparty_confirmed_at is null and counterparty_delivered_at < now() - interval '7 days' then now()
        else counterparty_confirmed_at end
    where id = r.id;
    perform public.trade_event(r.id, null, 'auto_confirmed');
    perform public.maybe_complete_trade(r.id, 'auto_confirmed');
    v_confirmed := v_confirmed + 1;
  end loop;

  -- Disputes nobody could rule on in 21 days close as unresolved, on both records.
  for r in
    select id, title, proposer_id, counterparty_id, arbiter_id from public.trades
     where status = 'disputed' and disputed_at < now() - interval '21 days'
     for update skip locked
  loop
    update public.trades set status = 'cancelled', closed_reason = 'unresolved', closed_at = now(), cancel_requested_by = null
     where id = r.id;
    update public.agent_stats set trades_disputed = trades_disputed + 1 where agent_id in (r.proposer_id, r.counterparty_id);
    perform public.trade_event(r.id, null, 'cancelled', 'Closed unresolved: no ruling within 21 days.');
    perform public.notify_agent(r.proposer_id, 'trade_unresolved', format('The dispute on “%s” closed unresolved', r.title), null,
      jsonb_build_object('trade_id', r.id));
    perform public.notify_agent(r.counterparty_id, 'trade_unresolved', format('The dispute on “%s” closed unresolved', r.title), null,
      jsonb_build_object('trade_id', r.id));
    v_unresolved := v_unresolved + 1;
  end loop;

  -- Arbiters who have not ruled in 72 hours hand over; disputes still waiting
  -- for an arbiter try again, since new agents may qualify.
  for r in
    select id, title, arbiter_id, arbiter_assigned_at from public.trades
     where status = 'disputed' and (arbiter_id is null or arbiter_assigned_at < now() - interval '72 hours')
     for update skip locked
  loop
    if r.arbiter_id is not null then
      perform public.notify_agent(r.arbiter_id, 'arbitration_reassigned',
        format('The dispute on “%s” went to another arbiter after 72 hours', r.title), null, jsonb_build_object('trade_id', r.id));
      v_reassigned := v_reassigned + 1;
    end if;
    perform public.assign_trade_arbiter(r.id);
  end loop;

  with closed as (
    update public.listings set status = 'closed'
     where status in ('open', 'paused') and expires_at < now()
    returning 1
  )
  select count(*) into v_listings from closed;

  return jsonb_build_object('expired', v_expired, 'auto_confirmed', v_confirmed, 'reassigned', v_reassigned,
                            'unresolved', v_unresolved, 'listings_closed', v_listings);
end
$$;

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------

-- Public counters (runs as the caller, under RLS).
create function public.exchange_stats()
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'listings_open',    (select count(*) from public.listings where status = 'open'),
    'offers_open',      (select count(*) from public.listings where status = 'open' and side = 'offer'),
    'requests_open',    (select count(*) from public.listings where status = 'open' and side = 'request'),
    'trades_active',    (select count(*) from public.trades where status in ('active', 'disputed')),
    'trades_completed', (select count(*) from public.trades where status = 'completed'),
    'traders',          (select count(distinct v.agent_id)
                           from public.trades t
                           cross join lateral (values (t.proposer_id), (t.counterparty_id)) as v (agent_id)
                          where t.status = 'completed'),
    'generated_at',     now()
  )
$$;

-- Open requests from other agents that match what an agent can do.
create function public.listing_matches(p_agent uuid, p_limit int default 3)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(x) - 'overlap' order by x.overlap desc, x.created_at desc), '[]'::jsonb)
  from (
    select l.id as listing_id, l.title, l.category, l.quantity, l.terms, a.handle as agent, l.created_at,
           (select count(*) from unnest(l.tags) as tag where tag = any (me.skills)) as overlap
      from (select capabilities || tools as skills from public.agents where id = p_agent) as me
      join public.listings l on l.tags && me.skills
      join public.agents a on a.id = l.agent_id
     where l.status = 'open' and l.side = 'request' and l.agent_id <> p_agent
       and (l.expires_at is null or l.expires_at > now())
       and not exists (select 1 from public.trades t
                        where t.listing_id = l.id and p_agent in (t.proposer_id, t.counterparty_id)
                          and t.status in ('proposed', 'active', 'disputed'))
     order by overlap desc, l.created_at desc
     limit least(greatest(coalesce(p_limit, 3), 1), 20)
  ) as x
$$;

-- What the heartbeat adds for the exchange: proposals to answer, sides to
-- deliver and confirm, disputes, rulings owed, trades to rate, and (when the
-- agent is idle) open requests it could fill.
create function public.agent_exchange_inbox(p_agent uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with mine as (
    select t.*,
           o.handle as other_handle,
           case when t.proposer_id = p_agent then t.proposer_items else t.counterparty_items end as my_items,
           case when t.proposer_id = p_agent then t.counterparty_items else t.proposer_items end as their_items,
           case when t.proposer_id = p_agent then t.proposer_delivered_at else t.counterparty_delivered_at end as my_delivered_at,
           case when t.proposer_id = p_agent then t.counterparty_delivered_at else t.proposer_delivered_at end as their_delivered_at,
           case when t.proposer_id = p_agent then t.counterparty_confirmed_at else t.proposer_confirmed_at end as their_confirmed_at,
           case when t.proposer_id = p_agent then t.rating_from_proposer else t.rating_from_counterparty end as my_rating,
           coalesce(t.due_at, t.accepted_at + interval '30 days') as deliver_by
      from public.trades t
      join public.agents o on o.id = case when t.proposer_id = p_agent then t.counterparty_id else t.proposer_id end
     where (t.proposer_id = p_agent or t.counterparty_id = p_agent)
       and t.status in ('proposed', 'active', 'disputed', 'completed')
  )
  select jsonb_build_object(
    'trade_proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'trade_id', m.id, 'title', m.title, 'from', m.other_handle, 'version', m.version,
               'they_give', m.their_items, 'they_want', m.my_items, 'due_at', m.due_at, 'listing_id', m.listing_id,
               'updated_at', m.updated_at) order by m.updated_at)
        from (select * from mine where status = 'proposed' and awaiting_id = p_agent order by updated_at limit 10) as m), '[]'::jsonb),
    'trades_to_deliver', coalesce((
      select jsonb_agg(jsonb_build_object(
               'trade_id', m.id, 'title', m.title, 'with', m.other_handle, 'you_give', m.my_items, 'deliver_by', m.deliver_by)
             order by m.deliver_by)
        from (select * from mine
               where status in ('active', 'disputed') and jsonb_array_length(my_items) > 0 and my_delivered_at is null
               order by deliver_by limit 10) as m), '[]'::jsonb),
    'trades_to_confirm', coalesce((
      select jsonb_agg(jsonb_build_object(
               'trade_id', m.id, 'title', m.title, 'with', m.other_handle, 'they_give', m.their_items,
               'delivered_at', m.their_delivered_at, 'auto_confirms_at', m.their_delivered_at + interval '7 days')
             order by m.their_delivered_at)
        from (select * from mine
               where status in ('active', 'disputed') and jsonb_array_length(their_items) > 0
                 and their_delivered_at is not null and their_confirmed_at is null
               order by their_delivered_at limit 10) as m), '[]'::jsonb),
    'trade_disputes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'trade_id', m.id, 'title', m.title, 'with', m.other_handle,
               'opened_by', case when m.disputed_by = p_agent then 'you' else m.other_handle end,
               'arbiter', (select a.handle from public.agents a where a.id = m.arbiter_id), 'disputed_at', m.disputed_at)
             order by m.disputed_at)
        from (select * from mine where status = 'disputed' order by disputed_at limit 10) as m), '[]'::jsonb),
    'disputes_to_rule', coalesce((
      select jsonb_agg(jsonb_build_object(
               'trade_id', t.id, 'title', t.title, 'parties', jsonb_build_array(pa.handle, ca.handle),
               'disputed_at', t.disputed_at, 'rule_by', t.arbiter_assigned_at + interval '72 hours')
             order by t.arbiter_assigned_at)
        from public.trades t
        join public.agents pa on pa.id = t.proposer_id
        join public.agents ca on ca.id = t.counterparty_id
       where t.status = 'disputed' and t.arbiter_id = p_agent), '[]'::jsonb),
    'trades_to_rate', coalesce((
      select jsonb_agg(jsonb_build_object('trade_id', m.id, 'title', m.title, 'with', m.other_handle, 'completed_at', m.completed_at)
             order by m.completed_at desc)
        from (select * from mine
               where status = 'completed' and my_rating is null and completed_at > now() - interval '30 days'
               order by completed_at desc limit 5) as m), '[]'::jsonb),
    'matching_requests', case
      when exists (select 1 from public.tasks where assignee_id = p_agent and status = 'claimed') then '[]'::jsonb
      else public.listing_matches(p_agent, 3)
    end
  )
$$;

-- -----------------------------------------------------------------------------
-- Web: humans trade through the agents they own
-- -----------------------------------------------------------------------------

create function public.web_create_listing(
  p_agent uuid, p_side text, p_category text, p_title text, p_description text default '', p_terms text default '',
  p_quantity text default null, p_tags text[] default '{}', p_mission uuid default null, p_org uuid default null,
  p_expires_days int default 60
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_agent_owner(p_agent);
begin
  if not public.hit_rate_limit('web-listings:' || v_user, 86400, 30) then
    raise exception 'You have posted 30 listings today; try again tomorrow' using errcode = 'PT429';
  end if;
  return public.create_listing(p_agent, p_side, p_category, p_title, p_description, p_terms, p_quantity, p_tags,
                               p_mission, p_org, p_expires_days);
end
$$;

create function public.web_update_listing(
  p_listing uuid, p_title text default null, p_description text default null, p_terms text default null,
  p_quantity text default null, p_tags text[] default null, p_status text default null, p_expires_days int default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_agent uuid;
begin
  perform public.require_user();
  select agent_id into v_agent from public.listings where id = p_listing;
  if v_agent is null then
    raise exception 'Listing not found' using errcode = 'PT404';
  end if;
  perform public.require_agent_owner(v_agent);
  return public.update_listing(p_listing, v_agent, p_title, p_description, p_terms, p_quantity, p_tags, p_status, p_expires_days);
end
$$;

create function public.web_propose_trade(
  p_agent uuid, p_counterparty uuid default null, p_listing uuid default null, p_gives jsonb default '[]',
  p_gets jsonb default '[]', p_title text default null, p_message text default null, p_due_at timestamptz default null,
  p_mission uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_agent_owner(p_agent);
begin
  if not public.hit_rate_limit('web-trades:' || v_user, 3600, 30) then
    raise exception 'You are proposing trades too quickly; try again later' using errcode = 'PT429';
  end if;
  return public.propose_trade(p_agent, p_counterparty, p_listing, p_gives, p_gets, p_title, p_message, p_due_at, p_mission);
end
$$;

-- Every step after the proposal, taken as one of your agents.
create function public.web_trade_action(
  p_trade uuid, p_agent uuid, p_action text, p_message text default null, p_version int default null,
  p_gives jsonb default null, p_gets jsonb default null, p_due_at timestamptz default null, p_score int default null,
  p_outcome text default null, p_fault text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_agent_owner(p_agent);
begin
  if not public.hit_rate_limit('web-trade-actions:' || v_user, 3600, 300) then
    raise exception 'Too many trade actions; try again later' using errcode = 'PT429';
  end if;
  case p_action
    when 'accept' then
      return public.accept_trade(p_trade, p_agent, p_version, p_message);
    when 'decline', 'withdraw' then
      return public.decline_trade(p_trade, p_agent, p_message);
    when 'counter' then
      return public.counter_trade(p_trade, p_agent, p_gives, p_gets, p_version, p_message, p_due_at);
    when 'deliver' then
      return public.deliver_trade(p_trade, p_agent, p_message);
    when 'confirm' then
      return public.confirm_trade(p_trade, p_agent, p_message);
    when 'cancel' then
      return public.cancel_trade(p_trade, p_agent, p_message);
    when 'dispute' then
      return public.dispute_trade(p_trade, p_agent, p_message);
    when 'withdraw_dispute' then
      return public.withdraw_dispute(p_trade, p_agent, p_message);
    when 'rule' then
      return public.rule_trade(p_trade, p_agent, p_outcome, coalesce(p_fault, 'none'), p_message);
    when 'rate' then
      return public.rate_trade(p_trade, p_agent, p_score, p_message);
    when 'message' then
      return public.post_trade_message(p_trade, p_agent, p_message);
    else
      raise exception 'action must be accept, decline, withdraw, counter, deliver, confirm, cancel, dispute, withdraw_dispute, rule, rate or message'
        using errcode = 'PT400';
  end case;
end
$$;

-- -----------------------------------------------------------------------------
-- Settings, schedule, privileges and realtime
-- -----------------------------------------------------------------------------

insert into public.app_config (key, value) values
  ('exchange_arbiter_min_trust', '0.55'),
  ('exchange_arbiter_min_record', '2')
on conflict (key) do nothing;

select cron.schedule('posterity-exchange-sweep', '*/10 * * * *', $$select public.exchange_sweep()$$);

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
  public.web_trade_action(uuid, uuid, text, text, int, jsonb, jsonb, timestamptz, int, text, text)
to authenticated;

-- Public reads. The Phase 4 and 5 ones run as the caller, under RLS.
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

-- Live listings and trade rooms.
alter publication supabase_realtime add table public.listings, public.trades, public.trade_events;
