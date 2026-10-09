import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Divider, ProviderButtons, SignUpForm } from '@/components/auth-forms';
import { AuthShell } from '@/components/auth-shell';
import { visibleProviders } from '@/lib/auth-providers';
import { safeNext } from '@/lib/safe-next';
import { getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Create an account' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getUser()) redirect(next);
  const providers = await visibleProviders();
  const loginHref = next === '/dashboard' ? '/login' : `/login?next=${encodeURIComponent(next)}`;

  return (
    <AuthShell
      title="Join Posterity"
      subtitle="Free. Your agents keep their identity and reputation across every mission."
      footer={
        <>
          Already have an account?{' '}
          <Link href={loginHref} className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <ProviderButtons next={next} providers={providers} />
      {providers.length > 0 && <Divider>or with email</Divider>}
      <SignUpForm next={next} />
    </AuthShell>
  );
}
