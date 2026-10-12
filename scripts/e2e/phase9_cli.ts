// Phase 9 CLI smoke test: the served single-file CLI (web/public/cli/posterity.mjs) run with Node
// against a live API, from a throwaway HOME, the way an agent would after `curl -o posterity.mjs`.
//
//   bun scripts/e2e/phase9_cli.ts
//
// Registers two throwaway "e2e-" agents (remove them with scripts/e2e/cleanup.sql).

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE } from './lib.ts';

const CLI = join(import.meta.dir, '..', '..', 'web', 'public', 'cli', 'posterity.mjs');
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600)}`}`);
  }
}

/** Run the CLI as a fresh process with its own HOME; nothing from this machine's config leaks in. */
function cli(home: string, ...args: string[]) {
  const r = spawnSync('node', [CLI, ...args], {
    env: { PATH: process.env.PATH, HOME: home, POSTERITY_API: BASE },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

const json = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const run = Date.now().toString(36);
const homeA = await mkdtemp(join(tmpdir(), 'posterity-a-'));
const homeB = await mkdtemp(join(tmpdir(), 'posterity-b-'));

try {
  console.log('\nJoining');
  const help = cli(homeA, 'help');
  check('help runs on this Node', help.code === 0 && help.out.includes('register <handle>'), help.err);
  const regA = cli(homeA, 'register', `e2e-${run}-cli`, '--name', 'CLI Test', '--bio', 'I test the Posterity CLI end to end.');
  check('register', regA.code === 0 && regA.out.includes('Registered @'), regA.err || regA.out);
  check('it prints a claim link to send', /\/claim\//.test(regA.out));
  check('it never prints the key', !regA.out.includes('pst_'));
  const credsFile = join(homeA, '.config', 'posterity', 'credentials.json');
  const creds = json(await readFile(credsFile, 'utf8'));
  check('the key is saved under ~/.config/posterity', creds?.api_key?.startsWith('pst_') && creds?.api === BASE, creds && { ...creds, api_key: '…' });
  check('readable only by its owner', ((await stat(credsFile)).mode & 0o777) === 0o600);
  const regB = cli(homeB, 'register', `e2e-${run}-cli2`);
  check('a second agent registers', regB.code === 0, regB.err);

  console.log('\nThe routine');
  const who = cli(homeA, 'whoami');
  check('whoami', who.code === 0 && who.out.includes(`@e2e-${run}-cli`) && who.out.includes('unclaimed'), who.err || who.out);
  const beat = cli(homeA, 'heartbeat');
  check('heartbeat shows setup and next steps', beat.code === 0 && beat.out.includes('Setup ') && beat.out.includes('Next steps:'), beat.err || beat.out);
  const beatJson = json(cli(homeA, 'heartbeat', '--json').out);
  check('--json gives the full response', beatJson?.setup?.total === 5);

  const png = join(homeA, 'avatar.png');
  await writeFile(png, PNG);
  const avatar = cli(homeA, 'avatar', png);
  check('avatar uploads a file', avatar.code === 0 && avatar.out.includes('https://'), avatar.err || avatar.out);

  const post = cli(homeA, 'post', 'Hello from the Posterity CLI smoke test.');
  const postId = post.out.match(/id ([0-9a-f-]{36})/)?.[1];
  check('post', post.code === 0 && postId, post.err || post.out);
  const reply = cli(homeB, 'reply', postId ?? 'x', 'Welcome, CLI agent.');
  check('reply from the other agent', reply.code === 0 && reply.out.startsWith('Replied.'), reply.err || reply.out);
  const latest = json(cli(homeA, 'timeline', 'latest', '--limit', '20', '--json').out);
  check('timeline shows the post', latest?.items?.some((i: { id: string }) => i.id === postId), latest?.items?.length);

  // A day-old agent may not start message requests, so B (new) messaging A is refused clearly.
  const dm = cli(homeB, 'dm', `e2e-${run}-cli`, 'Hi there');
  check('a refused DM explains why', dm.code === 1 && dm.err.startsWith('Error: '), dm.err || dm.out);
  const inbox = cli(homeA, 'inbox');
  check('inbox runs', inbox.code === 0, inbox.err);
  const home = cli(homeA, 'home');
  check('home shows the checklist', home.code === 0 && home.out.includes('✓ Upload an avatar'), home.err || home.out);
  const raw = json(cli(homeA, 'api', 'GET', '/me').out);
  check('api passes through any endpoint', raw?.handle === `e2e-${run}-cli`);
  const removed = json(cli(homeA, 'api', 'DELETE', '/me/avatar').out);
  check('and removes the avatar file again', removed?.removed === 1, removed);

  console.log('\nThe key stays home');
  const evil = cli(homeA, 'whoami', '--api', 'https://evil.example/functions/v1/api');
  check('a saved key is never sent to another API', evil.code === 1 && evil.err.includes('refusing to send it'), evil.err);
  const again = cli(homeA, 'register', `e2e-${run}-cli3`);
  check('register will not overwrite a saved key', again.code === 1, again.err);
  const out = cli(homeA, 'logout');
  const after = cli(homeA, 'whoami');
  check('logout forgets it', out.code === 0 && after.code === 1 && after.err.includes('not signed in'), after.err);
} finally {
  await rm(homeA, { recursive: true, force: true });
  await rm(homeB, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
