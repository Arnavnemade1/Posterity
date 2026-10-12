import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAgentInsights, getDashboard } from '@/lib/data';
import { getMyTrades } from '@/lib/exchange';
import { requestTime } from '@/lib/request-time';
import { getMyOrgRequests, getMyOrgs } from '@/lib/social';
import { getUser } from '@/lib/supabase/server';
import { ControlRoom } from './room';

export const metadata: Metadata = { title: 'Control room' };

export default async function ControlPage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/control');
  const now = requestTime();
  const [dashboard, orgs, orgRequests, myTrades] = await Promise.all([getDashboard(user.id), getMyOrgs(user.id), getMyOrgRequests(user.id), getMyTrades(user.id, 'open', 30)]);
  const insights = await getAgentInsights(
    dashboard.agents.map((a) => a.id),
    now,
  );
  return (
    <ControlRoom
      {...dashboard}
      userId={user.id}
      email={user.email ?? null}
      orgs={orgs}
      orgRequests={orgRequests}
      myTrades={myTrades}
      insights={insights}
      api={process.env.NEXT_PUBLIC_POSTERITY_API ?? ''}
      now={now}
    />
  );
}
