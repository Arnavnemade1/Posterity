// The Posterity GitHub App, as the API serves it:
//   GET  /github/app       whether the App is set up, and where to install it
//   POST /github/webhook   GitHub's deliveries: installations, pushes, pull requests, check runs, statuses
//   POST /github/claim     the web app, for a signed-in person, after GitHub's install redirect: proves
//                          (with GitHub's user authorization code) that they administer the installation
// and, for agents, the workspace links and imports (posterity_github; /workspaces/{ws}/github,
// /workspaces/import, /github/repos).
import { db, query, rpc } from '../lib/db.ts';
import {
  appConfigured,
  exchangeOAuthCode,
  GitHub,
  GitHubError,
  githubConfig,
  installationClient,
  parseRepo,
  verifySignature,
} from '../lib/github.ts';
import { ApiError, json } from '../lib/http.ts';
import { bool, type Input, oneOf, str } from '../lib/validate.ts';
import { type Ctx, gate, limit, requireAgent } from './context.ts';
import { kickSync } from './github_sync.ts';
import { moveQueues } from './workspaces.ts';
import { resolveMissionId } from './missions.ts';
import { resolveOrgId } from './orgs.ts';

const DELIVERY_MAX = 25_000_000;

export const APP_EVENTS = ['push', 'pull_request', 'check_run', 'check_suite', 'status'] as const;

function notConfigured(): ApiError {
  return new ApiError(503, 'github_not_configured', 'The Posterity GitHub App is not set up on this deployment yet',
    'Its operator creates it with scripts/github-app/create.mjs.');
}

function installUrl(): string | null {
  const c = githubConfig();
  return c.slug ? `${c.web}/apps/${c.slug}/installations/new` : null;
}

/** GET /github/app */
export function appInfo() {
  const c = githubConfig();
  return {
    configured: appConfigured(c) && Boolean(c.webhookSecret),
    slug: c.slug,
    install_url: installUrl(),
    client_id: c.clientId,
    events: APP_EVENTS,
    permissions: { contents: 'write', pull_requests: 'write', metadata: 'read', checks: 'read', statuses: 'read' },
  };
}

// ----------------------------------------------------------------------------- webhooks

// deno-lint-ignore no-explicit-any
type Payload = Record<string, any>;

const text = (value: unknown, max: number) => (typeof value === 'string' && value ? value.slice(0, max) : null);

/** A check run's state as a Posterity check status. */
export function checkStatus(status: string, conclusion: string | null): 'queued' | 'running' | 'passed' | 'failed' | 'neutral' {
  if (status === 'queued' || status === 'requested' || status === 'waiting' || status === 'pending') return 'queued';
  if (status !== 'completed') return 'running';
  if (conclusion === 'success') return 'passed';
  if (conclusion && ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(conclusion)) return 'failed';
  return 'neutral';
}

/** A commit status (the older API) as a Posterity check status. */
export function statusState(state: string): 'running' | 'passed' | 'failed' {
  return state === 'success' ? 'passed' : state === 'pending' ? 'running' : 'failed';
}

const repoList = (list: unknown) =>
  Array.isArray(list)
    ? list.map((r: Payload) => ({ id: r.id, full_name: r.full_name, private: r.private, default_branch: r.default_branch ?? null }))
    : null;

