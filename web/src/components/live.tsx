'use client';

import {
  Activity,
  BadgeCheck,
  Ban,
  CircleX,
  Eye,
  FileText,
  GitBranch,
  Hand,
  Hourglass,
  MessageSquare,
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
  table: 'activity' | 'missions' | 'tasks' | 'task_events' | 'submissions' | 'reviews' | 'mission_messages' | 'approvals' | 'notifications';
  filter?: string;
}

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-faint" aria-live="polite">
      <span className={cx('size-1.5 rounded-full', live ? 'live-dot bg-done' : 'bg-faint')} />
      {live ? 'Live' : 'Connecting'}
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
        w.filter ? { event: '*', schema: 'public', table: w.table, filter: w.filter } : { event: '*', schema: 'public', table: w.table },
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

const KIND_ICON: Record<string, LucideIcon> = {
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
};

const KIND_TONE: Record<string, string> = {
  work_verified: 'text-done',
  mission_completed: 'text-done',
  work_rejected: 'text-danger',
  approval_requested: 'text-accent',
  mission_review: 'text-accent',
  mission_launched: 'text-accent',
  plan_adopted: 'text-claimed',
};

export interface ActivityRow {
  id: number;
  kind: string;
  summary: string;
  created_at: string;
  mission_id: string | null;
  mission?: { slug: string; title: string } | null;
}

/** Activity stream that appends new events as they happen. */
export function LiveActivity({
  initial,
  missionId,
  serverNow,
  limit = 30,
  empty = 'Nothing has happened yet.',
}: {
  initial: ActivityRow[];
  missionId?: string;
  serverNow: number;
  limit?: number;
  empty?: string;
}) {
  const [items, setItems] = useState(initial);
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
      <div className="mb-3 flex justify-end">
        <LiveBadge live={live} />
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">{empty}</p>
      ) : (
        <ol className="space-y-px">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind] ?? Activity;
            const href = item.mission_id ? `/missions/${item.mission?.slug ?? item.mission_id}` : null;
            const body = (
              <>
                <Icon className={cx('mt-0.5 size-3.5 shrink-0', KIND_TONE[item.kind] ?? 'text-faint')} aria-hidden />
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-muted group-hover:text-text">{item.summary}</span>
                <time dateTime={item.created_at} className="shrink-0 font-mono text-[11px] text-faint">
                  {timeAgo(item.created_at, now)}
                </time>
              </>
            );
            return (
              <li key={item.id}>
                {href ? (
                  <Link href={href} className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
                    {body}
                  </Link>
                ) : (
                  <div className="group flex items-start gap-3 rounded-lg px-2 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
