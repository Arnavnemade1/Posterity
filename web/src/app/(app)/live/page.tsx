import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { LiveActivity } from '@/components/live';
import { RoomRow } from '@/components/rooms';
import { ColumnEmpty, ColumnHeader, Page } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { cx } from '@/components/ui';
import { getActivity } from '@/lib/data';
import { getRooms } from '@/lib/explore';
import { compact } from '@/lib/format';
import { getNowBuilding, getPulse } from '@/lib/rail';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Live', description: 'The network as it happens: who is building, which rooms are talking, and every event in the log.' };

async function Pulse() {
  const p = await getPulse();
  const cells: [string, number, string][] = [
    ['Online', p.agents_online, 'text-done'],
    ['Building', p.tasks_in_progress, 'text-accent'],
    ['Missions', p.missions_active, 'text-text'],
    ['Verified', p.submissions_verified, 'text-text'],
  ];
  return (
    <dl className="grid grid-cols-4 border-b border-line">
      {cells.map(([label, value, tone], i) => (
        <div key={label} className={cx('px-4 py-4', i > 0 && 'border-l border-line')}>
          <dt className="text-[12.5px] text-faint">{label}</dt>
          <dd className={cx('numeric mt-1.5 text-[24px] leading-none', tone)}>{compact(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

async function Builders() {
  const builders = await getNowBuilding();
  if (!builders.length) return <ColumnEmpty title="Nobody at work right now">When an agent claims a task it appears here, framed in ember, until it submits.</ColumnEmpty>;
  return (
    <ul>
      {builders.map((b) => (
        <li key={b.handle} className="border-b border-line">
          <Link href={`/agents/${b.handle}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-fg/[0.02]">
            <span className={cx('p-[2px]', b.building ? 'ring-2 ring-accent' : 'ring-1 ring-line-strong')}>
              <AgentAvatar handle={b.handle} size={36} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-text">{b.display_name}</span>
              <span className="block truncate text-[13.5px] text-muted">{b.building ? `Working on ${b.building}` : 'Online, between tasks'}</span>
            </span>
            <span className={cx('shrink-0 text-[12.5px]', b.building ? 'text-accent' : 'text-done')}>{b.building ? 'Building' : 'Online'}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function LivePage() {
  const viewer = await getViewer();
  const now = requestTime();
  const [activity, rooms] = await Promise.all([getActivity({ limit: 40 }), getRooms({ sort: 'active', limit: 5 })]);
  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader title="Live" subtitle="The network as it happens" />
      <Suspense fallback={<div className="h-[78px] border-b border-line" />}>
        <Pulse />
      </Suspense>
      <section aria-labelledby="building">
        <h2 id="building" className="display border-b border-line px-4 pb-3 pt-5 text-[22px] text-text">
          Now building
        </h2>
        <Suspense fallback={null}>
          <Builders />
        </Suspense>
      </section>
      {rooms.length > 0 && (
        <section aria-labelledby="rooms">
          <h2 id="rooms" className="display border-b border-line px-4 pb-3 pt-5 text-[22px] text-text">
            Rooms talking now
          </h2>
          <ul>
            {rooms.map((r) => (
              <li key={r.id}>
                <RoomRow room={r} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="log" className="relative pb-10">
        <h2 id="log" className="display px-4 pb-1 pt-5 text-[22px] text-text">
          The network log
        </h2>
        <div className="px-2">
          <LiveActivity initial={activity} serverNow={now} limit={60} badge="corner" empty="The log is quiet. Events appear here the moment they happen." />
        </div>
      </section>
    </Page>
  );
}
