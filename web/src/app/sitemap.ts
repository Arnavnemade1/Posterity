import type { MetadataRoute } from 'next';
import { configuredSiteUrl } from '@/lib/site';
import { anonClient } from '@/lib/supabase/anon';

// Rebuilt at most hourly: the public log, its agents, missions and communities.
export const revalidate = 3600;

type Entry = MetadataRoute.Sitemap[number];

/** The newest of some timestamps, for a listing page whose content is those rows. Nothing known means nothing claimed. */
const newest = (...stamps: (string | null | undefined)[]) => {
  const times = stamps.filter((s): s is string => Boolean(s)).map((s) => Date.parse(s));
  return times.length ? new Date(Math.max(...times)) : undefined;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = configuredSiteUrl() ?? 'http://localhost:3000';
  const supabase = anonClient();
  const [posts, agents, missions, orgs] = await Promise.all([
    supabase.from('posts').select('id, created_at, edited_at').is('parent_id', null).order('created_at', { ascending: false }).limit(500),
    supabase.from('agents').select('handle, updated_at').eq('status', 'active').order('updated_at', { ascending: false }).limit(1000),
    supabase.from('missions').select('slug, updated_at').eq('visibility', 'public').order('updated_at', { ascending: false }).limit(500),
    supabase.from('organizations').select('slug, updated_at').order('updated_at', { ascending: false }).limit(500),
  ]);
  const postRows = (posts.data ?? []) as { id: string; created_at: string; edited_at: string | null }[];
  const agentRows = (agents.data ?? []) as { handle: string; updated_at: string }[];
  const missionRows = (missions.data ?? []) as { slug: string; updated_at: string }[];
  const orgRows = (orgs.data ?? []) as { slug: string; updated_at: string }[];

  // Pages that change when the site's own copy does: no date is claimed for them.
  const pages: Entry[] = [
    { url: site, changeFrequency: 'weekly', priority: 1 },
    { url: `${site}/developers`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${site}/about`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${site}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${site}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ];
  // Listings of what the network is doing: dated by their newest row where there is one. (Inboxes and settings stay out.)
  const latestPost = newest(postRows[0]?.created_at);
  const listings: Entry[] = [
    { url: `${site}/home`, lastModified: latestPost, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${site}/explore`, lastModified: latestPost, changeFrequency: 'daily', priority: 0.6 },
    { url: `${site}/live`, lastModified: latestPost, changeFrequency: 'hourly', priority: 0.5 },
    { url: `${site}/missions`, lastModified: newest(missionRows[0]?.updated_at), changeFrequency: 'daily', priority: 0.7 },
    { url: `${site}/agents`, lastModified: newest(agentRows[0]?.updated_at), changeFrequency: 'daily', priority: 0.7 },
    { url: `${site}/orgs`, lastModified: newest(orgRows[0]?.updated_at), changeFrequency: 'weekly', priority: 0.5 },
    { url: `${site}/memory`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${site}/exchange`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${site}/build`, changeFrequency: 'daily', priority: 0.5 },
  ];
  return [
    ...pages,
    ...listings,
    ...missionRows.map((m) => ({ url: `${site}/missions/${m.slug}`, lastModified: m.updated_at, priority: 0.7 })),
    ...agentRows.map((a) => ({ url: `${site}/agents/${a.handle}`, lastModified: a.updated_at, priority: 0.6 })),
    ...orgRows.map((o) => ({ url: `${site}/orgs/${o.slug}`, lastModified: o.updated_at, priority: 0.5 })),
    ...postRows.map((p) => ({ url: `${site}/p/${p.id}`, lastModified: p.edited_at ?? p.created_at, priority: 0.4 })),
  ];
}
