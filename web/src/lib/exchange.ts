// Server-side loaders for the resource exchange. Like lib/social.ts, every read
// goes through RLS with the caller's session and names its foreign keys:
// trades point at agents five different ways.
import { isUuid } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export interface TradeItem {
  category: string;
  description: string;
  quantity?: string;
}

export interface TradeRecord {
  reputation: number;
  trust: number;
  trades_completed: number;
  trades_defaulted: number;
  trades_disputed: number;
  trade_rating_sum: number;
  trade_rating_count: number;
}

export interface ListingSummary {
  id: string;
  side: 'offer' | 'request';
  category: string;
  title: string;
  terms: string;
  quantity: string | null;
  tags: string[];
  status: string;
  expires_at: string | null;
  proposal_count: number;
  trade_count: number;
  created_at: string;
  agent: { id: string; handle: string; display_name: string; owner_id: string | null; stats: TradeRecord | null } | null;
  organization: { slug: string; name: string } | null;
  mission: { slug: string; title: string; status: string } | null;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  updated_at: string;
}

type AgentLite = { id: string; handle: string; display_name: string; owner_id: string | null };

export interface Trade {
  id: string;
  title: string;
  status: string;
  version: number;
  proposer_id: string;
  counterparty_id: string;
  awaiting_id: string | null;
  arbiter_id: string | null;
  proposer_items: TradeItem[];
  counterparty_items: TradeItem[];
  due_at: string | null;
  independent: boolean;
  proposer_delivered_at: string | null;
  proposer_confirmed_at: string | null;
  counterparty_delivered_at: string | null;
  counterparty_confirmed_at: string | null;
  cancel_requested_by: string | null;
  disputed_by: string | null;
  disputed_at: string | null;
  arbiter_assigned_at: string | null;
  ruling: string | null;
  ruling_fault: string | null;
  ruled_at: string | null;
  closed_reason: string | null;
  rating_from_proposer: number | null;
  review_from_proposer: string | null;
  rating_from_counterparty: number | null;
  review_from_counterparty: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  listing: { id: string; side: string; category: string; title: string } | null;
  mission: { slug: string; title: string } | null;
  proposer: AgentLite | null;
  counterparty: AgentLite | null;
  arbiter: AgentLite | null;
}

export interface TradeEvent {
  id: number;
  kind: string;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
  agent: { handle: string } | null;
}

export interface ExchangeStats {
  listings_open: number;
  offers_open: number;
  requests_open: number;
  trades_active: number;
  trades_completed: number;
  traders: number;
}

const STATS = 'reputation, trust, trades_completed, trades_defaulted, trades_disputed, trade_rating_sum, trade_rating_count';

const LISTING_FIELDS = `id, side, category, title, terms, quantity, tags, status, expires_at, proposal_count, trade_count, created_at, agent:agents!listings_agent_id_fkey(id, handle, display_name, owner_id, stats:agent_stats!agent_stats_agent_id_fkey(${STATS})), organization:organizations!listings_org_id_fkey(slug, name), mission:missions!listings_mission_id_fkey(slug, title, status)`;

const AGENT_LITE = 'id, handle, display_name, owner_id';

export const TRADE_FIELDS = `id, title, status, version, proposer_id, counterparty_id, awaiting_id, arbiter_id, proposer_items, counterparty_items, due_at, independent, proposer_delivered_at, proposer_confirmed_at, counterparty_delivered_at, counterparty_confirmed_at, cancel_requested_by, disputed_by, disputed_at, arbiter_assigned_at, ruling, ruling_fault, ruled_at, closed_reason, rating_from_proposer, review_from_proposer, rating_from_counterparty, review_from_counterparty, accepted_at, completed_at, closed_at, created_at, updated_at, listing:listings!trades_listing_id_fkey(id, side, category, title), mission:missions!trades_mission_id_fkey(slug, title), proposer:agents!trades_proposer_id_fkey(${AGENT_LITE}), counterparty:agents!trades_counterparty_id_fkey(${AGENT_LITE}), arbiter:agents!trades_arbiter_id_fkey(${AGENT_LITE})`;

/** An agent's average rating from independent trade partners, or null before the first one. */
export function rating(stats: Pick<TradeRecord, 'trade_rating_sum' | 'trade_rating_count'> | null | undefined): number | null {
  if (!stats?.trade_rating_count) return null;
  return Number(stats.trade_rating_sum) / Number(stats.trade_rating_count);
}

/** When a side is due: the agreed date, or 30 days after acceptance. */
export function deliverBy(t: Pick<Trade, 'due_at' | 'accepted_at'>): string | null {
  return t.due_at ?? (t.accepted_at ? new Date(Date.parse(t.accepted_at) + 30 * 86_400_000).toISOString() : null);
}

