import { ArrowRight, FileText, Link2 } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { CancelTaskForm } from '@/components/forms';
import { LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { SubmissionCard } from '@/components/submission-card';
import { Chip, Container, Pill, StatusPill, Time } from '@/components/ui';
import { getTask, getTaskTitle } from '@/lib/data';
import { compact, timeAgo, timeUntil } from '@/lib/format';
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
  const { task: t, upstream, downstream, submissions, events, artifacts, isOwner } = data;
  const now = requestTime();
  const closed = t.status === 'done' || t.status === 'cancelled';

  return (
    <Container className="py-10">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-faint" aria-label="Breadcrumb">
        <Link href="/missions" className="hover:text-text">
          Missions
        </Link>
        <span>/</span>
        <Link href={`/missions/${t.mission.slug}`} className="max-w-[40ch] truncate hover:text-text">
          {t.mission.title}
        </Link>
        <span>/</span>
        <span className="font-mono text-muted">{t.key}</span>
        <LiveRefresh
          channel={`task:${t.id}`}
          watch={[
            { table: 'tasks', filter: `id=eq.${t.id}` },
            { table: 'task_events', filter: `task_id=eq.${t.id}` },
            { table: 'submissions', filter: `task_id=eq.${t.id}` },
            { table: 'reviews', filter: `task_id=eq.${t.id}` },
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
        <h1 className="mt-4 max-w-4xl font-serif text-4xl leading-tight text-text">{t.title}</h1>
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

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          {t.description && (
            <section className="card p-6">
              <h2 className="label mb-4">Brief</h2>
              <Markdown>{t.description}</Markdown>
            </section>
          )}
          {t.acceptance_criteria && (
            <section className="rounded-2xl border border-accent/25 bg-accent/[0.03] p-6">
              <h2 className="label mb-3 text-accent">Acceptance criteria</h2>
              <p className="text-sm leading-relaxed text-text">{t.acceptance_criteria}</p>
            </section>
          )}

          {upstream.length > 0 && (
            <section className="card p-6">
              <h2 className="label mb-4">Inputs from upstream tasks</h2>
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

          <section>
            <h2 className="label mb-4">Submissions · {submissions.length}</h2>
            {submissions.length ? (
              <div className="space-y-4">
                {submissions.map((s) => (
                  <SubmissionCard key={s.id} submission={s} now={now} canReview={Boolean(user)} isOwner={isOwner} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-sm text-faint">No work submitted yet.</p>
            )}
          </section>

          <section className="card p-6">
            <h2 className="label mb-4">Timeline</h2>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-line-strong" aria-hidden />
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
                  <h2 className="label mb-3">Depends on</h2>
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
                  <h2 className="label mb-3">Unlocks</h2>
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

          <section id="artifacts" className="card p-5">
            <h2 className="label mb-3">Artifacts · {artifacts.length}</h2>
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
              <h2 className="label mb-3">Owner controls</h2>
              <CancelTaskForm taskId={t.id} />
            </section>
          )}
        </aside>
      </div>
    </Container>
  );
}
