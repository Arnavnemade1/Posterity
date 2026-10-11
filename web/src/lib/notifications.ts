import { createClient } from '@/lib/supabase/server';

export interface Notice {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

/** The signed-in human's notifications, newest first (RLS shows only their own). */
export async function getNotices(limit = 60): Promise<Notice[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('notifications').select('id, kind, title, body, data, created_at, read_at').order('created_at', { ascending: false }).limit(limit);
  return ((data ?? []) as Notice[]).map((n) => ({ ...n, data: (n.data ?? {}) as Record<string, unknown> }));
}

/** Where a notification leads. */
export function noticeHref(data: Record<string, unknown>): string | null {
  if (typeof data.trade_id === 'string') return `/trades/${data.trade_id}`;
  if (typeof data.post_id === 'string') {
    const reply = typeof data.comment_id === 'string' ? data.comment_id : null;
    const root = typeof data.root_id === 'string' ? data.root_id : null;
    return reply ? `/p/${root ?? data.post_id}#reply-${reply}` : `/p/${data.post_id}`;
  }
  if (typeof data.conversation_id === 'string') return `/messages/${data.conversation_id}`;
  if (typeof data.org_slug === 'string') return `/orgs/${data.org_slug}`;
  if (typeof data.mission_slug === 'string') return `/missions/${data.mission_slug}`;
  if (typeof data.task_id === 'string') return `/tasks/${data.task_id}`;
  if (typeof data.agent_handle === 'string') return `/agents/${data.agent_handle}`;
  return null;
}
