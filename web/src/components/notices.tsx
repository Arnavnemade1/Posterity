'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { decideOwnerRequest } from '@/app/(app)/control/actions';
import { markRead } from '@/app/(app)/notifications/actions';
import { noticeMeta } from '@/components/notice-kinds';
import { buttonClass, cx, Time } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { type Notice, noticeHref } from '@/lib/notice-href';
import { toast } from '@/lib/toast';

/** How long an inline decision can be taken back before it is sent. */
const UNDO_MS = 5000;

/**
 * One notification: what it is, what it says, and when. Opening it marks it read as you go; one that leads nowhere has
 * a button to dismiss it instead. A request from one of your agents can be approved or declined right here: the choice
 * shows at once, waits a few seconds so it can be undone, then goes through.
 */
export function NoticeRow({ notice, now }: { notice: Notice; now: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decided, setDecided] = useState<'approve' | 'decline' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meta = noticeMeta(notice.kind);
  const Icon = meta.icon;
  const href = noticeHref(notice.data);
  const unread = !notice.read_at;
  const requestId = typeof notice.data.owner_request_id === 'string' ? notice.data.owner_request_id : null;
  const inline = notice.kind === 'owner_request' && requestId && unread;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const decide = (choice: 'approve' | 'decline') => {
    if (!requestId) return;
    setDecided(choice);
    const send = () => {
      timer.current = null;
      const form = new FormData();
      form.set('request_id', requestId);
      form.set('decision', choice);
      startTransition(async () => {
        const result = await decideOwnerRequest(null, form);
        if (result && !result.ok) {
          setDecided(null);
          toast(result.message, 'error');
          return;
        }
        await markRead([notice.id]);
        router.refresh();
      });
    };
    timer.current = setTimeout(send, UNDO_MS);
    toast(choice === 'approve' ? 'Approved' : 'Declined', 'success', {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        run: () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          setDecided(null);
        },
      },
    });
  };

  const body = (
    <>
      <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-hover">
        <Icon className={cx('size-4', meta.tone)} strokeWidth={1.9} aria-hidden />
        {unread && (
          <>
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-ink" aria-hidden />
            <span className="sr-only">Unread</span>
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 text-12 text-faint">
          <span className={cx('font-medium', unread && meta.group === 'decision' ? 'text-accent-fg' : 'text-faint')}>{meta.label}</span>
          <span aria-hidden>·</span>
          <Time iso={notice.created_at}>{timeAgo(notice.created_at, now)}</Time>
        </span>
        <span className={cx('mt-0.5 block text-15 leading-snug', unread ? 'font-medium text-text' : 'text-muted')}>{notice.title}</span>
        {notice.body && <span className="mt-1 line-clamp-3 block whitespace-pre-line text-14 leading-relaxed text-muted">{notice.body}</span>}
      </span>
    </>
  );

  const row = 'flex gap-3 rounded-xl px-3 py-3 transition-colors duration-100';
  return (
    <li className="px-1">
      {inline ? (
        <div className={cx(row, 'bg-accent/[0.05]')}>
          {body}
          <span className="mt-1 flex shrink-0 items-start gap-2 self-start">
            {decided ? (
              <span className="inline-flex h-8 items-center gap-1.5 text-13 text-muted" aria-live="polite">
                <Check className="size-3.5 text-done" aria-hidden /> {decided === 'approve' ? 'Approved' : 'Declined'}
              </span>
            ) : (
              <>
                <button type="button" disabled={pending} onClick={() => decide('approve')} className={buttonClass('primary', 'sm')}>
                  Approve
                </button>
                <button type="button" disabled={pending} onClick={() => decide('decline')} className={buttonClass('secondary', 'sm')}>
                  Decline
                </button>
                <Link href="/control" onClick={() => void markRead([notice.id])} className={cx(buttonClass('ghost', 'sm'), 'hidden sm:inline-flex')}>
                  Details
                </Link>
              </>
            )}
          </span>
        </div>
      ) : href ? (
        <Link href={href} onClick={() => unread && void markRead([notice.id])} className={cx(row, unread && 'bg-accent/[0.04]', 'hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-[-2px]')}>
          {body}
        </Link>
      ) : (
        <div className={cx(row, unread && 'bg-accent/[0.04]')}>
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
              className="mt-1 h-8 shrink-0 self-start rounded-full px-3 text-13 font-medium text-faint transition-colors hover:bg-active hover:text-text"
            >
              Mark read
            </button>
          )}
        </div>
      )}
    </li>
  );
}
