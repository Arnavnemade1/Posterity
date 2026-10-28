'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/components/ui';

/** Where a menu's trigger sits, taken when it is opened. */
export interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Read a trigger's position inside its click handler. */
export function anchorOf(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

/** Mark a menu's trigger with this so clicking it again toggles the menu instead of closing and reopening it. */
export const ANCHOR_ATTR = { 'data-floating-anchor': '' } as const;

/**
 * A menu that floats above the page, drawn on the body so no scrolling or clipping ancestor can cut it off.
 * It opens beside its trigger, flips to the other side when there is no room, closes on Escape, on a click
 * outside, and when anything scrolls, and moves between its items with the arrow keys.
 */
export function FloatingMenu({
  anchor,
  onClose,
  width = 240,
  align = 'start',
  prefer = 'below',
  className,
  children,
  label,
}: {
  anchor: Anchor | null;
  onClose: () => void;
  width?: number;
  align?: 'start' | 'end';
  prefer?: 'below' | 'above';
  className?: string;
  children: React.ReactNode;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // On close the menu stays drawn for a moment, fading out, from the anchor it last had.
  const [shown, setShown] = useState<Anchor | null>(anchor);
  const [state, setState] = useState<'open' | 'closed'>(anchor ? 'open' : 'closed');
  if (anchor && shown !== anchor) setShown(anchor);
  if (anchor && state !== 'open') setState('open');
  if (!anchor && state === 'open') setState('closed');
  useEffect(() => {
    if (anchor || !shown) return;
    const t = setTimeout(() => setShown(null), 130);
    return () => clearTimeout(t);
  }, [anchor, shown]);

  // Place it once it has a size: the menu is drawn hidden at the origin, measured, then moved and shown.
  useLayoutEffect(() => {
    const el = box.current;
    const anchor = shown;
    if (!el || !anchor) return;
    const gap = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - h;
    const fitsBelow = below + h <= window.innerHeight - 8;
    const fitsAbove = above >= 8;
    const top = prefer === 'below' ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
    const left = Math.min(Math.max(8, align === 'end' ? anchor.right - w : anchor.left), window.innerWidth - w - 8);
    el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
    el.style.left = `${left}px`;
    el.style.visibility = 'visible';
  }, [shown, align, prefer]);

  useLayoutEffect(() => {
    if (!anchor) return;
    if (document.activeElement instanceof HTMLElement && !box.current?.contains(document.activeElement)) trigger.current = document.activeElement;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (box.current?.contains(target as Node) || target?.closest('[data-floating-anchor]')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
        }
        trigger.current?.focus({ preventScroll: true });
        onClose();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  if (!shown) return null;
  return createPortal(
    // Portals still bubble through React, so keep clicks from reaching a card that opened the menu.
    <div
      ref={box}
      role="menu"
      aria-label={label}
      inert={!anchor}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: 0, left: 0, width, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 16px)', visibility: 'hidden' }}
      data-state={state}
      className={cx(
        'glass z-[75] origin-top overflow-y-auto overscroll-contain rounded-2xl p-1.5 transition-[opacity,transform] duration-[120ms] ease-out',
        state === 'open' ? 'animate-[rise_160ms_var(--ease-out-expo)_both]' : 'pointer-events-none translate-y-1 opacity-0',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
