// Phase 10.2 end-to-end test: live previews over REST and MCP, and (with PREVIEW_ORIGIN and SITE_ORIGIN
// set) through the web app's preview origin.
//
//   POSTERITY_API=<a deployment> bun scripts/e2e/phase10_previews.ts            # stage 1: agents, a site, the tier rule
//   (run scripts/e2e/phase10_previews_setup.sql)                               # claims and ages them: the member tier
//   POSTERITY_API=<a deployment> [PREVIEW_ORIGIN=http://preview.localhost:3000 SITE_ORIGIN=http://localhost:3000] \
//     bun scripts/e2e/phase10_previews.ts publish                              # stage 2: publish, serve, revoke
//
// Registers three throwaway "e2e-" agents (remove them, their workspaces and previews with
// scripts/e2e/cleanup.sql). Registrations are limited to ten per hour per network. Stage 1 saves the
// run's keys to a file in the temp directory for stage 2.

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE } from './lib.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const STATE_FILE = join(tmpdir(), 'posterity-phase10-previews-e2e.json');
const PREVIEW_ORIGIN = process.env.PREVIEW_ORIGIN?.replace(/\/+$/, '');
const SITE_ORIGIN = process.env.SITE_ORIGIN?.replace(/\/+$/, '');

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

async function api(method: string, path: string, opts: { key?: string; body?: unknown; bytes?: boolean } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

const SITE = {
  'index.html':
    '<!doctype html><html><head><title>E2E site</title><link rel="stylesheet" href="/style.css"></head>' +
    '<body><h1>Hello from a preview</h1><script src="app.js"></script></body></html>',
  'app.js': 'try { localStorage.setItem("seen", "1"); } catch (e) {}\ndocument.title = "E2E site (js)";\n',
  'style.css': 'body { font-family: system-ui; }\n',
  'docs/index.html': '<!doctype html><title>Docs</title><p>The docs page</p>',
  'dist/index.html': '<!doctype html><title>Built</title><div id="root"></div><script src="main.js"></script>',
  'dist/main.js': 'document.getElementById("root").textContent = "built";\n',
};
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const changes = [
  ...Object.entries(SITE).map(([path, content]) => ({ path, content })),
  { path: 'img/logo.png', content_base64: btoa(String.fromCharCode(...PNG)) },
];

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

  section('Agents and a site');
  const alice = await register('alice');
  const bob = await register('bob');
  const sup = await register('sup');
  check('three agents registered', Boolean(alice && bob && sup));
  const slug = `e2e-${run}-pv`;
  const created = await api('POST', '/workspaces', { key: alice, body: { name: 'E2E Preview Lab', slug, description: 'Phase 10.2 end-to-end test.' } });
  check('workspace created', created.status === 201, created.data);
  const commit = await api('POST', `/workspaces/${slug}/commits`, {
    key: alice,
    body: { branch: 'main', expected_head: created.data?.head, message: 'A small site', changes },
  });
  check('the site is committed', commit.status === 201 && commit.data?.stats?.added === 7, commit.data);

  section('The tier rule');
  const early = await api('POST', `/workspaces/${slug}/previews`, { key: alice, body: {} });
  check('a new agent cannot publish a preview', early.status === 403, early.data);
  const mcpEarly = await tool('posterity_preview', { action: 'publish', workspace: slug }, alice);
  check('over MCP too', mcpEarly.error, mcpEarly.text);
  const anon = await api('POST', `/workspaces/${slug}/previews`, { body: {} });
  check('and an anonymous caller needs a key', anon.status === 401, anon.data);

  writeFileSync(STATE_FILE, JSON.stringify({ run, slug, alice, bob, sup }));
  console.log(`\nState for stage 2: ${STATE_FILE}. Run scripts/e2e/phase10_previews_setup.sql, then: bun scripts/e2e/phase10_previews.ts publish`);
}

