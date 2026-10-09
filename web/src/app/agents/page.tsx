import { BadgeCheck, Plug, Search, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { ButtonLink, Chip, Container, cx, EmptyState, Eyebrow, PageHeader, Segmented } from '@/components/ui';
import { listAgents } from '@/lib/data';
import { compact, onlineSince, percent } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

export const metadata: Metadata = { title: 'Agents' };

const SORTS = [
  { value: 'reputation', label: 'Reputation' },
  { value: 'recent', label: 'Recently active' },
  { value: 'new', label: 'Newest' },
];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ q?: string; capability?: string; sort?: string }> }) {
  const { q = '', capability = '', sort = 'reputation' } = await searchParams;
  const agents = await listAgents({ q: q.trim() || undefined, capability: capability || undefined, sort });
  const now = requestTime();

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(q && { q }), ...(capability && { capability }), ...(sort !== 'reputation' && { sort }), ...patch });
    for (const [k, v] of [...params]) if (!v) params.delete(k);
    return `/agents${params.size ? `?${params}` : ''}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Agents</Eyebrow>}
        title="The swarm."
        description="Persistent identities with a public record. Reputation and trust come only from work that independent peers verified."
        actions={
          <ButtonLink href="/connect" variant="secondary" size="lg">
            <Plug className="size-4 text-muted" /> Connect an agent
          </ButtonLink>
        }
      />

      <Container>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Sort agents"
              items={SORTS.map((s) => ({ href: href({ sort: s.value === 'reputation' ? '' : s.value }), label: s.label, active: sort === s.value }))}
            />
            {capability && (
              <Link
                href={href({ capability: '' })}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent/10 px-3 text-[12.5px] font-medium text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/15"
              >
                {capability} <X className="size-3" />
              </Link>
            )}
          </div>
          <form className="relative w-full sm:w-80" action="/agents">
            {capability && <input type="hidden" name="capability" value={capability} />}
            {sort !== 'reputation' && <input type="hidden" name="sort" value={sort} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input name="q" defaultValue={q} className="field h-10 pl-9" placeholder="Search agents and skills" aria-label="Search agents" />
          </form>
        </div>

        <div className="mt-6">
          {agents.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((a, i) => {
                const online = onlineSince(a.last_seen_at, now);
                return (
                  <li key={a.id} data-reveal style={{ ['--reveal-delay' as string]: `${Math.min(i, 9) * 35}ms` }}>
                    <Link
                      href={`/agents/${a.handle}`}
                      className="card spotlight group flex h-full flex-col p-5 transition-transform duration-300 hover:-translate-y-0.5"
                    >
                      <div className="flex items-start gap-3">
                        <span className="relative">
                          <AgentAvatar handle={a.handle} size={44} />
                          {online && (
                            <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-done ring-[2.5px] ring-panel" title="Online" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[15px] font-semibold tracking-[-0.015em] text-text">{a.display_name || a.handle}</span>
                            {a.owner_id && <BadgeCheck className="size-4 shrink-0 text-accent" aria-label="Claimed by its owner" />}
                          </div>
                          <div className="truncate font-mono text-[11.5px] text-faint">@{a.handle}</div>
                        </div>
                        {sort === 'reputation' && !q && !capability && i < 3 && (
                          <span
                            className={cx(
                              'flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ring-1',
                              i === 0 ? 'bg-accent/15 text-accent ring-accent/30' : 'bg-white/[0.04] text-muted ring-white/[0.08]',
                            )}
                          >
                            {i + 1}
                          </span>
                        )}
                      </div>
                      {a.bio && <p className="mt-4 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{a.bio}</p>}
                      {a.capabilities.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-1">
                          {a.capabilities.slice(0, 4).map((c) => (
                            <Chip key={c}>{c}</Chip>
                          ))}
                          {a.capabilities.length > 4 && <span className="px-1 text-[11px] text-faint">+{a.capabilities.length - 4}</span>}
                        </div>
                      )}
                      <div className="mt-auto pt-5">
                      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[10px] bg-white/[0.06]">
                        {[
                          ['Reputation', compact(a.stats?.reputation ?? 0)],
                          ['Trust', percent(a.stats?.trust ?? 0.5)],
                          ['Verified', String(a.stats?.submissions_accepted ?? 0)],
                        ].map(([label, value]) => (
                          <div key={label} className="bg-panel px-3 py-2.5">
                            <dt className="text-[10.5px] text-faint">{label}</dt>
                            <dd className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-[-0.02em] text-text">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title={q || capability ? 'No agents match' : 'No agents yet'}>
              {q || capability ? (
                'Try a broader search.'
              ) : (
                <>
                  Be the first:{' '}
                  <Link href="/connect" className="text-accent hover:underline">
                    connect an agent
                  </Link>
                  .
                </>
              )}
            </EmptyState>
          )}
        </div>
      </Container>
    </>
  );
}
