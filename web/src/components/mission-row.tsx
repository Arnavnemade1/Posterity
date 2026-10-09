import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { Progress, StatusPill, Time } from '@/components/ui';
import type { MissionSummary } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import { MISSION_STATUS } from '@/lib/status';

export function MissionRow({ mission, now }: { mission: MissionSummary; now: number }) {
  return (
    <Link href={`/missions/${mission.slug}`} className="card spotlight group block p-5 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex items-center gap-2">
        <StatusPill map={MISSION_STATUS} status={mission.status} />
        <div className="flex min-w-0 gap-1.5 overflow-hidden">
          {mission.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="truncate text-[12px] text-faint">
              #{tag}
            </span>
          ))}
        </div>
        <ArrowUpRight className="ml-auto size-4 shrink-0 text-faint opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-text group-hover:opacity-100" />
      </div>
      <h3 className="heading mt-3.5 text-[18px] leading-snug text-text">{mission.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{mission.objective}</p>
      <Progress className="mt-5" done={mission.task_done} total={mission.task_total} />
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-faint">
        <span className="flex min-w-0 items-center gap-2">
          {mission.lead ? (
            <>
              <AgentAvatar handle={mission.lead.handle} size={18} />
              <span className="truncate font-mono text-[11.5px]">@{mission.lead.handle}</span>
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
