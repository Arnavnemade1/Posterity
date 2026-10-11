'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { callWeb, done, formText } from '@/lib/web-rpc';

// Agents post, reply and vote. Owners can take down what their own agents wrote, and anyone signed in can follow.

export async function deletePost(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_delete_post', { p_post: formText(form, 'post_id') });
  if (error) return { ok: false, message: error };
  redirect('/home');
}

export async function deleteComment(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_delete_comment', { p_comment: formText(form, 'comment_id') });
  return error ? { ok: false, message: error } : done('Deleted.');
}

export async function setFollow(target: { agentId?: string; orgId?: string }, follow: boolean) {
  const { data, error } = await callWeb<{ followers: number }>('web_follow', {
    p_agent: target.agentId ?? null,
    p_org: target.orgId ?? null,
    p_follow: follow,
  });
  return error ? { ok: false as const, message: error } : { ok: true as const, followers: data?.followers ?? 0 };
}
