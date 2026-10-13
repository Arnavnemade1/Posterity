// Phase 10 CLI test: the served single-file CLI (web/public/cli/posterity.mjs) working a real workspace
// like git. Clone, edit, push; a second clone pushes first, so the stale push is refused; pull keeps
// both sides of the conflict; resolve; push; open a change request from a branch.
//
//   POSTERITY_API=<a deployment> bun scripts/e2e/phase10_cli.ts
//
// Registers two throwaway "e2e-" agents (scripts/e2e/cleanup.sql removes them and their workspace).

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE } from './lib.ts';

const CLI = join(import.meta.dir, '..', '..', 'web', 'public', 'cli', 'posterity.mjs');

let passed = 0;
const failures: string[] = [];
function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 800)}`}`);
  }
}

const run = Date.now().toString(36);
const home = await mkdtemp(join(tmpdir(), 'posterity-e2e-'));

async function register(name: string) {
  const res = await fetch(`${BASE}/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: `e2e-${run}-${name}`, capabilities: ['code'] }),
  });
  const data = await res.json();
  if (res.status !== 201) throw new Error(`registration failed: ${JSON.stringify(data)}`);
  return data.api_key as string;
}

function cli(key: string, cwd: string, ...args: string[]) {
  const res = spawnSync('node', [CLI, ...args], {
    cwd,
    env: { ...process.env, POSTERITY_API: BASE, POSTERITY_KEY: key, POSTERITY_CONFIG_DIR: join(home, 'config') },
    encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout.trim(), err: res.stderr.trim() };
}

try {
  const lead = await register('cli-lead');
  const mate = await register('cli-mate');
  const slug = `e2e-${run}-cli`;

  console.log('\nTwo clones of one workspace');
  const created = cli(lead, home, 'ws', 'create', 'E2E CLI', '--slug', slug);
  check('ws create', created.code === 0 && created.out.includes(slug), created.err || created.out);
  // The second agent writes to main too, so make it a writer.
  const add = await fetch(`${BASE}/workspaces/${slug}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lead}` },
    body: JSON.stringify({ handle: `e2e-${run}-cli-mate`, role: 'writer' }),
  });
  check('a writer added', add.status === 200);

  const a = join(home, 'a');
  const b = join(home, 'b');
  check('ws clone (lead)', cli(lead, home, 'ws', 'clone', slug, 'a').code === 0);
  await writeFile(join(a, 'app.js'), 'console.log("v1");\n');
  await writeFile(join(a, 'README.md'), '# CLI\n');
  const pushed = cli(lead, a, 'ws', 'push', '-m', 'First files');
  check('ws push', pushed.code === 0 && pushed.out.includes('Pushed 2 change(s)'), pushed.err || pushed.out);

  check('ws clone (mate)', cli(mate, home, 'ws', 'clone', slug, 'b').code === 0);
  check('the second clone has the files', (await readFile(join(b, 'app.js'), 'utf8')) === 'console.log("v1");\n');

  console.log('\nA stale push, a pull with a conflict, a resolution');
  await writeFile(join(b, 'app.js'), 'console.log("mate");\n');
  check('the mate pushes first', cli(mate, b, 'ws', 'push', '-m', 'Mate edit').code === 0);
  await writeFile(join(a, 'app.js'), 'console.log("lead");\n');
  const stale = cli(lead, a, 'ws', 'push', '-m', 'Lead edit');
  check('the lead\'s stale push is refused', stale.code === 1 && stale.err.includes('Someone pushed'), stale.err);
  const status = cli(lead, a, 'ws', 'status');
  check('ws status shows the edit', status.out.includes('M app.js'), status.out);
  const diff = cli(lead, a, 'ws', 'diff');
  check('ws diff shows the line', diff.out.includes('+ console.log("lead");'), diff.out);
  const pulled = cli(lead, a, 'ws', 'pull');
  check('ws pull reports the conflict', pulled.code === 0 && pulled.out.includes('C app.js'), pulled.out);
  check('keeping the lead\'s version', (await readFile(join(a, 'app.js'), 'utf8')) === 'console.log("lead");\n');
  check('with theirs beside it', (await readFile(join(a, 'app.js.theirs'), 'utf8')) === 'console.log("mate");\n');
  await writeFile(join(a, 'app.js'), 'console.log("lead and mate");\n');
  await rm(join(a, 'app.js.theirs'));
  const resolved = cli(lead, a, 'ws', 'push', '-m', 'Resolve app.js');
  check('the resolution pushes on top', resolved.code === 0, resolved.err || resolved.out);
  check('the mate pulls it', cli(mate, b, 'ws', 'pull').code === 0 && (await readFile(join(b, 'app.js'), 'utf8')) === 'console.log("lead and mate");\n');

  console.log('\nA branch and a change request');
  const branch = cli(mate, b, 'ws', 'branch', `e2e-${run}-cli-mate/feature`);
  check('ws branch creates and switches', branch.code === 0 && branch.out.includes('switched'), branch.err || branch.out);
  await writeFile(join(b, 'feature.js'), 'export const feature = true;\n');
  check('push to the branch', cli(mate, b, 'ws', 'push', '-m', 'Feature').code === 0);
  const opened = cli(mate, b, 'ws', 'cr', 'open', '--title', 'Add the feature');
  check('ws cr open', opened.code === 0 && opened.out.includes('Opened #1'), opened.err || opened.out);
  const view = cli(lead, a, 'ws', 'cr', 'view', '1', '--patch');
  check('ws cr view shows the diff', view.code === 0 && view.out.includes('A feature.js') && view.out.includes('+export const feature = true;'), view.out);
  const review = cli(lead, a, 'ws', 'cr', 'review', '1', 'approve', 'Ship', 'it.');
  check('ws cr review', review.code === 0 && review.out.includes('approve'), review.err || review.out);
  const merged = cli(lead, a, 'ws', 'cr', 'merge', '1');
  check('ws cr merge', merged.code === 0 && merged.out.includes('Merged #1'), merged.err || merged.out);
  const log = cli(lead, a, 'ws', 'log');
  check('ws log', log.code === 0 && log.out.includes('Resolve app.js'), log.out);
  check('ws pull brings the merged feature', cli(lead, a, 'ws', 'pull').code === 0 && (await readFile(join(a, 'feature.js'), 'utf8')).includes('feature = true'));
} finally {
  await rm(home, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
