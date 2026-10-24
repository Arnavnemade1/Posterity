'use client';

import { liveRefreshScheduler } from '@/lib/refresh-scheduler';

import { Activity } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { type ActivityRow, activityHref, KIND_ICON, KIND_TONE } from '@/components/activity-kinds';
import { cx } from '@/components/ui';
import { timeAgo } from '@/lib/format';

// Realtime is fetched after the page is interactive, so supabase-js never weighs on first load.
const realtime = () => import('@/lib/supabase/client').then((m) => m.createClient());

export interface Watch {
  table:
    | 'activity'
    | 'missions'
    | 'tasks'
    | 'task_events'
    | 'submissions'
    | 'reviews'
    | 'mission_messages'
    | 'approvals'
    | 'notifications'
    | 'knowledge'
    | 'posts'
    | 'listings'
    | 'trades'
    | 'trade_events'
    | 'integration_events'
    | 'chat_messages'
    | 'conversations'
    | 'reposts'
    | 'friendships'
    | 'workspaces'
    | 'commits'
    | 'branches'
    | 'change_requests'
    | 'cr_reviews'
    | 'cr_comments'
    | 'cr_checks'
    | 'previews';
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE';
}

export function LiveBadge({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint" aria-live="polite">
      <span className={cx('size-1.5 rounded-full', live ? 'live-dot bg-done text-done' : 'bg-faint')} />
      <span className="text-13">{live ? 'Live' : 'Connecting'}</span>
    </span>
  );
}

/** Re-renders the server page whenever watched rows change. */
export function LiveRefresh({ channel, watch, showBadge = true }: { channel: string; watch: Watch[]; showBadge?: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const key = JSON.stringify(watch);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    const refresh = liveRefreshScheduler.subscribe(() => router.refresh());
    const onVisibility = () => liveRefreshScheduler.wake();
    document.addEventListener('visibilitychange', onVisibility);
    realtime().then((supabase) => {
      if (disposed) return;
      const subscription = supabase.channel(channel);
      for (const w of JSON.parse(key) as Watch[]) {
        subscription.on(
          'postgres_changes',
          w.filter
            ? { event: w.event ?? '*', schema: 'public', table: w.table, filter: w.filter }
            : { event: w.event ?? '*', schema: 'public', table: w.table },
          refresh.request,
        );
      }
      subscription.subscribe((status) => setLive(status === 'SUBSCRIBED'));
      stop = () => supabase.removeChannel(subscription);
    });
    return () => {
      disposed = true;
      refresh.dispose();
      document.removeEventListener('visibilitychange', onVisibility);
      stop?.();
    };
  }, [channel, key, router]);

  return showBadge ? <LiveBadge live={live} /> : null;
}

/** Activity stream that appends new events as they happen. */
export function LiveActivity({
  initial,
  missionId,
  serverNow,
  limit = 30,
  empty = 'Nothing has happened yet.',
  badge = 'inline',
  listClassName,
  kinds,
  paused = false,
  onPending,
}: {
  initial: ActivityRow[];
  missionId?: string;
  serverNow: number;
  limit?: number;
  empty?: string;
  /** 'corner' pins the live badge to the top-right of the nearest positioned container. */
  badge?: 'inline' | 'corner';
  /** Positioning for the list itself, e.g. to clip it inside a fixed-height card. */
  listClassName?: string;
  /** Show only these kinds of event (the stream still receives the rest, so changing the filter loses nothing). */
  kinds?: (kind: string) => boolean;
  /** While paused, new events wait out of sight; resuming adds them. */
  paused?: boolean;
  /** How many events are waiting, while paused. */
  onPending?: (count: number) => void;
}) {
  const [items, setItems] = useState(initial);
  const pausedRef = useRef(paused);
  const waiting = useRef<ActivityRow[]>([]);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const [now, setNow] = useState(serverNow);
  const [live, setLive] = useState(false);
  const onPendingRef = useRef(onPending);
  useEffect(() => {
    onPendingRef.current = onPending;
  });

  // Resuming brings in what arrived while paused.
  useEffect(() => {
    pausedRef.current = paused;
    if (paused || !waiting.current.length) return;
    const arrived = waiting.current;
    waiting.current = [];
    onPendingRef.current?.(0);
    setItems((prev) => [...arrived, ...prev.filter((p) => !arrived.some((a) => a.id === p.id))].slice(0, limit));
    setFresh((prev) => new Set([...prev, ...arrived.map((a) => a.id)].slice(-limit)));
    setNow(Date.now());
  }, [paused, limit]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    realtime().then((supabase) => {
      if (disposed) return;
      const channel = supabase
        .channel(`activity:${missionId ?? 'network'}`)
        .on(
          'postgres_changes',
          missionId
            ? { event: 'INSERT', schema: 'public', table: 'activity', filter: `mission_id=eq.${missionId}` }
            : { event: 'INSERT', schema: 'public', table: 'activity' },
          (payload) => {
            const row = payload.new as ActivityRow & { is_public?: boolean };
            if (row.is_public === false) return;
            if (pausedRef.current) {
              waiting.current = [row, ...waiting.current].slice(0, limit);
              onPendingRef.current?.(waiting.current.length);
              return;
            }
            setItems((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev].slice(0, limit)));
            setFresh((prev) => new Set([...prev, row.id].slice(-limit)));
            setNow(Date.now());
          },
        )
        .subscribe((status) => setLive(status === 'SUBSCRIBED'));
      stop = () => supabase.removeChannel(channel);
    });
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      disposed = true;
      clearInterval(tick);
      stop?.();
    };
  }, [missionId, limit]);

  const shown = kinds ? items.filter((item) => kinds(item.kind)) : items;

  return (
    <div>
      {badge === 'corner' ? (
        <div className="absolute right-5 top-[17px]">
          <LiveBadge live={live} />
        </div>
      ) : (
        <div className="mb-2 flex justify-end px-2">
          <LiveBadge live={live} />
        </div>
      )}
      {shown.length === 0 ? (
        <p className={cx('py-8 text-center text-sm text-faint', listClassName)}>{items.length ? 'Nothing of that kind in the latest events.' : empty}</p>
      ) : (
        <ol className={cx('relative', listClassName)}>
          <span className="absolute bottom-3 left-[59px] top-3 w-px bg-line" aria-hidden />
          {shown.map((item) => {
            const Icon = KIND_ICON[item.kind] ?? Activity;
            const href = activityHref(item);
            const body = (
              <>
                <time dateTime={item.created_at} className="numeric w-[38px] shrink-0 pt-[3px] text-right text-12 text-faint" title={new Date(item.created_at).toLocaleString('en-US')}>
                  {timeAgo(item.created_at, now).replace(' ago', '').replace('just now', 'now')}
                </time>
                <span className="relative z-10 mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink ring-1 ring-inset ring-line-strong">
                  <Icon className={cx('size-3', KIND_TONE[item.kind] ?? 'text-faint')} strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 pt-0.5 text-14 leading-snug text-muted transition-colors group-hover:text-text">{item.summary}</span>
              </>
            );
            return (
              <li key={item.id} className={cx(fresh.has(item.id) && 'animate-[rise_700ms_var(--ease-out-expo)_both]')}>
                {href ? (
                  <Link href={href} className="group flex items-start gap-3 px-2 py-2 transition-colors hover:bg-hover">
                    {body}
                  </Link>
                ) : (
                  <div className="group flex items-start gap-3 px-2 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
