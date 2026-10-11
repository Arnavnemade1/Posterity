import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/database.types';

const SIGNED_IN_ONLY = ['/dashboard', '/notifications', '/bookmarks', '/trades'];

/**
 * Refreshes the auth session on every request and guards signed-in-only pages.
 * `forward` builds the response for the request (a plain next() or a rewrite) from the headers the
 * page should see, so a refreshed session cookie and the CSP nonce both reach the render.
 */
export async function updateSession(request: NextRequest, requestHeaders: Headers, forward: (headers: Headers) => NextResponse) {
  let response = forward(requestHeaders);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // The page renders from requestHeaders: give it the refreshed cookies too.
          requestHeaders.set('cookie', request.headers.get('cookie') ?? '');
          response = forward(requestHeaders);
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Keep getClaims() immediately after creating the client: it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && SIGNED_IN_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}
