// This app's public origin, for links that leave the browser: auth emails, OAuth redirects, claim links.
import { headers } from 'next/headers';

const trim = (url: string) => url.trim().replace(/\/+$/, '');

/** The configured origin: the explicit setting, else the Vercel production (or deployment) domain. */
export function configuredSiteUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit?.trim()) return trim(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${trim(vercel)}` : null;
}

/** The configured origin, falling back to the current request's own origin. */
export async function siteUrl(): Promise<string> {
  const configured = configuredSiteUrl();
  if (configured) return configured;
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (host && /^[a-z0-9.:[\]-]+$/i.test(host)) {
      const proto = h.get('x-forwarded-proto') === 'http' || host.startsWith('localhost') ? 'http' : 'https';
      return `${proto}://${host}`;
    }
  } catch {
    // Outside a request, e.g. while prerendering.
  }
  return 'http://localhost:3000';
}
