// Phase 11 end-to-end test: GitHub over REST and MCP.
//
//   POSTERITY_API=<a deployment> bun scripts/e2e/phase11.ts          # stage 1: the App's endpoints, imports from GitHub
//   (run scripts/e2e/phase11_setup.sql)                             # an owner with a simulated installation and a link
//   POSTERITY_API=<a deployment> bun scripts/e2e/phase11.ts linked   # stage 2: repositories, link status, resync, unlink
//
// Stage 1 imports small public repositories from github.com for real. The sync with a repository needs
// the GitHub App's credentials; without them (staging) the link routes answer 503, which is checked, and
// the sync itself is covered by supabase/functions/tests (an in-memory GitHub) and phase11_github.sql.
// Registers throwaway "e2e-" agents; scripts/e2e/cleanup.sql removes them and their workspaces.

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE } from './lib.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const STATE_FILE = join(tmpdir(), 'posterity-phase11-e2e.json');
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

const section = (title: string) => console.log(`\n${title}`);

async function api(method: string, path: string, opts: { key?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined || opts.raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
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

async function tool(name: string, args: Json, key?: string) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json().catch(() => null);
  const text: string = body?.result?.content?.[0]?.text ?? '';
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { error: body?.result?.isError === true, text, json };
}

async function waitForImport(slug: string, key: string, seconds = 90): Promise<Json> {
  const until = Date.now() + seconds * 1000;
  let last: Json = null;
  while (Date.now() < until) {
    const res = await api('GET', `/workspaces/${slug}/github`, { key });
    last = res.data;
    if (['done', 'failed'].includes(last?.import?.status)) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

async function stage1() {
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

  section('The App, as the API describes it');
  const index = await api('GET', '/');
  check('the API is at least 0.11', /^0\.(1[1-9]|[2-9]\d)\./.test(index.data?.version ?? ''), index.data?.version);
  const paths = (index.data?.endpoints ?? []).map((e: Json) => `${e.method} ${e.path}`);
  for (const route of ['GET /workspaces/:workspace/github', 'POST /workspaces/:workspace/github', 'POST /workspaces/:workspace/github/unlink',
    'POST /workspaces/:workspace/github/sync', 'POST /workspaces/import', 'GET /github/repos']) {
    check(`index lists ${route}`, paths.includes(route));
  }
  const openapi = await api('GET', '/openapi.json');
  const ops = JSON.stringify(openapi.data);
  check('OpenAPI has importWorkspace and linkWorkspaceGitHub', ops.includes('"importWorkspace"') && ops.includes('"linkWorkspaceGitHub"'));
  const app = await api('GET', '/github/app');
  check('GET /github/app answers with the permissions it asks for', app.status === 200 && app.data?.permissions?.contents === 'write'
    && Array.isArray(app.data?.events) && typeof app.data?.configured === 'boolean', app.data);
  const configured = Boolean(app.data?.configured);
  console.log(`    (the App is ${configured ? '' : 'not '}configured on this deployment)`);

  section('Webhooks and claims are refused without proof');
  const hook = await api('POST', '/github/webhook', { raw: '{"zen":"hi"}', headers: { 'X-GitHub-Event': 'ping', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) } });
  check(configured ? 'a forged delivery is refused (401)' : 'deliveries wait for the App (503)', hook.status === (configured ? 401 : 503), hook.data);
  const unsigned = await api('POST', '/github/webhook', { raw: '{}', headers: { 'X-GitHub-Event': 'push' } });
  check('an unsigned delivery is refused', unsigned.status === (configured ? 401 : 503), unsigned.data);
  const claim = await api('POST', '/github/claim', { body: { code: 'x' } });
  check(configured ? 'a claim needs a signed-in person (401)' : 'claims wait for the App (503)', claim.status === (configured ? 401 : 503), claim.data);
  const claimKey = await api('POST', '/github/claim', { body: { code: 'x' }, headers: { Authorization: 'Bearer pst_' + '0'.repeat(48) } });
  check('an agent key cannot claim an installation', claimKey.status === (configured ? 401 : 503), claimKey.data);

  section('Agents and their repositories');
  const alice = await register('alice');
  const bob = await register('bob');
  check('two agents registered', Boolean(alice && bob));
  const repos = await api('GET', '/github/repos', { key: alice });
  check('an unclaimed agent has no repositories', repos.status === 200 && repos.data?.owner_connected === false && repos.data?.repositories?.length === 0, repos.data);
  check('and is told how its owner connects GitHub', /control room/.test(repos.data?.how ?? ''), repos.data?.how);
  const noKey = await api('GET', '/github/repos');
  check('the list needs a key', noKey.status === 401, noKey.data);
  const mcpRepos = await tool('posterity_github', {}, alice);
  check('MCP: posterity_github lists repositories by default', !mcpRepos.error && mcpRepos.json?.owner_connected === false, mcpRepos.text);

  const slug = `e2e-${run}-gh`;
  const ws = await api('POST', '/workspaces', { key: alice, body: { name: 'E2E GitHub', slug } });
  check('a workspace', ws.status === 201, ws.data);
  const status = await api('GET', `/workspaces/${slug}/github`);
  check('an unlinked workspace says so, to anyone', status.status === 200 && status.data?.linked === false, status.data);
  const link = await api('POST', `/workspaces/${slug}/github`, { key: alice, body: { repo: 'octocat/Hello-World' } });
  check(configured ? 'linking without an owner\'s installation is refused' : 'linking waits for the App (503)',
    configured ? [403, 404].includes(link.status) : link.status === 503, link.data);
  const unlink = await api('POST', `/workspaces/${slug}/github/unlink`, { key: alice });
  check('unlinking an unlinked workspace is a 404', unlink.status === 404, unlink.data);
  const sync = await api('POST', `/workspaces/${slug}/github/sync`, { key: alice });
  check('resyncing an unlinked workspace is a 404', sync.status === 404, sync.data);
  const anonLink = await api('POST', `/workspaces/${slug}/github`, { body: { repo: 'octocat/Hello-World' } });
  check('linking needs a key', anonLink.status === 401 || anonLink.status === 503, anonLink.data);

  section('Importing public repositories');
  const bad = await api('POST', '/workspaces/import', { key: alice, body: { repo: 'not a repository' } });
  check('a malformed name is a 400', bad.status === 400, bad.data);
  const missing = await api('POST', '/workspaces/import', { key: alice, body: { repo: `octocat/no-such-repo-${run}` } });
  check('a repository that does not exist (or is private) is a 404', missing.status === 404, missing.data);
  const linked = await api('POST', '/workspaces/import', { key: alice, body: { repo: 'octocat/Hello-World', link: 'mirror' } });
  check('linking an import needs the owner\'s installation', [404, 503].includes(linked.status), linked.data);

  const hello = await api('POST', '/workspaces/import', { key: alice, body: { repo: 'https://github.com/octocat/Hello-World.git', slug: `e2e-${run}-hello` } });
  check('import accepted (202) with the new workspace', hello.status === 202 && hello.data?.slug === `e2e-${run}-hello`
    && hello.data?.import?.status === 'queued' && hello.data?.import?.repo === 'octocat/Hello-World', hello.data);
  const viaMcp = await tool('posterity_github', { action: 'import', repo: 'octocat/Spoon-Knife', slug: `e2e-${run}-spoon`, visibility: 'unlisted' }, bob);
  check('MCP: import too', !viaMcp.error && viaMcp.json?.slug === `e2e-${run}-spoon` && viaMcp.json?.visibility === 'unlisted', viaMcp.text);

  const helloDone = await waitForImport(`e2e-${run}-hello`, alice);
  check('the import finishes', helloDone?.import?.status === 'done', helloDone);
  check('with the commit it came from', /^[0-9a-f]{40}$/.test(helloDone?.import?.sha ?? ''), helloDone?.import);
  const tree = await api('GET', `/workspaces/e2e-${run}-hello/tree?recursive=true`);
  check('the files are there', (tree.data?.entries ?? []).some((e: Json) => e.path === 'README'), tree.data);
  const readme = await api('GET', `/workspaces/e2e-${run}-hello/files?path=README`);
  check('with their content', readme.data?.content === 'Hello World!\n', readme.data);
  const log = await api('GET', `/workspaces/e2e-${run}-hello/log`);
  check('the import commit is marked as from GitHub', log.data?.commits?.[0]?.from_github === true && /Import octocat\/Hello-World/.test(log.data?.commits?.[0]?.message ?? ''), log.data?.commits?.[0]);
  const wsJson = await api('GET', `/workspaces/e2e-${run}-hello`);
  check('the workspace shows where it came from', wsJson.data?.import?.repo === 'octocat/Hello-World' && wsJson.data?.import?.status === 'done', wsJson.data?.import);
  const home = await api('POST', '/heartbeat', { key: alice });
  check('the heartbeat says the import is done', JSON.stringify(home.data ?? {}).includes('the import finished'), home.data?.notifications);

  const spoonDone = await waitForImport(`e2e-${run}-spoon`, bob);
  check('the second import finishes', spoonDone?.import?.status === 'done', spoonDone);
  const spoon = await api('GET', `/workspaces/e2e-${run}-spoon/files?path=index.html`);
  check('Spoon-Knife\'s index.html is there', readme.status === 200 && spoon.status === 200 && String(spoon.data?.content).includes('<html'), spoon.data);

  writeFileSync(STATE_FILE, JSON.stringify({ run, slug, alice, bob, configured }));
  console.log(`\nState for stage 2: ${STATE_FILE}. Run scripts/e2e/phase11_setup.sql, then: bun scripts/e2e/phase11.ts linked`);
}

async function stage2() {
  const { run, slug, alice, bob, configured } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { run: string; slug: string; alice: string; bob: string; configured: boolean };

  section('An owner with an installation');
  const repos = await api('GET', '/github/repos', { key: alice });
  check('the agent sees its owner\'s repositories', repos.data?.owner_connected === true && repos.data?.repositories?.length === 2, repos.data);
  const site = repos.data?.repositories?.find((r: Json) => r.repo === `e2e-${run}/site`);
  check('with what each is linked to', site?.linked_to === slug, site);

  section('A linked workspace');
  const mine = await api('GET', `/workspaces/${slug}/github`, { key: alice });
  check('its maintainer sees the link, jobs and pull requests', mine.data?.linked === true && mine.data?.remote?.repo === `e2e-${run}/site`
    && mine.data?.remote?.mode === 'mirror' && Array.isArray(mine.data?.jobs) && Array.isArray(mine.data?.pull_requests), mine.data);
  const theirs = await api('GET', `/workspaces/${slug}/github`, { key: bob });
  check('another agent sees the public part only', theirs.data?.remote?.repo === `e2e-${run}/site` && theirs.data?.jobs == null
    && theirs.data?.remote?.installation_id == null, theirs.data);
  const anon = await api('GET', `/workspaces/${slug}/github`);
  check('so does anyone', anon.status === 200 && anon.data?.remote?.mode === 'mirror' && anon.data?.jobs == null, anon.data);
  const ws = await api('GET', `/workspaces/${slug}`);
  check('the workspace says it mirrors to GitHub', ws.data?.github?.repo === `e2e-${run}/site`, ws.data?.github);

  const bobSync = await api('POST', `/workspaces/${slug}/github/sync`, { key: bob });
  check('only maintainers resync', bobSync.status === 403, bobSync.data);
  const resync = await api('POST', `/workspaces/${slug}/github/sync`, { key: alice });
  check('the maintainer resyncs', resync.status === 200 && resync.data?.repo === `e2e-${run}/site`, resync.data);
  const jobs = await api('GET', `/workspaces/${slug}/github`, { key: alice });
  check('a link job is queued or ran', (jobs.data?.jobs ?? []).some((j: Json) => j.kind === 'link'), jobs.data?.jobs);

  const relink = await api('POST', `/workspaces/${slug}/github`, { key: alice, body: { repo: `e2e-${run}/other`, mode: 'two_way' } });
  check(configured ? 'relinking asks the owner first (202)' : 'relinking waits for the App (503)',
    configured ? relink.status === 202 && relink.data?.status === 'awaiting_owner' : relink.status === 503, relink.data);
  const privateImport = await api('POST', '/workspaces/import', { key: alice, body: { repo: `e2e-${run}/other` } });
  check(configured ? 'a private import asks the owner first (202)' : 'a private import waits for the App (503)',
    configured ? privateImport.data?.status === 'awaiting_owner' : privateImport.status === 503, privateImport.data);

  const bobUnlink = await api('POST', `/workspaces/${slug}/github/unlink`, { key: bob });
  check('only maintainers unlink', bobUnlink.status === 403, bobUnlink.data);
  const unlink = await tool('posterity_github', { action: 'unlink', workspace: slug }, alice);
  check('MCP: the maintainer unlinks', !unlink.error && unlink.json?.unlinked === true && /Nothing was deleted on GitHub/.test(unlink.json?.note ?? ''), unlink.text);
  const after = await api('GET', `/workspaces/${slug}/github`, { key: alice });
  check('and it is unlinked', after.data?.linked === false, after.data);
}

const mode = process.argv[2];
if (mode === 'linked') await stage2();
else await stage1();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
