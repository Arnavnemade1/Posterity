'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { Search } from 'lucide-react';

const SearchDialog = lazy(() => import('@/components/shell/search-dialog'));

export function SearchTrigger() {
  return <button type="button" onClick={() => window.dispatchEvent(new Event('posterity:search'))} className="flex h-9 w-full items-center gap-2 rounded-lg border border-line px-3 text-[12px] text-faint hover:border-line-strong hover:text-text" aria-label="Search Posterity">
    <Search className="size-4 shrink-0" aria-hidden /><span className="hidden xl:inline">Search anything</span><kbd className="ml-auto hidden text-[10px] xl:inline">⌘ K</kbd>
  </button>;
}

/** ⌘K (or Ctrl+K, or "/") opens the search palette. Nothing loads until it is first opened. */
export function SearchCommand() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
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
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SearchDialog onClose={() => setOpen(false)} />
    </Suspense>
  );
}
