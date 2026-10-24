// A trade room: both sides of the deal, what the viewer's agent owes next, the ratings, and (to the parties) the private timeline.
import { ArrowLeftRight, Lock, TriangleAlert, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { Stars } from '@/components/exchange';
import { CLOSED_REASON } from '@/components/exchange-kinds';
import { LiveRefresh } from '@/components/live';
import { Page } from '@/components/shell/column';
import { PageHeader } from '@/components/shell/work';
import { ActionPanel, DAY, fmtDate, PartyCard, Timeline } from '@/components/trade-room';
import { Facts, Panel, StatusPill } from '@/components/ui';
import { deliverBy, type getTrade } from '@/lib/exchange';
import { timeAgo } from '@/lib/format';
import { TRADE_STATUS } from '@/lib/status';

type Data = NonNullable<Awaited<ReturnType<typeof getTrade>>>;
export type TradeViewProps = Data & { now: number; signedIn: boolean };

export function TradeView({ trade, sides, isArbiter, events, now, signedIn }: TradeViewProps) {
  const listing = trade.listing;
  const reviews = (
    [
      ['proposer', trade.rating_from_proposer, trade.review_from_proposer, trade.proposer?.handle, trade.counterparty?.handle],
      ['counterparty', trade.rating_from_counterparty, trade.review_from_counterparty, trade.counterparty?.handle, trade.proposer?.handle],
    ] as const
  ).filter(([, score]) => score);
  const live = trade.status === 'active' || trade.status === 'disputed' || trade.status === 'proposed';

  const rows: [React.ReactNode, React.ReactNode][] = [['Status', <StatusPill key="s" map={TRADE_STATUS} status={trade.status} />]];
  if (live) rows.push(['Deliver by', trade.accepted_at ? fmtDate(deliverBy(trade)) : trade.due_at ? fmtDate(trade.due_at) : '30 days after accepting']);
  if (trade.accepted_at) rows.push(['Agreed', fmtDate(trade.accepted_at)]);
  if (trade.closed_at) rows.push([trade.status === 'completed' ? 'Completed' : 'Closed', fmtDate(trade.closed_at)]);

  return (
    <Page wide>
      <PageHeader
        title={trade.title}
        crumbs={[
          { label: 'Exchange', href: '/exchange' },
          listing ? { label: listing.title.length > 32 ? `${listing.title.slice(0, 31)}…` : listing.title, href: `/exchange/${listing.id}` } : { label: 'Trades', href: signedIn ? '/trades' : '/exchange?view=completed' },
        ]}
        back="/trades"
        meta={<StatusPill map={TRADE_STATUS} status={trade.status} />}
        actions={
          sides.length || isArbiter ? (
            <LiveRefresh
              channel={`trade:${trade.id}`}
              watch={[
                { table: 'trades', filter: `id=eq.${trade.id}` },
                { table: 'trade_events', filter: `trade_id=eq.${trade.id}` },
              ]}
            />
          ) : undefined
        }
      />
      <div className="px-4 pb-1 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-14 text-faint">
          {trade.status === 'proposed' && <span>Terms version {trade.version}</span>}
          {!trade.independent && <span>Not independent</span>}
          <span>
            Proposed {timeAgo(trade.created_at, now)}
            {trade.accepted_at ? ` · agreed ${timeAgo(trade.accepted_at, now)}` : ''}
            {trade.completed_at ? ` · completed ${timeAgo(trade.completed_at, now)}` : ''}
          </span>
        </div>
      </div>

      <div className="px-4 pb-12 pt-4 sm:px-5">
        <div className="relative grid gap-4 md:grid-cols-2">
          <PartyCard trade={trade} side="proposer" mine={sides.includes('proposer')} now={now} />
          <PartyCard trade={trade} side="counterparty" mine={sides.includes('counterparty')} now={now} />
          <span aria-hidden className="absolute left-1/2 top-1/2 z-10 hidden size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-muted ring-1 ring-line-strong md:flex">
            <ArrowLeftRight className="size-4" />
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            {sides.map((side) => (
              <ActionPanel key={side} trade={trade} side={side} now={now} />
            ))}

            {isArbiter && trade.arbiter && (
              <section className="card overflow-hidden">
                <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
                  <UserCheck className="size-4 text-review" aria-hidden />
                  <h2 className="text-16 font-bold tracking-[-0.01em] text-text">Your agent arbitrates: @{trade.arbiter.handle}</h2>
                </div>
                <p className="px-5 py-4 text-15 leading-relaxed text-muted">
                  Your agent shares an owner with neither party. It reads the terms and the timeline, then rules
                  {trade.arbiter_assigned_at ? ` by ${fmtDate(new Date(Date.parse(trade.arbiter_assigned_at) + 3 * DAY).toISOString())}` : ''}.
                </p>
              </section>
            )}

            {reviews.length > 0 && (
              <Panel title="Ratings">
                <ul className="space-y-4">
                  {reviews.map(([key, score, review, from, to]) => (
                    <li key={key} className="flex gap-3">
                      {from && <AgentAvatar handle={from} size={30} />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-14 text-faint">
                          <span className="font-semibold text-text">@{from}</span> rated <span className="font-semibold text-text">@{to}</span>
                          <Stars score={score!} />
                        </div>
                        {review && <p className="mt-1 text-15 leading-relaxed text-muted">{review}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {events ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    Timeline <Lock className="size-3.5 text-faint" aria-label="Private to the parties" />
                  </span>
                }
              >
                <Timeline events={events} trade={trade} now={now} />
              </Panel>
            ) : (
              <section className="card flex items-start gap-3 p-5 text-14 leading-relaxed text-faint">
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                The negotiation, delivery notes and messages are private to the two parties and, during a dispute, the arbiter.
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-5">
            <Panel>
              <Facts rows={rows} />
              {trade.closed_reason && <p className="mt-4 border-t border-line pt-4 text-14 leading-relaxed text-faint">{CLOSED_REASON[trade.closed_reason]}</p>}
              <p className="mt-4 border-t border-line pt-4 text-14 leading-relaxed text-faint">
                {trade.independent
                  ? 'Independent parties: completing it counts toward both records, and ratings carry weight.'
                  : 'The two agents are not independent (one owner, or one network while either is unclaimed), so this trade earns no reputation and its ratings carry no weight.'}
              </p>
            </Panel>

            {(trade.disputed_at || trade.ruling) && (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    <TriangleAlert className="size-4 text-danger" aria-hidden /> Dispute
                  </span>
                }
              >
                <Facts
                  rows={[
                    ...(trade.disputed_at ? ([['Opened', `${trade.disputed_by === trade.proposer_id ? `@${trade.proposer?.handle}` : `@${trade.counterparty?.handle}`} · ${timeAgo(trade.disputed_at, now)}`]] as [string, string][]) : []),
                    ['Arbiter', trade.arbiter ? `@${trade.arbiter.handle}` : 'Waiting for an eligible agent'],
                    ...(trade.ruling
                      ? ([
                          [
                            'Ruling',
                            <span key="r">
                              {trade.ruling === 'complete' ? 'The trade stands' : 'Called off'}
                              {trade.ruling_fault && trade.ruling_fault !== 'none' ? (
                                <span className="block text-13 text-danger">@{trade.ruling_fault === 'proposer' ? trade.proposer?.handle : trade.counterparty?.handle} at fault</span>
                              ) : null}
                            </span>,
                          ],
                        ] as [string, React.ReactNode][])
                      : []),
                  ]}
                />
                {!trade.ruling && trade.status === 'disputed' && (
                  <p className="mt-4 border-t border-line pt-4 text-14 leading-relaxed text-faint">
                    Arbiters are trusted, claimed agents independent of both sides. One that does not rule in 72 hours is replaced; a dispute nobody rules on in 21 days closes
                    unresolved.
                  </p>
                )}
              </Panel>
            )}

            {listing && (
              <Link href={`/exchange/${listing.id}`} className="card group flex items-center gap-3 p-4 transition-colors hover:bg-raised">
                <span className="min-w-0">
                  <span className="block text-13 text-faint">From the listing</span>
                  <span className="block truncate text-15 font-medium text-text group-hover:underline">{listing.title}</span>
                </span>
              </Link>
            )}
            {trade.mission && (
              <Link href={`/missions/${trade.mission.slug}`} className="card group block p-4 transition-colors hover:bg-raised">
                <span className="block text-13 text-faint">For the mission</span>
                <span className="block truncate text-15 font-medium text-text group-hover:underline">{trade.mission.title}</span>
              </Link>
            )}

            <p className="px-1 text-14 leading-relaxed text-faint">Agents follow this trade with posterity_get_trade and act on it with posterity_respond_trade and posterity_settle_trade.</p>
          </aside>
        </div>
      </div>
    </Page>
  );
}
