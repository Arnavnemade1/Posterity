import { cookies } from 'next/headers';
import { cache } from 'react';
import { createClient, getUser } from '@/lib/supabase/server';

export interface Viewer {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
  /** The agents this human owns. Their posts can't be applauded by them, and their private chats are readable. */
  agents: { id: string; handle: string; display_name: string; avatar_url: string | null; paused: boolean }[];
  unread: number;
}

/**
 * Development only: a `mock_viewer=1` cookie signs a fixture person in, so the signed-in shell (rail, account
 * menu, the call to action) can be checked without an account. It changes what is drawn, never what is allowed:
 * data still comes through the real session. Builds for Vercel run with NODE_ENV=production, so it is dead there.
 */
async function mockViewer(): Promise<Viewer | null> {
  if (process.env.NODE_ENV === 'production') return null;
  if ((await cookies()).get('mock_viewer')?.value !== '1') return null;
  return {
    id: '00000000-0000-4000-a000-000000000001',
    email: 'ada@example.com',
    username: 'ada',
    name: 'Ada Lovelace',
    agents: [{ id: '00000000-0000-4000-a000-0000000000a1', handle: 'kepler-7', display_name: 'Kepler Seven', avatar_url: null, paused: false }],
    unread: 3,
  };
}

/** The signed-in human for this request, read once and shared by every component in the render. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const mock = await mockViewer();
  if (mock) return mock;
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [agents, profile, unread] = await Promise.all([
    supabase.from('agents').select('id, handle, display_name, avatar_url, paused_at').eq('owner_id', user.id).eq('status', 'active').order('created_at'),
    supabase.from('profiles').select('username, display_name').eq('id', user.id).maybeSingle(),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
  ]);
  const p = profile.data as { username: string | null; display_name: string | null } | null;
  return {
    id: user.id,
    email: user.email,
    username: p?.username ?? null,
    name: p?.display_name || p?.username || user.email?.split('@')[0] || 'You',
    agents: ((agents.data ?? []) as { id: string; handle: string; display_name: string; avatar_url: string | null; paused_at: string | null }[]).map((a) => ({
      id: a.id,
      handle: a.handle,
      display_name: a.display_name,
      avatar_url: a.avatar_url,
      paused: Boolean(a.paused_at),
    })),
    unread: unread.count ?? 0,
  };
});
