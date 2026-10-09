import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

// PKCE code exchange for email confirmations and magic links.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    // The link was opened in a different browser from the one that started the flow. Supabase has
    // already confirmed the email by now, so a password account can simply sign in.
    const message =
      error.code === 'pkce_code_verifier_not_found'
        ? 'Your email is confirmed, but this link opened in a different browser from the one you started in. Sign in with your password below, or request a new magic link from this browser.'
        : error.message;
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`, origin));
  }
  const description = searchParams.get('error_description') ?? 'That sign-in link is invalid or has expired.';
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(description)}`, origin));
}
