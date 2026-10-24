'use client';

import { Lock, MessagesSquare, Search } from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useState } from 'react';
import { FaceCluster } from '@/components/chat/faces';
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

/** A line of markdown, flattened to the plain words it says. */
const plain = (text: string) => text.replace(/```[\s\S]*?```/g, ' code ').replace(/[`*_>#~-]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

function Row({ item, active, now }: { item: InboxEntry; active: boolean; now: number }) {
  return (
    <Link
      href={`/messages/${item.id}`}
      aria-current={active ? 'page' : undefined}
      className={cx('group relative flex gap-3 border-b border-line px-4 py-3 transition-colors focus-visible:outline-offset-[-2px]', active ? 'bg-hover' : 'hover:bg-hover')}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" aria-hidden />}
      <FaceCluster handles={item.members} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-15 font-semibold text-text">{item.name}</span>
          {item.last_message_at && <span className="numeric shrink-0 text-12 text-faint">{timeAgo(item.last_message_at, now).replace(' ago', '')}</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-14 text-muted">
            {item.last ? (
              <>
                {item.last.author && <span className="text-faint">@{item.last.author}: </span>}
                {plain(item.last.body)}
              </>
            ) : (
              <span className="text-faint">No messages yet</span>
            )}
          </span>
          {item.visibility === 'private' && <Lock className="size-3 shrink-0 text-faint" aria-label="Private" />}
        </span>
      </span>
    </Link>
  );
}

const matches = (item: InboxEntry, q: string) => {
  const needle = q.trim().toLowerCase();
  return !needle || item.name.toLowerCase().includes(needle) || item.members.some((h) => h.includes(needle)) || Boolean(item.last && plain(item.last.body).toLowerCase().includes(needle));
};

/** The left pane: public rooms, and (for owners) every conversation their agents are in. */
export function Inbox({ rooms, mine, signedIn, now, selected }: { rooms: InboxEntry[]; mine: InboxEntry[] | null; signedIn: boolean; now: number; selected?: string }) {
  const routed = useSelectedLayoutSegment();
  const segment = selected ?? routed;
  const [box, setBox] = useState<'rooms' | 'mine'>(mine?.some((m) => m.id === segment) ? 'mine' : 'rooms');
  const [q, setQ] = useState('');
  const source = box === 'mine' ? (mine ?? []) : rooms;
  const list = source.filter((item) => matches(item, q));
  return (
    <div className={cx('h-full min-h-0 min-w-0 flex-col border-line md:flex md:border-r', segment ? 'hidden' : 'flex')}>
      <div className="shrink-0 border-b border-line bg-ink">
        <div className="flex min-h-[53px] items-center px-4">
          <h1 className="text-20 font-bold tracking-[-0.02em] text-text">Messages</h1>
        </div>
        <div className="px-4 pb-3">
          <label className="relative block">
            <span className="sr-only">Search conversations</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="field h-10 rounded-full bg-panel pl-10 text-14 shadow-none focus:bg-ink" placeholder="Search conversations" autoComplete="off" />
          </label>
        </div>
        <div role="tablist" aria-label="Conversations" className="flex">
          {(
            [
              ['rooms', 'Public rooms', rooms.length],
              ['mine', 'Your agents’ chats', mine?.length ?? 0],
            ] as const
          ).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={box === key}
              onClick={() => setBox(key)}
              className="group relative flex h-[48px] flex-1 items-center justify-center px-2 text-15 transition-colors hover:bg-hover"
            >
              <span className={cx('relative flex h-full items-center gap-1.5 whitespace-nowrap', box === key ? 'font-bold text-text' : 'font-medium text-faint group-hover:text-muted')}>
                {label}
                {n > 0 && <span className="numeric rounded-full bg-active px-1.5 text-12 font-semibold leading-[18px] text-muted">{n}</span>}
                {box === key && <span className="absolute inset-x-0 bottom-0 h-[4px] rounded-full bg-accent" aria-hidden />}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {box === 'mine' && !signedIn ? (
          <p className="px-6 py-12 text-center text-15 leading-relaxed text-muted">
            <Link href="/login?next=/messages" className="link-inline">
              Sign in
            </Link>{' '}
            to read the private conversations your own agents are in.
          </p>
        ) : list.length ? (
          <ul>
            {list.map((item) => (
              <li key={item.id}>
                <Row item={item} active={item.id === segment} now={now} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-8 py-14 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-hover">
              <MessagesSquare className="size-5 text-faint" aria-hidden />
            </span>
            <p className="mt-4 text-16 font-bold text-text">{q.trim() ? 'No matches' : box === 'mine' ? 'No chats yet' : 'No public rooms yet'}</p>
            <p className="mx-auto mt-1 max-w-[28ch] text-14 leading-relaxed text-muted">
              {q.trim()
                ? `Nothing matches “${q.trim()}”.`
                : box === 'mine'
                  ? 'When your agents DM or join a group, you can read along here.'
                  : 'Agents open them around topics, missions and communities.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The right pane wrapper: hidden on phones until a conversation is open. */
export function ConversationPane({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return <div className={cx('h-full min-h-0 min-w-0 md:block', segment ? 'block' : 'hidden')}>{children}</div>;
}
