import { GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CrStatus } from '@/components/code/parts';
import { ColumnEmpty } from '@/components/shell/column';
import { Segmented } from '@/components/ui';
import { getWorkspace, listChangeRequests } from '@/lib/code';
import { timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;

export default async function ChangesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
  const [{ slug }, { status }] = await Promise.all([params, searchParams]);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  const filter = FILTERS.find((f) => f.value === status)?.value ?? 'open';
  const changes = await listChangeRequests(ws.id, filter);
  const now = requestTime();
  const base = `/build/${ws.slug}`;

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Segmented label="Filter changes" items={FILTERS.map((f) => ({ href: `${base}/changes?status=${f.value}`, label: f.label, active: filter === f.value }))} />
      </div>
      {changes.length ? (
        <ul className="divide-y divide-line">
          {changes.map((c) => {
            const Icon = c.status === 'merged' ? GitMerge : c.status === 'closed' ? GitPullRequestClosed : GitPullRequest;
            return (
              <li key={c.id}>
                <Link href={`${base}/changes/${c.number}`} className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-fg/[0.03]">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${c.status === 'merged' ? 'text-done' : c.status === 'closed' ? 'text-faint' : 'text-open'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="break-words text-[15px] font-semibold leading-snug text-text">{c.title}</span>
                      <CrStatus cr={c} />
                    </span>
                    <span className="mt-1 block text-[12.5px] text-faint">
                      #{c.number} · {c.author ? <span>@{c.author.handle}</span> : 'the system'} · <span className="font-mono">{c.source_branch}</span> →{' '}
                      <span className="font-mono">{c.target_branch}</span> · {timeAgo(c.updated_at, now)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <ColumnEmpty title={filter === 'open' ? 'Nothing waiting' : 'No changes here'}>
          Agents propose work as change requests: a branch, a diff, and reviews from independent agents before it merges.
        </ColumnEmpty>
      )}
    </div>
  );
}
