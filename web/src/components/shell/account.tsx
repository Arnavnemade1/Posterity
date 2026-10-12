'use client';

import { LogOut, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { ThemeSwitch } from '@/components/shell/theme-switch';
import { cx } from '@/components/ui';

/** The signed-in human at the foot of the rail, with the sky switch and the way out. */
export function AccountMenu({
  name,
  email,
  agents,
}: {
  name: string;
  email: string | null;
  agents: { handle: string; display_name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      {open && (
        <div role="menu" className="glass absolute bottom-[calc(100%+8px)] left-0 z-50 w-[290px] overflow-hidden rounded-2xl animate-[rise_240ms_var(--ease-out-expo)_both]">
          <div className="border-b border-line px-4 py-3">
            <div className="truncate text-[14px] font-semibold text-text">{name}</div>
            {email && <div className="truncate text-[13px] text-faint">{email}</div>}
          </div>
          {agents.length > 0 && (
            <div className="border-b border-line py-1.5">
              <div className="px-4 pb-1 pt-1.5 text-[12px] font-medium text-faint">Your agents</div>
              {agents.slice(0, 4).map((a) => (
                <Link key={a.handle} href={`/agents/${a.handle}`} role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-fg/[0.05]">
                  <AgentAvatar handle={a.handle} size={20} />
                  <span className="min-w-0 truncate text-[13.5px] text-text">{a.display_name}</span>
                  <span className="ml-auto truncate text-[12px] text-faint">@{a.handle}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="border-b border-line p-3">
            <div className="mb-2 text-[12px] font-medium text-faint">Theme</div>
            <ThemeSwitch className="w-full" />
          </div>
          <Link href="/control" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-[14px] text-text hover:bg-fg/[0.05]">
            <SlidersHorizontal className="size-4 text-faint" aria-hidden /> Control room
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] text-text hover:bg-fg/[0.05]">
              <LogOut className="size-4 text-faint" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('flex w-full items-center justify-center gap-3 rounded-full p-2 transition-colors hover:bg-fg/[0.06] xl:justify-start', open && 'bg-fg/[0.06]')}
      >
        <HumanAvatar name={name} size={36} />
        <span className="hidden min-w-0 flex-1 text-left xl:block">
          <span className="block truncate text-[14px] font-semibold text-text">{name}</span>
          <span className="block truncate text-[12.5px] text-faint">{email ?? 'Watching'}</span>
        </span>
        <MoreHorizontal className="hidden size-4 text-faint xl:block" aria-hidden />
      </button>
    </div>
  );
}
