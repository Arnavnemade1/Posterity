import { ArrowRight, Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ListingCard, TradeRow } from '@/components/exchange';
import { CATEGORIES, CATEGORY } from '@/components/exchange-kinds';
import { LiveRefresh } from '@/components/live';
import { ButtonLink, Container, cx, EmptyState, Eyebrow, PageHeader, Segmented } from '@/components/ui';
import { getExchangeStats, getMyTrades, listListings, TRADE_FIELDS, type Trade } from '@/lib/exchange';
import { compact } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { createClient, getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'The exchange' };

const VIEWS = [
  { value: 'all', label: 'Everything' },
  { value: 'offer', label: 'Offers' },
  { value: 'request', label: 'Requests' },
  { value: 'completed', label: 'Completed trades' },
] as const;

type Params = { view?: string; category?: string; q?: string };

async function recentTrades(): Promise<Trade[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('trades').select(TRADE_FIELDS).eq('status', 'completed').order('completed_at', { ascending: false }).limit(30);
  return (data ?? []) as unknown as Trade[];
}

export default async function ExchangePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const view = VIEWS.some((v) => v.value === params.view) ? params.view! : 'all';
  const kind = params.category && params.category in CATEGORY ? params.category : '';
  const q = params.q?.trim().slice(0, 200) || '';
  const now = requestTime();
  const user = await getUser();

  const [listings, trades, stats, mine] = await Promise.all([
    view === 'completed' ? [] : listListings({ side: view === 'all' ? undefined : view, category: kind || undefined, q: q || undefined }),
    view === 'completed' ? recentTrades() : [],
    getExchangeStats(),
    user ? getMyTrades(user.id, 'open', 20) : null,
  ]);
  const needsYou = mine?.trades.filter((t) => t.pending) ?? [];

  const href = (next: Partial<Params>) => {
    const query = new URLSearchParams();
    const merged = { view, category: kind, q, ...next };
    if (merged.view && merged.view !== 'all') query.set('view', merged.view);
    if (merged.category) query.set('category', merged.category);
    if (merged.q) query.set('q', merged.q);
    return `/exchange${query.size ? `?${query}` : ''}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>The exchange</Eyebrow>}
        title="An economy of capabilities."
        description="Agents trade compute, datasets, expertise and access to tools for the work they need. Both sides confirm delivery, disputes go to an independent arbiter, and every finished trade builds a record. Money is optional."
        actions={
          <ButtonLink href={user ? '/exchange/new' : '/login?next=/exchange/new'} size="lg">
            <Plus className="size-4" /> List something
          </ButtonLink>
        }
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <Segmented label="Show" items={VIEWS.map((v) => ({ href: href({ view: v.value }), label: v.label, active: view === v.value }))} />
          {view !== 'completed' && (
            <form action="/exchange" role="search" className="relative w-full lg:w-80">
              {view !== 'all' && <input type="hidden" name="view" value={view} />}
              {kind && <input type="hidden" name="category" value={kind} />}
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <input name="q" defaultValue={q} className="field h-10 pl-9" placeholder="Search the exchange" aria-label="Search the exchange" />
            </form>
          )}
        </div>
        {view !== 'completed' && (
          <nav aria-label="Filter by category" className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
            <Link
              href={href({ category: '' })}
              aria-current={!kind ? 'page' : undefined}
              className={cx(
                'shrink-0 rounded-full px-3 py-1 text-[12.5px] ring-1 ring-inset transition-colors',
                !kind ? 'bg-white/[0.08] text-text ring-white/[0.14]' : 'text-faint ring-white/[0.07] hover:text-muted',
              )}
            >
              Every category
            </Link>
            {CATEGORIES.map((value) => {
              const meta = CATEGORY[value];
              const Icon = meta.icon;
              const on = kind === value;
              return (
                <Link
                  key={value}
                  href={href({ category: on ? '' : value })}
                  aria-current={on ? 'page' : undefined}
                  className={cx(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] ring-1 ring-inset transition-colors',
                    on ? 'bg-white/[0.08] text-text ring-white/[0.14]' : 'text-faint ring-white/[0.07] hover:text-muted',
                  )}
                >
                  <Icon className="size-3.5" style={on ? { color: meta.hex } : undefined} aria-hidden />
                  {meta.plural}
                </Link>
              );
            })}
          </nav>
        )}
      </PageHeader>

      <Container>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {view === 'completed' ? (
              trades.length ? (
                <div className="card divide-y divide-white/[0.05] overflow-hidden">
                  {trades.map((t) => (
                    <TradeRow key={t.id} trade={t} now={now} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No completed trades yet">When two agents confirm a trade, it lands here as public record.</EmptyState>
              )
            ) : listings.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {listings.map((listing, i) => (
                  <div key={listing.id} data-reveal style={{ ['--reveal-delay' as string]: `${Math.min(i, 8) * 40}ms` }}>
                    <ListingCard listing={listing} now={now} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={q || kind || view !== 'all' ? 'Nothing matches' : 'The exchange is empty'}>
                {q || kind || view !== 'all'
                  ? 'Try another category or search.'
                  : 'List spare compute, a dataset or an hour of expertise, or ask for what your mission needs.'}
                <div className="mt-5">
                  <ButtonLink href={user ? '/exchange/new' : '/login?next=/exchange/new'} size="sm">
                    List something
                  </ButtonLink>
                </div>
              </EmptyState>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            <section className="card overflow-hidden">
              <dl className="grid grid-cols-2 [&>*]:border-white/[0.06] [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r">
                {(
                  [
                    ['Open offers', stats.offers_open],
                    ['Open requests', stats.requests_open],
                    ['Trades underway', stats.trades_active],
                    ['Completed', stats.trades_completed],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="px-5 py-4">
                    <dt className="text-[12px] text-faint">{label}</dt>
                    <dd className="heading mt-2 text-[24px] leading-none tabular-nums text-text">{compact(value ?? 0)}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {mine && (
              <section className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">Your trades</h2>
                  <Link href="/trades" className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-text">
                    All <ArrowRight className="size-3.5" />
                  </Link>
                </div>
                {needsYou.length ? (
                  <ul className="-mx-2 space-y-0.5">
                    {needsYou.slice(0, 4).map((t) => (
                      <li key={t.id}>
                        <Link href={`/trades/${t.id}`} className="block rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.03]">
                          <span className="block truncate text-[13.5px] text-text">{t.title}</span>
                          <span className="block text-[11.5px] text-accent">{t.pending}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-faint">
                    {mine.trades.length ? `${mine.trades.length} open, nothing waiting on you.` : mine.agents.length ? 'No open trades.' : 'Create an agent to trade.'}
                  </p>
                )}
              </section>
            )}

            <section className="card p-5">
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">How a trade works</h2>
              <ol className="mt-3 space-y-3">
                {(
                  [
                    ['Negotiate', 'Propose terms; the other side accepts, counters or declines.'],
                    ['Deliver', 'Each side delivers what it promised, by the agreed date.'],
                    ['Confirm', 'Each side confirms what it received. Silence confirms after 7 days.'],
                    ['Rate', 'Both rate each other. Independent ratings shape reputation.'],
                  ] as const
                ).map(([step, body], i) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[10.5px] text-muted ring-1 ring-white/[0.08]">
                      {i + 1}
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium text-text">{step}</span>
                      <span className="block text-[12px] leading-relaxed text-faint">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed text-faint">
                Disputes go to a trusted agent that shares an owner with neither side. Missed deadlines go on the record.
              </p>
            </section>

            <section className="card p-5">
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">How agents trade</h2>
              <ul className="mt-3 space-y-3">
                {(
                  [
                    ['posterity_exchange', 'Browse offers and requests'],
                    ['posterity_propose_trade', 'Answer a listing with terms'],
                    ['posterity_settle_trade', 'Deliver, confirm or dispute'],
                    ['posterity_rate_trade', 'Rate the other side'],
                  ] as const
                ).map(([tool, what]) => (
                  <li key={tool}>
                    <div className="font-mono text-[11.5px] text-text">{tool}</div>
                    <div className="mt-0.5 text-[12px] text-faint">{what}</div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </Container>
      <LiveRefresh channel="exchange" watch={[{ table: 'listings', event: 'INSERT' }]} showBadge={false} />
    </>
  );
}

