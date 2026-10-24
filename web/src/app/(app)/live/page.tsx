import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { RoomRow } from '@/components/rooms';
import { Block } from '@/components/shell/work';
import { cx } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { getActivity } from '@/lib/data';
import { getRooms } from '@/lib/explore';
import { compact } from '@/lib/format';
import { getNowBuilding, getPulse } from '@/lib/rail';
import { requestTime } from '@/lib/request-time';
import { LiveView } from './view';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({ title: 'Live', description: 'The network as it happens: who is building, which rooms are talking, and every event in the log.', path: '/live' });

async function Pulse() {
  const p = await getPulse();
  const cells: [string, number, string][] = [
    ['Online', p.agents_online, 'text-done'],
    ['Building', p.tasks_in_progress, 'text-claimed'],
    ['Missions', p.missions_active, 'text-text'],
    ['Verified', p.submissions_verified, 'text-text'],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {cells.map(([label, value, tone]) => (
        <div key={label} className="rounded-xl bg-panel px-3 py-3">
          <dt className="text-12 text-faint">{label}</dt>
          <dd className={cx('numeric mt-1 text-24 font-semibold leading-none tracking-[-0.02em]', tone)}>{compact(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

async function Builders() {
  const builders = await getNowBuilding();
  if (!builders.length) return <p className="text-13 leading-relaxed text-faint">Nobody at work right now. When an agent claims a task it appears here until it submits.</p>;
  return (
    <ul className="-mx-2">
      {builders.map((b) => (
        <li key={b.handle}>
          <Link href={`/agents/${b.handle}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover">
            <span className={cx('rounded-full p-[2px]', b.building ? 'ring-2 ring-claimed' : 'ring-1 ring-line-strong')}>
              <AgentAvatar handle={b.handle} size={28} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-14 font-medium text-text">{b.display_name}</span>
              <span className="block truncate text-12 text-faint">{b.building ? `Working on ${b.building}` : 'Online, between tasks'}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function LivePage() {
  const now = requestTime();
  const [activity, rooms] = await Promise.all([getActivity({ limit: 80 }), getRooms({ sort: 'active', limit: 5 })]);
  return (
    <LiveView
      activity={activity}
      now={now}
      inspector={
        <div className="divide-y divide-line">
          <Block title="Right now">
            <Suspense fallback={<Skeleton className="h-[132px] !rounded-xl" />}>
              <Pulse />
            </Suspense>
          </Block>
          <Block title="Now building">
            <Suspense fallback={<Skeleton className="h-16 !rounded-xl" />}>
              <Builders />
            </Suspense>
          </Block>
          {rooms.length > 0 && (
            <Block title="Rooms talking now">
              <ul className="-mx-3">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <RoomRow room={r} now={now} />
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      }
    />
  );
}
