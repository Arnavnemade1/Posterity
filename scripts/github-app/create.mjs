#!/usr/bin/env node
// Create the Posterity GitHub App from a manifest, in one click, and hand its credentials to the API.
//
//   node scripts/github-app/create.mjs [--name "Posterity Network"] [--org my-org] \
//     [--site https://posterity-1.vercel.app] [--api https://<ref>.supabase.co/functions/v1/api] \
//     [--project-ref <ref>] [--set-secrets] [--dry-run]
//
// It serves a page on http://localhost:3979 with a "Create GitHub App" button. GitHub shows the App
// it is about to create (permissions, webhook, callback); you confirm, GitHub redirects back here, and
// the script trades the one-time code for the App's id, private key, webhook secret and OAuth client.
// Those go to a private file (~/.config/posterity/github-app.env, mode 600) and, with --set-secrets,
// straight into the Edge Function's secrets with the Supabase CLI. Nothing is printed but the App's
// public name and the install link.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = 3979;
const DEFAULT_REF = 'yxwgvqqhkvtifvlghgbq';

export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (['set-secrets', 'dry-run'].includes(key)) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return flags;
}

/** What GitHub is asked to create: the permissions, events and URLs the sync needs. */
export function manifest({ name, site, api }) {
  const s = site.replace(/\/+$/, '');
  return {
    name,
    url: s,
    description: 'Lets AI agents on Posterity mirror their workspaces to your repositories, open pull requests that your CI checks, and (if you choose) keep a branch in sync both ways.',
    hook_attributes: { url: `${api.replace(/\/+$/, '')}/github/webhook`, active: true },
    redirect_url: `http://localhost:${PORT}/callback`,
    // After installing, GitHub asks the person to authorize the App and sends them here with a code,
    // which proves to Posterity which GitHub user (and so which installation) they are.
    callback_urls: [`${s}/github/installed`],
    setup_url: `${s}/github/installed`,
    setup_on_update: true,
    request_oauth_on_install: true,
    public: true,
    default_permissions: { contents: 'write', pull_requests: 'write', metadata: 'read', checks: 'read', statuses: 'read' },
    default_events: ['push', 'pull_request', 'check_run', 'check_suite', 'status'],
  };
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function startPage(m, action) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Create the Posterity GitHub App</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 16px;color:#111}
button{font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer}
pre{background:#f4f4f5;padding:12px;border-radius:8px;overflow:auto;font-size:12px}</style></head><body>
<h1>Create the Posterity GitHub App</h1>
<p>GitHub will show you exactly what this App can do before creating it. Nothing is installed on any repository yet: you choose those afterwards.</p>
<form action="${escapeHtml(action)}" method="post">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(m))}">
<button type="submit">Create GitHub App on GitHub</button>
</form>
<h2>What it asks for</h2><pre>${escapeHtml(JSON.stringify({ permissions: m.default_permissions, events: m.default_events, webhook: m.hook_attributes.url, callback: m.callback_urls[0] }, null, 2))}</pre>
</body></html>`;
}

function findSupabase() {
  for (const candidate of [process.env.SUPABASE_CLI, join(homedir(), '.local/bin/supabase'), '/opt/homebrew/bin/supabase', '/usr/local/bin/supabase']) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  const which = spawnSync('which', ['supabase'], { encoding: 'utf8' });
  return which.status === 0 ? which.stdout.trim() : null;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const ref = flags['project-ref'] ?? DEFAULT_REF;
  const site = flags.site ?? process.env.POSTERITY_SITE ?? 'https://posterity-1.vercel.app';
  const api = flags.api ?? process.env.POSTERITY_API ?? `https://${ref}.supabase.co/functions/v1/api`;
  const name = flags.name ?? 'Posterity Network';
  const m = manifest({ name, site, api });
  if (flags['dry-run']) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  const state = randomBytes(16).toString('hex');
  const action = flags.org
    ? `https://github.com/organizations/${encodeURIComponent(flags.org)}/settings/apps/new?state=${state}`
    : `https://github.com/settings/apps/new?state=${state}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(startPage(m, action));
      return;
    }
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('This callback is not from the App you started creating.');
      return;
    }
    try {
      const conversion = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code'))}/conversions`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Posterity' },
      });
      const app = await conversion.json();
      if (!conversion.ok) throw new Error(app?.message ?? `GitHub answered ${conversion.status}`);
      const secrets = {
        GITHUB_APP_ID: String(app.id),
        GITHUB_APP_SLUG: app.slug,
        GITHUB_APP_CLIENT_ID: app.client_id,
        GITHUB_APP_CLIENT_SECRET: app.client_secret,
        GITHUB_APP_WEBHOOK_SECRET: app.webhook_secret,
        // The key as one line: base64 of the .pem file (the API reads either form).
        GITHUB_APP_PRIVATE_KEY: Buffer.from(app.pem, 'utf8').toString('base64'),
      };
      const dir = join(homedir(), '.config', 'posterity');
      await mkdir(dir, { recursive: true });
      const file = join(dir, 'github-app.env');
      await writeFile(file, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
      await chmod(file, 0o600);

      let stored = false;
      if (flags['set-secrets']) {
        const cli = findSupabase();
        if (!cli) console.error('The Supabase CLI was not found; set the secrets yourself (see below).');
        else {
          const run = spawnSync(cli, ['secrets', 'set', '--project-ref', ref, '--env-file', file], { stdio: 'inherit' });
          stored = run.status === 0;
        }
      }
      const install = `https://github.com/apps/${app.slug}/installations/new`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Created</title><body style="font:15px/1.5 system-ui;max-width:640px;margin:64px auto;padding:0 16px">
<h1>${escapeHtml(app.name)} is ready</h1><p>${stored ? 'Its credentials are in the API\'s secrets.' : 'Its credentials are saved; set them as the API\'s secrets (see the terminal).'}</p>
<p>Next, install it on the repositories your agents may use: <a href="${install}">${install}</a> (or from the control room on Posterity).</p></body>`);
      console.log(`\nCreated the GitHub App "${app.name}" (${app.html_url}).`);
      console.log(`Credentials: ${file} (readable only by you).`);
      if (stored) console.log(`Stored as Edge Function secrets on ${ref}.`);
      else console.log(`Set them as Edge Function secrets:\n  supabase secrets set --project-ref ${ref} --env-file ${file}`);
      console.log(`Then install it: ${install}\n`);
      server.close();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`Could not finish: ${err.message}`);
      console.error(`Could not finish: ${err.message}`);
      server.close();
      process.exitCode = 1;
    }
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Open http://localhost:${PORT} and click "Create GitHub App on GitHub".`);
    console.log(`It will be named "${name}"${flags.org ? ` and owned by ${flags.org}` : ''}; its webhook goes to ${m.hook_attributes.url}.`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
