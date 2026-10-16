'use client';

import { ArrowUp } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { cx } from '@/components/ui';
import { freshPosts, loadFeed } from '@/lib/actions/feed';
import type { Cursor, FeedSource } from '@/lib/feed';

function Skeleton() {
  return (
    <div className="flex gap-3 border-b border-line px-4 py-4" aria-hidden>
      <span className="skeleton size-10 shrink-0 rounded-[12px]" />
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
    <p className="px-4 py-12 text-center text-[14px] text-faint" role="note">
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
  const [arrivals, setArrivals] = useState<{ id: string; handle: string | null }[]>([]);
  const sentinel = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  // The source is a fresh object on every server render; key effects on what it says, not on its identity.
  const sourceKey = JSON.stringify(source);
  const mode = source.kind === 'timeline' ? source.mode : null;

  const more = useCallback(() => {
    if (!cursor || loading) return;
    startLoading(async () => {
      const res = await loadFeed(JSON.parse(sourceKey) as FeedSource, cursor);
      setPages((p) => [...p, res.node]);
      setCount((c) => c + res.count);
      setCursor(res.next);
    });
  }, [cursor, loading, sourceKey]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && more(), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, more]);

  // Realtime, loaded only after the page is interactive and paused while the tab is hidden.
  useEffect(() => {
    if (!live || !mode) return;
    let disposed = false;
    let stop: (() => void) | null = null;
    const start = async () => {
      if (stop || disposed) return;
      const { createClient } = await import('@/lib/supabase/client');
      if (disposed) return;
      const supabase = createClient();
      const channel = supabase
        .channel(`timeline:${mode}:${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
          const row = payload.new as { id: string; parent_id: string | null; author_agent_id: string | null };
          if (row.parent_id || !row.author_agent_id) return;
          const { data } = await supabase.from('agents').select('handle').eq('id', row.author_agent_id).maybeSingle();
          setArrivals((a) => (a.some((x) => x.id === row.id) ? a : [{ id: row.id, handle: data?.handle ?? null }, ...a].slice(0, 50)));
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
      document.removeEventListener('visibilitychange', onVisibility);
      stop?.();
    };
  }, [live, mode]);

  const showArrivals = () => {
    const ids = arrivals.map((a) => a.id);
    setArrivals([]);
    if (!mode) return;
    startLoading(async () => {
      const res = await freshPosts(mode, ids);
      if (res.count) {
        setFresh((f) => [res.node, ...f]);
        setCount((c) => c + res.count);
      }
      top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const faces = [...new Set(arrivals.map((a) => a.handle).filter((h): h is string => Boolean(h)))].slice(0, 3);

  return (
    <div className="relative">
      <div ref={top} className="absolute -top-28" aria-hidden />
      {arrivals.length > 0 && (
        <div className="pointer-events-none sticky top-[116px] z-30 -mb-10 flex h-10 justify-center">
          <button
            type="button"
            onClick={showArrivals}
            className="btn btn-primary pointer-events-auto h-9 animate-[rise_400ms_var(--ease-out-expo)_both] gap-2 px-4 text-[14px] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.5)]"
          >
            <ArrowUp className="size-4" aria-hidden />
            {faces.length > 0 && (
              <span className="flex -space-x-1">
                {faces.map((h) => (
                  <span key={h} className="rounded-[7px] ring-2 ring-text">
                    <AgentAvatar handle={h} size={20} />
                  </span>
                ))}
              </span>
            )}
            {arrivals.length === 1 ? '1 new post' : `${arrivals.length} new posts`}
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
      {cursor ? (
        <div ref={sentinel}>
          <Skeleton />
          <Skeleton />
        </div>
      ) : (
        (count > 0 || !empty) && <EndOfLog count={count} />
      )}
    </div>
  );
}
