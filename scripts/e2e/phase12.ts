// Phase 12 end-to-end test: code at scale over REST and MCP. Line-by-line merges worked out by the code
// worker (inline, within the request), conflicts with markers and their resolution, a file moved and
// edited, rebasing and cherry-picking, squash merges, executable files, paged trees and history, branch
// rules with required checks and a merge queue that tests on queue branches, CODEOWNERS, path claims,
// and many agents' change requests landing through one queue at once.
//
//   POSTERITY_API=<a deployment> bun scripts/e2e/phase12.ts
//
// Registers three throwaway "e2e-" agents (remove them and their workspaces with
// scripts/e2e/cleanup.sql). Registrations are limited to ten per hour per network.

import { BASE } from './lib.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function api(method: string, path: string, opts: { key?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** A call that may answer 202 while line merges are worked out: ask again, as agents are told to. */
async function settled(method: string, path: string, opts: { key?: string; body?: unknown } = {}) {
  let res = await api(method, path, opts);
  for (let i = 0; i < 6 && res.status === 202; i++) {
    await new Promise((r) => setTimeout(r, Math.min((res.data?.retry_after ?? 5) * 1000, 10_000)));
    res = await api(method, path, opts);
  }
  return res;
}

async function tool(name: string, args: Json, key?: string) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const data = await res.json();
  const text: string = data?.result?.content?.[0]?.text ?? '';
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { error: data?.result?.isError === true, text, json };
}

const run = Date.now().toString(36);
const handle = (name: string) => `e2e-${run}-${name}`;

async function register(name: string) {
  const res = await api('POST', '/agents/register', { body: { handle: handle(name), display_name: name, capabilities: ['code'] } });
  if (res.status !== 201) {
    console.error('registration failed', res.status, res.data);
    process.exit(1);
  }
  return res.data.api_key as string;
}

const commit = (key: string, ws: string, branch: string, message: string, changes: Json[]) =>
  api('POST', `/workspaces/${ws}/commits`, { key, body: { branch, message, changes } });

section('Agents and a workspace');
const lead = await register('lead');
const bob = await register('bob');
const carol = await register('carol');
check('three agents registered', Boolean(lead && bob && carol));
const slug = `e2e-${run}-scale`;
const created = await api('POST', '/workspaces', { key: lead, body: { name: 'E2E Scale', slug } });
check('workspace created', created.status === 201, created.data);
for (const who of ['bob', 'carol']) {
  await api('POST', `/workspaces/${slug}/members`, { key: lead, body: { handle: handle(who), role: 'writer' } });
}
const base = await commit(lead, slug, 'main', 'Start', [
  { path: 'src/lib.ts', content: 'line 1\nline 2\nline 3\nline 4\nline 5\n' },
  { path: 'docs/guide.md', content: '# Guide\n\nStep one.\nStep two.\nStep three.\n' },
  { path: 'bin/run.sh', content: '#!/bin/sh\necho run\n', executable: true },
  { path: '.github/CODEOWNERS', content: `* @${handle('lead')}\n/docs/ @${handle('carol')}\n` },
]);
check('a first commit, with an executable file', base.status === 201 && base.data?.stats?.added === 4, base.data);
const runSh = await api('GET', `/workspaces/${slug}/files?path=bin/run.sh`);
check('the file reads back as executable', runSh.data?.executable === true, runSh.data);

section('Line-by-line merges');
await commit(bob, slug, 'bob/top', 'Bob edits line 1', [{ path: 'src/lib.ts', content: 'line 1 (bob)\nline 2\nline 3\nline 4\nline 5\n' }]);
await commit(lead, slug, 'main', 'Lead edits line 5', [{ path: 'src/lib.ts', content: 'line 1\nline 2\nline 3\nline 4\nline 5 (lead)\n' }]);
const cr1 = await api('POST', `/workspaces/${slug}/change-requests`, { key: bob, body: { source: 'bob/top', title: 'Edit the top line' } });
check('a change request to the same file opens mergeable', cr1.status === 201 && cr1.data?.mergeable === true, cr1.data);
const m1 = await settled('POST', `/workspaces/${slug}/change-requests/${cr1.data?.number}/merge`, { key: lead, body: {} });
check('and merges, both edits kept', m1.status === 200 && m1.data?.status === 'merged', m1.data);
const lib1 = await api('GET', `/workspaces/${slug}/files?path=src/lib.ts`);
check('main has both lines changed', lib1.data?.content === 'line 1 (bob)\nline 2\nline 3\nline 4\nline 5 (lead)\n', lib1.data?.content);

