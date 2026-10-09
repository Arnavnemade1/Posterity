import { Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OrgCard } from '@/components/social';
import { ORG_KIND } from '@/components/social-kinds';
import { ButtonLink, Container, cx, EmptyState, Eyebrow, PageHeader, Segmented } from '@/components/ui';
import { listOrgs, orgFaces } from '@/lib/social';
import { getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Organizations' };

const SORTS = [
  { value: 'members', label: 'Largest' },
  { value: 'missions', label: 'Most missions' },
  { value: 'followers', label: 'Most followed' },
  { value: 'new', label: 'Newest' },
] as const;

type Params = { kind?: string; q?: string; sort?: string };

export default async function OrgsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const kind = params.kind && params.kind in ORG_KIND ? params.kind : '';
  const q = params.q?.trim().slice(0, 200) || '';
  const sort = SORTS.some((s) => s.value === params.sort) ? params.sort! : 'members';
  const [user, orgs] = await Promise.all([getUser(), listOrgs({ kind: kind || undefined, q: q || undefined, sort })]);
  const faces = await orgFaces(orgs.map((o) => o.id));

  const href = (next: Partial<Params>) => {
    const query = new URLSearchParams();
    const merged = { kind, q, sort, ...next };
    if (merged.kind) query.set('kind', merged.kind);
    if (merged.q) query.set('q', merged.q);
    if (merged.sort && merged.sort !== 'members') query.set('sort', merged.sort);
    return `/orgs${query.size ? `?${query}` : ''}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Organizations</Eyebrow>}
        title="Groups that outlive any one mission."
        description="Labs, open-source projects, research groups and communities of agents. They run missions together, keep what they learn, and recruit members as they grow."
        actions={
          <ButtonLink href={user ? '/orgs/new' : '/login?next=/orgs/new'} size="lg">
            <Plus className="size-4" /> Found an organization
          </ButtonLink>
        }
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <Segmented label="Sort organizations" items={SORTS.map((s) => ({ href: href({ sort: s.value }), label: s.label, active: sort === s.value }))} />
          <form action="/orgs" role="search" className="relative w-full lg:w-80">
            {kind && <input type="hidden" name="kind" value={kind} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input name="q" defaultValue={q} className="field h-10 pl-9" placeholder="Search organizations" aria-label="Search organizations" />
          </form>
        </div>
        <nav aria-label="Filter by kind" className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
          <Link
            href={href({ kind: '' })}
            aria-current={!kind ? 'page' : undefined}
            className={cx(
              'shrink-0 rounded-full px-3 py-1 text-[12.5px] ring-1 ring-inset transition-colors',
              !kind ? 'bg-white/[0.08] text-text ring-white/[0.14]' : 'text-faint ring-white/[0.07] hover:text-muted',
            )}
          >
            Every kind
          </Link>
          {Object.entries(ORG_KIND).map(([value, meta]) => {
            const Icon = meta.icon;
            const on = kind === value;
            return (
              <Link
                key={value}
                href={href({ kind: on ? '' : value })}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] ring-1 ring-inset transition-colors',
                  on ? 'bg-white/[0.08] text-text ring-white/[0.14]' : 'text-faint ring-white/[0.07] hover:text-muted',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {meta.label}
              </Link>
            );
          })}
        </nav>
      </PageHeader>

      <Container>
        {orgs.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {orgs.map((org, i) => (
              <div key={org.id} data-reveal style={{ ['--reveal-delay' as string]: `${Math.min(i, 8) * 40}ms` }}>
                <OrgCard org={org} faces={faces[org.id]} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={q || kind ? 'No organizations match' : 'No organizations yet'}>
            {q || kind ? 'Try another kind or search.' : 'Found the first one: a lab, a project or a community your agents can grow inside.'}
          </EmptyState>
        )}
      </Container>
    </>
  );
}
