import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain JavaScript, no declarations
import { ignoreRule, lineDiff, main } from '../posterity.mjs';

const API = 'https://api.test/functions/v1/api';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * A small in-memory workspace server: blobs by sha256, commits as {files, exec}, branches as heads, the
 * same compare-and-swap on expected_head as the real engine, trees in pages, diffs between commits and
 * a whole-file merge that conflicts when both sides changed a file.
 */
function fakeServer({ pageSize = 1000 } = {}) {
  const blobs = new Map<string, Uint8Array>();
  const commits = new Map<string, Record<string, string>>();
  const execs = new Map<string, Set<string>>();
  const parents = new Map<string, string[]>();
  const branches = new Map<string, string>();
  const requests: { method: string; path: string; body: any }[] = [];
  let n = 0;
  const commit = (files: Record<string, string>, exec = new Set<string>(), from: string[] = []) => {
    const id = sha(`commit-${n++}`);
    commits.set(id, files);
    execs.set(id, exec);
    parents.set(id, from);
    return id;
  };
  branches.set('main', commit({}));
  const put = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    blobs.set(sha(bytes), bytes);
    return sha(bytes);
  };
  const resolveRef = (ref: string | null) => (ref && commits.has(ref) ? ref : branches.get(ref ?? 'main'));
  const ancestors = (id: string): Set<string> => {
    const seen = new Set<string>();
    const todo = [id];
    while (todo.length) {
      const c = todo.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      todo.push(...(parents.get(c) ?? []));
    }
    return seen;
  };
  const base = (a: string, b: string) => {
    const of = ancestors(b);
    let best: string | undefined;
    for (const c of ancestors(a)) if (of.has(c) && (!best || [...ancestors(c)].length > [...ancestors(best)].length)) best = c;
    return best!;
  };
  const text = (s: string) => new TextDecoder().decode(blobs.get(s));
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/functions/v1/api', '');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    requests.push({ method, path, body });
    let m: RegExpMatchArray | null;
    if (method === 'GET' && (m = path.match(/^\/workspaces\/([^/]+)$/))) {
      return json({ slug: m[1], default_branch: 'main', your_role: 'writer', branches: [...branches].map(([name, head]) => ({ name, head })) });
    }
    if (method === 'GET' && path.endsWith('/tree')) {
      const head = resolveRef(u.searchParams.get('ref'));
      if (!head) return json({ error: { code: 'not_found', message: 'No branch' } }, 404);
      const files = commits.get(head)!;
      const after = u.searchParams.get('after');
      const all = Object.keys(files).sort().filter((p) => !after || p > after);
      const page = all.slice(0, pageSize);
      return json({
        commit: head,
        next: all.length > pageSize ? page[page.length - 1] : null,
        entries: page.map((p) => ({ path: p, sha256: files[p], size: blobs.get(files[p])!.length, binary: false, ...(execs.get(head)!.has(p) ? { executable: true } : {}) })),
      });
    }
    if (method === 'GET' && path.endsWith('/diff')) {
      const from = resolveRef(u.searchParams.get('from'))!;
      const to = resolveRef(u.searchParams.get('to'))!;
      const a = commits.get(from)!;
      const b = commits.get(to)!;
      const files = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
        .filter((p) => a[p] !== b[p] || execs.get(from)!.has(p) !== execs.get(to)!.has(p))
        .map((p) => ({ path: p, status: !a[p] ? 'added' : !b[p] ? 'deleted' : 'modified', old_sha: a[p] ?? null, new_sha: b[p] ?? null, ...(execs.get(to)!.has(p) ? { executable: true } : {}) }));
      return json({ from, to, files, total: files.length, truncated: false });
    }
    if (method === 'POST' && path.endsWith('/blobs/read')) {
      return json({ blobs: body.shas.filter((s: string) => blobs.has(s)).map((s: string) => ({ sha256: s, binary: false, content: text(s) })) });
    }
    if (method === 'POST' && path.endsWith('/blobs/missing')) return json({ missing: body.shas.filter((s: string) => !blobs.has(s)) });
    if (method === 'POST' && path.endsWith('/blobs')) {
      const bytes = new Uint8Array(body as Uint8Array);
      blobs.set(sha(bytes), bytes);
      return json({ sha256: sha(bytes) }, 201);
    }
    if (method === 'POST' && path.endsWith('/branches')) {
      const head = resolveRef(body.from)!;
      branches.set(body.name, head);
      return json({ name: body.name, head }, 201);
    }
    if (method === 'POST' && path.endsWith('/commits')) {
      const head = branches.get(body.branch);
      if (body.expected_head && head !== body.expected_head) {
        return json({ error: { code: 'conflict', message: `head_moved: "${body.branch}" is at ${head} now.` } }, 409);
      }
      const files = { ...commits.get(head!) };
      const exec = new Set(execs.get(head!));
      for (const c of body.changes) {
        if (c.delete) {
          delete files[c.path];
          exec.delete(c.path);
        } else {
          files[c.path] = c.blob;
          if (c.executable === true) exec.add(c.path);
          if (c.executable === false) exec.delete(c.path);
        }
      }
      const id = commit(files, exec, [head!]);
      branches.set(body.branch, id);
      return json({ commit: id, branch: body.branch, workspace: 'lab' }, 201);
    }
    // Whole-file three-way merge: a file both sides changed differently conflicts unless resolved.
    const conflicted = (into: string, from: string) => {
      const b = commits.get(base(into, from))!;
      const o = commits.get(into)!;
      const t = commits.get(from)!;
      const merged = { ...o };
      const clash: string[] = [];
      for (const p of new Set([...Object.keys(b), ...Object.keys(t)])) {
        if (t[p] === b[p]) continue;
        if (o[p] === b[p]) {
          if (t[p]) merged[p] = t[p];
          else delete merged[p];
        } else if (o[p] !== t[p]) clash.push(p);
      }
      return { merged, clash, o, t };
    };
    if (method === 'GET' && path.endsWith('/conflicts')) {
      const { clash, o, t } = conflicted(branches.get(u.searchParams.get('into')!)!, resolveRef(u.searchParams.get('from'))!);
      return json({ conflicts: clash.map((p) => ({ path: p, kind: 'content', hunks: 1, marked_text: `<<<<<<< ours\n${text(o[p])}=======\n${text(t[p])}>>>>>>> theirs\n` })), pending: 0 });
    }
    if (method === 'POST' && path.endsWith('/merge')) {
      const into = branches.get(body.into)!;
      const from = resolveRef(body.from)!;
      const { merged, clash } = conflicted(into, from);
      const open = clash.filter((p) => !(body.resolutions && p in body.resolutions));
      if (open.length) {
        return json({ error: { code: 'conflict', message: `conflict: ${open.length} file(s) changed on both sides: ${open.join(', ')}. Resolve each.` } }, 409);
      }
      for (const [p, r] of Object.entries((body.resolutions ?? {}) as Record<string, { content: string } | null>)) {
        if (r === null) delete merged[p];
        else merged[p] = put(r.content);
      }
      const id = commit(merged, new Set(execs.get(into)), [into, from]);
      branches.set(body.into, id);
      return json({ status: 'merged', commit: id, branch: body.into, fast_forward: false, resolved: clash.length });
    }
    return json({ error: { code: 'not_found', message: `${method} ${path}` } }, 404);
  };
  /** Another agent pushes straight to a branch. */
  const push = (branch: string, files: Record<string, string | null>, exec?: string[]) => {
    const head = branches.get(branch) ?? branches.get('main')!;
    const next = { ...commits.get(head) };
    for (const [p, t] of Object.entries(files)) {
      if (t === null) delete next[p];
      else next[p] = put(t);
    }
    branches.set(branch, commit(next, new Set(exec ?? execs.get(head)), [head]));
  };
  return { fetch, push, branches, commits, blobs, execs, requests, text };
}

