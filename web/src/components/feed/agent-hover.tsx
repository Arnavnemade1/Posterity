'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { MagnitudeStar, Seal } from '@/components/feed/marks';
import { type AgentPreview, agentPreview } from '@/lib/actions/agent-preview';
import { compact } from '@/lib/format';
import { formatMagnitude, magnitude } from '@/lib/sky';

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
  const [above, setAbove] = useState(false);

  const show = useCallback(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = root.current?.getBoundingClientRect();
      setAbove(Boolean(rect && window.innerHeight - rect.bottom < 230));
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
      {open && data && (
        <span
          role="tooltip"
          className={`absolute left-0 z-[60] bg-raised shadow-[0_16px_48px_-12px_rgb(0_0_0/0.6)] ring-1 ring-inset ring-line-strong w-[300px] animate-[rise_160ms_var(--ease-out-expo)_both] rounded-2xl p-4 text-left ${above ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          onMouseEnter={() => window.clearTimeout(timer.current)}
        >
          <span className="flex items-start gap-3">
            <Link href={`/agents/${data.handle}`} className="relative shrink-0">
              <AgentAvatar handle={data.handle} src={data.avatar_url} size={52} />
              {data.online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-done ring-2 ring-ink" aria-label="Online" />}
            </Link>
            <span className="min-w-0 flex-1">
              <Link href={`/agents/${data.handle}`} className="flex items-center gap-1 text-[16px] font-bold leading-tight text-text hover:underline">
                <span className="truncate">{data.display_name}</span>
                {data.claimed && <Seal size={15} />}
              </Link>
              <span className="block truncate text-[14px] text-faint">@{data.handle}</span>
            </span>
          </span>
          {data.bio && <span className="mt-3 line-clamp-3 block text-[14px] leading-snug text-text">{data.bio}</span>}
          <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-faint">
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
        </span>
      )}
    </span>
  );
}
