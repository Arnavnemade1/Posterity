'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { callWeb as call, done, formList as list, formText as text } from '@/lib/web-rpc';

function parseJson(raw: string | null, what: string): { value?: unknown; error?: string } {
  if (!raw) return { error: `Add ${what} first.` };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: `The ${what} is not valid JSON.` };
  }
}

// ------------------------------------------------------------------- missions

export async function launchMission(_prev: ActionState, form: FormData): Promise<ActionState> {
  const manual = form.get('planning') === 'manual';
  let plan: unknown = null;
  if (manual) {
    const parsed = parseJson(text(form, 'plan'), 'plan');
    if (parsed.error) return { ok: false, message: parsed.error };
    plan = parsed.value;
  }
  const budget = text(form, 'budget_tokens');
  const org = text(form, 'org_id');
  const { data, error } = await call<{ slug: string }>(org ? 'web_create_org_mission' : 'web_create_mission', {
    ...(org ? { p_org: org } : {}),
    p_title: text(form, 'title'),
    p_objective: text(form, 'objective'),
    p_description: text(form, 'description') ?? '',
    p_tags: list(form, 'tags'),
    p_visibility: form.get('visibility') === 'unlisted' ? 'unlisted' : 'public',
    p_review_quorum: Number(form.get('review_quorum') ?? 1),
    p_requires_plan_approval: form.get('requires_plan_approval') === 'on',
    p_requires_final_approval: form.get('requires_final_approval') === 'on',
    p_budget_tokens: budget ? Number(budget) : null,
    p_repo_url: text(form, 'repo_url'),
    p_plan: plan,
  });
  if (error || !data) return { ok: false, message: error ?? 'Could not launch the mission.' };
  redirect(`/missions/${data.slug}`);
}

export async function adoptPlan(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseJson(text(form, 'plan'), 'plan');
  if (parsed.error) return { ok: false, message: parsed.error };
  const { error } = await call('web_adopt_plan', { p_mission: text(form, 'mission_id'), p_plan: parsed.value });
  return error ? { ok: false, message: error } : done('Plan adopted. The swarm is being recruited.');
}

export async function addTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const title = text(form, 'title') ?? '';
  const key =
    text(form, 'key') ??
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  const { error } = await call('web_add_task', {
    p_mission: text(form, 'mission_id'),
    p_task: {
      key,
      title,
      description: text(form, 'description') ?? '',
      kind: text(form, 'kind') ?? 'other',
      capabilities: list(form, 'capabilities'),
      depends_on: form.getAll('depends_on').map(String),
      acceptance_criteria: text(form, 'acceptance_criteria') ?? '',
      complexity: text(form, 'complexity') ?? 'medium',
    },
  });
  return error ? { ok: false, message: error } : done('Task added.');
}

export type GitHubState = (NonNullable<ActionState> & { repo?: string; secret?: string }) | null;

/** Connects the mission's repository. The webhook secret comes back once, for the owner to paste into GitHub. */
export async function connectGitHub(_prev: GitHubState, form: FormData): Promise<GitHubState> {
  const repo = text(form, 'repo');
  if (!repo) return { ok: false, message: 'Enter the repository, like owner/name.' };
  const { data, error } = await call<{ repo: string; secret: string }>('web_connect_github', { p_mission: text(form, 'mission_id'), p_repo: repo });
  if (error || !data) return { ok: false, message: error ?? 'Could not connect the repository.' };
  return { ...done(`Connected ${data.repo}.`)!, repo: data.repo, secret: data.secret };
}

export async function disconnectGitHub(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await call('web_disconnect_github', { p_mission: text(form, 'mission_id') });
  return error ? { ok: false, message: error } : done('Disconnected. Its history stays on the mission.');
}

export async function cancelMission(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (form.get('confirm') !== 'on') return { ok: false, message: 'Tick the box to confirm.' };
  const { error } = await call('web_cancel_mission', { p_mission: text(form, 'mission_id'), p_reason: text(form, 'reason') });
  return error ? { ok: false, message: error } : done('Mission cancelled.');
}

export async function cancelTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await call('web_cancel_task', { p_task: text(form, 'task_id'), p_reason: text(form, 'reason') });
  return error ? { ok: false, message: error } : done('Task cancelled.');
}

export async function postMessage(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await call('web_post_message', {
    p_mission: text(form, 'mission_id'),
    p_body: text(form, 'body'),
    p_kind: text(form, 'kind') ?? 'message',
    p_task: text(form, 'task_id'),
  });
  return error ? { ok: false, message: error } : done('Posted.');
}

// --------------------------------------------------------------- verification

export async function reviewSubmission(_prev: ActionState, form: FormData): Promise<ActionState> {
  const verdict = text(form, 'verdict');
  if (!verdict) return { ok: false, message: 'Choose a verdict.' };
  const score = text(form, 'score');
  const { data, error } = await call<{ submission_status: string }>('web_review_submission', {
    p_submission: text(form, 'submission_id'),
    p_verdict: verdict,
    p_score: score ? Number(score) : null,
    p_rationale: text(form, 'rationale'),
  });
  if (error) return { ok: false, message: error };
  const outcome: Record<string, string> = {
    accepted: 'Review recorded. The work is verified.',
    rejected: 'Review recorded. The task is open again.',
    revision_requested: 'Review recorded. The agent will revise.',
    awaiting_approval: 'Review recorded. It now awaits the owner’s approval.',
  };
  return done(outcome[data?.submission_status ?? ''] ?? 'Review recorded.');
}

export async function decideApproval(_prev: ActionState, form: FormData): Promise<ActionState> {
  const approve = form.get('decision') === 'approve';
  const { error } = await call('web_decide_approval', {
    p_approval: text(form, 'approval_id'),
    p_approve: approve,
    p_note: text(form, 'note'),
  });
  return error ? { ok: false, message: error } : done(approve ? 'Approved.' : 'Rejected.');
}
