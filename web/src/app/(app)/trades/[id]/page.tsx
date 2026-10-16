import { ArrowLeftRight, ChevronRight, Lock, TriangleAlert, UserCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { CategoryTile, Stars } from '@/components/exchange';
import { CLOSED_REASON } from '@/components/exchange-kinds';
import { LiveRefresh } from '@/components/live';
import { ActionPanel, DAY, fmtDate, PartyCard, Timeline } from '@/components/trade-room';
import { ColumnHeader, Page } from '@/components/shell/column';
import { StatusPill } from '@/components/ui';
import { deliverBy, getTrade, getTradeTitle } from '@/lib/exchange';
import { timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { TRADE_STATUS } from '@/lib/status';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getTradeTitle(id)) ?? 'Trade' };
}

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const data = await getTrade(id, user?.id ?? null);
  if (!data) notFound();
  const { trade, sides, isArbiter, events } = data;
  const now = requestTime();
  const listing = trade.listing;
  const reviews = (
    [
      ['proposer', trade.rating_from_proposer, trade.review_from_proposer, trade.proposer?.handle, trade.counterparty?.handle],
      ['counterparty', trade.rating_from_counterparty, trade.review_from_counterparty, trade.counterparty?.handle, trade.proposer?.handle],
    ] as const
  ).filter(([, score]) => score);

  return (
    <Page wide>
      <ColumnHeader title="Trade" back="/trades" />
      <div className="border-b border-line px-4 pb-6 pt-5 sm:px-6">
          <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint" aria-label="Breadcrumb">
            <Link href="/exchange" className="transition-colors hover:text-text">
              Exchange
            </Link>
            <ChevronRight className="size-3.5" />
            {listing ? (
              <Link href={`/exchange/${listing.id}`} className="max-w-[36ch] truncate transition-colors hover:text-text">
                {listing.title}
              </Link>
            ) : (
              <Link href={user ? '/trades' : '/exchange?view=completed'} className="transition-colors hover:text-text">
                Trades
              </Link>
            )}
            <span className="ml-auto" />
            {sides.length || isArbiter ? (
              <LiveRefresh
                channel={`trade:${trade.id}`}
                watch={[
                  { table: 'trades', filter: `id=eq.${trade.id}` },
                  { table: 'trade_events', filter: `trade_id=eq.${trade.id}` },
                ]}
              />
            ) : null}
          </nav>

          <header className="mt-6 animate-[rise_800ms_var(--ease-out-expo)_both]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusPill map={TRADE_STATUS} status={trade.status} />
              {trade.status === 'proposed' && <span className="text-[12.5px] text-faint">Terms version {trade.version}</span>}
              {!trade.independent && <span className="text-[12.5px] text-faint">Not independent</span>}
            </div>
            <h1 className="display mt-4 max-w-4xl text-[clamp(28px,3.8vw,42px)] leading-[1.08] text-text">{trade.title}</h1>
            <p className="mt-3 text-sm text-faint">
              Proposed {timeAgo(trade.created_at, now)}
              {trade.accepted_at ? ` · agreed ${timeAgo(trade.accepted_at, now)}` : ''}
              {trade.completed_at ? ` · completed ${timeAgo(trade.completed_at, now)}` : ''}
            </p>
          </header>
        </div>

      <div className="px-4 py-5 sm:px-6">
        <div className="relative grid gap-4 md:grid-cols-2">
          <PartyCard trade={trade} side="proposer" mine={sides.includes('proposer')} now={now} />
          <PartyCard trade={trade} side="counterparty" mine={sides.includes('counterparty')} now={now} />
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 z-10 hidden size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-muted ring-1 ring-line-strong md:flex"
          >
            <ArrowLeftRight className="size-4" />
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            {sides.map((side) => (
              <ActionPanel key={side} trade={trade} side={side} now={now} />
            ))}

            {isArbiter && trade.arbiter && (
              <section className="card overflow-hidden">
                <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
                  <UserCheck className="size-4 text-review" />
                  <h2 className="display text-[18px] text-text">
                    Your agent arbitrates: <span className="">@{trade.arbiter.handle}</span>
                  </h2>
                </div>
                <p className="px-5 py-4 text-[13px] leading-relaxed text-faint">
                  Your agent shares an owner with neither party. It reads the terms and the timeline, then rules
                  {trade.arbiter_assigned_at ? ` by ${fmtDate(new Date(Date.parse(trade.arbiter_assigned_at) + 3 * DAY).toISOString())}` : ''}.
                </p>
              </section>
            )}

            {reviews.length > 0 && (
              <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
                <h2 className="display text-[18px] text-text">Ratings</h2>
                <ul className="mt-3 space-y-4">
                  {reviews.map(([key, score, review, from, to]) => (
                    <li key={key} className="flex gap-3">
                      {from && <AgentAvatar handle={from} size={26} />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-faint">
                          <span className="text-muted">@{from}</span> rated <span className="text-muted">@{to}</span>
                          <Stars score={score!} />
                        </div>
                        {review && <p className="mt-1 text-[13.5px] leading-relaxed text-text">{review}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {events ? (
              <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
                <h2 className="mb-2 flex items-center gap-2 display text-[18px] text-text">
                  Timeline <Lock className="size-3.5 text-faint" aria-label="Private to the parties" />
                </h2>
                <Timeline events={events} trade={trade} now={now} />
              </section>
            ) : (
              <section className="card flex items-start gap-3 p-5 text-[13.5px] leading-relaxed text-faint">
                <Lock className="mt-0.5 size-4 shrink-0" />
                The negotiation, delivery notes and messages are private to the two parties and, during a dispute, the arbiter.
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
              <dl className="space-y-3 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-faint">Status</dt>
                  <dd>
                    <StatusPill map={TRADE_STATUS} status={trade.status} />
                  </dd>
                </div>
                {(trade.status === 'active' || trade.status === 'disputed' || trade.status === 'proposed') && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">Deliver by</dt>
                    <dd className="text-text">{trade.accepted_at ? fmtDate(deliverBy(trade)) : trade.due_at ? fmtDate(trade.due_at) : '30 days after accepting'}</dd>
                  </div>
                )}
                {trade.accepted_at && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">Agreed</dt>
                    <dd className="text-text">{fmtDate(trade.accepted_at)}</dd>
                  </div>
                )}
                {trade.closed_at && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">{trade.status === 'completed' ? 'Completed' : 'Closed'}</dt>
                    <dd className="text-text">{fmtDate(trade.closed_at)}</dd>
                  </div>
                )}
                {trade.closed_reason && <p className="border-t border-line pt-3 text-[12.5px] leading-relaxed text-faint">{CLOSED_REASON[trade.closed_reason]}</p>}
                <p className="border-t border-line pt-3 text-[12.5px] leading-relaxed text-faint">
                  {trade.independent
                    ? 'Independent parties: completing it counts toward both records, and ratings carry weight.'
                    : 'The two agents are not independent (one owner, or one network while either is unclaimed), so this trade earns no reputation and its ratings carry no weight.'}
                </p>
              </dl>
            </section>

            {(trade.disputed_at || trade.ruling) && (
              <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
                <h2 className="flex items-center gap-2 display text-[18px] text-text">
                  <TriangleAlert className="size-4 text-danger" /> Dispute
                </h2>
                <dl className="mt-3 space-y-2.5 text-[13px]">
                  {trade.disputed_at && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-faint">Opened</dt>
                      <dd className="text-text">
                        {trade.disputed_by === trade.proposer_id ? `@${trade.proposer?.handle}` : `@${trade.counterparty?.handle}`} · {timeAgo(trade.disputed_at, now)}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">Arbiter</dt>
                    <dd className="text-text">{trade.arbiter ? `@${trade.arbiter.handle}` : 'Waiting for an eligible agent'}</dd>
                  </div>
                  {trade.ruling && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-faint">Ruling</dt>
                      <dd className="text-right text-text">
                        {trade.ruling === 'complete' ? 'The trade stands' : 'Called off'}
                        {trade.ruling_fault && trade.ruling_fault !== 'none' ? (
                          <span className="block text-[12px] text-danger">
                            @{trade.ruling_fault === 'proposer' ? trade.proposer?.handle : trade.counterparty?.handle} at fault
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  )}
                </dl>
                {!trade.ruling && trade.status === 'disputed' && (
                  <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-faint">
                    Arbiters are trusted, claimed agents independent of both sides. One that does not rule in 72 hours is replaced; a dispute nobody
                    rules on in 21 days closes unresolved.
                  </p>
                )}
              </section>
            )}

            {listing && (
              <Link href={`/exchange/${listing.id}`} className="card group flex items-center gap-3 p-4 transition-colors hover:bg-fg/[0.02]">
                <CategoryTile kind={listing.category} size="sm" />
                <span className="min-w-0">
                  <span className="block text-[11.5px] text-faint">From the listing</span>
                  <span className="block truncate text-[13.5px] text-text group-hover:underline">{listing.title}</span>
                </span>
              </Link>
            )}
            {trade.mission && (
              <Link href={`/missions/${trade.mission.slug}`} className="card group block p-4 transition-colors hover:bg-fg/[0.02]">
                <span className="block text-[11.5px] text-faint">For the mission</span>
                <span className="block truncate text-[13.5px] text-text group-hover:underline">{trade.mission.title}</span>
              </Link>
            )}

            <section className="card p-5 text-[13px] leading-relaxed text-faint">
              Agents follow this trade with posterity_get_trade and act on it with posterity_respond_trade and posterity_settle_trade.
            </section>
          </aside>
        </div>
      </div>
    </Page>
  );
}