/** What one delivery does. Exported for tests: the signature check is in handleAppWebhook. */
export async function handleDelivery(event: string, p: Payload): Promise<Record<string, unknown>> {
  const repoId = typeof p.repository?.id === 'number' ? p.repository.id : null;
  switch (event) {
    case 'ping':
      return { pong: true };
    case 'installation': {
      const action = String(p.action ?? '');
      if (!['created', 'deleted', 'suspend', 'unsuspend', 'new_permissions_accepted'].includes(action)) return { ignored: action };
      await rpc('gh_sync_installation', {
        p_installation: p.installation,
        p_repos: action === 'created' ? repoList(p.repositories) : null,
        p_repos_mode: 'replace',
        p_action: action,
      });
      return { installation: p.installation?.id, action };
    }
    case 'installation_repositories': {
      const added = repoList(p.repositories_added);
      const removed = repoList(p.repositories_removed);
      if (added?.length) await rpc('gh_sync_installation', { p_installation: p.installation, p_repos: added, p_repos_mode: 'add', p_action: null });
      if (removed?.length) await rpc('gh_sync_installation', { p_installation: p.installation, p_repos: removed, p_repos_mode: 'remove', p_action: null });
      return { installation: p.installation?.id, added: added?.length ?? 0, removed: removed?.length ?? 0 };
    }
    case 'push': {
      if (!repoId || p.deleted) return { ignored: 'push' };
      const remote = await query<{ workspace_id: string; mode: string; remote_default_branch: string; status: string } | null>(
        db().from('workspace_remotes').select('workspace_id, mode, remote_default_branch, status').eq('repo_id', repoId).maybeSingle(),
      );
      if (!remote || remote.mode !== 'two_way' || p.ref !== `refs/heads/${remote.remote_default_branch}`) return { ignored: 'not a synced branch' };
      if (!['active', 'diverged'].includes(remote.status)) return { ignored: `link is ${remote.status}` };
      const known = await query(db().from('commit_mirrors').select('commit_id').eq('repo_id', repoId).eq('git_sha', String(p.after)).maybeSingle());
      if (known) return { ignored: 'Posterity made this push' };
      await rpc('gh_enqueue', { p_ws: remote.workspace_id, p_kind: 'pull', p_branch: null, p_cr: null, p_payload: {}, p_delay_seconds: 0 });
      return { queued: 'pull' };
    }
    case 'pull_request': {
      const pr = p.pull_request;
      if (!repoId || !pr) return { ignored: 'pull_request' };
      const state = p.action === 'closed' ? (pr.merged ? 'merged' : 'closed') : p.action === 'reopened' ? 'open' : null;
      if (!state) return { ignored: p.action };
      const changed = await rpc<number>('gh_pr_event', { p_repo: repoId, p_number: pr.number, p_state: state, p_actor: text(p.sender?.login, 100) });
      return { pull_request: pr.number, state, changed };
    }
    case 'check_run': {
      const run = p.check_run;
      if (!repoId || !run?.head_sha) return { ignored: 'check_run' };
      const n = await rpc<number>('gh_record_check', {
        p_repo: repoId,
        p_sha: run.head_sha,
        p_name: text(run.name, 90) ?? 'check',
        p_status: checkStatus(String(run.status ?? ''), run.conclusion ?? null),
        p_details: text(run.output?.title ?? run.output?.summary, 1000),
        p_url: text(run.html_url ?? run.details_url, 500),
      });
      if (n) await moveRepoQueues(repoId);
      return { checks: n };
    }
    case 'status': {
      if (!repoId || !p.sha) return { ignored: 'status' };
      const n = await rpc<number>('gh_record_check', {
        p_repo: repoId,
        p_sha: p.sha,
        p_name: text(p.context, 90) ?? 'status',
        p_status: statusState(String(p.state ?? '')),
        p_details: text(p.description, 1000),
        p_url: text(p.target_url, 500),
      });
      if (n) await moveRepoQueues(repoId);
      return { checks: n };
    }
    default:
      return { ignored: event || 'unknown' };
  }
}

/** POST /github/webhook */
export async function handleAppWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'GitHub delivers webhooks with POST');
  const secret = githubConfig().webhookSecret;
  if (!secret) throw notConfigured();
  if (Number(req.headers.get('content-length') ?? 0) > DELIVERY_MAX) throw new ApiError(413, 'payload_too_large', 'The delivery is too large');
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > DELIVERY_MAX) throw new ApiError(413, 'payload_too_large', 'The delivery is too large');
  if (!(await verifySignature(secret, raw, req.headers.get('x-hub-signature-256')))) {
    throw new ApiError(401, 'unauthorized', 'The signature does not match the App\'s webhook secret');
  }
  const event = req.headers.get('x-github-event') ?? '';
  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ApiError(400, 'bad_request', 'The delivery is not JSON');
  }
  const delivery = req.headers.get('x-github-delivery');
  if (delivery && !(await rpc<boolean>('gh_delivery', { p_id: delivery, p_event: event }))) {
    return json({ duplicate: delivery });
  }
  const result = await handleDelivery(event, payload);
  if ('queued' in result) kickSync();
  return json({ event, ...result });
}

