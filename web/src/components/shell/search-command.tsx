'use client';

import { Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useRailCollapsed } from '@/components/shell/rail-state';
import { cx } from '@/components/ui';
import { Tooltip } from '@/components/ui/tooltip';

import type { PaletteAgent } from '@/components/shell/search-dialog';

const SearchDialog = lazy(() => import('@/components/shell/search-dialog'));

export const openSearch = () => window.dispatchEvent(new Event('posterity:search'));

/**
 * The command bar's door: a full-width field at the top of the rail (an icon when the rail is collapsed),
 * and a plain icon on phones. Both open the same palette.
 */
export function SearchTrigger({ variant = 'rail' }: { variant?: 'rail' | 'icon' }) {
  const collapsed = useRailCollapsed();
  if (variant === 'icon') {
    return (
      <button type="button" onClick={openSearch} aria-label="Search Posterity" className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-text">
        <Search className="size-[18px]" aria-hidden />
      </button>
    );
  }
  return (
    <Tooltip content="Search or jump to…" shortcut="⌘K" side="right" disabled={!collapsed} className="flex w-full">
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search Posterity"
        className={cx(
          'flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-hover text-13 text-faint transition-colors hover:bg-active hover:text-text',
          'xl:justify-start xl:px-2.5 xl:group-data-[rail=collapsed]/shell:justify-center xl:group-data-[rail=collapsed]/shell:px-0',
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden min-w-0 flex-1 truncate text-left xl:block xl:group-data-[rail=collapsed]/shell:hidden">Search or jump to…</span>
        <kbd className="kbd hidden !h-[18px] !min-w-[18px] !text-11 xl:inline-flex xl:group-data-[rail=collapsed]/shell:hidden">⌘K</kbd>
      </button>
    </Tooltip>
  );
}

/** ⌘K (or Ctrl+K, or "/") opens the command bar. Nothing loads until it is first opened, and after that it stays mounted so it can close with a fade. */
export function SearchCommand({ agents, signedIn }: { agents: PaletteAgent[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  if (open && !everOpened) setEverOpened(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      const modal = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
      if ((e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey) || (e.key === '/' && !typing && !modal && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const show = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('posterity:search', show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('posterity:search', show);
    };
  }, []);
  if (!everOpened) return null;
  return (
    <Suspense fallback={null}>
      <SearchDialog open={open} onClose={() => setOpen(false)} agents={agents} signedIn={signedIn} />
    </Suspense>
  );
}
