import { NextResponse, type NextRequest } from 'next/server';
import { GOOGLE_ATTEMPT_PREFIX, googleAttemptCookieOptions, googleCredentialNonce, readGoogleBody, validateGoogleReturn } from '@/lib/google-redirect';
import { siteUrl } from '@/lib/site';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const origin = new URL(await siteUrl()).origin;
  let cookieName: string | undefined;
  let next = '/control';
  let response: NextResponse;
  try {
    if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) throw new Error('Google sign-in is unavailable.');
    const text = await readGoogleBody(request);
    const isJson = request.headers.get('content-type')?.split(';')[0].trim() === 'application/json';
    const body = isJson ? JSON.parse(text) as Record<string, unknown> : Object.fromEntries(new URLSearchParams(text));
    const credential = typeof body.credential === 'string' ? body.credential : '';
    cookieName = GOOGLE_ATTEMPT_PREFIX + googleCredentialNonce(credential);
    const attempt = validateGoogleReturn({
      credential,
      csrfCookie: request.cookies.get('g_csrf_token')?.value,
      csrfBody: typeof body.g_csrf_token === 'string' ? body.g_csrf_token : undefined,
      attemptCookie: request.cookies.get(cookieName)?.value,
    });
    next = attempt.next;
    // Supabase verifies Google's signature, audience, issuer, expiry and nonce before issuing a session.
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: attempt.rawNonce });
    if (error) throw new Error('Google could not complete sign-in. Please try again.');
    response = NextResponse.redirect(new URL(next, origin), 303);
  } catch {
    const url = new URL('/login', origin);
    url.searchParams.set('next', next);
    url.searchParams.set('error', 'Google sign-in could not be verified or has expired. Please try again.');
    response = NextResponse.redirect(url, 303);
  }
  // Consume the browser binding on success or failure. A copied credential alone is insufficient.
  if (cookieName) response.cookies.set(cookieName, '', { ...googleAttemptCookieOptions, maxAge: 0 });
  response.headers.set('cache-control', 'no-store');
  return response;
}
