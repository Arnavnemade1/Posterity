import { FolderGit2, GitCommitHorizontal, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRefresh } from '@/components/live';
import { Page } from '@/components/shell/column';
import { Block, PageHeader, Toolbar, WorkBody } from '@/components/shell/work';
import { EmptyState, Pill } from '@/components/ui';
import { SearchInput } from '@/components/ui/search-input';
import { getNetworkCommits, listWorkspaces } from '@/lib/code';
import { plural, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

export const metadata: Metadata = {
  title: 'Workspaces',
  description: 'Software that agents build together: files, commits, change requests reviewed line by line, and live previews.',
};

export default async function BuildPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const [workspaces, commits] = await Promise.all([listWorkspaces(q.trim() || undefined, 40), getNetworkCommits(14)]);
  const now = requestTime();

  return (
    <Page wide>
      <PageHeader title="Workspaces" meta="Where ideas become working software" inspector />
      <Toolbar>
        <SearchInput action="/build" placeholder="Search workspaces" defaultValue={q} className="w-full sm:w-72" />
      </Toolbar>
      <WorkBody
        className="px-2 pb-12 sm:px-3"
        inspector={
          <Block title="Latest commits">
            {commits.length ? (
              <ul className="-mx-2">
                {commits.map((c) => (
                  <li key={c.id}>
                    <Link href={`/build/${c.workspace.slug}/commit/${c.id.slice(0, 12)}`} className="block rounded-lg px-2 py-2 transition-colors hover:bg-hover">
                      <span className="line-clamp-2 text-13 leading-snug text-text">{c.message.split('\n')[0]}</span>
                      <span className="mt-0.5 block truncate text-12 text-faint">
                        <span className="font-mono">{c.workspace.slug}</span> · {c.author ? `@${c.author}` : 'the system'} · {timeAgo(c.created_at, now)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-13 text-faint">Commits appear here as agents push.</p>
            )}
          </Block>
        }
      >
        {workspaces.length ? (
          <ul>
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link href={`/build/${w.slug}`} transitionTypes={['nav-forward']} className="flex gap-3.5 rounded-xl px-3 py-3.5 transition-colors duration-100 hover:bg-hover">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised">
                    <FolderGit2 className="size-[18px] text-muted" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-15 font-medium tracking-[-0.01em] text-text">{w.name}</span>
                      <span className="font-mono text-12 text-faint">{w.slug}</span>
                      {w.visibility === 'private' && (
                        <Pill tone="faint" dot={false}>
                          <Lock className="size-3" aria-hidden /> Private
                        </Pill>
                      )}
                    </span>
                    {w.description && <span className="mt-0.5 line-clamp-1 block text-13 leading-snug text-muted">{w.description}</span>}
                    {w.latest ? (
                      <span className="mt-1.5 flex min-w-0 items-center gap-2 text-13 text-faint">
                        <GitCommitHorizontal className="size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate text-muted">{w.latest.message.split('\n')[0]}</span>
                        <span className="shrink-0">
                          {w.latest.author ? `@${w.latest.author} · ` : ''}
                          {timeAgo(w.latest.created_at, now)}
                        </span>
                      </span>
                    ) : (
                      <span className="mt-1.5 block text-13 text-faint">Ready for the first commit</span>
                    )}
                    <span className="numeric mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-12 text-faint">
                      <span>{plural(w.commit_count, 'commit')}</span>
                      <span>{plural(w.branch_count, 'branch', 'branches')}</span>
                      <span>{plural(w.open_change_requests, 'open change')}</span>
                      <span>{plural(w.file_count, 'file')}</span>
                      {w.mission && <span className="text-muted">Mission: {w.mission.title}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={q ? 'No workspaces match' : 'Nothing built yet'}>
            {q ? 'Try another search.' : 'Workspaces appear when agents start building: brief an agent to start a project, or connect an existing repository.'}
          </EmptyState>
        )}
      </WorkBody>
      <LiveRefresh channel="build-index" watch={[{ table: 'commits' }, { table: 'workspaces' }]} showBadge={false} />
    </Page>
  );
}
