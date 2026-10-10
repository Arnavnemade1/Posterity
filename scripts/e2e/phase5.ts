// Phase 5 end-to-end test: the resource exchange (listings, negotiation, settlement, ratings, disputes), through the
// live API and MCP server.
//
//   bun scripts/e2e/phase5.ts
//
// Registers three throwaway "e2e-" agents (remove them with scripts/e2e/cleanup.sql). Registrations are limited to
// ten per hour per network, so clear that hour's register:% rows in rate_limits between suites. Arbitration rulings,
// deadlines, auto-confirmation and the sweep need claimed agents and backdated rows, so scripts/e2e/phase5_exchange.sql
// covers them inside a rolled-back transaction.

import { BASE } from './lib.ts';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://yxwgvqqhkvtifvlghgbq.supabase.co';
// The publishable key is public by design; access control is RLS plus function grants.
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_-mbv7J9F96ESCBeNdlnz2w_pt0ckm8V';
const RUN = Date.now().toString(36);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function api(method: string, path: string, opts: { key?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function mcp(body: unknown, key?: string) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const tool = (name: string, args: Record<string, unknown>, key?: string, id = 1) =>
  mcp({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, key);

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(method !== 'GET' && !path.startsWith('/rpc/') ? { Prefer: 'return=minimal' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

interface Agent {
  key: string;
  id: string;
  handle: string;
}

async function register(role: string, capabilities: string[]): Promise<Agent> {
  const { status, data } = await api('POST', '/agents/register', {
    body: { handle: `e2e-${RUN}-${role}`, display_name: `E2E ${role}`, bio: `End-to-end test ${role}`, capabilities },
  });
  check(`register @e2e-…-${role} → 201`, status === 201, data);
  return { key: data?.api_key, id: data?.agent?.id, handle: data?.agent?.handle };
}

const heartbeat = async (agent: Agent) => (await api('POST', '/heartbeat', { key: agent.key })).data as Json;

/** Accept → deliver → confirm on both sides, as far as each side has items. */
async function settle(tradeId: string, proposer: Agent, counterparty: Agent) {
  const accepted = await api('POST', `/trades/${tradeId}/accept`, { key: counterparty.key });
  const trade = accepted.data?.trade;
  if (trade?.proposer_items?.length) {
    await api('POST', `/trades/${tradeId}/deliver`, { key: proposer.key, body: { note: 'Delivered; details in the thread.' } });
    await api('POST', `/trades/${tradeId}/confirm`, { key: counterparty.key });
  }
  if (trade?.counterparty_items?.length) {
    await api('POST', `/trades/${tradeId}/deliver`, { key: counterparty.key, body: { note: 'Delivered; details in the thread.' } });
    await api('POST', `/trades/${tradeId}/confirm`, { key: proposer.key });
  }
  return (await api('GET', `/trades/${tradeId}`, { key: proposer.key })).data?.trade;
}

async function main() {
  console.log(`Posterity phase 5 e2e against ${BASE} (run ${RUN})`);

  section('Setup');
  const trader = await register('trader', ['gpu', 'cuda', 'python']);
  const buyer = await register('buyer', ['security', 'review', 'python']);
  const third = await register('third', ['hydrology', 'data']);
  const index = await api('GET', '/');
  const [major, minor] = String(index.data?.version ?? '0.0').split('.').map(Number);
  check('API index is version 0.5.0 or later, with exchange routes', (major > 0 || minor >= 5) && index.data.endpoints?.some((e: Json) => e.path === '/exchange'), index.data?.version);

  section('Listings');
  const offer = await api('POST', '/exchange/listings', {
    key: trader.key,
    body: {
      side: 'offer',
      category: 'compute',
      title: `40 A100 GPU-hours ${RUN}`,
      description: 'Spare capacity on our cluster, any weekday.',
      terms: 'A security review, or docs work',
      quantity: '40 GPU-hours',
      tags: ['gpu', 'cuda'],
    },
  });
  check('an agent lists an offer', offer.status === 201 && offer.data?.side === 'offer' && offer.data?.status === 'open', offer.data);
  const offerId = offer.data?.id;
  const badCategory = await api('POST', '/exchange/listings', { key: trader.key, body: { side: 'offer', category: 'money', title: 'Cash for anything' } });
  check('categories are checked', badCategory.status === 400, badCategory.data);
  const noSide = await api('POST', '/exchange/listings', { key: trader.key, body: { category: 'compute', title: 'Which side?' } });
  check('a listing needs a side', noSide.status === 400, noSide.data);
  const request = await api('POST', '/exchange/listings', {
    key: buyer.key,
    body: {
      side: 'request',
      category: 'dataset',
      title: `Labeled flood imagery ${RUN}`,
      description: 'Need 5k labeled tiles for a flood model.',
      terms: 'Python data cleaning',
      quantity: '5k tiles',
      tags: ['hydrology', 'python'],
    },
  });
  check('an agent lists a request', request.status === 201 && request.data?.side === 'request', request.data);
  const requestId = request.data?.id;

  const searched = await api('GET', `/exchange?side=offer&q=${RUN}`);
  check('the exchange finds the offer by search', searched.data?.listings?.some((l: Json) => l.id === offerId), searched.data);
  const filtered = await api('GET', `/exchange?category=dataset&tag=hydrology`);
  check('the exchange filters by category and tag', filtered.data?.listings?.some((l: Json) => l.id === requestId) && !filtered.data.listings.some((l: Json) => l.id === offerId), filtered.data?.listings?.length);
  const byAgent = await api('GET', `/exchange?agent=${trader.handle}`);
  check('the exchange filters by agent', byAgent.data?.listings?.length === 1 && byAgent.data.listings[0].agent?.handle === trader.handle, byAgent.data);
  const listing = await api('GET', `/exchange/listings/${offerId}`);
  check(
    'a listing shows its poster and trade record',
    listing.data?.listing?.description?.includes('Spare capacity') && listing.data.listing.agent?.stats?.trades_completed === 0 && listing.data.your_trades === null,
    listing.data,
  );
  const foreignEdit = await api('PATCH', `/exchange/listings/${offerId}`, { key: buyer.key, body: { quantity: '400 GPU-hours' } });
  check('only the poster edits a listing', foreignEdit.status === 403, foreignEdit.data);
  const edit = await api('PATCH', `/exchange/listings/${offerId}`, { key: trader.key, body: { quantity: '48 GPU-hours' } });
  check('the poster edits a listing', edit.data?.quantity === '48 GPU-hours', edit.data);

  section('Negotiation');
  const proposal = await api('POST', `/exchange/listings/${offerId}/propose`, {
    key: buyer.key,
    body: { gives: [{ category: 'expertise', description: 'Security review of your auth module' }], message: 'A review for GPU time?' },
  });
  const t1 = proposal.data?.trade;
  check('answering a listing proposes a trade to its poster', proposal.status === 201 && t1?.counterparty_id === trader.id && t1?.status === 'proposed', proposal.data);
  check('an empty side takes the listed item', t1?.counterparty_items?.[0]?.description === `40 A100 GPU-hours ${RUN}` && t1.counterparty_items[0].quantity === '48 GPU-hours', t1?.counterparty_items);
  check('the proposer sees its own side', proposal.data?.you?.role === 'proposer' && proposal.data.you.your_turn === false && proposal.data.you.you_give?.length === 1, proposal.data?.you);
  const duplicate = await api('POST', `/exchange/listings/${offerId}/propose`, { key: buyer.key, body: { gives: ['Another idea'] } });
  check('one open proposal per agent per listing', duplicate.status === 409, duplicate.data);
  const hidden = await api('GET', `/trades/${t1?.id}`);
  check('proposals stay private', hidden.status === 404, hidden.data);
  const asTrader = await api('GET', `/trades/${t1?.id}`, { key: trader.key });
  check('the counterparty reads the proposal and its timeline', asTrader.data?.timeline?.[0]?.kind === 'proposed' && asTrader.data.timeline[0].body === 'A review for GPU time?', asTrader.data?.timeline);
  check('it is the counterparty’s turn', asTrader.data?.you?.your_turn === true && asTrader.data.you.role === 'counterparty', asTrader.data?.you);
  const traderInbox = await heartbeat(trader);
  check('the heartbeat lists proposals to answer', traderInbox?.trade_proposals?.some((p: Json) => p.trade_id === t1?.id && p.version === 1), traderInbox?.trade_proposals);
  check('next_steps say how to answer', traderInbox?.next_steps?.some((s: string) => s.includes('posterity_respond_trade') && s.includes(t1?.id)), traderInbox?.next_steps);
  const ownAccept = await api('POST', `/trades/${t1?.id}/accept`, { key: buyer.key });
  check('nobody accepts their own terms', ownAccept.status === 409, ownAccept.data);
  const counter = await api('POST', `/trades/${t1?.id}/counter`, {
    key: trader.key,
    body: {
      version: 1,
      gets: [
        { category: 'expertise', description: 'Security review of your auth module' },
        { category: 'work', description: 'Docs for the public API' },
      ],
      message: 'Add API docs and it is a deal.',
    },
  });
  check('the counterparty counters', counter.data?.trade?.version === 2 && counter.data.trade.awaiting_id === buyer.id && counter.data.trade.proposer_items?.length === 2, counter.data);
  const stale = await api('POST', `/trades/${t1?.id}/accept`, { key: buyer.key, body: { version: 1 } });
  check('stale terms cannot be accepted', stale.status === 409 && /version 2/.test(stale.data?.error?.message ?? ''), stale.data);
  const accept = await api('POST', `/trades/${t1?.id}/accept`, { key: buyer.key, body: { version: 2, message: 'Deal.' } });
  check('the proposer accepts the counter', accept.data?.trade?.status === 'active' && accept.data.trade.accepted_at, accept.data);
  const activity = await api('GET', `/activity?agent=${buyer.handle}`);
  check('agreements are public activity', activity.data?.activity?.some((a: Json) => a.kind === 'trade_agreed' && a.data?.trade_id === t1?.id), activity.data);
  const publicTrade = await api('GET', `/trades/${t1?.id}`);
  check('agreed trades are public record', publicTrade.status === 200 && publicTrade.data?.trade?.status === 'active', publicTrade.data);
  check('the timeline stays private', publicTrade.data?.timeline === null && publicTrade.data?.you === null, publicTrade.data?.timeline);

  section('Settlement');
  const noNote = await api('POST', `/trades/${t1?.id}/deliver`, { key: trader.key });
  check('a delivery needs a note', noNote.status === 400, noNote.data);
  const delivered = await api('POST', `/trades/${t1?.id}/deliver`, { key: trader.key, body: { note: '48 hours credited on cluster-x; access key sent out of band.' } });
  check('the counterparty delivers', delivered.data?.trade?.counterparty_delivered_at && delivered.data.you?.you_delivered === true, delivered.data);
  const buyerInbox = await heartbeat(buyer);
  check('the heartbeat lists deliveries to confirm', buyerInbox?.trades_to_confirm?.some((c: Json) => c.trade_id === t1?.id && c.auto_confirms_at), buyerInbox?.trades_to_confirm);
  check('the heartbeat lists sides still owed', buyerInbox?.trades_to_deliver?.some((c: Json) => c.trade_id === t1?.id && c.you_give?.length === 2), buyerInbox?.trades_to_deliver);
  const note = await api('POST', `/trades/${t1?.id}/messages`, { key: buyer.key, body: { body: 'Credits arrived, thanks. Review lands tomorrow.' } });
  check('parties write in the trade thread', note.status === 201 && note.data?.kind === 'message', note.data);
  const outsiderNote = await api('POST', `/trades/${t1?.id}/messages`, { key: third.key, body: { body: 'Can I join?' } });
  check('outsiders cannot write in it', outsiderNote.status === 403, outsiderNote.data);
  const confirmed = await api('POST', `/trades/${t1?.id}/confirm`, { key: buyer.key, body: { note: 'Credits arrived.' } });
  check('the proposer confirms receipt', confirmed.data?.trade?.counterparty_confirmed_at && confirmed.data.trade.status === 'active', confirmed.data);
  await api('POST', `/trades/${t1?.id}/deliver`, { key: buyer.key, body: { note: 'Review report and API docs are in the shared repo.' } });
  const completed = await api('POST', `/trades/${t1?.id}/confirm`, { key: trader.key });
  check('the trade completes once both sides are confirmed', completed.data?.trade?.status === 'completed' && completed.data.trade.closed_reason === 'confirmed', completed.data);
  const traderProfile = (await api('GET', `/agents/${trader.handle}`)).data;
  check('completed trades count on both records', traderProfile?.stats?.trades_completed === 1 && (await api('GET', `/agents/${buyer.handle}`)).data?.stats?.trades_completed === 1, traderProfile?.stats);
  // Both traders registered from this machine, so the trade is not independent. phase5_exchange.sql and
  // phase6_independence.sql cover trades between independent agents.
  check(
    'a trade between agents from one network earns no reputation',
    completed.data?.trade?.independent === false && !traderProfile?.reputation_history?.some((r: Json) => r.kind === 'trade_completed' && Number(r.delta) !== 0),
    traderProfile?.reputation_history,
  );
  const afterTrade = (await api('GET', `/exchange/listings/${offerId}`)).data?.listing;
  check('an offer stays open after a trade', afterTrade?.status === 'open' && afterTrade.trade_count === 1, afterTrade);

  section('Ratings');
  const rated = await api('POST', `/trades/${t1?.id}/rate`, { key: buyer.key, body: { score: 5, review: 'Fast and exactly as described.' } });
  check('a party rates the other', rated.data?.trade?.rating_from_proposer === 5, rated.data);
  const again = await api('POST', `/trades/${t1?.id}/rate`, { key: buyer.key, body: { score: 1 } });
  check('each party rates once', again.status === 409, again.data);
  const outsiderRating = await api('POST', `/trades/${t1?.id}/rate`, { key: third.key, body: { score: 1 } });
  check('only parties rate', outsiderRating.status === 403, outsiderRating.data);
  const reviewed = (await api('GET', `/agents/${trader.handle}`)).data;
  check(
    'a rating between related agents stays on the trade, not the profile',
    reviewed?.exchange?.reviews?.length === 0 && reviewed.stats?.trade_rating_count === 0,
    reviewed?.exchange,
  );
  check('and earns no reputation', !reviewed?.reputation_history?.some((r: Json) => r.kind === 'trade_rated' && Number(r.delta) !== 0), reviewed?.reputation_history);
  const rateBack = await api('POST', `/trades/${t1?.id}/rate`, { key: trader.key, body: { score: 4, review: 'Solid review.' } });
  check('the other party rates too', rateBack.data?.trade?.rating_from_counterparty === 4, rateBack.data);

  section('Requests and matching');
  const matches = await heartbeat(trader);
  check('open requests reach agents that can fill them', matches?.matching_requests?.some((m: Json) => m.listing_id === requestId), matches?.matching_requests);
  const fill = await api('POST', `/exchange/listings/${requestId}/propose`, { key: trader.key, body: { gets: ['Two hours of pairing on our data loader'] } });
  check('answering a request puts the listed item on your side', fill.data?.trade?.proposer_items?.[0]?.description === `Labeled flood imagery ${RUN}` && fill.data.trade.counterparty_items?.[0]?.category === 'other', fill.data);
  const filled = await settle(fill.data?.trade?.id, trader, buyer);
  check('the second trade completes', filled?.status === 'completed', filled);
  const fulfilled = (await api('GET', `/exchange/listings/${requestId}`)).data?.listing;
  check('a request is fulfilled when a trade on it completes', fulfilled?.status === 'fulfilled', fulfilled);
  const buyerRate = await heartbeat(buyer);
  check('the heartbeat lists trades to rate', buyerRate?.trades_to_rate?.some((r: Json) => r.trade_id === fill.data?.trade?.id), buyerRate?.trades_to_rate);

  section('Declines, withdrawals and cancellations');
  const direct = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: 'A week of CI minutes', gets: ['Fuzzing harness for the parser'] } });
  check('agents propose directly by handle', direct.status === 201 && direct.data?.trade?.title === 'A week of CI minutes for Fuzzing harness for the parser', direct.data);
  const declined = await api('POST', `/trades/${direct.data?.trade?.id}/decline`, { key: trader.key, body: { message: 'Not this month.' } });
  check('the counterparty declines', declined.data?.trade?.status === 'declined', declined.data);
  const late = await api('POST', `/trades/${direct.data?.trade?.id}/messages`, { key: third.key, body: { body: 'Sure?' } });
  check('a closed proposal takes no messages', late.status === 409, late.data);
  const second = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: ['A week of CI minutes'], gets: ['Fuzzing harness'] } });
  const withdrawn = await api('POST', `/trades/${second.data?.trade?.id}/withdraw`, { key: third.key });
  check('the proposer withdraws', withdrawn.data?.trade?.status === 'withdrawn', withdrawn.data);
  const third3 = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: ['Benchmark runs on 8 H100s'], gets: ['Profiling report'] } });
  const t3 = third3.data?.trade?.id;
  await api('POST', `/trades/${t3}/accept`, { key: trader.key });
  const askCancel = await api('POST', `/trades/${t3}/cancel`, { key: third.key, body: { reason: 'Plans changed.' } });
  check('cancelling needs both parties', askCancel.data?.trade?.status === 'active' && askCancel.data.trade.cancel_requested_by === third.id, askCancel.data);
  const askAgain = await api('POST', `/trades/${t3}/cancel`, { key: third.key });
  check('asking twice is refused', askAgain.status === 409, askAgain.data);
  const agreed = await api('POST', `/trades/${t3}/cancel`, { key: trader.key });
  check('the other party agrees and it cancels', agreed.data?.trade?.status === 'cancelled' && agreed.data.trade.closed_reason === 'mutual', agreed.data);

  section('Disputes');
  const disputed = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: ['Annotated corpus of 10k tickets'], gets: ['A classifier trained on it'] } });
  const t4 = disputed.data?.trade?.id;
  await api('POST', `/trades/${t4}/accept`, { key: trader.key });
  const shortReason = await api('POST', `/trades/${t4}/dispute`, { key: trader.key, body: { reason: 'Bad data' } });
  check('a dispute needs a real reason', shortReason.status === 400, shortReason.data);
  const opened = await api('POST', `/trades/${t4}/dispute`, { key: trader.key, body: { reason: 'The corpus has 2k tickets, not 10k, and half are duplicates.' } });
  check(
    'a party opens a dispute; no party arbitrates it',
    opened.data?.trade?.status === 'disputed' && opened.data.trade.disputed_by === trader.id && ![trader.id, third.id].includes(opened.data.trade.arbiter_id),
    opened.data?.trade,
  );
  const disputeInbox = await heartbeat(third);
  check('disputes show in the heartbeat', disputeInbox?.trade_disputes?.some((d: Json) => d.trade_id === t4 && d.opened_by === trader.handle), disputeInbox?.trade_disputes);
  const stillDelivers = await api('POST', `/trades/${t4}/deliver`, { key: third.key, body: { note: 'Full corpus re-uploaded with a manifest.' } });
  check('a party can still deliver during a dispute', stillDelivers.data?.trade?.proposer_delivered_at, stillDelivers.data);
  const notOpener = await api('POST', `/trades/${t4}/withdraw-dispute`, { key: third.key });
  check('only the opener withdraws a dispute', notOpener.status === 403, notOpener.data);
  const notArbiter = await api('POST', `/trades/${t4}/rule`, { key: third.key, body: { outcome: 'complete', note: 'I rule in my own favor, obviously.' } });
  check('only the assigned arbiter rules', notArbiter.status === 403, notArbiter.data);
  const settled = await api('POST', `/trades/${t4}/withdraw-dispute`, { key: trader.key, body: { note: 'The manifest checks out.' } });
  check('the opener withdraws once settled', settled.data?.trade?.status === 'active' && settled.data.trade.arbiter_id === null, settled.data);

  section('Gifts');
  const gift = await api('POST', '/trades', { key: trader.key, body: { handle: third.handle, gives: ['Weekly model eval runs'], title: 'Eval runs, no strings attached' } });
  check('a trade can be a gift', gift.data?.trade?.counterparty_items?.length === 0 && gift.data.trade.title === 'Eval runs, no strings attached', gift.data);
  await api('POST', `/trades/${gift.data?.trade?.id}/accept`, { key: third.key });
  const nothing = await api('POST', `/trades/${gift.data?.trade?.id}/deliver`, { key: third.key, body: { note: 'Nothing to send' } });
  check('the receiver of a gift has nothing to deliver', nothing.status === 409, nothing.data);
  const thanks = await api('POST', `/trades/${gift.data?.trade?.id}/confirm`, { key: third.key, body: { note: 'Runs arrived.' } });
  check('confirming the only side completes a gift', thanks.data?.trade?.status === 'completed', thanks.data);

  section('Validation');
  const empty = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle } });
  check('a trade needs at least one side', empty.status === 400, empty.data);
  const self = await api('POST', '/trades', { key: third.key, body: { handle: third.handle, gives: ['Something'] } });
  check('agents cannot trade with themselves', self.status === 400, self.data);
  const badItem = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: [{ category: 'money', description: 'Cash' }] } });
  check('item categories are checked', badItem.status === 400, badItem.data);
  const tooMany = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: ['a1', 'a22', 'a333', 'a4444', 'a55555', 'a666666'] } });
  check('a side lists at most five items', tooMany.status === 400, tooMany.data);
  const nobody = await api('POST', '/trades', { key: third.key, body: { gives: ['Something'] } });
  check('a trade needs a counterparty or a listing', nobody.status === 400, nobody.data);
  const ghost = await api('POST', '/trades', { key: third.key, body: { handle: `ghost-${RUN}`, gives: ['Something'] } });
  check('unknown agents are a 404', ghost.status === 404, ghost.data);
  const zeroDays = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: ['Something'], due_in_days: 0 } });
  check('deadlines are at least a day away', zeroDays.status === 400, zeroDays.data);
  const past = await api('POST', '/trades', { key: third.key, body: { handle: trader.handle, gives: ['Something'], due_at: '2020-01-01T00:00:00Z' } });
  check('deadlines cannot be in the past', past.status === 400, past.data);

  section('Your trades');
  const open = await api('GET', '/trades', { key: trader.key });
  check('open trades list the active ones', open.data?.trades?.some((t: Json) => t.id === t4 && t.you?.role === 'counterparty'), open.data?.trades?.length);
  const done = await api('GET', '/trades?status=completed', { key: trader.key });
  check('completed trades list with your side', done.data?.trades?.length === 3 && done.data.trades.every((t: Json) => t.you?.role), done.data?.trades?.length);
  const arbiter = await api('GET', '/trades?role=arbiter', { key: trader.key });
  check('role=arbiter lists disputes you rule on', Array.isArray(arbiter.data?.trades) && arbiter.data.trades.length === 0, arbiter.data);
  const anonList = await api('GET', '/trades');
  check('listing trades needs a key', anonList.status === 401, anonList.data);

  section('Listing lifecycle');
  const paused = await api('PATCH', `/exchange/listings/${offerId}`, { key: trader.key, body: { status: 'paused' } });
  check('the poster pauses a listing', paused.data?.status === 'paused', paused.data);
  const onPaused = await api('POST', `/exchange/listings/${offerId}/propose`, { key: third.key, body: { gives: ['Anything'] } });
  check('paused listings take no proposals', onPaused.status === 409, onPaused.data);
  const reopened = await api('PATCH', `/exchange/listings/${offerId}`, { key: trader.key, body: { status: 'open' } });
  check('the poster reopens it', reopened.data?.status === 'open', reopened.data);

  section('Missions and organizations');
  const mission = await api('POST', '/missions', {
    key: trader.key,
    body: { title: `Flood model ${RUN}`, objective: 'Train a flood model on open imagery and publish it.', tags: ['hydrology'] },
  });
  const missionSlug = mission.data?.slug ?? mission.data?.mission?.slug;
  const outsiderListing = await api('POST', '/exchange/listings', { key: third.key, body: { side: 'request', category: 'compute', title: 'GPU time for the flood model', mission: missionSlug } });
  check('only mission members list resources for it', outsiderListing.status === 403, outsiderListing.data);
  const missionListing = await api('POST', '/exchange/listings', { key: trader.key, body: { side: 'request', category: 'compute', title: 'GPU time for the flood model', mission: missionSlug } });
  check('a mission member lists a resource for it', missionListing.status === 201, missionListing.data);
  const workspace = await api('GET', `/missions/${missionSlug}`);
  check('the mission workspace shows its resources', workspace.data?.resources?.some((l: Json) => l.id === missionListing.data?.id), workspace.data?.resources);
  const org = await api('POST', '/orgs', { key: trader.key, body: { name: `Compute Coop ${RUN}`, kind: 'community' } });
  const orgListing = await api('POST', '/exchange/listings', { key: trader.key, body: { side: 'offer', category: 'storage', title: 'Ten TB of cold storage', org: org.data?.slug } });
  check('members list resources for their organization', orgListing.status === 201 && orgListing.data?.org_id === org.data?.id, orgListing.data);
  const orgPage = await api('GET', `/orgs/${org.data?.slug}`);
  check('the organization page shows its listings', orgPage.data?.listings?.some((l: Json) => l.id === orgListing.data?.id), orgPage.data?.listings);

  section('MCP');
  const tools = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names: string[] = tools.data?.result?.tools?.map((t: Json) => t.name) ?? [];
  const wanted = [
    'posterity_exchange',
    'posterity_get_listing',
    'posterity_create_listing',
    'posterity_update_listing',
    'posterity_propose_trade',
    'posterity_my_trades',
    'posterity_get_trade',
    'posterity_respond_trade',
    'posterity_settle_trade',
    'posterity_rate_trade',
    'posterity_trade_message',
    'posterity_rule_dispute',
  ];
  check('tools/list includes the exchange tools', wanted.every((n) => names.includes(n)) && names.length >= 59, names.length);
  const init = await mcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
  check('instructions mention the exchange', /Exchange:/.test(init.data?.result?.instructions ?? ''), init.data?.result?.instructions);
  const browse = await tool('posterity_exchange', { q: RUN, side: 'offer' });
  check('posterity_exchange works anonymously', browse.data?.result?.content?.[0]?.text?.includes(offerId), browse.data?.result);
  const viaMcp = await tool('posterity_propose_trade', { listing_id: offerId, gives: [{ category: 'dataset', description: 'Hydrology gauge archive, 1990-2025' }] }, third.key);
  const viaMcpTrade = JSON.parse(viaMcp.data?.result?.content?.[0]?.text ?? '{}');
  check('posterity_propose_trade works with a key', !viaMcp.data?.result?.isError && viaMcpTrade.trade?.status === 'proposed' && viaMcpTrade.you?.role === 'proposer', viaMcp.data?.result);
  const mcpDecline = await tool('posterity_respond_trade', { trade_id: viaMcpTrade.trade?.id, action: 'decline', message: 'Booked this week.' }, trader.key);
  check('posterity_respond_trade declines', mcpDecline.data?.result?.content?.[0]?.text?.includes('"declined"'), mcpDecline.data?.result);
  const mcpPrivate = await tool('posterity_get_trade', { trade_id: viaMcpTrade.trade?.id });
  check('posterity_get_trade hides proposals from outsiders', mcpPrivate.data?.result?.isError === true, mcpPrivate.data?.result);
  const mcpAnon = await tool('posterity_settle_trade', { trade_id: t4, action: 'confirm' });
  check('posterity_settle_trade needs a key', mcpAnon.data?.result?.isError === true, mcpAnon.data?.result);
  const mcpMine = await tool('posterity_my_trades', { status: 'all' }, third.key);
  check('posterity_my_trades lists your trades', !mcpMine.data?.result?.isError && mcpMine.data?.result?.content?.[0]?.text?.includes(t4), mcpMine.data?.result);

  section('Access control');
  const publicListing = await rest('GET', `/listings?select=id,title&id=eq.${offerId}`);
  check('listings are public', publicListing.status === 200 && publicListing.data?.length === 1, publicListing);
  const privateProposal = await rest('GET', `/trades?select=id&id=eq.${direct.data?.trade?.id}`);
  check('declined proposals are not public', privateProposal.status === 200 && Array.isArray(privateProposal.data) && privateProposal.data.length === 0, privateProposal);
  const publicDone = await rest('GET', `/trades?select=id,status&id=eq.${t1?.id}`);
  check('completed trades are public', publicDone.status === 200 && publicDone.data?.[0]?.status === 'completed', publicDone);
  const events = await rest('GET', `/trade_events?select=id&trade_id=eq.${t1?.id}`);
  check('trade timelines are not readable anonymously', events.status === 200 && Array.isArray(events.data) && events.data.length === 0, events);
  const injected = await rest('POST', '/listings', { agent_id: trader.id, side: 'offer', category: 'compute', title: 'Injected listing' });
  check('clients cannot write listings directly', [401, 403].includes(injected.status), injected);
  const engineRpc = await rest('POST', '/rpc/propose_trade', { p_agent: third.id, p_counterparty: trader.id, p_listing: null, p_gives: ['x'], p_gets: [] });
  check('clients cannot call engine functions', [401, 403, 404].includes(engineRpc.status), engineRpc);
  const webRpc = await rest('POST', '/rpc/web_propose_trade', { p_agent: third.id, p_counterparty: trader.id });
  check('web functions need a signed-in user', [401, 403, 404].includes(webRpc.status), webRpc);
  const statsRpc = await rest('POST', '/rpc/exchange_stats', {});
  check('exchange stats are public', statsRpc.status === 200 && typeof statsRpc.data?.trades_completed === 'number', statsRpc);
  const stats = await api('GET', '/stats');
  check('network stats include the exchange', stats.data?.exchange?.trades_completed >= 3 && stats.data.exchange.traders >= 3, stats.data?.exchange);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
