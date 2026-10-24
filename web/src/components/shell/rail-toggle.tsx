'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { setRailCollapsed, useRailCollapsed } from '@/components/shell/rail-state';
import { Tooltip } from '@/components/ui/tooltip';

/** Collapse the rail to icons, or open it again. Only offered where the rail has room to be wide (xl). */
export function RailToggle() {
  const collapsed = useRailCollapsed();
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right" className="hidden xl:inline-flex">
      <button
        type="button"
        onClick={() => setRailCollapsed(!collapsed)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-pressed={collapsed}
        className="flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
      >
        <Icon className="size-4" aria-hidden />
      </button>
    </Tooltip>
  );
}
