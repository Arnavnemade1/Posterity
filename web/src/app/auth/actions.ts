'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { enabledProviders, isProvider, PROVIDERS } from '@/lib/auth-providers';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const callbackUrl = (next: string) => `${SITE}/auth/callback?next=${encodeURIComponent(next)}`;

export type EmailSentState = (ActionState & { sentTo?: string }) | null;

const field = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim();

/** Supabase's error messages are terse; these are the ones people actually hit. */
function friendly(error: { code?: string; message: string }): string {
  switch (error.code) {
    case 'over_email_send_rate_limit':
      return 'Too many emails were sent recently. If you already have an account, sign in with your password, or try again in an hour.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    case 'invalid_credentials':
      return 'That email and password don’t match. If you joined with Google or GitHub, use that button instead.';
    case 'email_not_confirmed':
      return 'Confirm your email first: open the link we sent you, in this browser.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account already uses that email. Sign in instead.';
    case 'weak_password':
      return 'Choose a stronger password: at least 8 characters, and not a common one.';
    case 'same_password':
      return 'That is your current password. Choose a new one.';
    case 'signup_disabled':
      return 'New sign-ups are closed right now.';
    default:
      return error.message;
  }
}

export async function signInWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = field(formData, 'email');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { ok: false, message: 'Enter your email and password.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: friendly(error) };
  redirect(safeNext(formData.get('next')));
}

export async function sendMagicLink(_prev: EmailSentState, formData: FormData): Promise<EmailSentState> {
  const email = field(formData, 'email');
  if (!email) return { ok: false, message: 'Enter your email address.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(safeNext(formData.get('next'))) },
  });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true, message: '', sentTo: email };
}

export async function signUp(_prev: EmailSentState, formData: FormData): Promise<EmailSentState> {
  const email = field(formData, 'email');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));
  if (!email) return { ok: false, message: 'Enter your email address.' };
  if (password.length < 8) return { ok: false, message: 'Passwords need at least 8 characters.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(next) } });
  if (error) return { ok: false, message: friendly(error) };
  if (data.session) redirect(next);
  // With email confirmation on, Supabase hides existing accounts by returning a user with no identities.
  if (data.user && data.user.identities?.length === 0) {
    return { ok: false, message: 'An account already uses that email. Sign in instead, or reset your password.' };
  }
  return { ok: true, message: '', sentTo: email };
}

export async function requestPasswordReset(_prev: EmailSentState, formData: FormData): Promise<EmailSentState> {
  const email = field(formData, 'email');
  if (!email) return { ok: false, message: 'Enter your email address.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/reset-password') });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true, message: '', sentTo: email };
}

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get('password') ?? '');
  if (password.length < 8) return { ok: false, message: 'Passwords need at least 8 characters.' };
  if (password !== String(formData.get('confirm') ?? '')) return { ok: false, message: 'The two passwords don’t match.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: friendly(error) };
  redirect('/dashboard');
}

export async function signInWithProvider(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const provider = formData.get('provider');
  if (!isProvider(provider)) return { ok: false, message: 'Unknown sign-in provider.' };
  const label = PROVIDERS.find((p) => p.id === provider)!.label;
  if (!(await enabledProviders())[provider]) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'production'
          ? `${label} sign-in isn’t available right now.`
          : `${label} sign-in isn’t switched on yet. Enable it in Supabase → Authentication → Sign In / Providers.`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: callbackUrl(safeNext(formData.get('next'))) },
  });
  if (error || !data.url) return { ok: false, message: error ? friendly(error) : `Could not reach ${label}.` };
  redirect(data.url);
}
