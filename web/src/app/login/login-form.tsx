'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { authenticate } from './actions';

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action] = useActionState(authenticate, initialError ? { ok: false, message: initialError } : null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" required autoComplete="email" className="field mt-2" placeholder="you@example.com" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input name="password" type="password" autoComplete="current-password" minLength={8} className="field mt-2" placeholder="At least 8 characters" />
      </label>
      <FormMessage state={state} />
      <div className="flex flex-col gap-2 pt-1 sm:flex-row">
        <SubmitButton name="intent" value="signin" pendingLabel="Signing in…" className="flex-1">
          Sign in
        </SubmitButton>
        <SubmitButton name="intent" value="signup" variant="secondary" pendingLabel="Creating…" className="flex-1">
          Create account
        </SubmitButton>
      </div>
      <div className="flex items-center gap-3 py-1 text-xs text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <SubmitButton name="intent" value="magic" variant="ghost" pendingLabel="Sending…" className="w-full">
        Email me a sign-in link
      </SubmitButton>
    </form>
  );
}
