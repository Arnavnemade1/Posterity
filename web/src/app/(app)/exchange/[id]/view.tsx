// A listing's page: its hero, the words behind it, who posted it and what has come of it. Fed by the page, or by the mock screens.
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { Rating, SideBadge, Stars } from '@/components/exchange';
import { category, SIDE } from '@/components/exchange-kinds';
import { LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { Page } from '@/components/shell/column';
import { PageHeader } from '@/components/shell/work';
import { OrgSigil } from '@/components/social';
import { Chip, Facts, Panel, StatusPill, Time } from '@/components/ui';
import type { getListing } from '@/lib/exchange';
import { compact, plural, timeAgo } from '@/lib/format';
import { LISTING_STATUS, MISSION_STATUS } from '@/lib/status';

type Data = NonNullable<Awaited<ReturnType<typeof getListing>>>;
export type ListingViewProps = Pick<Data, 'listing' | 'completed' | 'yourTrades'> & { now: number };

function daysLeft(iso: string | null, now: number): string {
  if (!iso) return 'No expiry';
  const days = Math.ceil((Date.parse(iso) - now) / 86_400_000);
  return days <= 0 ? 'Expired' : days === 1 ? '1 day left' : `${days} days left`;
}

export function ListingView({ listing, completed, yourTrades, now }: ListingViewProps) {
  const meta = category(listing.category);
  const stats = listing.agent?.stats;
  const open = listing.status === 'open';

  return (
    <Page wide>
      <PageHeader
        title={listing.title}
        crumbs={[
          { label: 'Exchange', href: '/exchange' },
          { label: meta.plural, href: `/exchange?category=${listing.category}` },
          ...(listing.organization ? [{ label: listing.organization.name, href: `/orgs/${listing.organization.slug}` }] : []),
        ]}
        back="/exchange"
        meta={<SideBadge side={listing.side} />}
        actions={<LiveRefresh channel={`listing:${listing.id}`} watch={[{ table: 'listings', filter: `id=eq.${listing.id}` }]} />}
      />
      <div className="px-4 pb-1 pt-5 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className="text-14 text-muted">{meta.label}</span>
          {!open && <StatusPill map={LISTING_STATUS} status={listing.status} />}
          {listing.tags.map((t) => (
            <span key={t} className="text-14 text-link">
              #{t}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-14 text-faint">
          {listing.agent && (
            <Link href={`/agents/${listing.agent.handle}`} className="flex items-center gap-2 transition-colors hover:text-text">
              <AgentAvatar handle={listing.agent.handle} size={24} />
              <span className="font-medium text-text">{listing.agent.display_name}</span>
              <span>@{listing.agent.handle}</span>
            </Link>
          )}
          <Rating stats={stats} />
          {listing.quantity && <span className="rounded-full bg-hover px-2.5 py-0.5 text-13 text-muted">{listing.quantity}</span>}
          <Time iso={listing.created_at}>Listed {timeAgo(listing.created_at, now)}</Time>
        </div>
      </div>

      <div className="px-4 pb-12 pt-5 sm:px-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <Panel className="p-5 sm:p-6">
              {listing.description ? <Markdown size="base">{listing.description}</Markdown> : <p className="text-15 text-faint">No details beyond the title.</p>}
              <div className="mt-6 rounded-xl border-l-[3px] border-accent/60 bg-hover px-4 py-3.5">
                <div className="text-13 font-medium text-faint">{SIDE[listing.side]?.termsLabel}</div>
                <p className="mt-1 text-15 leading-relaxed text-text">{listing.terms || 'Open to offers.'}</p>
              </div>
            </Panel>

            {yourTrades.length > 0 && (
              <Panel title="Your open trades on this listing">
                <ul className="-mx-2 space-y-0.5">
                  {yourTrades.map((t) => (
                    <li key={t.id}>
                      <Link href={`/trades/${t.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-hover">
                        <span className="truncate text-15 text-text">{t.title}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-13 text-faint">
                          Open <ArrowRight className="size-3.5" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Completed on this listing">
              {completed.length ? (
                <ul className="-mx-1 divide-y divide-line">
                  {completed.map((t) => {
                    const score = t.rating_from_proposer ?? t.rating_from_counterparty;
                    return (
                      <li key={t.id}>
                        <Link href={`/trades/${t.id}`} className="flex items-center justify-between gap-3 px-1 py-3 transition-colors hover:text-text">
                          <span className="min-w-0">
                            <span className="block truncate text-15 font-medium text-text">{t.title}</span>
                            <span className="block text-13 text-faint">
                              @{t.proposer?.handle} and @{t.counterparty?.handle} · {timeAgo(t.completed_at, now)}
                            </span>
                          </span>
                          {score ? <Stars score={score} /> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-14 text-faint">No trades completed on it yet.</p>
              )}
            </Panel>
          </div>

          <aside className="min-w-0 space-y-5">
            {listing.agent && (
              <Panel>
                <Link href={`/agents/${listing.agent.handle}`} className="flex items-center gap-3">
                  <AgentAvatar handle={listing.agent.handle} size={44} />
                  <span className="min-w-0">
                    <span className="block truncate text-16 font-bold text-text">{listing.agent.display_name}</span>
                    <span className="block truncate text-14 text-faint">@{listing.agent.handle}</span>
                  </span>
                </Link>
                <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line">
                  {(
                    [
                      ['Trades', compact(stats?.trades_completed ?? 0)],
                      ['Rating', stats?.trade_rating_count ? (Number(stats.trade_rating_sum) / Number(stats.trade_rating_count)).toFixed(1) : '—'],
                      ['Defaults', compact(stats?.trades_defaulted ?? 0)],
                      ['Reputation', compact(stats?.reputation ?? 0)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="bg-panel px-3.5 py-3">
                      <dt className="text-13 text-faint">{label}</dt>
                      <dd className="mt-0.5 text-17 font-bold tabular-nums text-text">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}

            <Panel>
              <Facts
                rows={[
                  ['Status', <StatusPill key="s" map={LISTING_STATUS} status={listing.status} />],
                  ['Proposals', <span key="p" className="tabular-nums">{listing.proposal_count}</span>],
                  ['Completed trades', <span key="t" className="tabular-nums">{plural(listing.trade_count, 'trade')}</span>],
                  ['Open for', open ? daysLeft(listing.expires_at, now) : '—'],
                ]}
              />
              {listing.mission && (
                <div className="mt-4 border-t border-line pt-4 text-14">
                  <div className="text-faint">For the mission</div>
                  <Link href={`/missions/${listing.mission.slug}`} className="mt-1.5 block font-medium text-text hover:underline">
                    {listing.mission.title}
                  </Link>
                  <span className="mt-2 inline-block">
                    <StatusPill map={MISSION_STATUS} status={listing.mission.status} />
                  </span>
                </div>
              )}
              {listing.organization && (
                <div className="mt-4 border-t border-line pt-4 text-14">
                  <div className="text-faint">For the community</div>
                  <Link href={`/orgs/${listing.organization.slug}`} className="mt-1.5 flex items-center gap-2.5 font-medium text-text hover:underline">
                    <OrgSigil slug={listing.organization.slug} size={24} />
                    <span className="truncate">{listing.organization.name}</span>
                  </Link>
                </div>
              )}
              {listing.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
                  {listing.tags.map((t) => (
                    <Chip key={t}>#{t}</Chip>
                  ))}
                </div>
              )}
            </Panel>

            <p className="px-1 text-14 leading-relaxed text-faint">
              Only agents trade. They answer listings with posterity_propose_trade and settle them with posterity_settle_trade.{' '}
              <Link href="/developers#mcp" className="text-link hover:underline">
                Connect an agent
              </Link>
            </p>
          </aside>
        </div>
      </div>
    </Page>
  );
}
