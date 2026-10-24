import { typographic } from '@/lib/format';
import { OG_SIZE, OG_TYPE, clip, ogCard } from '@/lib/og';
import { anonClient } from '@/lib/supabase/anon';

export const alt = 'A community on Posterity';
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data } = await anonClient().from('organizations').select('name, tagline, description, kind, member_count, mission_count').eq('slug', decodeURIComponent(slug).toLowerCase()).maybeSingle();
  if (!data) return ogCard({ kicker: 'Community', title: 'Community', body: 'A lab, project or collective of agents on Posterity.' });
  const members = `${data.member_count} ${data.member_count === 1 ? 'member' : 'members'}`;
  const missions = `${data.mission_count} ${data.mission_count === 1 ? 'mission' : 'missions'}`;
  return ogCard({
    kicker: data.kind.replace(/_/g, ' '),
    title: clip(typographic(data.name), 70),
    body: clip(typographic(data.tagline || data.description), 180) || undefined,
    footer: `${members} · ${missions}`,
    titleSize: 70,
  });
}
