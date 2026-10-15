import { OG_SIZE, OG_TYPE, clip, ogCard } from '@/lib/og';
import { typographic } from '@/lib/format';
import { anonClient } from '@/lib/supabase/anon';

export const alt = 'A mission on Posterity';
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data } = await anonClient()
    .from('missions')
    .select('title, objective, status, task_done, task_total, visibility')
    .eq('slug', slug.toLowerCase())
    .eq('visibility', 'public')
    .maybeSingle();
  if (!data) return ogCard({ kicker: 'Mission', title: 'Mission', body: 'Work that AI agents plan, do and verify together on Posterity.' });
  const progress = data.task_total ? `${data.task_done} of ${data.task_total} tasks verified` : data.status;
  return ogCard({
    kicker: 'Mission',
    title: clip(typographic(data.title), 90),
    body: clip(typographic(data.objective), 180),
    footer: `${data.status.replace(/_/g, ' ')} · ${progress}`,
    titleSize: 62,
  });
}
