// GitHub: a mission connects its repository, and GitHub sends signed webhook
// deliveries to POST /integrations/github. Each delivery is checked against the
// connected missions' secrets, reduced to a few fields, and recorded by the
// engine, which links it to a task and puts CI results on the open submission.
import { db, query, rpc } from '../lib/db.ts';
import { ApiError, json } from '../lib/http.ts';
import { bool, type Input, str } from '../lib/validate.ts';
import { type Ctx, limit, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';

const MAX_BYTES = 5_000_000;

export const WEBHOOK_EVENTS = ['pull_request', 'workflow_run', 'check_suite', 'push'] as const;

interface GitHubEvent {
  kind: 'pull_request' | 'ci' | 'push' | 'ping';
  action?: string;
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  branch?: string;
  sha?: string;
  conclusion?: string;
  name?: string;
  actor?: string;
  pr_numbers?: number[];
}

// deno-lint-ignore no-explicit-any
type Payload = Record<string, any>;

const text = (value: unknown, max: number) => (typeof value === 'string' && value ? value.slice(0, max) : undefined);
const prNumbers = (list: unknown) =>
  Array.isArray(list) ? list.map((pr) => (pr as { number?: unknown })?.number).filter((n): n is number => Number.isInteger(n)) : [];

/** Reduce a delivery to what Posterity records, or null for events it does not use. */
export function normalize(event: string, p: Payload): GitHubEvent | null {
  switch (event) {
    case 'ping':
      return { kind: 'ping' };
    case 'pull_request': {
      const pr = p.pull_request;
      if (!pr) return null;
      const action = p.action === 'closed' && pr.merged ? 'merged' : String(p.action ?? '');
      if (!['opened', 'reopened', 'closed', 'merged', 'synchronize', 'ready_for_review', 'edited'].includes(action)) return null;
      return {
        kind: 'pull_request',
        action,
        number: pr.number,
        title: text(pr.title, 300),
        body: text(pr.body, 4000),
        url: text(pr.html_url, 500),
        branch: text(pr.head?.ref, 255),
        sha: text(pr.head?.sha, 40),
        actor: text(p.sender?.login ?? pr.user?.login, 100),
      };
    }
    case 'workflow_run': {
      const run = p.workflow_run;
      if (!run || p.action !== 'completed') return null;
      return {
        kind: 'ci',
        action: 'completed',
        conclusion: text(run.conclusion, 40),
        name: text(run.name, 80),
        title: text(run.display_title, 300),
        url: text(run.html_url, 500),
        branch: text(run.head_branch, 255),
        sha: text(run.head_sha, 40),
        actor: text(p.sender?.login, 100),
        pr_numbers: prNumbers(run.pull_requests),
      };
    }
    case 'check_suite': {
      const suite = p.check_suite;
      // GitHub Actions also report through workflow_run; count them once.
      if (!suite || p.action !== 'completed' || suite.app?.slug === 'github-actions') return null;
      return {
        kind: 'ci',
        action: 'completed',
        conclusion: text(suite.conclusion, 40),
        name: text(suite.app?.name, 80) ?? 'CI',
        url: typeof p.repository?.html_url === 'string' && suite.head_sha ? `${p.repository.html_url}/commit/${suite.head_sha}/checks` : undefined,
        branch: text(suite.head_branch, 255),
        sha: text(suite.head_sha, 40),
        actor: text(p.sender?.login, 100),
        pr_numbers: prNumbers(suite.pull_requests),
      };
    }
    case 'push': {
      const ref = String(p.ref ?? '');
      if (!ref.startsWith('refs/heads/') || p.deleted) return null;
      return {
        kind: 'push',
        action: 'pushed',
        branch: ref.slice('refs/heads/'.length, 'refs/heads/'.length + 255),
        sha: text(p.after, 40),
        url: text(p.compare, 500),
        title: text(String(p.head_commit?.message ?? '').split('\n')[0], 300),
        actor: text(p.pusher?.name ?? p.sender?.login, 100),
      };
    }
    default:
      return null;
  }
}

async function hmacHex(secret: string, body: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, body);
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** POST /integrations/github — GitHub's webhook deliveries. */
export async function handleGitHub(req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'GitHub delivers webhooks with POST');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) throw new ApiError(413, 'payload_too_large', 'The delivery is too large');
  const raw = await req.arrayBuffer();
  if (raw.byteLength > MAX_BYTES) throw new ApiError(413, 'payload_too_large', 'The delivery is too large');
  const event = req.headers.get('x-github-event') ?? '';
  const signature = (req.headers.get('x-hub-signature-256') ?? '').toLowerCase();

  // GitHub's default content type wraps the JSON in a form field; accept both.
  const body = new TextDecoder().decode(raw);
  const form = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  let payload: Payload;
  try {
    payload = JSON.parse(form ? new URLSearchParams(body).get('payload') ?? '' : body);
  } catch {
    throw new ApiError(400, 'bad_request', 'The delivery is not JSON: set the webhook content type to application/json');
  }
  const repo = payload?.repository?.full_name;
  if (typeof repo !== 'string') throw new ApiError(400, 'bad_request', 'The delivery names no repository');

  const targets = await rpc<{ integration_id: string; mission_id: string; secret: string }[]>('github_targets', { p_repo: repo });
  if (!targets.length) throw new ApiError(404, 'not_found', `No mission is connected to ${repo}`);
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) throw new ApiError(401, 'unauthorized', 'Missing or malformed X-Hub-Signature-256: set a webhook secret');
  const matched = [];
  for (const target of targets) {
    if (safeEqual(signature, `sha256=${await hmacHex(target.secret, raw)}`)) matched.push(target);
  }
  if (!matched.length) throw new ApiError(401, 'unauthorized', 'The signature does not match the webhook secret');

  const normalized = normalize(event, payload);
  if (!normalized) return json({ ignored: event || 'unknown' }, 202);
  await limit(`github:${matched[0].integration_id}`, 3600, 2000, 'webhook deliveries for this repository');
  const delivery = req.headers.get('x-github-delivery');
  const results = [];
  for (const target of matched) {
    const result = await rpc<Record<string, unknown>>('record_github_event', {
      p_integration: target.integration_id,
      p_delivery: delivery,
      p_event: normalized,
    });
    results.push({ mission_id: target.mission_id, ...result });
  }
  return json({ event, results });
}

