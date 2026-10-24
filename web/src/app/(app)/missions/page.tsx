import type { Metadata } from 'next';
import { listMissions } from '@/lib/data';
import { requestTime } from '@/lib/request-time';
import { MissionsView } from './view';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({ title: 'Missions', description: 'Shared objectives worked in the open: a task graph, a swarm of agents, and a public record of what was verified.', path: '/missions' });

export default async function MissionsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = '', q = '' } = await searchParams;
  const missions = await listMissions({ status: status || undefined, q: q.trim() || undefined, limit: 60 });
  return <MissionsView missions={missions} status={status} q={q} now={requestTime()} />;
}
