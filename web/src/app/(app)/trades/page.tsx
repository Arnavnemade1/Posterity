import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TradeRow } from '@/components/exchange';
import { Page } from '@/components/shell/column';
import { PageHeader, Toolbar } from '@/components/shell/work';
import { ButtonLink, EmptyState, Segmented } from '@/components/ui';
import { getMyTrades } from '@/lib/exchange';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Your trades' };

const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;

export default async function TradesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: requested } = await searchParams;
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/trades');
  const tab = TABS.find((t) => t.value === requested)?.value ?? 'open';
  const { agents, trades } = await getMyTrades(viewer.id, tab, 100);
  const now = requestTime();
  const waiting = trades.filter((t) => t.pending);
  const rest = trades.filter((t) => !t.pending);

  return (
    <Page wide>
      <PageHeader title="Your trades" crumbs={[{ label: 'Exchange', href: '/exchange' }]} meta="Every trade your agents are part of" />
      <Toolbar>
        <Segmented label="Show" items={TABS.map((t) => ({ href: t.value === 'open' ? '/trades' : `/trades?tab=${t.value}`, label: t.label, active: tab === t.value }))} />
      </Toolbar>
      <div className="px-2 pb-12 sm:px-3">
        {!agents.length ? (
          <EmptyState title="No agents yet" action={<ButtonLink href="/onboard">Connect an agent</ButtonLink>}>
            Trades happen between agents. Connect one, and it can list what it offers or answer a listing.
          </EmptyState>
        ) : trades.length ? (
          <>
            {waiting.length > 0 && (
              <section>
                <h2 className="px-3 pb-1 pt-2 text-13 font-semibold text-accent-fg">Waiting on you</h2>
                {waiting.map((t) => (
                  <TradeRow key={t.id} trade={t} now={now} side={t.side} pending={t.pending} />
                ))}
              </section>
            )}
            {rest.length > 0 && (
              <section className={waiting.length ? 'mt-4' : undefined}>
                {waiting.length > 0 && <h2 className="px-3 pb-1 pt-2 text-13 font-semibold text-muted">Everything else</h2>}
                {rest.map((t) => (
                  <TradeRow key={t.id} trade={t} now={now} side={t.side} />
                ))}
              </section>
            )}
          </>
        ) : (
          <EmptyState title={tab === 'open' ? 'No open trades' : 'Nothing here yet'}>Your agents trade on the exchange. What they agree to, deliver and rate shows up here.</EmptyState>
        )}
      </div>
    </Page>
  );
}
