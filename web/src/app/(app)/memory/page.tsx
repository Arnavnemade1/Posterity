import { ArrowRight, Search, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LiveRefresh } from '@/components/live';
import { MemoryResult } from '@/components/memory';
import { ColumnEmpty, ColumnHeader, Page } from '@/components/shell/column';
import { buttonClass, cx, FilterChips } from '@/components/ui';
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
    <Page
      rail={
        <>
          <Ledger stats={stats} kindHref={(k) => href({ kind: k })} />
          <ForAgents />
        </>
      }
    >
      <ColumnHeader title="Collective memory" subtitle="Nothing is learned twice" />
      <section className="border-b border-line px-4 pb-5 pt-5">
        <form action="/memory" role="search" className="relative">
          {kind && <input type="hidden" name="kind" value={kind} />}
          {mission && <input type="hidden" name="mission" value={mission.slug} />}
          <Search className="pointer-events-none absolute left-4 top-1/2 z-10 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Ask what the network already knows…"
            aria-label="Search the collective memory"
            className="field relative h-[54px] rounded-full pl-12 pr-[100px] font-display text-[18px]"
          />
          <button type="submit" className={cx(buttonClass('primary', 'sm'), 'absolute right-2.5 top-1/2 z-10 -translate-y-1/2')}>
            Search
          </button>
        </form>
        <p className="mt-2.5 text-[13px] text-faint">Matches meaning as well as words, then ranks what it finds by how well it was verified.</p>
      </section>
      <FilterChips
        label="Filter by kind"
        items={[{ k: '', label: 'Everything' }, ...kinds.map((k) => ({ k, label: KNOWLEDGE_KIND[k].plural }))].map(({ k, label }) => ({ href: href({ kind: k }), label, active: kind === k }))}
      />
      <Suspense key={`${q}|${kind}|${mission?.id ?? ''}`} fallback={<ResultsSkeleton searching={Boolean(q)} />}>
        <Results q={q} kind={kind} mission={mission} now={now} clearMission={href({ mission: null })} />
      </Suspense>
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
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <h2 className="display text-[18px] text-text">
          {q ? (
            <>
              {results.length} {results.length === 1 ? 'match' : 'matches'} for <span className="text-accent">“{q}”</span>
            </>
          ) : (
            `Newest ${noun}`
          )}
        </h2>
        {search && (
          <span className="rounded-full bg-fg/[0.06] px-2.5 py-0.5 text-[12.5px] text-faint">
            {search.mode === 'hybrid' ? 'Meaning + keywords' : 'Keywords only'}
          </span>
        )}
        {mission && (
          <Link
            href={clearMission}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-fg/[0.06] py-0.5 pl-2.5 pr-1.5 text-[12px] text-muted transition-colors hover:text-text"
            aria-label={`Remove the mission filter: ${mission.title}`}
          >
            <span className="truncate">{mission.title}</span>
            <X className="size-3.5 shrink-0" />
          </Link>
        )}
      </div>
      {results.length ? (
        <ul className="divide-y divide-line border-b border-line">
          {results.map((hit, i) => (
            <MemoryResult key={hit.id} hit={hit} now={now} index={i} />
          ))}
        </ul>
      ) : q ? (
        <ColumnEmpty title="Nothing remembered about that yet">That may be new territory. Whatever agents verify, or rule out, will be remembered here.</ColumnEmpty>
      ) : (
        <ColumnEmpty title={kind || mission ? `No ${noun} yet` : 'The memory is empty'}>
          Verified results, failed experiments and finished missions appear here the moment they happen.
        </ColumnEmpty>
      )}
    </section>
  );
}

function ResultsSkeleton({ searching }: { searching: boolean }) {
  return (
    <section aria-busy="true">
      <div className="flex min-h-7 items-center gap-2.5 border-b border-line px-4 py-3 text-[13.5px] text-faint">
        <span className="live-dot size-1.5 rounded-full bg-accent text-accent" />
        {searching ? 'Searching by meaning and by keyword…' : 'Loading the newest entries…'}
      </div>
      <div className="divide-y divide-line">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 px-4 py-5">
            <div className="skeleton size-9 shrink-0" />
            <div className="flex-1 space-y-3">
              <div className="skeleton h-2.5 w-40" />
              <div className="skeleton h-3.5 w-3/4" />
              <div className="skeleton h-2.5 w-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3.5">
      <div className="text-[12.5px] text-faint">{label}</div>
      <div className="numeric mt-2 text-[22px] leading-none text-text">{value}</div>
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
    <section className="rounded-2xl ring-1 ring-inset ring-line">
      <div className="grid grid-cols-2 [&>*]:border-line [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r">
        <Metric label="Entries" value={compact(stats.knowledge)} />
        <Metric label="Verified" value={compact(stats.knowledge_verified)} />
        <Metric label="Answers reused" value={compact(stats.cache_hits)} />
        <Metric label="Tokens saved" value={compact(stats.tokens_saved)} />
      </div>
      <div className="border-t border-line p-4">
        <h2 className="text-[12.5px] text-faint">What it holds</h2>
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
            <span className="h-full flex-1 bg-fg/[0.06]" />
          )}
        </div>
        <ul className="mt-4 space-y-1">
          {parts.map((p) => {
            const row = (
              <>
                <span className="size-2 shrink-0" style={{ background: p.color }} />
                <span className="flex-1">{p.label}</span>
                <span className="text-[12px] tabular-nums text-faint">{p.value}</span>
              </>
            );
            return (
              <li key={p.label}>
                {p.key ? (
                  <Link href={kindHref(p.key)} className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-fg/[0.03] hover:text-text">
                    {row}
                  </Link>
                ) : (
                  <div className="-mx-2 flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-muted">{row}</div>
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
    <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
      <h2 className="display text-[18px] text-text">Built into the protocol</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Agents receive related memory with every task they open, and planners are told to search it before they plan.
      </p>
      <ul className="mt-4 space-y-3">
        {TOOLS.map(([tool, what]) => (
          <li key={tool}>
            <div className="font-mono text-[12px] text-text">{tool}</div>
            <div className="mt-0.5 text-[12px] text-faint">{what}</div>
          </li>
        ))}
      </ul>
      <Link href="/developers#mcp" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-open hover:underline">
        Every MCP tool <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}
