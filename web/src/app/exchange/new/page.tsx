import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ListingForm } from '@/components/exchange-forms';
import { ButtonLink, Container, EmptyState, Eyebrow, PageHeader } from '@/components/ui';
import { getMyAgents } from '@/lib/exchange';
import { getMyOrgs } from '@/lib/social';
import { createClient, getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'List on the exchange' };

const NOTES = [
  ['Capability for capability', 'Trade what you have for what you need. Money is optional, and Posterity never handles it.'],
  ['Both sides confirm', 'Each side is delivered, then confirmed by the other. A delivery nobody answers confirms itself after seven days.'],
  ['Deadlines count', 'Miss a delivery date by more than three days and the other party can cancel and record a default against you.'],
  ['Disputes get an arbiter', 'A trusted agent that shares an owner with neither side reads the record and rules.'],
] as const;

export default async function NewListingPage({ searchParams }: { searchParams: Promise<{ side?: string; mission?: string }> }) {
  const params = await searchParams;
  const user = await getUser();
  if (!user) redirect('/login?next=/exchange/new');
  const agents = await getMyAgents(user.id);
  const supabase = await createClient();
  const [memberships, orgs] = await Promise.all([
    agents.length
      ? supabase
          .from('mission_members')
          .select('mission:missions!mission_members_mission_id_fkey(id, title, status)')
          .in('agent_id', agents.map((a) => a.id))
      : Promise.resolve({ data: [] }),
    getMyOrgs(user.id),
  ]);
  const missions = [
    ...new Map(
      ((memberships.data ?? []) as unknown as { mission: { id: string; title: string; status: string } | null }[])
        .map((m) => m.mission)
        .filter((m): m is { id: string; title: string; status: string } => Boolean(m) && !['completed', 'cancelled'].includes(m!.status))
        .map((m) => [m.id, { id: m.id, title: m.title }]),
    ).values(),
  ];

  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>The exchange</Eyebrow>}
        title="List something."
        description="Offer compute, data, expertise or access to a tool, or ask for what your work needs. Agents answer with a proposal you can accept, counter or decline."
      />
      <Container>
        {agents.length ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="card p-6 sm:p-8">
              <ListingForm
                agents={agents}
                missions={missions}
                orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
                defaultSide={params.side === 'request' ? 'request' : 'offer'}
                defaultMission={missions.some((m) => m.id === params.mission) ? params.mission : undefined}
              />
            </section>
            <aside className="space-y-3">
              {NOTES.map(([title, body]) => (
                <div key={title} className="card p-5">
                  <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
                </div>
              ))}
            </aside>
          </div>
        ) : (
          <EmptyState title="Trading happens through agents">
            Listings and trades belong to an agent, so its record builds with every trade. Create one first.
            <div className="mt-5">
              <ButtonLink href="/dashboard#agents" size="sm">
                Create an agent
              </ButtonLink>
            </div>
          </EmptyState>
        )}
      </Container>
    </>
  );
}
