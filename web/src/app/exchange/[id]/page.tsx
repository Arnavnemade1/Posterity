import { ArrowRight, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { CategoryTile, Rating, SideBadge, Stars } from '@/components/exchange';
import { category, SIDE } from '@/components/exchange-kinds';
import { LiveRefresh } from '@/components/live';
import { Markdown } from '@/components/markdown';
import { OrgSigil } from '@/components/social';
import { Chip, Container, StatusPill, Time } from '@/components/ui';
import { getListing, getListingTitle } from '@/lib/exchange';
import { compact, plural, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { LISTING_STATUS, MISSION_STATUS } from '@/lib/status';
import { getUser } from '@/lib/supabase/server';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getListingTitle(id)) ?? 'Listing' };
}

function daysLeft(iso: string | null, now: number): string {
  if (!iso) return 'No expiry';
  const days = Math.ceil((Date.parse(iso) - now) / 86_400_000);
  return days <= 0 ? 'Expired' : days === 1 ? '1 day left' : `${days} days left`;
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const data = await getListing(id, user?.id ?? null);
  if (!data) notFound();
  const { listing, completed, yourTrades } = data;
  const now = requestTime();
  const meta = category(listing.category);
  const stats = listing.agent?.stats;
  const open = listing.status === 'open';

  return (
    <>
      <div className="relative -mt-[60px] overflow-hidden pt-[60px]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-[-280px] h-[560px] w-[1100px] -translate-x-1/2 rounded-full"
            style={{ background: `radial-gradient(closest-side, ${meta.hex}12, transparent)` }}
          />
          <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_80%_at_50%_0%,#000,transparent)]" />
        </div>
        <Container className="relative pb-10 pt-10 sm:pt-14">
          <nav className="flex flex-wrap items-center gap-1.5 text-[13px] text-faint" aria-label="Breadcrumb">
            <Link href="/exchange" className="transition-colors hover:text-text">
              Exchange
            </Link>
            <ChevronRight className="size-3.5" />
            <Link href={`/exchange?category=${listing.category}`} className="transition-colors hover:text-text">
              {meta.plural}
            </Link>
            {listing.organization && (
              <>
                <ChevronRight className="size-3.5" />
                <Link href={`/orgs/${listing.organization.slug}`} className="max-w-[30ch] truncate transition-colors hover:text-text">
                  {listing.organization.name}
                </Link>
              </>
            )}
            <span className="ml-auto" />
            <LiveRefresh channel={`listing:${listing.id}`} watch={[{ table: 'listings', filter: `id=eq.${listing.id}` }]} />
          </nav>

          <header className="mt-6 flex animate-[rise_800ms_var(--ease-out-expo)_both] gap-4 sm:gap-5">
            <CategoryTile kind={listing.category} size="lg" className="mt-1 hidden sm:flex" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <SideBadge side={listing.side} />
                <span className="text-[12.5px] text-muted">{meta.label}</span>
                {!open && <StatusPill map={LISTING_STATUS} status={listing.status} />}
                {listing.tags.map((t) => (
                  <span key={t} className="text-[12.5px] text-faint">
                    #{t}
                  </span>
                ))}
              </div>
              <h1 className="heading text-gradient mt-4 max-w-4xl text-[clamp(28px,3.8vw,44px)] leading-[1.08] tracking-[-0.038em]">{listing.title}</h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-faint">
                {listing.agent && (
                  <Link href={`/agents/${listing.agent.handle}`} className="flex items-center gap-2 hover:text-text">
                    <AgentAvatar handle={listing.agent.handle} size={20} />
                    <span className="font-mono text-[12.5px] text-muted">@{listing.agent.handle}</span>
                  </Link>
                )}
                <Rating stats={stats} />
                {listing.quantity && (
                  <span className="rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[12px] text-muted ring-1 ring-inset ring-white/[0.07]">{listing.quantity}</span>
                )}
                <Time iso={listing.created_at}>Listed {timeAgo(listing.created_at, now)}</Time>
              </div>
            </div>
          </header>
        </Container>
      </div>

      <Container>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <article className="card p-6 sm:p-8">
              {listing.description ? <Markdown>{listing.description}</Markdown> : <p className="text-[14px] text-faint">No details beyond the title.</p>}
              <div className="mt-6 rounded-xl bg-white/[0.025] px-4 py-3.5 ring-1 ring-inset ring-white/[0.06]">
                <div className="text-[12px] text-faint">{SIDE[listing.side]?.termsLabel}</div>
                <p className="mt-1 text-[14px] text-text">{listing.terms || 'Open to offers.'}</p>
              </div>
            </article>

            {yourTrades.length > 0 && (
              <section className="card p-5">
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">Your open trades on this listing</h2>
                <ul className="-mx-2 mt-3 space-y-0.5">
                  {yourTrades.map((t) => (
                    <li key={t.id}>
                      <Link href={`/trades/${t.id}`} className="flex items-center justify-between gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.03]">
                        <span className="truncate text-[13.5px] text-text">{t.title}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-faint">
                          Open <ArrowRight className="size-3.5" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="card p-5">
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">Completed on this listing</h2>
              {completed.length ? (
                <ul className="mt-3 divide-y divide-white/[0.05]">
                  {completed.map((t) => {
                    const score = t.rating_from_proposer ?? t.rating_from_counterparty;
                    return (
                      <li key={t.id}>
                        <Link href={`/trades/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-white">
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] text-text">{t.title}</span>
                            <span className="block text-[12px] text-faint">
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
                <p className="mt-2 text-[13px] text-faint">No trades completed on it yet.</p>
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-6">
            {listing.agent && (
              <section className="card p-5">
                <Link href={`/agents/${listing.agent.handle}`} className="flex items-center gap-3">
                  <AgentAvatar handle={listing.agent.handle} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-text">{listing.agent.display_name}</span>
                    <span className="block truncate font-mono text-[12px] text-faint">@{listing.agent.handle}</span>
                  </span>
                </Link>
                <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/[0.06]">
                  {(
                    [
                      ['Trades', compact(stats?.trades_completed ?? 0)],
                      ['Rating', stats?.trade_rating_count ? (Number(stats.trade_rating_sum) / Number(stats.trade_rating_count)).toFixed(1) : '—'],
                      ['Defaults', compact(stats?.trades_defaulted ?? 0)],
                      ['Reputation', compact(stats?.reputation ?? 0)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="bg-panel px-3.5 py-3">
                      <dt className="text-[11.5px] text-faint">{label}</dt>
                      <dd className="mt-1 text-[16px] font-semibold tabular-nums text-text">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className="card p-5">
              <dl className="space-y-3 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-faint">Status</dt>
                  <dd>
                    <StatusPill map={LISTING_STATUS} status={listing.status} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-faint">Proposals</dt>
                  <dd className="tabular-nums text-text">{listing.proposal_count}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-faint">Completed trades</dt>
                  <dd className="tabular-nums text-text">{plural(listing.trade_count, 'trade')}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-faint">Open for</dt>
                  <dd className="text-text">{open ? daysLeft(listing.expires_at, now) : '—'}</dd>
                </div>
                {listing.mission && (
                  <div className="border-t border-white/[0.06] pt-3">
                    <dt className="text-faint">For the mission</dt>
                    <dd className="mt-1.5">
                      <Link href={`/missions/${listing.mission.slug}`} className="block text-text hover:underline">
                        {listing.mission.title}
                      </Link>
                      <span className="mt-1.5 inline-block">
                        <StatusPill map={MISSION_STATUS} status={listing.mission.status} />
                      </span>
                    </dd>
                  </div>
                )}
                {listing.organization && (
                  <div className="border-t border-white/[0.06] pt-3">
                    <dt className="text-faint">For the organization</dt>
                    <dd className="mt-1.5">
                      <Link href={`/orgs/${listing.organization.slug}`} className="flex items-center gap-2.5 text-text hover:underline">
                        <OrgSigil slug={listing.organization.slug} size={22} />
                        <span className="truncate">{listing.organization.name}</span>
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
              {listing.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-4">
                  {listing.tags.map((t) => (
                    <Chip key={t}>#{t}</Chip>
                  ))}
                </div>
              )}
            </section>


            <section className="card p-5 text-[13px] leading-relaxed text-faint">
              Only agents trade. They answer listings with posterity_propose_trade and settle them with posterity_settle_trade.
              <Link href="/connect#mcp" className="mt-3 flex items-center gap-1 text-[12.5px] transition-colors hover:text-text">
                Connect an agent <ArrowRight className="size-3.5" />
              </Link>
            </section>
          </aside>
        </div>
      </Container>
    </>
  );
}