let home: string;
let work: string;
let out: string[];
let err: string[];

const run = (argv: string[], fetch: unknown, cwd = work) =>
  main(argv, {
    env: { POSTERITY_CONFIG_DIR: home, POSTERITY_API: API, POSTERITY_KEY: `pst_${'a'.repeat(48)}` },
    fetch,
    cwd,
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'posterity-home-'));
  work = await mkdtemp(join(tmpdir(), 'posterity-work-'));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe('ignore rules', () => {
  test('gitignore-like patterns', () => {
    const dist = ignoreRule('dist/');
    expect(dist('dist', true)).toBe(true);
    expect(dist('pkg/dist', true)).toBe(true);
    expect(dist('dist', false)).toBe(false);
    const logs = ignoreRule('*.log');
    expect(logs('a.log', false)).toBe(true);
    expect(logs('deep/b.log', false)).toBe(true);
    expect(logs('a.logs', false)).toBe(false);
    const anchored = ignoreRule('/build');
    expect(anchored('build', true)).toBe(true);
    expect(anchored('src/build', true)).toBe(false);
    const globstar = ignoreRule('docs/**/*.tmp');
    expect(globstar('docs/a/b/c.tmp', false)).toBe(true);
    expect(ignoreRule('# a comment')).toBeNull();
    expect(ignoreRule('   ')).toBeNull();
  });
});

