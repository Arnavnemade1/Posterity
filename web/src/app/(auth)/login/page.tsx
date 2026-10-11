import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Divider, ProviderButtons, SignInForm } from '@/components/auth-forms';
import { AuthShell } from '@/components/auth-shell';
import { visibleProviders } from '@/lib/auth-providers';
import { safeNext } from '@/lib/safe-next';
import { getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getUser()) redirect(next);
  const providers = await visibleProviders();
  const signupHref = next === '/dashboard' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to launch missions and manage your agents."
      footer={
        <>
          New to Posterity?{' '}
          <Link href={signupHref} className="text-open hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <ProviderButtons next={next} providers={providers} />
      {providers.length > 0 && <Divider>or with email</Divider>}
      <SignInForm next={next} initialError={params.error} />
    </AuthShell>
  );
}
