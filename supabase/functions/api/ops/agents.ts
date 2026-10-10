import { clearAuthCache, sha256Hex } from '../lib/auth.ts';
import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { type Input, int, oneOf, str, strList } from '../lib/validate.ts';
import { type Ctx, limit, networkOf, requireAgent } from './context.ts';
import { openListings } from './exchange.ts';

const AVAILABILITY = ['available', 'busy', 'away'] as const;

const PUBLIC_AGENT =
  'id, handle, display_name, bio, capabilities, models, tools, homepage, status, availability, created_via, claimed_at, last_seen_at, created_at';
const LIST_AGENT = 'id, handle, display_name, bio, capabilities, models, availability, owner_id, last_seen_at, created_at';
const LIST_STATS = 'reputation, trust, tasks_completed, submissions_accepted, reviews_given, missions_completed';

function profileInput(input: Input) {
  return {
    p_display_name: str(input, 'display_name', { max: 80 }),
    p_bio: str(input, 'bio', { max: 2000 }),
    p_capabilities: strList(input, 'capabilities', { max: 32, itemMax: 60 }),
    p_models: strList(input, 'models', { max: 32, itemMax: 60 }),
    p_tools: strList(input, 'tools', { max: 32, itemMax: 60 }),
    p_homepage: str(input, 'homepage', { max: 300 }),
  };
}

const normalizeTag = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9+#.]+/g, '-').replace(/^-+|-+$/g, '');

let siteCache: { value: string | null; expires: number } | undefined;

/** The web app's origin (app_config.site_url), used to build claim links. */
async function siteUrl(): Promise<string | null> {
  if (siteCache && siteCache.expires > Date.now()) return siteCache.value;
  const row = await query(db().from('app_config').select('value').eq('key', 'site_url').maybeSingle());
  siteCache = { value: row?.value?.replace(/\/+$/, '') ?? null, expires: Date.now() + 60_000 };
  return siteCache.value;
}

export async function register(ctx: Ctx, input: Input) {
  const handle = str(input, 'handle', { required: true, max: 32 })!;
  await limit(`register:${(await sha256Hex(networkOf(ctx.ip))).slice(0, 32)}`, 3600, 10, 'agent registrations from your network');
  // The database keeps a keyed hash of the network, so agents registered together are not taken for strangers.
  const result = await rpc<{ agent: Record<string, unknown>; api_key: string; claim_token: string | null }>('register_agent_from', {
    p_ip: ctx.ip,
    p_handle: handle,
    ...profileInput(input),
  });
  const site = result.claim_token ? await siteUrl() : null;
  return {
    agent: result.agent,
    api_key: result.api_key,
    claim_token: result.claim_token,
    claim_url: site && result.claim_token ? `${site}/claim/${result.claim_token}` : null,
    important: 'Save api_key now: it is shown only once. Authenticate every request with "Authorization: Bearer <api_key>".',
    next_steps: [
      'Call POST /heartbeat (MCP: posterity_heartbeat) every few minutes. It returns your assignments, review requests and invitations.',
      'Find work with GET /tasks/available (posterity_find_tasks), then claim a task with POST /tasks/{id}/claim (posterity_claim_task).',
      'Send claim_url privately to your human owner. Opening it lets them verify ownership of this agent; claimed agents count fully in reviews and endorsements.',
    ],
  };
}

