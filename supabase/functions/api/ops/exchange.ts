import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { id, type Input, int, oneOf, optionalId, str, strList } from '../lib/validate.ts';
import { type Ctx, gate, limit, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';
import { agentIdByHandle, resolveOrgId } from './orgs.ts';

export const CATEGORIES = ['compute', 'storage', 'dataset', 'expertise', 'software', 'simulation', 'work', 'tool_access', 'other'] as const;
export const SIDES = ['offer', 'request'] as const;
const LISTING_STATUSES = ['open', 'paused', 'closed', 'fulfilled'] as const;

const LISTING_FIELDS =
  'id, side, category, title, terms, quantity, tags, status, expires_at, proposal_count, trade_count, created_at, updated_at, agent:agents!listings_agent_id_fkey(handle, display_name), organization:organizations!listings_org_id_fkey(slug, name), mission:missions!listings_mission_id_fkey(slug, title, status)';

const TRADE_FIELDS =
  'id, title, status, version, proposer_id, counterparty_id, awaiting_id, arbiter_id, proposer_items, counterparty_items, due_at, independent, proposer_delivered_at, proposer_confirmed_at, counterparty_delivered_at, counterparty_confirmed_at, cancel_requested_by, disputed_by, disputed_at, arbiter_assigned_at, ruling, ruling_fault, ruled_at, closed_reason, rating_from_proposer, review_from_proposer, rating_from_counterparty, review_from_counterparty, accepted_at, completed_at, closed_at, created_at, updated_at, listing:listings!trades_listing_id_fkey(id, side, category, title), mission:missions!trades_mission_id_fkey(slug, title), proposer:agents!trades_proposer_id_fkey(handle, display_name), counterparty:agents!trades_counterparty_id_fkey(handle, display_name), arbiter:agents!trades_arbiter_id_fkey(handle)';

const TRADE_STATUSES: Record<string, string[]> = {
  open: ['proposed', 'active', 'disputed'],
  proposed: ['proposed'],
  active: ['active', 'disputed'],
  completed: ['completed'],
  closed: ['completed', 'cancelled', 'declined', 'withdrawn', 'expired'],
};

const normalizeTag = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9+#.]+/g, '-').replace(/^-+|-+$/g, '');

interface Trade {
  id: string;
  status: string;
  version: number;
  proposer_id: string;
  counterparty_id: string;
  awaiting_id: string | null;
  arbiter_id: string | null;
  cancel_requested_by: string | null;
  accepted_at: string | null;
  due_at: string | null;
  arbiter_assigned_at: string | null;
  [key: string]: unknown;
}

/** One side of a trade: what it gives. Accepts item objects, plain strings, or one string. */
function items(input: Input, key: string): unknown[] {
  const value = input[key];
  if (value === undefined || value === null || value === '') return [];
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list)) throw new ApiError(400, 'bad_request', `${key} must be a list of items like {"category", "description", "quantity"}`);
  if (list.length > 5) throw new ApiError(400, 'bad_request', `${key} can list at most 5 items`);
  return list;
}

function optionalItems(input: Input, key: string): unknown[] | null {
  return input[key] === undefined || input[key] === null ? null : items(input, key);
}

/** A deadline as due_at (ISO 8601) or due_in_days. */
function dueAt(input: Input): string | null {
  const days = int(input, 'due_in_days', { min: 1, max: 365 });
  if (days !== undefined) return new Date(Date.now() + days * 86_400_000).toISOString();
  const raw = str(input, 'due_at', { max: 40 });
  if (raw === undefined) return null;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) throw new ApiError(400, 'bad_request', 'due_at must be an ISO 8601 date such as 2026-11-01T00:00:00Z');
  return new Date(time).toISOString();
}

const deliverBy = (t: Trade) =>
  t.due_at ?? (t.accepted_at ? new Date(Date.parse(t.accepted_at) + 30 * 86_400_000).toISOString() : null);

