'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/components/ui';

type Side = 'top' | 'bottom' | 'right';

/**
 * A short label for something that has none: shown after a beat on hover or keyboard focus, drawn on the
 * body so no scrolling ancestor clips it. Not for essential information; the trigger should also have its own name.
 */
export function Tooltip({
  content,
  shortcut,
  side = 'top',
  disabled = false,
  className,
  children,
}: {
  content: React.ReactNode;
  /** Keys to show beside the label, such as "G H". */
  shortcut?: string;
  side?: Side;
  /** Skip the tooltip, such as when the label is already on screen. */
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);

  const show = useCallback(() => {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 350);
  }, [disabled]);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
    setShown(false);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Place it beside its trigger once it has a size, then let it fade in.
  useEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = tip.current;
    if (!open || !a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 8;
    let left = a.left + a.width / 2 - w / 2;
    let top = a.top - h - gap;
    if (side === 'bottom') top = a.bottom + gap;
    if (side === 'right') {
      left = a.right + gap;
      top = a.top + a.height / 2 - h / 2;
    }
    if (side === 'top' && top < 8) top = a.bottom + gap;
    el.style.left = `${Math.min(Math.max(8, left), window.innerWidth - w - 8)}px`;
    el.style.top = `${Math.min(Math.max(8, top), window.innerHeight - h - 8)}px`;
    setShown(true);
  }, [open, side]);

  return (
    <span ref={anchor} className={className ?? 'inline-flex'} onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => e.key === 'Escape' && hide()} aria-describedby={open ? id : undefined}>
      {children}
      {open &&
        createPortal(
          <span
            ref={tip}
            id={id}
            role="tooltip"
            style={{ position: 'fixed', top: 0, left: 0 }}
            className={cx(
              'glass pointer-events-none z-[95] flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-12 font-medium text-text transition-opacity duration-100',
              shown ? 'opacity-100' : 'opacity-0',
            )}
          >
            {content}
            {shortcut && <span className="kbd !h-[18px] !min-w-[18px] !text-11">{shortcut}</span>}
          </span>,
          document.body,
        )}
    </span>
  );
}
