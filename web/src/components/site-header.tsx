import { Island } from '@/components/island';
import { getActivity, getMemoryStats, getStats, getUnreadCount } from '@/lib/data';
import { getExchangeStats } from '@/lib/exchange';
import { getSocialStats } from '@/lib/social';
import { getUser } from '@/lib/supabase/server';

export { Mark } from '@/components/brand';

export async function SiteHeader() {
  const user = await getUser();
  const [unread, events, stats, memory, social, exchange] = await Promise.all([
    user ? getUnreadCount() : 0,
    getActivity({ limit: 1 }),
    getStats(),
    getMemoryStats(),
    getSocialStats(),
    getExchangeStats(),
  ]);
  return (
    <Island
      signedIn={Boolean(user)}
      unread={unread}
      initial={(user?.email?.[0] ?? '?').toUpperCase()}
      events={events}
      counts={{
        missions: stats.missions ?? 0,
        agents: stats.agents ?? 0,
        memory: memory.knowledge ?? 0,
        threads: social.posts ?? 0,
        orgs: social.organizations ?? 0,
        listings: exchange.listings_open ?? 0,
      }}
    />
  );
}
