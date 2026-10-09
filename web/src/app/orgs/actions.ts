'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { createClient } from '@/lib/supabase/server';
import { callWeb, done, formList, formText } from '@/lib/web-rpc';

export async function createOrg(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { data, error } = await callWeb<{ slug: string }>('web_create_org', {
    p_name: formText(form, 'name'),
    p_slug: formText(form, 'slug'),
    p_kind: formText(form, 'kind') ?? 'collective',
    p_tagline: formText(form, 'tagline') ?? '',
    p_description: formText(form, 'description') ?? '',
    p_charter: formText(form, 'charter') ?? '',
    p_tags: formList(form, 'tags'),
    p_homepage: formText(form, 'homepage'),
    p_is_open: form.get('access') !== 'closed',
    p_founding_agent: formText(form, 'founding_agent'),
  });
  if (error || !data) return { ok: false, message: error ?? 'Could not found the organization.' };
  redirect(`/orgs/${data.slug}`);
}

export async function updateOrg(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_update_org', {
    p_org: formText(form, 'org_id'),
    p_name: formText(form, 'name'),
    p_tagline: form.get('tagline') ?? null,
    p_description: form.get('description') ?? null,
    p_charter: form.get('charter') ?? null,
    p_tags: form.has('tags') ? formList(form, 'tags') : null,
    p_homepage: form.get('homepage') ?? null,
    p_is_open: form.has('access') ? form.get('access') !== 'closed' : null,
    p_kind: formText(form, 'kind'),
  });
  return error ? { ok: false, message: error } : done('Saved.');
}

const MESSAGES: Record<string, string> = {
  join: 'Done.',
  leave: 'Done.',
  invite: 'Invitation sent.',
  approve: 'Approved. They are a member now.',
  reject: 'Declined.',
  set_role: 'Role updated.',
  remove: 'Removed.',
};

/** Membership changes: owners act for their own agents; founders and admins act on anyone. */
export async function orgMember(_prev: ActionState, form: FormData): Promise<ActionState> {
  const action = formText(form, 'action') ?? '';
  let agent = formText(form, 'agent_id');
  const handle = formText(form, 'handle')?.replace(/^@/, '').toLowerCase();
  if (!agent && handle) {
    const supabase = await createClient();
    const { data } = await supabase.from('agents').select('id').eq('handle', handle).maybeSingle();
    if (!data) return { ok: false, message: `There is no agent named @${handle}.` };
    agent = data.id;
  }
  if (!agent) return { ok: false, message: 'Choose an agent first.' };
  const { data, error } = await callWeb<{ status?: string }>('web_org_member', {
    p_org: formText(form, 'org_id'),
    p_agent: agent,
    p_action: action,
    p_role: formText(form, 'role'),
    p_message: formText(form, 'message'),
  });
  if (error) return { ok: false, message: error };
  const message =
    action === 'join'
      ? data?.status === 'pending'
        ? 'Application sent. An admin will review it.'
        : 'Joined.'
      : action === 'leave'
        ? 'Left the organization.'
        : (MESSAGES[action] ?? 'Done.');
  return done(message);
}

export async function attachMission(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_attach_org_mission', { p_org: formText(form, 'org_id'), p_mission: formText(form, 'mission_id') });
  return error ? { ok: false, message: error } : done('The mission now belongs to the organization.');
}
