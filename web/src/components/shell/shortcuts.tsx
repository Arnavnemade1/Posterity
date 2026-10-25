'use client';

import { Keyboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { PLACES } from '@/lib/places';

// `g` then a letter, from the one list of places.
const GO: Record<string, string> = Object.fromEntries(PLACES.filter((p) => p.go).map((p) => [p.go!, p.href]));

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
    rows: PLACES.filter((p) => p.go).map((p) => [['g', p.go!], p.title] as [string[], string]),
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
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('[role="dialog"], dialog[open]') !== null);

function cards() {
  return [...document.querySelectorAll<HTMLElement>('[data-post-card]')].filter((el) => el.offsetParent !== null);
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex min-w-[26px] items-center justify-center rounded-md px-1.5 py-1 font-mono text-12 leading-none text-text ring-1 ring-inset ring-line-strong">{children}</kbd>;
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
      // The sticky bars (header, and tabs where a page has them) are as tall as the page's own variables say.
      const header = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--column-header-h')) || 56) + 8;
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
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
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
      if (pending.current !== null) window.clearTimeout(pending.current);
    };
  }, [router]);

  return (
    <Dialog open={open} onClose={close} title="Keyboard shortcuts" size="lg">
      <div className="overflow-y-auto px-5 pb-5 pt-4">
        <p className="flex items-center gap-2 text-13 text-faint"><Keyboard className="size-4" aria-hidden /> Navigate without leaving the keyboard.</p>
        <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className={group.title === 'Go to' ? 'sm:row-span-2' : undefined}>
              <h3 className="text-12 font-medium uppercase tracking-[0.06em] text-faint">{group.title}</h3>
              <ul className="mt-2.5 space-y-2">
                {group.rows.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-3 text-14 text-muted">
                    <span>{label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-12 text-faint">{keys[0] === '⌘' ? '+' : 'then'}</span>}
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
    </Dialog>
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
