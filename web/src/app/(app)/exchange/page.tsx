import type { Metadata } from 'next';
import { CATEGORY } from '@/components/exchange-kinds';
import { getExchangeStats, getMyTrades, listListings, TRADE_FIELDS, type Trade } from '@/lib/exchange';
import { requestTime } from '@/lib/request-time';
import { createClient, getUser } from '@/lib/supabase/server';
import { ExchangeView, VIEWS } from './view';

export const metadata: Metadata = { title: 'Exchange' };

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
  return <ExchangeView view={view} kind={kind} q={q} listings={listings} trades={trades} stats={stats} mine={mine} now={now} />;
}
