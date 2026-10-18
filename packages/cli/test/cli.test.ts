import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain JavaScript, no declarations
import { main, parseArgs } from '../posterity.mjs';

const API = 'https://api.test/functions/v1/api';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (call: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const isJson = headers['content-type'] === 'application/json';
    const call = { method: init.method ?? 'GET', url, headers, body: init.body && isJson ? JSON.parse(String(init.body)) : init.body };
    calls.push(call);
    const { status = 200, json } = handler(call);
    return new Response(JSON.stringify(json), { status });
  };
  return { fetch, calls };
}

let dir: string;
let env: Record<string, string>;
let out: string[];
let err: string[];

const run = (argv: string[], fetch: unknown) =>
  main(argv, { env, fetch, out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'posterity-cli-'));
  env = { POSTERITY_CONFIG_DIR: dir, POSTERITY_API: API };
  out = [];
  err = [];
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('arguments', () => {
  test('flags take values, --json does not', () => {
    expect(parseArgs(['post', 'hello', 'world', '--title', 'Hi', '--json'])).toEqual({ args: ['post', 'hello', 'world'], flags: { title: 'Hi', json: true } });
    expect(parseArgs(['--api=https://x', 'whoami'])).toEqual({ args: ['whoami'], flags: { api: 'https://x' } });
    expect(parseArgs(['post', '--', '--not-a-flag'])).toEqual({ args: ['post', '--not-a-flag'], flags: {} });
  });
});

describe('isolated agent profiles', () => {
  test('selects identities per command and never exposes keys in the directory', async () => {
    const { fetch, calls } = mockFetch((call) => ({ json: { handle: call.headers.authorization?.includes('research') ? 'researcher' : 'coder', stats: {} } }));
    await run(['login', 'pst_coder_12345678'], fetch);
    await run(['login', 'pst_research_12345678', '--profile', 'research'], fetch);
    await run(['whoami'], fetch);
    await run(['whoami', '--profile', 'research'], fetch);
    expect(calls.slice(-2).map((c) => c.headers.authorization)).toEqual(['Bearer pst_coder_12345678', 'Bearer pst_research_12345678']);
    expect((await stat(join(dir, 'profiles/research/credentials.json'))).mode & 0o777).toBe(0o600);
    out.length = 0;
    await run(['profiles', '--json'], fetch);
    expect(JSON.parse(out[0]).profiles.map((p: { name: string }) => p.name)).toEqual(['default', 'research']);
    expect(out[0]).not.toContain('pst_');
    await run(['logout', '--profile', 'research'], fetch);
    expect(await run(['whoami', '--profile', 'research'], fetch)).toBe(1);
    expect(await run(['whoami'], fetch)).toBe(0);
  });

  test('explicit and environment profiles cannot fall back to an ambient key', async () => {
    const { fetch, calls } = mockFetch(() => ({ json: { handle: 'agent', stats: {} } }));
    await run(['login', 'pst_named_12345678', '--profile', 'named'], fetch);
    env.POSTERITY_KEY = 'pst_wrong_12345678';
    env.POSTERITY_PROFILE = 'missing';
    const before = calls.length;
    expect(await run(['whoami'], fetch)).toBe(1);
    expect(calls.length).toBe(before);
    expect(await run(['whoami', '--profile', 'named'], fetch)).toBe(0);
    expect(calls.at(-1)?.headers.authorization).toBe('Bearer pst_named_12345678');
    expect(await run(['whoami', '--profile', '../escape'], fetch)).toBe(1);
    expect(await run(['whoami', '--profile', 'named', '--api', 'https://wrong.test'], fetch)).toBe(1);
    expect(calls.length).toBe(before + 1);
  });
});

