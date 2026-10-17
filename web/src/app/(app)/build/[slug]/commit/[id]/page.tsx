import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DiffView } from '@/components/code/diff-view';
import { GitHubMark } from '@/components/code/github';
import { shortSha } from '@/components/code/parts';
import { Segmented } from '@/components/ui';
import { diffCommits, getCommit, getWorkspace } from '@/lib/code';
import { timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

export default async function CommitPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ slug, id }, { view }] = await Promise.all([params, searchParams]);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  const commit = await getCommit(ws.id, id);
  if (!commit) notFound();
  const mode = view === 'split' ? 'split' : 'unified';
  const { files, total } = await diffCommits(commit.parents[0] ?? null, commit.id);
  const now = requestTime();
  const base = `/build/${ws.slug}`;
  const [first, ...rest] = commit.message.split('\n');
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);

  return (
    <div>
      <header className="border-b border-line px-4 py-5">
        <h1 className="break-words text-[20px] font-bold leading-snug tracking-[-0.01em] text-text">{first}</h1>
        {rest.join('\n').trim() && <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-muted">{rest.join('\n').trim()}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-faint">
          {commit.author ? (
            <Link href={`/agents/${commit.author.handle}`} className="text-muted hover:text-text">
              @{commit.author.handle}
            </Link>
          ) : commit.origin?.provider === 'github' ? (
            <span className="inline-flex items-center gap-1.5">
              <GitHubMark className="size-3.5" />
              {commit.origin.imported ? 'Imported from GitHub' : 'From GitHub'}
              {commit.origin.authors?.length ? <span>· {commit.origin.authors.slice(0, 3).join(', ')}</span> : null}
              {commit.origin.url && commit.origin.sha ? (
                <a href={commit.origin.url} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-muted hover:text-text hover:underline">
                  {commit.origin.sha.slice(0, 7)}
                </a>
              ) : null}
            </span>
          ) : (
            <span>The system</span>
          )}
          <span>{timeAgo(commit.created_at, now)}</span>
          <span className="font-mono text-[12px]" title={commit.id}>
            {shortSha(commit.id)}
          </span>
          {commit.parents.map((p) => (
            <Link key={p} href={`${base}/commit/${p.slice(0, 12)}`} className="font-mono text-[12px] hover:text-text">
              parent {shortSha(p)}
            </Link>
          ))}
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-[13px] text-faint">
          {total} file{total === 1 ? '' : 's'} changed · <span className="text-done">+{added}</span> <span className="text-danger">−{removed}</span>
        </p>
        <Segmented
          label="Diff view"
          items={[
            { href: '?view=unified', label: 'Unified', active: mode === 'unified' },
            { href: '?view=split', label: 'Split', active: mode === 'split' },
          ]}
        />
      </div>
      <div className="p-4">
        {files.length ? <DiffView files={files} mode={mode} now={now} /> : <p className="text-[14px] text-faint">This commit changed no files.</p>}
      </div>
    </div>
  );
}
