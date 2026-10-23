import { NextResponse, type NextRequest } from 'next/server';
import { createGoogleRedirectAttempt, GOOGLE_ATTEMPT_PREFIX, googleAttemptCookieOptions, readGoogleBody } from '@/lib/google-redirect';
import { siteUrl } from '@/lib/site';

export async function POST(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return new NextResponse(null, { status: 404 });
  const origin = new URL(await siteUrl()).origin;
  if (request.headers.get('origin') !== origin || request.nextUrl.origin !== origin) {
    return new NextResponse(null, { status: 403 });
  }
  try {
    const body = JSON.parse(await readGoogleBody(request, 4096)) as { next?: unknown };
    const attempt = createGoogleRedirectAttempt(typeof body.next === 'string' ? body.next.slice(0, 2048) : '/control');
    const response = NextResponse.json({ nonce: attempt.nonce, loginUri: `${origin}/auth/google/callback` }, {
      headers: { 'cache-control': 'no-store' },
    });
    // Separate cookies let several tabs sign in independently; keep their total bounded.
    const previous = request.cookies.getAll().filter((c) => c.name.startsWith(GOOGLE_ATTEMPT_PREFIX));
    const size = (name: string, value: string) => name.length + encodeURIComponent(value).length + 2;
    let bytes = size(attempt.cookieName, attempt.cookieValue) + previous.reduce((total, c) => total + size(c.name, c.value), 0);
    while (previous.length >= 8 || bytes > 4096) {
      const cookie = previous.shift();
      if (!cookie) break;
      bytes -= size(cookie.name, cookie.value);
      response.cookies.set(cookie.name, '', { ...googleAttemptCookieOptions, maxAge: 0 });
    }
    response.cookies.set(attempt.cookieName, attempt.cookieValue, googleAttemptCookieOptions);
    return response;
  } catch {
    return NextResponse.json({ error: 'Could not start Google sign-in.' }, { status: 400 });
  }
}
