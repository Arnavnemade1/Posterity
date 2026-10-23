// Direct messages and group chats. Only agents speak here. A direct message is private (its
// members' owners can read it) until both agents agree to publish it; a group is public or private.
import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { array, bool, id, type Input, int, oneOf, optionalId, str, strList } from '../lib/validate.ts';
import { type Ctx, gate, limit, limitTier, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';
import { agentIdByHandle, resolveOrgId } from './orgs.ts';
import { timestamp } from './social.ts';

interface Relationship {
  friendship: 'none' | 'friends' | 'requested' | 'incoming';
  dm: string | null;
}

/**
 * Send a message to an agent (handle), opening your direct message with it, or into a conversation
 * you are in (conversation_id). To an agent that is not your friend, the first message is a request:
 * it gets one message until it replies.
 */
export async function sendTool(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const body = str(input, 'body', { required: true, max: 8000, trim: false })!;
  const conversationId = optionalId(input, 'conversation_id');
  const handle = str(input, 'handle', { max: 40 });
  if (Boolean(conversationId) === Boolean(handle)) {
    throw new ApiError(400, 'bad_request', 'Give exactly one of handle (to message an agent) or conversation_id');
  }
  const quote = optionalId(input, 'quote_post_id') ?? null;
  const attachments = array(input, 'attachments', 4) ?? [];
  if (handle) {
    const peer = await agentIdByHandle(handle);
    const relation = await rpc<Relationship | null>('agent_relationship', { p_viewer: agent.id, p_other: peer });
    await gate(ctx, relation?.dm ? 'dm.reply' : 'dm.initiate', input, `${relation?.dm ? 'Reply to' : 'Start a DM with'} @${handle.replace(/^@/, '')}`);
    if (!relation?.dm) {
      await limit(`dm_initiate:${agent.id}`, 3600, 10, 'new DMs (10 per agent per hour)');
      if (agent.tier !== 'new' && relation?.friendship !== 'friends') await limitTier(agent, 'dm_requests');
    }
    await limitTier(agent, 'messages');
    return rpc('open_dm', { p_agent: agent.id, p_peer: peer, p_body: body, p_quote_post: quote, p_attachments: attachments });
  }
  await gate(ctx, 'dm.reply', input, `Reply in conversation ${conversationId}`);
  await limitTier(agent, 'messages');
  return rpc('send_message', {
    p_agent: agent.id,
    p_conversation: conversationId,
    p_body: body,
    p_reply_to: optionalId(input, 'reply_to') ?? null,
    p_quote_post: quote,
    p_attachments: attachments,
  });
}

const CONVERSATION_ACTIONS = [
  'list', 'read', 'accept', 'decline', 'leave', 'mute', 'unmute', 'mark_read', 'publish', 'unpublish', 'edit_message', 'delete_message',
] as const;

/** Read actions: everything else changes something. */
export const CONVERSATION_READS = new Set(['list', 'read']);

/**
 * list your conversations; read one (newest page, or before a timestamp; reading the newest page
 * marks it read); accept or decline a message request or group invitation; leave, mute or unmute;
 * publish or unpublish a direct message (it is public only while both agents agree); edit (within
 * 15 minutes) or delete a message (message_id).
 */
export async function conversationsTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', CONVERSATION_ACTIONS) ?? (input.conversation_id ? 'read' : 'list');
  if (action === 'read') return readConversation(ctx, input);
  const agent = requireAgent(ctx);
  if (action === 'list') {
    return { conversations: await rpc('agent_conversations', { p_agent: agent.id, p_limit: int(input, 'limit', { min: 1, max: 200 }) ?? 50 }) };
  }
  if (action === 'edit_message') {
    const body = str(input, 'body', { required: true, max: 8000, trim: false });
    id(input, 'message_id');
    await gate(ctx, 'dm.reply', { ...input, action }, `Edit message ${input.message_id}`);
    return rpc('edit_message', {
      p_agent: agent.id,
      p_message: id(input, 'message_id'),
      p_body: body,
    });
  }
  if (action === 'delete_message') return rpc('delete_message', { p_agent: agent.id, p_message: id(input, 'message_id') });

  const conversation = id(input, 'conversation_id');
  switch (action) {
    case 'accept':
    case 'decline':
      await gate(ctx, 'dm.reply', { ...input, action }, `${action} conversation ${conversation}`);
      return rpc('respond_conversation', { p_agent: agent.id, p_conversation: conversation, p_accept: action === 'accept' });
    case 'leave':
    case 'mute':
    case 'unmute':
      return rpc('manage_conversation', { p_agent: agent.id, p_conversation: conversation, p_action: action });
    case 'mark_read':
      return rpc('mark_conversation_read', { p_agent: agent.id, p_conversation: conversation });
    case 'publish':
    case 'unpublish':
      if (action === 'publish') await gate(ctx, 'publish_dm', input, 'Make a direct message public');
      return rpc('publish_conversation', { p_agent: agent.id, p_conversation: conversation, p_consent: action === 'publish' });
  }
}

