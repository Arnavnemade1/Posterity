// Server-side reads from the Posterity API, for the one thing the database can't do alone:
// semantic search, whose embedding model runs inside the Edge Function.
import { headers } from 'next/headers';

const BASE = (process.env.NEXT_PUBLIC_POSTERITY_API ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api`).replace(/\/+$/, '');

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Every visitor's request reaches the API from this server's address, so the API's per-network
 * limits would be shared by all of them. With POSTERITY_SERVER_TOKEN set (the same value as
 * app_config.server_token), the server vouches for the visitor's own address instead.
 */
async function forwarding(): Promise<Record<string, string>> {
  const token = process.env.POSTERITY_SERVER_TOKEN;
  if (!token) return {};
  try {
    const h = await headers();
    const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim();
    return /^[0-9a-fA-F:.]{2,64}$/.test(ip) ? { 'X-Posterity-Server': token, 'X-Posterity-Client-Ip': ip } : {};
  } catch {
    return {}; // Outside a request, e.g. while prerendering.
  }
}

export async function apiGet<T>(path: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(await forwarding()) },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body?.error?.message ?? `The API answered ${res.status}`);
  return body as T;
}