/** Mission leads connect (or disconnect) the mission's repository. */
export async function connect(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`github-connect:${agent.id}`, 3600, 20, 'repository changes per hour');
  const missionId = await resolveMissionId(str(input, 'mission', { required: true, max: 120 })!);
  if (bool(input, 'disconnect')) {
    return rpc('disconnect_github', { p_mission: missionId, p_user: null, p_agent: agent.id });
  }
  const result = await rpc<{ repo: string; secret: string }>('connect_github', {
    p_mission: missionId,
    p_user: null,
    p_agent: agent.id,
    p_repo: str(input, 'repo', { required: true, max: 300 }),
  });
  return {
    ...result,
    webhook: {
      payload_url: `${ctx.apiBase}/integrations/github`,
      content_type: 'application/json',
      secret: result.secret,
      events: WEBHOOK_EVENTS,
    },
    important:
      'The secret is shown only once. In the repository, open Settings → Webhooks → Add webhook, paste the payload URL and secret, choose application/json, and send pull requests, workflow runs, check suites and pushes.',
    linking:
      'A pull request attaches to a task when its branch is posterity/<task-key>, when its title or body links the task (posterity:<task-id> or a /tasks/<task-id> URL), or when a submission cites it as an artifact. CI results on it become checks on the open submission.',
  };
}

const EVENT_FIELDS = 'id, kind, action, title, url, number, branch, sha, conclusion, actor, task_id, submission_id, created_at';

/** The repository connected to a mission and its latest events, for workspaces. */
export async function missionGitHub(missionId: string) {
  const [integration, events] = await Promise.all([
    query(
      db()
        .from('mission_integrations')
        .select('repo, event_count, last_event_at, created_at')
        .eq('mission_id', missionId)
        .eq('provider', 'github')
        .maybeSingle(),
    ),
    query(db().from('integration_events').select(EVENT_FIELDS).eq('mission_id', missionId).order('id', { ascending: false }).limit(10)),
  ]);
  return integration ? { connected: true, ...integration, events } : { connected: false, events };
}

/** Pull requests and CI results linked to one task. */
export function taskGitHub(taskId: string) {
  return query(db().from('integration_events').select(EVENT_FIELDS).eq('task_id', taskId).order('id', { ascending: false }).limit(20));
}
