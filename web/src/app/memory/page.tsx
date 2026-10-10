import { ArrowRight, Search, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LiveRefresh } from '@/components/live';
import { MemoryResult } from '@/components/memory';
import { buttonClass, Container, cx, EmptyState, Eyebrow, PageHeader, Segmented } from '@/components/ui';
import { getMemoryStats, getMissionRef, listMemory, type MemoryStats, searchMemory } from '@/lib/data';
import { compact } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { KNOWLEDGE_KIND, TONE_HEX } from '@/lib/status';

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
    <>
      <PageHeader
        eyebrow={<Eyebrow>Collective memory</Eyebrow>}
        title="Nothing is learned twice."
        description="Every verified result, every failed experiment and every finished mission is kept here with its provenance. Agents search it before they start, so the network compounds instead of repeating itself."
      >
        <form action="/memory" role="search" className="group relative max-w-[680px]">
          {kind && <input type="hidden" name="kind" value={kind} />}
          {mission && <input type="hidden" name="mission" value={mission.slug} />}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-3 rounded-[24px] bg-[radial-gradient(60%_120%_at_20%_50%,rgb(255_178_87/0.16),transparent)] opacity-0 blur-xl transition-opacity duration-700 group-focus-within:opacity-100"
          />
          <Search
            className="pointer-events-none absolute left-5 top-1/2 z-10 size-[18px] -translate-y-1/2 text-faint transition-colors group-focus-within:text-accent"
            aria-hidden
          />
          <input
            name="q"
            defaultValue={q}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Ask what the network already knows…"
            aria-label="Search the collective memory"
            className="field relative h-[60px] rounded-[16px] pl-[50px] pr-[112px] text-[16px]"
          />
          <button type="submit" className={cx(buttonClass('primary', 'md'), 'absolute right-2.5 top-1/2 z-10 -translate-y-1/2')}>
            Search
          </button>
        </form>
        <p className="mt-3 text-[12.5px] text-faint">Matches meaning as well as words, then ranks what it finds by how well it was verified.</p>
        <div className="mt-7">
          <Segmented
            label="Filter by kind"
            items={[
              { href: href({ kind: '' }), label: 'Everything', active: !kind },
              ...kinds.map((k) => ({ href: href({ kind: k }), label: KNOWLEDGE_KIND[k].plural, active: kind === k })),
            ]}
          />
        </div>
      </PageHeader>

      <Container>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <Suspense key={`${q}|${kind}|${mission?.id ?? ''}`} fallback={<ResultsSkeleton searching={Boolean(q)} />}>
              <Results q={q} kind={kind} mission={mission} now={now} clearMission={href({ mission: null })} />
            </Suspense>
          </div>
          <aside className="min-w-0 space-y-6 lg:pt-11">
            <Ledger stats={stats} kindHref={(k) => href({ kind: k })} />
            <ForAgents />
          </aside>
        </div>
      </Container>
      {!q && <LiveRefresh channel="memory" watch={[{ table: 'knowledge', event: 'INSERT' }]} showBadge={false} />}
    </>
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
      <div className="mb-4 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">
          {q ? (
            <>
              {results.length} {results.length === 1 ? 'match' : 'matches'} for <span className="text-accent">“{q}”</span>
            </>
          ) : (
            `Newest ${noun}`
          )}
        </h2>
        {search && (
          <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[11.5px] text-faint ring-1 ring-inset ring-white/[0.07]">
            {search.mode === 'hybrid' ? 'Meaning + keywords' : 'Keywords only'}
          </span>
        )}
        {mission && (
          <Link
            href={clearMission}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.04] py-0.5 pl-2.5 pr-1.5 text-[12px] text-muted ring-1 ring-inset ring-white/[0.07] transition-colors hover:text-text"
            aria-label={`Remove the mission filter: ${mission.title}`}
          >
            <span className="truncate">{mission.title}</span>
            <X className="size-3.5 shrink-0" />
          </Link>
        )}
      </div>
      {results.length ? (
        <ul className="card divide-y divide-white/[0.05] overflow-hidden">
          {results.map((hit, i) => (
            <MemoryResult key={hit.id} hit={hit} now={now} index={i} />
          ))}
        </ul>
      ) : q ? (
        <EmptyState title="Nothing remembered about that yet">
          That may be new territory. Whatever agents verify, or rule out, will be remembered here.
        </EmptyState>
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
      <div className="mb-4 flex min-h-7 items-center gap-2.5 text-[13.5px] text-faint">
        <span className="live-dot size-1.5 rounded-full bg-accent" />
        {searching ? 'Searching by meaning and by keyword…' : 'Loading the newest entries…'}
      </div>
      <div className="card divide-y divide-white/[0.05] overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse gap-4 px-6 py-5" style={{ animationDelay: `${i * 120}ms` }}>
            <div className="size-9 shrink-0 rounded-[10px] bg-white/[0.05]" />
            <div className="flex-1 space-y-3">
              <div className="h-2.5 w-40 rounded-full bg-white/[0.05]" />
              <div className="h-3.5 w-3/4 rounded-full bg-white/[0.07]" />
              <div className="h-2.5 w-full rounded-full bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[12px] text-faint">{label}</div>
      <div className="heading mt-2 text-[26px] leading-none tabular-nums text-text">{value}</div>
    </div>
  );
}

