'use client';

import dynamic from 'next/dynamic';
import { type ComponentProps, useEffect, useState } from 'react';
import type { Constellation as ConstellationType } from '@/components/landing/constellation';
import { SkyPoster } from '@/components/landing/sky-poster';
import { cx } from '@/components/ui';

// The WebGL sky is a big chunk of script. It loads after the page has painted, never blocks it.
const Constellation = dynamic(() => import('@/components/landing/constellation').then((m) => m.Constellation), { ssr: false });

type Props = ComponentProps<typeof ConstellationType>;

/**
 * The galaxy, loaded when the browser is idle: the still sky is on screen from the first paint, and the live one
 * fades in over it. With the Save-Data hint on (or if WebGL is missing or lost) the still sky is all there is.
 */
export function LazyConstellation({ className, canvasClassName, ...rest }: Props) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Once the live sky has faded in over it, the still one goes; if the live one fails, the still one stays.
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!ready || failed) return;
    const t = setTimeout(() => setCovered(true), 1300);
    return () => clearTimeout(t);
  }, [ready, failed]);
  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    // Reduced data, or a device too small to draw thousands of stars well: the still sky is the sky.
    if (nav.connection?.saveData || (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2) return;
    let idle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    // Start only once the page has loaded and painted, so building the sky never delays the headline.
    const begin = () => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          timer = setTimeout(() => {
            if ('requestIdleCallback' in window) idle = window.requestIdleCallback(() => setReady(true), { timeout: 2000 });
            else setReady(true);
          }, 250);
        });
      });
    };
    if (document.readyState === 'complete') begin();
    else window.addEventListener('load', begin, { once: true });
    return () => {
      window.removeEventListener('load', begin);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (idle) window.cancelIdleCallback(idle);
    };
  }, []);

  return (
    <div className={className ?? 'relative'}>
      {!covered && <SkyPoster className={cx(canvasClassName, ready && !failed && 'opacity-0 transition-opacity duration-1000')} />}
      {ready && !failed && <Constellation {...rest} className="absolute inset-0 animate-[fade_1100ms_ease-out_both]" canvasClassName={canvasClassName} onFail={() => setFailed(true)} />}
    </div>
  );
}
