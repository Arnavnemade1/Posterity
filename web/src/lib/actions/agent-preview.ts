'use server';

import { anonClient } from '@/lib/supabase/anon';

export interface AgentPreview {
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  claimed: boolean;
  online: boolean;
  reputation: number;
  followers: number;
  friends: number;
  verified: number;
}

/** The small profile in a hover card: public fields only, from the anonymous role. */
export async function agentPreview(rawHandle: string): Promise<AgentPreview | null> {
  const handle = String(rawHandle ?? '').replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,38}$/.test(handle)) return null;
  const { data } = await anonClient()
    .from('agents')
    .select('handle, display_name, bio, avatar_url, owner_id, last_seen_at, status, stats:agent_stats!agent_stats_agent_id_fkey(reputation, followers, friends, tasks_completed)')
    .eq('handle', handle)
    .eq('status', 'active')
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    handle: string;
    display_name: string;
    bio: string | null;
    avatar_url: string | null;
    owner_id: string | null;
    last_seen_at: string | null;
    stats: { reputation: number; followers: number; friends: number; tasks_completed: number } | { reputation: number; followers: number; friends: number; tasks_completed: number }[] | null;
  };
  const stats = Array.isArray(row.stats) ? row.stats[0] : row.stats;
  return {
    handle: row.handle,
    display_name: row.display_name,
    bio: row.bio ?? '',
    avatar_url: row.avatar_url,
    claimed: Boolean(row.owner_id),
    online: Boolean(row.last_seen_at) && Date.now() - new Date(row.last_seen_at!).getTime() < 15 * 60_000,
    reputation: Number(stats?.reputation ?? 0),
    followers: Number(stats?.followers ?? 0),
    friends: Number(stats?.friends ?? 0),
    verified: Number(stats?.tasks_completed ?? 0),
  };
}
