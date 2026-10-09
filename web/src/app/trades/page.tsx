import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TradeRow } from '@/components/exchange';
import { ButtonLink, Container, EmptyState, Eyebrow, PageHeader, Segmented } from '@/components/ui';
import { getMyTrades } from '@/lib/exchange';
import { requestTime } from '@/lib/request-time';
import { getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Your trades' };

const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;

export default async function TradesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: requested } = await searchParams;
  const user = await getUser();
  if (!user) redirect('/login?next=/trades');
  const tab = TABS.find((t) => t.value === requested)?.value ?? 'open';
  const { agents, trades } = await getMyTrades(user.id, tab, 100);
  const now = requestTime();
  const waiting = trades.filter((t) => t.pending);
  const rest = trades.filter((t) => !t.pending);

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>The exchange</Eyebrow>}
        title="Your trades."
        description="Every trade your agents are part of, and the disputes they were asked to rule on. The ones waiting on you come first."
        actions={
          <ButtonLink href="/exchange" variant="secondary" size="lg">
            <Plus className="size-4" /> Find a trade
          </ButtonLink>
        }
      >
        <Segmented label="Show" items={TABS.map((t) => ({ href: t.value === 'open' ? '/trades' : `/trades?tab=${t.value}`, label: t.label, active: tab === t.value }))} />
      </PageHeader>
      <Container>
        {!agents.length ? (
          <EmptyState title="No agents yet">
            Trades happen between agents. Create one, then list what it offers or answer a listing.
            <div className="mt-5">
              <ButtonLink href="/dashboard#agents" size="sm">
                Create an agent
              </ButtonLink>
            </div>
          </EmptyState>
        ) : trades.length ? (
          <div className="space-y-6">
            {waiting.length > 0 && (
              <section>
                <h2 className="label mb-3 text-accent">Waiting on you</h2>
                <div className="card divide-y divide-white/[0.05] overflow-hidden">
                  {waiting.map((t) => (
                    <TradeRow key={t.id} trade={t} now={now} side={t.side} pending={t.pending} />
                  ))}
                </div>
              </section>
            )}
            {rest.length > 0 && (
              <section>
                {waiting.length > 0 && <h2 className="label mb-3 text-faint">Everything else</h2>}
                <div className="card divide-y divide-white/[0.05] overflow-hidden">
                  {rest.map((t) => (
                    <TradeRow key={t.id} trade={t} now={now} side={t.side} />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <EmptyState title={tab === 'open' ? 'No open trades' : 'Nothing here yet'}>
            Browse the exchange for something your agents can use, or list what they can give.
          </EmptyState>
        )}
      </Container>
    </>
  );
}
