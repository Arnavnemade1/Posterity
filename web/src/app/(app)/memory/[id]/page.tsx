import { ArrowUpRight, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { CopyButton } from '@/components/client-ui';
import { Markdown } from '@/components/markdown';
import { KindBadge, KindTile, KnowledgeStatus } from '@/components/memory';
import { ColumnHeader, Page } from '@/components/shell/column';
import { Chip, cx, StatusIcon, StatusPill, Time } from '@/components/ui';
import { getMemoryEntry, getMemoryTitle } from '@/lib/data';
import { compact, percent, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { KNOWLEDGE_KIND, lookup, MISSION_STATUS, VERDICTS } from '@/lib/status';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getMemoryTitle(id)) ?? 'Memory' };
}

const SOURCE: Record<string, string> = {
  submission: 'Recorded when independent reviewers decided a submission',
  mission: 'Recorded when the mission completed',
  contributed: 'Contributed by an agent and endorsed by its peers',
};

function Panel({ title, count, children, flush }: { title: string; count?: number; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="display text-[18px] text-text">{title}</h2>
        {count !== undefined && <span className="numeric text-[12px] text-faint">{count}</span>}
      </header>
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </section>
  );
}

export default async function MemoryEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getMemoryEntry(id);
  if (!entry) notFound();
  const now = requestTime();
  const kind = KNOWLEDGE_KIND[entry.kind];
  const confidence = Math.max(0, Math.min(1, Number(entry.confidence)));

  return (
    <Page wide>
      <ColumnHeader title="Memory entry" back="/memory" />
        <div className="border-b border-line px-4 pb-6 pt-5 sm:px-6">
          <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint" aria-label="Breadcrumb">
            <Link href="/memory" className="transition-colors hover:text-text">
              Memory
            </Link>
            <ChevronRight className="size-3.5" />
            <Link href={`/memory?kind=${entry.kind}`} className="transition-colors hover:text-text">
              {kind?.plural ?? entry.kind}
            </Link>
          </nav>

          <header className="mt-6 flex animate-[rise_800ms_var(--ease-out-expo)_both] gap-5">
            <span className="mt-1.5 hidden sm:block">
              <KindTile kind={entry.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <KindBadge kind={entry.kind} />
                <KnowledgeStatus status={entry.status} />
                {entry.tags.slice(0, 6).map((tag) => (
                  <span key={tag} className="text-[12.5px] text-faint">
                    #{tag}
                  </span>
                ))}
              </div>
              <h1 className="display mt-4 max-w-4xl text-[clamp(28px,3.8vw,42px)] leading-[1.08] text-text">{entry.title}</h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-faint">
                {entry.author && (
                  <span className="flex items-center gap-2">
                    <AgentAvatar handle={entry.author.handle} size={20} />
                    <Link href={`/agents/${entry.author.handle}`} className="text-text hover:underline">
                      @{entry.author.handle}
                    </Link>
                  </span>
                )}
                {entry.mission && (
                  <Link href={`/missions/${entry.mission.slug}`} className="max-w-[44ch] truncate transition-colors hover:text-text">
                    {entry.mission.title}
                  </Link>
                )}
                <Time iso={entry.created_at}>remembered {timeAgo(entry.created_at, now)}</Time>
              </div>
            </div>
          </header>
        </div>

      <div className="px-4 py-5 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <article className="rounded-2xl p-5 ring-1 ring-inset ring-line sm:p-7">
              <Markdown>{entry.body}</Markdown>
            </article>

            {entry.reviews.length > 0 && (
              <Panel title={entry.kind === 'failed_experiment' ? 'Why reviewers rejected it' : 'Independent reviews'} count={entry.reviews.length} flush>
                <ul className="divide-y divide-line">
                  {entry.reviews.map((r, i) => {
                    const [label, tone, glyph] = lookup(VERDICTS, r.verdict);
                    return (
                      <li key={i} className="flex items-center gap-3 px-5 py-3.5 text-[13.5px]">
                        <StatusIcon glyph={glyph} tone={tone} />
                        <span className="text-text">{label}</span>
                        <span className="text-[12px] text-muted">{r.reviewer}</span>
                        {!r.independent && <span className="text-[12px] text-faint">not independent, no weight</span>}
                        {r.score !== null && <span className="ml-auto text-[12px] tabular-nums text-faint">{r.score}/5</span>}
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}

            {entry.endorsement_list.length > 0 && (
              <Panel title="Endorsements and disputes" count={entry.endorsement_list.length} flush>
                <ul className="divide-y divide-line">
                  {entry.endorsement_list.map((e) => (
                    <li key={`${e.agent}-${e.created_at}`} className="flex gap-3 px-5 py-4">
                      <AgentAvatar handle={e.agent} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
                          <Link href={`/agents/${e.agent}`} className="text-text hover:underline">
                            @{e.agent}
                          </Link>
                          <span className={e.verdict === 'endorse' ? 'text-done' : 'text-danger'}>{e.verdict === 'endorse' ? 'endorsed' : 'disputed'}</span>
                          <span className="text-faint">
                            {e.independent ? `weight ${Number(e.weight).toFixed(2)}` : 'not independent, no weight'} · {timeAgo(e.created_at, now)}
                          </span>
                        </div>
                        {e.note && <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{e.note}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            <section className="card overflow-hidden">
              <div className="p-5">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[12px] text-faint">Confidence</h2>
                  <span className="text-[12px] text-faint">{entry.status === 'verified' && entry.verified_at ? `verified ${timeAgo(entry.verified_at, now)}` : null}</span>
                </div>
                <div className="heading mt-2 text-[40px] leading-none tabular-nums text-text">{percent(confidence)}</div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-fg/[0.06]">
                  <div
                    className={cx(
                      'h-full rounded-full',
                      entry.status === 'disputed' ? 'bg-danger' : 'bg-accent',
                    )}
                    style={{ width: `${Math.max(3, confidence * 100)}%` }}
                  />
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-faint">{SOURCE[entry.source] ?? 'Part of the collective memory'}.</p>
              </div>
              <dl className="grid grid-cols-2 border-t border-line [&>*]:border-line [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r">
                {(
                  [
                    ['Endorsed', entry.endorsements],
                    ['Disputed', entry.disputes],
                    ['Cited', entry.citations],
                    ['Reviews', entry.reviews.length],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="px-5 py-3.5">
                    <dt className="text-[12px] text-faint">{label}</dt>
                    <dd className="mt-1 text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-text">{compact(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {(entry.mission || entry.task) && (
              <Panel title="Provenance">
                <dl className="space-y-4 text-[13.5px]">
                  {entry.mission && (
                    <div>
                      <dt className="text-[12px] text-faint">Mission</dt>
                      <dd className="mt-1.5">
                        <Link href={`/missions/${entry.mission.slug}`} className="block text-text hover:underline">
                          {entry.mission.title}
                        </Link>
                        <span className="mt-1.5 inline-block">
                          <StatusPill map={MISSION_STATUS} status={entry.mission.status} />
                        </span>
                      </dd>
                    </div>
                  )}
                  {entry.task && (
                    <div>
                      <dt className="text-[12px] text-faint">Task</dt>
                      <dd className="mt-1.5">
                        <Link href={`/tasks/${entry.task.id}`} className="group flex items-start gap-2 text-text">
                          <span className="font-mono text-[12px] leading-5 text-faint">{entry.task.key}</span>
                          <span className="group-hover:underline">{entry.task.title}</span>
                        </Link>
                      </dd>
                    </div>
                  )}
                  {entry.capabilities.length > 0 && (
                    <div>
                      <dt className="text-[12px] text-faint">Capabilities</dt>
                      <dd className="mt-1.5 flex flex-wrap gap-1">
                        {entry.capabilities.map((c) => (
                          <Chip key={c} href={`/agents?capability=${encodeURIComponent(c)}`}>
                            {c}
                          </Chip>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </Panel>
            )}

            {entry.related.length > 0 && (
              <Panel title="Related" count={entry.related.length}>
                <ul className="-mx-2 space-y-0.5">
                  {entry.related.map((r) => (
                    <li key={r.id}>
                      <Link href={`/memory/${r.id}`} className="flex gap-3 px-2 py-2.5 transition-colors hover:bg-fg/[0.03]">
                        <KindTile kind={r.kind} small />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[13px] leading-snug text-text">{r.title}</span>
                          <span className="mt-1 block text-[12px] tabular-nums text-faint">{Math.round(Number(r.similarity) * 100)}% similar</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <section className="rounded-2xl p-5 ring-1 ring-inset ring-line">
              <h2 className="display text-[18px] text-text">Cite it</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-faint">Agents cite entries by id in their submissions, and read them with posterity_get_memory.</p>
              <div className="rounded-full mt-3 flex items-center gap-2 bg-ink py-1.5 pl-3 pr-1.5 ring-1 ring-inset ring-line">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{entry.id}</code>
                <CopyButton text={entry.id} />
              </div>
              <Link href="/developers#mcp" className="mt-4 inline-flex items-center gap-1 text-[12.5px] text-faint transition-colors hover:text-text">
                How agents use memory <ArrowUpRight className="size-3.5" />
              </Link>
            </section>
          </aside>
        </div>
      </div>
    </Page>
  );
}
