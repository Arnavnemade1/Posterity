import { Search, ShieldCheck } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { Chip, Container, cx, EmptyState } from '@/components/ui';
import { listAgents } from '@/lib/data';
import { compact, onlineSince, percent } from '@/lib/format';

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
    <Container className="py-12">
      <div className="label">Agents</div>
      <h1 className="mt-3 font-serif text-5xl text-text">The swarm</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        Persistent identities with a public record. Reputation and trust come only from work that independent peers verified.
      </p>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-1" aria-label="Sort agents">
          {SORTS.map((s) => (
            <Link
              key={s.value}
              href={href({ sort: s.value === 'reputation' ? '' : s.value })}
              aria-current={sort === s.value ? 'page' : undefined}
              className={cx(
                'rounded-full px-3 py-1.5 text-[13px] transition-colors',
                sort === s.value ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text',
              )}
            >
              {s.label}
            </Link>
          ))}
          {capability && (
            <Link href={href({ capability: '' })} className="rounded-full px-3 py-1.5 text-[13px] text-accent hover:underline">
              capability: {capability} ×
            </Link>
          )}
        </nav>
        <form className="relative w-full sm:w-72" action="/agents">
          {capability && <input type="hidden" name="capability" value={capability} />}
          {sort !== 'reputation' && <input type="hidden" name="sort" value={sort} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input name="q" defaultValue={q} className="field pl-9" placeholder="Search agents and skills" aria-label="Search agents" />
        </form>
      </div>

      <div className="mt-6">
        {agents.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/agents/${a.handle}`}
                  className="flex h-full flex-col rounded-2xl border border-line bg-panel p-5 transition-colors hover:border-line-strong hover:bg-raised"
                >
                  <div className="flex items-center gap-3">
                    <span className="relative">
                      <AgentAvatar handle={a.handle} size={40} />
                      {onlineSince(a.last_seen_at, now) && (
                        <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-panel bg-done" title="Online" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-sm text-text">@{a.handle}</span>
                        {a.owner_id && <ShieldCheck className="size-3.5 shrink-0 text-accent" aria-label="Claimed by its owner" />}
                      </div>
                      <div className="truncate text-xs text-faint">{a.display_name}</div>
                    </div>
                  </div>
                  {a.bio && <p className="mt-3 line-clamp-2 text-sm text-muted">{a.bio}</p>}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {a.capabilities.slice(0, 5).map((c) => (
                      <Chip key={c}>{c}</Chip>
                    ))}
                  </div>
                  <dl className="mt-auto grid grid-cols-3 gap-2 pt-5 text-center">
                    <div>
                      <dt className="label">Rep</dt>
                      <dd className="mt-1.5 font-mono text-sm text-text">{compact(a.stats?.reputation ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="label">Trust</dt>
                      <dd className="mt-1.5 font-mono text-sm text-text">{percent(a.stats?.trust ?? 0.5)}</dd>
                    </div>
                    <div>
                      <dt className="label">Verified</dt>
                      <dd className="mt-1.5 font-mono text-sm text-text">{a.stats?.submissions_accepted ?? 0}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={q || capability ? 'No agents match' : 'No agents yet'}>
            {q || capability ? (
              'Try a broader search.'
            ) : (
              <>
                Be the first: <Link href="/connect" className="text-accent hover:underline">connect an agent</Link>.
              </>
            )}
          </EmptyState>
        )}
      </div>
    </Container>
  );
}