section('A conflict, with markers, resolved');
await commit(bob, slug, 'bob/mid', 'Bob rewrites line 3', [{ path: 'src/lib.ts', content: 'line 1 (bob)\nline 2\nline 3 (bob)\nline 4\nline 5 (lead)\n' }]);
await commit(lead, slug, 'main', 'Lead rewrites line 3', [{ path: 'src/lib.ts', content: 'line 1 (bob)\nline 2\nline 3 (lead)\nline 4\nline 5 (lead)\n' }]);
const cr2 = await api('POST', `/workspaces/${slug}/change-requests`, { key: bob, body: { source: 'bob/mid', title: 'Rewrite line 3' } });
check('the change request shows the conflict', cr2.data?.mergeable === false && cr2.data?.conflicts?.[0] === 'src/lib.ts', cr2.data);
const refused = await api('POST', `/workspaces/${slug}/change-requests/${cr2.data?.number}/merge`, { key: lead, body: {} });
check('merging it is refused with the conflicts listed', refused.status === 409 && /conflict/.test(refused.data?.error?.message ?? ''), refused.data);
const conf = await settled('GET', `/workspaces/${slug}/change-requests/${cr2.data?.number}/conflicts`, { key: bob });
const marked: string = conf.data?.conflicts?.[0]?.marked_text ?? '';
check('the conflict view marks the lines up', conf.status === 200 && conf.data?.conflicts?.[0]?.kind === 'content'
  && marked.includes('<<<<<<< ours') && marked.includes('line 3 (bob)') && marked.includes('line 3 (lead)') && marked.includes('>>>>>>> theirs'), conf.data);
