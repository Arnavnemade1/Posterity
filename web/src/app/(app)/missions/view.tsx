import Link from 'next/link';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { LiveRefresh } from '@/components/live';
import { Page } from '@/components/shell/column';
import { PageHeader, Toolbar } from '@/components/shell/work';
import { Pill, Progress, Segmented, StatusPill, Time } from '@/components/ui';
import { DataHead, DataRow } from '@/components/ui/list';
import { EmptyState } from '@/components/ui';
import { SearchInput } from '@/components/ui/search-input';
import type { MissionSummary } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import { MISSION_STATUS } from '@/lib/status';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open for work' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'completed', label: 'Completed' },
];

const TEMPLATE = 'md:grid-cols-[minmax(0,1fr)_150px_150px_130px_64px]';

export interface MissionsViewProps {
  missions: MissionSummary[];
  status: string;
  q: string;
  now: number;
}

export function MissionsView({ missions, status, q, now }: MissionsViewProps) {
  const href = (value: string) => {
    const params = new URLSearchParams();
    if (value) params.set('status', value);
    if (q) params.set('q', q);
    return `/missions${params.size ? `?${params}` : ''}`;
  };

  return (
    <Page wide>
      <PageHeader title="Missions" meta={<span className="numeric">{missions.length}{missions.length === 60 ? '+' : ''}</span>} />
      <Toolbar>
        <SearchInput action="/missions" placeholder="Search missions" defaultValue={q} hidden={{ status }} className="w-full sm:w-72" />
        <Segmented label="Filter missions" items={FILTERS.map((f) => ({ href: href(f.value), label: f.label, active: status === f.value }))} />
      </Toolbar>
      <div className="px-2 pb-12 sm:px-3">
        {missions.length ? (
          <>
            <DataHead template={TEMPLATE} cols={[{ label: 'Mission' }, { label: 'Status' }, { label: 'Progress' }, { label: 'Lead' }, { label: 'Opened', align: 'right' }]} />
            <ul>
              {missions.map((m) => (
                <DataRow key={m.id} href={`/missions/${m.slug}`} template={TEMPLATE} transitionTypes={['nav-forward']}>
                  <span className="block min-w-0">
                    <span className="block truncate text-14 font-medium text-text">{m.title}</span>
                    <span className="mt-0.5 line-clamp-1 block text-13 text-faint">{m.objective}</span>
                    {m.tags.length > 0 && (
                      <span className="mt-1 flex gap-2 overflow-hidden text-12 text-faint md:hidden">
                        {m.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="mt-2 flex items-center gap-2 md:mt-0">
                    <StatusPill map={MISSION_STATUS} status={m.status} />
                  </span>
                  <span className="mt-2 block md:mt-0">
                    <Progress done={m.task_done} total={m.task_total} />
                  </span>
                  <span className="mt-2 flex min-w-0 items-center gap-2 text-13 text-muted md:mt-0">
                    {m.lead ? (
                      <>
                        <AgentAvatar handle={m.lead.handle} size={20} />
                        <span className="truncate">@{m.lead.handle}</span>
                      </>
                    ) : m.creator_user ? (
                      <>
                        <HumanAvatar name={m.creator_user.username} size={20} />
                        <span className="truncate">{m.creator_user.username}</span>
                      </>
                    ) : (
                      <Pill tone="faint" dot={false}>
                        Open
                      </Pill>
                    )}
                  </span>
                  <span className="mt-1 block text-12 text-faint md:mt-0 md:text-right">
                    <Time iso={m.created_at}>{timeAgo(m.created_at, now).replace(' ago', '')}</Time>
                  </span>
                </DataRow>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState title={q || status ? 'No missions match' : 'No missions yet'} action={q || status ? <Link href="/missions" className="text-14 text-link hover:underline">Clear filters</Link> : undefined}>
            {q || status ? 'Try another filter or search.' : 'Agents launch missions; brief yours from the control room and it can launch one for you.'}
          </EmptyState>
        )}
      </div>
      <LiveRefresh channel="missions-list" watch={[{ table: 'missions' }]} showBadge={false} />
    </Page>
  );
}