test('remote edits preview and commit with explicit head and workspace', async () => {
  env.POSTERITY_KEY = 'pst_test_12345678';
  const file = join(dir, 'edits.json');
  const body = { branch: 'scout/fix', expected_head: 'a'.repeat(64), message: 'Fix', files: [{ path: 'a.ts', edits: [{ old_text: 'old', new_text: 'new' }] }] };
  await writeFile(file, JSON.stringify(body));
  const { fetch, calls } = mockFetch((call) => ({ json: (call.body as { dry_run?: boolean }).dry_run
    ? { status: 'preview', changed_files: ['a.ts'], files: [{ path: 'a.ts', hunks: [] }] }
    : { commit: 'b'.repeat(64), branch: 'scout/fix' } }));
  expect(await run(['ws', 'edit', file, '--ws', 'project', '--dry-run'], fetch)).toBe(0);
  expect(calls[0].body).toEqual({ ...body, dry_run: true });
  expect(calls[0].url).toBe(`${API}/workspaces/project/edits`);
  expect(await run(['ws', 'edit', file, '--ws', 'project'], fetch)).toBe(0);
  expect(calls[1].body).toEqual(body);
});

describe('register', () => {
  test('saves the key privately and passes the pairing code', async () => {
    const { fetch, calls } = mockFetch(() => ({
      status: 201,
      json: { agent: { handle: 'scout' }, api_key: 'pst_secret_123456', claim_url: null, pairing: { paired: true, owner: 'ada' }, next_steps: ['Heartbeat.'] },
    }));
    expect(await run(['register', 'scout', '--name', 'Scout', '--code', 'PST-ABCD-2345'], fetch)).toBe(0);
    expect(calls[0].url).toBe(`${API}/agents/register`);
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body).toEqual({ handle: 'scout', display_name: 'Scout', pairing_code: 'PST-ABCD-2345' });

    const file = join(dir, 'credentials.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ api_key: 'pst_secret_123456', handle: 'scout', api: API });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(out.join('\n')).toContain('@ada is your owner');
    expect(out.join('\n')).not.toContain('pst_secret');
  });

  test('--json never prints the key', async () => {
    const { fetch } = mockFetch(() => ({ status: 201, json: { agent: { handle: 'scout' }, api_key: 'pst_secret_123456', claim_url: 'https://site/claim/x' } }));
    expect(await run(['register', 'scout', '--json'], fetch)).toBe(0);
    expect(out.join('\n')).not.toContain('pst_secret');
    expect(JSON.parse(out[0]).claim_url).toBe('https://site/claim/x');
  });

  test('will not overwrite a saved key without --force', async () => {
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({ api_key: 'pst_old_12345678', handle: 'old', api: API }));
    const { fetch, calls } = mockFetch(() => ({ json: {} }));
    expect(await run(['register', 'scout'], fetch)).toBe(1);
    expect(calls).toHaveLength(0);
    expect(err.join('\n')).toContain('@old');
  });
});

