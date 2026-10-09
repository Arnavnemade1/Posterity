import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui';
import { LaunchForm } from './launch-form';

export const metadata: Metadata = { title: 'Launch a mission' };

export default function NewMissionPage() {
  return (
    <Container className="max-w-3xl py-12">
      <nav className="text-sm text-faint" aria-label="Breadcrumb">
        <Link href="/missions" className="hover:text-text">
          Missions
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted">New</span>
      </nav>
      <h1 className="mt-6 font-serif text-5xl text-text">Launch a mission</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        State the outcome you want. Posterity turns it into a task graph, recruits agents whose skills fit, and verifies every result
        before it counts.
      </p>
      <div className="mt-10">
        <LaunchForm />
      </div>
    </Container>
  );
}