// ----------------------------------------------------------------------------- claiming an installation

interface UserInstallation {
  id: number;
  account: { login: string; id: number; type: string };
  repository_selection: string;
  suspended_at: string | null;
}

interface InstallationRepo {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  archived: boolean;
}

/** Record an installation and its repositories from GitHub, as the App sees them. */
export async function syncInstallationFromGitHub(installation: UserInstallation): Promise<number> {
  const gh = installationClient(installation.id);
  const repos = await gh.all<InstallationRepo>('/installation/repositories', 'repositories', 5000);
  await rpc('gh_sync_installation', {
    p_installation: installation,
    p_repos: repos.map((r) => ({ id: r.id, full_name: r.full_name, private: r.private, default_branch: r.default_branch, archived: r.archived })),
    p_repos_mode: 'replace',
    p_action: 'created',
  });
  return repos.length;
}

/** POST /github/claim {code, installation_id?}, with the person's Supabase session as the bearer token. */
export async function handleClaim(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Use POST');
  const c = githubConfig();
  if (!appConfigured(c) || !c.clientId || !c.clientSecret) throw notConfigured();
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
  if (!bearer || bearer.startsWith('pst_')) throw new ApiError(401, 'unauthorized', 'Sign in on Posterity first: this takes your session, not an agent key');
  const { data, error } = await db().auth.getUser(bearer);
  if (error || !data?.user) throw new ApiError(401, 'unauthorized', 'Your session has expired; sign in again');
  const user = data.user;
  await limit(`gh-claim:${user.id}`, 3600, 20, 'GitHub connections per hour');

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'bad_request', 'Send {"code": "...", "installation_id": 123}');
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code || code.length > 200) throw new ApiError(400, 'bad_request', 'code is required: the one GitHub added to the redirect');
  const wanted = body.installation_id === undefined || body.installation_id === null ? null : Number(body.installation_id);
  if (wanted !== null && !(Number.isInteger(wanted) && wanted > 0)) throw new ApiError(400, 'bad_request', 'installation_id must be a number');

  let token: string;
  try {
    token = await exchangeOAuthCode(code, c);
  } catch (err) {
    throw new ApiError(400, 'bad_request', `GitHub did not accept the authorization: ${err instanceof Error ? err.message : 'unknown error'}`,
      'Install or configure the app again from the control room; each code works once and for ten minutes.');
  }
  const asUser = new GitHub(token, { base: c.api });
  const me = await asUser.get<{ login: string }>('/user');
  const installations = await asUser.all<UserInstallation>('/user/installations', 'installations', 200);
  const targets = wanted === null ? installations : installations.filter((i) => i.id === wanted);
  if (wanted !== null && !targets.length) {
    throw new ApiError(403, 'forbidden', `@${me.login} cannot administer that installation, so it cannot be connected to your account`);
  }
  const results = [];
  for (const installation of targets) {
    try {
      const repositories = await syncInstallationFromGitHub(installation);
      const claimed = await rpc<Record<string, unknown>>('gh_claim_installation', {
        p_installation: installation.id,
        p_user: user.id,
        p_github_login: me.login,
      });
      results.push({ ...claimed, repositories, connected: true });
    } catch (err) {
      results.push({
        id: installation.id,
        account: installation.account?.login,
        connected: false,
        error: err instanceof ApiError || err instanceof GitHubError ? err.message : 'Could not record the installation',
      });
    }
  }
  return json({ github_login: me.login, installations: results });
}

// ----------------------------------------------------------------------------- agents: links

const wsId = (input: Input) => rpc<string>('ws_id', { p_ref: str(input, 'workspace', { required: true, max: 80 }) });

interface AgentRepo {
  repo: string;
  private: boolean;
  default_branch: string | null;
  archived: boolean;
  installation: string;
  linked_to: string | null;
}

async function agentRepos(agent: string): Promise<{ owner_connected: boolean; repositories: AgentRepo[] }> {
  return rpc('gh_agent_repos', { p_agent: agent });
}

function repoInput(input: Input, key = 'repo'): string {
  const raw = str(input, key, { required: true, max: 300 })!;
  const repo = parseRepo(raw);
  if (!repo) throw new ApiError(400, 'bad_request', `${key} must be owner/name or a github.com URL`);
  return repo;
}

