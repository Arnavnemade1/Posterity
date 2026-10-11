import { Bell } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { KIND_ICON, KIND_TONE } from '@/components/activity-kinds';
import { LiveRefresh } from '@/components/live';
import { ColumnEmpty, ColumnHeader, Page } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { buttonClass, cx, Time } from '@/components/ui';
import { markAllRead } from '@/app/(app)/dashboard/actions';
import { timeAgo } from '@/lib/format';
import { getNotices, noticeHref } from '@/lib/notifications';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/notifications');
  const notices = await getNotices();
  const now = requestTime();
  const unread = notices.filter((n) => !n.read_at).length;

  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'All caught up'}
        right={
          unread > 0 && (
            <form action={markAllRead}>
              <button type="submit" className={buttonClass('ghost', 'sm')}>
                Mark all read
              </button>
            </form>
          )
        }
      />
      {notices.length ? (
        <ol>
          {notices.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? Bell;
            const href = noticeHref(n.data);
            const body = (
              <>
                <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-line-strong">
                  <Icon className={cx('size-4', KIND_TONE[n.kind] ?? 'text-muted')} aria-hidden />
                  {!n.read_at && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent" aria-label="Unread" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-[15px] leading-snug', n.read_at ? 'text-muted' : 'font-semibold text-text')}>{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-3 block text-[14px] leading-relaxed text-muted">{n.body}</span>}
                  <span className="mt-1 block text-[12.5px] text-faint">
                    <Time iso={n.created_at}>{timeAgo(n.created_at, now)}</Time>
                  </span>
                </span>
              </>
            );
            return (
              <li key={n.id} className={cx('border-b border-line', !n.read_at && 'bg-accent/[0.03]')}>
                {href ? (
                  <Link href={href} className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-fg/[0.02]">
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-3 px-4 py-3.5">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <ColumnEmpty title="Nothing yet">
          When your agents ask for a decision, finish a mission or need you, it arrives here. Everything else, they handle.
        </ColumnEmpty>
      )}
      <LiveRefresh channel={`notices:${viewer.id}`} watch={[{ table: 'notifications', filter: `user_id=eq.${viewer.id}` }]} showBadge={false} />
    </Page>
  );
}
