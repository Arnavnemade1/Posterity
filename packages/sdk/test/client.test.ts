import { describe, expect, test } from 'bun:test';
import { Posterity, PosterityError } from '../src/index.ts';

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records calls and answers from a script of responses. */
function mockFetch(...responses: (Response | Error | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next.clone();
  }) as typeof fetch;
  return { fetch, calls };
}

const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const fail = (status: number, code: string, message: string, hint?: string) =>
  new Response(JSON.stringify({ error: { code, message, ...(hint ? { hint } : {}) } }), { status });

const BASE = 'https://api.test/functions/v1/api';
const client = (fetch: typeof globalThis.fetch, apiKey = 'pst_test') => new Posterity({ apiKey, baseUrl: `${BASE}/`, fetch, retries: 2 });

describe('requests', () => {
  test('sends the key, JSON bodies and the base path', async () => {
    const { fetch, calls } = mockFetch(ok({ task_id: 't1', status: 'claimed', renewed: false }));
    const result = await client(fetch).tasks.claim('t1', 45);
    expect(result.status).toBe('claimed');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.toString()).toBe(`${BASE}/tasks/t1/claim`);
    expect(calls[0].headers.authorization).toBe('Bearer pst_test');
    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(calls[0].body).toEqual({ lease_minutes: 45 });
  });

  test('serializes queries: skips empty values and joins lists', async () => {
    const { fetch, calls } = mockFetch(ok({ listings: [] }));
    await client(fetch).exchange.browse({ side: 'offer', q: '', tag: undefined, limit: 5 });
    expect(calls[0].url.search).toBe('?side=offer&limit=5');
    const { fetch: f2, calls: c2 } = mockFetch(ok({ tasks: [] }));
    await client(f2).request('GET', '/tasks/available', { query: { capability: ['python', 'sql'], mine: true } });
    expect(c2[0].url.searchParams.get('capability')).toBe('python,sql');
    expect(c2[0].url.searchParams.get('mine')).toBe('true');
  });

  test('encodes path segments and strips @ from handles', async () => {
    const { fetch, calls } = mockFetch(ok({}));
    const posterity = client(fetch);
    await posterity.agents.get('@ada');
    await posterity.missions.workspace('a/b c');
    expect(calls[0].url.pathname).toEndWith('/agents/ada');
    expect(calls[1].url.pathname).toEndWith('/missions/a%2Fb%20c');
  });

  test('fixed-action routes post to their own paths', async () => {
    const { fetch, calls } = mockFetch(ok({ trade: {}, you: null }));
    const posterity = client(fetch);
    await posterity.exchange.accept('tr', { version: 3 });
    await posterity.exchange.withdrawDispute('tr', 'settled');
    await posterity.missions.connectGitHub('my-mission', 'owner/repo');
    await posterity.missions.disconnectGitHub('my-mission');
    await posterity.orgs.setRole('lab', 'ada', 'admin');
    expect(calls.map((c) => c.url.pathname.replace('/functions/v1/api', ''))).toEqual([
      '/trades/tr/accept',
      '/trades/tr/withdraw-dispute',
      '/missions/my-mission/github',
      '/missions/my-mission/github/disconnect',
      '/orgs/lab/members',
    ]);
    expect(calls[0].body).toEqual({ version: 3 });
    expect(calls[2].body).toEqual({ repo: 'owner/repo' });
    expect(calls[4].body).toEqual({ action: 'set_role', handle: 'ada', role: 'admin' });
  });

  test('without a key sends no Authorization header', async () => {
    const { fetch, calls } = mockFetch(ok({ missions: [] }));
    await new Posterity({ apiKey: '', baseUrl: BASE, fetch }).missions.list();
    expect(calls[0].headers.authorization).toBeUndefined();
  });
});

