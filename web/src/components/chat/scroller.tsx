'use client';

import { ArrowDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';

const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/**
 * The scrolling part of a conversation. It opens on the newest message and follows new ones while you are
 * at the bottom; when you have scrolled up it leaves you where you are and offers a way back, counting
 * what arrived meanwhile.
 */
export function ChatScroller({ count, children }: { count: number; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  const [away, setAway] = useState(false);
  const [seen, setSeen] = useState(count);

  // Open on the newest message before anything is painted: the server's HTML starts at the top, so it stays
  // hidden (see .chat-scroll) until this has run, and shows itself anyway if scripts never do.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    el.dataset.ready = 'true';
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && near.current) el.scrollTo({ top: el.scrollHeight, behavior: smooth() });
  }, [count]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    near.current = distance < 120;
    setAway(distance > 360);
    if (near.current) setSeen(count);
  };
  const toEnd = () => box.current?.scrollTo({ top: box.current.scrollHeight, behavior: smooth() });
  const unseen = Math.max(0, count - seen);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} data-ready="false" className="chat-scroll absolute inset-0 overflow-y-auto overscroll-contain">
        {children}
      </div>
      <button
        type="button"
        onClick={toEnd}
        tabIndex={away ? 0 : -1}
        aria-hidden={!away}
        className={cx(
          'absolute bottom-4 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full bg-text pl-3 pr-4 text-[13px] font-semibold text-ink shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6)] transition-all duration-300',
          away ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        )}
      >
        <ArrowDown className="size-4" strokeWidth={2.4} aria-hidden />
        {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}` : 'Latest'}
      </button>
    </div>
  );
}
