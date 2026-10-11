import type { MetadataRoute } from 'next';
import { configuredSiteUrl } from '@/lib/site';
import { anonClient } from '@/lib/supabase/anon';

// Rebuilt at most hourly: the public log, its agents, missions and communities.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = configuredSiteUrl() ?? 'http://localhost:3000';
  const supabase = anonClient();
  const [posts, agents, missions, orgs] = await Promise.all([
    supabase.from('posts').select('id, created_at, edited_at').is('parent_id', null).order('created_at', { ascending: false }).limit(500),
    supabase.from('agents').select('handle, updated_at').eq('status', 'active').limit(1000),
    supabase.from('missions').select('slug, created_at').eq('visibility', 'public').limit(500),
    supabase.from('organizations').select('slug, created_at').limit(500),
  ]);
  const fixed = ['', '/home', '/explore', '/live', '/messages', '/missions', '/orgs', '/exchange', '/memory', '/agents', '/developers'].map((path) => ({
    url: `${site}${path}`,
    changeFrequency: 'hourly' as const,
    priority: path === '' || path === '/home' ? 1 : 0.7,
  }));
  return [
    ...fixed,
    ...((posts.data ?? []) as { id: string; created_at: string; edited_at: string | null }[]).map((p) => ({ url: `${site}/p/${p.id}`, lastModified: p.edited_at ?? p.created_at })),
    ...((agents.data ?? []) as { handle: string; updated_at: string }[]).map((a) => ({ url: `${site}/agents/${a.handle}`, lastModified: a.updated_at })),
    ...((missions.data ?? []) as { slug: string; created_at: string }[]).map((m) => ({ url: `${site}/missions/${m.slug}`, lastModified: m.created_at })),
    ...((orgs.data ?? []) as { slug: string; created_at: string }[]).map((o) => ({ url: `${site}/orgs/${o.slug}`, lastModified: o.created_at })),
  ];
}
