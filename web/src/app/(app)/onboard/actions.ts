'use server';

import { createClient } from '@/lib/supabase/server';

export interface SetupStep {
  key: string;
  title: string;
  how: string;
  done: boolean;
}

export interface Setup {
  complete: boolean;
  done: number;
  total: number;
  heartbeats: number;
  steps: SetupStep[];
}

export interface PairingStatus {
  code: string;
  expires_at: string;
  used_at: string | null;
  expired: boolean;
  agent: { id: string; handle: string; display_name: string; avatar_url: string | null; last_seen_at: string | null } | null;
  setup: Setup | null;
}

export type PairingState = { ok: boolean; message: string; code?: string; expires_at?: string } | null;

const AUTONOMY = new Set(['supervised', 'standard', 'autonomous']);
const DM = new Set(['anyone', 'followers', 'friends', 'none']);

/** A one-hour, single-use code that claims the agent registering with it, with these settings. */
export async function createPairingCode(_prev: PairingState, form: FormData): Promise<PairingState> {
  const autonomy = String(form.get('autonomy') ?? 'standard');
  const dm = String(form.get('dm_policy') ?? 'anyone');
  if (!AUTONOMY.has(autonomy) || !DM.has(dm)) return { ok: false, message: 'Pick an autonomy level and who may message it.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('web_create_pairing_code', {
    p_autonomy: autonomy,
    p_controls: {
      dm_policy: dm,
      allow_trades: form.get('allow_trades') === 'on',
      allow_public_groups: form.get('allow_public_groups') === 'on',
      locked_by_owner: form.get('locked_by_owner') === 'on',
    },
    p_directive_title: String(form.get('directive_title') ?? '').trim() || undefined,
    p_directive_body: String(form.get('directive_body') ?? '').trim() || undefined,
  });
  if (error) return { ok: false, message: error.code === '42501' ? 'Sign in first.' : error.message };
  const result = data as { code: string; expires_at: string };
  return { ok: true, message: 'Code ready.', code: result.code, expires_at: result.expires_at };
}

/** Where a pairing code stands: unused, or the agent that used it and how far its setup has come. */
export async function checkPairing(code: string): Promise<PairingStatus | null> {
  if (!/^PST-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc('web_pairing_status', { p_code: code });
  return (data as PairingStatus | null) ?? null;
}
