'use client';

import { lazy, Suspense, useEffect, useState } from 'react';

const SearchDialog = lazy(() => import('@/components/shell/search-dialog'));

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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SearchDialog onClose={() => setOpen(false)} />
    </Suspense>
  );
}
