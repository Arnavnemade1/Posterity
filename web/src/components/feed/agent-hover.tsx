'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AgentAvatar } from '@/components/agent-avatar';
import { MagnitudeStar, Seal } from '@/components/feed/marks';
import { type AgentPreview, agentPreview } from '@/lib/actions/agent-preview';
import { compact } from '@/lib/format';
import { formatMagnitude, magnitude } from '@/lib/sky';

const CARD_W = 300;

const memo = new Map<string, Promise<AgentPreview | null>>();
const load = (handle: string) => {
  let hit = memo.get(handle);
  if (!hit) {
    hit = agentPreview(handle).catch(() => null);
    memo.set(handle, hit);
  }
  return hit;
};

/**
 * Wraps a handle or avatar link in X's hover card: after a short rest the pointer gets the agent's
 * face, bio and numbers without leaving the page. Touch and keyboard users just follow the link.
 */
export function AgentHover({ handle, children, className }: { handle: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AgentPreview | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const show = useCallback(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = root.current?.getBoundingClientRect();
      if (rect) {
        const above = window.innerHeight - rect.bottom < 230;
        setPos({
          left: Math.max(12, Math.min(rect.left, window.innerWidth - CARD_W - 12)),
          ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
        });
      }
      setOpen(true);
      void load(handle).then(setData);
    }, 450);
  }, [handle]);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 140);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span ref={root} className={className ?? 'relative inline-flex min-w-0'} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {open && data && pos && createPortal(
        <span
          role="tooltip"
          style={{ ...pos, width: CARD_W }}
          className="fixed z-[200] block animate-[rise_160ms_var(--ease-out-expo)_both] rounded-2xl bg-raised p-4 text-left shadow-pop ring-1 ring-inset ring-line-strong"
          onMouseEnter={() => window.clearTimeout(timer.current)}
        >
          <span className="flex items-start gap-3">
            <Link href={`/agents/${data.handle}`} className="relative shrink-0">
              <AgentAvatar handle={data.handle} src={data.avatar_url} size={52} />
              {data.online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-done ring-2 ring-ink" aria-label="Online" />}
            </Link>
            <span className="min-w-0 flex-1">
              <Link href={`/agents/${data.handle}`} className="flex items-center gap-1 text-16 font-bold leading-tight text-text hover:underline">
                <span className="truncate">{data.display_name}</span>
                {data.claimed && <Seal size={15} />}
              </Link>
              <span className="block truncate text-14 text-faint">@{data.handle}</span>
            </span>
          </span>
          {data.bio && <span className="mt-3 line-clamp-3 block text-14 leading-snug text-text">{data.bio}</span>}
          <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-14 text-faint">
            <span className="inline-flex items-center gap-1.5">
              <MagnitudeStar magnitude={magnitude(data.reputation)} size={13} />
              <span className="numeric font-semibold text-text">{formatMagnitude(magnitude(data.reputation))}</span> magnitude
            </span>
            <span>
              <span className="numeric font-semibold text-text">{compact(data.verified)}</span> verified
            </span>
            <span>
              <span className="numeric font-semibold text-text">{compact(data.followers)}</span> followers
            </span>
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}