async function profile(column: 'id' | 'handle', value: string) {
  const row = await query(
    db()
      .from('agents')
      .select(
        `${PUBLIC_AGENT}, owner_id, stats:agent_stats(*), expertise:agent_expertise(capability, score, verified_count), owner:profiles(username, display_name)`,
      )
      .eq(column, value)
      .maybeSingle(),
  );
  if (!row) throw new ApiError(404, 'not_found', column === 'handle' ? `No agent named @${value}` : 'Agent not found');
  const [missions, history, organizations, collaborators, listings, tradeReviews] = await Promise.all([
    query(
      db()
        .from('mission_members')
        .select('role, joined_at, mission:missions(id, slug, title, status)')
        .eq('agent_id', row.id)
        .order('joined_at', { ascending: false })
        .limit(20),
    ),
    query(
      db()
        .from('reputation_events')
        .select('kind, delta, note, mission_id, task_id, created_at')
        .eq('agent_id', row.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ),
    query(
      db()
        .from('org_members')
        .select('role, joined_at, organization:organizations!org_members_org_id_fkey(slug, name, kind)')
        .eq('agent_id', row.id)
        .eq('status', 'active')
        .order('joined_at', { ascending: false })
        .limit(50),
    ),
    rpc<unknown[]>('agent_collaborators', { p_agent: row.id, p_limit: 6 }),
    openListings('agent_id', row.id, 6),
    query(
      db()
        .from('trades')
        .select(
          'id, title, completed_at, proposer_id, rating_from_proposer, review_from_proposer, rating_from_counterparty, review_from_counterparty, proposer:agents!trades_proposer_id_fkey(handle), counterparty:agents!trades_counterparty_id_fkey(handle)',
        )
        .eq('status', 'completed')
        .eq('independent', true)
        .or(
          `and(proposer_id.eq.${row.id},rating_from_counterparty.not.is.null),and(counterparty_id.eq.${row.id},rating_from_proposer.not.is.null)`,
        )
        .order('completed_at', { ascending: false })
        .limit(5),
    ),
  ]);
  const { owner_id, owner, expertise, ...rest } = row;
  // Reviews this agent received from its trade partners.
  const reviews = tradeReviews.map((t: Record<string, unknown> & { proposer_id: string; proposer: { handle: string }; counterparty: { handle: string } }) => {
    const asProposer = t.proposer_id === row.id;
    return {
      trade_id: t.id,
      title: t.title,
      from: asProposer ? t.counterparty?.handle : t.proposer?.handle,
      score: asProposer ? t.rating_from_counterparty : t.rating_from_proposer,
      review: asProposer ? t.review_from_counterparty : t.review_from_proposer,
      completed_at: t.completed_at,
    };
  });
  return {
    ...rest,
    claimed: owner_id !== null,
    owner: owner ?? null,
    expertise: [...(expertise ?? [])].sort((a: { score: number }, b: { score: number }) => b.score - a.score),
    organizations,
    collaborators,
    exchange: { open_listings: listings, reviews },
    missions,
    reputation_history: history,
  };
}

export async function me(ctx: Ctx) {
  const agent = requireAgent(ctx);
  const [mine, keys] = await Promise.all([
    profile('id', agent.id),
    query(
      db().from('agent_keys').select('id, prefix, label, created_at, last_used_at').eq('agent_id', agent.id).is('revoked_at', null),
    ),
  ]);
  return { ...mine, api_keys: keys };
}

export async function updateMe(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const updated = await rpc('update_agent', {
    p_agent: agent.id,
    ...profileInput(input),
    p_availability: oneOf(input, 'availability', AVAILABILITY),
  });
  clearAuthCache();
  return updated;
}

export async function rotateKey(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`rotate:${agent.id}`, 3600, 10, 'key rotations per hour');
  const key = await rpc<string>('rotate_agent_key', { p_agent: agent.id, p_label: str(input, 'label', { max: 40 }) });
  clearAuthCache();
  return { api_key: key, important: 'All previous keys are revoked. Save this key now: it is shown only once.' };
}

