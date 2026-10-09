'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addTask, cancelMission, cancelTask, decideApproval, postMessage, reviewSubmission } from '@/app/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { cx } from '@/components/ui';

function useResetOnSuccess(ok: boolean | undefined) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (ok) ref.current?.reset();
  }, [ok]);
  return ref;
}

const VERDICT_OPTIONS = [
  { value: 'approve', label: 'Approve', hint: 'Meets the acceptance criteria', tone: 'peer-checked:bg-done/[0.08] peer-checked:text-done peer-checked:ring-done/50' },
  { value: 'request_changes', label: 'Request changes', hint: 'Fixable gaps', tone: 'peer-checked:bg-claimed/[0.08] peer-checked:text-claimed peer-checked:ring-claimed/50' },
  { value: 'reject', label: 'Reject', hint: 'Wrong or unusable', tone: 'peer-checked:bg-danger/[0.08] peer-checked:text-danger peer-checked:ring-danger/50' },
];

export function ReviewForm({ submissionId, isOwner }: { submissionId: string; isOwner: boolean }) {
  const [state, action] = useActionState(reviewSubmission, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="submission_id" value={submissionId} />
      <fieldset>
        <legend className="label mb-2.5">
          Your verdict{isOwner ? <span className="text-faint"> · as owner, your review decides</span> : ''}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {VERDICT_OPTIONS.map((o) => (
            <label key={o.value} className="cursor-pointer">
              <input type="radio" name="verdict" value={o.value} className="peer sr-only" required />
              <span
                className={cx(
                  'block rounded-xl px-3 py-2.5 text-sm text-muted ring-1 ring-inset ring-white/[0.09] transition-all hover:bg-white/[0.03] hover:text-text peer-focus-visible:ring-accent/60',
                  o.tone,
                )}
              >
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-faint">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
        <label className="block">
          <span className="label">Score</span>
          <select name="score" defaultValue="" className="field mt-2">
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} / 5
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Rationale</span>
          <textarea
            name="rationale"
            required
            minLength={10}
            rows={3}
            className="field mt-2"
            placeholder="What did you check, and what should change?"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Recording…">
          Submit review
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ApprovalForm({ approvalId }: { approvalId: string }) {
  const [state, action] = useActionState(decideApproval, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="approval_id" value={approvalId} />
      <textarea name="note" rows={2} className="field" placeholder="Optional note for the swarm" />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="decision" value="approve" size="sm" pendingLabel="Saving…">
          Approve
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="danger" size="sm" pendingLabel="Saving…">
          Reject
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function MessageForm({ missionId }: { missionId: string }) {
  const [state, action] = useActionState(postMessage, null);
  const ref = useResetOnSuccess(state?.ok);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="mission_id" value={missionId} />
      <textarea name="body" required rows={3} maxLength={10000} className="field" placeholder="Share context, answer a question, or steer the swarm" />
      <div className="flex flex-wrap items-center gap-2">
        <select name="kind" defaultValue="message" className="field w-auto" aria-label="Message kind">
          <option value="message">Message</option>
          <option value="question">Question</option>
          <option value="proposal">Proposal</option>
          <option value="status">Status</option>
        </select>
        <SubmitButton size="sm" pendingLabel="Posting…">
          Post
        </SubmitButton>
        {!state?.ok && <FormMessage state={state} />}
      </div>
    </form>
  );
}

const KINDS = ['research', 'code', 'analysis', 'writing', 'design', 'data', 'experiment', 'review', 'synthesis', 'ops', 'other'];

export function AddTaskForm({ missionId, existing }: { missionId: string; existing: { key: string; title: string }[] }) {
  const [state, action] = useActionState(addTask, null);
  const ref = useResetOnSuccess(state?.ok);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="mission_id" value={missionId} />
      <input name="title" required minLength={3} maxLength={200} className="field" placeholder="Task title" />
      <textarea name="description" rows={3} className="field" placeholder="What to do and what the output must contain" />
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="kind" defaultValue="research" className="field" aria-label="Kind">
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select name="complexity" defaultValue="medium" className="field" aria-label="Complexity">
          <option value="low">low complexity</option>
          <option value="medium">medium complexity</option>
          <option value="high">high complexity</option>
        </select>
      </div>
      <input name="capabilities" className="field" placeholder="Capabilities, comma separated" />
      <input name="acceptance_criteria" className="field" placeholder="Acceptance criteria" />
      {existing.length > 0 && (
        <fieldset>
          <legend className="label mb-2">Depends on</legend>
          <div className="flex flex-wrap gap-2">
            {existing.map((t) => (
              <label
                key={t.key}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.03] px-2.5 py-1 text-xs text-muted ring-1 ring-inset ring-white/[0.08] has-[:checked]:bg-accent/10 has-[:checked]:text-accent has-[:checked]:ring-accent/30"
              >
                <input type="checkbox" name="depends_on" value={t.key} className="accent-[#ffb257]" />
                <span className="font-mono">{t.key}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">
          Add task
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function CancelMissionForm({ missionId }: { missionId: string }) {
  const [state, action] = useActionState(cancelMission, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="mission_id" value={missionId} />
      <input name="reason" className="field" placeholder="Reason (optional)" />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="confirm" className="accent-[#ff6b6b]" /> Cancel every open task in this mission
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="danger" pendingLabel="Cancelling…">
          Cancel mission
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function CancelTaskForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(cancelTask, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="task_id" value={taskId} />
      <input name="reason" className="field min-w-0 flex-1" placeholder="Reason (optional)" />
      <SubmitButton size="sm" variant="danger" pendingLabel="Cancelling…">
        Cancel task
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
