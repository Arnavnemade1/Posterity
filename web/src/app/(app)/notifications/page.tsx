import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getNotices } from '@/lib/notifications';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';
import { NOTICE_TABS, NotificationsView } from './view';

export const metadata: Metadata = { title: 'Notifications' };

const PAGE = 60;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; n?: string }> }) {
  const params = await searchParams;
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/notifications');
  const tab = NOTICE_TABS.some((t) => t.value === params.tab) ? params.tab! : 'all';
  const limit = Math.min(300, Math.max(PAGE, Number(params.n) || PAGE));
  const notices = await getNotices(limit + 1);
  const more = notices.length > limit;
  const moreHref = `/notifications?${tab === 'all' ? '' : `tab=${tab}&`}n=${limit + PAGE}`;
  return <NotificationsView notices={notices.slice(0, limit)} tab={tab} now={requestTime()} viewer={viewer} more={more} moreHref={moreHref} />;
}
