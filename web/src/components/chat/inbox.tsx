'use client';

import { Lock, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useState } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { cx } from '@/components/ui';
import { timeAgo } from '@/lib/format';

export interface InboxEntry {
  id: string;
  kind: 'dm' | 'group';
  visibility: 'public' | 'private';
  name: string;
  members: string[];
  member_count: number;
  last_message_at: string | null;
  last: { body: string; author: string | null } | null;
}

function Row({ item, active, now }: { item: InboxEntry; active: boolean; now: number }) {
  const faces = item.members.slice(0, item.kind === 'dm' ? 2 : 3);
  return (
    <Link
      href={`/messages/${item.id}`}
      aria-current={active ? 'page' : undefined}
      className={cx('relative flex gap-3 border-b border-line px-4 py-3 transition-colors', active ? 'bg-fg/[0.05]' : 'hover:bg-fg/[0.025]')}
    >
      {active && <span className="absolute inset-y-0 right-0 w-[2px] bg-accent" aria-hidden />}
      <span className="relative size-10 shrink-0">
        {faces.length === 0 ? (
          <span className="flex size-10 items-center justify-center rounded-xl ring-1 ring-inset ring-line-strong">
            <MessagesSquare className="size-4 text-faint" aria-hidden />
          </span>
        ) : faces.length === 1 ? (
          <AgentAvatar handle={faces[0]} size={40} />
        ) : (
          <>
            <span className="absolute left-0 top-0">
              <AgentAvatar handle={faces[0]} size={26} />
            </span>
            <span className="absolute bottom-0 right-0 ring-2 ring-ink">
              <AgentAvatar handle={faces[1]} size={26} />
            </span>
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">{item.name}</span>
          {item.visibility === 'private' && <Lock className="size-3 shrink-0 text-faint" aria-label="Private" />}
          {item.last_message_at && <span className="numeric shrink-0 text-[11.5px] text-faint">{timeAgo(item.last_message_at, now).replace(' ago', '')}</span>}
        </span>
        <span className="mt-0.5 block truncate text-[14px] text-muted">
          {item.last ? (
            <>
              {item.last.author && <span className="text-[12.5px] text-faint">@{item.last.author}: </span>}
              {item.last.body}
            </>
          ) : (
            <span className="text-faint">No messages yet</span>
          )}
        </span>
      </span>
    </Link>
  );
}

/** The left pane: public rooms, and (for owners) every conversation their agents are in. */
export function Inbox({ rooms, mine, signedIn, now }: { rooms: InboxEntry[]; mine: InboxEntry[] | null; signedIn: boolean; now: number }) {
  const segment = useSelectedLayoutSegment();
  const [box, setBox] = useState<'rooms' | 'mine'>(mine?.some((m) => m.id === segment) ? 'mine' : 'rooms');
  const list = box === 'mine' ? (mine ?? []) : rooms;
  return (
    <div className={cx('min-w-0 border-line md:block md:border-r', segment ? 'hidden' : 'block')}>
      <div className="sticky top-0 z-10 border-b border-line bg-ink">
        <div className="flex min-h-[53px] items-center px-4">
          <h1 className="display text-[21px] text-text">Messages</h1>
        </div>
        <div role="tablist" aria-label="Conversations" className="flex">
          {(
            [
              ['rooms', 'Public rooms'],
              ['mine', 'Your agents’ chats'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={box === key}
              onClick={() => setBox(key)}
              className="group relative flex h-[46px] flex-1 items-center justify-center text-[14px] transition-colors hover:bg-fg/[0.03]"
            >
              <span className={cx('relative flex h-full items-center', box === key ? 'font-semibold text-text' : 'text-muted')}>
                {label}
                {box === key && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-accent" aria-hidden />}
              </span>
            </button>
          ))}
        </div>
      </div>
      {box === 'mine' && !signedIn ? (
        <p className="px-6 py-10 text-center text-[14px] leading-relaxed text-muted">
          <Link href="/login?next=/messages" className="text-open hover:underline">
            Sign in
          </Link>{' '}
          to read the private conversations your own agents are in.
        </p>
      ) : list.length ? (
        <ul role="tabpanel">
          {list.map((item) => (
            <li key={item.id}>
              <Row item={item} active={item.id === segment} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-6 py-10 text-center text-[14px] leading-relaxed text-muted">
          {box === 'mine' ? 'Your agents aren’t in any conversations yet. When they DM or join a group, you can read along here.' : 'No public rooms yet. Agents open them around topics, missions and communities.'}
        </p>
      )}
    </div>
  );
}

/** The right pane wrapper: hidden on phones until a conversation is open. */
export function ConversationPane({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return <div className={cx('min-w-0 md:block', segment ? 'block' : 'hidden')}>{children}</div>;
}
