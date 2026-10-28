'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useTransition, useSyncExternalStore } from 'react';
import { decideOwnerRequest, markAllRead } from '@/app/(app)/control/actions';
import { markRead } from '@/app/(app)/notifications/actions';
import { noticeMeta } from '@/components/notice-kinds';
import { buttonClass, cx, Time } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { type Notice, noticeHref } from '@/lib/notice-href';
import { noticeState } from '@/lib/notice-state';
import { toast } from '@/lib/toast';

/** How long an inline decision can be taken back before it is sent. */
const UNDO_MS = 5000;

export function useNoticeUpdates() {
  return useSyncExternalStore(noticeState.subscribe, noticeState.getSnapshot, noticeState.getServerSnapshot);
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not update this notification. Try again.';

export function MarkAllReadButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => startTransition(async () => {
      try { await markAllRead(); }
      catch (error) { toast(errorMessage(error), 'error'); }
    })} className={className ?? buttonClass('secondary', 'sm')}>
      {pending ? 'Marking read…' : 'Mark all read'}
    </button>
  );
}

/** The control room uses the same acknowledgement as the full notification center. */
export function CompactNotice({ notice, now }: { notice: Pick<Notice, 'id' | 'title' | 'created_at' | 'read_at' | 'data'>; now: number }) {
  const updates = useNoticeUpdates();
  const unread = !notice.read_at && !updates.get(notice.id)?.read;
  const href = noticeHref(notice.data);
  const read = () => {
    if (unread) void noticeState.read(notice.id, () => markRead([notice.id])).catch((error) => toast(errorMessage(error), 'error'));
  };
  const body = <>
    <span className={cx('mt-[7px] size-1.5 shrink-0 rounded-full', unread ? 'bg-accent' : 'bg-transparent')} aria-hidden />
    <span className="min-w-0 flex-1">
      <span className={cx('block text-14 leading-snug', unread ? 'text-text' : 'text-muted')}>{notice.title}</span>
      <span className="mt-0.5 block text-12 text-faint">{timeAgo(notice.created_at, now)}</span>
    </span>
  </>;
  return <li>{href ? (
    <Link href={href} onClick={read} className="flex gap-2.5 px-4 py-2 transition-colors hover:bg-hover">{body}</Link>
  ) : (
    <button type="button" onClick={read} className="flex w-full gap-2.5 px-4 py-2 text-left transition-colors hover:bg-hover">{body}</button>
  )}</li>;
}

/**
 * One notification: what it is, what it says, and when. Opening it marks it read as you go; one that leads nowhere has
 * a button to dismiss it instead. A request from one of your agents can be approved or declined right here: the choice
 * shows at once, waits a few seconds so it can be undone, then goes through.
 */
export function NoticeRow({ notice, now }: { notice: Notice; now: number }) {
  const [pending, startTransition] = useTransition();
  const updates = useNoticeUpdates();
  const update = updates.get(notice.id);
  const decided = update?.decision;
  const meta = noticeMeta(notice.kind);
  const Icon = meta.icon;
  const href = noticeHref(notice.data);
  const unread = !notice.read_at && !update?.read;
  const requestId = typeof notice.data.owner_request_id === 'string' ? notice.data.owner_request_id : null;
  const inline = notice.kind === 'owner_request' && requestId && (unread || decided);

  const read = () => {
    if (!unread) return;
    startTransition(async () => {
      try { await noticeState.read(notice.id, () => markRead([notice.id])); }
      catch (error) { toast(errorMessage(error), 'error'); }
    });
  };

  const decide = (choice: 'approve' | 'decline') => {
    if (!requestId) return;
    const undo = noticeState.decide(notice.id, choice, async () => {
      const form = new FormData();
      form.set('request_id', requestId);
      form.set('decision', choice);
      const result = await decideOwnerRequest(null, form);
      if (!result?.ok) throw new Error(result?.message ?? 'Could not save your decision. Try again.');
      // The decision action also marks the related notices read, in the same server call.
    }, (error) => toast(errorMessage(error), 'error'), UNDO_MS);
    if (!undo) return;
    toast(choice === 'approve' ? 'Approved' : 'Declined', 'success', {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        run: () => {
          if (!undo()) toast('The decision has already been sent.');
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
        <div className={cx(row, 'flex-wrap', unread && 'bg-accent/[0.05]')}>
          <Link href={href ?? '/control'} onClick={read} className="flex min-w-0 basis-full gap-3 rounded-lg focus-visible:outline-offset-4 sm:basis-0 sm:flex-1">
            {body}
          </Link>
          <span className="ml-auto mt-1 flex basis-full shrink-0 items-start gap-2 self-start pl-12 sm:basis-auto sm:pl-0">
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
                <Link href="/control" onClick={read} className={cx(buttonClass('ghost', 'sm'), 'hidden sm:inline-flex')}>
                  Details
                </Link>
              </>
            )}
          </span>
        </div>
      ) : href ? (
        <Link href={href} onClick={read} className={cx(row, unread && 'bg-accent/[0.04]', 'hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-[-2px]')}>
          {body}
        </Link>
      ) : (
        <div className={cx(row, unread && 'bg-accent/[0.04]')}>
          {body}
          {unread && (
            <button
              type="button"
              disabled={pending}
              onClick={read}
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
