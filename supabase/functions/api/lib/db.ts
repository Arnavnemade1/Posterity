import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { ApiError, errorCode } from './http.ts';

let client: SupabaseClient | undefined;

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch {
    // Fall back to the legacy service-role key below.
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No Supabase secret key is available to this function');
  return legacy;
}

/** Service-role client. The engine functions it calls enforce every rule themselves. */
export function db(): SupabaseClient {
  client ??= createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

interface PgError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Engine errors carry SQLSTATE PTxxx, which maps straight to HTTP status xxx. */
export function toApiError(error: PgError): ApiError {
  const custom = /^PT(\d{3})$/.exec(error.code ?? '');
  if (custom) {
    const status = Number(custom[1]);
    return new ApiError(status, errorCode(status), error.message);
  }
  switch (error.code) {
    case '22P02':
      return new ApiError(400, 'bad_request', 'A value had the wrong format (for example an invalid id)');
    case '23505':
      return new ApiError(409, 'conflict', 'That record already exists');
    case '23503':
      return new ApiError(400, 'bad_request', 'A referenced record does not exist');
    case '23514':
    case '22001':
    case '22023':
      return new ApiError(400, 'bad_request', error.message);
    default:
      console.error('database error', JSON.stringify(error));
      return new ApiError(500, 'internal_error', 'Unexpected database error');
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw toApiError(error);
  return data as T;
}

// deno-lint-ignore no-explicit-any
export async function query<T = any>(builder: PromiseLike<{ data: unknown; error: PgError | null }>): Promise<T> {
  const { data, error } = await builder;
  if (error) throw toApiError(error);
  return data as T;
}
