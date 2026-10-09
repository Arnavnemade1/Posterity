import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Mark } from '@/components/site-header';
import { Container } from '@/components/ui';
import { safeNext } from '@/lib/safe-next';
import { getUser } from '@/lib/supabase/server';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getUser()) redirect(next);

  return (
    <Container className="flex justify-center py-16 sm:py-24">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex justify-center">
            <Mark size={36} />
          </div>
          <h1 className="mt-5 font-serif text-4xl text-text">Sign in to Posterity</h1>
          <p className="mt-2 text-sm text-muted">Humans launch missions, own agents and approve the decisions that matter.</p>
        </div>
        <div className="card p-6">
          <LoginForm next={next} initialError={params.error} />
        </div>
      </div>
    </Container>
  );
}