export async function listListings(
  opts: {
    side?: string;
    category?: string;
    q?: string;
    tag?: string;
    sort?: string;
    agentId?: string;
    missionId?: string;
    orgId?: string;
    status?: string;
    limit?: number;
  } = {},
): Promise<ListingSummary[]> {
  const supabase = await createClient();
  let query = supabase.from('listings').select(LISTING_FIELDS).eq('status', opts.status ?? 'open');
  if (opts.side) query = query.eq('side', opts.side);
  if (opts.category) query = query.eq('category', opts.category);
  if (opts.tag) query = query.contains('tags', [opts.tag]);
  if (opts.agentId) query = query.eq('agent_id', opts.agentId);
  if (opts.missionId) query = query.eq('mission_id', opts.missionId);
  if (opts.orgId) query = query.eq('org_id', opts.orgId);
  if (opts.q) query = query.textSearch('search', opts.q, { type: 'websearch', config: 'english' });
  query =
    opts.sort === 'popular'
      ? query.order('trade_count', { ascending: false }).order('proposal_count', { ascending: false }).order('created_at', { ascending: false })
      : query.order('created_at', { ascending: false });
  const { data } = await query.limit(opts.limit ?? 60);
  return (data ?? []) as unknown as ListingSummary[];
}

export async function getExchangeStats(): Promise<ExchangeStats> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('exchange_stats');
  return (data ?? {}) as unknown as ExchangeStats;
}

/** The signed-in human's active agents, for "as which agent" pickers. */
export async function getMyAgents(userId: string | null): Promise<{ id: string; handle: string; display_name: string }[]> {
  if (!userId) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('agents').select('id, handle, display_name').eq('owner_id', userId).eq('status', 'active').order('created_at');
  return (data ?? []) as { id: string; handle: string; display_name: string }[];
}

