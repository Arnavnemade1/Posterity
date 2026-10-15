// GitHub sync tests: the App's keys and signatures, the tar reader, webhook mapping, and the sync
// itself against an in-memory GitHub (fake_github.ts) and workspace (memory_store.ts).
//
//   npx deno@2 test --no-lock --node-modules-dir=none --allow-env supabase/functions/tests/
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1';
import { appJwt, GitHub, parseRepo, privateKeyDer, signPayload, verifySignature } from '../api/lib/github.ts';
import { readTar } from '../api/lib/tar.ts';
import { checkStatus, statusState } from '../api/ops/github_app.ts';
import { type Clients, type Outcome, runJob } from '../api/ops/github_sync.ts';
import { FakeGitHub } from './fake_github.ts';
import { MemoryStore } from './memory_store.ts';

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test');

// ----------------------------------------------------------------------------- helpers

function clientsFor(gh: FakeGitHub): Clients {
  return { installation: () => new GitHub('ghs_test', { base: gh.base, fetch: gh.fetch }), fetch: gh.fetch };
}

/** Run queued jobs until the queue is empty; returns jobs that did not finish cleanly. */
async function drain(store: MemoryStore, gh: FakeGitHub, max = 60): Promise<Outcome[]> {
  const problems: Outcome[] = [];
  const clients = clientsFor(gh);
  for (let i = 0; i < max && store.queue.length; i++) {
    const q = store.queue.shift()!;
    const ctx = (await store.context())!;
    const out = await runJob({ id: i, kind: q.kind, branch: q.branch ?? null, change_request_id: q.cr ?? null, payload: q.payload ?? {}, attempts: 1 }, ctx, store, clients);
    if (out.outcome === 'continue') store.queue.unshift(q);
    else if (out.outcome && out.outcome !== 'done') problems.push(out);
  }
  assertEquals(store.queue.length, 0, 'the queue drains');
  return problems;
}

function emptyRepo(): FakeGitHub {
  return new FakeGitHub();
}

// ----------------------------------------------------------------------------- the App's credentials

