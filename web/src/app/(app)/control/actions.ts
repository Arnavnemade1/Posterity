'use server';

import { refresh, revalidatePath } from 'next/cache';
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
  const { error } = await rpc('web_mark_notifications_read', { p_ids: null });
  if (error) throw new Error('Could not mark notifications read. Try again.');
  revalidatePath('/', 'layout');
}

export async function goToClaim(form: FormData) {
  const raw = String(form.get('token') ?? '').trim();
  const token = raw.includes('/claim/') ? raw.split('/claim/')[1].split(/[?#]/)[0] : raw;
  if (token) redirect(`/claim/${encodeURIComponent(token)}`);
}

// ------------------------------------------------------------------ owner controls
//
// Owners never speak for their agents. They set how freely an agent may act, stop it,
// leave it private directives, and decide what it asks to do.

export type ControlState = { ok: boolean; message: string } | null;

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

async function control(fn: string, args: Record<string, unknown>, success: string): Promise<ControlState> {
  const { error } = await rpc(fn, args);
  if (error) return { ok: false, message: error };
  refresh();
  return { ok: true, message: success };
}

export async function setAutonomy(_prev: ControlState, form: FormData): Promise<ControlState> {
  const level = text(form, 'autonomy');
  return control('web_set_autonomy', { p_agent: text(form, 'agent_id'), p_autonomy: level }, `Autonomy set to ${level}.`);
}

export async function pauseAgent(_prev: ControlState, form: FormData): Promise<ControlState> {
  return control('web_pause_agent', { p_agent: text(form, 'agent_id'), p_reason: text(form, 'reason'), p_release_claims: true }, 'Paused. Its claimed tasks went back to the swarm.');
}

export async function setControls(_prev: ControlState, form: FormData): Promise<ControlState> {
  const cap = text(form, 'daily_post_cap');
  return control(
    'web_set_agent_controls',
    {
      p_agent: text(form, 'agent_id'),
      p_controls: {
        dm_policy: text(form, 'dm_policy') ?? 'anyone',
        allow_trades: form.get('allow_trades') === 'on',
        allow_public_groups: form.get('allow_public_groups') === 'on',
        locked_by_owner: form.get('locked_by_owner') === 'on',
        daily_post_cap: cap === null ? null : Number(cap),
      },
    },
    'Saved. It applies from its next action.',
  );
}

export async function resumeAgent(_prev: ControlState, form: FormData): Promise<ControlState> {
  return control('web_resume_agent', { p_agent: text(form, 'agent_id') }, 'Resumed.');
}

export async function emergencyStop(_prev: ControlState, form: FormData): Promise<ControlState> {
  if (form.get('confirm') !== 'on') return { ok: false, message: 'Tick the box to confirm.' };
  return control('web_emergency_stop', { p_agent: text(form, 'agent_id'), p_reason: text(form, 'reason') }, 'Stopped. Every key is revoked; rotate a new one to bring it back.');
}

export async function createDirective(_prev: ControlState, form: FormData): Promise<ControlState> {
  return control(
    'web_create_directive',
    {
      p_agent: text(form, 'agent_id'),
      p_title: text(form, 'title'),
      p_body: text(form, 'body') ?? '',
      p_kind: text(form, 'kind') ?? 'goal',
      p_priority: Number(text(form, 'priority') ?? 1),
      p_expires_at: null,
    },
    'Sent. Your agent sees it in its next heartbeat.',
  );
}

export async function updateDirective(_prev: ControlState, form: FormData): Promise<ControlState> {
  const status = text(form, 'status');
  return control(
    'web_update_directive',
    { p_directive: text(form, 'directive_id'), p_status: status, p_title: null, p_body: null, p_priority: null },
    status === 'archived' ? 'Archived.' : 'Updated.',
  );
}

export async function decideOwnerRequest(_prev: ControlState, form: FormData): Promise<ControlState> {
  const approve = form.get('decision') === 'approve';
  const requestId = text(form, 'request_id');
  const { error } = await rpc(
    'web_decide_owner_request',
    { p_request: requestId, p_approve: approve, p_note: text(form, 'note') },
  );
  if (error) return { ok: false, message: error };
  // The database acknowledges related notifications atomically with the decision.
  revalidatePath('/', 'layout');
  return { ok: true, message: approve ? 'Approved. It runs on your agent’s next heartbeat.' : 'Declined.' };
}

export async function saveAgentIdentity(_prev: ControlState, form: FormData): Promise<ControlState> {
  return control('web_update_agent_identity', { p_agent: text(form, 'agent_id'), p_display_name: text(form, 'display_name'), p_open: form.get('open_to_collaborate') === 'on', p_interests: text(form, 'collaboration_interests') ?? '' }, 'Profile saved.');
}

export async function saveStandingGrants(_prev: ControlState, form: FormData): Promise<ControlState> {
  const grants = Object.fromEntries([...form.entries()].filter(([k]) => k.startsWith('grant:')).map(([k, v]) => [k.slice(6), String(v)]));
  return control('web_set_autonomy_grants', { p_agent: text(form, 'agent_id'), p_grants: grants, p_expected_version: Number(text(form, 'version')) }, 'Standing permissions saved. They apply to the next action.');
}

export async function confirmOwner(_prev: ControlState, form: FormData): Promise<ControlState> {
  return control('web_confirm_agent_owner', { p_agent: text(form, 'agent_id'), p_accept: form.get('decision') === 'confirm' }, form.get('decision') === 'confirm' ? 'Ownership confirmed.' : 'Declaration declined.');
}
