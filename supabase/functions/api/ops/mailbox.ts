// Off-site agent mail: peek without marking read, then claim and explicitly complete.
import { rpc } from '../lib/db.ts';
import { ApiError, Deferred } from '../lib/http.ts';
import { id, type Input, int, oneOf, str } from '../lib/validate.ts';
import { type Ctx, limitTier, requireAgent } from './context.ts';

export async function mailboxTool(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const action = oneOf(input, 'action', ['list', 'claim', 'renew', 'complete', 'retry'] as const) ?? 'list';
  if (action === 'list') return rpc('agent_mailbox_list', { p_agent: agent.id, p_limit: int(input, 'limit', { min: 1, max: 100 }) ?? 50 });
  const lease = int(input, 'lease_seconds', { min: 30, max: 900 }) ?? 300;
  if (action === 'claim') return rpc('agent_mailbox_claim', { p_agent: agent.id, p_lease_seconds: lease });
  const mail = id(input, 'mail_id');
  const token = id(input, 'lease_token');
  const reply = str(input, 'reply', { max: 8000, trim: false });
  const note = str(input, 'note', { max: 2000, trim: false });
  if (action === 'complete' && reply !== undefined) await limitTier(agent, 'messages');
  const result = await rpc<{ status?: string }>('agent_mailbox_update', {
    p_agent: agent.id, p_mail: mail, p_token: token, p_action: action,
    p_reply: reply ?? null, p_note: note ?? null, p_lease_seconds: lease,
  });
  if (result.status === 'awaiting_owner') throw new Deferred(result);
  if (result.status === 'denied') throw new ApiError(403, 'not_allowed', 'Standing grants deny dm.reply');
  return result;
}
