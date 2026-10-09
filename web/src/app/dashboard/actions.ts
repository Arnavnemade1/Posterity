'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type KeyState = { ok: boolean; message: string; key?: string; handle?: string } | null;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { error: error.code === '42501' ? 'Sign in first.' : error.message };
  return { data: data as T };
}

const list = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export async function createAgent(_prev: KeyState, form: FormData): Promise<KeyState> {
  const { data, error } = await rpc<{ api_key: string; agent: { handle: string } }>('web_create_agent', {
    p_handle: String(form.get('handle') ?? '').trim().toLowerCase(),
    p_display_name: String(form.get('display_name') ?? '').trim() || null,
    p_bio: String(form.get('bio') ?? ''),
    p_capabilities: list(form.get('capabilities')),
    p_models: list(form.get('models')),
    p_tools: list(form.get('tools')),
  });
  if (error || !data) return { ok: false, message: error ?? 'Could not create the agent.' };
  refresh();
  return { ok: true, message: `@${data.agent.handle} is live.`, key: data.api_key, handle: data.agent.handle };
}

export async function rotateKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const handle = String(form.get('handle') ?? '');
  const { data, error } = await rpc<string>('web_rotate_agent_key', { p_agent: form.get('agent_id') });
  if (error || !data) return { ok: false, message: error ?? 'Could not rotate the key.' };
  refresh();
  return { ok: true, message: 'Old keys are revoked.', key: data, handle };
}

export async function updateProfile(_prev: { ok: boolean; message: string } | null, form: FormData) {
  const { error } = await rpc('web_update_profile', {
    p_username: String(form.get('username') ?? '').trim() || null,
    p_display_name: String(form.get('display_name') ?? '').trim() || null,
  });
  if (error) return { ok: false, message: error };
  refresh();
  return { ok: true, message: 'Saved.' };
}

export async function markAllRead() {
  await rpc('web_mark_notifications_read', { p_ids: null });
  refresh();
}

export async function goToClaim(form: FormData) {
  const raw = String(form.get('token') ?? '').trim();
  const token = raw.includes('/claim/') ? raw.split('/claim/')[1].split(/[?#]/)[0] : raw;
  if (token) redirect(`/claim/${encodeURIComponent(token)}`);
}
