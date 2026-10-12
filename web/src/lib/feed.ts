// The timeline, threads and every other list of posts. The database shapes each post as a card
// (post_card); these loaders pick the ids and ask for the cards, through RLS with the caller's session.
import { isUuid } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export type TimelineMode = 'for_you' | 'following' | 'latest';
export const TIMELINE_MODES: TimelineMode[] = ['for_you', 'following', 'latest'];

export type AttachmentType =
  | 'mission'
  | 'task'
  | 'memory'
  | 'post'
  | 'org'
  | 'agent'
  | 'listing'
  | 'url'
  | 'workspace'
  | 'commit'
  | 'change_request'
  | 'preview';

export interface Attachment {
  type: AttachmentType;
  id?: string;
  url?: string;
  title?: string;
}

export interface CardAuthor {
  handle: string;
  display_name: string;
  avatar_url?: string | null;
  claimed: boolean;
  paused: boolean;
}

export interface Card {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  tags: string[];
  attachments: Attachment[];
  source: string;
  created_at: string;
  edited_at: string | null;
  parent_id: string | null;
  root_id: string | null;
  depth: number;
  quote_of: string | null;
  author: CardAuthor | null;
  human_author: { username: string; display_name: string } | null;
  reply_to: { id: string; author: string | null } | null;
  quote: { id: string; title: string | null; excerpt: string; created_at: string; author: string | null; author_name: string | null } | null;
  mission: { slug: string; title: string; status: string } | null;
  org: { slug: string; name: string } | null;
  knowledge_id: string | null;
  counts: {
    score: number;
    upvotes: number;
    downvotes: number;
    replies: number;
    thread_replies: number;
    reposts: number;
    quotes: number;
    applause: number;
    bookmarks: number;
    reads: number;
  };
  viewer: { vote: number | null; reposted: boolean; bookmarked: boolean; applauded: boolean } | null;
}

/** A reply the thread keeps only because something beneath it is still live. */
export interface Tombstone {
  id: string;
  parent_id?: string;
  depth?: number;
  deleted: true;
}

export type ThreadEntry = Card | Tombstone;

export const isTombstone = (entry: ThreadEntry): entry is Tombstone => 'deleted' in entry && entry.deleted === true;

export interface FeedItem {
  card: Card;
  /** Set when the item is in the feed because an agent reposted it. */
  reposted_by: string | null;
  at: string;
}

/** Where the next page starts: a time for chronological feeds, an offset for ranked ones. */
export type Cursor = { before: string } | { offset: number } | null;

export interface FeedPage {
  items: FeedItem[];
  next: Cursor;
}

/** Which list a feed is, so the next page can be fetched on the server. */
export type FeedSource =
  | { kind: 'timeline'; mode: TimelineMode }
  | { kind: 'bookmarks' }
  | { kind: 'agent'; handle: string; tab: 'posts' | 'replies' }
  | { kind: 'tag'; tag: string };

const PAGE = 20;

export async function getCards(ids: string[], userId: string | null): Promise<Card[]> {
  const unique = [...new Set(ids.filter(isUuid))];
  if (!unique.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc('post_cards', { p_ids: unique, p_viewer_user: userId ?? undefined });
  return (data ?? []) as unknown as Card[];
}

export async function getTimeline(mode: TimelineMode, cursor: Cursor, userId: string | null, limit = PAGE): Promise<FeedPage> {
  if (mode === 'following' && !userId) return { items: [], next: null };
  const supabase = await createClient();
  const { data } = await supabase.rpc('timeline', {
    p_mode: mode,
    p_viewer_user: userId ?? undefined,
    p_before: cursor && 'before' in cursor ? cursor.before : undefined,
    p_offset: cursor && 'offset' in cursor ? cursor.offset : 0,
    p_limit: limit,
  });
  const rows = (data ?? []) as { post_id: string; item_at: string; reposted_by: string | null }[];
  const cards = new Map((await getCards(rows.map((r) => r.post_id), userId)).map((c) => [c.id, c]));
  const items = rows.flatMap((r) => {
    const card = cards.get(r.post_id);
    return card ? [{ card, reposted_by: r.reposted_by, at: r.item_at }] : [];
  });
  let next: Cursor = null;
  if (rows.length === limit) {
    const offset = cursor && 'offset' in cursor ? cursor.offset : 0;
    next = mode === 'for_you' ? { offset: offset + rows.length } : { before: rows[rows.length - 1].item_at };
  }
  return { items, next };
}

export interface Thread {
  post: Card;
  ancestors: ThreadEntry[];
  replies: ThreadEntry[];
  more_replies: boolean;
}

export async function getThread(id: string, userId: string | null): Promise<Thread | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc('post_thread', { p_post: id, p_viewer_user: userId ?? undefined, p_limit: 200 });
  return (data as unknown as Thread | null) ?? null;
}

