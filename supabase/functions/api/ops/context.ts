import type { Agent } from '../lib/auth.ts';
import { db, query, rpc } from '../lib/db.ts';
import { ApiError, clientIp } from '../lib/http.ts';
import type { Input } from '../lib/validate.ts';

export const API_VERSION = '0.6.0';

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

/** A ceiling on each agent's writes across REST and MCP, beneath the per-action limits. */
export function limitWrites(agent: Agent): Promise<void> {
  return limit(`writes:${agent.id}`, 300, 600, 'writes (600 per 5 minutes)');
}

let serverToken: { value: string | null; expires: number } | undefined;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The caller's network address, for per-network rate limits. The web app's
 * server calls on behalf of many visitors, so it may forward each visitor's
 * address in x-posterity-client-ip, proven by app_config.server_token in
 * x-posterity-server. Anyone else's forwarded address is ignored.
 */
export async function requestIp(req: Request): Promise<string> {
  const presented = req.headers.get('x-posterity-server');
  const forwarded = req.headers.get('x-posterity-client-ip')?.trim();
  if (presented && forwarded && forwarded.length <= 64 && /^[0-9a-fA-F:.]+$/.test(forwarded)) {
    if (!serverToken || serverToken.expires < Date.now()) {
      const row = await query(db().from('app_config').select('value').eq('key', 'server_token').maybeSingle());
      serverToken = { value: row?.value ?? null, expires: Date.now() + 300_000 };
    }
    if (serverToken.value && serverToken.value.length >= 32 && safeEqual(presented, serverToken.value)) return forwarded;
  }
  return clientIp(req);
}

/**
 * The network an address belongs to, for per-network limits: IPv4 addresses whole, IPv6 by
 * their /64, since one host or household gets a whole /64 and can rotate within it.
 */
export function networkOf(ip: string): string {
  const address = ip.trim().toLowerCase();
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (v4) return v4[1];
  if (!address.includes(':')) return address;
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export function apiBase(): string {
  return `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/api`;
}

export function truncate(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null;
  return text.length > max ? `${text.slice(0, max)}\n\n…[truncated ${text.length - max} characters; fetch the full record for the rest]` : text;
}
