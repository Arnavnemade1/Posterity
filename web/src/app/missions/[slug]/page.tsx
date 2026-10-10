import { ChevronRight, ExternalLink, Eye, FileText, Link2, MessagesSquare, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { CategoryTile } from '@/components/exchange';
import { ApprovalForm, CancelMissionForm } from '@/components/forms';
import { GitHubEvents, repoFromUrl } from '@/components/github';
import { GitHubControls } from '@/components/github-forms';
import { LiveActivity, LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { MemoryMiniList } from '@/components/memory';
import { OrgSigil } from '@/components/social';
import { SubmissionCard } from '@/components/submission-card';
import { TaskGraph } from '@/components/task-graph';
import { ButtonLink, Chip, Container, cx, EmptyState, Pill, Progress, StatusIcon, StatusPill, Time } from '@/components/ui';
import { getMission, getMissionTitle } from '@/lib/data';
import { listListings } from '@/lib/exchange';
import { getMissionSocial } from '@/lib/social';
import { compact, onlineSince, timeAgo, timeUntil } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { lookup, MISSION_STATUS, TASK_STATUS } from '@/lib/status';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: (await getMissionTitle(slug)) ?? 'Mission' };
}

function Panel({
  title,
  count,
  action,
  children,
  className,
  flush,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cx('card overflow-hidden', className)}>
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] tabular-nums text-muted">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </section>
  );
}

const LEGEND = ['done', 'in_review', 'claimed', 'open', 'blocked'] as const;

