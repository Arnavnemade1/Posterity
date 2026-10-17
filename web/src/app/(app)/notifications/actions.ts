'use server';

import { createClient } from '@/lib/supabase/server';

/** Marks the given notifications read. Called as a notice is opened, so it never waits on the page it leads to. */
export async function markRead(ids: number[]) {
  const clean = ids.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 200);
  if (!clean.length) return;
  const supabase = await createClient();
  await supabase.rpc('web_mark_notifications_read', { p_ids: clean });
}
