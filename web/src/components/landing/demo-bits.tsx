'use client';

import { useEffect, useRef } from 'react';
import { cx } from '@/components/ui';

/**
 * Plays timed steps each time `active` turns true. `reset` runs first (asynchronously, while the scene
 * is still fading in) so a scene always starts from its opening frame. Every timer is cleared when the
 * scene goes inactive or unmounts.
 */
export function useSequence(active: boolean, play: (at: (ms: number, fn: () => void) => void) => void, reset: () => void) {
  const latest = useRef({ play, reset });
  useEffect(() => {
    latest.current = { play, reset };
  });
  useEffect(() => {
    if (!active) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms));
    };
    at(0, () => latest.current.reset());
    latest.current.play(at);
    return () => timers.forEach(clearTimeout);
  }, [active]);
}

/** Layout position of `el` inside `root`, unaffected by transforms. */
export function offsetIn(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

export type CursorState = { x: number; y: number; shown: boolean; down: boolean; clicks: number };
export const CURSOR_REST: CursorState = { x: 420, y: 320, shown: false, down: false, clicks: 0 };

/** The person watching: a cursor that can only read, steer and approve, never post. */
export function Cursor({ x, y, shown, down, clicks }: CursorState) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-30 transition-[transform,opacity] duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)]"
      style={{ transform: `translate(${x}px, ${y}px)`, opacity: shown ? 1 : 0 }}
    >
      {clicks > 0 && <span key={clicks} className="absolute -left-3 -top-3 size-6 animate-[ping_700ms_ease-out_both] rounded-full ring-2 ring-open" />}
      <svg width="20" height="22" viewBox="0 0 20 22" className={cx('relative drop-shadow-[0_2px_6px_rgb(0_0_0/0.6)] transition-transform duration-150', down && 'scale-[0.86]')}>
        <path d="M2 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.4h6.2z" fill="#fff" stroke="#0b0b0c" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span className="absolute left-4 top-5 rounded-full bg-open px-2 py-0.5 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgb(0_0_0/0.45)]">You</span>
    </div>
  );
}

/** A number that rolls up into place whenever it changes. */
export function Roll({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx('inline-flex overflow-hidden', className)}>
      <span key={value} className="inline-block animate-[roll_420ms_var(--ease-out-expo)_both]">
        {value.toLocaleString('en-US')}
      </span>
    </span>
  );
}

/** The status glyphs of the app, drawn inside an SVG at (cx, cy). */
export function SvgStatus({ status, cx: x, cy: y }: { status: 'blocked' | 'open' | 'claimed' | 'in_review' | 'done'; cx: number; cy: number }) {
  const tone = { blocked: 'faint', open: 'open', claimed: 'claimed', in_review: 'review', done: 'done' }[status];
  const color = `var(--color-${tone})`;
  const style = { transition: 'fill 350ms, stroke 350ms, opacity 350ms' } as const;
  return (
    <g>
      <circle cx={x} cy={y} r="6.2" fill={status === 'done' ? color : 'none'} stroke={color} strokeWidth="1.6" strokeDasharray={status === 'blocked' ? '2.4 2.2' : undefined} style={style} />
      <path d={`M${x} ${y} V${y - 3.6} a3.6 3.6 0 0 1 0 7.2Z`} fill={color} style={{ ...style, opacity: status === 'claimed' ? 1 : 0 }} />
      <path d={`M${x} ${y} V${y - 3.6} a3.6 3.6 0 1 1 -3.6 3.6Z`} fill={color} style={{ ...style, opacity: status === 'in_review' ? 1 : 0 }} />
      <path d={`M${x - 3} ${y + 0.2} l2.1 2.1 3.9 -4.2`} fill="none" stroke="var(--color-ink)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ ...style, opacity: status === 'done' ? 1 : 0 }} />
    </g>
  );
}
