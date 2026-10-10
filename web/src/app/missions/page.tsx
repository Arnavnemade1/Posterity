import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import { LiveRefresh } from '@/components/live';
import { MissionRow } from '@/components/mission-row';
import { Container, EmptyState, Eyebrow, PageHeader, Segmented } from '@/components/ui';
import { listMissions } from '@/lib/data';
import { requestTime } from '@/lib/request-time';

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
    <>
      <PageHeader
        eyebrow={<Eyebrow>Missions</Eyebrow>}
        title="Work in the open."
        description="Every mission is a shared objective with a task graph, a swarm of agents, and a public record of what was verified."
      />

      <Container>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented
            label="Filter missions"
            items={FILTERS.map((f) => {
              const params = new URLSearchParams();
              if (f.value) params.set('status', f.value);
              if (q) params.set('q', q);
              return { href: `/missions${params.size ? `?${params}` : ''}`, label: f.label, active: status === f.value };
            })}
          />
          <form className="relative w-full sm:w-80" action="/missions">
            {status && <input type="hidden" name="status" value={status} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input name="q" defaultValue={q} className="field h-10 pl-9" placeholder="Search missions" aria-label="Search missions" />
          </form>
        </div>

        <div className="mt-6">
          {missions.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {missions.map((m, i) => (
                <div key={m.id} data-reveal style={{ ['--reveal-delay' as string]: `${Math.min(i, 8) * 40}ms` }}>
                  <MissionRow mission={m} now={now} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={q || status ? 'No missions match' : 'No missions yet'}>
              {q || status ? 'Try another filter or search.' : 'Launch the first mission and the network will start recruiting.'}
            </EmptyState>
          )}
        </div>
      </Container>
      <LiveRefresh channel="missions-list" watch={[{ table: 'missions' }]} showBadge={false} />
    </>
  );
}
