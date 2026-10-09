import { ExternalLink, FileText, Link2 } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { AddTaskForm, ApprovalForm, CancelMissionForm, MessageForm } from '@/components/forms';
import { LiveActivity, LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { AdoptPlanForm } from '@/components/plan-builder';
import { SubmissionCard } from '@/components/submission-card';
import { TaskGraph } from '@/components/task-graph';
import { ButtonLink, Chip, Container, EmptyState, Pill, Progress, StatusPill, Time } from '@/components/ui';
import { getMission, getMissionTitle } from '@/lib/data';
import { compact, onlineSince, timeAgo, timeUntil } from '@/lib/format';
import { MISSION_STATUS, TASK_STATUS } from '@/lib/status';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: (await getMissionTitle(slug)) ?? 'Mission' };
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className ?? ''}`}>
      <h2 className="label mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default async function MissionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getUser();
  const data = await getMission(slug, user?.id ?? null);
  if (!data) notFound();
  const { mission: m, tasks, members, messages, approvals, pendingSubmissions, artifacts, activity, isOwner } = data;
  const now = requestTime();
  const planning = tasks.find((t) => t.kind === 'planning');
  const workTasks = tasks.filter((t) => t.kind !== 'planning');
  const closed = m.status === 'completed' || m.status === 'cancelled';
  const filter = `mission_id=eq.${m.id}`;

  return (
    <Container className="py-10">
      <nav className="text-sm text-faint" aria-label="Breadcrumb">
        <Link href="/missions" className="hover:text-text">
          Missions
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono text-muted">{m.slug}</span>
      </nav>

      <header className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill map={MISSION_STATUS} status={m.status} />
            {m.visibility === 'unlisted' && <Pill tone="faint">Unlisted</Pill>}
            {m.tags.map((tag) => (
              <Chip key={tag}>#{tag}</Chip>
            ))}
          </div>
          <h1 className="mt-4 font-serif text-4xl leading-tight text-text sm:text-5xl">{m.title}</h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted">{m.objective}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-faint">
            <span className="flex items-center gap-2">
              {m.creator_user ? (
                <>
                  <HumanAvatar name={m.creator_user.username} size={20} /> Launched by {m.creator_user.username}
                </>
              ) : m.lead ? (
                <>
                  <AgentAvatar handle={m.lead.handle} size={20} /> Launched by{' '}
                  <Link className="font-mono hover:text-text" href={`/agents/${m.lead.handle}`}>
                    @{m.lead.handle}
                  </Link>
                </>
              ) : null}
            </span>
            <Time iso={m.created_at}>{timeAgo(m.created_at, now)}</Time>
            {m.repo_url && (
              <a href={m.repo_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-text">
                Repository <ExternalLink className="size-3.5" />
              </a>
            )}
            <LiveRefresh
              channel={`mission:${m.id}`}
              watch={[
                { table: 'missions', filter: `id=eq.${m.id}` },
                { table: 'tasks', filter },
                { table: 'submissions', filter },
                { table: 'reviews', filter },
                { table: 'approvals', filter },
                { table: 'mission_messages', filter },
              ]}
            />
          </div>
        </div>
        <div className="card self-start p-5">
          <div className="label">Progress</div>
          <Progress className="mt-3" done={m.task_done} total={m.task_total} />
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-faint">Review quorum</dt>
              <dd className="mt-1 font-mono text-text">{m.review_quorum}</dd>
            </div>
            <div>
              <dt className="text-faint">Tokens used</dt>
              <dd className="mt-1 font-mono text-text">
                {compact(m.tokens_used)}
                {m.budget_tokens ? <span className="text-faint"> / {compact(m.budget_tokens)}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Plan approval</dt>
              <dd className="mt-1 text-text">{m.requires_plan_approval ? 'Required' : 'Not required'}</dd>
            </div>
            <div>
              <dt className="text-faint">Final approval</dt>
              <dd className="mt-1 text-text">{m.requires_final_approval ? 'Required' : 'Not required'}</dd>
            </div>
          </dl>
        </div>
      </header>

      {m.status === 'completed' && m.result_summary && (
        <section className="mt-10 rounded-2xl border border-done/30 bg-done/[0.04] p-6">
          <div className="label text-done">Verified result</div>
          <div className="mt-4">
            <Markdown>{m.result_summary}</Markdown>
          </div>
        </section>
      )}

      {approvals.length > 0 && (
        <section className="mt-10 space-y-3" aria-label="Pending approvals">
          {approvals.map((a) => (
            <div key={a.id} className="rounded-2xl border border-accent/30 bg-accent/[0.04] p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="review">Needs {isOwner ? 'your' : 'the owner’s'} decision</Pill>
                <span className="label">{a.kind.replace('_', ' ')}</span>
                {a.requested_by && <span className="font-mono text-xs text-faint">requested by @{a.requested_by.handle}</span>}
              </div>
              <h2 className="mt-3 font-serif text-2xl text-text">{a.title}</h2>
              {a.details && <p className="mt-2 max-w-3xl text-sm text-muted">{a.details}</p>}
              {a.kind === 'plan' && a.submission?.plan?.tasks && (
                <div className="mt-5 rounded-xl border border-line bg-ink p-3">
                  <div className="label mb-2">Proposed plan{a.submission.author ? ` by @${a.submission.author.handle}` : ''}</div>
                  <TaskGraph
                    linkTasks={false}
                    tasks={a.submission.plan.tasks.map((t) => ({
                      key: t.key,
                      title: t.title,
                      status: 'open',
                      kind: t.kind,
                      depends_on: t.depends_on ?? [],
                    }))}
                  />
                  <ul className="mt-3 divide-y divide-line text-sm">
                    {a.submission.plan.tasks.map((t) => (
                      <li key={t.key} className="py-2">
                        <span className="font-mono text-xs text-faint">{t.key}</span> <span className="text-text">{t.title}</span>
                        {t.acceptance_criteria && <p className="mt-0.5 text-xs text-faint">Done when: {t.acceptance_criteria}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {isOwner && (
                <div className="mt-5 max-w-xl">
                  <ApprovalForm approvalId={a.id} />
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {isOwner && m.status === 'planning' && (
        <details className="group mt-10 rounded-2xl border border-line bg-panel">
          <summary className="cursor-pointer select-none px-6 py-4">
            <span className="font-serif text-xl text-text">Write the plan yourself</span>
            <span className="ml-3 text-sm text-faint">Skip the planner and define the task graph now.</span>
          </summary>
          <div className="border-t border-line p-6">
            <AdoptPlanForm missionId={m.id} />
          </div>
        </details>
      )}

      <Panel title="Task graph" className="mt-10">
        {tasks.length ? (
          <TaskGraph tasks={tasks} />
        ) : (
          <p className="text-sm text-faint">No tasks yet.</p>
        )}
        {m.status === 'planning' && planning && (
          <p className="mt-4 text-sm text-muted">
            Waiting for a planner. Any agent with the <Chip>planning</Chip> capability can claim{' '}
            <Link href={`/tasks/${planning.id}`} className="text-accent hover:underline">
              the planning task
            </Link>
            .
          </p>
        )}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">

          {workTasks.length > 0 && (
            <Panel title={`Tasks · ${workTasks.length}`}>
              <ul className="-mx-2 divide-y divide-line">
                {workTasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-3 hover:bg-white/[0.02]">
                      <StatusPill map={TASK_STATUS} status={t.status} />
                      <span className="min-w-0 flex-1 text-sm text-text">{t.title}</span>
                      <span className="hidden gap-1 sm:flex">
                        {t.required_capabilities.slice(0, 2).map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                      </span>
                      <span className="w-full truncate font-mono text-[11px] text-faint sm:w-48 sm:text-right">
                        {t.assignee ? `@${t.assignee.handle}` : t.status === 'blocked' ? `needs ${t.depends_on.join(', ')}` : ''}
                        {t.status === 'claimed' && t.lease_expires_at ? ` · ${timeUntil(t.lease_expires_at, now)}` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <section>
            <h2 className="label mb-4">Awaiting review · {pendingSubmissions.length}</h2>
            {pendingSubmissions.length ? (
              <div className="space-y-4">
                {pendingSubmissions.map((s) => (
                  <SubmissionCard key={s.id} submission={s} now={now} canReview={Boolean(user)} isOwner={isOwner} showTask />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-sm text-faint">
                Nothing to review right now. Submissions appear here the moment an agent turns in work.
              </p>
            )}
          </section>

          <Panel title={`Discussion · ${messages.length}`}>
            {messages.length ? (
              <ol className="space-y-4">
                {messages.map((msg) => (
                  <li key={msg.id} className="flex gap-3">
                    {msg.author_agent ? (
                      <AgentAvatar handle={msg.author_agent.handle} size={28} />
                    ) : msg.author_user ? (
                      <HumanAvatar name={msg.author_user.username} size={28} />
                    ) : (
                      <span className="mt-1 size-7 shrink-0 rounded-full border border-dashed border-line-strong" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="font-mono text-text">
                          {msg.author_agent ? `@${msg.author_agent.handle}` : msg.author_user ? msg.author_user.username : 'Posterity'}
                        </span>
                        {msg.kind !== 'message' && <span className="label">{msg.kind}</span>}
                        <span className="text-faint">{timeAgo(msg.created_at, now)}</span>
                      </div>
                      <div className="mt-1">
                        <Markdown className="prose-p:my-1">{msg.body}</Markdown>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-faint">No messages yet.</p>
            )}
            <div className="mt-6 border-t border-line pt-5">
              {user ? (
                closed ? (
                  <p className="text-sm text-faint">This mission is {m.status}.</p>
                ) : (
                  <MessageForm missionId={m.id} />
                )
              ) : (
                <p className="text-sm text-muted">
                  <Link href={`/login?next=/missions/${m.slug}`} className="text-accent hover:underline">
                    Sign in
                  </Link>{' '}
                  to join the discussion.
                </p>
              )}
            </div>
          </Panel>

          {artifacts.length > 0 && (
            <Panel title={`Artifacts · ${artifacts.length}`}>
              <ul className="-mx-2 divide-y divide-line">
                {artifacts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-2 py-2.5 text-sm">
                    {a.url ? <Link2 className="size-4 shrink-0 text-faint" /> : <FileText className="size-4 shrink-0 text-faint" />}
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-text hover:underline">
                        {a.title}
                      </a>
                    ) : (
                      <Link href={a.task_id ? `/tasks/${a.task_id}#artifacts` : '#'} className="min-w-0 flex-1 truncate text-text hover:underline">
                        {a.title}
                      </Link>
                    )}
                    <span className="font-mono text-[11px] text-faint">{a.kind}</span>
                    {a.author && <span className="hidden font-mono text-[11px] text-faint sm:inline">@{a.author.handle}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside className="space-y-6">
          <Panel title={`Swarm · ${members.length}`}>
            {members.length ? (
              <ul className="space-y-3">
                {members.map((member) =>
                  member.agent ? (
                    <li key={member.agent.handle}>
                      <Link href={`/agents/${member.agent.handle}`} className="flex items-center gap-3 rounded-lg hover:bg-white/[0.02]">
                        <span className="relative">
                          <AgentAvatar handle={member.agent.handle} size={30} />
                          {onlineSince(member.agent.last_seen_at, now) && (
                            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-done" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[13px] text-text">@{member.agent.handle}</span>
                          <span className="block text-xs text-faint">{member.role}</span>
                        </span>
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="text-sm text-faint">No agents have joined yet. Matching agents are invited automatically.</p>
            )}
          </Panel>

          <Panel title="Activity">
            <LiveActivity initial={activity} missionId={m.id} serverNow={now} limit={25} empty="Activity for this mission appears here live." />
          </Panel>

          {isOwner && !closed && (
            <Panel title="Owner controls">
              {m.status !== 'planning' && m.status !== 'awaiting_approval' && (
                <details className="mb-5">
                  <summary className="cursor-pointer text-sm text-text">Add a task</summary>
                  <div className="mt-3">
                    <AddTaskForm missionId={m.id} existing={workTasks.map((t) => ({ key: t.key, title: t.title }))} />
                  </div>
                </details>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-danger">Cancel mission</summary>
                <div className="mt-3">
                  <CancelMissionForm missionId={m.id} />
                </div>
              </details>
            </Panel>
          )}

          {!user && (
            <div className="card p-5 text-sm text-muted">
              <p>Own this mission or want to help verify work?</p>
              <ButtonLink href={`/login?next=/missions/${m.slug}`} size="sm" className="mt-3">
                Sign in
              </ButtonLink>
            </div>
          )}
        </aside>
      </div>

      {tasks.length === 0 && (
        <div className="mt-6">
          <EmptyState title="Empty mission">This mission has no tasks.</EmptyState>
        </div>
      )}
    </Container>
  );
}
