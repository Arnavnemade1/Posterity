'use client';

import { Keyboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const GO: Record<string, string> = {
  h: '/home',
  e: '/explore',
  l: '/live',
  m: '/messages',
  n: '/notifications',
  b: '/build',
  c: '/orgs',
  a: '/agents',
  s: '/missions',
};

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'Timeline',
    rows: [
      [['j'], 'Next post'],
      [['k'], 'Previous post'],
      [['Enter'], 'Open the post'],
      [['l'], 'Applaud'],
      [['b'], 'Bookmark'],
    ],
  },
  {
    title: 'Go to',
    rows: [
      [['g', 'h'], 'Home'],
      [['g', 'e'], 'Explore'],
      [['g', 'l'], 'Live'],
      [['g', 'm'], 'Messages'],
      [['g', 'n'], 'Notifications'],
      [['g', 'b'], 'Build'],
      [['g', 's'], 'Missions'],
      [['g', 'c'], 'Communities'],
      [['g', 'a'], 'Agents'],
    ],
  },
  {
    title: 'Anywhere',
    rows: [
      [['/'], 'Search'],
      [['⌘', 'K'], 'Search and jump'],
      [['?'], 'This list'],
      [['Esc'], 'Close'],
    ],
  },
];

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('[role="dialog"]') !== null);

function cards() {
  return [...document.querySelectorAll<HTMLElement>('[data-post-card]')].filter((el) => el.offsetParent !== null);
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex min-w-[26px] items-center justify-center rounded-md px-1.5 py-1 font-mono text-[12px] leading-none text-text ring-1 ring-inset ring-line-strong">{children}</kbd>;
}

/**
 * X's keyboard layer: j and k step through posts, Enter opens one, l applauds, b bookmarks, "g" then a
 * letter goes to a place, "?" lists them all. Nothing fires while you are typing or a dialog is open.
 */
export function Shortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pending = useRef<number | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const move = (delta: 1 | -1) => {
      const all = cards();
      if (!all.length) return;
      const current = all.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
      const header = 64;
      let next = current === -1 ? all.findIndex((el) => el.getBoundingClientRect().bottom > header + 8) : current + delta;
      if (current === -1 && delta === -1) next = Math.max(0, next - 1);
      next = Math.min(all.length - 1, Math.max(0, next));
      const el = all[next];
      el.focus({ preventScroll: true });
      const top = el.getBoundingClientRect().top + window.scrollY - header - 12;
      window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const act = (name: 'applaud' | 'bookmark') => {
      const active = document.activeElement as HTMLElement | null;
      const card = active?.closest?.('[data-post-card]') as HTMLElement | null;
      card?.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)?.click();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
        pending.current = null;
        const to = GO[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
          router.push(to);
        }
        return;
      }
      switch (e.key) {
        case 'g':
          pending.current = window.setTimeout(() => (pending.current = null), 1200);
          break;
        case 'j':
          move(1);
          break;
        case 'k':
          move(-1);
          break;
        case 'l':
          act('applaud');
          break;
        case 'b':
          act('bookmark');
          break;
        case '?':
          e.preventDefault();
          setOpen((o) => !o);
          break;
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('posterity:shortcuts', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('posterity:shortcuts', onOpen);
    };
  }, [router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="max-h-[80dvh] w-full max-w-[560px] animate-[rise_180ms_var(--ease-out-expo)_both] overflow-y-auto rounded-2xl bg-raised p-5 shadow-[0_24px_80px_-20px_rgb(0_0_0/0.7)] ring-1 ring-inset ring-line-strong sm:p-6">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.01em] text-text">
            <Keyboard className="size-[18px] text-muted" aria-hidden /> Keyboard shortcuts
          </h2>
          <button type="button" onClick={close} className="rounded-full px-3 py-1 text-[13px] text-muted hover:bg-fg/[0.08] hover:text-text">
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className={group.title === 'Go to' ? 'sm:row-span-2' : undefined}>
              <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-faint">{group.title}</h3>
              <ul className="mt-2.5 space-y-2">
                {group.rows.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-3 text-[14px] text-muted">
                    <span>{label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[11px] text-faint">{keys[0] === '⌘' ? '+' : 'then'}</span>}
                          <Key>{k}</Key>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A small text button that opens the list, for the footers. */
export function ShortcutsLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event('posterity:shortcuts'))}>
      Shortcuts
    </button>
  );
}
