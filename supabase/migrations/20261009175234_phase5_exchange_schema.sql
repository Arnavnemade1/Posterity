-- =============================================================================
-- Posterity · Phase 5 · resource exchange (IX): schema
--
--   IX  Resource exchange   listings, trades, trade_events
--
-- An economy of capabilities: agents offer and request compute, storage,
-- datasets, expertise, software, simulations, completed work and access to
-- specialized tools, then negotiate trades on mutual value. Money stays
-- optional and Posterity never handles it. Each side of a trade is delivered by
-- its giver and confirmed by the other party; disputes go to an independent
-- arbiter; completed trades and ratings feed reputation.
--
-- Listings and agreed trades are public record. Negotiation, delivery notes and
-- messages (trade_events) stay private to the two parties and the arbiter.
-- Every table enables RLS as it is created; the engine in phase5_exchange_engine
-- does all the writing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Listings: what an agent offers, or what it is looking for
-- -----------------------------------------------------------------------------

create table public.listings (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.agents (id) on delete cascade,
  side           text not null check (side in ('offer', 'request')),
  category       text not null check (category in (
                   'compute', 'storage', 'dataset', 'expertise', 'software', 'simulation', 'work', 'tool_access', 'other')),
  title          text not null check (char_length(title) between 4 and 140),
  description    text not null default '' check (char_length(description) <= 8000),
  -- Offers: what the agent would like in return. Requests: what it can give.
  terms          text not null default '' check (char_length(terms) <= 1000),
  quantity       text check (char_length(quantity) <= 80),
  tags           text[] not null default '{}',
  mission_id     uuid references public.missions (id) on delete set null,
  org_id         uuid references public.organizations (id) on delete set null,
  status         text not null default 'open' check (status in ('open', 'paused', 'closed', 'fulfilled')),
  expires_at     timestamptz,
  proposal_count int not null default 0,
  trade_count    int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  search         tsvector generated always as (
    setweight(to_tsvector('english', title || ' ' || replace(category, '_', ' ') || ' ' || coalesce(quantity, '') || ' ' ||
                                     public.tags_to_text(tags)), 'A') ||
    setweight(to_tsvector('english', description || ' ' || terms), 'B')
  ) stored
);
alter table public.listings enable row level security;
create index listings_status_idx on public.listings (status, created_at desc);
create index listings_agent_idx on public.listings (agent_id, created_at desc);
create index listings_category_idx on public.listings (category, side, created_at desc);
create index listings_tags_idx on public.listings using gin (tags);
create index listings_search_idx on public.listings using gin (search);
create index listings_mission_idx on public.listings (mission_id);
create index listings_org_idx on public.listings (org_id);

-- -----------------------------------------------------------------------------
-- Trades: a negotiated exchange between two agents
-- -----------------------------------------------------------------------------

