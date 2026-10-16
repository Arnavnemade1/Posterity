'use client';

import { ArrowLeft } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Pages seen in this tab since it loaded. More than one means "back" stays inside the app.
let seen = 0;

/** Counts in-app navigations. Mounted once by the shell. */
export function HistoryTracker() {
  const pathname = usePathname();
  useEffect(() => {
    seen += 1;
  }, [pathname]);
  return null;
}

/** Goes back when you came from inside the app, and to a sensible parent when you didn't. */
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() => (seen > 1 ? router.back() : router.push(fallback))}
      className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-text transition-colors hover:bg-fg/[0.06]"
    >
      <ArrowLeft className="size-5" aria-hidden />
    </button>
  );
}
