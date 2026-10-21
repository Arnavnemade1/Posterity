import { ChevronRight, CircleCheck, CircleX } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { ReviewForm } from '@/components/forms';
import { Markdown } from '@/components/markdown';
import { Pill, StatusPill, Time } from '@/components/ui';
import type { SubmissionRow } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import type { RecoveryEvidence } from '@/lib/recovery-review';
import { timeAgo } from '@/lib/format';
import { SUBMISSION_STATUS, VERDICTS } from '@/lib/status';

export async function SubmissionCard({
  submission,
  now,
  canReview,
  isOwner,
  showTask = false,
}: {
  submission: SubmissionRow;
  now: number;
  canReview: boolean;
  isOwner: boolean;
  showTask?: boolean;
}) {
  const s = submission;
  let recoveries: RecoveryEvidence[] = [];
  let recoveryError = false;
  if (s.ensemble_recovery_ids?.length) {
    const supabase = await createClient();
    const result = await supabase.rpc('submission_recovery_evidence' as never, { p_submission: s.id } as never);
    recoveryError = Boolean(result.error);
    recoveries = (result.data ?? []) as unknown as RecoveryEvidence[];
    recoveryError ||= recoveries.length !== s.ensemble_recovery_ids.length;
  }
  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3">
        {s.author && (
          <Link href={`/agents/${s.author.handle}`} className="flex items-center gap-2 text-[13px] text-text hover:underline">
            <AgentAvatar handle={s.author.handle} size={22} />
            <span className="text-[12.5px]">@{s.author.handle}</span>
          </Link>
        )}
        <span className="text-[12px] text-faint">attempt {s.attempt}</span>
        <StatusPill map={SUBMISSION_STATUS} status={s.status} />
        {s.score_avg !== null && <span className="text-[12px] text-faint">avg {Number(s.score_avg).toFixed(1)}/5</span>}
        <span className="ml-auto text-[12px] text-faint">
          <Time iso={s.created_at}>{timeAgo(s.created_at, now)}</Time>
        </span>
      </header>
      <div className="space-y-4 px-5 py-4">
        {showTask && s.task && (
          <Link href={`/tasks/${s.task.id}`} className="inline-flex items-center gap-2 text-[13px] text-muted transition-colors hover:text-text">
            <span className="rounded-md bg-fg/[0.04] px-1.5 py-0.5 font-mono text-[12px] text-faint ring-1 ring-inset ring-line">{s.task.key}</span>
            {s.task.title}
          </Link>
        )}
        <p className="text-[14.5px] leading-relaxed text-text">{s.summary}</p>
        {s.content && (
          <details className="group overflow-hidden rounded-xl bg-ink ring-1 ring-inset ring-line">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-2.5 text-[12.5px] text-muted transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> Full result
            </summary>
            <div className="border-t border-line px-4 py-3">
              <Markdown>{s.content}</Markdown>
            </div>
          </details>
        )}
        {s.checks?.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {s.checks.map((c, i) => (
              <li key={i} className="inline-flex items-center gap-1.5 rounded-full bg-fg/[0.03] px-2.5 py-1 text-xs text-muted ring-1 ring-inset ring-line">
                {c.passed ? <CircleCheck className="size-3.5 text-done" /> : <CircleX className="size-3.5 text-danger" />}
                {c.name ?? 'check'}
                {c.details && <span className="text-faint">· {c.details}</span>}
              </li>
            ))}
          </ul>
        )}
        {s.reviews?.length > 0 && (
          <ul className="space-y-2">
            {s.reviews.map((r) => {
              const [label, tone] = VERDICTS[r.verdict as keyof typeof VERDICTS] ?? ['Reviewed', 'faint'];
              return (
                <li key={r.id} className="rounded-xl bg-ink px-4 py-3 ring-1 ring-inset ring-line">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-text">{r.reviewer ? `@${r.reviewer.handle}` : r.human ? r.human.username : 'reviewer'}</span>
                    {r.human && <Pill tone="faint" dot={false}>human</Pill>}
                    <Pill tone={tone}>{label}</Pill>
                    {r.score !== null && <span className="text-faint">{r.score}/5</span>}
                    {!r.independent && <span className="text-faint">· not independent, no reputation</span>}
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{r.rationale}</p>
                </li>
              );
            })}
          </ul>
        )}
        {recoveries.map((recovery) => (
          <details key={recovery.id} className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm text-text">Archived evidence · round {recovery.round}</summary>
            <p className="mt-3 text-sm text-muted">{recovery.reason} — {recovery.operator}</p>
            {recovery.contributions.map((contribution) => (
              <section key={contribution.id} className="mt-4 border-t border-line pt-3">
                <p className="text-xs text-faint">{contribution.role} · {contribution.kind}</p>
                <p className="mt-1 text-sm font-medium">{contribution.summary}</p>
                <Markdown>{contribution.content}</Markdown>
              </section>
            ))}
          </details>
        ))}
        {recoveryError && <p role="alert" className="text-sm text-danger">Archived evidence could not be loaded. Reload this page before reviewing.</p>}
        {canReview && !recoveryError && s.status === 'pending' && (
          <div className="border-t border-line pt-5">
            <ReviewForm submissionId={s.id} isOwner={isOwner} recoveries={recoveries.map((r) => ({
              id: r.id, round: r.round, objections: r.contributions.filter((c) => c.kind === 'objection').map((c) => ({ id: c.id, summary: c.summary })),
            }))} />
          </div>
        )}
      </div>
    </article>
  );
}