Deno.test('a PKCS#1 key from GitHub becomes the same PKCS#8 key, and signs App JWTs', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  // The PKCS#1 key is the OCTET STRING inside PrivateKeyInfo (after version and algorithm).
  let i = 1;
  i += pkcs8[i] & 0x80 ? 1 + (pkcs8[i] & 0x7f) : 1; // outer length
  i += 3; // version
  i += 2 + pkcs8[i + 1]; // algorithm
  assertEquals(pkcs8[i], 0x04);
  i++;
  const lenBytes = pkcs8[i] & 0x80 ? pkcs8[i] & 0x7f : 0;
  i += 1 + lenBytes;
  const pkcs1 = pkcs8.subarray(i);
  const b64 = btoa(String.fromCharCode(...pkcs1)).replace(/(.{64})/g, '$1\n');
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${b64}\n-----END RSA PRIVATE KEY-----\n`;
  assertEquals(privateKeyDer(pem), pkcs8);
  assertEquals(privateKeyDer(pem.replace(/\n/g, '\\n')), pkcs8, 'newlines written as \\n');
  assertEquals(privateKeyDer(btoa(pem)), pkcs8, 'the whole file in base64');

  const jwt = await appJwt({ appId: '12345', privateKey: pem, webhookSecret: null, clientId: null, clientSecret: null, slug: null, api: '', web: '' });
  const [header, payload, signature] = jwt.split('.');
  const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
  assertEquals(claims.iss, '12345');
  assert(claims.exp - claims.iat <= 600, 'at most ten minutes');
  assert(claims.iat <= Date.now() / 1000, 'issued in the past, for clock drift');
  assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, decode(signature), new TextEncoder().encode(`${header}.${payload}`)));
});

Deno.test('webhook signatures', async () => {
  const body = new TextEncoder().encode('{"zen": "Keep it logically awesome."}');
  const header = await signPayload('s3cret', body);
  assert(await verifySignature('s3cret', body, header));
  assert(!(await verifySignature('other', body, header)));
  assert(!(await verifySignature('s3cret', body, null)));
  assert(!(await verifySignature('s3cret', new TextEncoder().encode('{}'), header)));
});

Deno.test('repository names', () => {
  assertEquals(parseRepo('octocat/Hello-World'), 'octocat/Hello-World');
  assertEquals(parseRepo('https://github.com/octocat/Hello-World.git'), 'octocat/Hello-World');
  assertEquals(parseRepo('github.com/octocat/Hello-World/tree/main'), 'octocat/Hello-World');
  assertEquals(parseRepo('git@github.com:octocat/Hello-World.git'), 'octocat/Hello-World');
  assertEquals(parseRepo('not a repo'), null);
  assertEquals(parseRepo('octocat'), null);
});

Deno.test('check runs and statuses map to check states', () => {
  assertEquals(checkStatus('queued', null), 'queued');
  assertEquals(checkStatus('in_progress', null), 'running');
  assertEquals(checkStatus('completed', 'success'), 'passed');
  assertEquals(checkStatus('completed', 'failure'), 'failed');
  assertEquals(checkStatus('completed', 'timed_out'), 'failed');
  assertEquals(checkStatus('completed', 'skipped'), 'neutral');
  assertEquals(statusState('pending'), 'running');
  assertEquals(statusState('success'), 'passed');
  assertEquals(statusState('error'), 'failed');
});

// ----------------------------------------------------------------------------- tar

function tarBlock(name: string, size: number, type: string, mode = 0o644): Uint8Array {
  const block = new Uint8Array(512);
  const put = (text: string, offset: number) => block.set(new TextEncoder().encode(text), offset);
  put(name, 0);
  put(mode.toString(8).padStart(7, '0') + '\0', 100);
  put(size.toString(8).padStart(11, '0') + '\0', 124);
  put('        ', 148);
  put(type, 156);
  put('ustar\0', 257);
  put('00', 263);
  const sum = block.reduce((a, b) => a + b, 0);
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return block;
}

function tarOf(entries: { name: string; data?: string; type?: string; pax?: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const data = new TextEncoder().encode(e.pax ?? e.data ?? '');
    parts.push(tarBlock(e.name, data.length, e.type ?? '0'));
    parts.push(data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paxRecord(key: string, value: string): string {
  const rest = ` ${key}=${value}\n`;
  let length = rest.length + String(rest.length).length;
  if (String(length).length > String(rest.length).length) length++;
  return `${length}${rest}`;
}

function streamOf(bytes: Uint8Array, chunk = 97): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.subarray(i, i + chunk));
      i += chunk;
    },
  });
}

Deno.test('tar: GitHub-style archives, pax paths, skipped big files', async () => {
  const sha = 'a'.repeat(40);
  const long = `repo-abc/${'deep/'.repeat(25)}file.txt`;
  const archive = tarOf([
    { name: 'pax_global_header', type: 'g', pax: paxRecord('comment', sha) },
    { name: 'repo-abc/', type: '5' },
    { name: 'repo-abc/README.md', data: '# Hi\n' },
    { name: 'PaxHeader', type: 'x', pax: paxRecord('path', long) },
    { name: 'truncated', data: 'deep' },
    { name: 'repo-abc/big.bin', data: 'x'.repeat(2000) },
    { name: 'repo-abc/link', type: '2' },
  ]);
  const entries = [];
  for await (const e of readTar(streamOf(archive), { maxFileBytes: 1000, maxStreamBytes: 1_000_000 })) entries.push(e);
  assertEquals(entries[0].type, 'global');
  assertEquals(entries[0].pax.comment, sha);
  assertEquals(entries.find((e) => e.path === 'repo-abc/README.md')?.data && new TextDecoder().decode(entries.find((e) => e.path === 'repo-abc/README.md')!.data!), '# Hi\n');
  assertEquals(new TextDecoder().decode(entries.find((e) => e.path === long)!.data!), 'deep');
  assertEquals(entries.find((e) => e.path === 'repo-abc/big.bin')!.data, null, 'over the limit: skipped');
  assertEquals(entries.find((e) => e.path === 'repo-abc/link')!.type, 'symlink');
});

Deno.test('tar: the stream limit stops a huge archive', async () => {
  const archive = tarOf([{ name: 'a.txt', data: 'x'.repeat(5000) }]);
  let error: unknown;
  try {
    for await (const _ of readTar(streamOf(archive), { maxFileBytes: 10_000, maxStreamBytes: 2000 })) { /* read */ }
  } catch (err) {
    error = err;
  }
  assert(error instanceof Error && /larger than/.test(error.message));
});

// ----------------------------------------------------------------------------- mirror links

Deno.test('mirror: an empty repository gets a placeholder, then every branch as posterity/*', async () => {
  const gh = emptyRepo();
  const store = MemoryStore.create();
  await store.commit('main', { 'README.md': '# Site\n', 'src/app.js': 'console.log(1)\n' }, 'First');
  await store.commit('alice/feature', { 'src/app.js': 'console.log(2)\n', 'img/logo.png': '\u0000PNG' }, 'Feature');
  await store.link('', '', 'acme/site', 'mirror', false);
  assertEquals(await drain(store, gh), []);

  assertEquals(store.remote!.status, 'active');
  assert(store.remote!.bootstrap_sha, 'the placeholder commit is remembered');
  assertEquals(Object.keys(gh.files('main')), ['README.md'], 'the real default branch only has the placeholder');
  assert(gh.files('main')['README.md'].includes('posterity.test/build/site'));
  assertEquals(gh.files('posterity/main'), { 'README.md': '# Site\n', 'src/app.js': 'console.log(1)\n' });
  assertEquals(gh.files('posterity/alice/feature')['src/app.js'], 'console.log(2)\n');
  assertEquals(gh.files('posterity/alice/feature')['img/logo.png'], '\u0000PNG', 'binaries go up as blobs');

  // The pushed history: First -> Feature, with Posterity's trailers.
  const feature = gh.commits.get(gh.refs.get('posterity/alice/feature')!)!;
  assertEquals(feature.parents, [gh.refs.get('posterity/main')!]);
  assert(feature.message.startsWith('Feature\n\nPosterity-Commit: '));
  assertEquals(feature.author.name, 'alice');
  assertEquals(gh.commits.get(gh.refs.get('posterity/main')!)!.parents, [], 'the empty first commit is not pushed');

  // Later commits push only what changed, on top of what is there.
  const before = gh.log.length;
  await store.commit('main', { 'src/app.js': 'console.log(3)\n' }, 'Third');
  assertEquals(await drain(store, gh), []);
  assertEquals(gh.files('posterity/main')['src/app.js'], 'console.log(3)\n');
  assertEquals(gh.files('posterity/main')['README.md'], '# Site\n');
  assertEquals(gh.log.slice(before).filter((l) => l.startsWith('POST') && l.endsWith('/git/commits')).length, 1);

  // Deleting a branch here deletes its mirror there.
  store.branches.delete('alice/feature');
  store.queue.push({ kind: 'delete_ref', branch: 'alice/feature' });
  assertEquals(await drain(store, gh), []);
  assert(!gh.refs.has('posterity/alice/feature'));
});

Deno.test('mirror: a failed push resumes without duplicating commits', async () => {
  const gh = emptyRepo();
  const store = MemoryStore.create();
  for (let i = 0; i < 3; i++) await store.commit('main', { [`f${i}.txt`]: `${i}` }, `Commit ${i}`);
  await store.link('', '', 'acme/site', 'mirror', false);
  let commitCalls = 0;
  gh.failNext = (method, path) => method === 'POST' && path.endsWith('/git/commits') && ++commitCalls === 2;
  const problems = await drain(store, gh);
  assertEquals(problems.length, 1, 'the failed push retries');
  assertEquals(problems[0].outcome, 'retry');
  store.queue.push({ kind: 'push', branch: 'main' });
  assertEquals(await drain(store, gh), []);
  const head = gh.refs.get('posterity/main')!;
  assertEquals(gh.ancestors(head).size, 3, 'three commits, none twice');
  assertEquals(Object.keys(gh.files('posterity/main')).sort(), ['f0.txt', 'f1.txt', 'f2.txt']);
});

Deno.test('mirror: change requests open pull requests, and closing one closes it', async () => {
  const gh = emptyRepo();
  const store = MemoryStore.create();
  await store.commit('main', { 'a.txt': 'a' }, 'Start');
  await store.link('', '', 'acme/site', 'mirror', true);
  assertEquals(await drain(store, gh), []);
  await store.commit('alice/fix', { 'a.txt': 'b' }, 'Fix');
  const cr = store.openCr('alice/fix', 'main', 'Fix a');
  assertEquals(await drain(store, gh), []);
  const pr = store.crs.get(cr)!.pull_request!;
  assertExists(pr);
  // main on GitHub is only the placeholder (unrelated history), so the PR targets the mirror of main.
  assertEquals(pr.base_ref, 'posterity/main');
  assertEquals(gh.pulls[0].head, 'posterity/alice/fix');
  assert(gh.pulls[0].body.includes('posterity.test/build/site/changes/1'));

  store.crs.get(cr)!.status = 'closed';
  store.queue.push({ kind: 'pr', cr });
  assertEquals(await drain(store, gh), []);
  assertEquals(gh.pulls[0].state, 'closed');
});

// ----------------------------------------------------------------------------- two-way links

async function existingRepo(): Promise<FakeGitHub> {
  const gh = new FakeGitHub();
  await gh.humanCommit('main', { 'README.md': '# Site\n', 'run.sh': { content: '#!/bin/sh\necho hi\n', mode: '100755' } }, 'Initial commit');
  await gh.humanCommit('main', { 'vendor/lib': { content: '', mode: '160000' } }, 'Add a submodule');
  return gh;
}

Deno.test('two-way: an empty workspace takes the repository in, then pushes forward', async () => {
  const gh = await existingRepo();
  // The submodule entry points at a commit, not a blob; the fake stores an empty blob for it.
  const store = MemoryStore.create();
  await store.link('', '', 'acme/site', 'two_way', false);
  assertEquals(await drain(store, gh), []);
  assertEquals(store.remote!.status, 'active');
  assertEquals(store.files('main'), { 'README.md': '# Site\n', 'run.sh': '#!/bin/sh\necho hi\n' }, 'the submodule is skipped');
  const imported = store.commits.get(store.branches.get('main')!)!;
  assertEquals(imported.origin?.provider, 'github');
  assert((imported.origin?.skipped as string[]).some((s) => s.includes('submodule')));

  // An agent changes the script: the push keeps it executable and keeps the submodule.
  await store.commit('main', { 'run.sh': '#!/bin/sh\necho hello\n', 'notes.md': 'notes' }, 'Say hello');
  assertEquals(await drain(store, gh), []);
  assertEquals(gh.files('main')['run.sh'], '#!/bin/sh\necho hello\n');
  assertEquals(gh.modes('main')['run.sh'], '100755');
  assertEquals(gh.modes('main')['vendor/lib'], '160000');
  assertEquals(gh.files('main')['notes.md'], 'notes');
  assert(!gh.refs.has('posterity/main'), 'the default branch syncs itself, not a mirror');
});

Deno.test('two-way: a push on GitHub comes back as a fast-forward', async () => {
  const gh = await existingRepo();
  const store = MemoryStore.create();
  await store.link('', '', 'acme/site', 'two_way', false);
  assertEquals(await drain(store, gh), []);
  const head = store.branches.get('main')!;
  await gh.humanCommit('main', { 'CHANGELOG.md': 'v1\n' }, 'Changelog');
  await gh.humanCommit('main', { 'CHANGELOG.md': 'v1\nv2\n' }, 'Changelog v2');
  store.queue.push({ kind: 'pull' });
  assertEquals(await drain(store, gh), []);
  assertEquals(store.files('main')['CHANGELOG.md'], 'v1\nv2\n');
  const synced = store.commits.get(store.branches.get('main')!)!;
  assertEquals(synced.parents, [head]);
  assert(synced.message.startsWith('Sync 2 commits from GitHub'));
  assertEquals(await store.commitBySha(501, gh.refs.get('main')!), store.branches.get('main'));
  // Its own push back is a no-op: GitHub already has it.
  const before = gh.log.filter((l) => l.startsWith('POST')).length;
  assertEquals(await drain(store, gh), []);
  assertEquals(gh.log.filter((l) => l.startsWith('POST')).length, before);
});

Deno.test('two-way: when both sides moved, GitHub\'s side waits on github/main until merged', async () => {
  const gh = await existingRepo();
  const store = MemoryStore.create();
  await store.link('', '', 'acme/site', 'two_way', true);
  assertEquals(await drain(store, gh), []);

  await gh.humanCommit('main', { 'README.md': '# Site, by a person\n' }, 'Edit README on GitHub');
  await store.commit('main', { 'app.js': 'agent work\n' }, 'Agent work');
  assertEquals(await drain(store, gh), []);

  assertEquals(store.remote!.status, 'diverged');
  assert(store.branches.has('github/main'));
  assertEquals(store.files('github/main')['README.md'], '# Site, by a person\n');
  assert(!('app.js' in store.files('github/main')));
  const sync = [...store.crs.values()].find((c) => c.source === 'github/main')!;
  assertExists(sync);
  assertEquals(sync.pull_request, null, 'no pull request for the sync itself');
  assertEquals(gh.files('main')['README.md'], '# Site, by a person\n', 'GitHub was not overwritten');

  // The agents merge GitHub's side in; the merge then fast-forwards GitHub.
  await store.merge('main', 'github/main', 'Merge GitHub');
  assertEquals(await drain(store, gh), []);
  assertEquals(store.remote!.status, 'active');
  assertEquals(gh.files('main')['README.md'], '# Site, by a person\n');
  assertEquals(gh.files('main')['app.js'], 'agent work\n');
  const merge = gh.commits.get(gh.refs.get('main')!)!;
  assertEquals(merge.parents.length, 2);
  const human = [...gh.commits.entries()].find(([, c]) => c.message === 'Edit README on GitHub')![0];
  assert(merge.parents.includes(human), 'the person\'s commit is a parent of the merge, so nothing of theirs is lost');
});

Deno.test('two-way: a workspace and a repository with unrelated histories are refused', async () => {
  const gh = await existingRepo();
  const store = MemoryStore.create();
  await store.commit('main', { 'mine.txt': 'mine' }, 'Mine');
  await store.link('', '', 'acme/site', 'two_way', false);
  const problems = await drain(store, gh);
  assertEquals(problems.length, 1);
  assertEquals(store.remote!.status, 'error');
  assert(/unrelated/.test(problems[0].error!));
  assertEquals(gh.files('main')['README.md'], '# Site\n', 'nothing was pushed');
});

Deno.test('two-way: pull requests target the real default branch', async () => {
  const gh = await existingRepo();
  const store = MemoryStore.create();
  await store.link('', '', 'acme/site', 'two_way', true);
  assertEquals(await drain(store, gh), []);
  await store.commit('alice/docs', { 'docs.md': 'docs' }, 'Docs');
  const cr = store.openCr('alice/docs');
  assertEquals(await drain(store, gh), []);
  assertEquals(store.crs.get(cr)!.pull_request!.base_ref, 'main');
  assertEquals(gh.pulls[0].head, 'posterity/alice/docs');
  // Merged on Posterity: main moves, GitHub fast-forwards, and the PR's commits are in main.
  await store.merge('main', 'alice/docs');
  assertEquals(await drain(store, gh), []);
  assert(gh.isAncestor(gh.refs.get('posterity/alice/docs')!, gh.refs.get('main')!));
});

// ----------------------------------------------------------------------------- imports

Deno.test('import: a public repository from its tarball', async () => {
  const sha = 'b'.repeat(40);
  const archive = tarOf([
    { name: 'pax_global_header', type: 'g', pax: paxRecord('comment', sha) },
    { name: 'Hello-World-bbbbbbb/', type: '5' },
    { name: 'Hello-World-bbbbbbb/README', data: 'Hello World!\n' },
    { name: 'Hello-World-bbbbbbb/src/main.c', data: 'int main() { return 0; }\n' },
    { name: 'Hello-World-bbbbbbb/.git/config', data: 'nope' },
  ]);
  const gz = new Uint8Array(await new Response(new Blob([new Uint8Array(archive)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const requested: string[] = [];
  const fetchStub = (input: string | URL | Request) => {
    requested.push(String(input));
    return Promise.resolve(new Response(gz, { status: 200 }));
  };
  const store = MemoryStore.create();
  const clients: Clients = { installation: () => { throw new Error('no installation for public repos'); }, fetch: fetchStub as typeof fetch };
  const ctx = (await store.context())!;
  const out = await runJob({ id: 1, kind: 'import', branch: null, change_request_id: null, attempts: 1, payload: { source: { repo: 'octocat/Hello-World' } } }, ctx, store, clients);
  assertEquals(out.outcome ?? 'done', 'done', JSON.stringify(out));
  assertEquals(requested, ['https://github.com/octocat/Hello-World/archive/HEAD.tar.gz']);
  assertEquals(store.files('main'), { README: 'Hello World!\n', 'src/main.c': 'int main() { return 0; }\n' });
  assertEquals(store.importState.status, 'done');
  assertEquals(store.importState.sha, sha);
  assertEquals(store.importState.files, 2);
  assert((store.importState.skipped as string[]).some((s) => s.startsWith('.git/config')));
});

Deno.test('import: a missing repository fails with a clear message', async () => {
  const store = MemoryStore.create();
  const clients: Clients = { installation: () => { throw new Error('unused'); }, fetch: (() => Promise.resolve(new Response('Not Found', { status: 404 }))) as typeof fetch };
  const ctx = (await store.context())!;
  const out = await runJob({ id: 1, kind: 'import', branch: null, change_request_id: null, attempts: 1, payload: { source: { repo: 'octocat/nope' } } }, ctx, store, clients);
  assertEquals(out.outcome, 'failed');
  assertEquals(store.importState.status, 'failed');
  assert(/was not found/.test(String(store.importState.error)));
});
