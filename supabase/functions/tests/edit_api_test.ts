import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { editTool } from '../api/ops/workspaces.ts';
import type { Ctx } from '../api/ops/context.ts';
import { ApiError } from '../api/lib/http.ts';

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test');
const head = 'a'.repeat(64);
const ctx = { agent: { id: 'agent', handle: 'scout' }, ip: '127.0.0.1' } as Ctx;
type Call = { fn: string; args: Record<string, unknown> };
let calls: Call[];
let overrides: Record<string, (args: Record<string, unknown>) => unknown>;
const nativeFetch = globalThis.fetch;

// Supabase may capture fetch in its client; keep this function stable across test cases.
const fakeFetch: typeof fetch = async (url, init) => {
  const fn = String(url).split('/').pop()!;
  const args = JSON.parse(String(init?.body ?? '{}'));
  calls.push({ fn, args });
  const defaults: Record<string, unknown> = {
    hit_rate_limit: true, ws_id: 'workspace', ws_assert_read: null, ws_resolve_ref: head,
    ws_file: { binary: false, content: 'old\n', size: 4 },
    ws_add_blob: { sha256: 'b'.repeat(64) },
    ws_commit: { commit: 'c'.repeat(64), branch: 'scout/fix', workspace: 'test', created_branch: false },
    ws_claim_conflicts: [],
  };
  if (!(fn in defaults)) throw new Error(`Unexpected RPC: ${fn}`);
  const value = overrides[fn] ? overrides[fn](args) : defaults[fn];
  return value instanceof Response ? value : Response.json(value);
};
const input = () => ({ workspace: 'test', branch: 'scout/fix', expected_head: head, message: 'Fix', files: [{ path: 'a.ts', edits: [{ old_text: 'old', new_text: 'new' }] }] });
async function run(test: () => Promise<void>) {
  calls = [];
  overrides = {};
  globalThis.fetch = fakeFetch;
  try { await test(); } finally { globalThis.fetch = nativeFetch; }
}
const writes = () => calls.filter((c) => c.fn === 'ws_commit' || c.fn === 'ws_add_blob');

Deno.test('edit preview returns a diff, pins reads, and never stores blobs or commits', () => run(async () => {
  const result = await editTool(ctx, { ...input(), dry_run: true });
  assert('status' in result);
  assertEquals(result.status, 'preview');
  assertEquals(writes(), []);
  assertEquals(calls.find((c) => c.fn === 'ws_file')?.args.p_ref, head);
  assertEquals((result.files as { hunks: { lines: string[] }[] }[])[0].hunks[0].lines, ['-old', '+new']);
}));

Deno.test('all edits validate before any file is uploaded; failed second file is atomic', () => run(async () => {
  await assertRejects(() => editTool(ctx, { ...input(), files: [...input().files, { path: 'b.ts', edits: [{ old_text: 'missing', new_text: 'x' }] }] }), ApiError);
  assertEquals(writes(), []);
}));

Deno.test('large edit previews explain omitted diffs and never write', () => run(async () => {
  overrides.ws_file = () => ({ binary: false, content: 'old' + 'x'.repeat(400_001), size: 400_004 });
  const result = await editTool(ctx, { ...input(), dry_run: true });
  assert('files' in result);
  assert(result.files?.[0].note?.includes('too large'));
  assertEquals(result.files?.[0].hunks, undefined);
  assertEquals(writes(), []);
}));

Deno.test('a moved head fails before reading files', () => run(async () => {
  overrides.ws_resolve_ref = () => 'd'.repeat(64);
  const error = await assertRejects(() => editTool(ctx, input()), ApiError);
  assertEquals(error.code, 'head_moved');
  assertEquals(calls.filter((c) => c.fn === 'ws_file'), []);
  assertEquals(writes(), []);
}));

Deno.test('commit forwards the expected head and leaves executable mode unchanged', () => run(async () => {
  await editTool(ctx, input());
  const commit = calls.find((c) => c.fn === 'ws_commit')!;
  assertEquals(commit.args.p_expected_head, head);
  assertEquals(commit.args.p_changes, [{ path: 'a.ts', blob: 'b'.repeat(64) }]);
}));

Deno.test('engine rejects races and protected branches without a retry', () => run(async () => {
  for (const code of ['PT409', 'PT403']) {
    calls = [];
    overrides.ws_commit = () => Response.json({ code, message: 'Refused by engine' }, { status: code === 'PT409' ? 409 : 403 });
    await assertRejects(() => editTool(ctx, input()), ApiError);
    assertEquals(calls.filter((c) => c.fn === 'ws_commit').length, 1);
  }
}));

Deno.test('no-op edits do not create commits; duplicate paths and binary files are rejected', () => run(async () => {
  const result = await editTool(ctx, { ...input(), files: [{ path: 'a.ts', edits: [{ old_text: 'old', new_text: 'old' }] }] });
  assert('status' in result);
  assertEquals(result.status, 'unchanged');
  await assertRejects(() => editTool(ctx, { ...input(), files: [...input().files, ...input().files] }), ApiError);
  overrides.ws_file = () => ({ binary: true, content: null, size: 4 });
  await assertRejects(() => editTool(ctx, input()), ApiError);
  assertEquals(writes(), []);
}));
