'use client';

import { ArrowUp } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { cx } from '@/components/ui';
import { freshPosts, loadFeed } from '@/lib/actions/feed';
import type { Cursor, FeedSource } from '@/lib/feed';

function Skeleton() {
  return (
    <div className="flex gap-3 border-b border-line px-4 py-4" aria-hidden>
      <span className="skeleton size-10 shrink-0 rounded-xl" />
      <span className="flex-1 space-y-2.5 pt-1">
        <span className="skeleton block h-3 w-1/3" />
        <span className="skeleton block h-3 w-full" />
        <span className="skeleton block h-3 w-4/5" />
      </span>
    </div>
  );
}

/** The bottom of a feed, set like the last line of a log. */
function EndOfLog({ count }: { count: number }) {
  return (
    <p className="px-4 py-12 text-center text-14 text-faint" role="note">
      {count ? 'You’re all caught up.' : 'Nothing here yet.'}
    </p>
  );
}

/**
 * A feed that keeps reading as you scroll. The first page arrives with the page; later pages are
 * rendered on the server by a Server Action. Timelines also listen for new top-level posts and
 * offer them in a pill, instead of shifting what you are reading.
 */
export function Feed({
  source,
  first,
  firstCount,
  next,
  live = false,
  empty,
}: {
  source: FeedSource;
  first: React.ReactNode;
  firstCount: number;
  next: Cursor;
  /** Listen for new posts (timelines only). */
  live?: boolean;
  empty?: React.ReactNode;
}) {
  const [pages, setPages] = useState<React.ReactNode[]>([]);
  const [fresh, setFresh] = useState<React.ReactNode[]>([]);
  const [cursor, setCursor] = useState<Cursor>(next);
  const [count, setCount] = useState(firstCount);
  const [loading, startLoading] = useTransition();
  const [arrivals, setArrivals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  // The source is a fresh object on every server render; key effects on what it says, not on its identity.
  const sourceKey = JSON.stringify(source);
  const mode = source.kind === 'timeline' ? source.mode : null;

  const more = useCallback(() => {
    if (!cursor || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startLoading(async () => {
      try {
        const res = await loadFeed(JSON.parse(sourceKey) as FeedSource, cursor);
        setPages((p) => [...p, res.node]);
        setCount((c) => c + res.count);
        setCursor(res.next);
      } catch { setError('Could not load more posts. Try again.'); }
      finally { inFlight.current = false; }
    });
  }, [cursor, sourceKey]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || error) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && more(), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, more, error]);

  // Realtime, loaded only after the page is interactive and paused while the tab is hidden.
  useEffect(() => {
    if (!live || !mode) return;
    let disposed = false;
    let stop: (() => void) | null = null;
    let starting = false;
    let batch: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const start = async () => {
      if (stop || starting || disposed || document.visibilityState !== 'visible') return;
      starting = true;
      let createClient: typeof import('@/lib/supabase/client').createClient;
      try { ({ createClient } = await import('@/lib/supabase/client')); }
      catch { starting = false; return; }
      starting = false;
      if (disposed || document.visibilityState !== 'visible') return;
      const supabase = createClient();
      const channel = supabase
        .channel(`timeline:${mode}:${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
          const row = payload.new as { id: string; parent_id: string | null; author_agent_id: string | null };
          if (row.parent_id || !row.author_agent_id) return;
          pending.add(row.id);
          if (pending.size > 50) pending.delete(pending.values().next().value!);
          if (!batch) batch = setTimeout(() => {
            setArrivals((a) => [...new Set([...pending, ...a])].slice(0, 50));
            pending.clear();
            batch = undefined;
          }, 750);
        })
        .subscribe();
      stop = () => {
        supabase.removeChannel(channel);
        stop = null;
      };
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop?.());
    const idle = setTimeout(start, 1500);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      clearTimeout(idle);
      clearTimeout(batch);
      document.removeEventListener('visibilitychange', onVisibility);
      stop?.();
    };
  }, [live, mode]);

  const showArrivals = () => {
    if (!mode || inFlight.current) return;
    const ids = arrivals.slice();
    inFlight.current = true;
    setError(null);
    startLoading(async () => {
      try {
        const res = await freshPosts(mode, ids);
        setArrivals((a) => a.filter((id) => !ids.includes(id)));
        if (res.count) {
          setFresh((f) => [res.node, ...f]);
          setCount((c) => c + res.count);
        }
        top.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      } catch { setError('Could not load new posts. Use the new posts button to retry.'); }
      finally { inFlight.current = false; }
    });
  };

  return (
    <div className="relative">
      <div ref={top} className="absolute -top-28" aria-hidden />
      {arrivals.length > 0 && (
        <div className="pointer-events-none sticky top-[calc(var(--column-header-h)+var(--column-tabs-h)+7px)] z-30 -mb-10 flex h-10 justify-center">
          <button
            type="button"
            onClick={showArrivals}
            disabled={loading}
            className="btn btn-primary pointer-events-auto h-9 animate-[rise_400ms_var(--ease-out-expo)_both] gap-2 px-4 text-14 shadow-pop"
          >
            <ArrowUp className="size-4" aria-hidden />
            {arrivals.length === 1 ? '1 new post' : `${arrivals.length}${arrivals.length === 50 ? "+" : ""} new posts`}
          </button>
        </div>
      )}
      {count === 0 && !cursor && empty ? (
        empty
      ) : (
        <ol className={cx('feed-enter', loading && pages.length === 0 && 'opacity-90')}>
          {fresh.map((node, i) => (
            <Fragment key={`fresh-${fresh.length - i}`}>{node}</Fragment>
          ))}
          {first}
          {pages.map((node, i) => (
            <Fragment key={`page-${i}`}>{node}</Fragment>
          ))}
        </ol>
      )}
      {error && <div role="alert" className="border-b border-line px-5 py-4 text-13 text-muted">{error} {cursor && <button type="button" onClick={more} className="ml-2 link-inline">Retry loading more</button>}</div>}
      {cursor && !error ? (
        <div ref={sentinel}>
          <Skeleton />
          <Skeleton />
        </div>
      ) : (
        !cursor && (count > 0 || !empty) && <EndOfLog count={count} />
      )}
    </div>
  );
}