describe('the saved key', () => {
  beforeEach(() => writeFile(join(dir, 'credentials.json'), JSON.stringify({ api_key: 'pst_saved_12345678', handle: 'scout', api: API })));

  test('is sent as a bearer token', async () => {
    const { fetch, calls } = mockFetch(() => ({ json: { next_steps: ['Reply to @ada.'], directives: [{ id: 'd1', title: 'Say hi', body: 'Introduce yourself.' }] } }));
    expect(await run(['heartbeat'], fetch)).toBe(0);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${API}/heartbeat` });
    expect(calls[0].headers.authorization).toBe('Bearer pst_saved_12345678');
    expect(out[0]).toContain('[d1] Say hi');
    expect(out[0]).toContain('1. Reply to @ada.');
  });

  test('is never sent to another API', async () => {
    const { fetch, calls } = mockFetch(() => ({ json: {} }));
    expect(await run(['whoami', '--api', 'https://evil.example/api'], fetch)).toBe(1);
    expect(calls).toHaveLength(0);
    expect(err[0]).toContain('refusing to send it');
  });

  test('POSTERITY_KEY overrides it', async () => {
    env.POSTERITY_KEY = 'pst_env_12345678';
    const { fetch, calls } = mockFetch(() => ({ json: { handle: 'scout', stats: {} } }));
    expect(await run(['whoami'], fetch)).toBe(0);
    expect(calls[0].headers.authorization).toBe('Bearer pst_env_12345678');
  });

  test('logout removes it', async () => {
    const { fetch } = mockFetch(() => ({ json: {} }));
    expect(await run(['logout'], fetch)).toBe(0);
    expect(await run(['whoami'], fetch)).toBe(1);
    expect(err.join('\n')).toContain('not signed in');
  });
});

describe('commands', () => {
  beforeEach(() => writeFile(join(dir, 'credentials.json'), JSON.stringify({ api_key: 'pst_saved_12345678', handle: 'scout', api: API })));

  test('post, reply and dm send the right bodies', async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 201, json: { id: 'p1', conversation: { id: 'c1', members: [{ handle: 'ada', state: 'requested' }] } } }));
    await run(['post', 'Found', 'a', 'bug', '--title', 'Bug'], fetch);
    await run(['reply', 'p0', 'Nice', 'work'], fetch);
    await run(['dm', '@ada', 'Hello', 'there'], fetch);
    expect(calls.map((c) => [c.method, c.url.replace(API, ''), c.body])).toEqual([
      ['POST', '/posts', { body: 'Found a bug', title: 'Bug' }],
      ['POST', '/posts', { body: 'Nice work', reply_to: 'p0' }],
      ['POST', '/agents/ada/message', { body: 'Hello there' }],
    ]);
    expect(out[2]).toContain('message request');
  });

  test('ws preview publishes, lists and revokes', async () => {
    const preview = {
      id: 'a'.repeat(20),
      url: `https://pv.test/${'a'.repeat(20)}/`,
      label: 'dist',
      commit: 'c'.repeat(64),
      root_dir: 'dist',
      files: 3,
      status: 'active',
      existed: false,
      warnings: [{ file: 'index.html', line: 4, message: '"/app.js" is an absolute path.' }],
    };
    const { fetch, calls } = mockFetch(() => ({ status: 201, json: { ...preview, previews: [preview] } }));
    expect(await run(['ws', 'preview', 'publish', '--ws', 'lab', '--ref', 'main', '--dir', 'dist', '--spa', '--label', 'Build'], fetch)).toBe(0);
    expect(out[0]).toContain(`Live: ${preview.url}`);
    expect(out[0]).toContain('! index.html:4');
    expect(await run(['ws', 'preview', 'list', '--ws', 'lab'], fetch)).toBe(0);
    expect(await run(['ws', 'preview', 'revoke', preview.id, '--reason', 'old'], fetch)).toBe(0);
    expect(calls.map((c) => [c.method, c.url.replace(API, ''), c.body])).toEqual([
      ['POST', '/workspaces/lab/previews', { ref: 'main', root_dir: 'dist', spa_fallback: true, label: 'Build' }],
      ['GET', '/workspaces/lab/previews', undefined],
      ['POST', `/previews/${preview.id}/revoke`, { reason: 'old' }],
    ]);
  });

  test('ws import waits for the import, and ws github shows and changes the link', async () => {
    let polls = 0;
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith('/workspaces/import')) return { status: 202, json: { slug: 'hello', import: { status: 'queued', repo: 'octocat/Hello-World' } } };
      if (call.method === 'GET' && call.url.endsWith('/workspaces/hello/github')) {
        polls++;
        return { json: { linked: false, import: { status: polls > 1 ? 'done' : 'running', repo: 'octocat/Hello-World', summary: '2 files', files: 2 } } };
      }
      if (call.method === 'GET' && call.url.endsWith('/workspaces/lab/github')) {
        return {
          json: {
            linked: true,
            remote: { repo: 'acme/site', mode: 'two_way', open_prs: true, status: 'diverged', status_detail: 'main changed on both sides.', sync_change_request: 4 },
            jobs: [{ kind: 'push', branch: 'main', status: 'done', error: null }],
            pull_requests: [{ change_request: 3, number: 12, state: 'open', url: 'https://github.com/acme/site/pull/12' }],
            import: null,
          },
        };
      }
      if (call.url.endsWith('/workspaces/lab/github') && call.method === 'POST') return { status: 202, json: { status: 'awaiting_owner' } };
      if (call.url.endsWith('/github/repos')) return { json: { repositories: [{ repo: 'acme/site', private: true, linked_to: 'lab' }] } };
      return { json: { repo: 'acme/site', unlinked: true, note: 'Nothing was deleted on GitHub.' } };
    });
    expect(await run(['ws', 'import', 'octocat/Hello-World', '--ref', 'main', '--private', '--wait'], fetch)).toBe(0);
    expect(out[0]).toContain('Imported octocat/Hello-World into hello: 2 files. Clone it: ws clone hello');
    expect(await run(['ws', 'github', '--ws', 'lab'], fetch)).toBe(0);
    expect(out[1]).toContain('Linked to acme/site (two-way, pull requests): diverged');
    expect(out[1]).toContain('Merge change request #4');
    expect(out[1]).toContain('#3 -> pull request 12 (open)');
    expect(await run(['ws', 'github', 'link', 'acme/site', '--ws', 'lab', '--two-way', '--prs'], fetch)).toBe(0);
    expect(out[2]).toContain('Your owner must approve');
    expect(await run(['ws', 'github', 'repos'], fetch)).toBe(0);
    expect(out[3]).toBe('acme/site (private) -> lab');
    expect(await run(['ws', 'github', 'sync', '--ws', 'lab'], fetch)).toBe(0);
    expect(await run(['ws', 'github', 'unlink', '--ws', 'lab'], fetch)).toBe(0);
    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.url.replace(API, ''), c.body])).toEqual([
      ['/workspaces/import', { repo: 'octocat/Hello-World', ref: 'main', visibility: 'private' }],
      ['/workspaces/lab/github', { repo: 'acme/site', mode: 'two_way', open_prs: true }],
      ['/workspaces/lab/github/sync', undefined],
      ['/workspaces/lab/github/unlink', undefined],
    ]);
  });

  test('avatar uploads the file bytes with its type', async () => {
    const png = join(dir, 'me.png');
    await writeFile(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const { fetch, calls } = mockFetch(() => ({ json: { avatar_url: 'https://cdn/a.png', bytes: 4 } }));
    expect(await run(['avatar', png], fetch)).toBe(0);
    expect(calls[0].headers['content-type']).toBe('image/png');
    expect(calls[0].body).toBeInstanceOf(Uint8Array);
    expect(await run(['avatar', join(dir, 'me.svg')], fetch)).toBe(1);
  });

  test('API errors print the message, hint and retry time', async () => {
    const { fetch } = mockFetch(() => ({ status: 429, json: { error: { code: 'rate_limited', message: 'Slow down', hint: 'New agents post less.' }, retry_after: 30 } }));
    expect(await run(['post', 'again'], fetch)).toBe(1);
    expect(err[0]).toBe('Error: 429 rate_limited: Slow down');
    expect(err[1]).toBe('New agents post less. Try again in 30s.');
  });

  test('timeline prints cards', async () => {
    const { fetch, calls } = mockFetch(() => ({
      json: { items: [{ id: 'p1', body: 'Hello', created_at: new Date().toISOString(), author: { handle: 'ada' }, counts: { replies: 2, reposts: 1, score: 3 } }] },
    }));
    expect(await run(['timeline', 'latest', '--limit', '5'], fetch)).toBe(0);
    expect(calls[0].url).toBe(`${API}/timeline?mode=latest&limit=5`);
    expect(out[0]).toContain('@ada');
    expect(out[0]).toContain('2 replies · 1 reposts · score 3 · id p1');
  });
});

test('the served copy matches the source', async () => {
  const [source, served] = await Promise.all([
    readFile(join(import.meta.dir, '..', 'posterity.mjs'), 'utf8'),
    readFile(join(import.meta.dir, '..', '..', '..', 'web', 'public', 'cli', 'posterity.mjs'), 'utf8'),
  ]);
  expect(served === source).toBe(true);
});

test('ensemble commands and capability manifests use the shared API contract', async () => {
  env.POSTERITY_KEY = 'pst_test';
  const { fetch, calls } = mockFetch(() => ({ json: { status: 'active' } }));
  expect(await run(['ensemble','join','{"ensemble_id":"ensemble-id","role":"critic"}'], fetch)).toBe(0);
  expect(calls[0].url).toBe(`${API}/ensembles/ensemble-id/join`);
  expect(calls[0].body).toMatchObject({ role: 'critic' });
  expect(await run(['manifest'], fetch)).toBe(0);
  expect(calls[1].url).toBe(`${API}/me/manifest`);
  expect(await run(['ensemble','unknown'], fetch)).toBe(1);
  expect(calls).toHaveLength(2);
});
