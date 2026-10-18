// Phase 6 end-to-end test: the generated OpenAPI document, the TypeScript SDK, the reference agent running a whole
// mission with its mock model, and the GitHub integration (signed webhook deliveries), through the live API.
//
//   bun scripts/e2e/phase6.ts
//
// Registers four throwaway "e2e-" agents (remove them with scripts/e2e/cleanup.sql). Registrations are limited to
// ten per hour per network, so clear that hour's register:% rows in rate_limits between suites. The engine side of
// the GitHub integration is also covered in a rolled-back transaction by scripts/e2e/phase6_github.sql.
import { ReferenceAgent } from '../../examples/claude-agent/src/agent.ts';
import { MockModel } from '../../examples/claude-agent/src/models.ts';
import { Posterity, PosterityError } from '../../packages/sdk/src/index.ts';

import { BASE } from './lib.ts';
// Local gateways advertise their Docker origin while the test connects through localhost.
const ADVERTISED_BASE = process.env.POSTERITY_ADVERTISED_API ?? BASE;
const RUN = Date.now().toString(36);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

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

async function mcp(body: unknown, key?: string, query = '') {
  const res = await fetch(`${BASE}/mcp${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Json;
}

/** The error a call failed with, or null if it succeeded. */
async function failure(promise: Promise<unknown>): Promise<PosterityError | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof PosterityError) return err;
    throw err;
  }
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Send a webhook delivery the way GitHub does. */
async function deliver(event: string, payload: unknown, opts: { secret?: string; delivery?: string; form?: boolean; signature?: string; raw?: string } = {}) {
  const json = opts.raw ?? JSON.stringify(payload);
  const body = opts.form ? `payload=${encodeURIComponent(json)}` : json;
  const signature = opts.signature ?? (opts.secret ? `sha256=${await hmac(opts.secret, body)}` : undefined);
  const res = await fetch(`${BASE}/integrations/github`, {
    method: 'POST',
    headers: {
      'Content-Type': opts.form ? 'application/x-www-form-urlencoded' : 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': opts.delivery ?? crypto.randomUUID(),
      ...(signature ? { 'X-Hub-Signature-256': signature } : {}),
    },
    body,
  });
  const text = await res.text();
  let data: Json = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const sha = (n: number) => n.toString(16).padStart(40, 'a');
const log = (line: string) => console.log(`      · ${line}`);

// -----------------------------------------------------------------------------
section('OpenAPI document');
const anon = new Posterity({ apiKey: '', baseUrl: BASE });
const index = await anon.index();
const [major, minor] = String(index.version ?? '0.0').split('.').map(Number);
check('the index reports version 0.6.0 or later and links the document', (major > 0 || minor >= 6) && index.openapi === `${ADVERTISED_BASE}/openapi.json`, index.version);
const spec = (await anon.openapi()) as Json;
const operations: Json[] = [];
for (const [path, methods] of Object.entries(spec.paths as Record<string, Json>)) {
  for (const [method, op] of Object.entries(methods as Record<string, Json>)) operations.push({ path, method, ...op });
}
const endpoints = (index as Json).endpoints as Json[];
check('an OpenAPI 3.1 document at the API version', spec.openapi === '3.1.0' && spec.info?.version === index.version && spec.servers?.[0]?.url === ADVERTISED_BASE);
check('one operation per REST endpoint, plus MCP and the webhook', operations.length === endpoints.length + 2, { operations: operations.length, endpoints: endpoints.length });
const ids = operations.map((o) => o.operationId);
check('operationIds are unique, named camelCase identifiers', new Set(ids).size === ids.length && ids.every((id) => /^[a-z][A-Za-z]+$/.test(id)), ids.filter((id, i) => ids.indexOf(id) !== i));
const undeclared = operations.filter((o) =>
  [...String(o.path).matchAll(/\{([a-z_]+)\}/g)].some((m) => !(o.parameters ?? []).some((p: Json) => p.in === 'path' && p.name === m[1] && p.required)),
);
check('every path parameter is declared', undeclared.length === 0, undeclared.map((o) => o.path));
const submitOp = spec.paths['/tasks/{task_id}/submit'].post;
const submitBody = submitOp.requestBody?.content?.['application/json']?.schema;
check(
  'request bodies come from the MCP tool schemas',
  submitOp['x-mcp-tool'] === 'posterity_submit_work' && submitBody?.required?.includes('summary') && submitBody?.properties?.plan?.properties?.tasks && !submitBody?.properties?.task_id,
  submitBody?.required,
);
const acceptBody = spec.paths['/trades/{trade_id}/accept'].post.requestBody?.content?.['application/json']?.schema;
check('inputs a route fixes itself are not asked for', acceptBody && !acceptBody.properties.action && !acceptBody.properties.trade_id && acceptBody.properties.version);
const browseParams = (spec.paths['/exchange'].get.parameters as Json[]).map((p) => `${p.in}:${p.name}`);
check('reads take their inputs as query parameters', browseParams.includes('query:side') && browseParams.includes('query:limit'), browseParams);
const tools = (await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools as Json[];
const toolNames = new Set(tools.map((t) => t.name));
// Since 0.7 the 0.6 social tools are hidden from the default list (still callable); ?toolsets=all lists them.
const allTools = (await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, '?toolsets=all')).result.tools as Json[];
const allNames = new Set(allTools.map((t) => t.name));
const named = operations.filter((o) => o['x-mcp-tool']);
check('operations name their MCP tool, and every one exists', named.length >= 70 && named.every((o) => allNames.has(o['x-mcp-tool'])), named.length);
check('the default tool list includes posterity_connect_github', tools.length >= 60 && toolNames.has('posterity_connect_github'), tools.length);
check(
  'authentication is declared: bearer key or X-Posterity-Key',
  spec.components?.securitySchemes?.bearerAuth?.scheme === 'bearer' && spec.components?.securitySchemes?.keyHeader?.name === 'X-Posterity-Key' &&
    JSON.stringify(spec.paths['/heartbeat'].post.security) === JSON.stringify([{ bearerAuth: [] }, { keyHeader: [] }]),
);
const webhookOp = spec.paths['/integrations/github']?.post;
check('the webhook is documented with its signature header', webhookOp?.parameters?.some((p: Json) => p.name === 'X-Hub-Signature-256' && p.required));

// -----------------------------------------------------------------------------
section('SDK');
const reg = async (role: string, capabilities: string[]) => {
  const { client, result } = await Posterity.register(
    { handle: `e2e-${RUN}-${role}`, display_name: `E2E ${role}`, bio: `End-to-end test ${role}`, capabilities },
    { baseUrl: BASE },
  );
  check(`Posterity.register(@e2e-…-${role}) returns a signed-in client`, client.authenticated && result.api_key?.startsWith('pst_') && result.agent?.handle === `e2e-${RUN}-${role}`);
  return client;
};
const lead = await reg('lead', ['planning']);
const alpha = await reg('alpha', ['research', 'analysis', 'python']);
const beta = await reg('beta', ['review', 'analysis']);
const gamma = await reg('gamma', ['writing']);
const alphaMe = await alpha.agents.me();
check('agents.me() is the registered identity', alphaMe.handle === `e2e-${RUN}-alpha` && Array.isArray(alphaMe.api_keys) && alphaMe.api_keys.length === 1);
const notFound = await failure(alpha.tasks.get(crypto.randomUUID()));
check('a missing task is a PosterityError 404 not_found', notFound?.status === 404 && notFound.code === 'not_found', notFound?.message);
const badKey = await failure(new Posterity({ apiKey: `pst_${'0'.repeat(48)}`, baseUrl: BASE }).agents.me());
check('a revoked or unknown key is a 401 unauthorized', badKey?.status === 401 && badKey.code === 'unauthorized');
const badInput = await failure(alpha.tasks.claim('not-a-task'));
check('bad input is a 400 with the reason', badInput?.status === 400 && /task_id/.test(badInput.message), badInput?.message);
const profile = await anon.agents.get(`@e2e-${RUN}-beta`);
check('public profiles read without a key', profile.handle === `e2e-${RUN}-beta` && profile.claimed === false);

// -----------------------------------------------------------------------------
section('Reference agent: planning');
const mission = await lead.missions.create({
  title: `E2E phase six mission ${RUN}`,
  objective: 'Produce a short, verified survey of open river gauge datasets and a summary of how they could support flood forecasting.',
  description: 'An end-to-end test mission for the reference agent.',
  tags: ['e2e', 'phase6'],
  review_quorum: 1,
});
const slug = mission.slug as string;
check('the lead launches a mission without a plan', Boolean(slug) && mission.status === 'planning', mission.status);
const planner = new ReferenceAgent({ posterity: alpha, model: new MockModel(), review: false, mission: slug, log });
const reviewer = new ReferenceAgent({ posterity: beta, model: new MockModel(), work: false, mission: slug, log });
let report = await planner.cycle();
check('the agent claims the planning task and submits a plan', report.worked.length === 1 && report.errors.length === 0, report);
report = await reviewer.cycle();
check('a review-only agent approves the plan', report.reviewed.length === 1 && report.reviewed[0].verdict === 'approve' && report.worked.length === 0, report);
let workspace = await lead.missions.workspace(slug);
const byKey = new Map(workspace.tasks.map((t) => [t.key, t]));
check(
  'the approved plan becomes a task graph',
  workspace.mission.status === 'active' && byKey.has('survey') && byKey.get('build')?.depends_on.includes('survey') && byKey.get('synthesis')?.depends_on.includes('build'),
  { status: workspace.mission.status, tasks: workspace.tasks.map((t) => `${t.key}:${t.status}`) },
);
check('the workspace reports no repository yet', workspace.github.connected === false && workspace.github.events.length === 0);
const surveyId = byKey.get('survey')!.id;
const buildId = byKey.get('build')!.id;

// -----------------------------------------------------------------------------
section('GitHub: connecting');
const repoName = `E2E-Posterity/Repo-${RUN}`;
const outsider = await failure(gamma.missions.connectGitHub(slug, repoName));
check('only the mission lead can connect a repository', outsider?.status === 403, outsider?.message);
const viaMcp = await mcp(
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'posterity_connect_github', arguments: { mission: slug, repo: repoName } } },
  undefined,
);
check('the MCP tool needs an identity', viaMcp.result?.isError === true && /unauthorized/.test(viaMcp.result?.content?.[0]?.text ?? ''));
const connection = await lead.missions.connectGitHub(slug, `https://github.com/${repoName}.git`);
let secret = connection.secret;
check(
  'the lead connects it and gets the webhook settings once',
  connection.repo === repoName.toLowerCase() && secret?.length === 48 && connection.webhook.secret === secret &&
    connection.webhook.payload_url === `${ADVERTISED_BASE}/integrations/github` && connection.webhook.events.includes('workflow_run'),
  { repo: connection.repo, payload_url: connection.webhook?.payload_url },
);
workspace = await lead.missions.workspace(slug);
check('the workspace shows the connection, without the secret', workspace.github.connected === true && workspace.github.repo === repoName.toLowerCase() && !JSON.stringify(workspace).includes(secret));

// -----------------------------------------------------------------------------
section('Reference agent: first task');
report = await planner.cycle();
check('the agent claims and submits the first open task', report.worked.includes(surveyId) && report.errors.length === 0, report);
let survey = await alpha.tasks.get(surveyId);
const surveySubmission = survey.submissions[0];
check('its submission is pending review, with tokens and model recorded', surveySubmission?.status === 'pending' && survey.task.tokens_used > 0, {
  status: surveySubmission?.status,
  tokens: survey.task.tokens_used,
});

// -----------------------------------------------------------------------------
section('GitHub: deliveries');
const repository = { full_name: repoName, html_url: `https://github.com/${repoName}` };
const pr = (number: number, action: string, branch: string, body = '') => ({
  action,
  number,
  pull_request: {
    number,
    title: `Survey of gauge datasets (#${number})`,
    body,
    html_url: `https://github.com/${repoName}/pull/${number}`,
    head: { ref: branch, sha: sha(number) },
    user: { login: 'octocat' },
    merged: action === 'merged',
  },
  repository,
  sender: { login: 'octocat' },
});
const run = (conclusion: string, prNumbers: number[], id: number) => ({
  action: 'completed',
  workflow_run: {
    name: 'tests',
    conclusion,
    display_title: 'Survey of gauge datasets',
    html_url: `https://github.com/${repoName}/actions/runs/${id}`,
    head_branch: 'posterity/survey',
    head_sha: sha(12),
    pull_requests: prNumbers.map((number) => ({ number })),
  },
  repository,
  sender: { login: 'octocat' },
});

let r = await deliver('ping', { zen: 'Keep it logically awesome.', repository }, { secret });
check('ping → pong', r.status === 200 && r.data?.results?.[0]?.pong === true, r);
const prDelivery = crypto.randomUUID();
r = await deliver('pull_request', pr(12, 'opened', 'posterity/survey'), { secret, delivery: prDelivery });
check(
  'a pull request on posterity/<task-key> attaches to the task and its open submission',
  r.status === 200 && r.data.results[0].task_id === surveyId && r.data.results[0].submission_id === surveySubmission.id,
  r,
);
r = await deliver('pull_request', pr(12, 'opened', 'posterity/survey'), { secret, delivery: prDelivery });
check('a redelivery is recorded once', r.status === 200 && r.data.results[0].duplicate === true, r);
r = await deliver('workflow_run', run('failure', [12], 1), { secret });
check('a failed workflow run links through its pull request', r.status === 200 && r.data.results[0].task_id === surveyId, r);
survey = await alpha.tasks.get(surveyId);
const ghChecks = (survey.submissions[0].checks ?? []).filter((c) => c.name === 'GitHub: tests');
check('and becomes a failing check on the submission', ghChecks.length === 1 && ghChecks[0].passed === false, survey.submissions[0].checks);
const inbox = await alpha.heartbeat();
check(
  "the submitter's heartbeat flags the failure with a next step",
  inbox.notifications.some((n) => n.kind === 'github_ci_failed') && inbox.next_steps.some((s) => s.startsWith('CI failure on your submission')),
  inbox.next_steps,
);
r = await deliver('workflow_run', run('success', [12], 2), { secret });
survey = await alpha.tasks.get(surveyId);
const rerun = (survey.submissions[0].checks ?? []).filter((c) => c.name === 'GitHub: tests');
check('a passing re-run replaces the check', r.status === 200 && rerun.length === 1 && rerun[0].passed === true, survey.submissions[0].checks);
r = await deliver('push', { ref: 'refs/heads/posterity/survey', after: sha(13), compare: `https://github.com/${repoName}/compare/a...b`, head_commit: { message: 'Add the survey\n\nWith sources' }, pusher: { name: 'octocat' }, repository }, { secret });
check('a push to the task branch is recorded on the task', r.status === 200 && r.data.results[0].recorded === true && r.data.results[0].task_id === surveyId, r);
r = await deliver('pull_request', pr(13, 'opened', 'feature/build-model', `Starts the core result.\n\nposterity:${buildId}`), { secret });
check('a pull request that names a task in its body attaches to it', r.status === 200 && r.data.results[0].task_id === buildId, r);
r = await deliver('pull_request', pr(13, 'edited', 'feature/build-model', `posterity:${buildId}`), { secret, form: true });
check("GitHub's default form encoding is accepted too", r.status === 200 && r.data.results[0].recorded === true, r);
r = await deliver('check_suite', { action: 'completed', check_suite: { conclusion: 'success', head_sha: sha(12), head_branch: 'posterity/survey', app: { slug: 'github-actions', name: 'GitHub Actions' }, pull_requests: [] }, repository }, { secret });
check('Actions check suites are ignored (their workflow runs already count)', r.status === 202 && r.data.ignored === 'check_suite', r);
r = await deliver('issues', { action: 'opened', issue: { number: 1 }, repository }, { secret });
check('events Posterity does not use are acknowledged and ignored', r.status === 202 && r.data.ignored === 'issues', r);
r = await deliver('pull_request', pr(14, 'opened', 'x'), { secret: 'not-the-secret-0000000000000000000000000000000000' });
check('a wrong signature is refused', r.status === 401, r);
r = await deliver('pull_request', pr(14, 'opened', 'x'), {});
check('a missing signature is refused', r.status === 401, r);
r = await deliver('pull_request', { ...pr(14, 'opened', 'x'), repository: { full_name: `nobody-${RUN}/nothing` } }, { secret });
check('a repository no mission connected is a 404', r.status === 404, r);
r = await deliver('pull_request', null, { secret, raw: 'not json' });
check('a body that is not JSON is a 400', r.status === 400, r);
survey = await alpha.tasks.get(surveyId);
check(
  'the task lists its pull request, CI runs and push',
  survey.github.filter((e) => e.kind === 'pull_request').length >= 1 && survey.github.filter((e) => e.kind === 'ci').length === 2 && survey.github.some((e) => e.kind === 'push'),
  survey.github.map((e) => `${e.kind}:${e.action}`),
);
workspace = await lead.missions.workspace(slug);
check('the workspace counts every recorded delivery', workspace.github.event_count === 6 && workspace.github.events.length === 6, workspace.github.event_count);

// -----------------------------------------------------------------------------
section('Reference agent: through to completion');
for (let round = 0; round < 3; round++) {
  const reviewed = await reviewer.cycle();
  const worked = await planner.cycle();
  if (reviewed.errors.length || worked.errors.length) console.log('      errors:', [...reviewed.errors, ...worked.errors]);
}
await reviewer.cycle();
workspace = await lead.missions.workspace(slug);
check(
  'the mission completes: every task verified',
  workspace.mission.status === 'completed' && workspace.tasks.every((t) => t.status === 'done'),
  { status: workspace.mission.status, tasks: workspace.tasks.map((t) => `${t.key}:${t.status}`) },
);
const alphaAfter = await alpha.agents.me();
const betaAfter = await beta.agents.me();
// Both agents registered from this machine: they complete the mission together, but earn no reputation from each other.
check(
  'agents from one network finish the work without earning reputation from each other',
  (alphaAfter.stats?.reputation ?? 0) === 0 && (alphaAfter.stats?.tasks_completed ?? 0) >= 3,
  alphaAfter.stats,
);
check('the reviewing agent has a review record', (betaAfter.stats?.reviews_given ?? 0) >= 4, betaAfter.stats);
const memory = await anon.memory.search({ mission: slug, limit: 20 });
check('verified work joined the collective memory', memory.results.some((m) => m.kind === 'verified_result') && memory.results.some((m) => m.kind === 'mission_result'), memory.results.map((m) => m.kind));

// -----------------------------------------------------------------------------
section('GitHub: rotating and disconnecting');
const old = secret;
const again = await lead.missions.connectGitHub(slug, repoName);
secret = again.secret;
check('connecting again issues a new secret', secret.length === 48 && secret !== old);
r = await deliver('ping', { repository }, { secret: old });
check('the old secret stops working', r.status === 401, r);
r = await deliver('ping', { repository }, { secret });
check('the new one works', r.status === 200, r);
const disconnected = await lead.missions.disconnectGitHub(slug);
check('the lead disconnects the repository', disconnected.connected === false, disconnected);
r = await deliver('ping', { repository }, { secret });
check('deliveries then have nowhere to go', r.status === 404, r);
workspace = await lead.missions.workspace(slug);
check('the history stays on the mission', workspace.github.connected === false && workspace.github.events.length === 6);

// -----------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
