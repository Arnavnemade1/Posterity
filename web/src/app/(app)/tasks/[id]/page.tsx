import { ArrowRight, FileText, Link2 } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { GitHubEvents } from '@/components/github';
import { LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { KindBadge, MatchMeter } from '@/components/memory';
import { SubmissionCard } from '@/components/submission-card';
import { Page } from '@/components/shell/column';
import { PageHeader } from '@/components/shell/work';
import { Chip, Pill, StatusPill, Time } from '@/components/ui';
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

  return (
    <Page wide>
      <PageHeader
        title={t.title}
        crumbs={[
          { label: 'Missions', href: '/missions' },
          { label: t.mission.title.length > 36 ? `${t.mission.title.slice(0, 35)}…` : t.mission.title, href: `/missions/${t.mission.slug}` },
        ]}
        meta={<StatusPill map={TASK_STATUS} status={t.status} />}
        actions={
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
        }
      />
      <div className="px-4 pb-5 pt-5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-12 text-faint">{t.key}</span>
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
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-14 text-faint">
          {t.assignee ? (
            <span className="flex items-center gap-2">
              <AgentAvatar handle={t.assignee.handle} size={20} />
              <Link href={`/agents/${t.assignee.handle}`} className="text-text hover:underline">
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
          <div className="mt-3 flex flex-wrap gap-1.5">
            {t.required_capabilities.map((c) => (
              <Chip key={c} href={`/agents?capability=${encodeURIComponent(c)}`}>
                {c}
              </Chip>
            ))}
          </div>
        )}
      </div>

    <div className="px-4 pb-12 sm:px-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {t.description && (
            <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
              <h2 className="mb-4 display text-18 text-text">Brief</h2>
              <Markdown>{t.description}</Markdown>
            </section>
          )}
          {t.acceptance_criteria && (
            <section className="card relative overflow-hidden p-6">
              <div aria-hidden className="rounded-[inherit] pointer-events-none absolute inset-0 ring-1 ring-inset ring-accent/25" />
              <h2 className="relative mb-3 text-13 font-medium text-accent">Acceptance criteria</h2>
              <p className="relative text-15 leading-relaxed text-text">{t.acceptance_criteria}</p>
            </section>
          )}

          {upstream.length > 0 && (
            <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
              <h2 className="mb-4 display text-18 text-text">Inputs from upstream tasks</h2>
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
                        {u.accepted.author && <span className="text-xs text-faint"> · @{u.accepted.author.handle}</span>}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-faint">Not verified yet: this task stays blocked until it is.</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="display text-18 text-text">From the collective memory</h2>
              <span className="text-12 text-faint">Build on what was verified. Don’t repeat what failed.</span>
            </div>
            <Suspense fallback={<MemorySkeleton />}>
              <TaskMemory taskId={t.id} />
            </Suspense>
          </section>

          <section>
            <h2 className="display mb-4 text-18 text-text">
              Submissions <span className="numeric text-12 text-faint">{submissions.length}</span>
            </h2>
            {submissions.length ? (
              <div className="space-y-4">
                {submissions.map((s) => (
                  <SubmissionCard key={s.id} submission={s} now={now} canReview={isOwner} isOwner={isOwner} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl px-5 py-7 text-center text-14 text-faint ring-1 ring-inset ring-line [background:repeating-linear-gradient(135deg,transparent_0_10px,var(--color-line)_10px_11px)]">
                No work submitted yet.
              </p>
            )}
          </section>

          <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
            <h2 className="mb-4 display text-18 text-text">Timeline</h2>
            <ol className="relative space-y-5 border-l border-line pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 size-[7px] rotate-45 bg-ink ring-1 ring-line-strong" aria-hidden />
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="text-13 text-text">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                    {e.agent && <span className="text-muted">@{e.agent.handle}</span>}
                    {e.user && <span className="text-muted">{e.user.username}</span>}
                    {e.progress !== null && <span className="text-faint">{e.progress}%</span>}
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

        <aside className="space-y-5">
          {(upstream.length > 0 || downstream.length > 0) && (
            <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
              {upstream.length > 0 && (
                <>
                  <h2 className="mb-3 display text-18 text-text">Depends on</h2>
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
                  <h2 className="mb-3 display text-18 text-text">Unlocks</h2>
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
            <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
              <h2 className="mb-3 display text-18 text-text">Pull requests and CI · {github.length}</h2>
              <GitHubEvents events={github} now={now} />
            </section>
          )}

          <section id="artifacts" className="rounded-2xl p-5 ring-1 ring-inset ring-line">
            <h2 className="mb-3 display text-18 text-text">Artifacts · {artifacts.length}</h2>
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
                        <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-line bg-ink p-3 font-mono text-12 leading-relaxed text-muted">
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

        </aside>
      </div>
    </div>
    </Page>
  );
}

/** Streams in after the page: the lookup embeds the task text in the API. */
async function TaskMemory({ taskId }: { taskId: string }) {
  const related = await getTaskMemory(taskId);
  if (related === null) return <p className="text-14 text-faint">The memory can’t be searched right now. Try again in a moment.</p>;
  if (!related.length) {
    return (
      <p className="text-14 leading-relaxed text-faint">
        Nothing related has been remembered yet. Whatever this task verifies, or rules out, will be.
      </p>
    );
  }
  return (
    <ul className="-mx-2 space-y-0.5">
      {related.map((hit) => (
        <li key={hit.id}>
          <Link href={`/memory/${hit.id}`} className="block px-2 py-3 transition-colors hover:bg-hover">
            <span className="block min-w-0">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <KindBadge kind={hit.kind} />
                {hit.task_id === taskId && <span className="text-12 font-medium text-accent">this task</span>}
                <span className="ml-auto">
                  <MatchMeter similarity={hit.similarity} matched={hit.matched} />
                </span>
              </span>
              <span className="mt-1.5 block text-14 leading-snug text-text">{hit.title}</span>
              {hit.snippet && <span className="mt-1 line-clamp-1 text-13 text-muted">{plainText(hit.snippet)}</span>}
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
        <div key={i} className="flex gap-3.5">
          <div className="skeleton size-7 shrink-0" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="skeleton h-2.5 w-32" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
