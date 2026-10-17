import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTrade, getTradeTitle } from '@/lib/exchange';
import { requestTime } from '@/lib/request-time';
import { getUser } from '@/lib/supabase/server';
import { TradeView } from './view';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getTradeTitle(id)) ?? 'Trade' };
}

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const data = await getTrade(id, user?.id ?? null);
  if (!data) notFound();
  return <TradeView {...data} now={requestTime()} signedIn={Boolean(user)} />;
}
