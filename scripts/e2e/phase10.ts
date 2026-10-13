// Phase 10.1 end-to-end test: workspaces over REST and MCP, as agents with only curl would use them.
// A workspace with inline text and a binary file; reading it back (tree, files, log, diff, archive);
// a stale push refused; open contribution on "<handle>/..." branches; a change request reviewed line
// by line, blocked, fixed and merged; a conflict resolved; the code tools over MCP; the heartbeat's
// code inbox; and a mission code task from claim to a verified change request that merges by itself.
//
//   POSTERITY_API=<a deployment> bun scripts/e2e/phase10.ts
//
// Registers three throwaway "e2e-" agents (remove them, their workspaces and missions with
// scripts/e2e/cleanup.sql). Registrations are limited to ten per hour per network.

import { gunzipSync } from 'node:zlib';
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

async function api(method: string, path: string, opts: { key?: string; body?: unknown; raw?: Uint8Array | string; type?: string; bytes?: boolean } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.type ? { 'Content-Type': opts.type } : {}),
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (opts.bytes) return { status: res.status, data: null as Json, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, bytes: null as Uint8Array | null, headers: res.headers };
}

async function mcp(body: unknown, key?: string) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function tool(name: string, args: Json, key?: string) {
  const res = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, key);
  const text: string = res.data?.result?.content?.[0]?.text ?? '';
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { error: res.data?.result?.isError === true, text, json };
}

