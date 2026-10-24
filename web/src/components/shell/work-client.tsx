'use client';

import { PanelRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Tooltip } from '@/components/ui/tooltip';

/** Marks its parent `data-scrolled` once the page has scrolled, so a sticky header can grow a hairline only then. */
export function ScrollEdge() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const update = () => {
      parent.dataset.scrolled = String(window.scrollY > 2);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return <span ref={ref} hidden />;
}

/** Shows or hides the inspector beside the page content (the nearest `[data-inspector]`). It stays out of the way below xl, where the inspector is stacked under the content. */
export function InspectorToggle() {
  return (
    <Tooltip content="Toggle details" shortcut="]" className="hidden xl:inline-flex">
      <button
        type="button"
        aria-label="Toggle details"
        onClick={(e) => {
          const host = e.currentTarget.closest<HTMLElement>('main')?.querySelector<HTMLElement>('[data-inspector]');
          if (host) {
            host.dataset.inspector = host.dataset.inspector === 'closed' ? 'open' : 'closed';
            host.dataset.touched = 'true';
          }
        }}
        className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-text"
      >
        <PanelRight className="size-4" aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * Closes the inspector by default on the pages whose paths match (a regular expression source), such as the
 * code and diff pages that want the whole width, and opens it elsewhere. Once the person has used the toggle
 * their choice stands for the rest of the visit.
 */
export function InspectorDefault({ closedOn }: { closedOn: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || host.dataset.touched === 'true') return;
    host.dataset.inspector = new RegExp(closedOn).test(pathname) ? 'closed' : 'open';
  }, [pathname, closedOn]);
  return <span ref={ref} hidden />;
}
