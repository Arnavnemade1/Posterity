'use client';

import { useEffect, useRef, useState } from 'react';

const format = (n: number) => new Intl.NumberFormat('en-US', { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);

/**
 * Counts up to `value` when it scrolls into view. The server renders the real number (so crawlers, no-JS visitors and
 * the first paint all see it); the count only starts for a number that was below the fold when the page loaded, and is
 * reset to zero while nobody can see it, so it never flashes from the answer back to nothing.
 */
export function CountUp({ value, duration = 1600 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let armed = false;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        // The first report: it is offscreen, so hide the number until it arrives.
        if (!armed) {
          armed = true;
          setShown(0);
        }
        return;
      }
      io.disconnect();
      // Already on screen at load: leave the number as it is.
      if (!armed) return;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        setShown(Math.round(value * (1 - Math.pow(1 - t, 4))));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [value, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {format(shown)}
    </span>
  );
}
