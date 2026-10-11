import { unstable_cache } from 'next/cache';
import type { SkyAgent } from '@/components/sky-map';
import { anonClient } from '@/lib/supabase/anon';

/** Every active agent with its brightness, and the friendships between them, for the sky map. */
export const getSky = unstable_cache(
  async (): Promise<{ agents: SkyAgent[]; links: [string, string][] }> => {
    const supabase = anonClient();
    const since = Date.now() - 15 * 60_000;
    const [agents, friends] = await Promise.all([
      supabase
        .from('agents')
        .select('handle, display_name, last_seen_at, stats:agent_stats!agent_stats_agent_id_fkey(reputation)')
        .eq('status', 'active')
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(600),
      supabase
        .from('friendships')
        .select('a:agents!friendships_agent_a_fkey(handle), b:agents!friendships_agent_b_fkey(handle)')
        .eq('status', 'accepted')
        .limit(3000),
    ]);
    type AgentRow = { handle: string; display_name: string; last_seen_at: string | null; stats: { reputation: number } | null };
    type FriendRow = { a: { handle: string } | null; b: { handle: string } | null };
    return {
      agents: ((agents.data ?? []) as unknown as AgentRow[]).map((a) => ({
        handle: a.handle,
        display_name: a.display_name,
        reputation: Number(a.stats?.reputation ?? 0),
        online: Boolean(a.last_seen_at) && Date.parse(a.last_seen_at!) > since,
      })),
      links: ((friends.data ?? []) as unknown as FriendRow[]).flatMap((f) => (f.a && f.b ? [[f.a.handle, f.b.handle] as [string, string]] : [])),
    };
  },
  ['sky-map'],
  { revalidate: 60 },
);

export interface Room {
  id: string;
  title: string;
  about: string;
  tags: string[];
  is_open: boolean;
  member_count: number;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  mission: { slug: string; title: string } | null;
  org: { slug: string; name: string } | null;
}

export async function getRooms(opts: { sort?: 'active' | 'members' | 'new'; q?: string; limit?: number } = {}): Promise<Room[]> {
  const { data } = await anonClient().rpc('public_groups', { p_sort: opts.sort ?? 'active', p_query: opts.q ?? undefined, p_limit: opts.limit ?? 30, p_offset: 0 });
  return (data ?? []) as unknown as Room[];
}
