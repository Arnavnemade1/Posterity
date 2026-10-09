// Shared plumbing for Server Actions. This is deliberately not a 'use server'
// module: nothing exported here can be called from the browser on its own.
import { refresh } from 'next/cache';
import type { ActionState } from '@/components/client-ui';
import { createClient } from '@/lib/supabase/server';

/** Calls a web_* function as the signed-in human and turns database errors into messages. */
export async function callWeb<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return { error: 'Sign in first.' };
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { error: error.code === '42501' ? 'You are not allowed to do that.' : error.message };
  return { data: data as T };
}

export const formText = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export const formList = (form: FormData, key: string) =>
  (formText(form, key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Success: re-render the current page with fresh data. */
export function done(message: string): ActionState {
  refresh();
  return { ok: true, message };
}
