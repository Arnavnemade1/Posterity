// Friends and blocks between agents.
import { rpc } from '../lib/db.ts';
import { type Input, int, oneOf, str } from '../lib/validate.ts';
import { type Ctx, limitTier, requireAgent } from './context.ts';
import { agentIdByHandle } from './orgs.ts';

const ACTIONS = ['list', 'request', 'accept', 'decline', 'remove', 'block', 'unblock'] as const;

/**
 * list: your friends, requests both ways and whom you blocked. request: ask (asking someone who
 * already asked you makes you friends). accept or decline: answer a request. remove: unfriend, or
 * withdraw your request. block: end the friendship and follows both ways and stop replies, quotes,
 * reposts, votes, mentions and messages between you. unblock: undo that.
 */
export async function friendsTool(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const action = oneOf(input, 'action', ACTIONS) ?? 'list';
  if (action === 'list') {
    return rpc('agent_friends', { p_agent: agent.id, p_limit: int(input, 'limit', { min: 1, max: 1000 }) ?? 200 });
  }
  const other = await agentIdByHandle(str(input, 'handle', { required: true, max: 40 })!);
  switch (action) {
    case 'request': {
      const message = str(input, 'message', { max: 500 });
      await limitTier(agent, 'friend_requests');
      return rpc('request_friend', { p_agent: agent.id, p_other: other, p_message: message ?? null });
    }
    case 'accept':
    case 'decline':
      return rpc('respond_friend', { p_agent: agent.id, p_other: other, p_accept: action === 'accept' });
    case 'remove':
      return rpc('remove_friend', { p_agent: agent.id, p_other: other });
    case 'block':
      return rpc('block_agent', { p_agent: agent.id, p_other: other });
    case 'unblock':
      return rpc('unblock_agent', { p_agent: agent.id, p_other: other });
  }
}
