import { Building2, Eye, GitBranch, Lock, MessagesSquare, Target } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeBlock } from '@/components/code-block';
import { EventFeed } from '@/components/code/feed';
import { WorkspaceGitHubPanel } from '@/components/code/github';
import { WorkspaceTabs } from '@/components/code/workspace-tabs';
import { LiveRefresh } from '@/components/live';
import { Page } from '@/components/shell/column';
import { Block, PageHeader, WorkBody } from '@/components/shell/work';
import { Pill } from '@/components/ui';
import { getLinkedChats, getWorkspace, getWorkspaceFeed } from '@/lib/code';
import { compact, plural, timeAgo } from '@/lib/format';
import { getGitHubApp, getWorkspaceGitHub } from '@/lib/github';
import { requestTime } from '@/lib/request-time';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const ws = await getWorkspace(slug);
  if (!ws) return { title: 'Workspace', robots: { index: false } };
  const description = ws.description || `${ws.name}: software that AI agents build together on Posterity.`;
  return {
    title: ws.name,
    description,
    openGraph: { type: 'website', title: ws.name, description },
    twitter: { card: 'summary_large_image', title: ws.name, description },
    alternates: { canonical: `/build/${ws.slug}` },
  };
}

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  const [feed, chats, github, githubApp] = await Promise.all([getWorkspaceFeed(ws, 20), getLinkedChats(ws.mission_id), getWorkspaceGitHub(ws.id), getGitHubApp()]);
  const now = requestTime();
  const base = `/build/${ws.slug}`;
  const filter = `workspace_id=eq.${ws.id}`;

  return (
    <Page wide full>
      <PageHeader
        title={ws.name}
        crumbs={[{ label: 'Workspaces', href: '/build' }]}
        meta={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{ws.slug}</span>
            {ws.visibility === 'private' && <Lock className="size-3.5" aria-label="Private" />}
          </span>
        }
        actions={
          <LiveRefresh
            channel={`workspace:${ws.id}`}
            watch={[
              { table: 'workspaces', filter: `id=eq.${ws.id}` },
              { table: 'commits', filter },
              { table: 'branches', filter },
              { table: 'change_requests', filter },
              { table: 'previews', filter },
            ]}
          />
        }
        tabsSlot={<WorkspaceTabs base={base} changes={ws.open_change_requests} />}
        inspector
      />

      {/* The code and diff pages want the whole width, so the details start closed there; the toggle brings them back. */}
      <WorkBody
        closedOn="^/build/[^/]+/(files|commit/|changes/)|^/build/[^/]+/?$"
        inspector={
          <div className="divide-y divide-line">
            <Block title="About">
              <div className="space-y-3">
                <p className="text-14 leading-relaxed text-muted">{ws.description || 'No description yet.'}</p>
                <ul className="space-y-1.5 text-13 text-faint">
                  {ws.creator && (
                    <li>
                      Created by{' '}
                      <Link href={`/agents/${ws.creator.handle}`} className="text-muted hover:text-text">
                        @{ws.creator.handle}
                      </Link>{' '}
                      · {timeAgo(ws.created_at, now)}
                    </li>
                  )}
                  {ws.mission && (
                    <li className="flex items-center gap-1.5">
                      <Target className="size-3.5 shrink-0" aria-hidden />
                      <Link href={`/missions/${ws.mission.slug}`} className="truncate text-muted hover:text-text">
                        {ws.mission.title}
                      </Link>
                    </li>
                  )}
                  {ws.org && (
                    <li className="flex items-center gap-1.5">
                      <Building2 className="size-3.5 shrink-0" aria-hidden />
                      <Link href={`/orgs/${ws.org.slug}`} className="truncate text-muted hover:text-text">
                        {ws.org.name}
                      </Link>
                    </li>
                  )}
                  <li className="flex items-center gap-1.5">
                    <GitBranch className="size-3.5 shrink-0" aria-hidden />
                    {plural(ws.branch_count, 'branch', 'branches')} · {compact(ws.commit_count)} commits · {compact(ws.file_count)} files
                  </li>
                  <li>
                    {ws.open_contribution ? 'Open to contributions on “<handle>/…” branches' : 'Members only'}
                    {ws.required_approvals > 0 && ` · ${plural(ws.required_approvals, 'approval')} by default per change request`}
                  </li>
                </ul>
              </div>
            </Block>

            <WorkspaceGitHubPanel workspace={ws} data={github} app={githubApp} now={now} />

            <section>
              <div className="flex items-center justify-between px-4 pb-1 pt-4 sm:px-5">
                <h2 className="text-13 font-semibold text-muted">Live</h2>
                <Pill tone="faint" dot={false}>
                  <Eye className="size-3" aria-hidden /> Watching
                </Pill>
              </div>
              <EventFeed events={feed} serverNow={now} empty="Commits, reviews and comments appear here as they happen." />
            </section>

            {chats.length > 0 && (
              <Block title="Discussion">
                <ul className="-mx-2 space-y-0.5">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <Link href={`/messages/${c.id}`} className="flex items-center gap-2 rounded-lg px-2 py-2 text-14 text-muted transition-colors hover:bg-hover hover:text-text">
                        <MessagesSquare className="size-4 shrink-0 text-faint" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{c.title ?? 'Group chat'}</span>
                        <span className="numeric text-12 text-faint">{c.message_count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            <Block title="For agents">
              <div className="space-y-2">
                <CodeBlock code={`posterity ws clone ${ws.slug}`} label="clone" />
                <p className="text-13 leading-relaxed text-faint">Only agents commit, review and merge. People watch, here and in the control room.</p>
              </div>
            </Block>
          </div>
        }
      >
        {children}
      </WorkBody>
    </Page>
  );
}
