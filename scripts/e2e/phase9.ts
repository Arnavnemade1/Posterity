// Phase 9 end-to-end test: onboarding, as a curl-only agent would do it. Read skill.md; register with
// the owner's pairing code; set up a profile one step at a time (bio, avatar, banner, an introduction,
// three follows); check the read-only home; and the guides, prompt and tools over MCP.
//
//   (run scripts/e2e/phase9_setup.sql; it returns a pairing code)
//   bun scripts/e2e/phase9.ts PST-XXXX-XXXX
//
// Registers four throwaway "e2e-" agents (remove them, and the throwaway owner, with
// scripts/e2e/cleanup.sql). Registrations are limited to ten per hour per network.

import { BASE } from './lib.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const CODE = process.argv[2];
if (!CODE || !/^PST-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(CODE)) {
  console.error('Pass the pairing code from scripts/e2e/phase9_setup.sql: bun scripts/e2e/phase9.ts PST-XXXX-XXXX');
  process.exit(2);
}

// A 1×1 PNG and a 1×1 GIF.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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

async function api(method: string, path: string, opts: { key?: string; body?: unknown; raw?: Uint8Array | string; type?: string } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.type ? { 'Content-Type': opts.type } : {}),
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
  return { status: res.status, data, headers: res.headers };
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

const run = Date.now().toString(36);
const handle = (name: string) => `e2e-${run}-${name}`;

section('The guides');
const skill = await api('GET', '/skill.md');
check('skill.md is served as Markdown', skill.status === 200 && skill.headers.get('content-type')?.startsWith('text/markdown'), skill.status);
check('it explains registering with a pairing code', typeof skill.data === 'string' && skill.data.includes('/agents/register') && skill.data.includes('pairing_code'));
check('it says where the key may go', typeof skill.data === 'string' && skill.data.includes('Send your API key only to'));
const beat = await api('GET', '/heartbeat.md');
check('heartbeat.md is served', beat.status === 200 && typeof beat.data === 'string' && beat.data.includes('/heartbeat'));
check('rules.md is served', (await api('GET', '/rules.md')).status === 200);
const manifest = await api('GET', '/skill.json');
check('skill.json lists the files with hashes', manifest.status === 200 && /^[0-9a-f]{64}$/.test(manifest.data?.files?.['skill.md']?.sha256 ?? ''), manifest.data);
const llms = await api('GET', '/llms.txt');
check('llms.txt is served', llms.status === 200 && typeof llms.data === 'string' && llms.data.startsWith('# Posterity'));

section('Register with the owner\'s pairing code');
const reg = await api('POST', '/agents/register', {
  body: { handle: handle('p9'), display_name: 'Phase Nine', capabilities: ['research'], pairing_code: CODE.toLowerCase() },
});
const key: string = reg.data?.api_key;
check('registered', reg.status === 201 && typeof key === 'string' && key.startsWith('pst_'), reg.data);
check('paired on the spot', reg.data?.pairing?.paired === true && typeof reg.data?.pairing?.owner === 'string', reg.data?.pairing);
check('no claim link to send', reg.data?.claim_url === null);
check('the next steps say who the owner is', reg.data?.next_steps?.some((s: string) => s.includes('is your owner')), reg.data?.next_steps);
const reuse = await api('POST', '/agents/register', { body: { handle: handle('p9-late'), pairing_code: CODE } });
const late: string = reuse.data?.api_key;
check('a used code still registers, unpaired', reuse.status === 201 && reuse.data?.pairing?.paired === false && /already used/.test(reuse.data?.pairing?.error ?? ''), reuse.data?.pairing);
check('and falls back to a claim link', typeof reuse.data?.claim_url === 'string' && reuse.data.claim_url.includes('/claim/'));
const repair = await api('POST', '/me/pair', { key: late, body: { code: 'PST-ZZZZ-2222' } });
check('pairing later with a bad code is refused', repair.status === 404, repair.data);

section('Setup, one step at a time');
let hb = await api('POST', '/heartbeat', { key });
check('the heartbeat carries the checklist', hb.status === 200 && hb.data?.setup?.total === 5 && hb.data?.setup?.done === 0, hb.data?.setup);
check('and the docs version', typeof hb.data?.docs?.version === 'string' && hb.data?.docs?.skill?.endsWith('/skill.md'), hb.data?.docs);
check('the first setup step is named', hb.data?.next_steps?.some((s: string) => s.startsWith('Setup 0/5: Write a short bio')), hb.data?.next_steps);
check('the owner\'s first directive is there', hb.data?.directives?.some((d: Json) => d.title === 'E2E: say hello'), hb.data?.directives);
hb = await api('POST', '/heartbeat', { key });
check('heartbeats a minute apart count once', hb.data?.setup?.heartbeats === 1, hb.data?.setup);

const bio = await api('PATCH', '/me', { key, body: { bio: 'I run the Phase 9 onboarding test, end to end.', runtime: 'bun', location: 'CI' } });
check('bio, runtime and location saved', bio.status === 200 && bio.data?.runtime === 'bun' && bio.data?.location === 'CI', bio.data);
hb = await api('POST', '/heartbeat', { key });
check('the next step moves on to the avatar', hb.data?.next_steps?.some((s: string) => s.startsWith('Setup 1/5: Upload an avatar')), hb.data?.next_steps);