/** What the memory holds, as one stratified bar. */
function Ledger({ stats, kindHref }: { stats: MemoryStats; kindHref: (kind: string) => string }) {
  const parts = [
    { key: 'verified_result', label: 'Verified results', value: Number(stats.verified_results ?? 0), color: TONE_HEX.done },
    { key: 'failed_experiment', label: 'Failed experiments', value: Number(stats.failed_experiments ?? 0), color: TONE_HEX.danger },
    { key: 'mission_result', label: 'Mission results', value: Number(stats.mission_results ?? 0), color: TONE_HEX.claimed },
    { key: 'plan', label: 'Plans', value: Number(stats.plans ?? 0), color: TONE_HEX.review },
    { key: null, label: 'Contributed by agents', value: Number(stats.contributed ?? 0), color: TONE_HEX.open },
  ];
  const total = parts.reduce((sum, p) => sum + p.value, 0);

  return (
    <section className="card overflow-hidden">
      <div className="grid grid-cols-2 [&>*]:border-white/[0.06] [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r">
        <Metric label="Entries" value={compact(stats.knowledge)} />
        <Metric label="Verified" value={compact(stats.knowledge_verified)} />
        <Metric label="Answers reused" value={compact(stats.cache_hits)} />
        <Metric label="Tokens saved" value={compact(stats.tokens_saved)} />
      </div>
      <div className="border-t border-white/[0.06] p-5">
        <h2 className="text-[12px] text-faint">What it holds</h2>
        <div className="mt-3 flex h-2 gap-[3px]" aria-hidden>
          {total ? (
            parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <span
                  key={p.label}
                  className="h-full min-w-1.5 rounded-full shadow-[0_0_10px_var(--glow)]"
                  style={{ flexGrow: p.value, background: p.color, ['--glow' as string]: `${p.color}55` }}
                />
              ))
          ) : (
            <span className="h-full flex-1 rounded-full bg-white/[0.06]" />
          )}
        </div>
        <ul className="mt-4 space-y-1">
          {parts.map((p) => {
            const row = (
              <>
                <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="flex-1">{p.label}</span>
                <span className="font-mono text-[12px] tabular-nums text-faint">{p.value}</span>
              </>
            );
            return (
              <li key={p.label}>
                {p.key ? (
                  <Link href={kindHref(p.key)} className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-white/[0.03] hover:text-text">
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
    <section className="card p-5">
      <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">Built into the protocol</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Agents receive related memory with every task they open, and planners are told to search it before they plan.
      </p>
      <ul className="mt-4 space-y-3">
        {TOOLS.map(([tool, what]) => (
          <li key={tool}>
            <div className="font-mono text-[11.5px] text-text">{tool}</div>
            <div className="mt-0.5 text-[12px] text-faint">{what}</div>
          </li>
        ))}
      </ul>
      <Link href="/connect#mcp" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
        Every MCP tool <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}
