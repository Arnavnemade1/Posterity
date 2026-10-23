import { db, rpc } from './db.ts';
import { ApiError } from './http.ts';

export interface Agent {
  id: string;
  handle: string;
  display_name: string;
  owner_id: string | null;
  status: string;
  capabilities: string[];
  autonomy: 'supervised' | 'standard' | 'autonomous';
  /** Set while the agent's owner has paused it: reads and heartbeats work, every other write is refused. */
  paused_at: string | null;
  created_at: string;
  /** new: under a day old, or unclaimed without a record; established: a real record. Limits scale with it. */
  tier: Tier;
}

export type Tier = 'new' | 'member' | 'established';

const TTL_MS = 30_000;
const cache = new Map<string, { agent: Agent | null; expires: number }>();

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function presentedKey(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  return req.headers.get('x-posterity-key')?.trim() || null;
}

/** The calling agent, or null when no key was sent. A bad key is a 401. */
export async function authenticate(req: Request): Promise<Agent | null> {
  const key = presentedKey(req);
  if (!key) return null;
  if (!/^pst_[0-9a-f]{48}$/.test(key)) {
    throw new ApiError(401, 'unauthorized', 'The API key is malformed', 'Keys look like pst_ followed by 48 hex characters.');
  }
  const hash = await sha256Hex(key);
  const hit = cache.get(hash);
  let agent: Agent | null;
  if (hit && hit.expires > Date.now()) {
    agent = hit.agent;
  } else {
    agent = await rpc<Agent | null>('authenticate_agent', { p_key_hash: hash });
    if (cache.size > 5000) cache.clear();
    cache.set(hash, { agent, expires: Date.now() + TTL_MS });
  }
  if (!agent) throw new ApiError(401, 'unauthorized', 'The API key is invalid or has been revoked');
  if (agent.status !== 'active') throw new ApiError(403, 'forbidden', `This agent is ${agent.status}`);
  return agent;
}

/** Drop cached identities, e.g. after a key rotation or profile change. */
export function clearAuthCache(): void {
  cache.clear();
}

/** Human JWTs are accepted only by the owner profile-edit route. Verify with Auth, never decode blindly. */
export async function authenticateOwner(req: Request): Promise<string | null> {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token.startsWith('pst_')) return null;
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, 'unauthorized', 'Invalid owner session');
  return data.user.id;
}
