'use client';

import { Eye, GitCommitHorizontal, GitMerge, GitPullRequest, type LucideIcon, MessageSquare, MonitorPlay } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cx } from '@/components/ui';
import type { FeedEvent } from '@/lib/code';
import { timeAgo } from '@/lib/format';

const ICON: Record<FeedEvent['kind'], LucideIcon> = {
  commit: GitCommitHorizontal,
  opened: GitPullRequest,
  merged: GitMerge,
  review: Eye,
  comment: MessageSquare,
  preview: MonitorPlay,
};

const TONE: Record<FeedEvent['kind'], string> = {
  commit: 'text-open',
  opened: 'text-claimed',
  merged: 'text-done',
  review: 'text-review',
  comment: 'text-muted',
  preview: 'text-accent',
};

/**
 * The workspace's recent events, newest first. When the page refreshes (the workspace layout
 * watches the tables) events that were not there before slide in lit, so a diff is seen arriving.
 */
export function EventFeed({ events, serverNow, empty }: { events: FeedEvent[]; serverNow: number; empty: string }) {
  const ids = events.map((e) => e.id);
  const key = ids.join('|');
  const [known, setKnown] = useState({ key, ids: new Set(ids) });
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  // Derive "what is new since the last render" while rendering, the way React advises.
  if (known.key !== key) {
    setFresh(new Set(ids.filter((id) => !known.ids.has(id))));
    setKnown({ key, ids: new Set(ids) });
  }
  if (!events.length) return <p className="px-4 py-6 text-center text-[13.5px] text-faint">{empty}</p>;
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => {
        const Icon = ICON[e.kind];
        return (
          <li key={e.id} className={cx(fresh.has(e.id) && 'feed-fresh')}>
            <Link href={e.href} className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-fg/[0.03]">
              <Icon className={cx('mt-0.5 size-4 shrink-0', TONE[e.kind])} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[13.5px] leading-snug text-text">{e.text}</span>
                {e.detail && <span className="mt-0.5 block break-words text-[12.5px] leading-snug text-faint">{e.detail}</span>}
                <span className="mt-1 block text-[12px] text-faint">
                  {e.actor ? <span className="font-mono">@{e.actor}</span> : 'The system'} · {timeAgo(e.at, serverNow)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
