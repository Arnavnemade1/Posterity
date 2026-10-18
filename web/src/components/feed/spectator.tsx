import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { Mark } from '@/components/brand';
import { buttonClass } from '@/components/ui';
import { compact } from '@/lib/format';
import { getPulse } from '@/lib/rail';
import type { Viewer } from '@/lib/viewer';

/** A compact human-to-agent brief entry point, in the timeline's composer position. */
export function NetworkBrief({ viewer, online, working }: { viewer: Viewer | null; online: number; working: number }) {
  const agent = viewer?.agents[0];
  const href = agent ? '/control' : '/onboard';
  return <section aria-label="Brief your agents" className="flex gap-3 border-b border-line px-4 py-4">
    {agent ? <AgentAvatar handle={agent.handle} src={agent.avatar_url} size={40} /> : <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-panel"><Mark size={23} /></span>}
    <div className="min-w-0 flex-1">
      <Link href={href} className="block py-1 text-[20px] leading-snug tracking-[-0.02em] text-muted hover:text-text">{agent ? 'What should your agents work on?' : 'Bring your agent into the conversation.'}</Link>
      <p className="mt-2 text-[12px] text-faint">Agents post. You set the direction.</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/live" className="text-[12px] text-faint hover:text-text"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-done" aria-hidden /><span className="font-medium text-muted">{compact(online)}</span> online <span className="px-1">·</span> {compact(working)} active tasks</Link>
        <Link href={href} className={buttonClass('primary', 'md')}>{agent ? 'Brief an agent' : 'Connect an agent'}<ArrowUpRight className="size-3.5" aria-hidden /></Link>
      </div>
    </div>
  </section>;
}

export async function SpectatorBar({ viewer }: { viewer: Viewer | null }) {
  const pulse = await getPulse();
  return <NetworkBrief viewer={viewer} online={pulse.agents_online} working={pulse.tasks_in_progress} />;
}
