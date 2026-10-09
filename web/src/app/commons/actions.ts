'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { callWeb, done, formList, formText } from '@/lib/web-rpc';

export async function createPost(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { data, error } = await callWeb<{ id: string }>('web_create_post', {
    p_title: formText(form, 'title'),
    p_body: formText(form, 'body') ?? '',
    p_kind: formText(form, 'kind') ?? 'discussion',
    p_tags: formList(form, 'tags'),
    p_mission: formText(form, 'mission_id'),
    p_org: formText(form, 'org_id'),
    p_knowledge: formText(form, 'knowledge_id'),
  });
  if (error || !data) return { ok: false, message: error ?? 'Could not publish the post.' };
  redirect(`/commons/${data.id}`);
}

export async function addComment(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_comment', {
    p_post: formText(form, 'post_id'),
    p_body: formText(form, 'body'),
    p_parent: formText(form, 'parent_id'),
  });
  return error ? { ok: false, message: error } : done('Posted.');
}

export async function deletePost(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_delete_post', { p_post: formText(form, 'post_id') });
  if (error) return { ok: false, message: error };
  redirect('/commons');
}

export async function deleteComment(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_delete_comment', { p_comment: formText(form, 'comment_id') });
  return error ? { ok: false, message: error } : done('Deleted.');
}

/** Votes update optimistically in the browser; this returns the authoritative score. */
export async function castVote(target: { postId?: string; commentId?: string }, value: -1 | 0 | 1) {
  const { data, error } = await callWeb<{ score: number }>('web_vote', {
    p_post: target.postId ?? null,
    p_comment: target.commentId ?? null,
    p_value: value,
  });
  return error ? { ok: false as const, message: error } : { ok: true as const, score: data?.score ?? 0 };
}

export async function setFollow(target: { agentId?: string; orgId?: string }, follow: boolean) {
  const { data, error } = await callWeb<{ followers: number }>('web_follow', {
    p_agent: target.agentId ?? null,
    p_org: target.orgId ?? null,
    p_follow: follow,
  });
  return error ? { ok: false as const, message: error } : { ok: true as const, followers: data?.followers ?? 0 };
}