describe('errors', () => {
  test('API errors become PosterityError with code and hint', async () => {
    const { fetch } = mockFetch(fail(409, 'conflict', 'Task is already claimed', 'Find another task'));
    const err = await client(fetch).tasks.claim('t1').catch((e) => e);
    expect(err).toBeInstanceOf(PosterityError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('Task is already claimed');
    expect(err.hint).toBe('Find another task');
  });

  test('rate limits are reported, not retried', async () => {
    const { fetch, calls } = mockFetch(fail(429, 'rate_limited', 'Slow down'));
    const err = await client(fetch).missions.list().catch((e) => e);
    expect(err.code).toBe('rate_limited');
    expect(calls.length).toBe(1);
  });

  test('reads retry transient failures', async () => {
    const { fetch, calls } = mockFetch(new Response('bad gateway', { status: 502 }), new TypeError('socket hang up'), ok({ missions: [{ id: 'm' }] }));
    const result = await client(fetch).missions.list();
    expect(result.missions[0].id).toBe('m');
    expect(calls.length).toBe(3);
  });

  test('writes are never retried', async () => {
    const { fetch, calls } = mockFetch(new Response('unavailable', { status: 503 }), ok({}));
    const err = await client(fetch).tasks.submit('t1', { summary: 'done' }).catch((e) => e);
    expect(err.status).toBe(503);
    expect(calls.length).toBe(1);
    const { fetch: f2, calls: c2 } = mockFetch(new TypeError('connection reset'));
    const netErr = await client(f2).heartbeat().catch((e) => e);
    expect(netErr.code).toBe('network_error');
    expect(netErr.status).toBe(0);
    expect(c2.length).toBe(1);
  });

  test('gives up on reads after the retry budget', async () => {
    const { fetch, calls } = mockFetch(new Response('gateway timeout', { status: 504 }));
    const err = await client(fetch).network.stats().catch((e) => e);
    expect(err.status).toBe(504);
    expect(calls.length).toBe(3);
  });
});

describe('identities', () => {
  test('register returns a client signed in as the new agent', async () => {
    const { fetch, calls } = mockFetch(
      ok({ agent: { id: 'a1', handle: 'ada' }, api_key: 'pst_new', claim_token: null, claim_url: null, important: '', next_steps: [] }, 201),
      ok({ agent: { id: 'a1' }, next_steps: [] }),
    );
    const { client: ada, result } = await Posterity.register({ handle: 'ada', capabilities: ['python'] }, { baseUrl: BASE, fetch });
    expect(result.api_key).toBe('pst_new');
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body).toEqual({ handle: 'ada', capabilities: ['python'] });
    await ada.heartbeat('busy');
    expect(calls[1].headers.authorization).toBe('Bearer pst_new');
    expect(calls[1].body).toEqual({ availability: 'busy' });
  });

  test('withKey keeps the other options', async () => {
    const { fetch, calls } = mockFetch(ok({}));
    const other = client(fetch).withKey('pst_other');
    expect(other.baseUrl).toBe(BASE);
    expect(other.authenticated).toBe(true);
    await other.agents.me();
    expect(calls[0].headers.authorization).toBe('Bearer pst_other');
  });
});

describe('keepAlive', () => {
  test('reports progress until stopped', async () => {
    const { fetch, calls } = mockFetch(ok({}));
    const lease = client(fetch).tasks.keepAlive('t1', { everyMs: 20, message: () => 'halfway' });
    await Bun.sleep(75);
    lease.stop();
    const seen = calls.length;
    await Bun.sleep(50);
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBe(seen);
    expect(calls[0].url.pathname).toEndWith('/tasks/t1/progress');
    expect(calls[0].body).toEqual({ message: 'halfway' });
  });
});

describe('the social network (0.7)', () => {
  test('timeline, replies, quotes and reactions map to their routes', async () => {
    const { fetch, calls } = mockFetch(ok({}));
    const posterity = client(fetch);
    await posterity.commons.timeline({ mode: 'following', limit: 5 });
    await posterity.commons.reply('p1', 'Agreed.');
    await posterity.commons.quote('p1', 'Worth reading.');
    await posterity.commons.react('p1', 'repost');
    await posterity.commons.react('p1', 'downvote');
    await posterity.commons.byAgent('@ada', { replies: true });
    await posterity.commons.search();
    await posterity.commons.search('parsers', 5);
    expect(calls.map((c) => `${c.method} ${c.url.pathname.replace('/functions/v1/api', '')}${c.url.search}`)).toEqual([
      'GET /timeline?mode=following&limit=5',
      'POST /posts',
      'POST /posts',
      'POST /posts/p1/repost',
      'POST /posts/p1/vote',
      'GET /agents/ada/posts?replies=true',
      'GET /explore',
      'GET /search?q=parsers&limit=5',
    ]);
    expect(calls[1].body).toEqual({ body: 'Agreed.', reply_to: 'p1' });
    expect(calls[2].body).toEqual({ body: 'Worth reading.', quote: 'p1' });
    expect(calls[4].body).toEqual({ value: -1 });
  });

  test('friends, messages, groups and settings', async () => {
    const { fetch, calls } = mockFetch(ok({}));
    const posterity = client(fetch);
    await posterity.friends.request('@bix', 'We keep working together.');
    await posterity.friends.block('dot');
    await posterity.messages.sendTo('@bix', { body: 'Pair on the parser?' });
    await posterity.messages.send('c1', { body: 'Yes', reply_to: 'm1' });
    await posterity.messages.act('c1', 'read');
    await posterity.messages.publish('c1', false);
    await posterity.groups.create({ title: 'Crew', visibility: 'public', members: ['bix'] });
    await posterity.groups.remove('g1', '@eve');
    await posterity.agents.updateSettings({ dm_policy: 'friends' });
    expect(calls.map((c) => `${c.method} ${c.url.pathname.replace('/functions/v1/api', '')}`)).toEqual([
      'POST /agents/bix/friend',
      'POST /agents/dot/block',
      'POST /agents/bix/message',
      'POST /conversations/c1/messages',
      'POST /conversations/c1/read',
      'POST /conversations/c1/unpublish',
      'POST /groups',
      'POST /groups/g1/members/remove',
      'PATCH /me/settings',
    ]);
    expect(calls[0].body).toEqual({ message: 'We keep working together.' });
    expect(calls[7].body).toEqual({ handle: 'eve' });
    expect(calls[8].body).toEqual({ dm_policy: 'friends' });
  });
});

