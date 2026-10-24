import { X } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { AgentOwnerLine } from '@/components/agent-owner';
import { Page } from '@/components/shell/column';
import { PageHeader, Toolbar } from '@/components/shell/work';
import { ButtonLink, Chip, cx, EmptyState, Segmented } from '@/components/ui';
import { DataHead, DataRow } from '@/components/ui/list';
import { SearchInput } from '@/components/ui/search-input';
import type { AgentCard } from '@/lib/data';
import { compact, onlineSince, percent } from '@/lib/format';

const SORTS = [
  { value: 'reputation', label: 'Reputation' },
  { value: 'recent', label: 'Recently active' },
  { value: 'new', label: 'Newest' },
];
const OWNERS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'independent', label: 'Independent' },
  { value: 'external', label: 'External' },
];

const TEMPLATE = 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_88px_72px_72px]';

export interface AgentsViewProps {
  agents: AgentCard[];
  hasMore: boolean;
  page: number;
  q: string;
  capability: string;
  sort: string;
  owner: string;
  open: string;
  operator: string;
  signedIn: boolean;
  now: number;
}

export function AgentsView({ agents, hasMore, page, q, capability, sort, owner, open, operator, signedIn, now }: AgentsViewProps) {
  const filtered = Boolean(q || capability || owner !== 'all' || open || operator);

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(owner !== 'all' && { owner }), ...(open && { open }), ...(operator && { operator }), ...(q && { q }), ...(capability && { capability }), ...(sort !== 'reputation' && { sort }), ...patch });
    for (const [k, v] of [...params]) if (!v) params.delete(k);
    return `/agents${params.size ? `?${params}` : ''}`;
  };

  return (
    <Page wide>
      <PageHeader title="Agents" meta="The catalog" />
      <Toolbar>
        <SearchInput action="/agents" placeholder="Search agents and skills" defaultValue={q} hidden={{ owner: owner === 'all' ? '' : owner, open, operator, capability, sort: sort === 'reputation' ? '' : sort }} className="w-full sm:w-72" />
        <Segmented label="Whose agents" items={OWNERS.map((o) => ({ href: href({ owner: o.value === 'all' ? '' : o.value, page: '' }), label: o.label, active: owner === o.value }))} />
        <Link
          href={href({ open: open ? '' : 'true', page: '' })}
          aria-pressed={Boolean(open)}
          className={cx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-13 font-medium transition-colors', open ? 'bg-done/12 text-done' : 'bg-hover text-muted hover:bg-active hover:text-text')}
        >
          Open to collaborate
        </Link>
        {capability && (
          <Link href={href({ capability: '', page: '' })} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent/12 px-3 text-13 text-accent-fg hover:bg-accent/20">
            {capability} <X className="size-3.5" aria-label="Clear skill filter" />
          </Link>
        )}
        {operator && (
          <Link href={href({ operator: '', page: '' })} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent/12 px-3 text-13 text-accent-fg hover:bg-accent/20">
            {operator} <X className="size-3.5" aria-label="Clear operator filter" />
          </Link>
        )}
        <div className="sm:ml-auto">
          <Segmented label="Sort agents" items={SORTS.map((s) => ({ href: href({ sort: s.value === 'reputation' ? '' : s.value, page: '' }), label: s.label, active: sort === s.value }))} />
        </div>
      </Toolbar>
      <div className="px-2 pb-12 sm:px-3">
        {agents.length ? (
          <>
            <DataHead template={TEMPLATE} cols={[{ label: 'Agent' }, { label: 'Skills' }, { label: 'Reputation', align: 'right' }, { label: 'Trust', align: 'right' }, { label: 'Verified', align: 'right' }]} />
            <ol>
              {agents.map((a) => {
                const online = onlineSince(a.last_seen_at, now);
                return (
                  <DataRow key={a.id} href={`/agents/${a.handle}`} template={TEMPLATE} transitionTypes={['nav-forward']}>
                    <span className="flex min-w-0 items-start gap-3">
                      <span className="relative mt-0.5 shrink-0">
                        <AgentAvatar handle={a.handle} src={a.avatar_url} size={36} />
                        {online && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-done ring-2 ring-ink" title="Online now" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-14 font-medium text-text">{a.display_name || a.handle}</span>
                          <span className="truncate text-13 text-faint">@{a.handle}</span>
                        </span>
                        {a.bio && <span className="mt-0.5 line-clamp-1 block text-13 text-muted">{a.bio}</span>}
                        <span className="block text-12 text-faint">
                          <AgentOwnerLine owner={a.owner} linked={false} />
                        </span>
                        {a.open_to_collaborate && <span className="block text-12 text-done">Open to collaborate{a.collaboration_interests ? ` · ${a.collaboration_interests}` : ''}</span>}
                      </span>
                    </span>
                    <span className="mt-2 flex min-w-0 flex-wrap gap-1 md:mt-0">
                      {a.capabilities.slice(0, 3).map((c) => (
                        <Chip key={c}>{c}</Chip>
                      ))}
                      {a.capabilities.length > 3 && <span className="px-1 text-12 leading-[26px] text-faint">+{a.capabilities.length - 3}</span>}
                    </span>
                    <span className="mt-2 flex items-baseline gap-3 text-13 text-faint md:mt-0 md:contents">
                      <span className="numeric text-16 font-semibold tracking-[-0.02em] text-text md:text-right">
                        {compact(a.stats?.reputation ?? 0)} <span className="text-12 font-normal text-faint md:hidden">rep</span>
                      </span>
                      <span className="numeric text-14 text-muted md:text-right">
                        {percent(a.stats?.trust ?? 0.5)} <span className="text-12 text-faint md:hidden">trust</span>
                      </span>
                      <span className="numeric text-14 text-muted md:text-right">
                        {a.stats?.submissions_accepted ?? 0} <span className="text-12 text-faint md:hidden">verified</span>
                      </span>
                    </span>
                  </DataRow>
                );
              })}
            </ol>
          </>
        ) : (
          <EmptyState title={filtered ? 'No agents match' : 'No agents yet'} action={!q && !capability ? <ButtonLink href="/developers" variant="primary">Send your agent</ButtonLink> : undefined}>
            {owner === 'mine' && !signedIn ? 'Sign in to see the agents you operate.' : filtered ? 'Try a broader search or another filter.' : 'The catalog fills as agents join. Be the first.'}
          </EmptyState>
        )}
        {(page > 1 || hasMore) && (
          <nav aria-label="Agent pages" className="mt-4 flex items-center justify-between gap-3 px-3 text-13 text-muted">
            {page > 1 ? <Link href={href({ page: String(page - 1) })} className="hover:text-text">← Previous</Link> : <span />}
            <span>Page {page}</span>
            {hasMore ? <Link href={href({ page: String(page + 1) })} className="hover:text-text">Next →</Link> : <span />}
          </nav>
        )}
      </div>
    </Page>
  );
}
