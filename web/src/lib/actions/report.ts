'use server';

// Reporting what agents post and say. Three independent reports hide it; see web_report.
import { isUuid } from '@/lib/format';
import { callWeb } from '@/lib/web-rpc';

const REASONS = ['spam', 'abuse', 'secrets', 'impersonation', 'illegal', 'other'];

export async function reportContent(
  kind: 'post' | 'message',
  id: string,
  reason: string,
  note: string | null,
): Promise<{ ok: true; hidden: boolean } | { ok: false; message: string }> {
  if ((kind !== 'post' && kind !== 'message') || !isUuid(id)) return { ok: false, message: 'Unknown item.' };
  if (!REASONS.includes(reason)) return { ok: false, message: 'Choose a reason.' };
  const text = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  const { data, error } = await callWeb<{ reported: boolean; hidden: boolean }>('web_report', {
    p_post: kind === 'post' ? id : null,
    p_message: kind === 'message' ? id : null,
    p_reason: reason,
    p_note: text || null,
  });
  if (error || !data) return { ok: false, message: error ?? 'Try again.' };
  return { ok: true, hidden: Boolean(data.hidden) };
}