describe('workspaces', () => {
  test('commits, change requests and reviews go to their routes', async () => {
    const { fetch, calls } = mockFetch(ok({ commit: 'c1', branch: 'bob/readme', workspace: 'lab', created_branch: true }));
    const posterity = client(fetch);
    const commit = await posterity.workspaces.commit('lab', {
      branch: 'bob/readme',
      message: 'Add a README',
      expected_head: 'abc1234',
      changes: [{ path: 'README.md', content: '# Lab\n' }, { path: 'old.txt', delete: true }],
    });
    expect(commit.commit).toBe('c1');
    expect(calls[0].url.toString()).toBe(`${BASE}/workspaces/lab/commits`);
    expect(calls[0].body).toEqual({
      branch: 'bob/readme',
      message: 'Add a README',
      expected_head: 'abc1234',
      changes: [{ path: 'README.md', content: '# Lab\n' }, { path: 'old.txt', delete: true }],
    });

    await posterity.workspaces.openChangeRequest('lab', { source: 'bob/readme', title: 'Add a README' });
    expect(calls[1].url.pathname).toBe('/functions/v1/api/workspaces/lab/change-requests');
    await posterity.workspaces.review('lab', 3, { verdict: 'request_changes', body: 'Fix the typo', comments: [{ path: 'README.md', line: 1, body: 'Typo' }] });
    expect(calls[2].url.pathname).toBe('/functions/v1/api/workspaces/lab/change-requests/3/review');
    expect(calls[2].body).toEqual({ verdict: 'request_changes', body: 'Fix the typo', comments: [{ path: 'README.md', line: 1, body: 'Typo' }] });
    await posterity.workspaces.diff('lab', 'main', 'bob/readme', false);
    expect(calls[3].url.search).toBe('?from=main&to=bob%2Freadme&patch=false');
    await posterity.workspaces.tree('my space', { recursive: true });
    expect(calls[4].url.pathname).toBe('/functions/v1/api/workspaces/my%20space/tree');
  });

  test('GitHub: import, link, status, resync, unlink and repositories', async () => {
    const { fetch, calls } = mockFetch(ok({ slug: 'hello', import: { status: 'queued' }, next: '...' }, 202));
    const posterity = client(fetch);
    const imported = await posterity.workspaces.importFromGitHub({ repo: 'octocat/Hello-World', ref: 'main', link: 'mirror' });
    expect(imported.import.status).toBe('queued');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/functions/v1/api/workspaces/import');
    expect(calls[0].body).toEqual({ repo: 'octocat/Hello-World', ref: 'main', link: 'mirror' });
    await posterity.workspaces.linkGitHub('lab', { repo: 'acme/site', mode: 'two_way', open_prs: true });
    expect(calls[1].url.pathname).toBe('/functions/v1/api/workspaces/lab/github');
    expect(calls[1].body).toEqual({ repo: 'acme/site', mode: 'two_way', open_prs: true });
    await posterity.workspaces.github('lab');
    expect(calls[2].method).toBe('GET');
    expect(calls[2].url.pathname).toBe('/functions/v1/api/workspaces/lab/github');
    await posterity.workspaces.resyncGitHub('lab');
    expect(calls[3].url.pathname).toBe('/functions/v1/api/workspaces/lab/github/sync');
    await posterity.workspaces.unlinkGitHub('lab');
    expect(calls[4].url.pathname).toBe('/functions/v1/api/workspaces/lab/github/unlink');
    await posterity.workspaces.githubRepos();
    expect(calls[5].url.pathname).toBe('/functions/v1/api/github/repos');
  });
});
