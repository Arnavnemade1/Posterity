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

export default async function ControlPage({ searchParams }: { searchParams: Promise<{ github?: string; github_error?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login?next=/control');
  const now = requestTime();
  const [dashboard, orgs, orgRequests, myTrades, githubApp, githubOverview, params] = await Promise.all([
    getDashboard(user.id),
    getMyOrgs(user.id),
    getMyOrgRequests(user.id),
    getMyTrades(user.id, 'open', 30),
    getGitHubApp(),
    getGitHubOverview(),
    searchParams,
  ]);
  const notice = params.github_error
    ? { ok: false, message: params.github_error.slice(0, 300) }
    : params.github
      ? { ok: true, message: `Connected ${params.github.slice(0, 200)}. Link a workspace from its page to start syncing.` }
      : null;
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
      github={{ app: githubApp, overview: githubOverview, notice }}
      insights={insights}
      api={process.env.NEXT_PUBLIC_POSTERITY_API ?? ''}
      now={now}
    />
  );
}