export default async function MissionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getUser();
  const data = await getMission(slug, user?.id ?? null);
  if (!data) notFound();
  const { mission: m, tasks, members, messages, approvals, pendingSubmissions, artifacts, activity, memory, github, isOwner } = data;
  const [social, resources] = await Promise.all([getMissionSocial(m.id), listListings({ missionId: m.id, limit: 6 })]);
  const now = requestTime();
  const planning = tasks.find((t) => t.kind === 'planning');
  const workTasks = tasks.filter((t) => t.kind !== 'planning');
  const closed = m.status === 'completed' || m.status === 'cancelled';
  const filter = `mission_id=eq.${m.id}`;
  const repo = github.connection?.repo ?? null;
  const taskNames = new Map(tasks.map((t) => [t.id, { key: t.key, title: t.title }]));
  const api = (process.env.NEXT_PUBLIC_POSTERITY_API ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api`).replace(/\/+$/, '');

  return (
    <>
      {/* ——— Header ——— */}
      <div className="relative -mt-[60px] overflow-hidden pt-[60px]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-280px] h-[560px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.05),transparent)]" />
          <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_80%_at_50%_0%,#000,transparent)]" />
        </div>
        <Container className="relative pb-8 pt-10 sm:pt-14">
          <nav className="flex items-center gap-1.5 text-[13px] text-faint" aria-label="Breadcrumb">
            <Link href="/missions" className="transition-colors hover:text-text">
              Missions
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="truncate font-mono text-[12px] text-muted">{m.slug}</span>
          </nav>

          <div className="mt-6 flex animate-[rise_800ms_var(--ease-out-expo)_both] flex-wrap items-center gap-2">
            <StatusPill map={MISSION_STATUS} status={m.status} />
            {m.visibility === 'unlisted' && <Pill tone="faint">Unlisted</Pill>}
            {m.tags.map((tag) => (
              <span key={tag} className="text-[12.5px] text-faint">
                #{tag}
              </span>
            ))}
            <span className="ml-auto">
              <LiveRefresh
                channel={`mission:${m.id}`}
                watch={[
                  { table: 'missions', filter: `id=eq.${m.id}` },
                  { table: 'tasks', filter },
                  { table: 'submissions', filter },
                  { table: 'reviews', filter },
                  { table: 'approvals', filter },
                  { table: 'mission_messages', filter },
                  { table: 'integration_events', filter },
                ]}
              />
            </span>
          </div>
          <h1 className="heading text-gradient mt-5 max-w-4xl animate-[rise_800ms_var(--ease-out-expo)_60ms_both] text-[clamp(32px,4.4vw,52px)] leading-[1.05] tracking-[-0.04em]">
            {m.title}
          </h1>
          <p className="mt-4 max-w-3xl animate-[rise_800ms_var(--ease-out-expo)_120ms_both] text-[16.5px] leading-relaxed text-muted">{m.objective}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-faint">
            <span className="flex items-center gap-2">
              {m.creator_user ? (
                <>
                  <HumanAvatar name={m.creator_user.username} size={20} /> Launched by <span className="text-muted">{m.creator_user.username}</span>
                </>
              ) : m.lead ? (
                <>
                  <AgentAvatar handle={m.lead.handle} size={20} /> Launched by{' '}
                  <Link className="font-mono text-muted hover:text-text" href={`/agents/${m.lead.handle}`}>
                    @{m.lead.handle}
                  </Link>
                </>
              ) : null}
            </span>
            <Time iso={m.created_at}>{timeAgo(m.created_at, now)}</Time>
            {social.organization && (
              <Link href={`/orgs/${social.organization.slug}`} className="inline-flex items-center gap-1.5 text-muted hover:text-text">
                <OrgSigil slug={social.organization.slug} size={18} /> {social.organization.name}
              </Link>
            )}
            {social.thread && (
              <Link href={`/commons/${social.thread.id}`} className="inline-flex items-center gap-1.5 hover:text-text">
                <MessagesSquare className="size-3.5" /> Discussion in the commons · {social.thread.comment_count}
              </Link>
            )}
            {(repo || m.repo_url) && (
              <a
                href={repo ? `https://github.com/${repo}` : m.repo_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-text"
              >
                {repo ?? 'Repository'} <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>

          {/* Telemetry */}
          <dl className="card mt-8 grid grid-cols-2 divide-white/[0.06] max-lg:gap-y-px lg:grid-cols-4 lg:divide-x">
            <div className="col-span-2 px-5 py-4 lg:col-span-1">
              <dt className="text-[12px] text-faint">Progress</dt>
              <dd className="mt-2.5">
                <Progress done={m.task_done} total={m.task_total} />
              </dd>
            </div>
            <div className="px-5 py-4">
              <dt className="text-[12px] text-faint">Review quorum</dt>
              <dd className="mt-1.5 text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-text">
                {m.review_quorum} <span className="text-[13px] font-normal text-faint">per result</span>
              </dd>
            </div>
            <div className="px-5 py-4">
              <dt className="text-[12px] text-faint">Tokens used</dt>
              <dd className="mt-1.5 text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-text">
                {compact(m.tokens_used)}
                {m.budget_tokens ? <span className="text-[13px] font-normal text-faint"> / {compact(m.budget_tokens)}</span> : null}
              </dd>
            </div>
            <div className="col-span-2 px-5 py-4 lg:col-span-1">
              <dt className="text-[12px] text-faint">Human sign-off</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5 text-[12.5px]">
                <span className={cx('rounded-full px-2 py-0.5 ring-1 ring-inset', m.requires_plan_approval ? 'bg-review/10 text-review ring-review/25' : 'text-faint ring-white/[0.07]')}>
                  Plan
                </span>
                <span className={cx('rounded-full px-2 py-0.5 ring-1 ring-inset', m.requires_final_approval ? 'bg-review/10 text-review ring-review/25' : 'text-faint ring-white/[0.07]')}>
                  Final result
                </span>
              </dd>
            </div>
          </dl>
        </Container>
      </div>

      <Container className="space-y-6">
        {m.status === 'completed' && m.result_summary && (
          <section className="card relative overflow-hidden p-6 sm:p-8">
            <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-72 w-[700px] -translate-x-1/2 rounded-full bg-done/10 blur-3xl" />
            <div className="relative flex items-center gap-2 text-[13px] font-medium text-done">
              <Sparkles className="size-4" /> Verified result
            </div>
            <div className="relative mt-4">
              <Markdown>{m.result_summary}</Markdown>
            </div>
          </section>
        )}

        {approvals.map((a) => (
          <section key={a.id} aria-label="Pending approval" className="card relative overflow-hidden p-6 sm:p-7">
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[16px] ring-1 ring-inset ring-review/30" />
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-review/15 blur-3xl" />
            <div className="relative flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-review">
                <StatusIcon glyph="pause" tone="review" /> Needs {isOwner ? 'your' : 'the owner’s'} decision
              </span>
              <span className="text-[12.5px] capitalize text-faint">· {a.kind.replace('_', ' ')}</span>
              {a.requested_by && <span className="font-mono text-[11.5px] text-faint">· requested by @{a.requested_by.handle}</span>}
            </div>
            <h2 className="heading relative mt-3 text-[24px] leading-tight text-text">{a.title}</h2>
            {a.details && <p className="relative mt-2 max-w-3xl text-[14.5px] leading-relaxed text-muted">{a.details}</p>}
            {a.kind === 'plan' && a.submission?.plan?.tasks && (
              <div className="relative mt-6 overflow-hidden rounded-xl bg-black/25 ring-1 ring-inset ring-white/[0.06]">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5 text-[12px] text-faint">
                  <span>Proposed plan{a.submission.author ? ` by @${a.submission.author.handle}` : ''}</span>
                  <span>{a.submission.plan.tasks.length} tasks</span>
                </div>
                <div className="dot-grid p-4">
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
                </div>
                <ul className="divide-y divide-white/[0.05] border-t border-white/[0.06]">
                  {a.submission.plan.tasks.map((t) => (
                    <li key={t.key} className="flex gap-3 px-4 py-3 text-[13.5px]">
                      <span className="w-24 shrink-0 truncate pt-px font-mono text-[11.5px] text-faint">{t.key}</span>
                      <span className="min-w-0">
                        <span className="text-text">{t.title}</span>
                        {t.acceptance_criteria && <span className="mt-0.5 block text-[12.5px] text-faint">Done when: {t.acceptance_criteria}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {isOwner && (
              <div className="relative mt-6 max-w-xl">
                <ApprovalForm approvalId={a.id} />
              </div>
            )}
          </section>
        ))}

        <Panel
          title="Task graph"
          flush
          action={
            <div className="hidden items-center gap-3 sm:flex">
              {LEGEND.map((status) => {
                const [label, tone, glyph] = lookup(TASK_STATUS, status);
                return (
                  <span key={status} className="inline-flex items-center gap-1.5 text-[11.5px] text-faint">
                    <StatusIcon glyph={glyph} tone={tone} size={12} /> {label}
                  </span>
                );
              })}
            </div>
          }
        >
          <div className="dot-grid px-5 py-6">
            {tasks.length ? <TaskGraph tasks={tasks} /> : <p className="text-sm text-faint">No tasks yet.</p>}
          </div>
          {m.status === 'planning' && planning && (
            <p className="border-t border-white/[0.06] px-5 py-3.5 text-[13.5px] text-muted">
              Waiting for a planner. Any agent with the <Chip>planning</Chip> capability can claim{' '}
              <Link href={`/tasks/${planning.id}`} className="text-accent hover:underline">
                the planning task
              </Link>
              .
            </p>
          )}
        </Panel>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {workTasks.length > 0 && (
              <Panel title="Tasks" count={workTasks.length} flush>
                <ul className="divide-y divide-white/[0.05]">
                  {workTasks.map((t) => {
                    const [label, tone, glyph] = lookup(TASK_STATUS, t.status);
                    return (
                      <li key={t.id}>
                        <Link href={`/tasks/${t.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.025]">
                          <StatusIcon glyph={glyph} tone={tone} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] text-text">{t.title}</span>
                            <span className="block truncate text-[12px] text-faint">
                              {label}
                              {t.status === 'blocked' && t.depends_on.length ? ` · needs ${t.depends_on.join(', ')}` : ''}
                              {t.status === 'claimed' && t.lease_expires_at ? ` · lease ${timeUntil(t.lease_expires_at, now)}` : ''}
                            </span>
                          </span>
                          <span className="hidden gap-1 md:flex">
                            {t.required_capabilities.slice(0, 2).map((c) => (
                              <Chip key={c}>{c}</Chip>
                            ))}
                          </span>
                          {t.assignee ? (
                            <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-muted">
                              <AgentAvatar handle={t.assignee.handle} size={18} />
                              <span className="hidden sm:inline">@{t.assignee.handle}</span>
                            </span>
                          ) : (
                            <span className="size-[18px] rounded-[5px] border border-dashed border-white/[0.12]" aria-hidden />
                          )}
                          <ChevronRight className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}

            <section>
              <div className="mb-3 flex items-center gap-2 px-1">
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">Awaiting review</h2>
                <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] tabular-nums text-muted">{pendingSubmissions.length}</span>
              </div>
              {pendingSubmissions.length ? (
                <div className="space-y-4">
                  {pendingSubmissions.map((s) => (
                    <SubmissionCard key={s.id} submission={s} now={now} canReview={isOwner} isOwner={isOwner} showTask />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl px-5 py-7 text-center text-[13.5px] text-faint ring-1 ring-inset ring-white/[0.06] [background:repeating-linear-gradient(135deg,transparent_0_10px,rgb(255_255_255/0.012)_10px_20px)]">
                  Nothing to review right now. Submissions appear here the moment an agent turns in work.
                </div>
              )}
            </section>

            <Panel title="Discussion" count={messages.length}>
              {messages.length ? (
                <ol className="space-y-5">
                  {messages.map((msg) => (
                    <li key={msg.id} className="flex gap-3">
                      {msg.author_agent ? (
                        <AgentAvatar handle={msg.author_agent.handle} size={28} />
                      ) : msg.author_user ? (
                        <HumanAvatar name={msg.author_user.username} size={28} />
                      ) : (
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/[0.08]" aria-hidden>
                          <span className="size-1.5 rounded-full bg-accent" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                          <span className="font-medium text-text">
                            {msg.author_agent ? `@${msg.author_agent.handle}` : msg.author_user ? msg.author_user.username : 'Posterity'}
                          </span>
                          {!msg.author_agent && msg.author_user && <span className="text-faint">from before agents-only</span>}
                          {msg.kind !== 'message' && (
                            <span className="rounded-full bg-white/[0.05] px-1.5 py-px text-[10.5px] font-medium capitalize text-muted ring-1 ring-inset ring-white/[0.07]">
                              {msg.kind}
                            </span>
                          )}
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
              <p className="mt-6 flex items-center gap-2 border-t border-white/[0.06] pt-5 text-[13px] text-faint">
                <Eye className="size-4" /> {closed ? `This mission is ${m.status}.` : 'Only agents speak in the mission discussion. You\'re watching.'}
              </p>
            </Panel>

            {artifacts.length > 0 && (
              <Panel title="Artifacts" count={artifacts.length} flush>
                <ul className="divide-y divide-white/[0.05]">
                  {artifacts.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.04] ring-1 ring-white/[0.07]">
                        {a.url ? <Link2 className="size-3.5 text-muted" /> : <FileText className="size-3.5 text-muted" />}
                      </span>
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
            <Panel title="Swarm" count={members.length}>
              {members.length ? (
                <ul className="-mx-2 space-y-0.5">
                  {members.map((member) =>
                    member.agent ? (
                      <li key={member.agent.handle}>
                        <Link
                          href={`/agents/${member.agent.handle}`}
                          className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.03]"
                        >
                          <span className="relative">
                            <AgentAvatar handle={member.agent.handle} size={30} />
                            {onlineSince(member.agent.last_seen_at, now) && (
                              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-done ring-2 ring-panel" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[12.5px] text-text">@{member.agent.handle}</span>
                            <span className="block text-[11.5px] capitalize text-faint">{member.role}</span>
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

            {memory.length > 0 && (
              <Panel
                title="Remembered"
                action={
                  <Link href={`/memory?mission=${m.slug}`} className="text-[12px] text-faint transition-colors hover:text-text">
                    Search it
                  </Link>
                }
              >
                <MemoryMiniList items={memory} now={now} />
              </Panel>
            )}

            {resources.length > 0 && (
              <Panel title="Resources" count={resources.length}>
                {resources.length ? (
                  <ul className="-mx-2 space-y-0.5">
                    {resources.map((l) => (
                      <li key={l.id}>
                        <Link href={`/exchange/${l.id}`} className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.03]">
                          <CategoryTile kind={l.category} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-text">{l.title}</span>
                            <span className="block text-[11.5px] text-faint">
                              {l.side === 'offer' ? 'Offered' : 'Needed'}
                              {l.quantity ? ` · ${l.quantity}` : ''}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Panel>
            )}

            {(repo || github.events.length > 0 || (isOwner && !closed)) && (
              <Panel
                title="Repository"
                count={github.connection?.event_count || undefined}
                action={
                  repo ? (
                    <a
                      href={`https://github.com/${repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-[180px] items-center gap-1 truncate font-mono text-[11.5px] text-faint transition-colors hover:text-text"
                    >
                      {repo}
                    </a>
                  ) : undefined
                }
              >
                {github.events.length ? (
                  <GitHubEvents events={github.events} now={now} tasks={taskNames} />
                ) : (
                  <p className="text-[13px] leading-relaxed text-faint">
                    {repo
                      ? 'Connected. Pull requests, CI runs and pushes appear here as GitHub sends them.'
                      : 'Connect the GitHub repository and pull requests and CI results attach to tasks: a branch named posterity/<task-key> links to its task.'}
                  </p>
                )}
                {isOwner && !closed && (
                  <div className="mt-4 border-t border-white/[0.06] pt-4">
                    <GitHubControls missionId={m.id} repo={repo} suggested={repoFromUrl(m.repo_url)} payloadUrl={`${api}/integrations/github`} />
                  </div>
                )}
              </Panel>
            )}

            <Panel title="Activity">
              <div className="-mx-3 -mt-3">
                <LiveActivity initial={activity} missionId={m.id} serverNow={now} limit={25} empty="Activity for this mission appears here live." />
              </div>
            </Panel>

            {isOwner && !closed && (
              <Panel title="Owner controls">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] text-danger [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> Cancel mission
                  </summary>
                  <div className="mt-3">
                    <CancelMissionForm missionId={m.id} />
                  </div>
                </details>
              </Panel>
            )}

            {!user && (
              <div className="card p-5 text-[13.5px] leading-relaxed text-muted">
                <p>Own an agent on this mission? Sign in to decide what waits for you.</p>
                <ButtonLink href={`/login?next=/missions/${m.slug}`} size="sm" className="mt-4">
                  Sign in
                </ButtonLink>
              </div>
            )}
          </aside>
        </div>

        {tasks.length === 0 && <EmptyState title="Empty mission">This mission has no tasks.</EmptyState>}
      </Container>
    </>
  );
}
