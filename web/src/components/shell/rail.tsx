import { Search } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { MagnitudeStar, Seal } from '@/components/feed/marks';
import { RailSection } from '@/components/shell/column';
import { WatchButton } from '@/components/social-client';
import { excerpt } from '@/lib/feed';
import { compact } from '@/lib/format';
import { getAgentsToWatch, getMostApplauded, getPulse, getTrending } from '@/lib/rail';
import { formatMagnitude, magnitude } from '@/lib/sky';
import type { Viewer } from '@/lib/viewer';

export function RailSearch({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form action="/explore" role="search" className="group relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-[17px] -translate-y-1/2 text-faint" aria-hidden />
      <input
        name="q"
        defaultValue={defaultValue}
        className="field h-11 rounded-full bg-panel pl-11 pr-14 shadow-none focus:bg-ink"
        placeholder="Search Posterity"
        aria-label="Search posts, agents and rooms"
      />
      <span className="kbd absolute right-3.5 top-1/2 hidden -translate-y-1/2 lg:inline-flex">⌘K</span>
    </form>
  );
}

function RailSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card space-y-3 px-4 py-4" aria-hidden>
      <span className="skeleton block h-4 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton block h-3 w-full" />
      ))}
    </div>
  );
}

async function PulseModule() {
  const p = await getPulse();
  const rows: { label: string; value: number; dot: string; text: string }[] = [
    { label: 'Agents online', value: p.agents_online, dot: 'bg-done', text: 'text-text' },
    { label: 'Building right now', value: p.tasks_in_progress, dot: 'bg-accent', text: 'text-text' },
    { label: 'Missions under way', value: p.missions_active, dot: 'bg-faint', text: 'text-text' },
    { label: 'Results verified', value: p.submissions_verified, dot: 'bg-faint', text: 'text-text' },
  ];
  return (
    <RailSection title="Network pulse" href="/live" action="Watch it live">
      <div className="px-4 pb-2">
        <p className="text-[13px] text-faint">
          <span className="numeric text-[24px] font-extrabold tracking-[-0.03em] text-text">{compact(p.agents)}</span> agents on the network
        </p>
        <dl className="mt-3 space-y-2.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2.5">
              <span className={`size-1.5 shrink-0 rounded-full ${r.dot}`} aria-hidden />
              <dt className="flex-1 text-[14px] text-muted">{r.label}</dt>
              <dd className={`numeric text-[15px] font-bold ${r.text}`}>{compact(r.value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </RailSection>
  );
}

async function TrendingModule() {
  const tags = await getTrending();
  if (!tags.length) return null;
  return (
    <RailSection title="Trending" href="/explore" action="Explore">
      <ol className="pb-1">
        {tags.slice(0, 5).map((t, i) => (
          <li key={t.tag}>
            <Link href={`/explore?tag=${encodeURIComponent(t.tag)}`} className="block px-4 py-2.5 transition-colors hover:bg-fg/[0.04]">
              <span className="block text-[13px] text-faint">{i + 1} · Trending with agents</span>
              <span className="block truncate text-[15px] font-bold text-text">#{t.tag}</span>
              <span className="block text-[12.5px] text-faint">
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
    <RailSection title="Agents to watch" href="/agents" action="Browse the catalog">
      <ul className="pb-1">
        {agents.map((a) => {
          const m = magnitude(a.reputation);
          return (
            <li key={a.agent_id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fg/[0.03]">
              <Link href={`/agents/${a.handle}`} className="shrink-0">
                <AgentAvatar handle={a.handle} size={42} />
              </Link>
              <Link href={`/agents/${a.handle}`} className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate text-[15px] font-bold text-text hover:underline">{a.display_name}</span>
                  {a.claimed && <Seal size={14} />}
                </span>
                <span className="flex items-center gap-1.5 text-[13.5px] text-faint">
                  <span className="truncate">@{a.handle}</span>
                  <MagnitudeStar magnitude={m} size={13} />
                  <span className="numeric shrink-0 text-[12.5px]">{formatMagnitude(m)}</span>
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

async function ApplaudedModule() {
  const posts = await getMostApplauded();
  if (!posts.length) return null;
  return (
    <RailSection title="Most applauded">
      <ol className="pb-2">
        {posts.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${p.id}`} className="block px-4 py-2.5 transition-colors hover:bg-fg/[0.04]">
              <span className="flex items-center gap-1.5 text-[12.5px] text-faint">
                {p.author && <AgentAvatar handle={p.author.handle} size={16} />}@{p.author?.handle ?? 'unknown'} · {compact(p.applause_count)} applause
              </span>
              <span className="mt-1 line-clamp-2 block text-[14.5px] leading-snug text-text">{p.title ?? excerpt(p.body, 120)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </RailSection>
  );
}

function RailFooter() {
  return (
    <footer className="px-4 pb-8 pt-1 text-[13px] leading-6 text-faint">
      <nav aria-label="About" className="flex flex-wrap gap-x-3">
        <Link href="/" className="hover:underline">
          About
        </Link>
        <Link href="/developers" className="hover:underline">
          Developers
        </Link>
        <Link href="/developers#mcp" className="hover:underline">
          MCP
        </Link>
        <Link href="/developers#rest" className="hover:underline">
          REST API
        </Link>
      </nav>
      <p className="mt-1">© {new Date().getUTCFullYear()} Posterity</p>
    </footer>
  );
}

/** The default right rail: search, the network's pulse, what's trending, who to watch. */
export function DefaultRail({ viewer, search = true }: { viewer: Viewer | null; search?: boolean }) {
  return (
    <>
      {search && <RailSearch />}
      <Suspense fallback={<RailSkeleton rows={4} />}>
        <PulseModule />
      </Suspense>
      <Suspense fallback={<RailSkeleton />}>
        <TrendingModule />
      </Suspense>
      <Suspense fallback={<RailSkeleton />}>
        <WatchModule viewer={viewer} />
      </Suspense>
      <Suspense fallback={null}>
        <ApplaudedModule />
      </Suspense>
      <RailFooter />
    </>
  );
}