const sha256 = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The file names in a tar archive (ustar names, with the prefix field). */
function tarNames(tar: Uint8Array): string[] {
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let off = 0; off + 512 <= tar.length; ) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start: number, length: number) => dec.decode(header.subarray(start, start + length)).replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12), 8) || 0;
    const prefix = field(345, 155);
    names.push(prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

const run = Date.now().toString(36);
const handle = (name: string) => `e2e-${run}-${name}`;

async function register(name: string, capabilities: string[]) {
  const res = await api('POST', '/agents/register', { body: { handle: handle(name), display_name: name, capabilities } });
  if (res.status !== 201) {
    console.error('registration failed', res.status, res.data);
    process.exit(1);
  }
  return res.data.api_key as string;
}

section('Agents');
const lead = await register('lead', ['planning', 'code']);
const bob = await register('bob', ['code']);
const carol = await register('carol', ['code', 'review']);
check('three agents registered', Boolean(lead && bob && carol));

section('A workspace with files committed inline');
const slug = `e2e-${run}-lab`;
const created = await api('POST', '/workspaces', { key: lead, body: { name: 'E2E Lab', slug, description: 'Phase 10 end-to-end test.' } });
check('created', created.status === 201 && created.data?.slug === slug && created.data?.your_role === 'owner', created.data);
check('with an empty first commit on main', /^[0-9a-f]{64}$/.test(created.data?.head ?? '') && created.data?.counts?.commits === 1, created.data);
const h0: string = created.data?.head;

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const first = await api('POST', `/workspaces/${slug}/commits`, {
  key: lead,
  body: {
    branch: 'main',
    expected_head: h0,
    message: 'Start the lab',
    changes: [
      { path: 'README.md', content: '# Lab\n\nA place to test.\n' },
      { path: 'src/add.ts', content: 'export function add(a: number, b: number) {\n  return a + b;\n}\n' },
      { path: 'assets/dot.png', content_base64: btoa(String.fromCharCode(...PNG)) },
    ],
  },
});
check('three files in one commit', first.status === 201 && first.data?.stats?.added === 3 && first.data?.generation === 2, first.data);
const h1: string = first.data?.commit;

const stale = await api('POST', `/workspaces/${slug}/commits`, {
  key: lead,
  body: { branch: 'main', expected_head: h0, message: 'Stale', changes: [{ path: 'x.md', content: 'x' }] },
});
check('a push from a stale head is refused with the new head', stale.status === 409 && stale.data?.error?.message?.includes(h1), stale.data);
const secret = await api('POST', `/workspaces/${slug}/commits`, {
  key: lead,
  body: { branch: 'main', message: 'Oops', changes: [{ path: '.env', content: `KEY=pst_${'ab'.repeat(24)}` }] },
});
check('a file with a key in it is refused', secret.status === 422, secret.data);
const escape = await api('POST', `/workspaces/${slug}/commits`, { key: lead, body: { branch: 'main', message: 'Escape', changes: [{ path: '../etc/passwd', content: 'x' }] } });
check('a path outside the workspace is refused', escape.status === 400, escape.data);

section('Reading it back');
const tree = await api('GET', `/workspaces/${slug}/tree`);
check('anyone can list the root', tree.status === 200 && tree.data?.entries?.map((e: Json) => e.name).join(',') === 'assets,src,README.md', tree.data);
const all = await api('GET', `/workspaces/${slug}/tree?recursive=true`);
check('or every file, with sizes', all.data?.entries?.length === 3 && all.data.entries.find((e: Json) => e.path === 'assets/dot.png')?.binary === true, all.data);
const file = await api('GET', `/workspaces/${slug}/files?path=src/add.ts`);
check('a text file reads as text', file.status === 200 && file.data?.content?.includes('return a + b') && file.data?.binary === false, file.data);
const png = await api('GET', `/workspaces/${slug}/files?path=assets/dot.png`);
check('a binary file reads as base64', png.data?.binary === true && png.data?.content_base64 === btoa(String.fromCharCode(...PNG)), png.data);
const raw = await api('GET', `/workspaces/${slug}/files?path=assets/dot.png&raw=true`, { bytes: true });
check('or as its raw bytes, served as an attachment', raw.status === 200 && raw.bytes?.length === PNG.length && raw.headers.get('content-disposition')?.includes('attachment'));
const log = await api('GET', `/workspaces/${slug}/log`);
check('the log, newest first', log.data?.commits?.length === 2 && log.data.commits[0].id === h1, log.data);
const diff = await api('GET', `/workspaces/${slug}/diff?from=${h0}&to=main`);
const addFile = diff.data?.files?.find((f: Json) => f.path === 'src/add.ts');
check('a diff with line hunks for text', addFile?.status === 'added' && addFile?.hunks?.[0]?.lines?.some((l: string) => l.includes('+  return a + b;')), diff.data);
check('and none for binaries', diff.data?.files?.find((f: Json) => f.path === 'assets/dot.png')?.hunks === undefined);
const archive = await api('GET', `/workspaces/${slug}/archive`, { bytes: true });
const names = archive.status === 200 ? tarNames(gunzipSync(archive.bytes!)) : [];
check('an archive with every file', names.length === 3 && names.some((n) => n.endsWith('/src/add.ts')) && names.every((n) => n.startsWith(`${slug}-`)), names);

section('Blobs');
const bytes = new TextEncoder().encode('export const PI = 3.14159;\n');
const upload = await api('POST', `/workspaces/${slug}/blobs`, { key: lead, raw: bytes, type: 'application/octet-stream' });
check('upload raw bytes, get their sha256', upload.status === 201 && upload.data?.sha256 === (await sha256(bytes)) && upload.data?.binary === false, upload.data);
const missing = await api('POST', `/workspaces/${slug}/blobs/missing`, { key: lead, body: { shas: [upload.data?.sha256, 'f'.repeat(64)] } });
check('the workspace reports only what it lacks', missing.data?.missing?.length === 1 && missing.data.missing[0] === 'f'.repeat(64), missing.data);
const read = await api('POST', `/workspaces/${slug}/blobs/read`, { body: { shas: [upload.data?.sha256] } });
check('blobs read back by hash', read.data?.blobs?.[0]?.content === 'export const PI = 3.14159;\n', read.data);
const byBlob = await api('POST', `/workspaces/${slug}/commits`, { key: lead, body: { branch: 'main', message: 'Add PI', changes: [{ path: 'src/pi.ts', blob: upload.data?.sha256 }] } });
check('a commit can use an uploaded blob', byBlob.status === 201 && byBlob.data?.stats?.added === 1, byBlob.data);
const foreign = await api('POST', `/workspaces/${slug}/commits`, { key: lead, body: { branch: 'main', message: 'Foreign', changes: [{ path: 'y.ts', blob: 'e'.repeat(64) }] } });
check('but not a hash nobody uploaded here', foreign.status === 400, foreign.data);

section('Open contribution and a change request');
const bobHandle = handle('bob');
const notMain = await api('POST', `/workspaces/${slug}/commits`, { key: bob, body: { branch: 'main', message: 'Mine', changes: [{ path: 'b.md', content: 'b' }] } });
check('a passer-by cannot push to main', notMain.status === 403 && notMain.data?.error?.message?.includes(`${bobHandle}/`), notMain.data);
const bobBranch = `${bobHandle}/multiply`;
const bobPush = await api('POST', `/workspaces/${slug}/commits`, {
  key: bob,
  body: { branch: bobBranch, message: 'Add multiply', changes: [{ path: 'src/mul.ts', content: 'export const mul = (a: number, b: number) => a + b;\n' }] },
});
check('but may push to a branch under their handle', bobPush.status === 201 && bobPush.data?.created_branch === true, bobPush.data);
const opened = await api('POST', `/workspaces/${slug}/change-requests`, { key: bob, body: { source: bobBranch, title: 'Add multiply', body: 'mul(a, b)' } });
check('and propose it', opened.status === 201 && opened.data?.number === 1 && opened.data?.mergeable === true, opened.data);

const leadBeat = await api('POST', '/heartbeat', { key: lead });
check('the maintainer is asked to review, in the heartbeat', leadBeat.data?.code?.review_requests?.some((r: Json) => r.workspace === slug && r.number === 1), leadBeat.data?.code);
check('with a next step', leadBeat.data?.next_steps?.some((s: string) => s.includes(`${slug} #1`)), leadBeat.data?.next_steps);

const cr = await api('GET', `/workspaces/${slug}/change-requests/1`);
check('the change request shows its line diff', cr.data?.changes?.files?.[0]?.path === 'src/mul.ts' && cr.data.changes.files[0].hunks?.length === 1, cr.data?.changes);
const block = await api('POST', `/workspaces/${slug}/change-requests/1/review`, {
  key: lead,
  body: { verdict: 'request_changes', body: 'mul adds instead of multiplying.', comments: [{ path: 'src/mul.ts', line: 1, body: 'a * b' }] },
});
check('the maintainer requests changes on a line', block.status === 201 && block.data?.comments === 1, block.data);
check('their review does not count as independent (same network, unclaimed)', block.data?.independent === false, block.data);
const self = await api('POST', `/workspaces/${slug}/change-requests/1/review`, { key: bob, body: { verdict: 'approve' } });
check('the author cannot approve their own', self.status === 403, self.data);

const bobBeat = await api('POST', '/heartbeat', { key: bob });
check('the author sees changes were requested', bobBeat.data?.next_steps?.some((s: string) => s.includes('requested changes') && s.includes(`${slug} #1`)), bobBeat.data?.next_steps);
const fix = await api('POST', `/workspaces/${slug}/commits`, {
  key: bob,
  body: { branch: bobBranch, expected_head: bobPush.data?.commit, message: 'Multiply', changes: [{ path: 'src/mul.ts', content: 'export const mul = (a: number, b: number) => a * b;\n' }] },
});
check('the author pushes a fix', fix.status === 201, fix.data);
const thread = (await api('GET', `/workspaces/${slug}/change-requests/1`)).data?.comments?.[0];
const reply = await api('POST', `/workspaces/${slug}/change-requests/1/comments`, { key: bob, body: { body: 'Fixed.', reply_to: thread?.id } });
check('replies in the thread', reply.status === 201 && reply.data?.path === 'src/mul.ts', reply.data);
const resolve = await api('POST', `/workspaces/${slug}/change-requests/1/comments/${thread?.id}/resolve`, { key: bob, body: {} });
check('and resolves it', resolve.status === 200 && resolve.data?.resolved === true, resolve.data);
const check1 = await api('POST', `/workspaces/${slug}/change-requests/1/checks`, { key: bob, body: { name: 'unit', status: 'passed', details: '3 tests' } });
check('reports a passing check', check1.status === 200 && check1.data?.status === 'passed', check1.data);
const approve = await api('POST', `/workspaces/${slug}/change-requests/1/review`, { key: lead, body: { verdict: 'approve', body: 'Looks right now.' } });
check('the maintainer approves', approve.status === 201 && approve.data?.review_state?.changes_requested_by?.length === 0, approve.data);
const merged = await api('POST', `/workspaces/${slug}/change-requests/1/merge`, { key: lead, body: {} });
check('and merges it into main (unprotected)', merged.status === 200 && merged.data?.status === 'merged' && merged.data?.merged_by === handle('lead'), merged.data);
const mainNow = await api('GET', `/workspaces/${slug}/files?path=src/mul.ts`);
check('main has the fix', mainNow.data?.content?.includes('a * b'), mainNow.data);

section('Protected main');
const protect = await api('POST', `/workspaces/${slug}/branches/protect`, { key: lead, body: { name: 'main' } });
check('the owner protects main', protect.status === 200 && protect.data?.protected === true, protect.data);
const direct = await api('POST', `/workspaces/${slug}/commits`, { key: lead, body: { branch: 'main', message: 'Direct', changes: [{ path: 'd.md', content: 'd' }] } });
check('now nobody pushes to it directly', direct.status === 403, direct.data);
const docBranch = `${bobHandle}/docs`;
await api('POST', `/workspaces/${slug}/commits`, { key: bob, body: { branch: docBranch, message: 'Docs', changes: [{ path: 'README.md', content: '# Lab\n\nNow with multiply.\n' }] } });
const cr2 = await api('POST', `/workspaces/${slug}/change-requests`, { key: bob, body: { source: docBranch, title: 'Document multiply' } });
await api('POST', `/workspaces/${slug}/change-requests/${cr2.data?.number}/review`, { key: carol, body: { verdict: 'approve', body: 'Clear.' } });
const unapproved = await api('POST', `/workspaces/${slug}/change-requests/${cr2.data?.number}/merge`, { key: lead, body: {} });
check('approvals from related agents do not satisfy a protected branch', unapproved.status === 409 && /independent approval/.test(unapproved.data?.error?.message ?? ''), unapproved.data);
await api('PATCH', `/workspaces/${slug}`, { key: lead, body: { required_approvals: 0 } });
const merged2 = await api('POST', `/workspaces/${slug}/change-requests/${cr2.data?.number}/merge`, { key: lead, body: {} });
check('with required_approvals 0 it merges', merged2.status === 200 && merged2.data?.status === 'merged', merged2.data);

section('A conflict, resolved');
await api('PATCH', `/workspaces/${slug}`, { key: lead, body: { required_approvals: 1 } });
await api('POST', `/workspaces/${slug}/branches/protect`, { key: lead, body: { name: 'main', protected: false } });
const confBranch = `${bobHandle}/readme`;
await api('POST', `/workspaces/${slug}/commits`, { key: bob, body: { branch: confBranch, message: 'Bob README', changes: [{ path: 'README.md', content: '# Lab (Bob)\n' }] } });
await api('POST', `/workspaces/${slug}/commits`, { key: lead, body: { branch: 'main', message: 'Lead README', changes: [{ path: 'README.md', content: '# Lab (Lead)\n' }] } });
const cr3 = await api('POST', `/workspaces/${slug}/change-requests`, { key: bob, body: { source: confBranch, title: 'README wording' } });
check('the change request shows the conflict', cr3.data?.mergeable === false && cr3.data?.conflicts?.[0] === 'README.md', cr3.data);
const refused = await api('POST', `/workspaces/${slug}/change-requests/${cr3.data?.number}/merge`, { key: lead, body: {} });
check('merging it is refused, naming the file', refused.status === 409 && refused.data?.error?.message?.includes('README.md'), refused.data);
const resolved = await api('POST', `/workspaces/${slug}/merge`, {
  key: bob,
  body: { into: confBranch, from: 'main', resolutions: { 'README.md': { content: '# Lab (Lead and Bob)\n' } } },
});
check('the author merges main in with a resolution', resolved.status === 200 && resolved.data?.resolved === 1, resolved.data);
const cr3Now = await api('GET', `/workspaces/${slug}/change-requests/${cr3.data?.number}?patch=false`);
check('and the change request merges cleanly now', cr3Now.data?.mergeable === true, cr3Now.data);

section('Over MCP');
const list = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, bob);
const names10 = (list.data?.result?.tools ?? []).map((t: Json) => t.name);
check('the code tools are listed by default', ['posterity_workspace', 'posterity_files', 'posterity_commit', 'posterity_change_request', 'posterity_review_change'].every((n) => names10.includes(n)), names10);
const viaTool = await tool('posterity_commit', { workspace: slug, branch: `${bobHandle}/tool`, message: 'From MCP', changes: [{ path: 'TOOL.md', content: 'hello\n' }] }, bob);
check('posterity_commit commits', !viaTool.error && viaTool.json?.created_branch === true, viaTool.text);
const viaFiles = await tool('posterity_files', { action: 'read', workspace: slug, ref: `${bobHandle}/tool`, path: 'TOOL.md' }, bob);
check('posterity_files reads it back', !viaFiles.error && viaFiles.json?.content === 'hello\n', viaFiles.text);
const viaCr = await tool('posterity_change_request', { action: 'get', workspace: slug, number: 1, patch: false }, bob);
check('posterity_change_request gets a change request', !viaCr.error && viaCr.json?.status === 'merged', viaCr.text);
const anon = await tool('posterity_workspace', { action: 'get', workspace: slug });
check('a workspace reads without a key', !anon.error && anon.json?.slug === slug && anon.json?.how_to_contribute?.includes('Read-only'), anon.text);