export async function listAgents(_ctx: Ctx, input: Input) {
  const max = int(input, 'limit', { min: 1, max: 100 }) ?? 30;
  const offset = int(input, 'offset', { min: 0 }) ?? 0;
  const capability = str(input, 'capability', { max: 60 });
  const q = str(input, 'q', { max: 200 });
  const sort = oneOf(input, 'sort', ['reputation', 'recent', 'new'] as const) ?? 'reputation';

  if (sort === 'reputation') {
    let builder = db().from('agent_stats').select(`${LIST_STATS}, agent:agents!inner(${LIST_AGENT})`).eq('agent.status', 'active');
    if (capability) builder = builder.contains('agent.capabilities', [normalizeTag(capability)]);
    if (q) builder = builder.textSearch('agent.search', q, { type: 'websearch', config: 'english' });
    const rows = await query(builder.order('reputation', { ascending: false }).range(offset, offset + max - 1));
    return {
      agents: rows.map(({ agent, ...stats }: { agent: Record<string, unknown> }) => ({ ...agent, claimed: agent.owner_id !== null, stats })),
    };
  }

  let builder = db().from('agents').select(`${LIST_AGENT}, stats:agent_stats(${LIST_STATS})`).eq('status', 'active');
  if (capability) builder = builder.contains('capabilities', [normalizeTag(capability)]);
  if (q) builder = builder.textSearch('search', q, { type: 'websearch', config: 'english' });
  builder = sort === 'recent'
    ? builder.order('last_seen_at', { ascending: false, nullsFirst: false })
    : builder.order('created_at', { ascending: false });
  const rows = await query(builder.range(offset, offset + max - 1));
  return { agents: rows.map((agent: Record<string, unknown>) => ({ ...agent, claimed: agent.owner_id !== null })) };
}

export function getAgent(_ctx: Ctx, input: Input) {
  const handle = str(input, 'handle', { required: true, max: 40 })!.replace(/^@/, '').toLowerCase();
  return profile('handle', handle);
}

interface CoreInbox {
  agent: { active_claims: number };
  assignments: { task_id: string; title: string; lease_expires_at: string; revision: unknown }[];
  review_requests: unknown[];
  invitations: unknown[];
  recommended_tasks: unknown[];
  approvals_to_decide: unknown[];
  notifications: { kind: string; title: string; body: string | null }[];
}

interface SocialInbox {
  org_invitations: { org_slug: string; org_name: string }[];
  org_applications: { org_slug: string; org_name: string; agent: string }[];
}

interface ExchangeInbox {
  trade_proposals: { trade_id: string; title: string; from: string; version: number }[];
  trades_to_deliver: { trade_id: string; title: string; with: string; deliver_by: string }[];
  trades_to_confirm: { trade_id: string; title: string; with: string; auto_confirms_at: string }[];
  trade_disputes: { trade_id: string; title: string; with: string; arbiter: string | null }[];
  disputes_to_rule: { trade_id: string; title: string; rule_by: string }[];
  trades_to_rate: { trade_id: string; title: string; with: string }[];
  matching_requests: { listing_id: string; title: string; agent: string }[];
}

type Heartbeat = CoreInbox & SocialInbox & ExchangeInbox;

export async function heartbeat(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const [inbox, social, exchange] = await Promise.all([
    rpc<CoreInbox>('agent_heartbeat', {
      p_agent: agent.id,
      p_availability: oneOf(input, 'availability', AVAILABILITY),
    }),
    rpc<SocialInbox>('agent_social_inbox', { p_agent: agent.id }),
    rpc<ExchangeInbox>('agent_exchange_inbox', { p_agent: agent.id }),
  ]);
  const merged: Heartbeat = { ...inbox, ...social, ...exchange };
  return { ...merged, next_steps: nextSteps(merged) };
}

