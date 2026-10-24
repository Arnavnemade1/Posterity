import { GitCommitHorizontal } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FromGitHub } from '@/components/code/github';
import { RefMenu, shortSha } from '@/components/code/parts';
import { ColumnEmpty } from '@/components/shell/column';
import { getLog, getWorkspace, listBranches, resolveRef } from '@/lib/code';
import { timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

const PAGE = 30;

export default async function CommitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string; path?: string; page?: string }>;
}) {
  const [{ slug }, { ref, path, page }] = await Promise.all([params, searchParams]);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  const resolved = await resolveRef(ws, ref);
  if (!resolved) notFound();
  const index = Math.max(0, Math.min(500, Number.parseInt(page ?? '0', 10) || 0));
  const [branches, log] = await Promise.all([
    listBranches(ws.id),
    getLog(ws.slug, resolved.branch ?? resolved.commit, path ?? null, PAGE + 1, index * PAGE),
  ]);
  const now = requestTime();
  const base = `/build/${ws.slug}`;
  const commits = log?.commits.slice(0, PAGE) ?? [];
  const more = (log?.commits.length ?? 0) > PAGE;
  const query = (p: number) => {
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);
    if (path) params.set('path', path);
    if (p > 0) params.set('page', String(p));
    return `${base}/commits${params.size ? `?${params}` : ''}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <RefMenu base={`${base}/commits`} current={resolved.label} branches={branches} search={path ? `&path=${encodeURIComponent(path)}` : ''} />
        {path && (
          <span className="text-13 text-faint">
            Commits that changed <span className="font-mono text-muted">{path}</span>{' '}
            <Link href={query(0).split('?')[0] + (ref ? `?ref=${encodeURIComponent(ref)}` : '')} className="link-inline">
              Clear
            </Link>
          </span>
        )}
      </div>
      {commits.length ? (
        <ol className="divide-y divide-line">
          {commits.map((c) => {
            const s = c.stats ?? {};
            const [first, ...rest] = c.message.split('\n');
            return (
              <li key={c.id}>
                <Link href={`${base}/commit/${c.id.slice(0, 12)}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-hover">
                  <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-15 font-medium leading-snug text-text">{first}</span>
                    {rest.join('').trim() && <span className="mt-0.5 block truncate text-13 text-faint">{rest.join(' ').trim()}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-faint">
                      <span>{c.author ? <span>@{c.author}</span> : c.from_github ? <FromGitHub /> : 'The system'}</span>
                      <span>{timeAgo(c.created_at, now)}</span>
                      <span className="numeric">
                        {s.added ? <span className="text-done">+{s.added} </span> : null}
                        {s.modified ? <span className="text-claimed">~{s.modified} </span> : null}
                        {s.deleted ? <span className="text-danger">−{s.deleted}</span> : null}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-12 text-faint">{shortSha(c.id)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <ColumnEmpty title="No commits">{path ? 'No commit on this branch changed that file.' : 'Nothing has been committed here yet.'}</ColumnEmpty>
      )}
      {(index > 0 || more) && (
        <nav className="flex justify-between border-t border-line px-4 py-3 text-14" aria-label="Pages">
          {index > 0 ? (
            <Link href={query(index - 1)} className="link-inline">
              Newer
            </Link>
          ) : (
            <span />
          )}
          {more && (
            <Link href={query(index + 1)} className="link-inline">
              Older
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
