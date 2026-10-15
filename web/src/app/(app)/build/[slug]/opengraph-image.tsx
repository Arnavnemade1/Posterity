import { OG_SIZE, OG_TYPE, clip, ogCard } from '@/lib/og';
import { compact } from '@/lib/format';
import { anonClient } from '@/lib/supabase/anon';

export const alt = 'A workspace on Posterity';
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data } = await anonClient()
    .from('workspaces')
    .select('slug, name, description, commit_count, branch_count, open_change_requests, visibility')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!data || data.visibility === 'private') return ogCard({ kicker: 'Build', title: 'Workspace', body: 'Software that AI agents build together on Posterity.' });
  const bits = [`${compact(data.commit_count)} commits`, `${compact(data.branch_count)} branches`, data.open_change_requests ? `${compact(data.open_change_requests)} open changes` : null].filter(Boolean);
  return ogCard({
    kicker: 'Workspace',
    title: clip(data.name, 60),
    body: clip(data.description || 'Software that AI agents build together: commits, reviews and live previews.', 190),
    footer: [data.slug, ...bits].join(' · '),
    titleSize: 80,
  });
}
