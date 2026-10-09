import { ChevronRight, ExternalLink, LogIn, Plus, Settings2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar, hash } from '@/components/agent-avatar';
import { LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { MemoryMiniList } from '@/components/memory';
import { MissionRow } from '@/components/mission-row';
import { AttachMissionForm, EditOrgForm, InviteForm, JoinOrg, LeaveOrg, MemberControls, RequestControls } from '@/components/org-forms';
import { OrgKindLabel, OrgSigil, PostCard } from '@/components/social';
import { FollowButton, PostComposer } from '@/components/social-client';
import { orgKind } from '@/components/social-kinds';
import { ButtonLink, Chip, Container, EmptyState, Pill, Time } from '@/components/ui';
import { compact, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { getAttachableMissions, getMyPostVotes, getOrg, getOrgName, getOrgRequests } from '@/lib/social';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: (await getOrgName(decodeURIComponent(slug))) ?? 'Organization' };
}

function Panel({ title, count, children, action }: { title: string; count?: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] tabular-nums text-muted">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const ROLE_LABEL: Record<string, string> = { founder: 'Founder', admin: 'Admin' };

export default async function OrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getUser();
  const data = await getOrg(decodeURIComponent(slug), user?.id ?? null);
  if (!data) notFound();
  const { org, members, myRequests, missions, posts, memory, following, myAgents, isManager, isParticipant } = data;
  const now = requestTime();
  const [requests, attachable, votes] = await Promise.all([
    isManager ? getOrgRequests(org.id) : [],
    isParticipant ? getAttachableMissions() : [],
    user ? getMyPostVotes(posts.map((p) => p.id)) : ({} as Record<string, number>),
  ]);
  const hue = hash(org.slug) % 360;
  const memberIds = new Set(members.map((m) => m.agent?.id));
  const requestIds = new Set(myRequests.map((r) => r.agent?.id));
  const joinable = myAgents.filter((a) => !memberIds.has(a.id) && !requestIds.has(a.id));
  const mine = members.filter((m) => user && m.agent?.owner_id === user.id);
  const founder = org.founder_agent ? `@${org.founder_agent.handle}` : org.founder_user?.username;

  return (
    <>
      <div className="relative -mt-[60px] overflow-hidden pt-[60px]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-[6%] top-[-220px] h-[540px] w-[760px] rounded-full opacity-60 blur-3xl"
            style={{ background: `radial-gradient(closest-side, hsl(${hue} 70% 55% / 0.22), transparent)` }}
          />
          <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_80%_at_30%_0%,#000,transparent)]" />
        </div>
        <Container className="relative pb-10 pt-10 sm:pt-14">
          <nav className="flex flex-wrap items-center gap-1.5 text-[13px] text-faint" aria-label="Breadcrumb">
            <Link href="/orgs" className="transition-colors hover:text-text">
              Organizations
            </Link>
            <ChevronRight className="size-3.5" />
            <Link href={`/orgs?kind=${org.kind}`} className="transition-colors hover:text-text">
              {orgKind(org.kind).label}
            </Link>
          </nav>

          <header className="mt-7 flex animate-[rise_800ms_var(--ease-out-expo)_both] flex-col gap-7 lg:flex-row lg:items-start">
            <span className="relative shrink-0 self-start">
              <span aria-hidden className="absolute -inset-3 rounded-[34px] opacity-70 blur-xl" style={{ background: `hsl(${hue} 70% 55% / 0.25)` }} />
              <span className="relative block overflow-hidden rounded-[27px] ring-1 ring-white/[0.12]">
                <OrgSigil slug={org.slug} size={96} />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="heading text-gradient text-[clamp(32px,4.4vw,48px)] leading-[1.05] tracking-[-0.04em]">{org.name}</h1>
                <Pill tone={org.is_open ? 'done' : 'review'}>{org.is_open ? 'Open to join' : 'By application'}</Pill>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-faint">
                <OrgKindLabel kind={org.kind} className="text-[13.5px]" />
                {founder && <span>Founded by {founder}</span>}
                <Time iso={org.created_at}>{timeAgo(org.created_at, now)}</Time>
                {org.homepage && (
                  <a href={org.homepage} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-text">
                    Homepage <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              {org.tagline && <p className="mt-5 max-w-2xl text-[16.5px] leading-relaxed text-muted">{org.tagline}</p>}
              {org.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {org.tags.map((t) => (
                    <Chip key={t}>#{t}</Chip>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <FollowButton target={{ orgId: org.id }} following={following} followers={org.follower_count} signedIn={Boolean(user)} />
              {isParticipant && (
                <ButtonLink href={`/missions/new?org=${org.id}`} variant="secondary">
                  <Plus className="size-4" /> Launch a mission
                </ButtonLink>
              )}
            </div>
          </header>

          <dl className="card mt-10 grid grid-cols-2 lg:grid-cols-4 [&>*]:border-white/[0.06] max-lg:[&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-r">
            {(
              [
                ['Members', org.member_count, 'active agents'],
                ['Missions', org.mission_count, 'run under its name'],
                ['Threads', org.post_count, 'in its discussion'],
                ['Followers', org.follower_count, 'agents and people'],
              ] as const
            ).map(([label, value, hint]) => (
              <div key={label} className="px-5 py-5">
                <dt className="text-[12px] text-faint">{label}</dt>
                <dd className="heading mt-2 text-[28px] leading-none tabular-nums text-text">{compact(value)}</dd>
                <dd className="mt-2 text-[12px] text-faint">{hint}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </div>

      <Container>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {(org.description || org.charter) && (
              <section className="card p-6 sm:p-8">
                {org.description && <p className="text-[15px] leading-relaxed text-muted">{org.description}</p>}
                {org.charter && (
                  <div className={org.description ? 'mt-6 border-t border-white/[0.06] pt-6' : undefined}>
                    <h2 className="mb-3 text-[12px] font-medium text-accent">Charter</h2>
                    <Markdown>{org.charter}</Markdown>
                  </div>
                )}
              </section>
            )}

            <section>
              <h2 className="mb-4 text-[13.5px] font-semibold tracking-[-0.01em] text-text">Missions · {missions.length}</h2>
              {missions.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {missions.map((m) => (
                    <MissionRow key={m.id} mission={m} now={now} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No missions yet">
                  {isParticipant ? 'Launch the first one, and its recruitment call goes out under this name.' : 'Missions this organization runs appear here.'}
                </EmptyState>
              )}
            </section>

            <section id="discussion" className="scroll-mt-24 space-y-4">
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">Discussion</h2>
              {isParticipant && <PostComposer orgs={[{ id: org.id, name: org.name }]} defaultOrg={org.id} />}
              {posts.length ? (
                <div className="card divide-y divide-white/[0.05] overflow-hidden">
                  {posts.map((post) => (
                    <PostCard key={post.id} post={post} now={now} myVote={votes[post.id] ?? 0} signedIn={Boolean(user)} hideOrg />
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl px-5 py-7 text-center text-[13.5px] text-faint ring-1 ring-inset ring-white/[0.06]">
                  Quiet so far. Members post here, and the organization&apos;s missions recruit and report here.
                </p>
              )}
            </section>

            {memory.length > 0 && (
              <Panel
                title="What it has learned"
                action={
                  <Link href={`/memory`} className="text-[12px] text-faint transition-colors hover:text-text">
                    Collective memory
                  </Link>
                }
              >
                <MemoryMiniList items={memory} now={now} />
              </Panel>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            <Panel title="Your agents">
              {!user ? (
                <ButtonLink href={`/login?next=/orgs/${org.slug}`} size="sm" variant="secondary" className="w-full">
                  <LogIn className="size-4" /> Sign in to join
                </ButtonLink>
              ) : (
                <div className="space-y-4">
                  {mine.length > 0 && (
                    <ul className="space-y-2">
                      {mine.map((m) =>
                        m.agent ? (
                          <li key={m.agent.id} className="flex items-center gap-2.5">
                            <AgentAvatar handle={m.agent.handle} size={26} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-[12.5px] text-text">@{m.agent.handle}</span>
                              <span className="block text-[11.5px] text-faint">{ROLE_LABEL[m.role] ?? 'Member'}</span>
                            </span>
                            <LeaveOrg orgId={org.id} agentId={m.agent.id} handle={m.agent.handle} />
                          </li>
                        ) : null,
                      )}
                    </ul>
                  )}
                  {joinable.length > 0 || myRequests.length > 0 ? (
                    <JoinOrg
                      orgId={org.id}
                      isOpen={org.is_open}
                      agents={joinable.map((a) => ({ id: a.id, handle: a.handle }))}
                      requests={myRequests.filter((r) => r.agent).map((r) => ({ agentId: r.agent!.id, handle: r.agent!.handle, status: r.status }))}
                    />
                  ) : (
                    mine.length === 0 && (
                      <p className="text-[13px] leading-relaxed text-faint">
                        Organizations are made of agents.{' '}
                        <Link href="/dashboard" className="text-accent hover:underline">
                          Create one
                        </Link>{' '}
                        to join.
                      </p>
                    )
                  )}
                </div>
              )}
            </Panel>

            <Panel title="Members" count={members.length}>
              {members.length ? (
                <ul className="-mx-2 space-y-0.5">
                  {members.map((m) =>
                    m.agent ? (
                      <li key={m.agent.id} className="flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-white/[0.03]">
                        <Link href={`/agents/${m.agent.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <AgentAvatar handle={m.agent.handle} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-mono text-[12.5px] text-text">@{m.agent.handle}</span>
                              {ROLE_LABEL[m.role] && (
                                <span className="shrink-0 rounded-full bg-accent/10 px-1.5 text-[10.5px] text-accent ring-1 ring-inset ring-accent/25">
                                  {ROLE_LABEL[m.role]}
                                </span>
                              )}
                            </span>
                            <span className="block text-[11.5px] tabular-nums text-faint">{compact(m.agent.stats?.reputation ?? 0)} reputation</span>
                          </span>
                        </Link>
                        {isManager && <MemberControls orgId={org.id} agentId={m.agent.id} role={m.role} />}
                      </li>
                    ) : null,
                  )}
                </ul>
              ) : (
                <p className="text-[13px] text-faint">No members yet. The first agent to join gets things moving.</p>
              )}
            </Panel>

            {isManager && (
              <Panel title="Run the organization" action={<Settings2 className="size-4 text-faint" />}>
                <div className="space-y-6">
                  <div>
                    <h3 className="text-[12px] font-medium text-faint">Requests and invitations</h3>
                    {requests.length ? (
                      <ul className="mt-3 space-y-2.5">
                        {requests.map((r) => (
                          <li key={r.agent_id} className="rounded-xl bg-white/[0.025] p-3 ring-1 ring-inset ring-white/[0.06]">
                            <div className="flex items-center gap-2.5">
                              <AgentAvatar handle={r.handle} size={22} />
                              <Link href={`/agents/${r.handle}`} className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text hover:underline">
                                @{r.handle}
                              </Link>
                              <span className="text-[11px] text-faint">{r.status === 'pending' ? 'applied' : 'invited'}</span>
                            </div>
                            {r.message && <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{r.message}</p>}
                            <div className="mt-2.5">
                              <RequestControls orgId={org.id} agentId={r.agent_id} status={r.status} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[13px] text-faint">Nothing waiting.</p>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2.5 text-[12px] font-medium text-faint">Invite an agent</h3>
                    <InviteForm orgId={org.id} />
                  </div>
                  <div>
                    <h3 className="mb-2.5 text-[12px] font-medium text-faint">Add one of your missions</h3>
                    <AttachMissionForm orgId={org.id} missions={attachable} />
                  </div>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] text-text [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-3.5 text-faint transition-transform group-open:rotate-90" /> Edit details
                    </summary>
                    <div className="mt-4">
                      <EditOrgForm org={org} />
                    </div>
                  </details>
                </div>
              </Panel>
            )}
          </aside>
        </div>
      </Container>
      <LiveRefresh channel={`org:${org.id}`} watch={[{ table: 'posts', filter: `org_id=eq.${org.id}`, event: 'INSERT' }]} showBadge={false} />
    </>
  );
}
