import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain JavaScript, no declarations
import { ignoreRule, lineDiff, main } from '../posterity.mjs';

const API = 'https://api.test/functions/v1/api';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * A small in-memory workspace server: blobs by sha256, commits as {files}, branches as heads, and the
 * same compare-and-swap on expected_head as the real engine.
 */
function fakeServer() {
  const blobs = new Map<string, Uint8Array>();
  const commits = new Map<string, Record<string, string>>();
  const branches = new Map<string, string>();
  let n = 0;
  const commit = (files: Record<string, string>) => {
    const id = sha(`commit-${n++}`);
    commits.set(id, files);
    return id;
  };
  branches.set('main', commit({}));
  const put = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    blobs.set(sha(bytes), bytes);
    return sha(bytes);
  };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/functions/v1/api', '');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    let m: RegExpMatchArray | null;
    if (method === 'GET' && (m = path.match(/^\/workspaces\/([^/]+)$/))) {
      return json({ slug: m[1], default_branch: 'main', your_role: 'writer', branches: [...branches].map(([name, head]) => ({ name, head })) });
    }
    if (method === 'GET' && path.endsWith('/tree')) {
      const head = branches.get(u.searchParams.get('ref') ?? 'main');
      if (!head) return json({ error: { code: 'not_found', message: 'No branch' } }, 404);
      const files = commits.get(head)!;
      return json({ commit: head, entries: Object.entries(files).map(([p, s]) => ({ path: p, sha256: s, size: blobs.get(s)!.length, binary: false })) });
    }
    if (method === 'POST' && path.endsWith('/blobs/read')) {
      return json({ blobs: body.shas.filter((s: string) => blobs.has(s)).map((s: string) => ({ sha256: s, binary: false, content: new TextDecoder().decode(blobs.get(s)) })) });
    }
    if (method === 'POST' && path.endsWith('/blobs/missing')) return json({ missing: body.shas.filter((s: string) => !blobs.has(s)) });
    if (method === 'POST' && path.endsWith('/blobs')) {
      const bytes = new Uint8Array(body as Uint8Array);
      blobs.set(sha(bytes), bytes);
      return json({ sha256: sha(bytes) }, 201);
    }
    if (method === 'POST' && path.endsWith('/commits')) {
      const head = branches.get(body.branch);
      if (body.expected_head && head !== body.expected_head) {
        return json({ error: { code: 'conflict', message: `head_moved: "${body.branch}" is at ${head} now.` } }, 409);
      }
      const files = { ...commits.get(head!) };
      for (const c of body.changes) {
        if (c.delete) delete files[c.path];
        else files[c.path] = c.blob;
      }
      const id = commit(files);
      branches.set(body.branch, id);
      return json({ commit: id, branch: body.branch, workspace: 'lab' }, 201);
    }
    return json({ error: { code: 'not_found', message: `${method} ${path}` } }, 404);
  };
  /** Another agent pushes straight to a branch. */
  const push = (branch: string, files: Record<string, string | null>) => {
    const next = { ...commits.get(branches.get(branch)!) };
    for (const [p, text] of Object.entries(files)) {
      if (text === null) delete next[p];
      else next[p] = put(text);
    }
    branches.set(branch, commit(next));
  };
  return { fetch, push, branches, commits, blobs };
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
});
