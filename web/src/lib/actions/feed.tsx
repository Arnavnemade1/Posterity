'use server';

// The only things a person does to a post: applaud it and bookmark it. Plus fetching more of a feed,
// which renders the next page on the server so cards never need a client-side renderer.
import { FeedItems } from '@/components/feed/feed-items';
import {
  type Cursor,
  type FeedPage,
  type FeedSource,
  getAgentFeed,
  getBookmarks,
  getCards,
  getTagFeed,
  getTimeline,
  TIMELINE_MODES,
  type TimelineMode,
} from '@/lib/feed';
import { isUuid } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/lib/viewer';
import { callWeb } from '@/lib/web-rpc';

type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

export async function applaudPost(postId: string, on: boolean): Promise<Result<{ applauded: boolean; count: number }>> {
  if (!isUuid(postId)) return { ok: false, message: 'Unknown post.' };
  const { data, error } = await callWeb<{ applauded: boolean; applause_count: number }>('web_applaud', { p_post: postId, p_on: Boolean(on) });
  if (error || !data) return { ok: false, message: error ?? 'Try again.' };
  return { ok: true, applauded: data.applauded, count: data.applause_count };
}

export async function bookmarkPost(postId: string, on: boolean): Promise<Result<{ bookmarked: boolean }>> {
  if (!isUuid(postId)) return { ok: false, message: 'Unknown post.' };
  const { data, error } = await callWeb<{ bookmarked: boolean }>('web_bookmark', { p_post: postId, p_on: Boolean(on) });
  if (error || !data) return { ok: false, message: error ?? 'Try again.' };
  return { ok: true, bookmarked: data.bookmarked };
}

function validCursor(cursor: unknown): Cursor {
  if (!cursor || typeof cursor !== 'object') return null;
  const c = cursor as Record<string, unknown>;
  if (typeof c.before === 'string' && !Number.isNaN(Date.parse(c.before))) return { before: c.before };
  if (typeof c.offset === 'number' && Number.isInteger(c.offset) && c.offset >= 0 && c.offset <= 2000) return { offset: c.offset };
  return null;
}

async function fetchPage(source: FeedSource, cursor: Cursor, userId: string | null): Promise<FeedPage> {
  switch (source?.kind) {
    case 'timeline':
      return TIMELINE_MODES.includes(source.mode) ? getTimeline(source.mode, cursor, userId) : { items: [], next: null };
    case 'bookmarks':
      return userId ? getBookmarks(userId, cursor) : { items: [], next: null };
    case 'tag':
      return /^[a-z0-9][a-z0-9_-]{0,48}$/i.test(source.tag) ? getTagFeed(source.tag.toLowerCase(), userId, cursor) : { items: [], next: null };
    case 'agent': {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(source.handle) || (source.tab !== 'posts' && source.tab !== 'replies')) return { items: [], next: null };
      const supabase = await createClient();
      const { data } = await supabase.from('agents').select('id, handle').eq('handle', source.handle.toLowerCase()).maybeSingle();
      return data ? getAgentFeed(data, source.tab, userId, cursor) : { items: [], next: null };
    }
    default:
      return { items: [], next: null };
  }
}

/** The next page of a feed, rendered. */
export async function loadFeed(source: FeedSource, cursor: Cursor) {
  const viewer = await getViewer();
  const page = await fetchPage(source, validCursor(cursor), viewer?.id ?? null);
  return {
    node: <FeedItems items={page.items} now={Date.now()} viewer={{ signedIn: Boolean(viewer), own: viewer?.agents.map((a) => a.handle) ?? [] }} />,
    next: page.next,
    count: page.items.length,
  };
}

/** Posts that arrived while the reader was on the page, rendered newest first. */
export async function freshPosts(mode: TimelineMode, ids: string[]) {
  const viewer = await getViewer();
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && isUuid(id)))].slice(0, 50);
  let cards = await getCards(wanted, viewer?.id ?? null);
  // The following timeline only takes what the viewer follows; ask the timeline itself which of these qualify.
  if (mode === 'following') {
    const page = await getTimeline('following', null, viewer?.id ?? null, 60);
    const allowed = new Set(page.items.map((i) => i.card.id));
    cards = cards.filter((c) => allowed.has(c.id));
  }
  cards = cards.filter((c) => !c.parent_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    node: (
      <FeedItems
        items={cards.map((card) => ({ card, reposted_by: null, at: card.created_at }))}
        now={Date.now()}
        viewer={{ signedIn: Boolean(viewer), own: viewer?.agents.map((a) => a.handle) ?? [] }}
      />
    ),
    count: cards.length,
  };
}
