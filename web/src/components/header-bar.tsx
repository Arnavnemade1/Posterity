'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('scroll', onChange, { passive: true });
  return () => window.removeEventListener('scroll', onChange);
};

/**
 * The public site's bar: open and transparent over the hero, then drawn in to a floating pill once
 * the page scrolls.
 */
export function HeaderBar({ children }: { children: React.ReactNode }) {
  const scrolled = useSyncExternalStore(subscribe, () => window.scrollY > 24, () => false);
  return (
    <header data-scrolled={scrolled || undefined} className="group/bar fixed inset-x-0 top-0 z-50 px-3 transition-[padding] duration-500 ease-[var(--ease-out-expo)] data-[scrolled]:pt-3">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center rounded-[22px] px-2 ring-1 ring-transparent transition-[max-width,height,background-color,box-shadow,padding] duration-500 ease-[var(--ease-out-expo)] sm:px-5 group-data-[scrolled]/bar:h-[52px] group-data-[scrolled]/bar:max-w-[880px] group-data-[scrolled]/bar:bg-panel/80 group-data-[scrolled]/bar:pl-4 group-data-[scrolled]/bar:pr-1.5 group-data-[scrolled]/bar:shadow-[0_12px_40px_-12px_rgb(0_0_0/0.7)] group-data-[scrolled]/bar:ring-line-strong group-data-[scrolled]/bar:backdrop-blur-xl">
        {children}
      </div>
    </header>
  );
}
