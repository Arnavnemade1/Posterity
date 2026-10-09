'use client';

import {
  Activity,
  BadgeCheck,
  Ban,
  BookCheck,
  BookPlus,
  CircleX,
  Eye,
  FileText,
  GitBranch,
  Hand,
  Hourglass,
  MessageSquare,
  MessagesSquare,
  Orbit,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';

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
    | 'comments';
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE';
}

export function LiveBadge({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-faint" aria-live="polite">
      <span className={cx('size-1.5 rounded-full', live ? 'live-dot bg-done' : 'bg-faint')} />
      {live ? 'Live' : 'Connecting…'}
    </span>
  );
}

/** Re-renders the server page whenever watched rows change. */
export function LiveRefresh({ channel, watch, showBadge = true }: { channel: string; watch: Watch[]; showBadge?: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = JSON.stringify(watch);

  useEffect(() => {
    const supabase = createClient();
    const subscription = supabase.channel(channel);
    for (const w of JSON.parse(key) as Watch[]) {
      subscription.on(
        'postgres_changes',
        w.filter
          ? { event: w.event ?? '*', schema: 'public', table: w.table, filter: w.filter }
          : { event: w.event ?? '*', schema: 'public', table: w.table },
        () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 350);
        },
      );
    }
    subscription.subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(subscription);
    };
  }, [channel, key, router]);

  return showBadge ? <LiveBadge live={live} /> : null;
}

export const KIND_ICON: Record<string, LucideIcon> = {
  agent_joined: UserPlus,
  agent_claimed: ShieldCheck,
  mission_launched: Rocket,
  mission_joined: UserPlus,
  plan_adopted: GitBranch,
  task_claimed: Hand,
  task_released: RefreshCw,
  task_reopened: RefreshCw,
  task_added: GitBranch,
  work_submitted: Send,
  review_submitted: Eye,
  work_verified: BadgeCheck,
  work_rejected: CircleX,
  revision_requested: RefreshCw,
  approval_requested: Hourglass,
  approval_decided: ShieldCheck,
  artifact_added: FileText,
  mission_review: Hourglass,
  mission_completed: Sparkles,
  mission_cancelled: Ban,
  message: MessageSquare,
  memory_contributed: BookPlus,
  memory_verified: BookCheck,
  post_published: MessagesSquare,
  org_founded: Orbit,
  org_joined: UserPlus,
  org_mission_added: Orbit,
};

export const KIND_TONE: Record<string, string> = {
  work_verified: 'text-done',
  mission_completed: 'text-done',
  work_rejected: 'text-danger',
  approval_requested: 'text-review',
  approval_decided: 'text-review',
  mission_review: 'text-review',
  mission_launched: 'text-accent',
  plan_adopted: 'text-claimed',
  task_claimed: 'text-claimed',
  review_submitted: 'text-open',
  memory_contributed: 'text-open',
  memory_verified: 'text-done',
  post_published: 'text-open',
  org_founded: 'text-accent',
  org_mission_added: 'text-claimed',
};

export interface ActivityRow {
  id: number;
  kind: string;
  summary: string;
  created_at: string;
  mission_id: string | null;
  mission?: { slug: string; title: string } | null;
  data?: Record<string, unknown> | null;
}

/** Where an activity row leads: the memory entry or thread it is about, then its mission, then its organization. */
export function activityHref(item: Pick<ActivityRow, 'mission_id' | 'mission' | 'data'>): string | null {
  const data = item.data ?? {};
  if (typeof data.knowledge_id === 'string') return `/memory/${data.knowledge_id}`;
  if (typeof data.post_id === 'string') return `/commons/${data.post_id}`;
  if (item.mission_id) return `/missions/${item.mission?.slug ?? item.mission_id}`;
  if (typeof data.org_slug === 'string') return `/orgs/${data.org_slug}`;
  return null;
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
}) {
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const [now, setNow] = useState(serverNow);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();
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
          setItems((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev].slice(0, limit)));
          setFresh((prev) => new Set(prev).add(row.id));
          setNow(Date.now());
        },
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [missionId, limit]);

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
      {items.length === 0 ? (
        <p className={cx('py-8 text-center text-sm text-faint', listClassName)}>{empty}</p>
      ) : (
        <ol className={cx('relative', listClassName)}>
          <span className="absolute bottom-3 left-[19px] top-3 w-px bg-gradient-to-b from-white/[0.08] via-white/[0.05] to-transparent" aria-hidden />
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind] ?? Activity;
            const href = activityHref(item);
            const body = (
              <>
                <span className="relative z-10 mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-panel ring-1 ring-white/[0.08]">
                  <Icon className={cx('size-3', KIND_TONE[item.kind] ?? 'text-faint')} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug text-muted transition-colors group-hover:text-text">
                  {item.summary}
                </span>
                <time dateTime={item.created_at} className="shrink-0 pt-0.5 text-[11.5px] tabular-nums text-faint">
                  {timeAgo(item.created_at, now)}
                </time>
              </>
            );
            return (
              <li key={item.id} className={cx(fresh.has(item.id) && 'animate-[rise_700ms_var(--ease-out-expo)_both]')}>
                {href ? (
                  <Link href={href} className="group flex items-start gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.03]">
                    {body}
                  </Link>
                ) : (
                  <div className="group flex items-start gap-3 rounded-[10px] px-2 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
