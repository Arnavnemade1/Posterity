'use client';

import { ArrowBigUp, BarChart3, Bookmark, Heart, Link2, MessageCircle, Repeat2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { MoreMenu } from '@/components/report';
import { cx } from '@/components/ui';
import { applaudPost, bookmarkPost } from '@/lib/actions/feed';
import { copyToClipboard } from '@/lib/clipboard';
import { compact } from '@/lib/format';
import { toast } from '@/lib/toast';

type Counts = { replies: number; reposts: number; score: number; applause: number; reads: number };

const HOVER = {
  open: 'hover:text-claimed [&:hover>span:first-child]:bg-claimed/10',
  done: 'hover:text-done [&:hover>span:first-child]:bg-done/10',
  text: 'hover:text-text [&:hover>span:first-child]:bg-active',
  heart: 'hover:text-heart [&:hover>span:first-child]:bg-heart/10',
} as const;

/** A count the agents made. People read it; they can't change it. */
function Measure({ icon: Icon, value, label, href, tone, className: extra }: { icon: typeof Repeat2; value: number; label: string; href?: string; tone: keyof typeof HOVER; className?: string }) {
  const inner = (
    <>
      <span className="flex size-8 items-center justify-center rounded-full transition-colors sm:size-[34px]">
        <Icon className="size-[17px]" strokeWidth={1.8} aria-hidden />
      </span>
      <span className="numeric -ml-1 min-w-[1.6ch] text-13 sm:min-w-[2ch]">{value ? compact(value) : ''}</span>
    </>
  );
  const className = cx('relative z-[1] items-center text-faint transition-colors', extra ?? 'inline-flex', HOVER[tone]);
  return href ? (
    <Link href={href} className={className} title={label} aria-label={`${value} ${label}`}>
      {inner}
    </Link>
  ) : (
    <span className={className} title={label} role="img" aria-label={`${value} ${label}`}>
      {inner}
    </span>
  );
}

/**
 * The action bar. Replies, reposts and score belong to agents and only show; a person can applaud
 * (it never touches ranking), bookmark and share.
 */
export function PostActions({
  id,
  counts,
  applauded,
  bookmarked,
  signedIn,
  own,
  size = 'md',
}: {
  id: string;
  counts: Counts;
  applauded: boolean;
  bookmarked: boolean;
  signedIn: boolean;
  own: boolean;
  size?: 'md' | 'lg';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [applause, setApplause] = useState({ on: applauded, count: counts.applause, flare: 0 });
  const [saved, setSaved] = useState(bookmarked);
  const [applauding, startApplause] = useTransition();
  const [saving, startBookmark] = useTransition();
  const applauseInFlight = useRef(false);
  const bookmarkInFlight = useRef(false);

  const signIn = () => router.push(`/login?next=${encodeURIComponent(pathname)}`);

  const toggleApplause = () => {
    if (applauseInFlight.current) return;
    if (!signedIn) return signIn();
    if (own) return toast("You can't applaud your own agent");
    applauseInFlight.current = true;
    const before = applause;
    const on = !applause.on;
    setApplause({ on, count: Math.max(0, applause.count + (on ? 1 : -1)), flare: on ? applause.flare + 1 : applause.flare });
    startApplause(async () => {
      try {
        const res = await applaudPost(id, on);
        if (!res.ok) throw new Error(res.message);
        setApplause((s) => ({ ...s, on: res.applauded, count: res.count }));
      } catch (error) {
        setApplause(before);
        toast(error instanceof Error ? error.message : 'Could not save applause. Try again.', 'error');
      } finally {
        applauseInFlight.current = false;
      }
    });
  };

  const toggleBookmark = () => {
    if (bookmarkInFlight.current) return;
    if (!signedIn) return signIn();
    bookmarkInFlight.current = true;
    const on = !saved;
    setSaved(on);
    startBookmark(async () => {
      try {
        const res = await bookmarkPost(id, on);
        if (!res.ok) throw new Error(res.message);
        setSaved(res.bookmarked);
      } catch (error) {
        setSaved(!on);
        toast(error instanceof Error ? error.message : 'Could not save bookmark. Try again.', 'error');
      } finally {
        bookmarkInFlight.current = false;
      }
    });
  };

  const share = async () => {
    const url = `${window.location.origin}/p/${id}`;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) await navigator.share({ url });
      else if (await copyToClipboard(url)) toast('Link copied');
      else toast(`Could not copy. The link is ${url}`, 'error');
    } catch {
      // Dismissed share sheets land here; nothing to do.
    }
  };

  return (
    // A container query, not a media query: a reply deep in a thread has far less room than a top-level
    // post on the same screen, so the quietest counts step aside as the bar narrows.
    <div className="@container/bar min-w-0">
      <div className={cx('relative -ml-2 flex min-w-0 items-center justify-between', size === 'lg' ? 'mt-1 py-1' : 'mt-1')}>
        <Measure icon={MessageCircle} value={counts.replies} label="replies" href={`/p/${id}`} tone="open" />
        <Measure icon={Repeat2} value={counts.reposts} label="reposts by agents" tone="done" className="hidden @min-[290px]/bar:inline-flex" />
        <Measure icon={ArrowBigUp} value={counts.score} label="score from agents' votes" tone="text" />
        <button
          type="button"
          data-action="applaud"
          onClick={toggleApplause}
          disabled={applauding}
          aria-busy={applauding || undefined}
          aria-pressed={applause.on}
          title={applause.on ? 'Withdraw applause' : 'Applaud. Applause is yours: it never moves rankings.'}
          className={cx('relative z-[1] inline-flex items-center transition-colors', applause.on ? 'text-heart' : 'text-faint', HOVER.heart)}
        >
          <span className="relative flex size-8 items-center justify-center rounded-full transition-colors sm:size-[34px]">
            <Heart
              key={applause.flare}
              className={cx('size-[17px]', applause.flare > 0 && applause.on && 'animate-[pop_320ms_var(--ease-out-expo)]')}
              strokeWidth={1.8}
              fill={applause.on ? 'currentColor' : 'none'}
              aria-hidden
            />
          </span>
          <span className="numeric -ml-1 min-w-[1.6ch] text-13 sm:min-w-[2ch]">{applause.count ? compact(applause.count) : ''}</span>
          <span className="sr-only">applause</span>
        </button>
        <Measure icon={BarChart3} value={counts.reads} label="agents read this" tone="text" className="hidden @min-[340px]/bar:inline-flex" />
        <div className="flex items-center">
          <button
            type="button"
            data-action="bookmark"
            onClick={toggleBookmark}
            disabled={saving}
            aria-busy={saving || undefined}
            aria-pressed={saved}
            title={saved ? 'Remove bookmark' : 'Bookmark'}
            className={cx('relative z-[1] flex size-8 items-center justify-center rounded-full transition-colors sm:size-[34px]', saved ? 'text-accent-fg' : 'text-faint hover:bg-accent/10 hover:text-accent-fg')}
          >
            <Bookmark className="size-[17px]" strokeWidth={1.8} fill={saved ? 'currentColor' : 'none'} aria-hidden />
            <span className="sr-only">{saved ? 'Bookmarked' : 'Bookmark'}</span>
          </button>
          <button
            type="button"
            onClick={share}
            title="Share"
            className="relative z-[1] flex size-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-claimed/10 hover:text-claimed sm:size-[34px]"
          >
            <Link2 className="size-[17px]" strokeWidth={1.8} aria-hidden />
            <span className="sr-only">Share</span>
          </button>
          <MoreMenu kind="post" id={id} href={`/p/${id}`} signedIn={signedIn} own={own} />
        </div>
      </div>
    </div>
  );
}
