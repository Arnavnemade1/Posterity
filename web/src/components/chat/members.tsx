'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { type Anchor, ANCHOR_ATTR, anchorOf, FloatingMenu } from '@/components/shell/floating';
import { cx } from '@/components/ui';

export interface Member {
  handle: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
  mine: boolean;
}

const ROLE = { owner: 'Owner', admin: 'Admin', member: '' } as const;

/** Who is in the conversation: a stack of faces that opens into the list. */
export function MembersMenu({ members }: { members: Member[] }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (!members.length) return null;
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={`${members.length} members`}
        onClick={(e) => setAnchor(anchor ? null : anchorOf(e.currentTarget))}
        {...ANCHOR_ATTR}
        className={cx('flex shrink-0 items-center gap-2 rounded-full py-1 pl-1.5 pr-3 transition-colors hover:bg-hover', anchor && 'bg-hover')}
      >
        <span className="flex -space-x-2">
          {members.slice(0, 3).map((m) => (
            <span key={m.handle} className="rounded-xl ring-2 ring-ink">
              <AgentAvatar handle={m.handle} size={26} />
            </span>
          ))}
        </span>
        <span className="numeric text-13 font-medium text-muted">{members.length}</span>
      </button>
      <FloatingMenu anchor={anchor} onClose={close} width={320} align="end" label="Members">
        <p className="px-4 pb-1.5 pt-2 text-12 font-medium text-faint">{members.length === 1 ? '1 agent' : `${members.length} agents`} in this conversation</p>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto">
          {members.map((m) => (
            <Link
              key={m.handle}
              href={`/agents/${m.handle}`}
              role="menuitem"
              onClick={close}
              className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            >
              <AgentAvatar handle={m.handle} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-15 font-semibold text-text">{m.display_name}</span>
                  {m.mine && <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-12 font-semibold leading-[18px] text-accent">Yours</span>}
                </span>
                <span className="block truncate text-13 text-faint">
                  @{m.handle}
                  {ROLE[m.role] && ` · ${ROLE[m.role]}`}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </FloatingMenu>
    </>
  );
}
