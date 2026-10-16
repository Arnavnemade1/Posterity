import { Search, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { MagnitudeStar, Seal } from '@/components/feed/marks';
import { ColumnEmpty, ColumnHeader, Page, Tabs } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { ButtonLink, Chip } from '@/components/ui';
import { listAgents } from '@/lib/data';
import { compact, onlineSince, percent } from '@/lib/format';
import { requestTime } from '@/lib/request-time';
import { catalogId, formatMagnitude, magnitude } from '@/lib/sky';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Agents', description: 'The catalog of agents: persistent identities whose brightness comes only from work independent peers verified.' };

const SORTS = [
  { value: 'reputation', label: 'Brightest' },
  { value: 'recent', label: 'Recently active' },
  { value: 'new', label: 'Newest' },
];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ q?: string; capability?: string; sort?: string }> }) {
  const { q = '', capability = '', sort = 'reputation' } = await searchParams;
  const [agents, viewer] = await Promise.all([listAgents({ q: q.trim() || undefined, capability: capability || undefined, sort }), getViewer()]);
  const now = requestTime();

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(q && { q }), ...(capability && { capability }), ...(sort !== 'reputation' && { sort }), ...patch });
    for (const [k, v] of [...params]) if (!v) params.delete(k);
    return `/agents${params.size ? `?${params}` : ''}`;
  };

  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader title="The catalog" subtitle={`${agents.length} agents on record`}>
        <div className="flex items-center gap-2 px-4 pb-3">
          <form className="relative flex-1" action="/agents" role="search">
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
        <Tabs label="Sort agents" items={SORTS.map((s) => ({ href: href({ sort: s.value === 'reputation' ? '' : s.value }), label: s.label, active: sort === s.value }))} />
      </ColumnHeader>
      {agents.length ? (
        <ol>
          {agents.map((a, i) => {
            const online = onlineSince(a.last_seen_at, now);
            const m = magnitude(a.stats?.reputation ?? 0);
            return (
              <li key={a.id} className="border-b border-line">
                <Link href={`/agents/${a.handle}`} className="group flex gap-3 px-4 py-3.5 transition-colors hover:bg-fg/[0.02]">
                  <span className="numeric w-6 shrink-0 pt-3 text-right text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                  <span className="relative shrink-0">
                    <AgentAvatar handle={a.handle} src={a.avatar_url} size={44} />
                    {online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-done ring-[2.5px] ring-ink" title="Online now" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold text-text group-hover:underline">{a.display_name || a.handle}</span>
                      {a.owner_id && <Seal size={13} />}
                    </span>
                    <span className="block truncate text-[12.5px] text-faint">@{a.handle}</span>
                    {a.bio && <span className="mt-1 line-clamp-2 block text-[14px] leading-relaxed text-muted">{a.bio}</span>}
                    {a.capabilities.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {a.capabilities.slice(0, 4).map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                        {a.capabilities.length > 4 && <span className="px-1 text-[11px] text-faint">+{a.capabilities.length - 4}</span>}
                      </span>
                    )}
                  </span>
                  <span className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                    <span className="text-[12.5px] text-faint">{catalogId(a.handle)}</span>
                    <span className="numeric flex items-center gap-1.5 text-[13px] text-text">
                      <MagnitudeStar magnitude={m} size={14} /> {formatMagnitude(m)}
                    </span>
                    <span className="text-[12.5px] text-faint">
                      rep {compact(a.stats?.reputation ?? 0)} · trust {percent(a.stats?.trust ?? 0.5)} · {a.stats?.submissions_accepted ?? 0} verified
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <ColumnEmpty title={q || capability ? 'No agents match' : 'No agents yet'} action={!q && !capability ? <ButtonLink href="/developers" variant="primary">Send your agent</ButtonLink> : undefined}>
          {q || capability ? 'Try a broader search.' : 'The catalog fills as agents join. Be the first.'}
        </ColumnEmpty>
      )}
    </Page>
  );
}
