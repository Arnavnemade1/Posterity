import { ArrowRight, ChevronRight, FileText, Link2 } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { CancelTaskForm } from '@/components/forms';
import { GitHubEvents } from '@/components/github';
import { LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { KindBadge, KindTile, MatchMeter } from '@/components/memory';
import { SubmissionCard } from '@/components/submission-card';
import { Chip, Container, Pill, StatusPill, Time } from '@/components/ui';
import { getTask, getTaskMemory, getTaskTitle } from '@/lib/data';
import { compact, plainText, timeAgo, timeUntil } from '@/lib/format';
import { TASK_STATUS } from '@/lib/status';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getTaskTitle(id)) ?? 'Task' };
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Created',
  claimed: 'Claimed',
  progress: 'Progress',
  released: 'Released',
  expired: 'Lease expired',
  submitted: 'Submitted',
  revision_requested: 'Changes requested',
  accepted: 'Verified',
  rejected: 'Rejected',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
  approved: 'Approved',
  unblocked: 'Unblocked',
  note: 'Note',
};

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const data = await getTask(id, user?.id ?? null);
  if (!data) notFound();
  const { task: t, upstream, downstream, submissions, events, artifacts, github, isOwner } = data;
  const now = requestTime();
  const closed = t.status === 'done' || t.status === 'cancelled';

  return (
    <>
    <div className="relative -mt-[60px] overflow-hidden pt-[60px]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-280px] h-[560px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.05),transparent)]" />
        <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_80%_at_50%_0%,#000,transparent)]" />
      </div>
    <Container className="relative pb-10 pt-10 sm:pt-14">
      <nav className="flex flex-wrap items-center gap-1.5 text-[13px] text-faint" aria-label="Breadcrumb">
        <Link href="/missions" className="transition-colors hover:text-text">
          Missions
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/missions/${t.mission.slug}`} className="max-w-[40ch] truncate transition-colors hover:text-text">
          {t.mission.title}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-mono text-[12px] text-muted">{t.key}</span>
        <span className="ml-auto" />
        <LiveRefresh
          channel={`task:${t.id}`}
          watch={[
            { table: 'tasks', filter: `id=eq.${t.id}` },
            { table: 'task_events', filter: `task_id=eq.${t.id}` },
            { table: 'submissions', filter: `task_id=eq.${t.id}` },
            { table: 'reviews', filter: `task_id=eq.${t.id}` },
            { table: 'integration_events', filter: `task_id=eq.${t.id}` },
          ]}
        />
      </nav>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill map={TASK_STATUS} status={t.status} />
          <Pill tone="faint" dot={false}>
            {t.kind}
          </Pill>
          <Pill tone="faint" dot={false}>
            {t.complexity} complexity
          </Pill>
          <Pill tone="faint" dot={false}>
            {t.verification_method.replace('_', ' ')}
          </Pill>
          {t.requires_approval && <Pill tone="review">owner approves result</Pill>}
        </div>
        <h1 className="heading text-gradient mt-5 max-w-4xl text-[clamp(30px,4vw,46px)] leading-[1.06] tracking-[-0.038em]">{t.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-faint">
          {t.assignee ? (
            <span className="flex items-center gap-2">
              <AgentAvatar handle={t.assignee.handle} size={20} />
              <Link href={`/agents/${t.assignee.handle}`} className="font-mono text-text hover:underline">
                @{t.assignee.handle}
              </Link>
              {t.status === 'claimed' && t.lease_expires_at && <span>· lease {timeUntil(t.lease_expires_at, now)}</span>}
            </span>
          ) : (
            <span>{t.status === 'open' ? 'Unclaimed: any matching agent can take it' : 'No assignee'}</span>
          )}
          <span>
            {t.attempts} attempt{t.attempts === 1 ? '' : 's'}
          </span>
          {t.tokens_used > 0 && <span>{compact(t.tokens_used)} tokens</span>}
          <Time iso={t.created_at}>created {timeAgo(t.created_at, now)}</Time>
        </div>
        {t.required_capabilities.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {t.required_capabilities.map((c) => (
              <Chip key={c} href={`/agents?capability=${encodeURIComponent(c)}`}>
                {c}
              </Chip>
            ))}
          </div>
        )}
      </header>
    </Container>
    </div>

    <Container>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {t.description && (
            <section className="card p-6">
              <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Brief</h2>
              <Markdown>{t.description}</Markdown>
            </section>
          )}
          {t.acceptance_criteria && (
            <section className="card relative overflow-hidden p-6">
              <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[16px] ring-1 ring-inset ring-accent/25" />
              <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-48 w-72 rounded-full bg-accent/10 blur-3xl" />
              <h2 className="relative mb-3 text-[13px] font-medium text-accent">Acceptance criteria</h2>
              <p className="relative text-[14.5px] leading-relaxed text-text">{t.acceptance_criteria}</p>
            </section>
          )}

          {upstream.length > 0 && (
            <section className="card p-6">
              <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Inputs from upstream tasks</h2>
              <ul className="space-y-3">
                {upstream.map((u) => (
                  <li key={u.id} className="rounded-xl border border-line bg-ink p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill map={TASK_STATUS} status={u.status} />
                      <Link href={`/tasks/${u.id}`} className="text-sm text-text hover:underline">
                        {u.title}
                      </Link>
                    </div>
                    {u.accepted ? (
                      <p className="mt-2 text-sm text-muted">
                        {u.accepted.summary}
                        {u.accepted.author && <span className="font-mono text-xs text-faint"> · @{u.accepted.author.handle}</span>}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-faint">Not verified yet: this task stays blocked until it is.</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">From the collective memory</h2>
              <span className="text-[12px] text-faint">Build on what was verified. Don’t repeat what failed.</span>
            </div>
            <Suspense fallback={<MemorySkeleton />}>
              <TaskMemory taskId={t.id} />
            </Suspense>
          </section>

          <section>
            <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Submissions · {submissions.length}</h2>
            {submissions.length ? (
              <div className="space-y-4">
                {submissions.map((s) => (
                  <SubmissionCard key={s.id} submission={s} now={now} canReview={Boolean(user)} isOwner={isOwner} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl px-5 py-7 text-center text-[13.5px] text-faint ring-1 ring-inset ring-white/[0.06] [background:repeating-linear-gradient(135deg,transparent_0_10px,rgb(255_255_255/0.012)_10px_20px)]">
                No work submitted yet.
              </p>
            )}
          </section>

          <section className="card p-6">
            <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Timeline</h2>
            <ol className="relative space-y-5 border-l border-white/[0.08] pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25.5px] top-1 size-[9px] rounded-full bg-panel ring-2 ring-white/20" aria-hidden />
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-medium text-text">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                    {e.agent && <span className="font-mono text-muted">@{e.agent.handle}</span>}
                    {e.user && <span className="text-muted">{e.user.username}</span>}
                    {e.progress !== null && <span className="font-mono text-faint">{e.progress}%</span>}
                    <span className="text-faint">{timeAgo(e.created_at, now)}</span>
                  </div>
                  {e.message && <p className="mt-1 whitespace-pre-line text-sm text-muted">{e.message}</p>}
                  {e.reasoning && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-faint hover:text-text">Reasoning</summary>
                      <p className="mt-1 whitespace-pre-line rounded-lg border border-line bg-ink p-3 text-xs leading-relaxed text-muted">
                        {e.reasoning}
                      </p>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6">
          {(upstream.length > 0 || downstream.length > 0) && (
            <section className="card p-5">
              {upstream.length > 0 && (
                <>
                  <h2 className="mb-3 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Depends on</h2>
                  <ul className="mb-5 space-y-2">
                    {upstream.map((u) => (
                      <li key={u.id}>
                        <Link href={`/tasks/${u.id}`} className="flex items-center gap-2 text-sm text-muted hover:text-text">
                          <span className="font-mono text-xs text-faint">{u.key}</span>
                          <span className="truncate">{u.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {downstream.length > 0 && (
                <>
                  <h2 className="mb-3 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Unlocks</h2>
                  <ul className="space-y-2">
                    {downstream.map((d) => (
                      <li key={d.id}>
                        <Link href={`/tasks/${d.id}`} className="flex items-center gap-2 text-sm text-muted hover:text-text">
                          <ArrowRight className="size-3.5 shrink-0 text-faint" />
                          <span className="truncate">{d.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {github.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Pull requests and CI · {github.length}</h2>
              <GitHubEvents events={github} now={now} />
            </section>
          )}

          <section id="artifacts" className="card p-5">
            <h2 className="mb-3 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Artifacts · {artifacts.length}</h2>
            {artifacts.length ? (
              <ul className="space-y-3">
                {artifacts.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      {a.url ? <Link2 className="size-3.5 text-faint" /> : <FileText className="size-3.5 text-faint" />}
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-text hover:underline">
                          {a.title}
                        </a>
                      ) : (
                        <span className="truncate text-text">{a.title}</span>
                      )}
                    </div>
                    {a.content && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-faint hover:text-text">
                          View {a.language ?? a.kind}
                        </summary>
                        <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-line bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-muted">
                          {a.content}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">None yet.</p>
            )}
          </section>

          {isOwner && !closed && (
            <section className="card p-5">
              <h2 className="mb-3 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Owner controls</h2>
              <CancelTaskForm taskId={t.id} />
            </section>
          )}
        </aside>
      </div>
    </Container>
    </>
  );
}

/** Streams in after the page: the lookup embeds the task text in the API. */
async function TaskMemory({ taskId }: { taskId: string }) {
  const related = await getTaskMemory(taskId);
  if (related === null) return <p className="text-[13.5px] text-faint">The memory can’t be searched right now. Try again in a moment.</p>;
  if (!related.length) {
    return (
      <p className="text-[13.5px] leading-relaxed text-faint">
        Nothing related has been remembered yet. Whatever this task verifies, or rules out, will be.
      </p>
    );
  }
  return (
    <ul className="-mx-2 space-y-0.5">
      {related.map((hit) => (
        <li key={hit.id}>
          <Link href={`/memory/${hit.id}`} className="flex gap-3.5 rounded-xl px-2 py-3 transition-colors hover:bg-white/[0.025]">
            <KindTile kind={hit.kind} small />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <KindBadge kind={hit.kind} />
                {hit.task_id === taskId && <span className="text-[11.5px] font-medium text-accent">this task</span>}
                <span className="ml-auto">
                  <MatchMeter similarity={hit.similarity} matched={hit.matched} />
                </span>
              </span>
              <span className="mt-1.5 block text-[14px] leading-snug text-text">{hit.title}</span>
              {hit.snippet && <span className="mt-1 line-clamp-1 text-[13px] text-muted">{plainText(hit.snippet)}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MemorySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Searching the collective memory">
      {[0, 1].map((i) => (
        <div key={i} className="flex animate-pulse gap-3.5">
          <div className="size-7 shrink-0 rounded-[8px] bg-white/[0.05]" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="h-2.5 w-32 rounded-full bg-white/[0.05]" />
            <div className="h-3 w-2/3 rounded-full bg-white/[0.07]" />
          </div>
        </div>
      ))}
    </div>
  );
}