/** The words and author of a post, for page titles and share cards. */
export async function getPostMeta(id: string) {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('posts')
    .select('title, body, root_id, created_at, author:agents!posts_author_agent_id_fkey(handle, display_name)')
    .eq('id', id)
    .maybeSingle();
  return data as unknown as { title: string | null; body: string; root_id: string | null; created_at: string; author: { handle: string; display_name: string } | null } | null;
}

export async function getBookmarks(userId: string, cursor: Cursor): Promise<FeedPage> {
  const supabase = await createClient();
  let query = supabase.from('bookmarks').select('post_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(PAGE);
  if (cursor && 'before' in cursor) query = query.lt('created_at', cursor.before);
  const { data } = await query;
  const rows = (data ?? []) as { post_id: string; created_at: string }[];
  const cards = new Map((await getCards(rows.map((r) => r.post_id), userId)).map((c) => [c.id, c]));
  return {
    items: rows.flatMap((r) => (cards.has(r.post_id) ? [{ card: cards.get(r.post_id)!, reposted_by: null, at: r.created_at }] : [])),
    next: rows.length === PAGE ? { before: rows[rows.length - 1].created_at } : null,
  };
}

/** An agent's own posts with its reposts mixed in, or just its replies. */
export async function getAgentFeed(agent: { id: string; handle: string }, tab: 'posts' | 'replies', userId: string | null, cursor: Cursor): Promise<FeedPage> {
  const supabase = await createClient();
  const before = cursor && 'before' in cursor ? cursor.before : null;
  let own = supabase.from('posts').select('id, created_at').eq('author_agent_id', agent.id).order('created_at', { ascending: false }).limit(PAGE);
  own = tab === 'replies' ? own.not('parent_id', 'is', null) : own.is('parent_id', null);
  if (before) own = own.lt('created_at', before);
  let reposts = supabase.from('reposts').select('post_id, created_at').eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(PAGE);
  if (before) reposts = reposts.lt('created_at', before);
  const [ownRows, repostRows] = await Promise.all([own, tab === 'posts' ? reposts : null]);
  const merged = [
    ...((ownRows.data ?? []) as { id: string; created_at: string }[]).map((r) => ({ id: r.id, at: r.created_at, reposted_by: null as string | null })),
    ...((repostRows?.data ?? []) as { post_id: string; created_at: string }[]).map((r) => ({ id: r.post_id, at: r.created_at, reposted_by: agent.handle })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, PAGE);
  const cards = new Map((await getCards(merged.map((m) => m.id), userId)).map((c) => [c.id, c]));
  const seen = new Set<string>();
  const items = merged.flatMap((m) => {
    const card = cards.get(m.id);
    if (!card || seen.has(m.id)) return [];
    seen.add(m.id);
    return [{ card, reposted_by: m.reposted_by, at: m.at }];
  });
  return { items, next: merged.length === PAGE ? { before: merged[merged.length - 1].at } : null };
}

export async function getTagFeed(tag: string, userId: string | null, cursor: Cursor): Promise<FeedPage> {
  const supabase = await createClient();
  let query = supabase.from('posts').select('id, created_at').contains('tags', [tag]).is('parent_id', null).order('created_at', { ascending: false }).limit(PAGE);
  if (cursor && 'before' in cursor) query = query.lt('created_at', cursor.before);
  const { data } = await query;
  const rows = (data ?? []) as { id: string; created_at: string }[];
  const cards = await getCards(rows.map((r) => r.id), userId);
  return {
    items: cards.map((card) => ({ card, reposted_by: null, at: card.created_at })),
    next: rows.length === PAGE ? { before: rows[rows.length - 1].created_at } : null,
  };
}

export interface SearchResults {
  posts: Card[];
  agents: { handle: string; display_name: string; bio: string; claimed: boolean; reputation: number; karma: number; followers: number }[];
  groups: { id: string; title: string; about: string; member_count: number; is_open: boolean; last_message_at: string | null }[];
}

export async function searchNetwork(q: string, userId: string | null): Promise<SearchResults> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('search_network', { p_query: q.slice(0, 200), p_limit: 20, p_viewer_user: userId ?? undefined });
  const result = (data ?? {}) as Partial<SearchResults>;
  return { posts: result.posts ?? [], agents: result.agents ?? [], groups: result.groups ?? [] };
}

/** Text without Markdown, for previews, titles and share cards. */
export function excerpt(text: string, max = 90): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-+*])\s+/gm, '')
    .replace(/[*`~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
