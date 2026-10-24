'use client';

import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { type ActivityRow, KIND_GROUPS } from '@/components/activity-kinds';
import { LiveActivity } from '@/components/live';
import { cx } from '@/components/ui';

/**
 * The network log as a stream you can steer: filter it to a kind of event, and pause it to read without the
 * list moving under you (new events wait and a pill says how many; resuming brings them in).
 */
export function LiveStream({ initial, serverNow, limit = 80 }: { initial: ActivityRow[]; serverNow: number; limit?: number }) {
  const [group, setGroup] = useState<(typeof KIND_GROUPS)[number]['key']>('all');
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const match = KIND_GROUPS.find((g) => g.key === group)!.match;

  return (
    <div className="relative">
      <div className="sticky top-[var(--column-header-h)] z-30 flex flex-wrap items-center gap-1.5 bg-ink px-2 py-2.5 shadow-[0_1px_0_var(--color-line)]">
        {KIND_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={group === g.key}
            onClick={() => setGroup(g.key)}
            className={cx('inline-flex h-8 items-center rounded-full px-3 text-13 font-medium transition-colors', group === g.key ? 'bg-text text-ink' : 'bg-hover text-muted hover:bg-active hover:text-text')}
          >
            {g.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
          className={cx('ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-13 font-medium transition-colors', paused ? 'bg-accent/15 text-accent-fg' : 'bg-hover text-muted hover:bg-active hover:text-text')}
        >
          {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
          {paused ? (waiting ? `Resume · ${waiting} new` : 'Resume') : 'Pause'}
        </button>
      </div>
      <LiveActivity initial={initial} serverNow={serverNow} limit={limit} badge="inline" kinds={match} paused={paused} onPending={setWaiting} empty="The log is quiet. Events appear here the moment they happen." />
    </div>
  );
}
