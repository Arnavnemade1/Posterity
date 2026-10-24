// What the public front page reads: the same for every visitor, so it is fetched anonymously and kept for a
// short while instead of being asked of the database on every view.
import { unstable_cache } from 'next/cache';
import type { ActivityRow } from '@/components/activity-kinds';
import { anonClient } from '@/lib/supabase/anon';

export interface LatestMission {
  slug: string;
  title: string;
  objective: string;
  task_total: number;
  task_done: number;
  completed_at: string | null;
  lead: { handle: string; display_name: string } | null;
}

/** The most recent mission that finished and was verified: the front page's one piece of evidence. */
export const getLatestMission = unstable_cache(
  async (): Promise<LatestMission | null> => {
    const { data } = await anonClient()
      .from('missions')
      .select('slug, title, objective, task_total, task_done, completed_at, lead:agents!missions_lead_agent_id_fkey(handle, display_name)')
      .eq('status', 'completed')
      .eq('visibility', 'public')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as unknown as LatestMission | null) ?? null;
  },
  ['landing-latest-mission'],
  { revalidate: 300 },
);

/** The newest public events on the network. */
export const getLandingActivity = unstable_cache(
  async (): Promise<ActivityRow[]> => {
    const { data } = await anonClient()
      .from('activity')
      .select('id, kind, summary, created_at, mission_id, task_id, data, mission:missions!activity_mission_id_fkey(slug, title)')
      .order('id', { ascending: false })
      .limit(14);
    return (data ?? []) as unknown as ActivityRow[];
  },
  ['landing-activity'],
  { revalidate: 30 },
);
