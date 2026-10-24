'use client';

import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import type { ToastOptions, ToastTone } from '@/lib/toast';

type Item = { id: number; message: string; tone: ToastTone; action?: ToastOptions['action']; leaving: boolean };

const ICON = { default: Info, success: Check, error: TriangleAlert } as const;
const TONE = { default: 'text-muted', success: 'text-done', error: 'text-danger' } as const;
const EXIT_MS = 160;

// Read the clock outside the component: these run in event handlers, never while rendering.
const clock = () => Date.now();

/** Confirmations at the foot of the screen: they leave on their own, wait while hovered, and can carry one action. */
export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  const timers = useRef(new Map<number, { timer: ReturnType<typeof setTimeout>; left: number; since: number }>());

  useEffect(() => {
    let n = 0;
    const live = timers.current;
    const remove = (id: number) => {
      live.delete(id);
      setItems((list) => list.map((i) => (i.id === id ? { ...i, leaving: true } : i)));
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), EXIT_MS);
    };
    const arm = (id: number, ms: number) => live.set(id, { timer: setTimeout(() => remove(id), ms), left: ms, since: clock() });
    const onToast = (event: Event) => {
      const { message, tone, action, duration } = (event as CustomEvent<{ message: string; tone: ToastTone } & ToastOptions>).detail;
      const id = ++n;
      setItems((list) => [...list.slice(-2), { id, message, tone, action, leaving: false }]);
      arm(id, duration ?? (action ? 5000 : 3200));
    };
    window.addEventListener('posterity:toast', onToast);
    return () => {
      window.removeEventListener('posterity:toast', onToast);
      live.forEach((t) => clearTimeout(t.timer));
      live.clear();
    };
  }, []);

  const hold = (id: number) => {
    const t = timers.current.get(id);
    if (!t) return;
    clearTimeout(t.timer);
    timers.current.set(id, { ...t, left: Math.max(1200, t.left - (clock() - t.since)) });
  };
  const release = (id: number) => {
    const t = timers.current.get(id);
    if (!t) return;
    timers.current.set(id, { ...t, since: clock(), timer: setTimeout(() => dismiss(id), t.left) });
  };
  const dismiss = (id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t.timer);
    timers.current.delete(id);
    setItems((list) => list.map((i) => (i.id === id ? { ...i, leaving: true } : i)));
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), EXIT_MS);
  };

  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6">
      {items.map((item) => {
        const Icon = ICON[item.tone];
        return (
          <div
            key={item.id}
            onPointerEnter={() => hold(item.id)}
            onPointerLeave={() => release(item.id)}
            className={cx(
              'glass pointer-events-auto flex max-w-[min(92vw,420px)] items-center gap-3 rounded-2xl py-2.5 pl-3.5 pr-2.5 text-14 text-text transition-[opacity,transform] duration-150 ease-out',
              item.leaving ? 'translate-y-1 opacity-0' : 'animate-[rise_220ms_var(--ease-out-expo)_both]',
            )}
          >
            <Icon className={cx('size-4 shrink-0', TONE[item.tone])} strokeWidth={2.4} aria-hidden />
            <span className="min-w-0 flex-1 py-0.5">{item.message}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action?.run();
                  dismiss(item.id);
                }}
                className="shrink-0 rounded-full px-3 py-1 text-13 font-semibold text-accent-fg transition-colors hover:bg-hover"
              >
                {item.action.label}
              </button>
            )}
            <button type="button" onClick={() => dismiss(item.id)} aria-label="Dismiss" className="flex size-6 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-hover hover:text-text">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
