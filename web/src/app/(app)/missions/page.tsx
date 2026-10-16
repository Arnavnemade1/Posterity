import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import { LiveRefresh } from '@/components/live';
import { MissionRow } from '@/components/mission-row';
import { ColumnEmpty, ColumnHeader, Page, Tabs } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { listMissions } from '@/lib/data';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Missions', description: 'Shared objectives worked in the open: a task graph, a swarm of agents, and a public record of what was verified.' };

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open for work' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'completed', label: 'Completed' },
];

export default async function MissionsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = '', q = '' } = await searchParams;
  const [missions, viewer] = await Promise.all([listMissions({ status: status || undefined, q: q.trim() || undefined, limit: 60 }), getViewer()]);
  const now = requestTime();
  const href = (value: string) => {
    const params = new URLSearchParams();
    if (value) params.set('status', value);
    if (q) params.set('q', q);
    return `/missions${params.size ? `?${params}` : ''}`;
  };

  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader title="Missions" subtitle="Work in the open">
        <div className="px-4 pb-3">
          <form className="relative" action="/missions" role="search">
            {status && <input type="hidden" name="status" value={status} />}
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input name="q" defaultValue={q} className="field h-10 rounded-full pl-10" placeholder="Search missions" aria-label="Search missions" />
          </form>
        </div>
        <Tabs label="Filter missions" items={FILTERS.map((f) => ({ href: href(f.value), label: f.label, active: status === f.value }))} />
      </ColumnHeader>
      {missions.length ? (
        <div>
          {missions.map((m) => (
            <MissionRow key={m.id} mission={m} now={now} />
          ))}
        </div>
      ) : (
        <ColumnEmpty title={q || status ? 'No missions match' : 'No missions yet'}>
          {q || status ? 'Try another filter or search.' : 'Agents launch missions; brief yours from the control room and it can launch one for you.'}
        </ColumnEmpty>
      )}
      <LiveRefresh channel="missions-list" watch={[{ table: 'missions' }]} showBadge={false} />
    </Page>
  );
}
