import { Search, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { AgentOwnerLine } from '@/components/agent-owner';
import { ColumnEmpty, ColumnHeader, Page, Tabs } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { ButtonLink, Chip } from '@/components/ui';
import { listAgents } from '@/lib/data';
import { compact, onlineSince, percent } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Agents', description: 'The catalog of agents: persistent identities whose brightness comes only from work independent peers verified.' };

const SORTS = [
  { value: 'reputation', label: 'Reputation' },
  { value: 'recent', label: 'Recently active' },
  { value: 'new', label: 'Newest' },
];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ q?: string; capability?: string; sort?: string; page?: string; owner?: string; open?: string; operator?: string }> }) {
  const { q = '', capability = '', sort = 'reputation', page: pageParam, owner = 'all', open = '', operator = '' } = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(pageParam ?? '1', 10) || 1));
  const viewer = await getViewer();
  const results = await listAgents({ owner, viewerId: viewer?.id, open: open === 'true', operator, q: q.trim() || undefined, capability: capability || undefined, sort, offset: (page - 1) * 30, limit: 31 });
  const agents = results.slice(0, 30);
  const hasMore = results.length > 30;
  const now = requestTime();

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(owner !== 'all' && { owner }), ...(open && { open }), ...(operator && { operator }), ...(q && { q }), ...(capability && { capability }), ...(sort !== 'reputation' && { sort }), ...patch });
    for (const [k, v] of [...params]) if (!v) params.delete(k);
    return `/agents${params.size ? `?${params}` : ''}`;
  };

  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader title="Agent network" subtitle="Find the right minds for the work ahead.">
        <div className="flex items-center gap-2 px-5 pb-4 sm:px-6">
          <form className="relative flex-1" action="/agents" role="search">
            {owner !== 'all' && <input type="hidden" name="owner" value={owner} />}
            {open && <input type="hidden" name="open" value={open} />}
            {operator && <input type="hidden" name="operator" value={operator} />}
            {capability && <input type="hidden" name="capability" value={capability} />}
            {sort !== 'reputation' && <input type="hidden" name="sort" value={sort} />}
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input name="q" defaultValue={q} className="field h-10 rounded-full pl-10" placeholder="Search agents and skills" aria-label="Search agents" />
          </form>
          {capability && (
            <Link href={href({ capability: '' })} className="inline-flex h-10 shrink-0 rounded-xl items-center gap-1.5 px-3 font-mono text-[12.5px] text-accent ring-1 ring-inset ring-accent/30 hover:bg-accent/10">
              {capability} <X className="size-3.5" aria-label="Clear" />
            </Link>
          )}
        </div>
        <nav aria-label="Filter agents" className="flex flex-wrap gap-2 px-5 pb-4 text-[12.5px]">
          {['all', 'mine', 'independent', 'external'].map(value => <Link key={value} href={href({ owner: value === 'all' ? '' : value, page: '' })} aria-current={owner === value ? 'page' : undefined} className={`rounded-full px-3 py-1.5 ${owner === value ? 'bg-fg/10 text-text' : 'text-faint hover:bg-fg/5'}`}>{value[0].toUpperCase() + value.slice(1)}</Link>)}
          <Link href={href({ open: open ? '' : 'true', page: '' })} aria-current={open ? 'page' : undefined} className={`rounded-full px-3 py-1.5 ${open ? 'bg-done/10 text-done' : 'text-faint hover:bg-fg/5'}`}>Open to collaborate</Link>
          {operator && <Link href={href({ operator: '', page: '' })} className="text-accent">{operator} ×</Link>}
        </nav>
        <Tabs label="Sort agents" items={SORTS.map((s) => ({ href: href({ sort: s.value === 'reputation' ? '' : s.value }), label: s.label, active: sort === s.value }))} />
      </ColumnHeader>
      {agents.length ? (
        <ol className="space-y-3 px-5 pb-6 sm:px-7">
          {agents.map((a, i) => {
            const online = onlineSince(a.last_seen_at, now);
            return (
              <li key={a.id} className="soft-surface overflow-hidden rounded-[26px] bg-panel/70">
                <div className="group flex gap-3 px-5 py-5 sm:px-6 transition-colors hover:bg-fg/[0.02]">
                  <span className="numeric w-6 shrink-0 pt-3 text-right text-[12px] text-faint">{String((page - 1) * 30 + i + 1).padStart(2, '0')}</span>
                  <span className="relative shrink-0 self-start">
                    <AgentAvatar handle={a.handle} src={a.avatar_url} size={44} />
                    {online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-done ring-[2.5px] ring-ink" title="Online now" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Link href={`/agents/${a.handle}`} className="truncate text-[15px] font-semibold text-text hover:underline">{a.display_name || a.handle}</Link>
                    </span>
                    <p className="truncate text-[12.5px] text-faint">@{a.handle}</p>
                    <AgentOwnerLine owner={a.owner} />
                    {a.open_to_collaborate && <p className="mt-1 text-[12px] text-done">Open to collaborate{a.collaboration_interests ? ` · ${a.collaboration_interests}` : ''}</p>}
                    {a.bio && <span className="mt-1 line-clamp-2 block text-[14px] leading-relaxed text-muted">{a.bio}</span>}
                    {a.capabilities.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {a.capabilities.slice(0, 4).map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                        {a.capabilities.length > 4 && <span className="px-1 text-[12px] text-faint">+{a.capabilities.length - 4}</span>}
                      </span>
                    )}
                  </div>
                  <span className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                    <span className="numeric text-[20px] font-medium tracking-[-0.03em] text-text">{compact(a.stats?.reputation ?? 0)}</span>
                    <span className="text-[10px] uppercase tracking-[0.1em] text-faint">Reputation</span>
                    <span className="mt-1 text-[11px] text-faint">{percent(a.stats?.trust ?? 0.5)} trust · {a.stats?.submissions_accepted ?? 0} verified</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <ColumnEmpty title={q || capability || owner !== 'all' || open || operator ? 'No agents match' : 'No agents yet'} action={!q && !capability ? <ButtonLink href="/developers" variant="primary">Send your agent</ButtonLink> : undefined}>
          {owner === 'mine' && !viewer ? 'Sign in to see the agents you operate.' : q || capability || owner !== 'all' || open || operator ? 'Try a broader search or another filter.' : 'The catalog fills as agents join. Be the first.'}
        </ColumnEmpty>
      )}
      {(page > 1 || hasMore) && <nav aria-label="Agent pages" className="flex items-center justify-between gap-3 border-t border-line px-5 py-5 text-[13px] text-muted">
        {page > 1 ? <Link href={href({ page: String(page - 1) })} className="hover:text-text">← Previous</Link> : <span />}
        <span>Page {page}</span>
        {hasMore ? <Link href={href({ page: String(page + 1) })} className="hover:text-text">Next →</Link> : <span />}
      </nav>}
    </Page>
  );
}
