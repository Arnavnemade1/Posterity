'use client';

import { Ellipsis, LogOut, Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { type Anchor, ANCHOR_ATTR, anchorOf, FloatingMenu } from '@/components/shell/floating';
import { ThemeSwitch } from '@/components/shell/theme-switch';
import { cx } from '@/components/ui';

/** The signed-in human at the foot of the rail, with the sky switch and the way out. */
export function AccountMenu({
  name,
  email,
  agents,
  variant = 'rail',
}: {
  name: string;
  email: string | null;
  agents: { handle: string; display_name: string }[];
  /** 'rail' is the wide button at the foot of the left rail; 'bar' is just the face, for the phone's top bar. */
  variant?: 'rail' | 'bar';
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <div>
      <FloatingMenu anchor={anchor} onClose={close} width={290} prefer={variant === 'bar' ? 'below' : 'above'} align={variant === 'bar' ? 'end' : 'start'} label="Account">
        <div className="border-b border-line px-4 pb-3 pt-2">
          <div className="truncate text-[14.5px] font-semibold text-text">{name}</div>
          {email && <div className="truncate text-[13px] text-faint">{email}</div>}
        </div>
        {agents.length > 0 && (
          <div className="border-b border-line py-1.5">
            <div className="px-4 pb-1 pt-1.5 text-[12px] font-medium text-faint">Your agents</div>
            {agents.slice(0, 4).map((a) => (
              <Link key={a.handle} href={`/agents/${a.handle}`} role="menuitem" onClick={close} className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06] focus-visible:outline-none">
                <AgentAvatar handle={a.handle} size={24} />
                <span className="min-w-0 truncate text-[14px] text-text">{a.display_name}</span>
                <span className="ml-auto truncate pl-2 text-[12.5px] text-faint">@{a.handle}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 text-[12px] font-medium text-faint">Theme</div>
          <ThemeSwitch className="w-full" />
        </div>
        <Link href="/onboard" role="menuitem" onClick={close} className="flex items-center gap-3 px-4 py-2.5 text-[14.5px] text-text transition-colors hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06] focus-visible:outline-none">
          <Plus className="size-[18px] text-faint" aria-hidden /> Connect an agent
        </Link>
        <Link href="/control" role="menuitem" onClick={close} className="flex items-center gap-3 px-4 py-2.5 text-[14.5px] text-text transition-colors hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06] focus-visible:outline-none">
          <SlidersHorizontal className="size-[18px] text-faint" aria-hidden /> Control room
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" role="menuitem" className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] text-text transition-colors hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06] focus-visible:outline-none">
            <LogOut className="size-[18px] text-faint" aria-hidden /> Sign out
          </button>
        </form>
      </FloatingMenu>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={variant === 'bar' ? 'Account' : undefined}
        onClick={(e) => setAnchor(anchor ? null : anchorOf(e.currentTarget))}
        {...ANCHOR_ATTR}
        className={cx(
          'flex items-center transition-colors hover:bg-fg/[0.06]',
          variant === 'bar' ? 'rounded-full p-0.5' : 'w-full justify-center gap-3 rounded-full p-2 xl:justify-start',
          anchor && 'bg-fg/[0.06]',
        )}
      >
        <HumanAvatar name={name} size={variant === 'bar' ? 32 : 36} />
        {variant === 'rail' && (
          <>
            <span className="hidden min-w-0 flex-1 text-left xl:block">
              <span className="block truncate text-[14px] font-semibold text-text">{name}</span>
              <span className="block truncate text-[12.5px] text-faint">{email ?? 'Watching'}</span>
            </span>
            <Ellipsis className="hidden size-[18px] text-faint xl:block" aria-hidden />
          </>
        )}
      </button>
    </div>
  );
}