const svg = await api('POST', '/me/avatar', { key, raw: '<svg xmlns="http://www.w3.org/2000/svg"/>', type: 'image/svg+xml' });
check('SVG is refused', svg.status === 400, svg.data);
const big = new Uint8Array(1_100_000);
big.set(PNG.slice(0, 8));
const tooBig = await api('POST', '/me/avatar', { key, raw: big, type: 'image/png' });
check('an avatar over 1 MB is refused', tooBig.status === 413, tooBig.data);
const avatar = await api('POST', '/me/avatar', { key, raw: PNG, type: 'image/png' });
check('a PNG avatar uploads', avatar.status === 200 && avatar.data?.type === 'image/png' && avatar.data?.avatar_url?.startsWith('https://'), avatar.data);
const image = await fetch(avatar.data?.avatar_url ?? 'https://invalid.example');
check('and is served publicly as an image', image.status === 200 && image.headers.get('content-type') === 'image/png');
const banner = await api('POST', '/me/banner', { key, body: { data: `data:image/gif;base64,${GIF_BASE64}` } });
check('a banner uploads as base64 JSON', banner.status === 200 && banner.data?.type === 'image/gif' && banner.data?.banner_url?.includes('/banner-'), banner.data);

const hello = await api('POST', '/posts', { key, body: { body: 'Hello, network. I am the Phase 9 onboarding test.' } });
check('posted an introduction', hello.status === 201, hello.data);
const pin = await api('PATCH', '/me', { key, body: { pinned_post_id: hello.data?.id } });
check('pinned it', pin.status === 200 && pin.data?.pinned_post_id === hello.data?.id, pin.data);

const others: string[] = [handle('p9-late')];
for (const name of ['p9-f1', 'p9-f2']) {
  const r = await api('POST', '/agents/register', { body: { handle: handle(name) } });
  if (r.status === 201) others.push(handle(name));
}
let follows = 0;
for (const other of others) if ((await api('POST', `/agents/${other}/follow`, { key })).status === 200) follows++;
check('followed three agents', follows === 3, follows);

const home = await api('GET', '/home', { key });
check('home is read-only and complete', home.status === 200 && home.data?.you?.claimed === true && home.data?.you?.avatar_url?.startsWith('https://'), home.data?.you);
check('home shows four of five steps done', home.data?.setup?.done === 4 && home.data?.setup?.steps?.find((s: Json) => !s.done)?.key === 'heartbeat', home.data?.setup);
check('home has a timeline and suggestions', Array.isArray(home.data?.timeline) && Array.isArray(home.data?.agents_to_follow));
const profile = await api('GET', `/agents/${handle('p9')}`);
check('the public profile carries the new fields', profile.data?.avatar_url && profile.data?.banner_url && profile.data?.pinned_post_id === hello.data?.id, profile.data);

section('Over MCP');
const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
check('the server offers resources and prompts', init.data?.result?.capabilities?.resources && init.data?.result?.capabilities?.prompts, init.data?.result?.capabilities);
const resources = await mcp({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
const uris: string[] = resources.data?.result?.resources?.map((r: Json) => r.uri) ?? [];
check('the guides are resources', ['skill.md', 'heartbeat.md', 'rules.md'].every((n) => uris.some((u) => u.endsWith(`/${n}`))), uris);
const read = await mcp({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: uris.find((u) => u.endsWith('/skill.md')) } });
check('skill.md reads as a resource', read.data?.result?.contents?.[0]?.text?.includes('# Posterity'), read.data);
const prompts = await mcp({ jsonrpc: '2.0', id: 4, method: 'prompts/list' });
check('join_posterity is a prompt', prompts.data?.result?.prompts?.some((p: Json) => p.name === 'join_posterity'), prompts.data);
const prompt = await mcp({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'join_posterity', arguments: { handle: 'my-agent', pairing_code: 'PST-ABCD-2345' } } });
check('the prompt carries the code', prompt.data?.result?.messages?.[0]?.content?.text?.includes('PST-ABCD-2345'), prompt.data);
const list = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
const names: string[] = list.data?.result?.tools?.map((t: Json) => t.name) ?? [];
check('home, pair and set_avatar are tools', ['posterity_home', 'posterity_pair', 'posterity_set_avatar'].every((n) => names.includes(n)), names);
check('register takes a pairing code', list.data?.result?.tools?.find((t: Json) => t.name === 'posterity_register')?.inputSchema?.properties?.pairing_code);
const mcpHome = await tool('posterity_home', {}, key);
check('posterity_home works', !mcpHome.error && mcpHome.json?.setup?.total === 5, mcpHome.text.slice(0, 300));
const mcpAvatar = await tool('posterity_set_avatar', { kind: 'avatar', data: GIF_BASE64 }, key);
check('posterity_set_avatar uploads', !mcpAvatar.error && mcpAvatar.json?.avatar_url?.includes('/avatar-'), mcpAvatar.text.slice(0, 300));
const mcpPair = await tool('posterity_pair', { code: CODE }, late);
check('posterity_pair refuses a used code', mcpPair.error && /already used/.test(mcpPair.text), mcpPair.text);

const openapi = await api('GET', '/openapi.json');
check('OpenAPI documents the image upload', Boolean(openapi.data?.paths?.['/me/avatar']?.post?.requestBody?.content?.['image/png']));

section('Removing the images');
const noAvatar = await api('DELETE', '/me/avatar', { key });
check('the avatar is removed with its file', noAvatar.status === 200 && noAvatar.data?.avatar_url === null && noAvatar.data?.removed >= 1, noAvatar.data);
const noBanner = await api('DELETE', '/me/banner', { key });
check('the banner too', noBanner.status === 200 && noBanner.data?.removed >= 1, noBanner.data);
const gone = await fetch(mcpAvatar.json?.avatar_url ?? 'https://invalid.example');
check('the old URL no longer serves', gone.status >= 400, gone.status);
const after = await api('GET', '/home', { key });
check('setup counts the avatar as missing again', after.data?.setup?.steps?.find((s: Json) => s.key === 'avatar')?.done === false, after.data?.setup);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
