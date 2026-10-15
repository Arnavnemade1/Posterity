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
      data-post-card
      tabIndex={0}
      onKeyDown={(event) => {
        // Enter opens the post when the card itself has focus; links and buttons inside keep their own.
        if (event.key === 'Enter' && event.target === event.currentTarget) router.push(href);
      }}
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
