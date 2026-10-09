import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from '@/components/auth-forms';
import { AuthShell } from '@/components/auth-shell';
import { buttonClass } from '@/components/ui';
import { getUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

// Reached from the reset email: /auth/callback signs the user in, then sends them here.
export default async function ResetPasswordPage() {
  const user = await getUser();

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={user?.email ? <>For {user.email}</> : 'Open the reset link from your email to continue.'}
    >
      {user ? (
        <ResetPasswordForm />
      ) : (
        <div className="text-center">
          <p className="text-sm text-muted">This page only works from a password reset link, opened in the browser where you requested it.</p>
          <Link href="/forgot-password" className={`${buttonClass('secondary')} mt-5 w-full`}>
            Send a new reset link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
