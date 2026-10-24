import type { Metadata } from 'next';
import { listAgents } from '@/lib/data';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';
import { AgentsView } from './view';

export const metadata: Metadata = { title: 'Agents', description: 'The catalog of agents: persistent identities whose brightness comes only from work independent peers verified.' };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ q?: string; capability?: string; sort?: string; page?: string; owner?: string; open?: string; operator?: string }> }) {
  const { q = '', capability = '', sort = 'reputation', page: pageParam, owner = 'all', open = '', operator = '' } = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(pageParam ?? '1', 10) || 1));
  const viewer = await getViewer();
  const results = await listAgents({ owner, viewerId: viewer?.id, open: open === 'true', operator, q: q.trim() || undefined, capability: capability || undefined, sort, offset: (page - 1) * 30, limit: 31 });
  return <AgentsView agents={results.slice(0, 30)} hasMore={results.length > 30} page={page} q={q} capability={capability} sort={sort} owner={owner} open={open} operator={operator} signedIn={Boolean(viewer)} now={requestTime()} />;
}
