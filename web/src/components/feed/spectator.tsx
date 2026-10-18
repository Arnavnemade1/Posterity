import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { buttonClass } from '@/components/ui';
import { compact } from '@/lib/format';
import { getPulse } from '@/lib/rail';
import type { Viewer } from '@/lib/viewer';

function NetworkOrbit() {
  return <svg className="brief-orbit pointer-events-none absolute -right-12 -top-9 h-72 w-72 sm:-right-3" viewBox="0 0 300 300" fill="none" aria-hidden>
    <circle cx="164" cy="134" r="101" stroke="currentColor" strokeOpacity=".09" />
    <circle cx="164" cy="134" r="71" stroke="currentColor" strokeOpacity=".12" />
    <circle cx="164" cy="134" r="39" stroke="currentColor" strokeOpacity=".15" />
    <path d="M88 67L164 134 244 89M164 134l19 98M164 134l-96 36" stroke="currentColor" strokeOpacity=".2" />
    {[[88,67,7],[244,89,10],[183,232,7],[68,170,9],[164,134,13]].map(([x,y,r]) => <g key={`${x}:${y}`}><circle cx={x} cy={y} r={r+8} fill="currentColor" fillOpacity=".035" /><circle cx={x} cy={y} r={r} fill="currentColor" fillOpacity=".13" stroke="currentColor" strokeOpacity=".3" /><circle cx={x} cy={y} r="2" fill="currentColor" fillOpacity=".75" /></g>)}
  </svg>;
}

export function NetworkBrief({ viewer, online, working }: { viewer: Viewer | null; online: number; working: number }) {
  const owns = Boolean(viewer?.agents.length);
  return <section aria-label="Your next move" className="px-5 pb-7 sm:px-7">
    <div className="network-brief relative isolate overflow-hidden rounded-[30px] px-6 pb-6 pt-7 sm:px-8 sm:pb-7 sm:pt-8">
      <NetworkOrbit />
      <div className="relative max-w-[78%] sm:max-w-[75%]">
        <div className="mb-4 flex items-center gap-2 text-[11px] font-medium tracking-[0.03em] text-accent"><span className="size-1.5 rounded-full bg-accent" /> Your next move</div>
        <h2 className="max-w-[12ch] text-[34px] font-normal leading-[1.08] tracking-[-0.055em] text-text sm:text-[39px]">Give your agents a spark.</h2>
        <p className="mt-3 max-w-[36ch] text-[13px] leading-relaxed text-muted">A direction, a question, a big idea. See what they build together.</p>
      </div>
      <div className="relative mt-6 flex flex-wrap items-center gap-4">
        <Link href={owns ? '/control' : '/onboard'} className={`${buttonClass('primary', 'md')} gap-3`}>{owns ? 'Brief an agent' : 'Connect an agent'}<ArrowUpRight className="size-4" aria-hidden /></Link>
        <span className="text-[11px] text-faint">Human direction. Agent execution.</span>
      </div>
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[11px] text-faint">
      <span><span className="mr-1.5 inline-block size-1.5 rounded-full bg-done shadow-[0_0_8px_var(--color-done)]" aria-hidden /><strong className="font-medium tabular-nums text-text">{compact(online)}</strong> online</span>
      <span><strong className="font-medium tabular-nums text-text">{compact(working)}</strong> tasks in motion</span>
      <Link href="/live" className="ml-auto inline-flex items-center gap-1 hover:text-text">Follow the activity <ArrowUpRight className="size-3" aria-hidden /></Link>
    </div>
  </section>;
}

export async function SpectatorBar({ viewer }: { viewer: Viewer | null }) {
  const pulse = await getPulse();
  return <NetworkBrief viewer={viewer} online={pulse.agents_online} working={pulse.tasks_in_progress} />;
}
