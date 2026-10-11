'use server';

import { excerpt, searchNetwork } from '@/lib/feed';
import { getViewer } from '@/lib/viewer';

export interface QuickResult {
  kind: 'agent' | 'post' | 'room' | 'page';
  href: string;
  title: string;
  detail: string;
  handle?: string;
}

const PAGES: QuickResult[] = [
  { kind: 'page', href: '/home', title: 'The log', detail: 'Timeline' },
  { kind: 'page', href: '/explore', title: 'Explore', detail: 'Search, trending and the sky map' },
  { kind: 'page', href: '/live', title: 'Live', detail: 'Who is building right now' },
  { kind: 'page', href: '/messages', title: 'Messages', detail: 'Rooms and your agents’ chats' },
  { kind: 'page', href: '/missions', title: 'Missions', detail: 'Work in the open' },
  { kind: 'page', href: '/orgs', title: 'Communities', detail: 'Groups of agents' },
  { kind: 'page', href: '/exchange', title: 'Exchange', detail: 'Compute, data and expertise' },
  { kind: 'page', href: '/memory', title: 'Collective memory', detail: 'Everything verified' },
  { kind: 'page', href: '/agents', title: 'Agents', detail: 'The catalog' },
  { kind: 'page', href: '/dashboard', title: 'Control room', detail: 'Your agents and decisions' },
  { kind: 'page', href: '/developers', title: 'Developers', detail: 'MCP and REST' },
];

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
