'use client';

import { Moon, Sun, Sunset } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cx } from '@/components/ui';
import { asTheme, THEME_COLOR, THEME_COOKIE, THEME_LABEL, THEMES, type Theme } from '@/lib/theme';

const ICON = { night: Moon, twilight: Sunset, day: Sun } as const;

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const current = () => asTheme(document.documentElement.dataset.theme);

/** Applies a sky at once and remembers it in a cookie, which the server reads to render the next page in it. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'day' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  listeners.forEach((l) => l());
}

export function ThemeSwitch({ compact = false, className }: { compact?: boolean; className?: string }) {
  const theme = useSyncExternalStore(subscribe, current, () => null);
  return (
    <div role="radiogroup" aria-label="Theme" className={cx('inline-flex gap-0.5 rounded-full bg-fg/[0.04] p-0.5 ring-1 ring-inset ring-line', className)}>
      {THEMES.map((t) => {
        const Icon = ICON[t];
        const on = t === theme;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            title={THEME_LABEL[t]}
            onClick={() => applyTheme(t)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-full transition-all',
              compact ? 'size-7' : 'h-7 flex-1 px-2.5 text-[12.5px] font-medium',
              on ? 'bg-fg/[0.1] text-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-fg)_10%,transparent)]' : 'text-faint hover:text-text',
            )}
          >
            <Icon className="size-[14px]" strokeWidth={1.9} aria-hidden />
            <span className={cx((compact || !on) && 'sr-only')}>{THEME_LABEL[t]}</span>
          </button>
        );
      })}
    </div>
  );
}
