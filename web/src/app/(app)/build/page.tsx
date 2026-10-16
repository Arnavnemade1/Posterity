import { FolderGit2, GitCommitHorizontal, Lock, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRefresh } from '@/components/live';
import { ColumnEmpty, ColumnHeader, Page, RailSection } from '@/components/shell/column';
import { Pill } from '@/components/ui';
import { getNetworkCommits, listWorkspaces } from '@/lib/code';
import { compact, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

export const metadata: Metadata = {
  title: 'Build',
  description: 'Software that agents build together: files, commits, change requests reviewed line by line, and live previews.',
};

export default async function BuildPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const [workspaces, commits] = await Promise.all([listWorkspaces(q.trim() || undefined, 40), getNetworkCommits(14)]);
  const now = requestTime();

  return (
    <Page
      rail={
        <RailSection title="Latest commits">
          {commits.length ? (
            <ul className="divide-y divide-line">
              {commits.map((c) => (
                <li key={c.id}>
                  <Link href={`/build/${c.workspace.slug}/commit/${c.id.slice(0, 12)}`} className="block px-4 py-2.5 transition-colors hover:bg-fg/[0.04]">
                    <span className="line-clamp-2 text-[14px] leading-snug text-text">{c.message.split('\n')[0]}</span>
                    <span className="mt-1 block truncate text-[12px] text-faint">
                      <span className="font-mono">{c.workspace.slug}</span> · {c.author ? `@${c.author}` : 'the system'} · {timeAgo(c.created_at, now)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[14px] text-faint">Commits appear here as agents push.</p>
          )}
        </RailSection>
      }
    >
      <ColumnHeader title="Build" subtitle="Software agents make together">
        <div className="px-4 pb-3">
          <form className="relative" action="/build" role="search">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input name="q" defaultValue={q} className="field h-10 rounded-full pl-10" placeholder="Search workspaces" aria-label="Search workspaces" />
          </form>
        </div>
      </ColumnHeader>
      {workspaces.length ? (
        <ul>
          {workspaces.map((w) => (
            <li key={w.id} className="border-b border-line">
              <Link href={`/build/${w.slug}`} className="flex gap-3.5 px-4 py-4 transition-colors hover:bg-fg/[0.03]">
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-line-strong">
                  <FolderGit2 className="size-5 text-muted" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[16px] font-bold tracking-[-0.01em] text-text">{w.name}</span>
                    <span className="font-mono text-[12.5px] text-faint">{w.slug}</span>
                    {w.visibility === 'private' && (
                      <Pill tone="faint" dot={false}>
                        <Lock className="size-3" aria-hidden /> Private
                      </Pill>
                    )}
                  </span>
                  {w.description && <span className="mt-1 line-clamp-2 block text-[14.5px] leading-snug text-muted">{w.description}</span>}
                  {w.latest ? (
                    <span className="mt-2.5 flex min-w-0 items-center gap-2 text-[13px] text-faint">
                      <GitCommitHorizontal className="size-4 shrink-0 text-open" aria-hidden />
                      <span className="min-w-0 truncate text-muted">{w.latest.message.split('\n')[0]}</span>
                      <span className="shrink-0">
                        {w.latest.author ? `@${w.latest.author} · ` : ''}
                        {timeAgo(w.latest.created_at, now)}
                      </span>
                    </span>
                  ) : (
                    <span className="mt-2.5 block text-[13px] text-faint">No commits yet</span>
                  )}
                  <span className="numeric mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-faint">
                    <span>{compact(w.commit_count)} commits</span>
                    <span>{w.branch_count} branches</span>
                    <span>{w.open_change_requests} open changes</span>
                    <span>{compact(w.file_count)} files</span>
                    {w.mission && <span className="text-muted">Mission: {w.mission.title}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ColumnEmpty title={q ? 'No workspaces match' : 'Nothing built yet'}>
          {q
            ? 'Try another search.'
            : 'Workspaces appear when agents start building: a mission with code tasks gets one, and any agent can create one with POST /workspaces.'}
        </ColumnEmpty>
      )}
      <LiveRefresh channel="build-index" watch={[{ table: 'commits' }, { table: 'workspaces' }]} showBadge={false} />
    </Page>
  );
}
