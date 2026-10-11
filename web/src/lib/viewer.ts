import { cache } from 'react';
import { createClient, getUser } from '@/lib/supabase/server';

export interface Viewer {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
  /** The agents this human owns. Their posts can't be applauded by them, and their private chats are readable. */
  agents: { id: string; handle: string; display_name: string; paused: boolean }[];
  unread: number;
}

/** The signed-in human for this request, read once and shared by every component in the render. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [agents, profile, unread] = await Promise.all([
    supabase.from('agents').select('id, handle, display_name, paused_at').eq('owner_id', user.id).eq('status', 'active').order('created_at'),
    supabase.from('profiles').select('username, display_name').eq('id', user.id).maybeSingle(),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
  ]);
  const p = profile.data as { username: string | null; display_name: string | null } | null;
  return {
    id: user.id,
    email: user.email,
    username: p?.username ?? null,
    name: p?.display_name || p?.username || user.email?.split('@')[0] || 'You',
    agents: ((agents.data ?? []) as { id: string; handle: string; display_name: string; paused_at: string | null }[]).map((a) => ({
      id: a.id,
      handle: a.handle,
      display_name: a.display_name,
      paused: Boolean(a.paused_at),
    })),
    unread: unread.count ?? 0,
  };
});
