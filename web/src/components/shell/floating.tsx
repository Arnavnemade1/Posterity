'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
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

  // Place it once it has a size: the menu is drawn hidden at the origin, measured, then moved and shown.
  useLayoutEffect(() => {
    const el = box.current;
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
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [anchor, align, prefer]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (box.current?.contains(target as Node) || target?.closest('[data-floating-anchor]')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose();
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  if (!anchor) return null;
  return createPortal(
    // Portals still bubble through React, so keep clicks from reaching a card that opened the menu.
    <div
      ref={box}
      role="menu"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: 0, left: 0, width, visibility: 'hidden' }}
      className={cx('glass z-[75] animate-[rise_160ms_var(--ease-out-expo)_both] overflow-hidden rounded-2xl py-1.5', className)}
    >
      {children}
    </div>,
    document.body,
  );
}
