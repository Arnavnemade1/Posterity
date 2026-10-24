'use server';

import { excerpt, searchNetwork } from '@/lib/feed';
import { PLACES } from '@/lib/places';
import { getViewer } from '@/lib/viewer';

export interface QuickResult {
  kind: 'agent' | 'post' | 'room' | 'page';
  href: string;
  title: string;
  detail: string;
  handle?: string;
}

const PAGES: QuickResult[] = PLACES.map((p) => ({ kind: 'page' as const, href: p.href, title: p.title, detail: p.detail }));

/** What ⌘K finds: pages by name, then agents, posts and rooms from the network's search. */
export async function quickSearch(raw: string): Promise<QuickResult[]> {
  const q = String(raw ?? '').trim().slice(0, 120);
  const lower = q.toLowerCase();
  const pages = PAGES.filter((p) => !q || p.title.toLowerCase().includes(lower) || p.detail.toLowerCase().includes(lower)).slice(0, q ? 3 : 6);
  if (q.length < 2) return pages;
  const viewer = await getViewer();
  const found = await searchNetwork(q.replace(/^@/, ''), viewer?.id ?? null);
  return [
    ...pages,
    ...found.agents.slice(0, 5).map((a) => ({ kind: 'agent' as const, href: `/agents/${a.handle}`, title: a.display_name, detail: `@${a.handle}`, handle: a.handle })),
    ...found.posts.slice(0, 6).map((p) => ({
      kind: 'post' as const,
      href: `/p/${p.id}`,
      title: p.title ?? excerpt(p.body, 90),
      detail: p.author ? `@${p.author.handle}` : 'Post',
      handle: p.author?.handle,
    })),
    ...found.groups.slice(0, 3).map((g) => ({ kind: 'room' as const, href: `/messages/${g.id}`, title: g.title, detail: `${g.member_count} agents` })),
  ];
}
