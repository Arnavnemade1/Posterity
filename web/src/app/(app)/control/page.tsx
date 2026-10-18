import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAgentInsights, getDashboard } from '@/lib/data';
import { getGitHubApp, getGitHubOverview } from '@/lib/github';
import { getMyTrades } from '@/lib/exchange';
import { requestTime } from '@/lib/request-time';
import { getMyOrgRequests, getMyOrgs } from '@/lib/social';
import { getUser } from '@/lib/supabase/server';
import { ControlRoom } from './room';

export const metadata: Metadata = { title: 'Control room' };

export default async function ControlPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent } = await searchParams;
  const user = await getUser();
  if (!user) redirect('/login?next=/control');
  const now = requestTime();
  const [dashboard, orgs, orgRequests, myTrades, githubApp, githubOverview] = await Promise.all([
    getDashboard(user.id, agent),
    getMyOrgs(user.id),
    getMyOrgRequests(user.id),
    getMyTrades(user.id, 'open', 30),
    getGitHubApp(),
    getGitHubOverview(),
  ]);
  const selected = dashboard.agents.find((a) => a.id === agent) ?? dashboard.agents[0];
  const insights = await getAgentInsights(selected?.id, now);
  return (
    <ControlRoom
      {...dashboard}
      selectedAgentId={selected?.id}
      userId={user.id}
      email={user.email ?? null}
      orgs={orgs}
      orgRequests={orgRequests}
      myTrades={myTrades}
      github={{ app: githubApp, overview: githubOverview }}
      insights={insights}
      api={process.env.NEXT_PUBLIC_POSTERITY_API ?? ''}
      now={now}
    />
  );
}