describe('line diff', () => {
  test('marks added and removed lines with context', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual(['  a', '- b', '+ B', '  c']);
    expect(lineDiff('', 'new')).toEqual(['+ new']);
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const changed = [...long];
    changed[10] = 'changed';
    const diff = lineDiff(long.join('\n'), changed.join('\n'));
    expect(diff).toContain('- line 10');
    expect(diff).toContain('+ changed');
    expect(diff).toContain('  ...');
    expect(diff).not.toContain('  line 0');
  });
});

describe('ws', () => {
  test('clone, change, push, and a pull that keeps both sides of a conflict', async () => {
    const server = fakeServer();
    server.push('main', { 'README.md': '# Lab\n', 'src/a.ts': 'export const a = 1;\n' });

    expect(await run(['ws', 'clone', 'lab'], server.fetch)).toBe(0);
    const root = join(work, 'lab');
    expect(await readFile(join(root, 'src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(JSON.parse(await readFile(join(root, '.posterity/workspace.json'), 'utf8')).branch).toBe('main');

    // Change one file, add one, ignore one.
    await writeFile(join(root, 'src/a.ts'), 'export const a = 2;\n');
    await writeFile(join(root, 'notes.txt'), 'hello\n');
    await writeFile(join(root, '.posterityignore'), '*.log\n');
    await writeFile(join(root, 'debug.log'), 'noise\n');
    out = [];
    expect(await run(['ws', 'status'], server.fetch, root)).toBe(0);
    expect(out.join('\n')).toContain('M src/a.ts');
    expect(out.join('\n')).toContain('A notes.txt');
    expect(out.join('\n')).not.toContain('debug.log');

    out = [];
    expect(await run(['ws', 'diff'], server.fetch, root)).toBe(0);
    expect(out.join('\n')).toContain('- export const a = 1;');
    expect(out.join('\n')).toContain('+ export const a = 2;');

    expect(await run(['ws', 'push', '-m', 'Bump a'], server.fetch, root)).toBe(0);
    const head = server.commits.get(server.branches.get('main')!)!;
    expect(new TextDecoder().decode(server.blobs.get(head['src/a.ts']))).toBe('export const a = 2;\n');
    expect(head['.posterityignore']).toBeDefined();
    expect(head['debug.log']).toBeUndefined();

    // Someone else pushes: our next push is refused until we pull.
    server.push('main', { 'src/a.ts': 'export const a = 3;\n', 'src/b.ts': 'export const b = 1;\n' });
    await writeFile(join(root, 'src/a.ts'), 'export const a = 4;\n');
    err = [];
    expect(await run(['ws', 'push', '-m', 'Mine'], server.fetch, root)).toBe(1);
    expect(err.join('\n')).toContain('Someone pushed');

    out = [];
    expect(await run(['ws', 'pull'], server.fetch, root)).toBe(0);
    expect(out.join('\n')).toContain('C src/a.ts');
    expect(await readFile(join(root, 'src/a.ts'), 'utf8')).toBe('export const a = 4;\n');
    expect(await readFile(join(root, 'src/a.ts.theirs'), 'utf8')).toBe('export const a = 3;\n');
    expect(await readFile(join(root, 'src/b.ts'), 'utf8')).toBe('export const b = 1;\n');

    // Resolve by hand and push on top of their commit.
    await writeFile(join(root, 'src/a.ts'), 'export const a = 7;\n');
    await rm(join(root, 'src/a.ts.theirs'));
    expect(await run(['ws', 'push', '-m', 'Merge a'], server.fetch, root)).toBe(0);
    const final = server.commits.get(server.branches.get('main')!)!;
    expect(new TextDecoder().decode(server.blobs.get(final['src/a.ts']))).toBe('export const a = 7;\n');
    expect(final['src/b.ts']).toBeDefined();
    expect(final['src/a.ts.theirs']).toBeUndefined();
  });

  test('pull removes files deleted remotely, push deletes files removed locally', async () => {
    const server = fakeServer();
    server.push('main', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
    expect(await run(['ws', 'clone', 'lab', 'here'], server.fetch)).toBe(0);
    const root = join(work, 'here');
    server.push('main', { 'b.txt': null });
    expect(await run(['ws', 'pull'], server.fetch, root)).toBe(0);
    expect(existsSync(join(root, 'b.txt'))).toBe(false);
    await rm(join(root, 'a.txt'));
    expect(await run(['ws', 'push', '-m', 'Drop a'], server.fetch, root)).toBe(0);
    expect(server.commits.get(server.branches.get('main')!)!).toEqual({});
  });

  test('refuses a non-empty clone target and works only inside a clone', async () => {
    const server = fakeServer();
    await mkdir(join(work, 'lab'));
    await writeFile(join(work, 'lab', 'x'), 'x');
    expect(await run(['ws', 'clone', 'lab'], server.fetch)).toBe(1);
    expect(err.join('\n')).toContain('not empty');
    err = [];
    expect(await run(['ws', 'status'], server.fetch)).toBe(1);
    expect(err.join('\n')).toContain('Not inside a workspace clone');
  });
  test('a clone comes in pages, keeps executable bits and pulls through diffs', async () => {
    const server = fakeServer({ pageSize: 2 });
    server.push('main', { 'a.txt': 'a\n', 'b.txt': 'b\n', 'bin/run.sh': '#!/bin/sh\n', 'c.txt': 'c\n', 'd.txt': 'd\n' }, ['bin/run.sh']);
    expect(await run(['ws', 'clone', 'lab'], server.fetch)).toBe(0);
    const root = join(work, 'lab');
    for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'bin/run.sh']) expect(existsSync(join(root, f))).toBe(true);
    expect(server.requests.filter((r) => r.path.endsWith('/tree')).length).toBe(3);
    if (process.platform !== 'win32') {
      expect((await stat(join(root, 'bin/run.sh'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(root, 'a.txt'))).mode & 0o111).toBe(0);
      // Making a file executable is a change that pushes.
      await chmod(join(root, 'a.txt'), 0o755);
      out = [];
      expect(await run(['ws', 'status'], server.fetch, root)).toBe(0);
      expect(out.join('\n')).toContain('M a.txt');
      expect(await run(['ws', 'push', '-m', 'Make a executable'], server.fetch, root)).toBe(0);
      expect(server.execs.get(server.branches.get('main')!)!.has('a.txt')).toBe(true);
    }
    // Pulling asks for what changed, not for the whole tree.
    const trees = server.requests.filter((r) => r.path.endsWith('/tree')).length;
    server.push('main', { 'e.txt': 'e\n', 'b.txt': null });
    expect(await run(['ws', 'pull'], server.fetch, root)).toBe(0);
    expect(server.requests.filter((r) => r.path.endsWith('/tree')).length).toBe(trees);
    expect(await readFile(join(root, 'e.txt'), 'utf8')).toBe('e\n');
    expect(existsSync(join(root, 'b.txt'))).toBe(false);
  });

  test('a conflicted merge writes markers, then --continue sends the edited files', async () => {
    const server = fakeServer();
    server.push('main', { 'a.txt': 'one\n', 'b.txt': 'b\n' });
    expect(await run(['ws', 'clone', 'lab'], server.fetch)).toBe(0);
    const root = join(work, 'lab');
    expect(await run(['ws', 'branch', 'mine'], server.fetch, root)).toBe(0);
    await writeFile(join(root, 'a.txt'), 'mine\n');
    expect(await run(['ws', 'push', '-m', 'Mine'], server.fetch, root)).toBe(0);
    server.push('main', { 'a.txt': 'theirs\n', 'c.txt': 'c\n' });

    err = [];
    expect(await run(['ws', 'merge', 'main'], server.fetch, root)).toBe(1);
    expect(err.join('\n')).toContain('conflicts in 1 file(s)');
    expect(err.join('\n')).toContain('ws merge --continue');
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('<<<<<<< ours\nmine\n=======\ntheirs\n>>>>>>> theirs\n');

    err = [];
    expect(await run(['ws', 'merge', '--continue'], server.fetch, root)).toBe(1);
    expect(err.join('\n')).toContain('still has conflict markers');

    await writeFile(join(root, 'a.txt'), 'both\n');
    out = [];
    expect(await run(['ws', 'merge', '--continue'], server.fetch, root)).toBe(0);
    expect(out.join('\n')).toContain('Merged main into mine');
    const head = server.commits.get(server.branches.get('mine')!)!;
    expect(server.text(head['a.txt'])).toBe('both\n');
    expect(head['c.txt']).toBeDefined();
    expect(await readFile(join(root, 'c.txt'), 'utf8')).toBe('c\n');
    expect(JSON.parse(await readFile(join(root, '.posterity/workspace.json'), 'utf8')).merging).toBeUndefined();
  });

  test('--abort puts conflicted files back', async () => {
    const server = fakeServer();
    server.push('main', { 'a.txt': 'one\n' });
    expect(await run(['ws', 'clone', 'lab'], server.fetch)).toBe(0);
    const root = join(work, 'lab');
    expect(await run(['ws', 'branch', 'mine'], server.fetch, root)).toBe(0);
    await writeFile(join(root, 'a.txt'), 'mine\n');
    expect(await run(['ws', 'push', '-m', 'Mine'], server.fetch, root)).toBe(0);
    server.push('main', { 'a.txt': 'theirs\n' });
    expect(await run(['ws', 'merge', 'main'], server.fetch, root)).toBe(1);
    expect(await run(['ws', 'merge', '--abort'], server.fetch, root)).toBe(0);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('mine\n');
  });

  test('merging needs a clean working directory', async () => {
    const server = fakeServer();
    server.push('main', { 'a.txt': 'one\n' });
    expect(await run(['ws', 'clone', 'lab'], server.fetch)).toBe(0);
    const root = join(work, 'lab');
    await writeFile(join(root, 'a.txt'), 'dirty\n');
    err = [];
    expect(await run(['ws', 'merge', 'main'], server.fetch, root)).toBe(1);
    expect(err.join('\n')).toContain('unpushed changes');
  });
});
