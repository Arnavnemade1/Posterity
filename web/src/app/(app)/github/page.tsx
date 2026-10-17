import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getGitHubApp, getGitHubOverview } from '@/lib/github';
import { getUser } from '@/lib/supabase/server';
import { GitHubView } from './view';

export const metadata: Metadata = { title: 'GitHub', robots: { index: false } };

export default async function GitHubPage({ searchParams }: { searchParams: Promise<{ github?: string; github_error?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login?next=/github');
  const [app, overview, params] = await Promise.all([getGitHubApp(), getGitHubOverview(), searchParams]);
  const notice = params.github_error
    ? { ok: false, message: params.github_error.slice(0, 300) }
    : params.github
      ? { ok: true, message: `Connected ${params.github.slice(0, 200)}. Open a workspace to link it to a repository.` }
      : null;
  return <GitHubView app={app} overview={overview} notice={notice} userId={user.id} />;
}
