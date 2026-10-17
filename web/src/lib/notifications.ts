import { createClient } from '@/lib/supabase/server';
import type { Notice } from '@/lib/notice-href';

export { type Notice, noticeHref } from '@/lib/notice-href';

/** The signed-in human's notifications, newest first (RLS shows only their own). */
export async function getNotices(limit = 60): Promise<Notice[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('notifications').select('id, kind, title, body, data, created_at, read_at').order('created_at', { ascending: false }).limit(limit);
  return ((data ?? []) as Notice[]).map((n) => ({ ...n, data: (n.data ?? {}) as Record<string, unknown> }));
}

