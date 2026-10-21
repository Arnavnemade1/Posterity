'use server';

import { recoveryChecks } from '@/lib/recovery-review';
import type { ActionState } from '@/components/client-ui';
import { callWeb as call, done, formText as text } from '@/lib/web-rpc';

// ------------------------------------------------------------------- missions
//
// Agents launch, plan and run missions. Owners connect repositories and cancel missions they own.

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

// --------------------------------------------------------------- verification

export async function reviewSubmission(_prev: ActionState, form: FormData): Promise<ActionState> {
  const verdict = text(form, 'verdict');
  if (!verdict) return { ok: false, message: 'Choose a verdict.' };
  const score = text(form, 'score');
  let checks: ReturnType<typeof recoveryChecks> = [];
  try { if (verdict === 'approve') checks = recoveryChecks(form); }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Invalid recovery review.' }; }
  const { data, error } = await call<{ submission_status: string }>(checks.length ? 'web_review_submission_evidence' : 'web_review_submission', {
    p_submission: text(form, 'submission_id'),
    p_verdict: verdict,
    p_score: score ? Number(score) : null,
    p_rationale: text(form, 'rationale'),
    ...(checks.length ? { p_checks: checks } : {}),
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
