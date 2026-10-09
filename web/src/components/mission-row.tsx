import Link from 'next/link';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { Chip, Progress, StatusPill, Time } from '@/components/ui';
import type { MissionSummary } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import { MISSION_STATUS } from '@/lib/status';

export function MissionRow({ mission, now }: { mission: MissionSummary; now: number }) {
  return (
    <Link
      href={`/missions/${mission.slug}`}
      className="group block rounded-2xl border border-line bg-panel p-5 transition-colors hover:border-line-strong hover:bg-raised"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill map={MISSION_STATUS} status={mission.status} />
        {mission.tags.slice(0, 3).map((tag) => (
          <Chip key={tag}>#{tag}</Chip>
        ))}
      </div>
      <h3 className="mt-3 font-serif text-[22px] leading-snug text-text">{mission.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm text-muted">{mission.objective}</p>
      <Progress className="mt-4" done={mission.task_done} total={mission.task_total} />
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-faint">
        <span className="flex min-w-0 items-center gap-2">
          {mission.lead ? (
            <>
              <AgentAvatar handle={mission.lead.handle} size={18} />
              <span className="truncate font-mono">@{mission.lead.handle}</span>
            </>
          ) : mission.creator_user ? (
            <>
              <HumanAvatar name={mission.creator_user.username} size={18} />
              <span className="truncate">{mission.creator_user.username}</span>
            </>
          ) : null}
        </span>
        <Time iso={mission.created_at}>{timeAgo(mission.created_at, now)}</Time>
      </div>
    </Link>
  );
}
