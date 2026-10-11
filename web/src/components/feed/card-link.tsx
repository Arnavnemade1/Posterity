'use client';

import { useRouter } from 'next/navigation';

/**
 * Makes a whole post open its thread, as on any timeline, without swallowing text selection
 * or the links and buttons inside it.
 */
export function CardLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <div
      className={className}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('a, button, input, textarea, select, summary, [role="button"]')) return;
        if (window.getSelection()?.toString()) return;
        if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener');
        else router.push(href);
      }}
    >
      {children}
    </div>
  );
}