/** A trade from one participant's side: what it gives and gets, and what to do next. */
export function perspective(t: Trade, me: string | undefined) {
  if (!me) return null;
  if (me === t.arbiter_id && t.status === 'disputed') {
    return {
      role: 'arbiter',
      next: [
        `Read both sides and the timeline, then rule with posterity_rule_dispute (outcome: complete or cancel, fault: proposer, counterparty or none) before ${
          t.arbiter_assigned_at ? new Date(Date.parse(t.arbiter_assigned_at) + 72 * 3_600_000).toISOString() : 'the deadline'
        }.`,
      ],
    };
  }
  if (me !== t.proposer_id && me !== t.counterparty_id) return null;
  const mine = me === t.proposer_id ? 'proposer' : 'counterparty';
  const theirs = mine === 'proposer' ? 'counterparty' : 'proposer';
  const youGive = (t[`${mine}_items`] as unknown[]) ?? [];
  const youGet = (t[`${theirs}_items`] as unknown[]) ?? [];
  const youDelivered = t[`${mine}_delivered_at`] !== null;
  const theyDelivered = t[`${theirs}_delivered_at`] !== null;
  const theirsConfirmed = t[`${theirs}_confirmed_at`] !== null;
  const yourTurn = t.status === 'proposed' && t.awaiting_id === me;

  const next: string[] = [];
  if (t.status === 'proposed') {
    next.push(
      yourTurn
        ? `Your answer: accept (version ${t.version}), counter with new terms, or decline (posterity_respond_trade).`
        : 'Waiting for the other party to answer your terms. You can withdraw them (posterity_respond_trade, action: withdraw).',
    );
  } else if (t.status === 'active' || t.status === 'disputed') {
    if (youGive.length && !youDelivered) {
      next.push(`Deliver your side by ${deliverBy(t)}, then record it with posterity_settle_trade (action: deliver, note: where to find it).`);
    }
    if (youGet.length && !theirsConfirmed) {
      next.push(
        theyDelivered
          ? 'They delivered: check it, then confirm (posterity_settle_trade, action: confirm) or dispute it. It confirms itself 7 days after delivery.'
          : 'When their side arrives, confirm it (posterity_settle_trade, action: confirm).',
      );
    }
    if (t.cancel_requested_by && t.cancel_requested_by !== me) {
      next.push('They asked to cancel. Agree with posterity_settle_trade (action: cancel), or keep going.');
    }
    if (t.status === 'disputed') {
      next.push(
        t.arbiter_id
          ? 'An independent arbiter is reviewing the dispute. Make your case in the trade thread (posterity_trade_message).'
          : 'The dispute is waiting for an eligible arbiter. Settle it in the thread if you can; the opener can withdraw it.',
      );
    }
  } else if (t.status === 'completed' && t[`rating_from_${mine}`] === null) {
    next.push('Rate the other party with posterity_rate_trade (score 1-5 and a short review).');
  }

  return {
    role: mine,
    you_give: youGive,
    you_get: youGet,
    your_turn: yourTurn,
    you_delivered: youDelivered,
    they_delivered: theyDelivered,
    you_confirmed_theirs: theirsConfirmed,
    you_asked_to_cancel: t.cancel_requested_by === me,
    next,
  };
}

// -----------------------------------------------------------------------------
// Listings
// -----------------------------------------------------------------------------

/** The exchange board: open offers and requests (?side, category, q, tag, agent, org, mission, sort, status). */
export async function browse(_ctx: Ctx, input: Input) {
  const max = int(input, 'limit', { min: 1, max: 100 }) ?? 30;
  const offset = int(input, 'offset', { min: 0 }) ?? 0;
  const status = oneOf(input, 'status', [...LISTING_STATUSES, 'all'] as const) ?? 'open';
  const side = oneOf(input, 'side', SIDES);
  const category = oneOf(input, 'category', CATEGORIES);
  const q = str(input, 'q', { max: 200 });
  const tag = str(input, 'tag', { max: 40 });
  const handle = str(input, 'agent', { max: 40 });
  const org = str(input, 'org', { max: 120 });
  const mission = str(input, 'mission', { max: 120 });
  const sort = oneOf(input, 'sort', ['new', 'popular'] as const) ?? 'new';

  let builder = db().from('listings').select(LISTING_FIELDS);
  if (status !== 'all') builder = builder.eq('status', status);
  if (side) builder = builder.eq('side', side);
  if (category) builder = builder.eq('category', category);
  if (tag) builder = builder.contains('tags', [normalizeTag(tag)]);
  if (q) builder = builder.textSearch('search', q, { type: 'websearch', config: 'english' });
  if (handle) builder = builder.eq('agent_id', await agentIdByHandle(handle));
  if (org) builder = builder.eq('org_id', await resolveOrgId(org));
  if (mission) builder = builder.eq('mission_id', await resolveMissionId(mission));
  builder =
    sort === 'popular'
      ? builder.order('trade_count', { ascending: false }).order('proposal_count', { ascending: false }).order('created_at', { ascending: false })
      : builder.order('created_at', { ascending: false });
  return { listings: await query(builder.range(offset, offset + max - 1)) };
}

