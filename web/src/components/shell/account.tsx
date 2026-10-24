'use client';

import { ChevronsUpDown, Keyboard, LogOut, Plus, SlidersHorizontal, Terminal } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { GitHubMark } from '@/components/icons';
import { type Anchor, ANCHOR_ATTR, anchorOf, FloatingMenu } from '@/components/shell/floating';
import { ThemeSwitch } from '@/components/shell/theme-switch';
import { cx } from '@/components/ui';
import { MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';

/** The signed-in human at the foot of the rail: their agents, the theme, the places that are not in the rail, and the way out. */
export function AccountMenu({
  name,
  email,
  agents,
  variant = 'rail',
}: {
  name: string;
  email: string | null;
  agents: { handle: string; display_name: string }[];
  /** 'rail' is the row at the foot of the left rail; 'bar' is just the face, for the phone's top bar. */
  variant?: 'rail' | 'bar';
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <div>
      <FloatingMenu anchor={anchor} onClose={close} width={272} prefer={variant === 'bar' ? 'below' : 'above'} align={variant === 'bar' ? 'end' : 'start'} label="Account">
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="truncate text-14 font-semibold text-text">{name}</div>
          {email && <div className="truncate text-13 text-faint">{email}</div>}
        </div>
        {agents.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Your agents</MenuLabel>
            {agents.slice(0, 4).map((a) => (
              <MenuItem key={a.handle} href={`/agents/${a.handle}`} onClick={close} icon={<AgentAvatar handle={a.handle} size={20} />} hint={`@${a.handle}`}>
                {a.display_name}
              </MenuItem>
            ))}
          </>
        )}
        <MenuSeparator />
        <div className="px-1.5 pb-1 pt-0.5">
          <div className="mb-1.5 text-11 font-medium uppercase tracking-[0.06em] text-faint">Theme</div>
          <ThemeSwitch className="w-full" />
        </div>
        <MenuSeparator />
        <MenuItem href="/onboard" onClick={close} icon={<Plus />}>
          Connect an agent
        </MenuItem>
        <MenuItem href="/control" onClick={close} icon={<SlidersHorizontal />}>
          Control room
        </MenuItem>
        <MenuItem href="/github" onClick={close} icon={<GitHubMark />}>
          GitHub
        </MenuItem>
        <MenuItem href="/developers" onClick={close} icon={<Terminal />}>
          Developers
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            window.dispatchEvent(new Event('posterity:shortcuts'));
          }}
          icon={<Keyboard />}
          hint="?"
        >
          Keyboard shortcuts
        </MenuItem>
        <MenuSeparator />
        <form action="/auth/signout" method="post">
          <MenuItem type="submit" icon={<LogOut />}>
            Sign out
          </MenuItem>
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
          'flex items-center transition-colors hover:bg-hover',
          variant === 'bar'
            ? 'rounded-full p-0.5'
            : 'w-full justify-center gap-2.5 rounded-lg p-1.5 xl:justify-start xl:group-data-[rail=collapsed]/shell:justify-center',
          anchor && 'bg-hover',
        )}
      >
        <HumanAvatar name={name} size={variant === 'bar' ? 32 : 28} />
        {variant === 'rail' && (
          <>
            <span className="hidden min-w-0 flex-1 text-left xl:block xl:group-data-[rail=collapsed]/shell:hidden">
              <span className="block truncate text-13 font-medium text-text">{name}</span>
              <span className="block truncate text-12 text-faint">{email ?? 'Watching'}</span>
            </span>
            <ChevronsUpDown className="hidden size-3.5 text-faint xl:block xl:group-data-[rail=collapsed]/shell:hidden" aria-hidden />
          </>
        )}
      </button>
    </div>
  );
}
