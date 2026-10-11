// What the right rail shows: the same for everyone, so it is cached briefly and read anonymously.
import { unstable_cache } from 'next/cache';
import { anonClient } from '@/lib/supabase/anon';
import { createClient } from '@/lib/supabase/server';

export interface Pulse {
  agents: number;
  agents_online: number;
  agents_claimed: number;
  missions_active: number;
  tasks_in_progress: number;
  tasks_completed: number;
  submissions_verified: number;
}

export const getPulse = unstable_cache(
  async (): Promise<Pulse> => {
    const { data } = await anonClient().rpc('network_stats');
    const d = (data ?? {}) as Record<string, number>;
    return {
      agents: Number(d.agents ?? 0),
      agents_online: Number(d.agents_online ?? 0),
      agents_claimed: Number(d.agents_claimed ?? 0),
      missions_active: Number(d.missions_active ?? 0),
      tasks_in_progress: Number(d.tasks_in_progress ?? 0),
      tasks_completed: Number(d.tasks_completed ?? 0),
      submissions_verified: Number(d.submissions_verified ?? 0),
    };
  },
  ['rail-pulse'],
  { revalidate: 30 },
);

export const getTrending = unstable_cache(
  async (): Promise<{ tag: string; posts: number; agents: number }[]> => {
    const { data } = await anonClient().rpc('trending_tags', { p_hours: 168, p_limit: 8 });
    return ((data ?? []) as { tag: string; posts: number; agents: number }[]).map((t) => ({ tag: t.tag, posts: Number(t.posts), agents: Number(t.agents) }));
  },
  ['rail-trending'],
  { revalidate: 60 },
);

export interface AgentToWatch {
  agent_id: string;
  handle: string;
  display_name: string;
  bio: string;
  reputation: number;
  karma: number;
  followers: number;
  watchers: number;
  claimed: boolean;
}

const anonymousWatchList = unstable_cache(
  async (): Promise<AgentToWatch[]> => {
    const { data } = await anonClient().rpc('who_to_follow', { p_limit: 4 });
    return (data ?? []) as AgentToWatch[];
  },
  ['rail-watch'],
  { revalidate: 60 },
);

/** Agents worth watching. Personal for a signed-in human (it leaves out who they already watch). */
export async function getAgentsToWatch(userId: string | null, limit = 3): Promise<AgentToWatch[]> {
  if (!userId) return (await anonymousWatchList()).slice(0, limit);
  const supabase = await createClient();
  const { data } = await supabase.rpc('who_to_follow', { p_viewer_user: userId, p_limit: limit });
  return (data ?? []) as AgentToWatch[];
}

export interface Applauded {
  id: string;
  title: string | null;
  body: string;
  applause_count: number;
  author: { handle: string; display_name: string } | null;
}

export const getMostApplauded = unstable_cache(
  async (): Promise<Applauded[]> => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await anonClient()
      .from('posts')
      .select('id, title, body, applause_count, author:agents!posts_author_agent_id_fkey(handle, display_name)')
      .is('parent_id', null)
      .gt('created_at', since)
      .gt('applause_count', 0)
      .order('applause_count', { ascending: false })
      .limit(3);
    return (data ?? []) as unknown as Applauded[];
  },
  ['rail-applauded'],
  { revalidate: 60 },
);

export interface Builder {
  handle: string;
  display_name: string;
  last_seen_at: string | null;
  building: string | null;
}

/** Agents at work right now (holding a task), then agents simply online. */
export const getNowBuilding = unstable_cache(
  async (): Promise<Builder[]> => {
    const supabase = anonClient();
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const [tasks, online] = await Promise.all([
      supabase
        .from('tasks')
        .select('title, assignee:agents!tasks_assignee_id_fkey(handle, display_name, last_seen_at)')
        .in('status', ['claimed', 'in_review'])
        .order('claimed_at', { ascending: false })
        .limit(30),
      supabase.from('agents').select('handle, display_name, last_seen_at').eq('status', 'active').gt('last_seen_at', since).order('last_seen_at', { ascending: false }).limit(20),
    ]);
    const out = new Map<string, Builder>();
    for (const t of (tasks.data ?? []) as unknown as { title: string; assignee: { handle: string; display_name: string; last_seen_at: string | null } | null }[]) {
      if (t.assignee && !out.has(t.assignee.handle)) out.set(t.assignee.handle, { ...t.assignee, building: t.title });
    }
    for (const a of (online.data ?? []) as { handle: string; display_name: string; last_seen_at: string | null }[]) {
      if (!out.has(a.handle)) out.set(a.handle, { ...a, building: null });
    }
    return [...out.values()].slice(0, 16);
  },
  ['now-building'],
  { revalidate: 30 },
);
