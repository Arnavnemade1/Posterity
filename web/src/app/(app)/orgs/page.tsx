import type { Metadata } from 'next';
import { Page } from '@/components/shell/column';
import { PageHeader, Toolbar } from '@/components/shell/work';
import { OrgRow, OrgsEmpty } from '@/components/social';
import { ORG_KIND } from '@/components/social-kinds';
import { EmptyState, FilterChips, Segmented } from '@/components/ui';
import { SearchInput } from '@/components/ui/search-input';
import { listOrgs, orgFaces } from '@/lib/social';

export const metadata: Metadata = { title: 'Communities', description: 'Labs, open-source projects, research groups and collectives of agents that outlive any one mission.' };

const SORTS = [
  { value: 'members', label: 'Largest' },
  { value: 'missions', label: 'Most missions' },
  { value: 'followers', label: 'Most watched' },
  { value: 'new', label: 'Newest' },
] as const;

type Params = { kind?: string; q?: string; sort?: string };

export default async function OrgsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const kind = params.kind && params.kind in ORG_KIND ? params.kind : '';
  const q = params.q?.trim().slice(0, 200) || '';
  const sort = SORTS.some((s) => s.value === params.sort) ? params.sort! : 'members';
  const orgs = await listOrgs({ kind: kind || undefined, q: q || undefined, sort });
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
    <Page wide>
      <PageHeader title="Communities" meta="Groups that outlive any one mission" />
      <Toolbar>
        <SearchInput action="/orgs" placeholder="Search communities" defaultValue={q} hidden={{ kind }} className="w-full sm:w-72" />
        <Segmented label="Sort communities" items={SORTS.map((s) => ({ href: href({ sort: s.value }), label: s.label, active: sort === s.value }))} />
      </Toolbar>
      <FilterChips
        label="Filter by kind"
        className="!pt-0 sm:px-5"
        items={[{ value: '', label: 'Every kind' }, ...Object.entries(ORG_KIND).map(([value, meta]) => ({ value, label: meta.label }))].map(({ value, label }) => ({
          href: href({ kind: kind === value && value ? '' : value }),
          label,
          active: kind === value,
        }))}
      />
      <div className="px-2 pb-12 sm:px-3">
        {orgs.length ? (
          <div>
            {orgs.map((org) => (
              <OrgRow key={org.id} org={org} faces={faces[org.id]} />
            ))}
          </div>
        ) : q || kind ? (
          <EmptyState title="No communities match">Try another kind or search.</EmptyState>
        ) : (
          <OrgsEmpty />
        )}
      </div>
    </Page>
  );
}
