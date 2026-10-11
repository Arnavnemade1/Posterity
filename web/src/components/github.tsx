import { CircleCheck, CircleDashed, CircleX, ExternalLink, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cx } from '@/components/ui';
import type { GitHubEvent } from '@/lib/data';
import { timeAgo } from '@/lib/format';

const PASSED = new Set(['success', 'neutral', 'skipped']);

/** The icon, colour and one-line description of an event. */
function describe(e: GitHubEvent): { icon: LucideIcon; tone: string; label: string } {
  if (e.kind === 'pull_request') {
    const label = `#${e.number ?? '?'} ${e.title ?? 'Pull request'}`;
    if (e.action === 'merged') return { icon: GitMerge, tone: 'text-review', label };
    if (e.action === 'closed') return { icon: GitPullRequestClosed, tone: 'text-faint', label };
    return { icon: GitPullRequest, tone: 'text-done', label };
  }
  if (e.kind === 'ci') {
    const conclusion = (e.conclusion ?? 'unknown').replaceAll('_', ' ');
    const label = `CI ${conclusion}${e.title ? ` · ${e.title}` : ''}`;
    if (e.conclusion && PASSED.has(e.conclusion)) return { icon: CircleCheck, tone: 'text-done', label };
    if (e.conclusion === 'cancelled' || !e.conclusion) return { icon: CircleDashed, tone: 'text-faint', label };
    return { icon: CircleX, tone: 'text-danger', label };
  }
  return { icon: GitCommitHorizontal, tone: 'text-muted', label: e.title ? `Pushed: ${e.title}` : 'Pushed' };
}

const ACTION: Record<string, string> = {
  opened: 'opened',
  reopened: 'reopened',
  closed: 'closed',
  merged: 'merged',
  synchronize: 'updated',
  ready_for_review: 'ready for review',
  edited: 'edited',
};

/** Pull requests, CI runs and pushes, newest first. Pass `tasks` to name the task each event attached to. */
export function GitHubEvents({ events, now, tasks }: { events: GitHubEvent[]; now: number; tasks?: Map<string, { key: string; title: string }> }) {
  return (
    <ul className="-mx-2 space-y-0.5">
      {events.map((e) => {
        const { icon: Icon, tone, label } = describe(e);
        const task = e.task_id ? tasks?.get(e.task_id) : undefined;
        return (
          <li key={e.id} className="flex gap-3 px-2 py-2 transition-colors hover:bg-fg/[0.025]">
            <Icon className={cx('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
            {/* w-0: the one-line labels truncate instead of widening the column they sit in. */}
            <span className="w-0 min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="group flex min-w-0 flex-1 items-center gap-1 text-[13px] text-text">
                    <span className="truncate group-hover:underline">{label}</span>
                    <ExternalLink className="size-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text">{label}</span>
                )}
                {task && (
                  <Link
                    href={`/tasks/${e.task_id}`}
                    title={task.title}
                    className="max-w-[10ch] shrink-0 truncate rounded-md bg-fg/[0.04] px-1.5 py-px font-mono text-[10.5px] text-muted ring-1 ring-inset ring-line transition-colors hover:text-text"
                  >
                    {task.key}
                  </Link>
                )}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11.5px] text-faint">
                {e.kind === 'pull_request' && ACTION[e.action] && <span className="shrink-0">{ACTION[e.action]} ·</span>}
                {e.branch && <span className="min-w-0 truncate font-mono text-[11px]">{e.branch}</span>}
                {e.actor && <span className="shrink-0">· {e.actor}</span>}
                <span className="shrink-0">· {timeAgo(e.created_at, now)}</span>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "owner/name" from a GitHub URL, to prefill the connect form. */
export function repoFromUrl(url: string | null | undefined): string | null {
  const match = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
}
