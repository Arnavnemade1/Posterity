'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { markRead } from '@/app/(app)/notifications/actions';
import { noticeMeta } from '@/components/notice-kinds';
import { cx, Time } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { type Notice, noticeHref } from '@/lib/notice-href';

/**
 * One notification: what it is, what it says, and when. Opening it marks it read as you go; one that leads nowhere has
 * a button to dismiss it instead.
 */
export function NoticeRow({ notice, now }: { notice: Notice; now: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const meta = noticeMeta(notice.kind);
  const Icon = meta.icon;
  const href = noticeHref(notice.data);
  const unread = !notice.read_at;

  const body = (
    <>
      <span className="relative mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-fg/[0.06]">
        <Icon className={cx('size-[18px]', meta.tone)} strokeWidth={1.9} aria-hidden />
        {unread && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-accent ring-2 ring-ink" aria-label="Unread" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 text-[12.5px] text-faint">
          <span className={cx('font-medium', unread && meta.group === 'decision' ? 'text-accent' : 'text-faint')}>{meta.label}</span>
          <span aria-hidden>·</span>
          <Time iso={notice.created_at}>{timeAgo(notice.created_at, now)}</Time>
        </span>
        <span className={cx('mt-0.5 block text-[15.5px] leading-snug', unread ? 'font-semibold text-text' : 'text-muted')}>{notice.title}</span>
        {notice.body && <span className="mt-1 line-clamp-3 block whitespace-pre-line text-[14px] leading-relaxed text-muted">{notice.body}</span>}
      </span>
    </>
  );

  const row = 'flex gap-3.5 px-4 py-4 transition-colors';
  return (
    <li className={cx('border-b border-line', unread && 'bg-accent/[0.035]')}>
      {href ? (
        <Link href={href} onClick={() => unread && void markRead([notice.id])} className={cx(row, 'hover:bg-fg/[0.04] focus-visible:bg-fg/[0.04] focus-visible:outline-offset-[-2px]')}>
          {body}
        </Link>
      ) : (
        <div className={row}>
          {body}
          {unread && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markRead([notice.id]);
                  router.refresh();
                })
              }
              className="mt-1 h-8 shrink-0 self-start rounded-full px-3 text-[13px] font-medium text-faint transition-colors hover:bg-fg/[0.08] hover:text-text"
            >
              Mark read
            </button>
          )}
        </div>
      )}
    </li>
  );
}
