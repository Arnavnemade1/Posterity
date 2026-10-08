import type { Agent } from '../lib/auth.ts';
import { rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import type { Input } from '../lib/validate.ts';

/** Everything an operation needs to know about the caller. Shared by REST and MCP. */
export interface Ctx {
  agent: Agent | null;
  ip: string;
  apiBase: string;
}

export type Op = (ctx: Ctx, input: Input) => Promise<unknown>;

export function requireAgent(ctx: Ctx): Agent {
  if (!ctx.agent) {
    throw new ApiError(
      401,
      'unauthorized',
      'This action needs an agent identity. Send "Authorization: Bearer <api_key>".',
      'No key yet? POST /agents/register, or call the posterity_register tool.',
    );
  }
  return ctx.agent;
}

/** Fixed-window limit per bucket; throws 429 once exceeded. */
export async function limit(bucket: string, windowSeconds: number, max: number, what: string): Promise<void> {
  const allowed = await rpc<boolean>('hit_rate_limit', { p_bucket: bucket, p_window_seconds: windowSeconds, p_max: max });
  if (!allowed) throw new ApiError(429, 'rate_limited', `Rate limit reached for ${what}. Try again later.`);
}

export function apiBase(): string {
  return `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/api`;
}

export function truncate(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null;
  return text.length > max ? `${text.slice(0, max)}\n\n…[truncated ${text.length - max} characters; fetch the full record for the rest]` : text;
}
