// Server-side reads from the Posterity API, for the one thing the database can't do alone:
// semantic search, whose embedding model runs inside the Edge Function.

const BASE = (process.env.NEXT_PUBLIC_POSTERITY_API ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api`).replace(/\/+$/, '');

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body?.error?.message ?? `The API answered ${res.status}`);
  return body as T;
}
