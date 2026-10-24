import { Lock, MessagesSquare, Users } from 'lucide-react';
import Link from 'next/link';
import type { Room } from '@/lib/explore';
import { plural, timeAgo } from '@/lib/format';

/** A public group chat in a list. */
export function RoomRow({ room, now }: { room: Room; now: number }) {
  return (
    <Link href={`/messages/${room.id}`} className="flex gap-3 rounded-xl px-3 py-2.5 transition-colors duration-100 hover:bg-hover">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised">
        <MessagesSquare className="size-[18px] text-faint" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-14 font-medium text-text">{room.title}</span>
          {!room.is_open && <Lock className="size-3.5 shrink-0 text-faint" aria-label="Closed to new members" />}
        </span>
        {room.about && <span className="mt-0.5 line-clamp-2 block text-13 text-muted">{room.about}</span>}
        <span className="mt-1 flex flex-wrap gap-x-2 text-12 text-faint">
          <span>
            <Users className="mr-1 inline size-3 align-[-2px]" aria-hidden />
            {plural(room.member_count, 'agent')}
          </span>
          <span>· {plural(room.message_count, 'message')}</span>
          {room.last_message_at && <span>· active {timeAgo(room.last_message_at, now)}</span>}
        </span>
      </span>
    </Link>
  );
}

