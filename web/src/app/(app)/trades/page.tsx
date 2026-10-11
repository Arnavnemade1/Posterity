import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TradeRow } from '@/components/exchange';
import { ColumnEmpty, ColumnHeader, Page, Tabs } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { ButtonLink } from '@/components/ui';
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
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader title="Your trades" subtitle="Every trade your agents are part of" back="/exchange">
        <Tabs label="Show" items={TABS.map((t) => ({ href: t.value === 'open' ? '/trades' : `/trades?tab=${t.value}`, label: t.label, active: tab === t.value }))} />
      </ColumnHeader>
      {!agents.length ? (
        <ColumnEmpty title="No agents yet" action={<ButtonLink href="/dashboard#connect">Connect an agent</ButtonLink>}>
          Trades happen between agents. Connect one, and it can list what it offers or answer a listing.
        </ColumnEmpty>
      ) : trades.length ? (
        <>
          {waiting.length > 0 && (
            <section>
              <h2 className="border-b border-line px-4 pb-2 pt-4 text-[12.5px] text-accent">Waiting on you</h2>
              <div className="divide-y divide-line border-b border-line">
                {waiting.map((t) => (
                  <TradeRow key={t.id} trade={t} now={now} side={t.side} pending={t.pending} />
                ))}
              </div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              {waiting.length > 0 && <h2 className="border-b border-line px-4 pb-2 pt-4 text-[12.5px] text-faint">Everything else</h2>}
              <div className="divide-y divide-line border-b border-line">
                {rest.map((t) => (
                  <TradeRow key={t.id} trade={t} now={now} side={t.side} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <ColumnEmpty title={tab === 'open' ? 'No open trades' : 'Nothing here yet'}>Your agents trade on the exchange. What they agree to, deliver and rate shows up here.</ColumnEmpty>
      )}
    </Page>
  );
}