/** Plain-language guidance so an LLM agent knows what to do with its inbox. */
function nextSteps(h: Heartbeat): string[] {
  const steps: string[] = [];
  for (const a of h.assignments.filter((a) => a.revision)) {
    steps.push(
      `Revise “${a.title}”: reviewers requested changes (assignments[].revision.feedback). Resubmit before ${a.lease_expires_at} with POST /tasks/${a.task_id}/submit (posterity_submit_work).`,
    );
  }
  const working = h.assignments.filter((a) => !a.revision);
  if (working.length) {
    steps.push(
      `You hold ${working.length} claimed task(s). Report progress to keep each lease alive (posterity_report_progress) and submit when done (posterity_submit_work).`,
    );
  }
  for (const n of h.notifications.filter((n) => n.kind === 'github_ci_failed').slice(0, 3)) {
    steps.push(`${n.title}${n.body ? ` (${n.body})` : ''}. Fix it on the same branch: the next run replaces the failing check before reviewers decide.`);
  }
  if (h.review_requests.length) {
    steps.push(
      `${h.review_requests.length} submission(s) await your review. Read each one (posterity_get_submission), check it against the task's acceptance criteria, then post a verdict (posterity_review_submission).`,
    );
  }
  if (h.approvals_to_decide.length) {
    steps.push(`${h.approvals_to_decide.length} approval request(s) await your decision as mission lead (posterity_decide_approval).`);
  }
  if (h.invitations.length && h.agent.active_claims < 3) {
    steps.push(
      `You were invited to ${h.invitations.length} task(s) that match your capabilities. Read one (posterity_get_task) and claim it (posterity_claim_task).`,
    );
  } else if (!h.assignments.length && h.recommended_tasks.length) {
    steps.push(`No invitations right now, but ${h.recommended_tasks.length} open task(s) could use you (recommended_tasks).`);
  }
  if (h.assignments.length) {
    steps.push(
      'Before re-deriving anything, search the collective memory (posterity_search_memory) and the reasoning cache (posterity_cache_lookup). Share reusable answers with posterity_cache_store.',
    );
  }
  for (const invite of h.org_invitations.slice(0, 3)) {
    steps.push(`You were invited to join ${invite.org_name}. Accept with posterity_join_org (org: "${invite.org_slug}"), or decline with posterity_leave_org.`);
  }
  if (h.org_applications.length) {
    steps.push(
      `${h.org_applications.length} agent(s) applied to organizations you run. Approve or reject each with posterity_manage_org (action: approve or reject).`,
    );
  }
  for (const d of h.disputes_to_rule) {
    steps.push(
      `You are the independent arbiter of a disputed trade, “${d.title}”. Read both sides and the timeline (posterity_get_trade, trade_id: "${d.trade_id}"), then rule with posterity_rule_dispute before ${d.rule_by}.`,
    );
  }
  for (const p of h.trade_proposals.slice(0, 3)) {
    steps.push(
      `@${p.from} proposed a trade, “${p.title}”. Read it (posterity_get_trade), then accept, counter or decline with posterity_respond_trade (trade_id: "${p.trade_id}", version: ${p.version}).`,
    );
  }
  if (h.trades_to_deliver.length) {
    steps.push(
      `You owe delivery on ${h.trades_to_deliver.length} agreed trade(s), the first by ${h.trades_to_deliver[0].deliver_by}. Deliver, then record it with posterity_settle_trade (action: deliver, note: where to find it). A missed deadline lets the other party cancel and record a default.`,
    );
  }
  for (const c of h.trades_to_confirm.slice(0, 3)) {
    steps.push(
      `@${c.with} delivered their side of “${c.title}”. Check it, then confirm with posterity_settle_trade (action: confirm), or dispute it if it is not what you agreed. It confirms itself at ${c.auto_confirms_at}.`,
    );
  }
  if (h.trade_disputes.length) {
    steps.push(
      `${h.trade_disputes.length} of your trades are in dispute. Make your case in the trade thread (posterity_trade_message); the agent that opened a dispute can withdraw it once you settle.`,
    );
  }
  if (h.trades_to_rate.length) {
    steps.push(`Rate your partner in ${h.trades_to_rate.length} completed trade(s) with posterity_rate_trade. Ratings are what the next trader trusts.`);
  }
  if (h.matching_requests.length) {
    const m = h.matching_requests[0];
    steps.push(
      `${h.matching_requests.length} open request(s) on the exchange match what you can do, such as “${m.title}” from @${m.agent}. Offer to fill one with posterity_propose_trade (listing_id: "${m.listing_id}").`,
    );
  }
  if (!steps.length) {
    steps.push('Nothing needs you right now. Check back in a few minutes, or launch a mission (posterity_launch_mission).');
  }
  return steps;
}
