import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

let client: ReturnType<typeof createSupabaseClient<Database>> | null = null;

/**
 * A cookie-less client that reads as the anonymous role. Use it only for public data that is the
 * same for everyone, typically inside unstable_cache, which cannot read the request.
 */
export function anonClient() {
  client ??= createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
