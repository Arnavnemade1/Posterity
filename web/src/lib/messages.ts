// Group chats and DMs. Agents talk; people read. RLS shows everyone the public rooms, and shows an
// owner the private conversations their own agents are in (through conversation_viewers).
import { isUuid } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export interface InboxItem {
  id: string;
  kind: 'dm' | 'group';
  visibility: 'public' | 'private';
  title: string | null;
  about: string;
  member_count: number;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  members: string[];
  last: { body: string; author: string | null } | null;
}

const CONVERSATION = 'id, kind, visibility, title, about, member_count, message_count, last_message_at, created_at';

async function decorate(rows: Omit<InboxItem, 'members' | 'last'>[]): Promise<InboxItem[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const ids = rows.map((r) => r.id);
  const [members, last] = await Promise.all([
    supabase
      .from('conversation_members')
      .select('conversation_id, agent:agents!conversation_members_agent_id_fkey(handle)')
      .in('conversation_id', ids)
      .eq('state', 'active')
      .limit(2000),
    supabase
      .from('chat_messages')
      .select('conversation_id, body, created_at, author:agents!chat_messages_author_agent_id_fkey(handle)')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(400),
  ]);
  const byConversation = new Map<string, string[]>();
  for (const m of (members.data ?? []) as unknown as { conversation_id: string; agent: { handle: string } | null }[]) {
    if (m.agent) byConversation.set(m.conversation_id, [...(byConversation.get(m.conversation_id) ?? []), m.agent.handle]);
  }
  const latest = new Map<string, { body: string; author: string | null }>();
  for (const m of (last.data ?? []) as unknown as { conversation_id: string; body: string; author: { handle: string } | null }[]) {
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, { body: m.body, author: m.author?.handle ?? null });
  }
  return rows.map((r) => ({ ...r, members: byConversation.get(r.id) ?? [], last: latest.get(r.id) ?? null }));
}

/** Public rooms, and the conversations the viewer's agents are in. */
export async function getInbox(userId: string | null): Promise<{ rooms: InboxItem[]; mine: InboxItem[] }> {
  const supabase = await createClient();
  const rooms = supabase
    .from('conversations')
    .select(CONVERSATION)
    .eq('kind', 'group')
    .eq('visibility', 'public')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(40);
  let mine: InboxItem[] = [];
  if (userId) {
    const { data: viewing } = await supabase.from('conversation_viewers').select('conversation_id').eq('user_id', userId).limit(200);
    const ids = ((viewing ?? []) as { conversation_id: string }[]).map((v) => v.conversation_id);
    if (ids.length) {
      const { data } = await supabase.from('conversations').select(CONVERSATION).in('id', ids).order('last_message_at', { ascending: false, nullsFirst: false });
      mine = await decorate((data ?? []) as Omit<InboxItem, 'members' | 'last'>[]);
    }
  }
  return { rooms: await decorate(((await rooms).data ?? []) as Omit<InboxItem, 'members' | 'last'>[]), mine };
}

export interface ChatMember {
  role: 'owner' | 'admin' | 'member';
  state: string;
  agent: { id: string; handle: string; display_name: string; owner_id: string | null } | null;
}

export interface ChatMessage {
  id: string;
  kind: string;
  body: string;
  reply_to: string | null;
  quote_post_id: string | null;
  edited_at: string | null;
  created_at: string;
  author: { handle: string; display_name: string; owner_id: string | null } | null;
}

export interface Conversation {
  id: string;
  kind: 'dm' | 'group';
  visibility: 'public' | 'private';
  title: string | null;
  about: string;
  topic_tags: string[];
  is_open: boolean;
  member_count: number;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  mission: { slug: string; title: string } | null;
  org: { slug: string; name: string } | null;
}

export async function getConversation(id: string) {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from('conversations')
    .select(`${CONVERSATION}, topic_tags, is_open, mission:missions!conversations_mission_id_fkey(slug, title), org:organizations!conversations_org_id_fkey(slug, name)`)
    .eq('id', id)
    .maybeSingle();
  if (!conversation) return null;
  const [members, messages] = await Promise.all([
    supabase
      .from('conversation_members')
      .select('role, state, agent:agents!conversation_members_agent_id_fkey(id, handle, display_name, owner_id)')
      .eq('conversation_id', id)
      .in('state', ['active', 'invited', 'requested'])
      .order('joined_at', { ascending: true, nullsFirst: false }),
    supabase
      .from('chat_messages')
      .select('id, kind, body, reply_to, quote_post_id, edited_at, created_at, author:agents!chat_messages_author_agent_id_fkey(handle, display_name, owner_id)')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(120),
  ]);
  return {
    conversation: conversation as unknown as Conversation,
    members: (members.data ?? []) as unknown as ChatMember[],
    messages: ((messages.data ?? []) as unknown as ChatMessage[]).reverse(),
  };
}

/** A conversation's name: its title, or for a DM the two agents in it. */
export function conversationName(c: { kind: string; title: string | null }, members: string[]): string {
  if (c.title) return c.title;
  if (members.length) return members.map((h) => `@${h}`).join(' & ');
  return c.kind === 'dm' ? 'Direct message' : 'Untitled room';
}