async function stage2() {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { run: string; slug: string; alice: string; bob: string; sup: string };
  const { slug, alice, bob, sup } = state;

  section('Publishing');
  const first = await api('POST', `/workspaces/${slug}/previews`, { key: alice, body: { label: 'Main site' } });
  const p1 = first.data;
  check('published (201) with an id and a url', first.status === 201 && /^[0-9a-f]{20}$/.test(p1?.id ?? '') && String(p1?.url).endsWith(`/${p1?.id}/`), first.data);
  check('it names the commit, label and entry', /^[0-9a-f]{64}$/.test(p1?.commit ?? '') && p1?.label === 'Main site' && p1?.entry === 'index.html' && p1?.files === 7, p1);
  const warnings: { file: string; message: string }[] = p1?.warnings ?? [];
  check('the lint flags the absolute stylesheet path', warnings.some((w) => w.file === 'index.html' && /absolute/.test(w.message) && w.message.includes('/style.css')), warnings);
  check('and browser storage use', warnings.some((w) => w.file === 'app.js' && /storage/i.test(w.message)), warnings);
  const again = await api('POST', `/workspaces/${slug}/previews`, { key: alice, body: { label: 'Main site' } });
  check('the same files are the same preview', again.status === 201 && again.data?.id === p1?.id && again.data?.existed === true, again.data);

  const noIndex = await api('POST', `/workspaces/${slug}/previews`, { key: alice, body: { root_dir: 'img' } });
  check('a folder without an index.html is refused with a hint', noIndex.status === 422 && /index\.html/.test(noIndex.data?.error?.message ?? '') && /dist|docs/.test(noIndex.data?.error?.message ?? ''), noIndex.data);

  const dist = await api('POST', `/workspaces/${slug}/previews`, { key: alice, body: { root_dir: 'dist', spa_fallback: true, label: 'Build' } });
  check('a build folder with the single-page fallback', dist.status === 201 && dist.data?.root_dir === 'dist' && dist.data?.files === 2 && dist.data?.spa_fallback === true, dist.data);
  check('its lint finds nothing to fix', Array.isArray(dist.data?.warnings) && dist.data.warnings.length === 0, dist.data?.warnings);

  section('Serving (no key needed)');
  const root = await api('GET', `/previews/${p1.id}/file?path=`, { bytes: true });
  check('the entry page comes back', root.status === 200 && new TextDecoder().decode(root.bytes!).includes('<h1>Hello from a preview</h1>'), root.status);
  check('as a folder with its path', root.headers.get('x-posterity-dir') === '1' && root.headers.get('x-posterity-path') === 'index.html');
  check('with the workspace and publisher', root.headers.get('x-posterity-workspace') === slug && root.headers.get('x-posterity-published-by')?.startsWith('e2e-'));
  const css = await api('GET', `/previews/${p1.id}/file?path=style.css`, { bytes: true });
  check('a file by its path', css.status === 200 && new TextDecoder().decode(css.bytes!).startsWith('body {'));
  const png = await api('GET', `/previews/${p1.id}/file?path=${encodeURIComponent('img/logo.png')}`, { bytes: true });
  check('binary bytes survive', png.status === 200 && png.bytes!.length === PNG.length && png.bytes!.every((b, i) => b === PNG[i]));
  const docs = await api('GET', `/previews/${p1.id}/file?path=docs`, { bytes: true });
  check(
    'a folder answers with its index.html',
    docs.status === 200 && decodeURIComponent(docs.headers.get('x-posterity-path') ?? '') === 'docs/index.html' && docs.headers.get('x-posterity-dir') === '1',
    docs.headers.get('x-posterity-path'),
  );
  const missing = await api('GET', `/previews/${p1.id}/file?path=nope.html`);
  check('a missing file is a 404', missing.status === 404, missing.data);
  const escape = await api('GET', `/previews/${p1.id}/file?path=${encodeURIComponent('../../etc/passwd')}`);
  check('an escape attempt is a 404', escape.status === 404, escape.data);
  const spa = await api('GET', `/previews/${dist.data.id}/file?path=${encodeURIComponent('settings/profile')}`, { bytes: true });
  check('the single-page fallback serves the entry', spa.status === 200 && spa.headers.get('x-posterity-fallback') === '1' && spa.headers.get('x-posterity-path') === 'index.html');
  const spaAsset = await api('GET', `/previews/${dist.data.id}/file?path=missing.js`);
  check('but not for a path with a file extension', spaAsset.status === 404, spaAsset.data);
  const distJs = await api('GET', `/previews/${dist.data.id}/file?path=main.js`, { bytes: true });
  check('a folder preview serves its folder as the root', distJs.status === 200 && new TextDecoder().decode(distJs.bytes!).includes('textContent'));
  const outside = await api('GET', `/previews/${dist.data.id}/file?path=style.css`);
  check('and nothing outside it', outside.status === 404, outside.data);
  const bogus = await api('GET', `/previews/${'0'.repeat(20)}/file?path=`);
  check('an unknown preview is a 404', bogus.status === 404, bogus.data);

  section('Who may publish');
  const bobMain = await api('POST', `/workspaces/${slug}/previews`, { key: bob, body: {} });
  check('a reader cannot publish the default branch', bobMain.status === 403, bobMain.data);
  const head: string = (await api('GET', `/workspaces/${slug}`)).data?.head;
  const bobCommit = await api('POST', `/workspaces/${slug}/commits`, {
    key: bob,
    body: {
      branch: `e2e-${state.run}-bob/feature`,
      expected_head: head,
      message: 'A feature',
      changes: [{ path: 'index.html', content: '<!doctype html><h1>Feature</h1>' }],
    },
  });
  check('bob commits to his own branch', bobCommit.status === 201, bobCommit.data);
  const bobBranch = await api('POST', `/workspaces/${slug}/previews`, { key: bob, body: { ref: bobCommit.data?.branch } });
  check('and may publish it', bobBranch.status === 201 && bobBranch.data?.commit === bobCommit.data?.commit, bobBranch.data);
  const cr = await api('POST', `/workspaces/${slug}/change-requests`, { key: bob, body: { source: bobCommit.data?.branch, title: 'A feature' } });
  check('a change request from it', cr.status === 201, cr.data);
  const crPreview = await api('POST', `/workspaces/${slug}/previews`, { key: alice, body: { change_request: cr.data?.number, spa_fallback: true } });
  check('a writer previews the change request', crPreview.status === 201 && crPreview.data?.change_request === cr.data?.number && /change request/.test(crPreview.data?.label ?? ''), crPreview.data);
  const crGet = await api('GET', `/workspaces/${slug}/change-requests/${cr.data?.number}`);
  check('the change request lists it', crGet.data?.previews?.some((p: Json) => p.id === crPreview.data?.id), crGet.data?.previews);
  const wsGet = await api('GET', `/workspaces/${slug}`);
  check('and so does the workspace', wsGet.data?.previews?.length >= 3 && wsGet.data.previews.every((p: Json) => String(p.url).includes(p.id)), wsGet.data?.previews);

  section('Over MCP, and the owner gate');
  const listed = await tool('posterity_preview', { workspace: slug });
  check('list', !listed.error && listed.json?.previews?.length >= 3, listed.text);
  const got = await tool('posterity_preview', { action: 'get', preview: p1.id });
  check('get', !got.error && got.json?.id === p1.id, got.text);
  const toolPublish = await tool('posterity_preview', { action: 'publish', workspace: slug, root_dir: 'docs', label: 'Docs' }, alice);
  check('publish', !toolPublish.error && toolPublish.json?.root_dir === 'docs', toolPublish.text);
  const supWs = await api('POST', '/workspaces', { key: sup, body: { name: 'Sup Lab', slug: `${slug}-sup` } });
  const supCommit = await api('POST', `/workspaces/${slug}-sup/commits`, {
    key: sup,
    body: { branch: 'main', expected_head: supWs.data?.head, message: 'A page', changes: [{ path: 'index.html', content: '<!doctype html><p>Sup</p>' }] },
  });
  const gated = await api('POST', `/workspaces/${slug}-sup/previews`, { key: sup, body: {} });
  check('a supervised agent waits for its owner (202)', supWs.status === 201 && supCommit.status === 201 && gated.status === 202 && gated.data?.status === 'awaiting_owner' && gated.data?.action === 'publish_preview', gated.data);

  section('Revoking');
  const notYours = await api('POST', `/previews/${p1.id}/revoke`, { key: bob, body: { reason: 'nope' } });
  check('a reader cannot revoke it', notYours.status === 403, notYours.data);
  const revoked = await api('POST', `/previews/${p1.id}/revoke`, { key: alice, body: { reason: 'Out of date' } });
  check('the publisher can', revoked.status === 200 && revoked.data?.status === 'revoked' && revoked.data?.revoked_reason === 'Out of date', revoked.data);
  const gone = await api('GET', `/previews/${p1.id}/file?path=`);
  check('a revoked preview is a 404', gone.status === 404, gone.data);
  const active = await api('GET', `/workspaces/${slug}/previews`);
  check('and is gone from the active list', !active.data?.previews?.some((p: Json) => p.id === p1.id));
  const openapi = await api('GET', '/openapi.json');
  check('OpenAPI documents the routes', Boolean(openapi.data?.paths?.['/workspaces/{workspace}/previews'] && openapi.data?.paths?.['/previews/{preview}/file']));

  if (PREVIEW_ORIGIN) {
    section(`Through the preview origin (${PREVIEW_ORIGIN})`);
    const live = await fetch(`${PREVIEW_ORIGIN}/${dist.data.id}/`);
    const html = await live.text();
    const csp = live.headers.get('content-security-policy') ?? '';
    check('the page is served', live.status === 200 && live.headers.get('content-type')?.startsWith('text/html') && html.includes('id="root"'), live.status);
    check('with the sandbox and connect-src', /sandbox allow-scripts/.test(csp) && /connect-src 'self'/.test(csp) && /frame-ancestors/.test(csp), csp);
    check('nosniff, noindex and no referrer', live.headers.get('x-content-type-options') === 'nosniff' && /noindex/.test(live.headers.get('x-robots-tag') ?? '') && live.headers.get('referrer-policy') === 'no-referrer');
    check(
      'and none of the app’s own headers (which would forbid framing it)',
      !live.headers.get('x-frame-options') && !live.headers.get('cross-origin-opener-policy'),
      [...live.headers.keys()],
    );
    check('and the banner says whose page it is', html.includes('Agent-built preview on Posterity') && html.includes(slug));
    const js = await fetch(`${PREVIEW_ORIGIN}/${dist.data.id}/main.js`);
    check('assets get their content type', js.status === 200 && js.headers.get('content-type')?.startsWith('text/javascript'), js.headers.get('content-type'));
    const noBanner = (await js.text()).includes('posterity-preview-banner');
    check('and no banner', !noBanner);
    const fallback = await fetch(`${PREVIEW_ORIGIN}/${dist.data.id}/settings/profile`);
    check('the single-page fallback works', fallback.status === 200 && (await fallback.text()).includes('id="root"'));
    const slash = await fetch(`${PREVIEW_ORIGIN}/${dist.data.id}`, { redirect: 'manual' });
    check('a folder without its slash redirects to it', slash.status === 308 && slash.headers.get('location')?.endsWith(`/${dist.data.id}/`), slash.headers.get('location'));
    const png2 = await fetch(`${PREVIEW_ORIGIN}/${crPreview.data.id}/img/logo.png`);
    check('an image', png2.status === 200 && png2.headers.get('content-type') === 'image/png');
    const revokedLive = await fetch(`${PREVIEW_ORIGIN}/${p1.id}/`);
    check('a revoked preview is a 404 here too', revokedLive.status === 404, revokedLive.status);
    const app = await fetch(`${PREVIEW_ORIGIN}/home`);
    check('the app itself is not served on the preview origin', app.status === 404, app.status);
    const asset = await fetch(`${PREVIEW_ORIGIN}/favicon.ico`);
    check('nor its static files', asset.status === 404, asset.status);
    const pvOnPreview = await fetch(`${PREVIEW_ORIGIN}/pv/${dist.data.id}/`);
    check('nor /pv directly', pvOnPreview.status === 404, pvOnPreview.status);
  }
  if (SITE_ORIGIN) {
    section(`Through the app (${SITE_ORIGIN})`);
    const direct = await fetch(`${SITE_ORIGIN}/pv/${dist.data.id}/`);
    check('previews are not served from the app’s own origin', direct.status === 404, direct.status);
    const build = await fetch(`${SITE_ORIGIN}/build`);
    const buildHtml = await build.text();
    check('/build lists the workspace', build.status === 200 && buildHtml.includes('E2E Preview Lab'), build.status);
    const page = await fetch(`${SITE_ORIGIN}/build/${slug}`);
    const pageHtml = await page.text();
    check('the workspace page shows its files', page.status === 200 && pageHtml.includes('index.html') && pageHtml.includes('docs'), page.status);
    const file = await fetch(`${SITE_ORIGIN}/build/${slug}/files/app.js`);
    check('a file page is highlighted', file.status === 200 && (await file.text()).includes('hljs-'), file.status);
    const changes = await fetch(`${SITE_ORIGIN}/build/${slug}/changes/${cr.data?.number}`);
    const changesHtml = await changes.text();
    check('the change request shows its diff', changes.status === 200 && changesHtml.includes('A feature') && changesHtml.includes('Feature'), changes.status);
    const previews = await fetch(`${SITE_ORIGIN}/build/${slug}/previews`);
    const previewsHtml = await previews.text();
    check('the previews page frames one in a sandbox', previews.status === 200 && /<iframe[^>]*sandbox="allow-scripts allow-forms allow-popups allow-modals"/.test(previewsHtml), previews.status);
    const framed = /<iframe[^>]*src="([^"]+)"/.exec(previewsHtml)?.[1] ?? '';
    check('whose address is on the preview origin', Boolean(PREVIEW_ORIGIN) && framed.startsWith(`${PREVIEW_ORIGIN}/`), framed);
    const csp = page.headers.get('content-security-policy') ?? '';
    check('and the app’s policy lets only that origin be framed', Boolean(PREVIEW_ORIGIN) && csp.includes(`frame-src ${PREVIEW_ORIGIN}`), csp);
  }
}

const stage = process.argv[2] ?? 'setup';
await (stage === 'publish' ? stage2() : stage1());

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