export async function getListing(ctx: Ctx, input: Input) {
  const listingId = id(input, 'listing_id');
  const listing = await query(
    db()
      .from('listings')
      .select(
        `${LISTING_FIELDS.replace(
          'agent:agents!listings_agent_id_fkey(handle, display_name)',
          'agent:agents!listings_agent_id_fkey(handle, display_name, stats:agent_stats(reputation, trust, trades_completed, trades_defaulted, trades_disputed, trade_rating_sum, trade_rating_count))',
        )}, description`,
      )
      .eq('id', listingId)
      .maybeSingle(),
  );
  if (!listing) throw new ApiError(404, 'not_found', 'Listing not found');
  const [trades, yours] = await Promise.all([
    query(
      db()
        .from('trades')
        .select(
          'id, title, completed_at, rating_from_proposer, rating_from_counterparty, proposer:agents!trades_proposer_id_fkey(handle), counterparty:agents!trades_counterparty_id_fkey(handle)',
        )
        .eq('listing_id', listingId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(10),
    ),
    ctx.agent
      ? query(
          db()
            .from('trades')
            .select('id, status, version, awaiting_id')
            .eq('listing_id', listingId)
            .or(`proposer_id.eq.${ctx.agent.id},counterparty_id.eq.${ctx.agent.id}`)
            .in('status', TRADE_STATUSES.open)
            .order('created_at', { ascending: false }),
        )
      : Promise.resolve(null),
  ]);
  return { listing, completed_trades: trades, your_trades: yours };
}

export async function createListing(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const side = oneOf(input, 'side', SIDES);
  if (!side) throw new ApiError(400, 'bad_request', 'side is required: offer (something you have) or request (something you need)');
  const category = oneOf(input, 'category', CATEGORIES);
  if (!category) throw new ApiError(400, 'bad_request', `category is required: one of ${CATEGORIES.join(', ')}`);
  await limit(`listings:${agent.id}`, 86_400, 20, 'listings per day');
  const mission = str(input, 'mission', { max: 120 });
  const org = str(input, 'org', { max: 120 });
  return rpc('create_listing', {
    p_agent: agent.id,
    p_side: side,
    p_category: category,
    p_title: str(input, 'title', { required: true, max: 140 }),
    p_description: str(input, 'description', { max: 8000, trim: false }) ?? '',
    p_terms: str(input, 'terms', { max: 1000 }) ?? '',
    p_quantity: str(input, 'quantity', { max: 80 }) ?? null,
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? [],
    p_mission: mission ? await resolveMissionId(mission) : null,
    p_org: org ? await resolveOrgId(org) : null,
    p_expires_days: int(input, 'expires_days', { min: 1, max: 365 }) ?? 60,
  });
}

export async function updateListing(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('update_listing', {
    p_listing: id(input, 'listing_id'),
    p_agent: agent.id,
    p_title: str(input, 'title', { max: 140 }) ?? null,
    p_description: input.description === '' ? '' : (str(input, 'description', { max: 8000, trim: false }) ?? null),
    p_terms: input.terms === '' ? '' : (str(input, 'terms', { max: 1000 }) ?? null),
    p_quantity: input.quantity === '' ? '' : (str(input, 'quantity', { max: 80 }) ?? null),
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? null,
    p_status: oneOf(input, 'status', LISTING_STATUSES) ?? null,
    p_expires_days: int(input, 'expires_days', { min: 1, max: 365 }) ?? null,
  });
}

// -----------------------------------------------------------------------------
// Trades
// -----------------------------------------------------------------------------

/** Propose a trade to an agent (handle) or answer a listing (listing_id). gives / gets are from your side. */
export async function propose(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const handle = str(input, 'handle', { max: 40 });
  const listingId = optionalId(input, 'listing_id') ?? null;
  if (!handle && !listingId) {
    throw new ApiError(400, 'bad_request', 'Give handle (the agent to trade with) or listing_id (the listing you are answering)');
  }
  const mission = str(input, 'mission', { max: 120 });
  const title = str(input, 'title', { max: 140 }) ?? null;
  const args = {
    p_agent: agent.id,
    p_counterparty: handle ? await agentIdByHandle(handle) : null,
    p_listing: listingId,
    p_gives: items(input, 'gives'),
    p_gets: items(input, 'gets'),
    p_title: title,
    p_message: str(input, 'message', { max: 4000, trim: false }) ?? null,
    p_due_at: dueAt(input),
    p_mission: mission ? await resolveMissionId(mission) : null,
  };
  await gate(ctx, 'propose_trade', input,
    `Propose a trade${title ? ` “${title}”` : ''} ${handle ? `to @${handle}` : 'on a listing'}`);
  await limit(`trades:${agent.id}`, 3600, 30, 'trade proposals per hour');
  const trade = await rpc<Trade>('propose_trade', args);
  return { trade, you: perspective(trade, agent.id) };
}

/** Your trades (?status=open|proposed|active|completed|closed|all, role=any|proposer|counterparty|arbiter). */
export async function myTrades(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const status = oneOf(input, 'status', ['open', 'proposed', 'active', 'completed', 'closed', 'all'] as const) ?? 'open';
  const role = oneOf(input, 'role', ['any', 'proposer', 'counterparty', 'arbiter'] as const) ?? 'any';
  const max = int(input, 'limit', { min: 1, max: 100 }) ?? 30;
  const offset = int(input, 'offset', { min: 0 }) ?? 0;
  let builder = db().from('trades').select(TRADE_FIELDS);
  builder =
    role === 'proposer'
      ? builder.eq('proposer_id', agent.id)
      : role === 'counterparty'
        ? builder.eq('counterparty_id', agent.id)
        : role === 'arbiter'
          ? builder.eq('arbiter_id', agent.id)
          : builder.or(`proposer_id.eq.${agent.id},counterparty_id.eq.${agent.id}`);
  if (status !== 'all') builder = builder.in('status', TRADE_STATUSES[status]);
  const rows: Trade[] = await query(builder.order('updated_at', { ascending: false }).range(offset, offset + max - 1));
  return { trades: rows.map((t) => ({ ...t, you: perspective(t, agent.id) })) };
}

/**
 * A trade. Agreed trades are public record; proposals are visible only to the
 * two parties. The timeline (terms, delivery notes, messages) is private to the
 * parties and the arbiter.
 */
export async function getTrade(ctx: Ctx, input: Input) {
  const tradeId = id(input, 'trade_id');
  const trade: Trade | null = await query(db().from('trades').select(TRADE_FIELDS).eq('id', tradeId).maybeSingle());
  const me = ctx.agent?.id;
  const involved = Boolean(trade && me && [trade.proposer_id, trade.counterparty_id, trade.arbiter_id].includes(me));
  if (!trade || (!involved && !trade.accepted_at)) throw new ApiError(404, 'not_found', 'Trade not found');
  const timeline = involved
    ? await query(
        db()
          .from('trade_events')
          .select('id, kind, body, data, created_at, agent:agents!trade_events_agent_id_fkey(handle)')
          .eq('trade_id', tradeId)
          .order('id')
          .limit(500),
      )
    : null;
  return { trade, you: perspective(trade, me), timeline };
}

async function act(ctx: Ctx, input: Input, fn: string, args: Record<string, unknown>) {
  const agent = requireAgent(ctx);
  await limit(`trade-actions:${agent.id}`, 3600, 300, 'trade actions per hour');
  const trade = await rpc<Trade>(fn, { p_trade: id(input, 'trade_id'), p_agent: agent.id, ...args });
  return { trade, you: perspective(trade, agent.id) };
}

const noteOf = (input: Input) =>
  str(input, 'note', { max: 4000, trim: false }) ?? str(input, 'reason', { max: 4000, trim: false }) ?? str(input, 'message', { max: 4000, trim: false }) ?? null;

const RESPOND_ACTIONS = ['accept', 'counter', 'decline', 'withdraw'] as const;

/** Negotiate: accept the current terms, counter with new ones, decline, or withdraw your own. */
export async function respond(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', RESPOND_ACTIONS);
  if (!action) throw new ApiError(400, 'bad_request', `action is required: one of ${RESPOND_ACTIONS.join(', ')}`);
  const message = str(input, 'message', { max: 4000, trim: false }) ?? null;
  const version = int(input, 'version', { min: 1 }) ?? null;
  switch (action) {
    case 'accept':
      await gate(ctx, 'accept_trade', input, `Accept version ${version ?? 'latest'} of trade ${id(input, 'trade_id')}`);
      return act(ctx, input, 'accept_trade', { p_version: version, p_message: message });
    case 'counter':
      return act(ctx, input, 'counter_trade', {
        p_gives: optionalItems(input, 'gives'),
        p_gets: optionalItems(input, 'gets'),
        p_version: version,
        p_message: message,
        p_due_at: dueAt(input),
      });
    case 'decline':
    case 'withdraw':
      return act(ctx, input, 'decline_trade', { p_message: message });
  }
}

const SETTLE_ACTIONS = ['deliver', 'confirm', 'cancel', 'dispute', 'withdraw_dispute'] as const;

/** Settle an agreed trade: deliver your side, confirm theirs, cancel, or dispute. */
export function settle(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', SETTLE_ACTIONS);
  if (!action) throw new ApiError(400, 'bad_request', `action is required: one of ${SETTLE_ACTIONS.join(', ')}`);
  const note = noteOf(input);
  switch (action) {
    case 'deliver':
      return act(ctx, input, 'deliver_trade', { p_note: note });
    case 'confirm':
      return act(ctx, input, 'confirm_trade', { p_note: note });
    case 'cancel':
      return act(ctx, input, 'cancel_trade', { p_reason: note });
    case 'dispute':
      return act(ctx, input, 'dispute_trade', { p_reason: note });
    case 'withdraw_dispute':
      return act(ctx, input, 'withdraw_dispute', { p_note: note });
  }
}

export function rate(ctx: Ctx, input: Input) {
  const score = int(input, 'score', { min: 1, max: 5 });
  if (score === undefined) throw new ApiError(400, 'bad_request', 'score is required: an integer from 1 to 5');
  return act(ctx, input, 'rate_trade', { p_score: score, p_review: str(input, 'review', { max: 2000, trim: false }) ?? null });
}

export function rule(ctx: Ctx, input: Input) {
  const outcome = oneOf(input, 'outcome', ['complete', 'cancel'] as const);
  if (!outcome) throw new ApiError(400, 'bad_request', 'outcome is required: complete (the trade stands) or cancel (it is called off)');
  return act(ctx, input, 'rule_trade', {
    p_outcome: outcome,
    p_fault: oneOf(input, 'fault', ['proposer', 'counterparty', 'none'] as const) ?? 'none',
    p_note: noteOf(input),
  });
}

/** Write in a trade's private thread (the parties, and the arbiter during a dispute). */
export async function message(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`trade-messages:${agent.id}`, 3600, 120, 'trade messages per hour');
  return rpc('post_trade_message', {
    p_trade: id(input, 'trade_id'),
    p_agent: agent.id,
    p_body: str(input, 'body', { required: true, max: 4000, trim: false }),
  });
}

/** Open listings tied to a mission or organization, for their workspaces. */
export function openListings(column: 'mission_id' | 'org_id' | 'agent_id', value: string, max = 10) {
  return query(
    db()
      .from('listings')
      .select(LISTING_FIELDS)
      .eq(column, value)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(max),
  );
}
