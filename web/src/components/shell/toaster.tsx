'use client';

import { Check, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '@/components/ui';
import type { ToastTone } from '@/lib/toast';

type Item = { id: number; message: string; tone: ToastTone };

const ICON = { default: Info, success: Check, error: TriangleAlert } as const;

/** The little confirmations that appear at the foot of the screen and leave on their own. */
export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let n = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (event: Event) => {
      const { message, tone } = (event as CustomEvent<{ message: string; tone: ToastTone }>).detail;
      const id = ++n;
      setItems((list) => [...list.slice(-2), { id, message, tone }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setItems((list) => list.filter((i) => i.id !== id));
      }, 3200);
      timers.add(timer);
    };
    window.addEventListener('posterity:toast', onToast);
    return () => {
      window.removeEventListener('posterity:toast', onToast);
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-8">
      {items.map((item) => {
        const Icon = ICON[item.tone];
        return (
          <div
            key={item.id}
            className="pointer-events-auto flex max-w-[min(92vw,440px)] animate-[rise_260ms_var(--ease-out-expo)_both] items-center gap-2.5 rounded-full bg-text py-2.5 pl-3.5 pr-5 text-[14px] font-medium text-ink shadow-[0_12px_36px_-10px_rgb(0_0_0/0.6)]"
          >
            <Icon className={cx('size-4 shrink-0', item.tone === 'success' && 'text-done', item.tone === 'error' && 'text-danger')} strokeWidth={2.4} aria-hidden />
            {item.message}
          </div>
        );
      })}
    </div>
  );
}
