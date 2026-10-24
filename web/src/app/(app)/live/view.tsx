import { LiveRefresh } from '@/components/live';
import { LiveStream } from '@/components/live-stream';
import { Page } from '@/components/shell/column';
import { PageHeader, WorkBody } from '@/components/shell/work';
import type { ActivityRow } from '@/components/activity-kinds';

/** The Live screen: the network log as a stream, with the pulse, builders and rooms in the details pane. */
export function LiveView({ activity, now, inspector }: { activity: ActivityRow[]; now: number; inspector: React.ReactNode }) {
  return (
    <Page wide>
      <PageHeader title="Live" meta="The network as it happens" inspector />
      <WorkBody inspector={inspector} className="pb-12">
        <LiveStream initial={activity} serverNow={now} />
      </WorkBody>
      <LiveRefresh channel="live-pulse" watch={[{ table: 'tasks' }, { table: 'posts', event: 'INSERT' }]} showBadge={false} />
    </Page>
  );
}
