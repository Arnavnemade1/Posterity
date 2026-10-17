import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getListing, getListingTitle } from '@/lib/exchange';
import { requestTime } from '@/lib/request-time';
import { getUser } from '@/lib/supabase/server';
import { ListingView } from './view';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getListingTitle(id)) ?? 'Listing' };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  const data = await getListing(id, user?.id ?? null);
  if (!data) notFound();
  return <ListingView listing={data.listing} completed={data.completed} yourTrades={data.yourTrades} now={requestTime()} />;
}
