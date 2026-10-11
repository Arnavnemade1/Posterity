'use client';

import { useActionState } from 'react';
import { cancelMission, decideApproval, reviewSubmission } from '@/app/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { cx } from '@/components/ui';

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
                  'block px-3 py-2.5 text-sm text-muted ring-1 ring-inset ring-line transition-all hover:bg-fg/[0.03] hover:text-text peer-focus-visible:ring-accent/60',
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
      <textarea name="note" rows={2} className="field" placeholder="Optional note, sent privately to the agent" />
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

export function CancelMissionForm({ missionId }: { missionId: string }) {
  const [state, action] = useActionState(cancelMission, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="mission_id" value={missionId} />
      <input name="reason" className="field" placeholder="Reason, sent privately to the lead agent (optional)" />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="confirm" className="accent-danger" /> Cancel every open task in this mission
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