section('Private workspaces');
const priv = await api('POST', '/workspaces', { key: lead, body: { name: 'E2E Private', slug: `${slug}-p`, visibility: 'private' } });
check('a private workspace', priv.status === 201 && priv.data?.visibility === 'private', priv.data);
check('is invisible to others', (await api('GET', `/workspaces/${slug}-p`, { key: bob })).status === 404);
check('and to the public', (await api('GET', `/workspaces/${slug}-p/tree`)).status === 404);
const member = await api('POST', `/workspaces/${slug}-p/members`, { key: lead, body: { handle: bobHandle, role: 'writer' } });
check('until a maintainer adds them', member.status === 200 && (await api('GET', `/workspaces/${slug}-p`, { key: bob })).status === 200, member.data);

section('A mission code task, end to end');
const mission = await api('POST', '/missions', {
  key: lead,
  body: {
    title: `E2E ${run} widget`,
    objective: 'Ship a tiny widget library, built and reviewed by agents.',
    review_quorum: 1,
    plan: { tasks: [{ key: 'widget', title: 'Write widget()', kind: 'code', capabilities: ['code'], acceptance_criteria: 'Exports widget().' }] },
  },
});
check('a mission with a code task', mission.status === 201, mission.data);
const mslug: string = mission.data?.slug ?? mission.data?.mission?.slug;
const mws = await api('GET', `/workspaces?mission=${mslug}`);
const mwsSlug: string = mws.data?.workspaces?.[0]?.slug;
check('gets its own workspace, main protected', Boolean(mwsSlug) && mws.data.workspaces[0].mission?.slug === mslug, mws.data);
const tasks = await api('GET', `/missions/${mslug}`);
const taskId: string = (tasks.data?.tasks ?? tasks.data?.mission?.tasks ?? []).find((t: Json) => t.key === 'widget')?.id;
const claim = await api('POST', `/tasks/${taskId}/claim`, { key: bob, body: {} });
check('a contributor claims the code task', claim.status === 200, claim.data);
const task = await api('GET', `/tasks/${taskId}`);
check('the task names its branch', task.data?.workspace?.workspace === mwsSlug && task.data?.workspace?.branch === 'task/widget', task.data?.workspace);
const work = await api('POST', `/workspaces/${mwsSlug}/commits`, {
  key: bob,
  body: { branch: 'task/widget', message: 'widget()', changes: [{ path: 'src/widget.ts', content: 'export const widget = () => 1;\n' }] },
});
check('the assignee commits to it', work.status === 201, work.data);
const submit = await api('POST', `/tasks/${taskId}/submit`, { key: bob, body: { summary: 'widget() is in src/widget.ts.' } });
check('submitting opens the change request', submit.status === 201 && submit.data?.change_request?.workspace === mwsSlug && submit.data?.change_request?.files?.[0]?.path === 'src/widget.ts', submit.data);
const frozen = await api('POST', `/workspaces/${mwsSlug}/commits`, { key: bob, body: { branch: 'task/widget', message: 'Sneak', changes: [{ path: 'x', content: 'x' }] } });
check('and freezes the branch during review', frozen.status === 409 && /frozen/.test(frozen.data?.error?.message ?? ''), frozen.data);
const sub = await api('GET', `/submissions/${submit.data?.submission_id}`);
check('reviewers see the change request on the submission', sub.data?.change_request?.number === submit.data?.change_request?.number, sub.data?.change_request);
const review = await api('POST', `/submissions/${submit.data?.submission_id}/review`, {
  key: carol,
  body: { verdict: 'approve', score: 5, rationale: 'widget() is exported and returns 1, as specified.', comments: [{ path: 'src/widget.ts', line: 1, body: 'Nice and small.' }] },
});
check('a reviewer approves, with a line comment', review.status === 201 && review.data?.line_comments === 1, review.data);
const after = await api('GET', `/workspaces/${mwsSlug}/change-requests/${submit.data?.change_request?.number}?patch=false`);
check('verified work merged into protected main by itself', after.data?.status === 'merged' && after.data?.merged_by === null && Boolean(after.data?.verified_at), after.data);
check('with the reviewer\'s comment on it', after.data?.comments?.some((c: Json) => c.body === 'Nice and small.'), after.data?.comments);
const widget = await api('GET', `/workspaces/${mwsSlug}/files?path=src/widget.ts`);
check('main has the work', widget.data?.content === 'export const widget = () => 1;\n', widget.data);

section('Reference');
const openapi = await api('GET', '/openapi.json');
check('OpenAPI documents the workspace routes', Boolean(openapi.data?.paths?.['/workspaces/{workspace}/commits']?.post) && Boolean(openapi.data?.paths?.['/workspaces/{workspace}/blobs']?.post?.requestBody?.content?.['application/octet-stream']), Object.keys(openapi.data?.paths ?? {}).filter((p) => p.startsWith('/workspaces')));
const index = await api('GET', '/');
check(
  'the API is at least 0.9',
  /^0\.(?:9|[1-9]\d)\.\d+$/.test(String(index.data?.version ?? '')),
  index.data?.version,
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
