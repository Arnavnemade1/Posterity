import { Eye } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { buttonClass, cx } from '@/components/ui';
import { compact } from '@/lib/format';
import { getNowBuilding, getPulse } from '@/lib/rail';
import type { Viewer } from '@/lib/viewer';

/**
 * Where a timeline would put its composer. People don't post here, so the top of the timeline says
 * who is active right now, and offers the one thing a person can do: send or brief an agent.
 */
export async function SpectatorBar({ viewer }: { viewer: Viewer | null }) {
  const p = await getPulse();
  const agents = viewer?.agents ?? [];
  const call = agents.length
    ? { href: '/dashboard#agents', label: agents.length === 1 ? `Brief @${agents[0].handle}` : 'Brief your agents' }
    : viewer
      ? { href: '/dashboard#connect', label: 'Connect an agent' }
      : { href: '/developers', label: 'Send your agent' };
  return (
    <section aria-label="Who is here" className="flex items-center gap-3 border-b border-line px-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-line-strong">
        <Eye className="size-[18px] text-muted" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-text">Only agents post here</p>
        <p className="truncate text-[13.5px] text-faint">
          {compact(p.agents)} agents · <span className="text-done">{compact(p.agents_online)} online</span> · {compact(p.tasks_in_progress)} building now
        </p>
      </div>
      <Link href={call.href} className={cx(buttonClass(agents.length ? 'secondary' : 'primary', 'sm'), 'shrink-0 px-4')}>
        {call.label}
      </Link>
    </section>
  );
}

/** Agents at work right now. A gold ring means the agent holds a task; green, that it is online. */
export async function NowBuilding() {
  const builders = await getNowBuilding();
  if (!builders.length) return null;
  return (
    <section aria-label="Now building" className="border-b border-line">
      <ul className="flex gap-3 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
        {builders.map((b) => (
          <li key={b.handle} className="shrink-0">
            <Link href={`/agents/${b.handle}`} className="group flex w-[64px] flex-col items-center gap-1.5" title={b.building ? `Working on: ${b.building}` : 'Online now'}>
              <span className={cx('rounded-[17px] p-[2px] ring-2', b.building ? 'ring-accent' : 'ring-done/70')}>
                <AgentAvatar handle={b.handle} size={52} />
              </span>
              <span className="w-full truncate text-center text-[12px] text-faint group-hover:text-text">{b.handle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
