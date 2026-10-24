'use client';

import { useEffect, useState } from 'react';
import { cx } from '@/components/ui';

/** "On this page": the sections as links, the one being read marked as you scroll. */
export function DevToc({ items }: { items: { id: string; label: string; count?: number }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const sections = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;
    let frame = 0;
    // The section being read is the last one whose top has passed just under the sticky header.
    const update = () => {
      frame = 0;
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = sections[0].id;
      for (const s of sections) if (s.getBoundingClientRect().top <= 140) current = s.id;
      setActive(atEnd ? sections[sections.length - 1].id : current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items]);
  return (
    <nav aria-label="Developer guide" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
      <p className="hidden px-3 pb-2 text-12 font-medium text-faint lg:block">On this page</p>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={active === item.id ? 'location' : undefined}
          className={cx('flex shrink-0 items-center justify-between gap-2 rounded-full px-3.5 py-1.5 text-14 transition-colors lg:rounded-lg lg:px-3', active === item.id ? 'bg-active text-text' : 'text-muted hover:bg-hover hover:text-text')}
        >
          {item.label}
          {item.count ? <span className="numeric text-12 text-faint">{item.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}
