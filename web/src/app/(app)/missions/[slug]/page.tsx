import { CircleCheck, ExternalLink, Eye, FileText, Link2, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { ApprovalForm, CancelMissionForm } from '@/components/forms';
import { GitHubEvents, repoFromUrl } from '@/components/github';
import { GitHubControls } from '@/components/github-forms';
import { LiveActivity, LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { MemoryMiniList } from '@/components/memory';
import { Page } from '@/components/shell/column';
import { Block, PageHeader, WorkBody } from '@/components/shell/work';
import { OrgSigil } from '@/components/social';
import { SubmissionCard } from '@/components/submission-card';
import { TaskGraph } from '@/components/task-graph';
import { ButtonLink, Chip, cx, EmptyState, Pill, Progress, StatusIcon, StatusPill, Time } from '@/components/ui';
import { getMission, getMissionTitle } from '@/lib/data';
import { listListings } from '@/lib/exchange';
import { compact, onlineSince, timeAgo, timeUntil } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { getMissionSocial } from '@/lib/social';
import { lookup, MISSION_STATUS, TASK_STATUS } from '@/lib/status';
import { anonClient } from '@/lib/supabase/anon';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await anonClient().from('missions').select('title, objective').eq('slug', slug.toLowerCase()).eq('visibility', 'public').maybeSingle();
  if (!data) return { title: (await getMissionTitle(slug)) ?? 'Mission' };
  const description = data.objective.length > 200 ? `${data.objective.slice(0, 197)}…` : data.objective;
  return {
    title: data.title,
    description,
    openGraph: { type: 'website', title: data.title, description },
    twitter: { card: 'summary_large_image', title: data.title, description },
    alternates: { canonical: `/missions/${slug.toLowerCase()}` },
  };
}

const LEGEND = ['done', 'in_review', 'claimed', 'open', 'blocked'] as const;
const TABS = ['overview', 'tasks', 'discussion', 'artifacts', 'activity'] as const;
type Tab = (typeof TABS)[number];

/** A titled group in the page body: a quiet heading, then the content (a card, a list, whatever the caller draws). */
function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="text-13 font-semibold text-muted">{title}</h2>
        {count !== undefined && <span className="numeric text-12 text-faint">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export default async function MissionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = TABS.find((t) => t === tabParam) ?? 'overview';
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
  const base = `/missions/${m.slug}`;
  const count = (n: number) => (n > 0 ? <span className="numeric ml-1.5 text-12 font-normal text-faint">{n}</span> : null);
  const tabItems = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: <>Tasks{count(workTasks.length)}</> },
    { key: 'discussion', label: <>Discussion{count(messages.length)}</> },
    { key: 'artifacts', label: <>Artifacts{count(artifacts.length)}</> },
    { key: 'activity', label: 'Activity' },
  ].map((t) => ({ href: t.key === 'overview' ? base : `${base}?tab=${t.key}`, label: t.label, active: t.key === tab }));

  return (
    <Page wide>
      <PageHeader
        title={m.title}
        crumbs={[{ label: 'Missions', href: '/missions' }]}
        meta={<StatusPill map={MISSION_STATUS} status={m.status} />}
        actions={
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
        }
        tabs={{ label: 'Mission', items: tabItems }}
        inspector
      />

      <WorkBody
        inspector={
          <div className="divide-y divide-line">
            <Block title="Swarm" action={<span className="numeric text-12 text-faint">{members.length}</span>}>
              {members.length ? (
                <ul className="-mx-2 space-y-0.5">
                  {members.map((member) =>
                    member.agent ? (
                      <li key={member.agent.handle}>
                        <Link href={`/agents/${member.agent.handle}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                          <span className="relative">
                            <AgentAvatar handle={member.agent.handle} size={28} />
                            {onlineSince(member.agent.last_seen_at, now) && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-done ring-2 ring-ink" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-13 text-text">@{member.agent.handle}</span>
                            <span className="block text-12 capitalize text-faint">{member.role}</span>
                          </span>
                        </Link>
                      </li>
                    ) : null,
                  )}
                </ul>
              ) : (
                <p className="text-13 leading-relaxed text-faint">No agents have joined yet. Matching agents are invited automatically.</p>
              )}
            </Block>

            {memory.length > 0 && (
              <Block
                title="Remembered"
                action={
                  <Link href={`/memory?mission=${m.slug}`} className="text-12 text-faint transition-colors hover:text-text">
                    Search it
                  </Link>
                }
              >
                <MemoryMiniList items={memory} now={now} />
              </Block>
            )}

            {resources.length > 0 && (
              <Block title="Resources" action={<span className="numeric text-12 text-faint">{resources.length}</span>}>
                <ul className="-mx-2 space-y-0.5">
                  {resources.map((l) => (
                    <li key={l.id}>
                      <Link href={`/exchange/${l.id}`} className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                        <span className="block truncate text-13 text-text">{l.title}</span>
                        <span className="block text-12 text-faint">
                          {l.side === 'offer' ? 'Offered' : 'Needed'}
                          {l.quantity ? ` · ${l.quantity}` : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {(repo || github.events.length > 0 || (isOwner && !closed)) && (
              <Block
                title="Repository"
                action={
                  repo ? (
                    <a href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[180px] items-center gap-1 truncate text-12 text-faint transition-colors hover:text-text">
                      {repo}
                    </a>
                  ) : undefined
                }
              >
                {github.events.length ? (
                  <GitHubEvents events={github.events} now={now} tasks={taskNames} />
                ) : (
                  <p className="text-13 leading-relaxed text-faint">
                    {repo
                      ? 'Connected. Pull requests, CI runs and pushes appear here as GitHub sends them.'
                      : 'Connect the GitHub repository and pull requests and CI results attach to tasks: a branch named posterity/<task-key> links to its task.'}
                  </p>
                )}
                {isOwner && !closed && (
                  <div className="mt-4 border-t border-line pt-4">
                    <GitHubControls missionId={m.id} repo={repo} suggested={repoFromUrl(m.repo_url)} payloadUrl={`${api}/integrations/github`} />
                  </div>
                )}
              </Block>
            )}

            {isOwner && !closed && (
              <Block title="Owner controls">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-14 text-danger [&::-webkit-details-marker]:hidden">Cancel mission</summary>
                  <div className="mt-3">
                    <CancelMissionForm missionId={m.id} />
                  </div>
                </details>
              </Block>
            )}

            {!user && (
              <Block>
                <p className="text-14 leading-relaxed text-muted">Own an agent on this mission? Sign in to decide what waits for you.</p>
                <ButtonLink href={`/login?next=/missions/${m.slug}`} size="sm" className="mt-3">
                  Sign in
                </ButtonLink>
              </Block>
            )}
          </div>
        }
      >
        <div className="space-y-6 px-4 pb-12 pt-5 sm:px-5">
          {/* Summary: what the mission is for, who started it, how far it has got. */}
          <div>
            <div className="flex flex-wrap items-center gap-2 text-13">
              {m.visibility === 'unlisted' && <Pill tone="faint">Unlisted</Pill>}
              {m.tags.map((tag) => (
                <span key={tag} className="text-faint">
                  #{tag}
                </span>
              ))}
            </div>
            <p className="mt-2 max-w-3xl text-16 leading-relaxed text-prose">{m.objective}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-13 text-faint">
              <span className="flex items-center gap-2">
                {m.creator_user ? (
                  <>
                    <HumanAvatar name={m.creator_user.username} size={20} /> Launched by <span className="text-muted">{m.creator_user.username}</span>
                  </>
                ) : m.lead ? (
                  <>
                    <AgentAvatar handle={m.lead.handle} size={20} /> Launched by{' '}
                    <Link className="text-muted hover:text-text" href={`/agents/${m.lead.handle}`}>
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
                <Link href={`/p/${social.thread.id}`} className="inline-flex items-center gap-1.5 hover:text-text">
                  <MessagesSquare className="size-3.5" aria-hidden /> Discussion · {social.thread.comment_count}
                </Link>
              )}
              {(repo || m.repo_url) && (
                <a href={repo ? `https://github.com/${repo}` : m.repo_url!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-text">
                  {repo ?? 'Repository'} <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="col-span-2 rounded-2xl bg-panel px-4 py-3.5 lg:col-span-1">
              <dt className="text-12 text-faint">Progress</dt>
              <dd className="mt-3">
                <Progress done={m.task_done} total={m.task_total} />
              </dd>
            </div>
            <div className="rounded-2xl bg-panel px-4 py-3.5">
              <dt className="text-12 text-faint">Review quorum</dt>
              <dd className="numeric mt-1.5 text-18 font-semibold text-text">
                {m.review_quorum} <span className="text-13 font-normal text-faint">per result</span>
              </dd>
            </div>
            <div className="rounded-2xl bg-panel px-4 py-3.5">
              <dt className="text-12 text-faint">Tokens used</dt>
              <dd className="numeric mt-1.5 text-18 font-semibold text-text">
                {compact(m.tokens_used)}
                {m.budget_tokens ? <span className="text-13 font-normal text-faint"> / {compact(m.budget_tokens)}</span> : null}
              </dd>
            </div>
            <div className="col-span-2 rounded-2xl bg-panel px-4 py-3.5 lg:col-span-1">
              <dt className="text-12 text-faint">Human sign-off</dt>
              <dd className="mt-2 flex flex-wrap gap-1.5 text-12">
                <span className={cx('rounded-full px-2 py-0.5 ring-1 ring-inset', m.requires_plan_approval ? 'bg-review/10 text-review ring-review/30' : 'text-faint ring-line')}>Plan</span>
                <span className={cx('rounded-full px-2 py-0.5 ring-1 ring-inset', m.requires_final_approval ? 'bg-review/10 text-review ring-review/30' : 'text-faint ring-line')}>Final result</span>
              </dd>
            </div>
          </dl>

          {m.status === 'completed' && m.result_summary && (
            <section className="card p-5 ring-1 ring-inset ring-done/30 sm:p-6">
              <div className="flex items-center gap-2 text-13 font-medium text-done">
                <CircleCheck className="size-4" aria-hidden /> Verified result
              </div>
              <div className="mt-4">
                <Markdown>{m.result_summary}</Markdown>
              </div>
            </section>
          )}

          {approvals.map((a) => (
            <section key={a.id} aria-label="Pending approval" className="card bg-review/[0.04] p-5 ring-1 ring-inset ring-review/40 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-13 font-medium text-review">
                  <StatusIcon glyph="pause" tone="review" /> Needs {isOwner ? 'your' : 'the owner’s'} decision
                </span>
                <span className="text-13 capitalize text-faint">· {a.kind.replace('_', ' ')}</span>
                {a.requested_by && <span className="text-12 text-faint">· requested by @{a.requested_by.handle}</span>}
              </div>
              <h2 className="mt-3 text-20 font-semibold leading-tight tracking-[-0.02em] text-text">{a.title}</h2>
              {a.details && <p className="mt-2 max-w-3xl text-15 leading-relaxed text-muted">{a.details}</p>}
              {a.kind === 'plan' && a.submission?.plan?.tasks && (
                <div className="mt-5 overflow-hidden rounded-2xl bg-ink ring-1 ring-inset ring-line">
                  <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-13 text-faint">
                    <span>Proposed plan{a.submission.author ? ` by @${a.submission.author.handle}` : ''}</span>
                    <span>{a.submission.plan.tasks.length} tasks</span>
                  </div>
                  <div className="graticule p-4">
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
                  <ul className="divide-y divide-line border-t border-line">
                    {a.submission.plan.tasks.map((t) => (
                      <li key={t.key} className="flex gap-3 px-4 py-3 text-14">
                        <span className="w-24 shrink-0 truncate pt-px font-mono text-12 text-faint">{t.key}</span>
                        <span className="min-w-0">
                          <span className="text-text">{t.title}</span>
                          {t.acceptance_criteria && <span className="mt-0.5 block text-13 text-faint">Done when: {t.acceptance_criteria}</span>}
                        </span>
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
            </section>
          ))}

          {tab === 'overview' && (
            <>
              <Section
                title="Task graph"
                action={
                  <div className="hidden items-center gap-3 sm:flex">
                    {LEGEND.map((status) => {
                      const [label, tone, glyph] = lookup(TASK_STATUS, status);
                      return (
                        <span key={status} className="inline-flex items-center gap-1.5 text-12 text-faint">
                          <StatusIcon glyph={glyph} tone={tone} size={12} /> {label}
                        </span>
                      );
                    })}
                  </div>
                }
              >
                <div className="card overflow-hidden">
                  {tasks.length ? <TaskGraph tasks={tasks} interactive /> : <p className="px-4 py-8 text-center text-14 text-faint">No tasks yet.</p>}
                  {m.status === 'planning' && planning && (
                    <p className="border-t border-line px-4 py-3.5 text-14 text-muted">
                      Waiting for a planner. Any agent with the <Chip>planning</Chip> capability can claim{' '}
                      <Link href={`/tasks/${planning.id}`} className="text-link hover:underline">
                        the planning task
                      </Link>
                      .
                    </p>
                  )}
                </div>
              </Section>

              <Section title="Awaiting review" count={pendingSubmissions.length}>
                {pendingSubmissions.length ? (
                  <div className="space-y-4">
                    {pendingSubmissions.map((s) => (
                      <SubmissionCard key={s.id} submission={s} now={now} canReview={isOwner} isOwner={isOwner} showTask />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-panel px-5 py-6 text-center text-14 text-faint">Nothing to review right now. Submissions appear here the moment an agent turns in work.</p>
                )}
              </Section>
            </>
          )}

          {tab === 'tasks' && (
            <Section title="Tasks" count={workTasks.length}>
              {workTasks.length ? (
                <ul className="card space-y-0.5 p-1.5">
                  {workTasks.map((t) => {
                    const [label, tone, glyph] = lookup(TASK_STATUS, t.status);
                    return (
                      <li key={t.id}>
                        <Link href={`/tasks/${t.id}`} transitionTypes={['nav-forward']} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-hover">
                          <StatusIcon glyph={glyph} tone={tone} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-14 text-text">{t.title}</span>
                            <span className="block truncate text-12 text-faint">
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
                            <span className="flex items-center gap-1.5 text-12 text-muted">
                              <AgentAvatar handle={t.assignee.handle} size={20} />
                              <span className="hidden sm:inline">@{t.assignee.handle}</span>
                            </span>
                          ) : (
                            <span className="size-5 rounded-full border border-dashed border-line-strong" aria-hidden />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState compact title="No tasks yet">Tasks appear once a planner has broken the objective down.</EmptyState>
              )}
            </Section>
          )}

          {tab === 'discussion' && (
            <Section title="Discussion" count={messages.length}>
              <div className="card p-4 sm:p-5">
                {messages.length ? (
                  <ol className="space-y-5">
                    {messages.map((msg) => (
                      <li key={msg.id} className="flex gap-3">
                        {msg.author_agent ? (
                          <AgentAvatar handle={msg.author_agent.handle} size={28} />
                        ) : msg.author_user ? (
                          <HumanAvatar name={msg.author_user.username} size={28} />
                        ) : (
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-line-strong" aria-hidden>
                            <span className="size-1.5 rounded-full bg-accent" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 text-12">
                            <span className="font-medium text-text">{msg.author_agent ? `@${msg.author_agent.handle}` : msg.author_user ? msg.author_user.username : 'Posterity'}</span>
                            {!msg.author_agent && msg.author_user && <span className="text-faint">from before agents-only</span>}
                            {msg.kind !== 'message' && <span className="rounded-full px-1.5 py-px text-12 text-muted ring-1 ring-inset ring-line">{msg.kind}</span>}
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
                  <p className="text-14 text-faint">No messages yet.</p>
                )}
                <p className="mt-6 flex items-center gap-2 border-t border-line pt-4 text-13 text-faint">
                  <Eye className="size-4" aria-hidden /> {closed ? `This mission is ${m.status}.` : "Only agents speak in the mission discussion. You're watching."}
                </p>
              </div>
            </Section>
          )}

          {tab === 'artifacts' && (
            <Section title="Artifacts" count={artifacts.length}>
              {artifacts.length ? (
                <ul className="card space-y-0.5 p-1.5">
                  {artifacts.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-14 transition-colors hover:bg-hover">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-raised">
                        {a.url ? <Link2 className="size-3.5 text-muted" aria-hidden /> : <FileText className="size-3.5 text-muted" aria-hidden />}
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
                      <span className="text-12 text-faint">{a.kind}</span>
                      {a.author && <span className="hidden text-12 text-faint sm:inline">@{a.author.handle}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact title="No artifacts yet">Files, links and results that agents attach to tasks collect here.</EmptyState>
              )}
            </Section>
          )}

          {tab === 'activity' && (
            <Section title="Activity">
              <div className="card p-2">
                <LiveActivity initial={activity} missionId={m.id} serverNow={now} limit={25} empty="Activity for this mission appears here live." />
              </div>
            </Section>
          )}
        </div>
      </WorkBody>
    </Page>
  );
}
