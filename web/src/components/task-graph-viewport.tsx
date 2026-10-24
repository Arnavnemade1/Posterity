'use client';

import { Maximize, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/ui/icon-button';

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN = 0.35;
const MAX = 2.2;

/**
 * A pannable, zoomable window onto a drawing that is wider than its page: drag to move, scroll with Ctrl or ⌘ (or
 * pinch) to zoom, buttons to zoom and to fit. It opens fitted. A drag never counts as a click on a link inside.
 */
export function GraphViewport({ width, height, children, label = 'Task graph' }: { width: number; height: number; children: React.ReactNode; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const stage = Math.min(Math.max(height + 32, 220), 520);

  const fit = useCallback(() => {
    const w = box.current?.clientWidth ?? width;
    const k = Math.min(1, (w - 32) / width, (stage - 32) / height);
    setView({ k, x: (w - width * k) / 2, y: (stage - height * k) / 2 });
  }, [width, height, stage]);

  useEffect(() => {
    fit();
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  const zoom = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const k = Math.min(MAX, Math.max(MIN, v.k * factor));
      const px = cx ?? (box.current?.clientWidth ?? 0) / 2;
      const py = cy ?? stage / 2;
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    });

  // React attaches wheel listeners as passive, and zooming has to stop the page scrolling, so this one is native.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <div
      ref={box}
      role="group"
      aria-label={`${label}. Drag to move, hold Control or Command and scroll to zoom.`}
      style={{ height: stage, touchAction: 'pan-y' }}
      className="graticule relative cursor-grab overflow-hidden active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as Element).closest('[data-graph-control]')) return;
        drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        if (!d.moved) box.current?.setPointerCapture(e.pointerId);
        d.moved = true;
        setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
      }}
      onPointerUp={(e) => {
        if (drag.current?.moved) box.current?.releasePointerCapture(e.pointerId);
        // Leave `moved` set until the click that follows the release has been swallowed.
        setTimeout(() => (drag.current = null), 0);
      }}
      onClickCapture={(e) => {
        if (drag.current?.moved) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }} className="absolute left-0 top-0 will-change-transform">
        {children}
      </div>
      <div data-graph-control className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-full bg-overlay p-0.5 shadow-pop">
        <IconButton label="Zoom out" size="sm" icon={<Minus />} onClick={() => zoom(1 / 1.25)} />
        <IconButton label="Zoom in" size="sm" icon={<Plus />} onClick={() => zoom(1.25)} />
        <IconButton label="Fit to view" size="sm" icon={<Maximize />} onClick={fit} />
      </div>
    </div>
  );
}
