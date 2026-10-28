import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { heartbeat } from '../api/ops/agents.ts';
import type { Ctx } from '../api/ops/context.ts';

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test');
const ctx = { agent: { id: 'agent', handle: 'mail-worker', paused_at: null, tier: 'member' }, ip: '127.0.0.1' } as Ctx;
const nativeFetch = globalThis.fetch;
let calls: string[] = [];
let approved = false;
const fakeFetch: typeof fetch = async (url) => {
  const fn = String(url).split('/').pop()!;
  calls.push(fn);
  if (fn === 'take_owner_requests') return Response.json(approved ? [{ id: 'approval', action: 'dm.reply', payload: {
    conversation_id: '11111111-1111-4111-8111-111111111111', body: 'Owner-approved reply',
  } }] : []);
  if (fn === 'authorize_standing_action') return Response.json({ decision: 'allow' });
  if (fn === 'hit_rate_limit') return Response.json(true);
  if (fn === 'send_message') return Response.json({ id: 'reply' });
  if (fn === 'finish_owner_request') return Response.json(null);
  throw new Error(`Mailbox heartbeat must not invoke ${fn}`);
};

Deno.test('mailbox heartbeat replays approval without recruiting work or consuming the inbox', async () => {
  calls = []; approved = false; globalThis.fetch = fakeFetch;
  try {
    const result = await heartbeat(ctx, { mail_only: true });
    assertEquals(result.mail_only, true);
    assertEquals(result.approved_actions_processed, 0);
    assertEquals(calls, ['take_owner_requests']);
  } finally { globalThis.fetch = nativeFetch; }
});

Deno.test('mailbox heartbeat executes exact owner-approved replies through existing gates', async () => {
  calls = []; approved = true; globalThis.fetch = fakeFetch;
  try {
    const result = await heartbeat(ctx, { mail_only: true });
    assertEquals(result.approved_actions_processed, 1);
    assertEquals(calls, ['take_owner_requests', 'authorize_standing_action', 'hit_rate_limit', 'send_message', 'finish_owner_request']);
  } finally { globalThis.fetch = nativeFetch; }
});

Deno.test('mailbox heartbeat honors pause and validates its mode before any replay', async () => {
  calls = []; globalThis.fetch = fakeFetch;
  try {
    const result = await heartbeat({ ...ctx, agent: { ...ctx.agent!, paused_at: new Date().toISOString() } }, { mail_only: true });
    assertEquals(result.approved_actions_processed, 0);
    await assertRejects(() => heartbeat(ctx, { mail_only: 'invalid' }));
    assertEquals(calls, []);
  } finally { globalThis.fetch = nativeFetch; }
});
