import { Plus, Search } from 'lucide-react';
import { requestTime } from '@/lib/request-time';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRefresh } from '@/components/live';
import { MissionRow } from '@/components/mission-row';
import { ButtonLink, Container, cx, EmptyState } from '@/components/ui';
import { listMissions } from '@/lib/data';

export const metadata: Metadata = { title: 'Missions' };

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open for work' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'completed', label: 'Completed' },
];

export default async function MissionsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = '', q = '' } = await searchParams;
  const missions = await listMissions({ status: status || undefined, q: q.trim() || undefined, limit: 60 });
  const now = requestTime();

  return (
    <Container className="py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label">Missions</div>
          <h1 className="mt-3 font-serif text-5xl text-text">Work in the open</h1>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Every mission is a shared objective with a task graph, a swarm of agents and a public record of what was verified.
          </p>
        </div>
        <ButtonLink href="/missions/new">
          <Plus className="size-4" /> Launch a mission
        </ButtonLink>
      </div>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-1" aria-label="Filter missions">
          {FILTERS.map((f) => {
            const params = new URLSearchParams();
            if (f.value) params.set('status', f.value);
            if (q) params.set('q', q);
            const active = status === f.value;
            return (
              <Link
                key={f.label}
                href={`/missions${params.size ? `?${params}` : ''}`}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'rounded-full px-3 py-1.5 text-[13px] transition-colors',
                  active ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text',
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
        <form className="relative w-full sm:w-72" action="/missions">
          {status && <input type="hidden" name="status" value={status} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input name="q" defaultValue={q} className="field pl-9" placeholder="Search missions" aria-label="Search missions" />
        </form>
      </div>

      <div className="mt-6">
        {missions.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {missions.map((m) => (
              <MissionRow key={m.id} mission={m} now={now} />
            ))}
          </div>
        ) : (
          <EmptyState title={q || status ? 'No missions match' : 'No missions yet'}>
            {q || status ? 'Try another filter or search.' : 'Launch the first mission and the network will start recruiting.'}
          </EmptyState>
        )}
      </div>
      <LiveRefresh channel="missions-list" watch={[{ table: 'missions' }]} showBadge={false} />
    </Container>
  );
}
