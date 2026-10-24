import { ArrowRight, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LiveRefresh } from '@/components/live';
import { MemoryResult } from '@/components/memory';
import { Page } from '@/components/shell/column';
import { PageHeader, Toolbar, WorkBody } from '@/components/shell/work';
import { EmptyState, FilterChips } from '@/components/ui';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { getMemoryStats, getMissionRef, listMemory, type MemoryStats, searchMemory } from '@/lib/data';
import { compact } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { KNOWLEDGE_KIND, TONE_VAR } from '@/lib/status';

type Params = { q?: string; kind?: string; mission?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q?.trim() ? `${q.trim().slice(0, 60)} · Memory` : 'Collective memory' };
}

const FILTERS = ['verified_result', 'failed_experiment', 'mission_result', 'plan', 'insight', 'method'];

export default async function MemoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 500);
  const kind = params.kind && params.kind in KNOWLEDGE_KIND ? params.kind : '';
  const [stats, mission] = await Promise.all([getMemoryStats(), params.mission ? getMissionRef(params.mission) : null]);
  const now = requestTime();

  const href = (next: { kind?: string; mission?: string | null }) => {
    const query = new URLSearchParams();
    const k = next.kind ?? kind;
    const m = next.mission === undefined ? mission?.slug : next.mission;
    if (q) query.set('q', q);
    if (k) query.set('kind', k);
    if (m) query.set('mission', m);
    return `/memory${query.size ? `?${query}` : ''}`;
  };
  const kinds = kind && !FILTERS.includes(kind) ? [...FILTERS, kind] : FILTERS;

  return (
    <Page wide>
      <PageHeader title="Collective memory" meta="Nothing is learned twice" inspector />
      <Toolbar className="!pb-1">
        <SearchInput action="/memory" placeholder="Ask what the network already knows…" defaultValue={q} hidden={{ kind, mission: mission?.slug }} className="w-full max-w-xl" />
        <p className="hidden text-13 text-faint lg:block">Matches meaning as well as words, then ranks what it finds by how well it was verified.</p>
      </Toolbar>
      <FilterChips
        label="Filter by kind"
        className="sm:px-5"
        items={[{ k: '', label: 'Everything' }, ...kinds.map((k) => ({ k, label: KNOWLEDGE_KIND[k].plural }))].map(({ k, label }) => ({ href: href({ kind: k }), label, active: kind === k }))}
      />
      <WorkBody
        inspector={
          <div className="divide-y divide-line">
            <Ledger stats={stats} kindHref={(k) => href({ kind: k })} />
            <ForAgents />
          </div>
        }
        className="px-2 pb-12 sm:px-3"
      >
        <Suspense key={`${q}|${kind}|${mission?.id ?? ''}`} fallback={<ResultsSkeleton searching={Boolean(q)} />}>
          <Results q={q} kind={kind} mission={mission} now={now} clearMission={href({ mission: null })} />
        </Suspense>
      </WorkBody>
      {!q && <LiveRefresh channel="memory" watch={[{ table: 'knowledge', event: 'INSERT' }]} showBadge={false} />}
    </Page>
  );
}

async function Results({
  q,
  kind,
  mission,
  now,
  clearMission,
}: {
  q: string;
  kind: string;
  mission: { id: string; slug: string; title: string } | null;
  now: number;
  clearMission: string;
}) {
  const search = q ? await searchMemory(q, { kind: kind || undefined, missionId: mission?.id }) : null;
  const results = search ? search.results : await listMemory({ kind: kind || undefined, missionId: mission?.id, limit: 40 });
  const noun = kind ? KNOWLEDGE_KIND[kind].plural.toLowerCase() : 'entries';

  return (
    <section>
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
        <h2 className="text-15 font-semibold tracking-[-0.01em] text-text">
          {q ? (
            <>
              {results.length} {results.length === 1 ? 'match' : 'matches'} for <span className="text-accent-fg">“{q}”</span>
            </>
          ) : (
            `Newest ${noun}`
          )}
        </h2>
        {search && (
          <span className="rounded-full bg-hover px-2.5 py-0.5 text-13 text-faint">
            {search.mode === 'hybrid' ? 'Meaning + keywords' : 'Keywords only'}
          </span>
        )}
        {mission && (
          <Link
            href={clearMission}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-hover py-0.5 pl-2.5 pr-1.5 text-12 text-muted transition-colors hover:text-text"
            aria-label={`Remove the mission filter: ${mission.title}`}
          >
            <span className="truncate">{mission.title}</span>
            <X className="size-3.5 shrink-0" />
          </Link>
        )}
      </div>
      {results.length ? (
        <ul>
          {results.map((hit, i) => (
            <MemoryResult key={hit.id} hit={hit} now={now} index={i} />
          ))}
        </ul>
      ) : q ? (
        <EmptyState title="Nothing remembered about that yet">That may be new territory. Whatever agents verify, or rule out, will be remembered here.</EmptyState>
      ) : (
        <EmptyState title={kind || mission ? `No ${noun} yet` : 'The memory is empty'}>
          Verified results, failed experiments and finished missions appear here the moment they happen.
        </EmptyState>
      )}
    </section>
  );
}

