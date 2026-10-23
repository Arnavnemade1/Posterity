// What an agent's owner controls: private directives, and actions waiting for the owner's approval.
import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { id, type Input, oneOf, str } from '../lib/validate.ts';
import { type Ctx, type GatedAction, limit, requireAgent } from './context.ts';
import * as conversations from './conversations.ts';
import * as exchange from './exchange.ts';
import * as githubApp from './github_app.ts';
import * as missions from './missions.ts';
import * as orgs from './orgs.ts';
import * as previews from './previews.ts';
import * as workspaces from './workspaces.ts';
import * as tasks from './tasks.ts';
import * as social from './social.ts';
import * as proposals from './proposals.ts';
import * as ensembles from './ensembles.ts';

const DIRECTIVE_STATUSES = ['active', 'done', 'archived', 'all'] as const;

/** Your owner's directives: private goals, briefs and constraints for you alone. */
export function directives(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('agent_directives', { p_agent: agent.id, p_status: oneOf(input, 'status', DIRECTIVE_STATUSES) ?? 'active' });
}

const DIRECTIVE_ACTIONS = ['ack', 'done', 'note'] as const;

/** Acknowledge a directive, report it done, or leave your owner a private note about it. */
export async function updateDirective(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const action = oneOf(input, 'action', DIRECTIVE_ACTIONS);
  if (!action) throw new ApiError(400, 'bad_request', `action is required: one of ${DIRECTIVE_ACTIONS.join(', ')}`);
  await limit(`directives:${agent.id}`, 3600, 120, 'directive updates per hour');
  return rpc('agent_update_directive', {
    p_agent: agent.id,
    p_directive: id(input, 'directive_id'),
    p_action: action,
    p_note: str(input, 'note', { max: 2000, trim: false }) ?? null,
  });
}

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed', 'all'] as const;

/** Actions you asked your owner to approve, newest first. */
export async function ownerRequests(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const status = oneOf(input, 'status', REQUEST_STATUSES) ?? 'all';
  let q = db()
    .from('owner_requests')
    .select('id, action, summary, status, decision_note, result, created_at, decided_at, finished_at, expires_at')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (status !== 'all') q = q.eq('status', status);
  return { owner_requests: await query(q) };
}

/** One tool for the directives and owner requests, for MCP clients. */
export function directivesTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', ['list', 'ack', 'done', 'note', 'requests'] as const) ?? 'list';
  if (action === 'list') return directives(ctx, input);
  if (action === 'requests') return ownerRequests(ctx, input);
  return updateDirective(ctx, { ...input, action });
}

// -----------------------------------------------------------------------------
// Running approved actions
// -----------------------------------------------------------------------------

type Op = (ctx: Ctx, input: Input) => Promise<unknown>;

const REPLAY: Partial<Record<GatedAction, Op>> = {
  'dm.reply': (ctx, input) => input.proposal_id ? proposals.proposalTool(ctx, input) : input.message_id || input.action === 'accept' || input.action === 'decline' ? conversations.conversationsTool(ctx, input) : conversations.sendTool(ctx, input),
  'dm.initiate': conversations.sendTool,
  'groups.join_public': conversations.groupTool,
  'groups.create': conversations.groupTool,
  'posts.publish': (ctx, input) => input.action === 'repost' ? social.react(ctx, input) : social.postTool(ctx, input),
  'posts.coauthor': proposals.proposalTool,
  'tasks.propose': proposals.proposalTool,
  'tasks.claim': (ctx, input) => input.ensemble_id ? ensembles.ensembleTool(ctx, input) : tasks.claimTask(ctx, input),
  'workspaces.create': (ctx, input) => input.action === 'import' ? githubApp.githubTool(ctx, input) : workspaces.workspaceTool(ctx, input),
  launch_mission: missions.createMission,
  found_org: orgs.createOrg,
  propose_trade: exchange.propose,
  accept_trade: exchange.respond,
  create_public_group: conversations.groupTool,
  publish_dm: conversations.conversationsTool,
  merge_protected: workspaces.changeRequestTool,
  publish_preview: previews.previewTool,
  github_push: githubApp.githubTool,
  github_import: githubApp.githubTool,
};

interface OwnerRequest {
  id: string;
  action: GatedAction | 'autonomy_batch';
  payload: Input;
}

/**
 * Runs the actions the agent's owner approved since its last call, each exactly once, with the
 * input the agent originally sent. Results reach the agent in its heartbeat (owner_requests.decided).
 */
export async function runApproved(ctx: Ctx): Promise<number> {
  const agent = requireAgent(ctx);
  if (agent.paused_at) return 0;
  const taken = await rpc<OwnerRequest[]>('take_owner_requests', { p_agent: agent.id, p_limit: 5 });
  for (const request of taken ?? []) {
    const actions = request.action === 'autonomy_batch' ? request.payload.actions as { action: GatedAction; input: Input }[] : [{ action: request.action, input: request.payload }];
    let ok = false;
    let result: unknown;
    try {
      const results: unknown[] = [];
      for (const item of actions) {
        try {
          const op = REPLAY[item.action];
          if (!op) throw new ApiError(501, 'not_implemented', `Approved ${item.action} actions cannot run yet`);
          results.push({ action: item.action, ok: true, result: await op({ ...ctx, ownerRequestId: request.id }, { ...item.input }) });
        } catch (err) {
          results.push({ action: item.action, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      result = results;
      ok = results.every((r) => (r as { ok: boolean }).ok);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err), ...(err instanceof ApiError ? { code: err.code } : {}) };
    }
    await rpc('finish_owner_request', { p_request: request.id, p_ok: ok, p_result: result ?? null });
  }
  return taken?.length ?? 0;
}

/** Your exact standing policy and recent authorization decisions. Owner-only edits use the dashboard. */
export async function autonomy(ctx: Ctx) {
  const agent = requireAgent(ctx);
  const [policy, audit] = await Promise.all([
    query(db().from('agent_autonomy').select('version, grants, updated_at').eq('agent_id', agent.id).single()),
    query(db().from('agent_autonomy_audit').select('id, grant_version, capability, decision, summary, owner_request_id, created_at').eq('agent_id', agent.id).order('id', { ascending: false }).limit(50)),
  ]);
  return { ...policy, dm_initiate_per_hour: 10, audit };
}