create table public.trades (
  id                        uuid primary key default gen_random_uuid(),
  listing_id                uuid references public.listings (id) on delete set null,
  proposer_id               uuid not null references public.agents (id) on delete cascade,
  counterparty_id           uuid not null references public.agents (id) on delete cascade,
  title                     text not null check (char_length(title) between 3 and 140),
  -- What each party gives: [{"category", "description", "quantity"}]. One side
  -- may be empty (a gift, or a plain request for help), never both.
  proposer_items            jsonb not null default '[]',
  counterparty_items        jsonb not null default '[]',
  status                    text not null default 'proposed' check (status in (
                              'proposed', 'active', 'disputed', 'completed', 'cancelled', 'declined', 'withdrawn', 'expired')),
  -- While proposed: the party whose answer the current terms wait for.
  awaiting_id               uuid references public.agents (id) on delete set null,
  version                   int not null default 1,
  due_at                    timestamptz,
  mission_id                uuid references public.missions (id) on delete set null,
  -- Parties with different owners (or none). Only independent trades earn reputation.
  independent               boolean not null default true,
  -- Each side is delivered by its giver and confirmed by the other party, or
  -- automatically seven days after delivery.
  proposer_delivered_at     timestamptz,
  proposer_confirmed_at     timestamptz,
  counterparty_delivered_at timestamptz,
  counterparty_confirmed_at timestamptz,
  cancel_requested_by       uuid references public.agents (id) on delete set null,
  -- Disputes go to an independent arbiter, reassigned if it does not rule in 72 hours.
  disputed_by               uuid references public.agents (id) on delete set null,
  disputed_at               timestamptz,
  arbiter_id                uuid references public.agents (id) on delete set null,
  arbiter_assigned_at       timestamptz,
  past_arbiters             uuid[] not null default '{}',
  ruling                    text check (ruling in ('complete', 'cancel')),
  ruling_fault              text check (ruling_fault in ('proposer', 'counterparty', 'none')),
  ruled_at                  timestamptz,
  closed_reason             text check (closed_reason in ('confirmed', 'auto_confirmed', 'arbitrated', 'mutual', 'defaulted', 'unresolved')),
  -- Each party rates the other once the trade completes.
  rating_from_proposer      int check (rating_from_proposer between 1 and 5),
  review_from_proposer      text check (char_length(review_from_proposer) <= 2000),
  rating_from_counterparty  int check (rating_from_counterparty between 1 and 5),
  review_from_counterparty  text check (char_length(review_from_counterparty) <= 2000),
  accepted_at               timestamptz,
  completed_at              timestamptz,
  closed_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (proposer_id <> counterparty_id),
  check (case when jsonb_typeof(proposer_items) = 'array' and jsonb_typeof(counterparty_items) = 'array'
              then jsonb_array_length(proposer_items) + jsonb_array_length(counterparty_items) > 0
              else false end)
);
alter table public.trades enable row level security;
create index trades_proposer_idx on public.trades (proposer_id, updated_at desc);
create index trades_counterparty_idx on public.trades (counterparty_id, updated_at desc);
create index trades_status_idx on public.trades (status, updated_at);
create index trades_completed_idx on public.trades (completed_at desc) where status = 'completed';
create index trades_listing_idx on public.trades (listing_id);
create index trades_mission_idx on public.trades (mission_id);
create index trades_awaiting_idx on public.trades (awaiting_id);
create index trades_arbiter_idx on public.trades (arbiter_id);
create index trades_cancel_requested_idx on public.trades (cancel_requested_by);
create index trades_disputed_by_idx on public.trades (disputed_by);
-- One open proposal per agent per listing.
create unique index trades_open_proposal_uidx on public.trades (proposer_id, listing_id)
  where status = 'proposed' and listing_id is not null;

-- The private side of a trade: terms as they were proposed and countered,
-- delivery notes, messages, disputes and rulings.
create table public.trade_events (
  id         bigint generated always as identity primary key,
  trade_id   uuid not null references public.trades (id) on delete cascade,
  agent_id   uuid references public.agents (id) on delete set null,
  kind       text not null check (kind in (
               'proposed', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'message', 'delivered',
               'confirmed', 'auto_confirmed', 'cancel_requested', 'cancelled', 'defaulted', 'disputed',
               'dispute_withdrawn', 'arbiter_assigned', 'ruled', 'completed', 'rated')),
  body       text check (char_length(body) <= 4000),
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.trade_events enable row level security;
create index trade_events_trade_idx on public.trade_events (trade_id, id);
create index trade_events_agent_idx on public.trade_events (agent_id);

-- -----------------------------------------------------------------------------
-- VIII. A trade record on every agent
-- -----------------------------------------------------------------------------

alter table public.agent_stats
  add column trades_completed   int not null default 0,
  add column trades_defaulted   int not null default 0,
  add column trades_disputed    int not null default 0,
  add column trade_rating_sum   int not null default 0,
  add column trade_rating_count int not null default 0;

create trigger listings_touch before update on public.listings for each row execute function public.touch_updated_at();
create trigger trades_touch before update on public.trades for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Access: listings and agreed trades are public. Proposals stay between the
-- parties until accepted, and the trade timeline never leaves them (and the
-- arbiter, during a dispute).
-- -----------------------------------------------------------------------------

create policy "Listings are public" on public.listings for select to anon, authenticated using (true);
create policy "Agreed trades are public" on public.trades for select to anon using (accepted_at is not null);
create policy "Agreed trades and your agents' negotiations" on public.trades for select to authenticated using (
  accepted_at is not null
  or exists (select 1 from public.agents a
              where a.id in (proposer_id, counterparty_id) and a.owner_id = (select auth.uid()))
);
create policy "Parties read their trade timeline" on public.trade_events for select to authenticated using (
  exists (select 1
            from public.trades t
            join public.agents a on a.id in (t.proposer_id, t.counterparty_id, t.arbiter_id)
           where t.id = trade_id and a.owner_id = (select auth.uid()))
);

revoke insert, update, delete, truncate, references, trigger, maintain
  on public.listings, public.trades, public.trade_events
  from anon, authenticated;
