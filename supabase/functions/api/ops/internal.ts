// Internal endpoints the database calls over pg_net. Authenticated with a shared token from app_config.
import { db, query, rpc } from '../lib/db.ts';
import { embed } from '../lib/embed.ts';
import { ApiError, json } from '../lib/http.ts';
import { kickCode } from './code_worker.ts';
import { kickSync } from './github_sync.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

let tokenCache: { value: string | null; expires: number } | undefined;

async function internalToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.value;
  const row = await query(db().from('app_config').select('value').eq('key', 'internal_token').maybeSingle());
  tokenCache = { value: row?.value ?? null, expires: Date.now() + 300_000 };
  return tokenCache.value;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

let draining: Promise<void> | null = null;

/** Embeds memory entries that have no vector yet, in batches, for up to ~25 seconds. */
async function drain(): Promise<void> {
  const started = Date.now();
  let embedded = 0;
  let failed = 0;
  while (Date.now() - started < 25_000) {
    const batch = await rpc<{ id: string; content: string }[]>('claim_embedding_batch', { p_limit: 16 });
    if (!batch.length) break;
    for (const row of batch) {
      try {
        await rpc('store_knowledge_embedding', { p_id: row.id, p_embedding: await embed(row.content) });
        embedded++;
      } catch (err) {
        failed++;
        console.error('embedding failed', row.id, err);
      }
    }
  }
  console.log(`embed worker: ${embedded} embedded, ${failed} failed`);
}

export async function handleInternal(req: Request, path: string): Promise<Response> {
  if (!['/internal/embed', '/internal/github-sync', '/internal/code-worker'].includes(path) || req.method !== 'POST') {
    throw new ApiError(404, 'not_found', `No route for ${req.method} ${path}`);
  }
  const expected = await internalToken();
  if (!expected || !safeEqual(req.headers.get('x-posterity-internal') ?? '', expected)) {
    throw new ApiError(401, 'unauthorized', 'This endpoint is internal');
  }
  if (path === '/internal/code-worker') {
    // Line merges and rename searches merges wait on; the drain keeps running after this answers.
    const running = kickCode();
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) return json({ accepted: true }, 202);
    await running;
    return json({ done: true });
  }
  if (path === '/internal/github-sync') {
    // The drain keeps running after this answers (EdgeRuntime.waitUntil inside kickSync).
    const running = kickSync();
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) return json({ accepted: true }, 202);
    return json({ done: await running });
  }
  // One drain per isolate at a time; overlapping kicks share it.
  draining ??= drain()
    .catch((err) => console.error('embed worker failed', err))
    .finally(() => {
      draining = null;
    });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
    EdgeRuntime.waitUntil(draining);
    return json({ accepted: true }, 202);
  }
  await draining;
  return json({ done: true });
}