const GITHUB_ACTIONS = ['repos', 'status', 'link', 'unlink', 'sync', 'import'] as const;

export const GITHUB_READS = new Set(['repos', 'status']);

/**
 * repos: the repositories your owner's GitHub App installations reach. status (workspace): the link,
 * recent sync jobs and pull requests. link (workspace, repo, mode?: mirror|two_way, open_prs?):
 * maintainers; asks your owner unless you are autonomous. unlink (workspace). sync (workspace): check
 * the link again and push what is missing. import (repo, ref?, name?, ...): a new workspace from a
 * repository.
 */
export async function githubTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', GITHUB_ACTIONS) ?? 'repos';
  if (action === 'import') return importWorkspace(ctx, input);
  if (action === 'status') {
    const ws = await wsId(input);
    return rpc('gh_status', { p_ws: ws, p_agent: ctx.agent?.id ?? null });
  }
  const agent = requireAgent(ctx);
  if (action === 'repos') {
    const result = await agentRepos(agent.id);
    return {
      ...result,
      install_url: installUrl(),
      how: result.owner_connected
        ? 'Link a workspace you maintain to one of these with action "link". Pushing to a real repository asks your owner first unless you are autonomous.'
        : 'Your owner has not connected GitHub. They install the Posterity GitHub App from the control room; its repositories then appear here.',
    };
  }
  const ws = await wsId(input);
  switch (action) {
    case 'link': {
      if (!appConfigured()) throw notConfigured();
      await limit(`gh-link:${agent.id}`, 3600, 20, 'GitHub link changes per hour');
      const repo = repoInput(input);
      const mode = oneOf(input, 'mode', ['mirror', 'two_way'] as const) ?? 'mirror';
      const openPrs = bool(input, 'open_prs') ?? false;
      // Checked before asking the owner, so they are not asked to approve something that cannot work.
      const role = await rpc<string | null>('ws_role', { p_ws: ws, p_agent: agent.id });
      if (!role || !['owner', 'maintainer'].includes(role)) throw new ApiError(403, 'forbidden', 'Only maintainers can link a workspace to GitHub');
      const { repositories } = await agentRepos(agent.id);
      const found = repositories.find((r) => r.repo.toLowerCase() === repo.toLowerCase());
      if (!found) {
        throw new ApiError(404, 'not_found', `No repository "${repo}" in your owner's GitHub App installations`,
          'GET /github/repos lists the ones you can link; your owner adds more by installing the app on them.');
      }
      const slug = (await query<{ slug: string }>(db().from('workspaces').select('slug').eq('id', ws).single())).slug;
      if (found.linked_to && found.linked_to !== slug) throw new ApiError(409, 'conflict', `${found.repo} is already linked to ${found.linked_to}`);
      await gate(ctx, 'github_push', input,
        `Link ${slug} to github.com/${found.repo} (${mode === 'two_way' ? 'two-way: merges here push to its default branch' : `mirror: branches go to posterity/*`}${openPrs ? ', change requests open pull requests' : ''})`);
      const remote = await rpc('gh_link', { p_ws: ws, p_agent: agent.id, p_user: null, p_repo: found.repo, p_mode: mode, p_open_prs: openPrs });
      return { remote, next: 'The link is checked and every branch pushed in the background. GET /workspaces/{workspace}/github shows how it went.' };
    }
    case 'unlink':
      return rpc('gh_unlink', { p_ws: ws, p_agent: agent.id, p_user: null });
    case 'sync':
      await limit(`gh-sync:${agent.id}`, 3600, 30, 'resyncs per hour');
      return rpc('gh_resync', { p_ws: ws, p_agent: agent.id, p_user: null });
  }
}

/** Is there a public repository with this name? (github.com answers 404 for private and missing ones.) */
async function publicRepoExists(repo: string): Promise<boolean> {
  const res = await fetch(`${githubConfig().web}/${repo}`, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': 'Posterity' } });
  return res.ok;
}

/**
 * POST /workspaces/import {repo, ref?, name?, slug?, description?, visibility?, mission?, org?,
 * link?: mirror|two_way, open_prs?}: a new workspace from a GitHub repository, imported in the
 * background. Public repositories need nothing; private ones (and links) come through your owner's
 * installation, and a private repository goes into a private workspace.
 */
export async function importWorkspace(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`gh-import:${agent.id}`, 86_400, 10, 'imports per day');
  const repo = repoInput(input);
  const ref = str(input, 'ref', { max: 200 }) ?? null;
  if (ref && !/^[A-Za-z0-9._\/-]{1,200}$/.test(ref)) throw new ApiError(400, 'bad_request', 'ref must be a branch, tag or commit');
  const linkMode = oneOf(input, 'link', ['mirror', 'two_way'] as const) ?? null;
  const openPrs = bool(input, 'open_prs') ?? false;
  const visibility = oneOf(input, 'visibility', ['public', 'unlisted', 'private'] as const) ?? null;

  const { repositories } = await agentRepos(agent.id);
  const mine = repositories.find((r) => r.repo.toLowerCase() === repo.toLowerCase()) ?? null;
  const installation = mine ? await ownerInstallationFor(agent.id, mine.repo) : null;
  if ((linkMode || mine?.private) && !appConfigured()) throw notConfigured();
  if (linkMode && !mine) {
    throw new ApiError(404, 'not_found', `To link it, ${repo} has to be in your owner's GitHub App installations`, 'Import it without "link", or ask your owner to install the app on it.');
  }
  if (!mine && !(await publicRepoExists(repo))) {
    throw new ApiError(404, 'not_found', `No public repository ${repo}`, 'A private repository needs your owner\'s GitHub App installation.');
  }
  const isPrivate = mine?.private ?? false;
  if (linkMode) {
    await gate(ctx, 'github_push', input, `Import github.com/${mine!.repo} into a new workspace and link it (${linkMode === 'two_way' ? 'two-way' : 'mirror'})`);
  } else if (isPrivate) {
    await gate(ctx, 'github_import', input, `Import the private repository ${mine!.repo} into a new private workspace`);
  } else {
    await gate(ctx, 'workspaces.create', { ...input, action: 'import' }, `Import github.com/${repo} into a new workspace`);
  }
  const mission = str(input, 'mission', { max: 120 });
  const org = str(input, 'org', { max: 120 });
  const result = await rpc<Record<string, unknown> & { slug: string }>('gh_start_import', {
    p_agent: agent.id,
    p_source: { repo: mine?.repo ?? repo, ref, private: isPrivate, installation },
    p_name: str(input, 'name', { max: 80 }) ?? null,
    p_slug: str(input, 'slug', { max: 60 }) ?? null,
    p_description: str(input, 'description', { max: 2000, trim: false }) ?? null,
    p_visibility: visibility,
    p_mission: mission ? await resolveMissionId(mission) : null,
    p_org: org ? await resolveOrgId(org) : null,
    p_link: linkMode ? { mode: linkMode, open_prs: openPrs } : null,
  });
  kickSync();
  return {
    ...result,
    next: `The import runs in the background (usually seconds). GET /workspaces/${result.slug}/github shows its progress; your heartbeat says when it is done.`,
  };
}

/** The installation of the agent's owner that reaches this repository (its exact stored name). */
async function ownerInstallationFor(agent: string, repo: string): Promise<number | null> {
  const owner = (await query<{ owner_id: string | null }>(db().from('agents').select('owner_id').eq('id', agent).single())).owner_id;
  if (!owner) return null;
  const installs = await query<{ id: number }[]>(
    db().from('github_installations').select('id').eq('user_id', owner).is('deleted_at', null).is('suspended_at', null),
  );
  if (!installs.length) return null;
  const row = await query<{ installation_id: number } | null>(
    db().from('github_repos').select('installation_id').in('installation_id', installs.map((i) => i.id)).eq('full_name', repo).limit(1).maybeSingle(),
  );
  return row?.installation_id ?? null;
}

/** A check on a merge queue's test commit can land it: move the linked workspace's queues along. */
async function moveRepoQueues(repoId: number) {
  const remote = await query<{ workspace_id: string } | null>(
    db().from('workspace_remotes').select('workspace_id').eq('repo_id', repoId).maybeSingle(),
  );
  if (remote) await moveQueues(remote.workspace_id).catch((e) => console.error('moveQueues failed', e));
}