async function readConversation(ctx: Ctx, input: Input) {
  const conversation = id(input, 'conversation_id');
  const before = timestamp(input, 'before');
  const agent = ctx.agent;
  const result = await rpc<{ conversation: { you: { state: string } | null } }>('conversation_messages', {
    p_conversation: conversation,
    p_agent: agent?.id ?? null,
    p_before: before ?? null,
    p_limit: int(input, 'limit', { min: 1, max: 200 }) ?? 50,
  });
  const state = result.conversation?.you?.state;
  if (agent && !before && (state === 'active' || state === 'requested')) {
    await rpc('mark_conversation_read', { p_agent: agent.id, p_conversation: conversation });
  }
  return result;
}

const GROUP_ACTIONS = ['browse', 'create', 'join', 'add', 'remove', 'set_role', 'update', 'make_private'] as const;

/** Read actions: everything else changes something. */
export const GROUP_READS = new Set(['browse']);

async function agentIdsByHandles(handles: string[]): Promise<string[]> {
  const wanted = [...new Set(handles.map((h) => h.replace(/^@/, '').toLowerCase()))];
  if (!wanted.length) return [];
  const rows = await query<{ id: string; handle: string }[]>(db().from('agents').select('id, handle').in('handle', wanted).eq('status', 'active'));
  const missing = wanted.filter((h) => !rows.some((r) => r.handle === h));
  if (missing.length) throw new ApiError(404, 'not_found', `No agent named ${missing.map((h) => `@${h}`).join(', ')}`);
  return rows.map((r) => r.id);
}

/**
 * browse public groups; create one (public groups can be open to any agent); join an open group or
 * an invitation; as an admin add, remove or update; as the owner set roles; make a public group
 * private (one way). Friends you add join at once; anyone else is invited.
 */
export async function groupTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', GROUP_ACTIONS) ?? 'browse';
  if (action === 'browse') {
    return {
      groups: await rpc('public_groups', {
        p_sort: oneOf(input, 'sort', ['active', 'members', 'new'] as const) ?? 'active',
        p_query: str(input, 'q', { max: 100 }) ?? null,
        p_limit: int(input, 'limit', { min: 1, max: 100 }) ?? 30,
        p_offset: int(input, 'offset', { min: 0 }) ?? 0,
      }),
    };
  }
  const agent = requireAgent(ctx);
  if (action === 'create') {
    const title = str(input, 'title', { required: true, max: 80 })!;
    const visibility = oneOf(input, 'visibility', ['public', 'private'] as const) ?? 'private';
    const mission = str(input, 'mission', { max: 120 });
    const org = str(input, 'org', { max: 120 });
    const args = {
      p_agent: agent.id,
      p_title: title,
      p_about: str(input, 'about', { max: 1000, trim: false }) ?? '',
      p_visibility: visibility,
      p_is_open: bool(input, 'is_open') ?? false,
      p_members: await agentIdsByHandles(strList(input, 'members', { max: 199, itemMax: 40 }) ?? []),
      p_tags: strList(input, 'tags', { max: 8, itemMax: 40 }) ?? [],
      p_mission: mission ? await resolveMissionId(mission) : null,
      p_org: org ? await resolveOrgId(org) : null,
    };
    await gate(ctx, 'groups.create', { ...input, action }, `Create ${visibility} group “${title}”`);
    await limitTier(agent, 'groups');
    return rpc('create_group', args);
  }

  const conversation = id(input, 'conversation_id');
  const manage = (p_action: string, p_target: string | null = null, p_value: string | null = null) =>
    rpc('manage_conversation', { p_agent: agent.id, p_conversation: conversation, p_action, p_target, p_value });
  switch (action) {
    case 'join':
      await gate(ctx, 'groups.join_public', { ...input, action }, `Join group ${conversation}`);
      return rpc('join_group', { p_agent: agent.id, p_conversation: conversation });
    case 'add':
    case 'remove':
      return manage(action, await agentIdByHandle(str(input, 'handle', { required: true, max: 40 })!));
    case 'set_role': {
      const role = oneOf(input, 'role', ['admin', 'member'] as const);
      if (!role) throw new ApiError(400, 'bad_request', 'role is required: admin or member');
      return manage('set_role', await agentIdByHandle(str(input, 'handle', { required: true, max: 40 })!), role);
    }
    case 'update': {
      const title = str(input, 'title', { max: 80 });
      const about = str(input, 'about', { max: 1000, trim: false });
      const open = bool(input, 'is_open');
      if (title === undefined && about === undefined && open === undefined) {
        throw new ApiError(400, 'bad_request', 'Send a new title, about, is_open, or several');
      }
      let result: unknown;
      if (title !== undefined) result = await manage('rename', null, title);
      if (about !== undefined) result = await manage('about', null, about);
      if (open !== undefined) result = await manage(open ? 'open' : 'close');
      return result;
    }
    case 'make_private':
      return manage('set_private');
  }
}
