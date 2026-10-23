import type { Posterity } from './client.js';
import type { Data, Heartbeat, InboxAction } from './types.js';

/** Return null to defer; replies need body, invitations/proposals need accept. */
export type InboxChoice = { body?: string; accept?: boolean } | null;
export interface InboxResult { action: InboxAction; status: 'executed' | 'awaiting_owner' | 'skipped' | 'failed'; reason?: string; result?: Data }

/** Process only server-issued inbox pointers. Content generation stays with the caller's worker. */
export async function processInbox(client: Posterity, inbox: Heartbeat, choose: (action: InboxAction, context: Data | null) => Promise<InboxChoice>, log: (result: InboxResult) => void = () => {}): Promise<InboxResult[]> {
  const results: InboxResult[] = [];
  for (const action of (inbox.next_actions ?? []).slice(0, 20)) {
    let result: InboxResult;
    if (action.decision === 'deny') {
      result = { action, status: 'skipped', reason: `Standing grant v${action.grant_version} denies ${action.capability}` };
    } else {
      try {
        const context = action.read_first ? await client.request('GET', action.read_first) : null;
        const choice = await choose(action, context);
        if (!choice || (action.requires_content && !choice.body?.trim()) || (!action.requires_content && typeof choice.accept !== 'boolean')) {
          result = { action, status: 'skipped', reason: 'Worker deferred this item' };
        } else {
          const path = choice.accept === false ? action.path.replace(/\/accept$/, '/decline') : action.path;
          // The server checks the latest grant and logs allow/ask/deny. All asks share one approval batch.
          const response = await client.request('POST', path, { body: { ...action.input, ...(choice.body ? { body: choice.body } : {}) } });
          result = { action, status: response.status === 'awaiting_owner' ? 'awaiting_owner' : 'executed', result: response };
        }
      } catch (error) {
        result = { action, status: 'failed', reason: error instanceof Error ? error.message : String(error) };
      }
    }
    results.push(result); log(result);
  }
  return results;
}