const resolved = await settled('POST', `/workspaces/${slug}/merge`, {
  key: bob,
  body: { into: 'bob/mid', from: 'main', resolutions: { 'src/lib.ts': { content: 'line 1 (bob)\nline 2\nline 3 (both)\nline 4\nline 5 (lead)\n' } } },
});
check('merging main in with the edited file resolves it', resolved.status === 200 && resolved.data?.resolved === 1, resolved.data);
const cr2b = await api('GET', `/workspaces/${slug}/change-requests/${cr2.data?.number}`);
check('the change request is mergeable again', cr2b.data?.mergeable === true, cr2b.data?.mergeable);
const sq = await settled('POST', `/workspaces/${slug}/change-requests/${cr2.data?.number}/merge`, { key: lead, body: { method: 'squash' } });
check('a squash merge lands it as one commit', sq.status === 200 && sq.data?.merge_method === 'squash', sq.data);
const log1 = await api('GET', `/workspaces/${slug}/log?limit=1`);
check('whose message is the change request', /Rewrite line 3 \(#\d+\)/.test(log1.data?.commits?.[0]?.message ?? '') && log1.data?.commits?.[0]?.parents?.length === 1, log1.data);

section('A moved and edited file keeps the other side\'s edit');
await commit(bob, slug, 'bob/move', 'Move the guide and add a step', [
  { path: 'docs/guide.md', delete: true },
  { path: 'handbook/guide.md', content: '# Guide\n\nStep one.\nStep two.\nStep three.\nStep four.\n' },
]);
await commit(lead, slug, 'main', 'Fix step one', [{ path: 'docs/guide.md', content: '# Guide\n\nStep 1.\nStep two.\nStep three.\n' }]);
const mv = await settled('POST', `/workspaces/${slug}/merge`, { key: bob, body: { into: 'bob/move', from: 'main' } });
check('merging main into the move', mv.status === 200 && mv.data?.status === 'merged', mv.data);
const moved = await api('GET', `/workspaces/${slug}/files?path=handbook/guide.md&ref=bob/move`);
check('the moved file has both changes', moved.data?.content === '# Guide\n\nStep 1.\nStep two.\nStep three.\nStep four.\n', moved.data?.content);
const gone = await api('GET', `/workspaces/${slug}/files?path=docs/guide.md&ref=bob/move`);
check('and the old path is gone', gone.status === 404, gone.status);

section('Rebase and cherry-pick');
await commit(carol, slug, 'carol/topic', 'Topic one', [{ path: 'topic/one.txt', content: 'one\n' }]);
const two = await commit(carol, slug, 'carol/topic', 'Topic two', [{ path: 'topic/two.txt', content: 'two\n' }]);
await commit(lead, slug, 'main', 'Main moves', [{ path: 'main.txt', content: 'main\n' }]);
const rb = await settled('POST', `/workspaces/${slug}/rebase`, { key: carol, body: { branch: 'carol/topic', onto: 'main' } });
check('a branch rebases onto main', rb.status === 200 && rb.data?.status === 'rebased' && rb.data?.replayed === 2, rb.data);
const rbFile = await api('GET', `/workspaces/${slug}/files?path=main.txt&ref=carol/topic`);
check('and has main\'s work under its own', rbFile.data?.content === 'main\n', rbFile.data);
await api('POST', `/workspaces/${slug}/branches`, { key: carol, body: { name: 'carol/pick', from: 'main' } });
const cp = await settled('POST', `/workspaces/${slug}/cherry-pick`, { key: carol, body: { branch: 'carol/pick', commit: two.data?.commit } });
check('one commit cherry-picks onto another branch', cp.status === 200 && cp.data?.status === 'picked', cp.data);
const pickOne = await api('GET', `/workspaces/${slug}/files?path=topic/one.txt&ref=carol/pick`);
check('without the commit before it', pickOne.status === 404, pickOne.status);

section('Paged trees and history');
const page1 = await api('GET', `/workspaces/${slug}/tree?recursive=true&limit=2`);
check('a recursive tree comes in pages', page1.data?.entries?.length === 2 && typeof page1.data?.next === 'string', page1.data);
const page2 = await api('GET', `/workspaces/${slug}/tree?recursive=true&limit=2&after=${encodeURIComponent(page1.data?.next)}`);
check('the next page continues after it', page2.data?.entries?.[0]?.path > page1.data?.next, page2.data);
const logA = await api('GET', `/workspaces/${slug}/log?limit=3`);
const logB = await api('GET', `/workspaces/${slug}/log?limit=3&before=${logA.data?.next}`);
check('history pages with before', logA.data?.commits?.length === 3 && logB.data?.commits?.length >= 1
  && !logB.data.commits.some((c: Json) => logA.data.commits.some((d: Json) => d.id === c.id)), { a: logA.data?.next, b: logB.data?.commits?.length });

section('Code owners and claims');
const owners = await api('GET', `/workspaces/${slug}/owners?paths=docs/guide.md,src/lib.ts`);
check('CODEOWNERS names the owners', owners.data?.codeowners === true
  && owners.data?.groups?.some((g: Json) => g.owners?.includes(handle('carol')))
  && owners.data?.groups?.some((g: Json) => g.owners?.includes(handle('lead'))), owners.data);
const claim = await api('POST', `/workspaces/${slug}/claims`, { key: carol, body: { patterns: ['src/'], note: 'Reworking the library', hours: 2 } });
check('an agent claims a folder', claim.status === 200 && claim.data?.claims?.[0]?.pattern === 'src/', claim.data);
const warned = await commit(bob, slug, 'bob/lib', 'Touch the library', [{ path: 'src/extra.ts', content: 'export {};\n' }]);
check('a commit there warns about the claim', warned.status === 201 && warned.data?.claim_warnings?.[0]?.agent === handle('carol'), warned.data);
const claims = await api('GET', `/workspaces/${slug}/claims`);
check('claims are listed', claims.data?.claims?.length === 1, claims.data);
const released = await api('POST', `/workspaces/${slug}/claims/release`, { key: carol, body: {} });
check('and released', released.data?.released === 1, released.data);

section('Branch rules and the merge queue');
const rules = await api('POST', `/workspaces/${slug}/branches/rules`, { key: lead, body: { name: 'main', merge_queue: true, required_checks: ['ci'], merge_methods: ['merge', 'squash'] } });
check('the owner sets rules on main', rules.status === 200 && rules.data?.rules?.merge_queue === true && rules.data?.rules?.required_checks?.[0] === 'ci', rules.data);
const notOwner = await api('POST', `/workspaces/${slug}/branches/rules`, { key: bob, body: { name: 'main', merge_queue: false } });
check('writers cannot', notOwner.status === 403, notOwner.status);
await commit(bob, slug, 'bob/q1', 'Queue one', [{ path: 'queue/one.txt', content: 'one\n' }]);
await commit(carol, slug, 'carol/q2', 'Queue two', [{ path: 'queue/two.txt', content: 'two\n' }]);
const q1 = await api('POST', `/workspaces/${slug}/change-requests`, { key: bob, body: { source: 'bob/q1', title: 'Queue one' } });
const q2 = await api('POST', `/workspaces/${slug}/change-requests`, { key: carol, body: { source: 'carol/q2', title: 'Queue two' } });
const blocked = await api('GET', `/workspaces/${slug}/change-requests/${q1.data?.number}`);
check('a change request says what blocks it', blocked.data?.blocked_by?.some((b: string) => /checks/.test(b)), blocked.data?.blocked_by);
const e1 = await api('POST', `/workspaces/${slug}/change-requests/${q1.data?.number}/merge`, { key: bob, body: {} });
check('merging it queues it instead', e1.status === 200 && e1.data?.status === 'queued' && e1.data?.queue?.status === 'testing', e1.data);
const e2 = await api('POST', `/workspaces/${slug}/change-requests/${q2.data?.number}/queue`, { key: carol, body: {} });
check('a second one queues behind it', e2.status === 200 && e2.data?.queue?.position === 2, e2.data);
const queue = await api('GET', `/workspaces/${slug}/queue`);
const [first, second] = queue.data?.queue ?? [];
check('both are being tested, each on a queue branch', first?.test_branch?.startsWith('queue/main/') && second?.test_branch?.startsWith('queue/main/')
  && first?.checks?.pending?.[0] === 'ci', queue.data);
const tested = await api('GET', `/workspaces/${slug}/files?path=queue/one.txt&ref=${encodeURIComponent(second?.test_branch ?? '')}`);
check('the second is tested with the first under it', tested.data?.content === 'one\n', tested.data);
const queueBranchPush = await commit(lead, slug, second?.test_branch ?? 'queue/main/x', 'No', [{ path: 'x', content: 'x' }]);
check('nobody pushes to a queue branch', queueBranchPush.status === 403, queueBranchPush.status);
await api('POST', `/workspaces/${slug}/change-requests/${q2.data?.number}/checks`, { key: carol, body: { name: 'ci', status: 'passed', commit: second?.test_commit } });
const mainBefore = await api('GET', `/workspaces/${slug}/files?path=queue/two.txt`);
check('it does not land before the one ahead of it', mainBefore.status === 404, mainBefore.status);
await api('POST', `/workspaces/${slug}/change-requests/${q1.data?.number}/checks`, { key: bob, body: { name: 'ci', status: 'passed', commit: first?.test_commit } });
const landed1 = await api('GET', `/workspaces/${slug}/change-requests/${q1.data?.number}`);
const landed2 = await api('GET', `/workspaces/${slug}/change-requests/${q2.data?.number}`);
check('once checks pass both land, in order', landed1.data?.status === 'merged' && landed2.data?.status === 'merged', [landed1.data?.status, landed2.data?.status]);
const mainAfter = await api('GET', `/workspaces/${slug}/tree?path=queue`);
check('main has both', mainAfter.data?.entries?.length === 2, mainAfter.data);
const branches = await api('GET', `/workspaces/${slug}`);
check('and the queue branches are gone', !branches.data?.branches?.some((b: Json) => b.name.startsWith('queue/')), branches.data?.branches?.map((b: Json) => b.name));

section('Many change requests through one queue at once');
await api('POST', `/workspaces/${slug}/branches/rules`, { key: lead, body: { name: 'main', required_checks: [], queue_depth: 10 } });
const N = 12;
const authors = [bob, carol, lead];
const names = ['bob', 'carol', 'lead'];
const pushed = await Promise.all(Array.from({ length: N }, (_, i) =>
  commit(authors[i % 3], slug, `${handle(names[i % 3])}/many-${i}`, `Many ${i}`, [{ path: `many/${i}.txt`, content: `${i}\n` }])));
check(`${N} branches pushed at once`, pushed.every((p) => p.status === 201), pushed.map((p) => p.status));
const opened = await Promise.all(Array.from({ length: N }, (_, i) =>
  api('POST', `/workspaces/${slug}/change-requests`, { key: authors[i % 3], body: { source: `${handle(names[i % 3])}/many-${i}`, title: `Many ${i}` } })));
check('and proposed at once', opened.every((o) => o.status === 201), opened.map((o) => o.status));
const queued = await Promise.all(opened.map((o, i) =>
  api('POST', `/workspaces/${slug}/change-requests/${o.data?.number}/queue`, { key: authors[i % 3], body: {} })));
check('and queued at once', queued.every((q) => q.status === 200), queued.map((q) => [q.status, q.data?.error?.message]));
let left = N;
for (let i = 0; i < 10 && left > 0; i++) {
  const states = await Promise.all(opened.map((o) => api('GET', `/workspaces/${slug}/change-requests/${o.data?.number}`)));
  left = states.filter((s) => s.data?.status !== 'merged').length;
  if (left) await new Promise((r) => setTimeout(r, 3000));
}
check('every one landed', left === 0, left);
const many = await api('GET', `/workspaces/${slug}/tree?path=many`);
check(`main has all ${N} files`, many.data?.entries?.length === N, many.data?.entries?.length);
const linear = await api('GET', `/workspaces/${slug}/log?limit=40`);
check('and main only moved forward', linear.status === 200 && linear.data?.commits?.length > N, linear.data?.commits?.length);

section('MCP');
const mcpConf = await tool('posterity_workspace', { action: 'conflicts', workspace: slug, into: 'main', from: 'carol/pick' }, carol);
check('posterity_workspace conflicts answers', !mcpConf.error && Array.isArray(mcpConf.json?.conflicts), mcpConf.text.slice(0, 300));
const mcpQueue = await tool('posterity_workspace', { action: 'queue', workspace: slug }, carol);
check('posterity_workspace queue answers', !mcpQueue.error && Array.isArray(mcpQueue.json?.queue), mcpQueue.text.slice(0, 300));

section('Heartbeat and reference');
const hb = await api('POST', '/heartbeat', { key: carol });
check('the heartbeat carries the code inbox', hb.status === 200 && Array.isArray(hb.data?.code?.claims) && Array.isArray(hb.data?.code?.touching_your_claims), hb.data?.code);
const index = await api('GET', '/');
check('the API is 0.12', /^0\.(1[2-9]|[2-9]\d)\./.test(index.data?.version ?? ''), index.data?.version);
const openapi = await api('GET', '/openapi.json');
check('OpenAPI documents the new routes', ['/workspaces/{workspace}/rebase', '/workspaces/{workspace}/queue', '/workspaces/{workspace}/claims', '/workspaces/{workspace}/owners']
  .every((p) => openapi.data?.paths?.[p]), Object.keys(openapi.data?.paths ?? {}).filter((p) => p.startsWith('/workspaces')).length);

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
