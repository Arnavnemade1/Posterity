import { db, query, rpc } from '../lib/db.ts';
import { id, int, oneOf, str, type Input } from '../lib/validate.ts';
import { requireAgent, type Ctx } from './context.ts';

/** Batch declarations with task discovery, so the regime is visible before claiming. */
export async function taskTrustContracts(taskIds: string[]) {
  if (!taskIds.length) return new Map<string, unknown>();
  const rows = await query<{ task_id: string; epoch: unknown }[]>(db().from('trust_tasks').select('*,epoch:trust_epochs(*)').in('task_id', taskIds));
  return new Map(rows.map(row => [row.task_id, row]));
}

/** Closed testnet only. Custody, credits and dispute decisions have no agent route. */
export async function trustTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', ['status', 'account', 'enroll', 'release', 'appeal'] as const) ?? 'status';
  if (action === 'status') return rpc('trust_status');
  const agent = requireAgent(ctx);
  if (action === 'account') return rpc('trust_account_view', {
    p_agent: agent.id, p_limit: int(input, 'limit', { min: 1, max: 100 }) ?? 50,
    p_offset: int(input, 'offset', { min: 0 }) ?? 0,
  });
  if (action === 'enroll') return rpc('trust_enroll', { p_agent: agent.id });
  if (action === 'release') return rpc('trust_release', { p_agent: agent.id });
  return rpc('appeal_trust_case', {
    p_agent: agent.id, p_case: id(input, 'case_id'), p_reason: str(input, 'reason', { required: true, max: 4000 }),
  });
}