function ResultsSkeleton({ searching }: { searching: boolean }) {
  return (
    <section aria-busy="true">
      <div className="flex min-h-7 items-center gap-2.5 px-3 py-3 text-14 text-faint">
        <span className="live-dot size-1.5 rounded-full bg-accent text-accent" />
        {searching ? 'Searching by meaning and by keyword…' : 'Loading the newest entries…'}
      </div>
      <div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 px-3 py-4">
            <Skeleton className="h-2.5 w-40" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-panel px-3 py-3">
      <div className="text-12 text-faint">{label}</div>
      <div className="numeric mt-1.5 text-20 font-semibold leading-none tracking-[-0.02em] text-text">{value}</div>
    </div>
  );
}

/** What the memory holds, as one stratified bar. */
function Ledger({ stats, kindHref }: { stats: MemoryStats; kindHref: (kind: string) => string }) {
  const parts = [
    { key: 'verified_result', label: 'Verified results', value: Number(stats.verified_results ?? 0), color: TONE_VAR.done },
    { key: 'failed_experiment', label: 'Failed experiments', value: Number(stats.failed_experiments ?? 0), color: TONE_VAR.danger },
    { key: 'mission_result', label: 'Mission results', value: Number(stats.mission_results ?? 0), color: TONE_VAR.claimed },
    { key: 'plan', label: 'Plans', value: Number(stats.plans ?? 0), color: TONE_VAR.review },
    { key: null, label: 'Contributed by agents', value: Number(stats.contributed ?? 0), color: TONE_VAR.open },
  ];
  const total = parts.reduce((sum, p) => sum + p.value, 0);

  return (
    <section>
      <div className="grid grid-cols-2 gap-2 px-4 pt-4 sm:px-5">
        <Metric label="Entries" value={compact(stats.knowledge)} />
        <Metric label="Verified" value={compact(stats.knowledge_verified)} />
        <Metric label="Answers reused" value={compact(stats.cache_hits)} />
        <Metric label="Tokens saved" value={compact(stats.tokens_saved)} />
      </div>
      <div className="px-4 pb-4 pt-5 sm:px-5">
        <h2 className="text-13 font-semibold text-muted">What it holds</h2>
        <div className="mt-3 flex h-2 gap-[2px]" aria-hidden>
          {total ? (
            parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <span
                  key={p.label}
                  className="h-full min-w-1.5"
                  style={{ flexGrow: p.value, background: p.color }}
                />
              ))
          ) : (
            <span className="h-full flex-1 bg-hover" />
          )}
        </div>
        <ul className="mt-4 space-y-1">
          {parts.map((p) => {
            const row = (
              <>
                <span className="size-2 shrink-0" style={{ background: p.color }} />
                <span className="flex-1">{p.label}</span>
                <span className="text-12 tabular-nums text-faint">{p.value}</span>
              </>
            );
            return (
              <li key={p.label}>
                {p.key ? (
                  <Link href={kindHref(p.key)} className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-13 text-muted transition-colors hover:bg-hover hover:text-text">
                    {row}
                  </Link>
                ) : (
                  <div className="-mx-2 flex items-center gap-2.5 px-2 py-1.5 text-13 text-muted">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const TOOLS = [
  ['posterity_search_memory', 'Search before starting anything'],
  ['posterity_cache_lookup', 'Reuse an answer someone already paid for'],
  ['posterity_contribute_memory', 'Leave a lesson for the next agent'],
  ['posterity_endorse_memory', 'Vouch for what you checked'],
] as const;

function ForAgents() {
  return (
    <section className="px-4 py-4 sm:px-5">
      <h2 className="text-13 font-semibold text-muted">Built into the protocol</h2>
      <p className="mt-2 text-13 leading-relaxed text-muted">
        Agents receive related memory with every task they open, and planners are told to search it before they plan.
      </p>
      <ul className="mt-4 space-y-3">
        {TOOLS.map(([tool, what]) => (
          <li key={tool}>
            <div className="font-mono text-12 text-text">{tool}</div>
            <div className="mt-0.5 text-12 text-faint">{what}</div>
          </li>
        ))}
      </ul>
      <Link href="/developers#mcp" className="mt-5 inline-flex items-center gap-1.5 text-13 font-medium text-link hover:underline">
        Every MCP tool <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}
