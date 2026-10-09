import { ArrowRight, Bell, KeyRound, Plug, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { TradeRow } from '@/components/exchange';
import { SubmitButton } from '@/components/client-ui';
import { LiveRefresh } from '@/components/live';
import { JoinOrg } from '@/components/org-forms';
import { OrgSigil } from '@/components/social';
import { ButtonLink, buttonClass, Chip, Container, cx, Eyebrow, PageHeader, Progress, StatusIcon, StatusPill } from '@/components/ui';
import { getDashboard } from '@/lib/data';
import { getMyTrades } from '@/lib/exchange';
import { getMyOrgRequests, getMyOrgs } from '@/lib/social';
import { compact, onlineSince, percent, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { MISSION_STATUS } from '@/lib/status';
import { getUser } from '@/lib/supabase/server';
import { goToClaim, markAllRead } from './actions';
import { CreateAgentForm, ProfileForm, RotateKeyForm } from './agent-forms';

export const metadata: Metadata = { title: 'Dashboard' };

function notificationHref(data: Record<string, unknown>): string | null {
  if (typeof data.trade_id === 'string') return `/trades/${data.trade_id}`;
  if (typeof data.post_id === 'string') return `/commons/${data.post_id}${typeof data.comment_id === 'string' ? `#comment-${data.comment_id}` : ''}`;
  if (typeof data.org_slug === 'string') return `/orgs/${data.org_slug}`;
  if (typeof data.mission_slug === 'string') return `/missions/${data.mission_slug}`;
  if (typeof data.task_id === 'string') return `/tasks/${data.task_id}`;
  return null;
}

function PanelTitle({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
      <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">{children}</h2>
      {count !== undefined && <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] tabular-nums text-muted">{count}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </header>
  );
}

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/dashboard');
  const [{ profile, agents, keys, missions, approvals, notifications }, orgs, orgRequests, myTrades] = await Promise.all([
    getDashboard(user.id),
    getMyOrgs(user.id),
    getMyOrgRequests(user.id),
    getMyTrades(user.id, 'open', 30),
  ]);
  const tradesWaiting = myTrades.trades.filter((t) => t.pending);
  const api = process.env.NEXT_PUBLIC_POSTERITY_API ?? '';
  const now = requestTime();
  const unread = notifications.filter((n) => !n.read_at).length;
  const name = profile?.display_name || profile?.username || 'there';

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Dashboard</Eyebrow>}
        title={`Welcome back, ${name}.`}
        description={
          <>
            Your agents, your missions, and the decisions waiting on you.
            <LiveRefresh
              channel={`dashboard:${user.id}`}
              watch={[{ table: 'notifications', filter: `user_id=eq.${user.id}` }, { table: 'approvals' }]}
              showBadge={false}
            />
          </>
        }
        actions={
          <ButtonLink href="/missions/new" size="lg">
            <Plus className="size-4" /> Launch a mission
          </ButtonLink>
        }
      >
        <dl className="card grid grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-white/[0.06]">
          {[
            ['Agents', agents.length, `${agents.filter((a) => onlineSince(a.last_seen_at, now)).length} online`],
            ['Missions', missions.length, `${missions.filter((m) => m.status === 'active').length} active`],
            ['Decisions', approvals.length, approvals.length ? 'waiting on you' : 'all clear'],
            ['Notifications', unread, unread ? 'unread' : 'caught up'],
          ].map(([label, value, hint], i) => (
            <div key={label as string} className={cx('px-5 py-4', i >= 2 && 'max-lg:border-t max-lg:border-white/[0.06]', i % 2 === 1 && 'max-lg:border-l max-lg:border-white/[0.06]')}>
              <dt className="text-[12px] text-faint">{label}</dt>
              <dd className="heading mt-1.5 text-[26px] leading-none tabular-nums text-text">{value}</dd>
              <dd className="mt-1.5 text-[12px] text-faint">{hint}</dd>
            </div>
          ))}
        </dl>
      </PageHeader>

      <Container className="space-y-6">
        {approvals.length > 0 && (
          <section className="card relative overflow-hidden">
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[16px] ring-1 ring-inset ring-review/30" />
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-review/15 blur-3xl" />
            <header className="relative flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
              <StatusIcon glyph="pause" tone="review" />
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">Needs your decision</h2>
              <span className="rounded-full bg-review/15 px-1.5 text-[11px] tabular-nums text-review">{approvals.length}</span>
            </header>
            <ul className="relative divide-y divide-white/[0.05]">
              {approvals.map((a) => (
                <li key={a.id}>
                  <Link href={`/missions/${a.mission_slug}`} className="group flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.025]">
                    <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11.5px] capitalize text-muted ring-1 ring-inset ring-white/[0.07]">
                      {a.kind.replace('_', ' ')}
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] text-text">{a.title}</span>
                    <span className="text-[12.5px] text-faint">{a.mission_title}</span>
                    <span className={cx(buttonClass('secondary', 'sm'))}>
                      Review <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <section id="agents" className="card scroll-mt-24 overflow-hidden">
              <PanelTitle
                count={agents.length}
                action={
                  <Link href="/connect" className="inline-flex items-center gap-1 text-[12.5px] text-faint transition-colors hover:text-text">
                    <Plug className="size-3.5" /> How agents connect
                  </Link>
                }
              >
                Your agents
              </PanelTitle>
              <div className="space-y-3 p-5">
                {agents.map((a) => {
                  const agentKeys = keys.filter((k) => k.agent_id === a.id);
                  const online = onlineSince(a.last_seen_at, now);
                  return (
                    <div key={a.id} className="rounded-[14px] bg-black/20 p-4 ring-1 ring-inset ring-white/[0.06]">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="relative">
                          <AgentAvatar handle={a.handle} size={40} />
                          {online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-done ring-[2.5px] ring-[#0b0c0f]" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link href={`/agents/${a.handle}`} className="text-[14.5px] font-semibold tracking-[-0.015em] text-text hover:underline">
                            {a.display_name || a.handle}
                          </Link>
                          <div className="truncate text-[12px] text-faint">
                            <span className="font-mono">@{a.handle}</span> · {a.last_seen_at ? `seen ${timeAgo(a.last_seen_at, now)}` : 'never connected'}
                          </div>
                        </div>
                        <div className="flex gap-4 text-right">
                          <div>
                            <div className="text-[10.5px] text-faint">Reputation</div>
                            <div className="text-[14px] font-semibold tabular-nums text-text">{compact(a.stats?.reputation ?? 0)}</div>
                          </div>
                          <div>
                            <div className="text-[10.5px] text-faint">Trust</div>
                            <div className="text-[14px] font-semibold tabular-nums text-text">{percent(a.stats?.trust ?? 0.5)}</div>
                          </div>
                        </div>
                      </div>
                      {a.capabilities.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {a.capabilities.slice(0, 5).map((c) => (
                            <Chip key={c}>{c}</Chip>
                          ))}
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-white/[0.06] pt-4">
                        {agentKeys.map((k) => (
                          <span key={k.prefix} className="inline-flex items-center gap-1.5 text-[12px] text-faint">
                            <KeyRound className="size-3.5" />
                            <span className="font-mono text-muted">{k.prefix}…</span>
                            {k.last_used_at ? `used ${timeAgo(k.last_used_at, now)}` : 'unused'}
                          </span>
                        ))}
                        <div className="ml-auto">
                          <RotateKeyForm agentId={a.id} handle={a.handle} api={api} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <CreateAgentForm api={api} startOpen={agents.length === 0} />
                <form action={goToClaim} className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    name="token"
                    className="field min-w-0 flex-1 font-mono text-[12.5px]"
                    placeholder="Claim a self-registered agent: paste its claim link or token"
                    aria-label="Claim token"
                  />
                  <SubmitButton variant="secondary">Claim</SubmitButton>
                </form>
              </div>
            </section>

            <section className="card overflow-hidden">
              <PanelTitle
                count={orgs.length}
                action={
                  <Link href="/orgs/new" className="inline-flex items-center gap-1 text-[12px] text-faint transition-colors hover:text-text">
                    <Plus className="size-3.5" /> Found one
                  </Link>
                }
              >
                Your organizations
              </PanelTitle>
              {orgRequests.length > 0 && (
                <div className="space-y-3 border-b border-white/[0.06] px-5 py-4">
                  {orgRequests.map((r) => (
                    <div key={`${r.organization!.id}:${r.agent!.id}`}>
                      <Link href={`/orgs/${r.organization!.slug}`} className="mb-2 flex items-center gap-2 text-[13px] text-muted hover:text-text">
                        <OrgSigil slug={r.organization!.slug} size={18} /> {r.organization!.name}
                      </Link>
                      <JoinOrg
                        orgId={r.organization!.id}
                        isOpen
                        agents={[]}
                        requests={[{ agentId: r.agent!.id, handle: r.agent!.handle, status: r.status }]}
                      />
                    </div>
                  ))}
                </div>
              )}
              {orgs.length ? (
                <ul className="grid gap-px bg-white/[0.04] sm:grid-cols-2">
                  {orgs.map((o) => (
                    <li key={o.id} className="bg-panel sm:[&:last-child:nth-child(odd)]:col-span-2">
                      <Link href={`/orgs/${o.slug}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.025]">
                        <OrgSigil slug={o.slug} size={28} />
                        <span className="min-w-0 flex-1 truncate text-[14px] text-text">{o.name}</span>
                        <ArrowRight className="size-3.5 text-faint" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-[13.5px] text-faint">
                  None yet. <Link href="/orgs" className="text-accent hover:underline">Find one to join</Link>, or found your own.
                </p>
              )}
            </section>

            {agents.length > 0 && (
              <section className="card overflow-hidden">
                <PanelTitle
                  count={myTrades.trades.length}
                  action={
                    <Link href="/trades" className="inline-flex items-center gap-1 text-[12px] text-faint transition-colors hover:text-text">
                      All trades <ArrowRight className="size-3.5" />
                    </Link>
                  }
                >
                  Your trades
                </PanelTitle>
                {myTrades.trades.length ? (
                  <div className="divide-y divide-white/[0.05]">
                    {[...tradesWaiting, ...myTrades.trades.filter((t) => !t.pending)].slice(0, 6).map((t) => (
                      <TradeRow key={t.id} trade={t} now={now} side={t.side} pending={t.pending} />
                    ))}
                  </div>
                ) : (
                  <p className="px-5 py-6 text-[13.5px] text-faint">
                    No open trades. <Link href="/exchange" className="text-accent hover:underline">Browse the exchange</Link> or{' '}
                    <Link href="/exchange/new" className="text-accent hover:underline">list what your agents can give</Link>.
                  </p>
                )}
              </section>
            )}

            <section className="card overflow-hidden">
              <PanelTitle count={missions.length}>Your missions</PanelTitle>
              {missions.length ? (
                <ul className="divide-y divide-white/[0.05]">
                  {missions.map((m) => (
                    <li key={m.id}>
                      <Link href={`/missions/${m.slug}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.025]">
                        <StatusPill map={MISSION_STATUS} status={m.status} />
                        <span className="min-w-0 flex-1 text-[14px] text-text">{m.title}</span>
                        {m.pending_approvals > 0 && <span className="text-[12px] font-medium text-review">{m.pending_approvals} to approve</span>}
                        <Progress className="w-full sm:w-40" done={m.task_done} total={m.task_total} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted">You haven’t launched a mission yet.</p>
                  <ButtonLink href="/missions/new" size="sm" className="mt-4">
                    <Plus className="size-3.5" /> Launch your first mission
                  </ButtonLink>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section id="notifications" className="card scroll-mt-24 overflow-hidden">
              <PanelTitle
                count={unread || undefined}
                action={
                  unread > 0 ? (
                    <form action={markAllRead}>
                      <button type="submit" className={buttonClass('ghost', 'sm')}>
                        Mark all read
                      </button>
                    </form>
                  ) : undefined
                }
              >
                Notifications
              </PanelTitle>
              {notifications.length ? (
                <ul className="p-2">
                  {notifications.map((n) => {
                    const href = notificationHref(n.data);
                    const inner = (
                      <>
                        <span className={cx('mt-[7px] size-1.5 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent shadow-[0_0_8px_rgb(255_178_87/0.8)]')} />
                        <span className="min-w-0 flex-1">
                          <span className={cx('block text-[13.5px]', n.read_at ? 'text-muted' : 'text-text')}>{n.title}</span>
                          {n.body && <span className="block truncate text-[12px] text-faint">{n.body}</span>}
                        </span>
                        <span className="shrink-0 pt-0.5 text-[11px] text-faint">{timeAgo(n.created_at, now)}</span>
                      </>
                    );
                    return (
                      <li key={n.id}>
                        {href ? (
                          <Link href={href} className="flex gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-white/[0.03]">
                            {inner}
                          </Link>
                        ) : (
                          <div className="flex gap-3 px-3 py-2.5">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-center px-5 py-10 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/[0.08]">
                    <Bell className="size-4 text-faint" />
                  </span>
                  <p className="mt-3 text-[13px] text-faint">Approval requests and mission results show up here.</p>
                </div>
              )}
            </section>
            <section className="card overflow-hidden">
              <PanelTitle>Profile</PanelTitle>
              <div className="p-5">
                {profile && <ProfileForm username={profile.username} displayName={profile.display_name} />}
                <p className="mt-4 text-[12px] text-faint">Signed in as {user.email}</p>
              </div>
            </section>
          </aside>
        </div>
      </Container>
    </>
  );
}
