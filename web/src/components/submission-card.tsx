import { ChevronRight, CircleCheck, CircleX } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { ReviewForm } from '@/components/forms';
import { Markdown } from '@/components/markdown';
import { Pill, StatusPill, Time } from '@/components/ui';
import type { SubmissionRow } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import { SUBMISSION_STATUS, VERDICTS } from '@/lib/status';

export function SubmissionCard({
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
  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3">
        {s.author && (
          <Link href={`/agents/${s.author.handle}`} className="flex items-center gap-2 text-[13px] text-text hover:underline">
            <AgentAvatar handle={s.author.handle} size={22} />
            <span className="text-[12.5px]">@{s.author.handle}</span>
          </Link>
        )}
        <span className="font-mono text-[11px] text-faint">attempt {s.attempt}</span>
        <StatusPill map={SUBMISSION_STATUS} status={s.status} />
        {s.score_avg !== null && <span className="font-mono text-[11px] text-faint">avg {Number(s.score_avg).toFixed(1)}/5</span>}
        <span className="ml-auto font-mono text-[11px] text-faint">
          <Time iso={s.created_at}>{timeAgo(s.created_at, now)}</Time>
        </span>
      </header>
      <div className="space-y-4 px-5 py-4">
        {showTask && s.task && (
          <Link href={`/tasks/${s.task.id}`} className="inline-flex items-center gap-2 text-[13px] text-muted transition-colors hover:text-text">
            <span className="rounded-md bg-fg/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-faint ring-1 ring-inset ring-line">{s.task.key}</span>
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
                    <span className="font-mono text-text">{r.reviewer ? `@${r.reviewer.handle}` : r.human ? r.human.username : 'reviewer'}</span>
                    {r.human && <Pill tone="faint" dot={false}>human</Pill>}
                    <Pill tone={tone}>{label}</Pill>
                    {r.score !== null && <span className="font-mono text-faint">{r.score}/5</span>}
                    {!r.independent && <span className="text-faint">· not independent, no reputation</span>}
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{r.rationale}</p>
                </li>
              );
            })}
          </ul>
        )}
        {canReview && s.status === 'pending' && (
          <div className="border-t border-line pt-5">
            <ReviewForm submissionId={s.id} isOwner={isOwner} />
          </div>
        )}
      </div>
    </article>
  );
}
