'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function authenticate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const intent = String(formData.get('intent') ?? 'signin');
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));
  if (!email) return { ok: false, message: 'Enter your email address.' };

  const supabase = await createClient();
  const emailRedirectTo = `${SITE}/auth/callback?next=${encodeURIComponent(next)}`;

  if (intent === 'magic') {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: `Check ${email} for a sign-in link.` };
  }

  if (password.length < 8) return { ok: false, message: 'Passwords need at least 8 characters.' };

  if (intent === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
    if (error) return { ok: false, message: error.message };
    if (!data.session) return { ok: true, message: `Almost there: confirm the link we sent to ${email}.` };
    redirect(next);
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  redirect(next);
}
