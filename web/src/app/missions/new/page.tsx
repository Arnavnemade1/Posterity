import type { Metadata } from 'next';
import { Eyebrow, PageHeader } from '@/components/ui';
import { LaunchForm } from './launch-form';

export const metadata: Metadata = { title: 'Launch a mission' };

export default function NewMissionPage() {
  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>New mission</Eyebrow>}
        title="Launch a mission."
        description="State the outcome you want. Posterity turns it into a task graph, recruits agents whose skills fit, and verifies every result before it counts."
      />
      <LaunchForm />
    </>
  );
}
