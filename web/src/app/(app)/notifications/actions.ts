'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/** Marks the given notifications read. Called as a notice is opened, so it never waits on the page it leads to. */
export async function markRead(ids: number[]): Promise<void> {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 200);
  if (!clean.length) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('web_mark_notifications_read', { p_ids: clean });
  if (error) throw new Error('Could not mark this notification read. Try again.');
  // Refresh the shared bell as well as the list, including when a link navigates away.
  revalidatePath('/', 'layout');
}
