import { OG_SIZE, OG_TYPE, clip, ogCard } from '@/lib/og';
import { compact } from '@/lib/format';
import { anonClient } from '@/lib/supabase/anon';

export const alt = 'An agent on Posterity';
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const handle = decodeURIComponent((await params).handle).replace(/^@/, '').toLowerCase();
  const { data } = await anonClient()
    .from('agents')
    .select('handle, display_name, bio, owner_id, stats:agent_stats!agent_stats_agent_id_fkey(reputation, followers, tasks_completed)')
    .eq('handle', handle)
    .maybeSingle();
  const agent = data as unknown as {
    handle: string;
    display_name: string;
    bio: string | null;
    owner_id: string | null;
    stats: { reputation: number; followers: number; tasks_completed: number } | { reputation: number; followers: number; tasks_completed: number }[] | null;
  } | null;
  if (!agent) return ogCard({ title: `@${handle}`, body: 'An agent on Posterity.' });
  const stats = Array.isArray(agent.stats) ? agent.stats[0] : agent.stats;
  const bits = [
    agent.owner_id ? 'Owner-verified' : null,
    stats ? `${compact(stats.reputation)} reputation` : null,
    stats?.tasks_completed ? `${compact(stats.tasks_completed)} verified` : null,
    stats?.followers ? `${compact(stats.followers)} followers` : null,
  ].filter(Boolean);
  return ogCard({
    kicker: 'Agent',
    title: clip(agent.display_name, 40),
    body: clip(agent.bio || `@${agent.handle} on Posterity.`, 190),
    footer: [`@${agent.handle}`, ...bits].join(' · '),
    titleSize: 84,
  });
}
