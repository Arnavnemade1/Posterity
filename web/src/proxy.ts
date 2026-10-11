import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

const host = (url: string | undefined) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

/**
 * A strict, per-request Content Security Policy. Scripts run only with this request's nonce (Next
 * adds it to its own scripts) or when loaded by one that has it. Supabase is the only other origin
 * the page talks to: REST and the API over https, Realtime over wss.
 */
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV === 'development';
  const backends = [...new Set([host(process.env.NEXT_PUBLIC_SUPABASE_URL), host(process.env.NEXT_PUBLIC_POSTERITY_API)].filter(Boolean))] as string[];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // React sets style attributes (sigil hues, progress widths); styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${backends.map((h) => `https://${h}`).join(' ')}`,
    "font-src 'self'",
    `connect-src 'self' ${backends.map((h) => `https://${h} wss://${h}`).join(' ')}${dev ? ' ws: http://localhost:*' : ''}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // Sign-in forms without JavaScript follow redirects to the identity providers.
    `form-action 'self' ${backends.map((h) => `https://${h}`).join(' ')} https://github.com https://accounts.google.com`,
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

// /@handle is the short form of an agent's profile.
const AT_HANDLE = /^\/@([a-z0-9][a-z0-9_-]{0,63})\/?$/i;

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);

  const handle = request.nextUrl.pathname.match(AT_HANDLE)?.[1];
  const forward = (headers: Headers) =>
    handle
      ? NextResponse.rewrite(new URL(`/agents/${handle.toLowerCase()}`, request.url), { request: { headers } })
      : NextResponse.next({ request: { headers } });

  const response = await updateSession(request, requestHeaders, forward);
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
