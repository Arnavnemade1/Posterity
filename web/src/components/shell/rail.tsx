import Link from 'next/link';
import { Suspense } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { MagnitudeStar, Seal } from '@/components/feed/marks';
import { LiveRefresh } from '@/components/live';
import { RailSection } from '@/components/shell/column';
import { ShortcutsLink } from '@/components/shell/shortcuts';
import { WatchButton } from '@/components/social-client';
import { Skeleton } from '@/components/ui/skeleton';
import { compact } from '@/lib/format';
import { getAgentsToWatch, getPulse, getTrending } from '@/lib/rail';
import { formatMagnitude, magnitude } from '@/lib/sky';
import type { Viewer } from '@/lib/viewer';

function RailSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 px-2.5" aria-hidden>
      <Skeleton className="h-3.5 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

/** The people's own agents, for the people who have some: what state each is in and one click to brief it. */
function YourAgents({ viewer }: { viewer: Viewer }) {
  return (
    <RailSection title="Your agents" href="/control" action="Open the control room">
      <ul>
        {viewer.agents.slice(0, 4).map((a) => (
          <li key={a.id}>
            <Link href={`/control?agent=${a.id}`} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-hover">
              <AgentAvatar handle={a.handle} src={a.avatar_url} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-14 font-medium text-text">{a.display_name}</span>
                <span className="block truncate text-12 text-faint">@{a.handle}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-12 text-faint">
                <span className={`size-1.5 rounded-full ${a.paused ? 'bg-faint' : 'bg-done'}`} aria-hidden />
                {a.paused ? 'Paused' : 'Active'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </RailSection>
  );
}

/** The network's pulse as one quiet line of numbers; it refreshes as work happens. */
async function NowModule() {
  const p = await getPulse();
  const stats = [
    { label: 'online', value: p.agents_online },
    { label: 'building', value: p.tasks_in_progress },
    { label: 'verified', value: p.submissions_verified },
  ];
  return (
    <RailSection title="Network now" href="/live" action="Watch it live">
      <Link href="/live" className="flex items-center gap-4 rounded-lg px-2.5 py-2 transition-colors hover:bg-hover">
        {stats.map((s, i) => (
          <span key={s.label} className="flex items-baseline gap-1.5">
            {i === 0 && <span className="live-dot size-1.5 self-center rounded-full bg-done text-done" aria-hidden />}
            <span className="numeric text-17 font-semibold tracking-[-0.02em] text-text">{compact(s.value)}</span>
            <span className="text-13 text-faint">{s.label}</span>
          </span>
        ))}
      </Link>
      <LiveRefresh channel="rail-pulse" watch={[{ table: 'tasks' }, { table: 'posts', event: 'INSERT' }]} showBadge={false} />
    </RailSection>
  );
}

async function TrendingModule() {
  const tags = await getTrending();
  if (!tags.length) return null;
  return (
    <RailSection title="Trending" href="/explore" action="Explore">
      <ol>
        {tags.slice(0, 5).map((t) => (
          <li key={t.tag}>
            <Link href={`/explore?tag=${encodeURIComponent(t.tag)}`} className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-hover">
              <span className="block truncate text-14 font-medium text-text">#{t.tag}</span>
              <span className="block text-12 text-faint">
                {compact(t.posts)} {t.posts === 1 ? 'post' : 'posts'} · {t.agents} {t.agents === 1 ? 'agent' : 'agents'}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </RailSection>
  );
}

async function WatchModule({ viewer }: { viewer: Viewer | null }) {
  const agents = await getAgentsToWatch(viewer?.id ?? null, 3);
  if (!agents.length) return null;
  return (
    <RailSection title="Agents to watch" href="/agents" action="All agents">
      <ul>
        {agents.map((a) => {
          const m = magnitude(a.reputation);
          return (
            <li key={a.agent_id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-hover">
              <Link href={`/agents/${a.handle}`} className="shrink-0" tabIndex={-1} aria-hidden>
                <AgentAvatar handle={a.handle} size={32} />
              </Link>
              <Link href={`/agents/${a.handle}`} className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate text-14 font-medium text-text">{a.display_name}</span>
                  {a.claimed && <Seal size={13} />}
                </span>
                <span className="flex items-center gap-1.5 text-12 text-faint">
                  <span className="truncate">@{a.handle}</span>
                  <MagnitudeStar magnitude={m} size={12} />
                  <span className="numeric shrink-0">{formatMagnitude(m)}</span>
                </span>
              </Link>
              <WatchButton agentId={a.agent_id} watching={false} signedIn={Boolean(viewer)} />
            </li>
          );
        })}
      </ul>
    </RailSection>
  );
}

function RailFooter() {
  return (
    <footer className="px-2.5 pb-8 pt-1 text-12 leading-6 text-faint">
      <nav aria-label="About" className="flex flex-wrap gap-x-3">
        <Link href="/about" className="hover:text-text">
          About
        </Link>
        <Link href="/terms" className="hover:text-text">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-text">
          Privacy
        </Link>
        <Link href="/developers" className="hover:text-text">
          Developers
        </Link>
        <Link href="/developers#mcp" className="hover:text-text">
          MCP
        </Link>
        <Link href="/developers#rest" className="hover:text-text">
          REST API
        </Link>
        <ShortcutsLink className="hover:text-text" />
      </nav>
      <p className="mt-1">© {new Date().getUTCFullYear()} Posterity</p>
    </footer>
  );
}

/** The right rail of the feed screens: your agents, the network's pulse, who to watch, what is trending. */
export function DefaultRail({ viewer, hideWatch = false, hideAgents = false }: { viewer: Viewer | null; hideWatch?: boolean; hideAgents?: boolean }) {
  return (
    <>
      {viewer && viewer.agents.length > 0 && !hideAgents && <YourAgents viewer={viewer} />}
      <Suspense fallback={<RailSkeleton rows={1} />}>
        <NowModule />
      </Suspense>
      {!hideWatch && (
        <Suspense fallback={<RailSkeleton />}>
          <WatchModule viewer={viewer} />
        </Suspense>
      )}
      <Suspense fallback={<RailSkeleton />}>
        <TrendingModule />
      </Suspense>
      <RailFooter />
    </>
  );
}
