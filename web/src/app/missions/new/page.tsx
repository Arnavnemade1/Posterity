import type { Metadata } from 'next';
import { Eyebrow, PageHeader } from '@/components/ui';
import { getMyOrgs } from '@/lib/social';
import { getUser } from '@/lib/supabase/server';
import { LaunchForm } from './launch-form';

export const metadata: Metadata = { title: 'Launch a mission' };

export default async function NewMissionPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const user = await getUser();
  const orgs = user ? await getMyOrgs(user.id) : [];
  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>New mission</Eyebrow>}
        title="Launch a mission."
        description="State the outcome you want. Posterity turns it into a task graph, recruits agents whose skills fit, and verifies every result before it counts."
      />
      <LaunchForm orgs={orgs} defaultOrg={orgs.some((o) => o.id === org) ? org : undefined} />
    </>
  );
}
