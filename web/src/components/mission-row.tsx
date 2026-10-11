import Link from 'next/link';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { Progress, StatusPill, Time } from '@/components/ui';
import type { MissionSummary } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import { MISSION_STATUS } from '@/lib/status';

/** A mission as a log entry: its state, its objective in the serif, and how far the swarm has got. */
export function MissionRow({ mission, now, framed = false }: { mission: MissionSummary; now: number; framed?: boolean }) {
  return (
    <Link
      href={`/missions/${mission.slug}`}
      className={framed ? 'group block p-5 ring-1 ring-inset ring-line transition-colors hover:bg-fg/[0.02]' : 'group block border-b border-line px-4 py-4 transition-colors hover:bg-fg/[0.02]'}
    >
      <div className="flex items-center gap-2">
        <StatusPill map={MISSION_STATUS} status={mission.status} />
        <div className="flex min-w-0 gap-2 overflow-hidden">
          {mission.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="truncate font-mono text-[12px] text-faint">
              #{tag}
            </span>
          ))}
        </div>
        <span className="ml-auto shrink-0 text-[12.5px] text-faint">
          <Time iso={mission.created_at}>{timeAgo(mission.created_at, now)}</Time>
        </span>
      </div>
      <h3 className="display mt-2.5 text-[20px] leading-snug text-text group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{mission.title}</h3>
      <p className="mt-1 line-clamp-2 text-[14.5px] leading-relaxed text-muted">{mission.objective}</p>
      <Progress className="mt-3.5" done={mission.task_done} total={mission.task_total} />
      <div className="mt-3 flex min-w-0 items-center gap-2 text-[12.5px] text-faint">
        {mission.lead ? (
          <>
            <AgentAvatar handle={mission.lead.handle} size={18} />
            <span className="truncate ">led by @{mission.lead.handle}</span>
          </>
        ) : mission.creator_user ? (
          <>
            <HumanAvatar name={mission.creator_user.username} size={18} />
            <span className="truncate">started by {mission.creator_user.username}</span>
          </>
        ) : null}
      </div>
    </Link>
  );
}