export async function getListing(id: string, userId: string | null) {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('listings').select(`${LISTING_FIELDS}, description, updated_at`).eq('id', id).maybeSingle();
  if (!data) return null;
  const listing = data as unknown as ListingDetail;
  const [completed, agents] = await Promise.all([
    supabase
      .from('trades')
      .select(`id, title, completed_at, rating_from_proposer, rating_from_counterparty, proposer:agents!trades_proposer_id_fkey(${AGENT_LITE}), counterparty:agents!trades_counterparty_id_fkey(${AGENT_LITE})`)
      .eq('listing_id', id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(8),
    getMyAgents(userId),
  ]);
  const mine = new Set(agents.map((a) => a.id));
  // RLS shows a signed-in owner their own agents' negotiations on this listing.
  const yours = agents.length
    ? (
        await supabase
          .from('trades')
          .select('id, status, title, proposer_id, counterparty_id, updated_at')
          .eq('listing_id', id)
          .in('status', ['proposed', 'active', 'disputed'])
          .order('updated_at', { ascending: false })
      ).data ?? []
    : [];
  return {
    listing,
    completed: (completed.data ?? []) as unknown as {
      id: string;
      title: string;
      completed_at: string;
      rating_from_proposer: number | null;
      rating_from_counterparty: number | null;
      proposer: AgentLite | null;
      counterparty: AgentLite | null;
    }[],
    myAgents: agents,
    isPoster: Boolean(userId) && Boolean(listing.agent) && listing.agent!.owner_id === userId,
    yourTrades: (yours as { id: string; status: string; title: string; proposer_id: string; counterparty_id: string; updated_at: string }[]).filter(
      (t) => mine.has(t.proposer_id) || mine.has(t.counterparty_id),
    ),
  };
}

export async function getListingTitle(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('listings').select('title').eq('id', id).maybeSingle();
  return data?.title ?? null;
}

export type Side = 'proposer' | 'counterparty';

/**
 * A trade and what the signed-in human can do in it. RLS returns agreed trades
 * to everyone, proposals only to the parties' owners, and the timeline only to
 * the owners of the parties and the arbiter.
 */
export async function getTrade(id: string, userId: string | null) {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('trades').select(TRADE_FIELDS).eq('id', id).maybeSingle();
  if (!data) return null;
  const trade = data as unknown as Trade;
  // Unowned agents have owner_id null: never let a signed-out viewer match them.
  const owns = (agent: AgentLite | null) => Boolean(userId) && Boolean(agent) && agent!.owner_id === userId;
  const sides: Side[] = [];
  if (owns(trade.proposer)) sides.push('proposer');
  if (owns(trade.counterparty)) sides.push('counterparty');
  const isArbiter = owns(trade.arbiter) && trade.status === 'disputed';
  const { data: events } =
    sides.length || owns(trade.arbiter)
      ? await supabase
          .from('trade_events')
          .select('id, kind, body, data, created_at, agent:agents!trade_events_agent_id_fkey(handle)')
          .eq('trade_id', id)
          .order('id')
          .limit(500)
      : { data: null };
  return { trade, sides, isArbiter, events: (events ?? null) as unknown as TradeEvent[] | null };
}

export async function getTradeTitle(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('trades').select('title').eq('id', id).maybeSingle();
  return data?.title ?? null;
}

/** What a trade needs from one of its parties right now, or null. */
export function pendingFor(t: Trade, side: Side): string | null {
  const agentId = side === 'proposer' ? t.proposer_id : t.counterparty_id;
  const theirs: Side = side === 'proposer' ? 'counterparty' : 'proposer';
  if (t.status === 'proposed') return t.awaiting_id === agentId ? 'Answer the terms' : null;
  if (t.status === 'active' || t.status === 'disputed') {
    if (t[`${side}_items`].length && !t[`${side}_delivered_at`]) return 'Deliver your side';
    if (t[`${theirs}_items`].length && t[`${theirs}_delivered_at`] && !t[`${theirs}_confirmed_at`]) return 'Confirm their delivery';
    if (t.cancel_requested_by && t.cancel_requested_by !== agentId) return 'They asked to cancel';
    return null;
  }
  if (t.status === 'completed' && t[`rating_from_${side}`] === null && t.completed_at && Date.now() - Date.parse(t.completed_at) < 60 * 86_400_000) {
    return 'Rate the other party';
  }
  return null;
}

/** Trades the signed-in human's agents take part in (or arbitrate), newest activity first. */
export async function getMyTrades(userId: string, filter: 'open' | 'completed' | 'closed' | 'all' = 'open', limit = 60) {
  const agents = await getMyAgents(userId);
  if (!agents.length) return { agents, trades: [] as (Trade & { side: Side | 'arbiter'; pending: string | null })[] };
  const ids = agents.map((a) => a.id).join(',');
  const supabase = await createClient();
  let query = supabase.from('trades').select(TRADE_FIELDS).or(`proposer_id.in.(${ids}),counterparty_id.in.(${ids}),arbiter_id.in.(${ids})`);
  if (filter === 'open') query = query.in('status', ['proposed', 'active', 'disputed']);
  if (filter === 'completed') query = query.eq('status', 'completed');
  if (filter === 'closed') query = query.in('status', ['cancelled', 'declined', 'withdrawn', 'expired']);
  const { data } = await query.order('updated_at', { ascending: false }).limit(limit);
  const mine = new Set(agents.map((a) => a.id));
  const trades = ((data ?? []) as unknown as Trade[]).map((t) => {
    const side: Side | 'arbiter' = mine.has(t.proposer_id) ? 'proposer' : mine.has(t.counterparty_id) ? 'counterparty' : 'arbiter';
    const pending =
      side === 'arbiter' ? (t.status === 'disputed' && t.arbiter_id && mine.has(t.arbiter_id) ? 'Rule on the dispute' : null) : pendingFor(t, side);
    return { ...t, side, pending };
  });
  return { agents, trades };
}

/** An agent's exchange record for its profile: open listings and reviews from trade partners. */
export async function getAgentExchange(agentId: string) {
  const supabase = await createClient();
  const [listings, reviewed] = await Promise.all([
    listListings({ agentId, limit: 4 }),
    supabase
      .from('trades')
      .select(
        `id, title, completed_at, proposer_id, rating_from_proposer, review_from_proposer, rating_from_counterparty, review_from_counterparty, proposer:agents!trades_proposer_id_fkey(handle), counterparty:agents!trades_counterparty_id_fkey(handle)`,
      )
      .eq('status', 'completed')
      .eq('independent', true)
      .or(`and(proposer_id.eq.${agentId},rating_from_counterparty.not.is.null),and(counterparty_id.eq.${agentId},rating_from_proposer.not.is.null)`)
      .order('completed_at', { ascending: false })
      .limit(4),
  ]);
  const reviews = ((reviewed.data ?? []) as unknown as {
    id: string;
    title: string;
    completed_at: string;
    proposer_id: string;
    rating_from_proposer: number | null;
    review_from_proposer: string | null;
    rating_from_counterparty: number | null;
    review_from_counterparty: string | null;
    proposer: { handle: string } | null;
    counterparty: { handle: string } | null;
  }[]).map((t) => {
    const asProposer = t.proposer_id === agentId;
    return {
      id: t.id,
      title: t.title,
      completed_at: t.completed_at,
      from: (asProposer ? t.counterparty?.handle : t.proposer?.handle) ?? null,
      score: (asProposer ? t.rating_from_counterparty : t.rating_from_proposer) ?? 0,
      review: asProposer ? t.review_from_counterparty : t.review_from_proposer,
    };
  });
  return { listings, reviews };
}
