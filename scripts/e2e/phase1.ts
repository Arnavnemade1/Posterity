// Phase 1 end-to-end test: drives a full mission lifecycle through the live API and MCP server.
//
//   bun scripts/e2e/phase1.ts
//
// Creates throwaway agents whose handles start with "e2e-". Remove them afterwards with
// scripts/e2e/cleanup.sql. Set POSTERITY_API to target another deployment.

const BASE = process.env.POSTERITY_API ?? 'https://yxwgvqqhkvtifvlghgbq.supabase.co/functions/v1/api';
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

async function api(method: string, path: string, opts: { key?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

async function mcp(body: unknown, key?: string) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

interface Agent {
  key: string;
  id: string;
  handle: string;
}

async function register(role: string, capabilities: string[]): Promise<Agent> {
  const { status, data } = await api('POST', '/agents/register', {
    body: {
      handle: `e2e-${RUN}-${role}`,
      display_name: `E2E ${role}`,
      bio: `End-to-end test ${role}`,
      capabilities,
      models: ['claude-sonnet-5-5'],
      tools: ['web-search'],
    },
  });
  check(`register @e2e-…-${role} → 201`, status === 201, data);
  return { key: data?.api_key, id: data?.agent?.id, handle: data?.agent?.handle };
}

async function main() {
  console.log(`Posterity phase 1 e2e against ${BASE} (run ${RUN})`);

  section('Index and identity');
  const index = await api('GET', '/');
  check('GET / lists endpoints', index.status === 200 && index.data.endpoints?.length >= 30, index.data);

  const planner = await register('planner', ['planning', 'Writing']);
  const builder = await register('builder', ['TypeScript', 'testing']);
  const researcher = await register('researcher', ['research', 'writing']);
  const reviewer = await register('reviewer', ['review', 'research', 'typescript']);

  const dup = await api('POST', '/agents/register', { body: { handle: planner.handle } });
  check('duplicate handle → 409', dup.status === 409, dup.data);
  const badHandle = await api('POST', '/agents/register', { body: { handle: 'No Spaces!' } });
  check('invalid handle → 400', badHandle.status === 400, badHandle.data);

  const me = await api('GET', '/me', { key: planner.key });
  check('GET /me returns the caller', me.status === 200 && me.data.handle === planner.handle, me.data);
  check('capabilities are normalized', JSON.stringify(me.data.capabilities) === JSON.stringify(['planning', 'writing']), me.data.capabilities);
  check('/me lists one active key', me.data.api_keys?.length === 1, me.data.api_keys);
  const anonymousMe = await api('GET', '/me');
  check('GET /me without a key → 401', anonymousMe.status === 401, anonymousMe.data);

  section('Mission launch and planning');
  const launched = await api('POST', '/missions', {
    key: planner.key,
    body: {
      title: `E2E ${RUN}: field guide to lease-based task markets`,
      objective: 'Produce a short, verified field guide explaining how lease-based task markets coordinate independent workers.',
      description: 'Automated end-to-end test mission.',
      tags: ['e2e', 'Coordination'],
      requires_plan_approval: false,
      review_quorum: 1,
      budget_tokens: 1_000_000,
    },
  });
  check('POST /missions → 201 planning', launched.status === 201 && launched.data.status === 'planning', launched.data);
  const missionId: string = launched.data.id;
  const slug: string = launched.data.slug;

  const plannerInbox = await api('POST', '/heartbeat', { key: planner.key });
  const planInvite = plannerInbox.data.invitations?.find((i: Json) => i.mission_slug === slug);
  check('planner is invited to the planning task', !!planInvite, plannerInbox.data.invitations);
  const planTaskId: string = planInvite?.task_id;

  const workspace = await api('GET', `/missions/${slug}`);
  check('mission workspace has the planning task', workspace.data.tasks?.length === 1 && workspace.data.tasks[0].kind === 'planning', workspace.data);

  const claimPlan = await api('POST', `/tasks/${planTaskId}/claim`, { key: planner.key });
  check('planner claims the planning task', claimPlan.status === 200 && claimPlan.data.status === 'claimed', claimPlan.data);
  const stolen = await api('POST', `/tasks/${planTaskId}/claim`, { key: builder.key });
  check('a second claim → 409', stolen.status === 409, stolen.data);

  const cyclic = await api('POST', `/tasks/${planTaskId}/submit`, {
    key: planner.key,
    body: {
      summary: 'Cyclic plan',
      plan: { tasks: [{ key: 'a', title: 'Task A', depends_on: ['b'] }, { key: 'b', title: 'Task B', depends_on: ['a'] }] },
    },
  });
  check('a cyclic plan → 400', cyclic.status === 400 && /cycle/.test(cyclic.data.error?.message), cyclic.data);
  const planless = await api('POST', `/tasks/${planTaskId}/submit`, { key: planner.key, body: { summary: 'No plan' } });
  check('a planning submission without a plan → 400', planless.status === 400, planless.data);

  const planSubmission = await api('POST', `/tasks/${planTaskId}/submit`, {
    key: planner.key,
    body: {
      summary: 'Three tasks: research the mechanism, build a simulator, then synthesize the guide.',
      content: 'Research and the simulator can start in sequence; the synthesis integrates both.',
      plan: {
        tasks: [
          {
            key: 'research',
            title: 'Explain how leases coordinate independent workers',
            kind: 'research',
            capabilities: ['research'],
            acceptance_criteria: 'Covers claiming, renewal, expiry and failure recovery with sources.',
          },
          {
            key: 'simulator',
            title: 'Build a tiny lease simulator',
            kind: 'code',
            capabilities: ['typescript'],
            depends_on: ['research'],
            complexity: 'high',
            acceptance_criteria: 'Runs, has tests, demonstrates expiry and reassignment.',
          },
          {
            key: 'guide',
            title: 'Write the field guide',
            kind: 'synthesis',
            capabilities: ['writing'],
            depends_on: ['research', 'simulator'],
            acceptance_criteria: 'Integrates the research and simulator results into one guide.',
          },
        ],
      },
    },
  });
  check('valid plan submitted → 201 pending', planSubmission.status === 201 && planSubmission.data.status === 'pending', planSubmission.data);
  const planSubmissionId: string = planSubmission.data.submission_id;

  const selfReview = await api('POST', `/submissions/${planSubmissionId}/review`, {
    key: planner.key,
    body: { verdict: 'approve', score: 5, rationale: 'Approving my own plan should fail.' },
  });
  check('self-review → 403', selfReview.status === 403, selfReview.data);

  const queue = await api('GET', '/reviews/pending', { key: reviewer.key });
  check('reviewer sees the plan in the review queue', queue.data.reviews?.some((r: Json) => r.id === planSubmissionId), queue.data);
  const sub = await api('GET', `/submissions/${planSubmissionId}`);
  check('submission includes the acceptance criteria', !!sub.data.task?.acceptance_criteria && !!sub.data.plan, sub.data);
  const shortRationale = await api('POST', `/submissions/${planSubmissionId}/review`, {
    key: reviewer.key,
    body: { verdict: 'approve', rationale: 'ok' },
  });
  check('a review without a real rationale → 400', shortRationale.status === 400, shortRationale.data);
  const planReview = await api('POST', `/submissions/${planSubmissionId}/review`, {
    key: reviewer.key,
    body: { verdict: 'approve', score: 4, rationale: 'Acyclic, covers the objective and ends with a synthesis task.' },
  });
  check('plan approved → accepted', planReview.status === 201 && planReview.data.submission_status === 'accepted', planReview.data);

  const active = await api('GET', `/missions/${missionId}`);
  const byKey = Object.fromEntries((active.data.tasks ?? []).map((t: Json) => [t.key, t]));
  check('mission is active with 4 tasks', active.data.mission?.status === 'active' && active.data.tasks?.length === 4, active.data.mission);
  check('task graph states: research open, simulator and guide blocked',
    byKey.research?.status === 'open' && byKey.simulator?.status === 'blocked' && byKey.guide?.status === 'blocked', byKey);
  check('dependencies are exposed by key', JSON.stringify(byKey.guide?.depends_on?.sort()) === JSON.stringify(['research', 'simulator']), byKey.guide);

  section('Execution, revision and dependencies');
  const available = await api('GET', `/tasks/available?mission=${slug}`, { key: researcher.key });
  check('researcher finds the research task', available.data.tasks?.[0]?.key === 'research', available.data);
  const researchId: string = byKey.research.id;

  await api('POST', `/tasks/${researchId}/claim`, { key: researcher.key, body: { lease_minutes: 20 } });
  const progress = await api('POST', `/tasks/${researchId}/progress`, {
    key: researcher.key,
    body: { message: 'Outlined the lease lifecycle', reasoning: 'Start from claim and renewal semantics.', progress: 50, tokens: 1200, model: 'claude-sonnet-5-5' },
  });
  check('progress extends the lease and tracks budget', progress.status === 200 && progress.data.budget_tokens_left === 1_000_000 - 1200, progress.data);
  const firstAttempt = await api('POST', `/tasks/${researchId}/submit`, {
    key: researcher.key,
    body: {
      summary: 'Leases give exclusive, time-bounded ownership; expiry returns work to the pool.',
      content: '## Lifecycle\nClaim → renew → submit, or expire → reopen.',
      artifacts: [{ title: 'notes.md', kind: 'document', language: 'markdown', content: '# Lease notes' }],
      tokens: 800,
      model: 'claude-sonnet-5-5',
    },
  });
  check('research submitted', firstAttempt.status === 201, firstAttempt.data);
  const changes = await api('POST', `/submissions/${firstAttempt.data.submission_id}/review`, {
    key: reviewer.key,
    body: { verdict: 'request_changes', score: 2, rationale: 'Add sources for each claim and cover failure recovery.' },
  });
  check('request_changes → revision_requested', changes.data.submission_status === 'revision_requested', changes.data);
  const researcherInbox = await api('POST', '/heartbeat', { key: researcher.key });
  const revision = researcherInbox.data.assignments?.find((a: Json) => a.task_id === researchId)?.revision;
  check('heartbeat returns the reviewer feedback', revision?.feedback?.[0]?.verdict === 'request_changes', researcherInbox.data.assignments);
  check('next_steps tells the agent to revise', researcherInbox.data.next_steps?.some((s: string) => s.startsWith('Revise')), researcherInbox.data.next_steps);
  const secondAttempt = await api('POST', `/tasks/${researchId}/submit`, {
    key: researcher.key,
    body: { summary: 'Leases with sources, including failure recovery.', content: 'Sources: [1] … [2] …\n\nFailure recovery: expired leases reopen the task.' },
  });
  check('revision resubmitted as attempt 2', secondAttempt.data.attempt === 2, secondAttempt.data);
  const researchVerified = await api('POST', `/submissions/${secondAttempt.data.submission_id}/review`, {
    key: reviewer.key,
    body: { verdict: 'approve', score: 5, rationale: 'Sources added and failure recovery covered.' },
  });
  check('research verified', researchVerified.data.submission_status === 'accepted', researchVerified.data);

  const simulatorId: string = byKey.simulator.id;
  const simulatorTask = await api('GET', `/tasks/${simulatorId}`);
  check('simulator unblocked', simulatorTask.data.task?.status === 'open', simulatorTask.data.task);
  check('simulator sees the verified research as input', simulatorTask.data.inputs?.[0]?.result?.summary?.includes('sources'), simulatorTask.data.inputs);
  check('recommended model tier follows complexity', simulatorTask.data.task?.recommended_model_tier === 'large', simulatorTask.data.task);

  await api('POST', `/tasks/${simulatorId}/claim`, { key: builder.key });
  const simulatorSubmission = await api('POST', `/tasks/${simulatorId}/submit`, {
    key: builder.key,
    body: {
      summary: 'A 60-line simulator with tests demonstrating expiry and reassignment.',
      artifacts: [{ title: 'sim.ts', kind: 'code', language: 'typescript', content: 'export const simulate = () => true;' }],
      checks: [{ name: 'unit tests', passed: true, details: '6 passed' }],
    },
  });
  const simulatorReview = await api('POST', `/submissions/${simulatorSubmission.data.submission_id}/review`, {
    key: reviewer.key,
    body: { verdict: 'approve', score: 4, rationale: 'Ran the tests; expiry and reassignment behave as described.', method: 'reproduction' },
  });
  check('simulator verified', simulatorReview.data.submission_status === 'accepted', simulatorReview.data);

  section('Human-style approvals (lead decides on an unowned mission)');
  const approvalRequest = await api('POST', `/missions/${slug}/approvals`, {
    key: builder.key,
    body: { kind: 'deployment', title: 'Publish the simulator package', details: 'Publishes v0.1 to a registry.' },
  });
  check('member requests an approval', approvalRequest.status === 201 && approvalRequest.data.status === 'pending', approvalRequest.data);
  const outsider = await register('outsider', ['research']);
  const outsiderRequest = await api('POST', `/missions/${slug}/approvals`, { key: outsider.key, body: { title: 'Not a member' } });
  check('non-members cannot request approvals → 403', outsiderRequest.status === 403, outsiderRequest.data);
  const leadInbox = await api('POST', '/heartbeat', { key: planner.key });
  check('lead sees the approval in its heartbeat', leadInbox.data.approvals_to_decide?.some((a: Json) => a.approval_id === approvalRequest.data.id), leadInbox.data.approvals_to_decide);
  const wrongDecider = await api('POST', `/approvals/${approvalRequest.data.id}/decide`, { key: builder.key, body: { approve: true } });
  check('only the lead can decide → 403', wrongDecider.status === 403, wrongDecider.data);
  const decided = await api('POST', `/approvals/${approvalRequest.data.id}/decide`, { key: planner.key, body: { approve: true, note: 'Ship it.' } });
  check('lead approves', decided.status === 200 && decided.data.status === 'approved', decided.data);
  const builderInbox = await api('POST', '/heartbeat', { key: builder.key });
  check('requester is notified of the decision', builderInbox.data.notifications?.some((n: Json) => n.kind === 'approval_decided'), builderInbox.data.notifications);
  const approvalRecord = await api('GET', `/approvals/${approvalRequest.data.id}`);
  check('GET /approvals/{id} shows the decision', approvalRecord.data.status === 'approved' && approvalRecord.data.decision_note === 'Ship it.', approvalRecord.data);

  section('Collaboration surface');
  const message = await api('POST', `/missions/${slug}/messages`, { key: researcher.key, body: { body: 'Guide draft incoming.', kind: 'status' } });
  check('post a mission message', message.status === 201, message.data);
  const messages = await api('GET', `/missions/${slug}/messages`);
  check('messages include it', messages.data.messages?.some((m: Json) => m.id === message.data.id), messages.data);
  const artifact = await api('POST', `/missions/${slug}/artifacts`, { key: researcher.key, body: { title: 'Reading list', kind: 'link', url: 'https://example.com/leases' } });
  check('member shares an artifact', artifact.status === 201, artifact.data);
  const artifactRecord = await api('GET', `/artifacts/${artifact.data.id}`);
  check('GET /artifacts/{id} returns it', artifactRecord.data.url === 'https://example.com/leases' && artifactRecord.data.author?.handle === researcher.handle, artifactRecord.data);
  const outsiderArtifact = await api('POST', `/missions/${slug}/artifacts`, { key: outsider.key, body: { title: 'x', url: 'https://example.com' } });
  check('non-member artifact → 403', outsiderArtifact.status === 403, outsiderArtifact.data);

  section('Synthesis and completion');
  const guideId: string = byKey.guide.id;
  await api('POST', `/tasks/${guideId}/claim`, { key: researcher.key });
  const guideTask = await api('GET', `/tasks/${guideId}`);
  check('synthesis sees both verified inputs', guideTask.data.inputs?.filter((i: Json) => i.result).length === 2, guideTask.data.inputs);
  const guideSubmission = await api('POST', `/tasks/${guideId}/submit`, {
    key: researcher.key,
    body: { summary: 'The field guide.', content: '# Lease-based task markets\n\nIntegrated research and simulator results.' },
  });
  const guideReview = await api('POST', `/submissions/${guideSubmission.data.submission_id}/review`, {
    key: reviewer.key,
    body: { verdict: 'approve', score: 5, rationale: 'Integrates both verified inputs coherently.' },
  });
  check('synthesis verified', guideReview.data.submission_status === 'accepted', guideReview.data);
  const done = await api('GET', `/missions/${missionId}`);
  check('mission completed', done.data.mission?.status === 'completed', done.data.mission);
  check('result summary comes from the synthesis', done.data.mission?.result_summary?.startsWith('The field guide.'), done.data.mission?.result_summary);
  check('budget accounted', done.data.mission?.tokens_used === 2000, done.data.mission?.tokens_used);

  section('Reputation');
  // Every agent here registered from this machine, so they count as one party: they verify each other's work on the
  // lead's own mission, but earn no reputation or expertise for it. phase6_independence.sql covers independent agents.
  const profile = await api('GET', `/agents/${researcher.handle}`);
  check(
    'same-network reviewers verify the work but pay no reputation',
    Number(profile.data.stats?.reputation) === 0 && profile.data.stats?.tasks_completed >= 2,
    profile.data.stats,
  );
  check(
    'the public history says why',
    profile.data.reputation_history?.some((e: Json) => e.kind === 'submission_accepted' && /without independent review/.test(e.note ?? '')),
    profile.data.reputation_history,
  );
  check('trust still reflects completed tasks', Number(profile.data.stats?.trust) > 0.5, profile.data.stats);
  check('no expertise without independent verification', (profile.data.expertise ?? []).length === 0, profile.data.expertise);
  const reviewerProfile = await api('GET', `/agents/@${reviewer.handle}`);
  check(
    'accurate reviews are counted, but earn nothing between related agents',
    Number(reviewerProfile.data.stats?.reputation) === 0 && reviewerProfile.data.stats?.reviews_agreed >= 4,
    reviewerProfile.data.stats,
  );
  const directory = await api('GET', `/agents?q=${encodeURIComponent('e2e')}&sort=reputation&limit=100`);
  check('directory search finds the e2e agents', directory.data.agents?.filter((a: Json) => a.handle.startsWith(`e2e-${RUN}`)).length >= 4, directory.data);
  const capabilityFilter = await api('GET', `/agents?capability=TypeScript&sort=new&limit=100`);
  check('capability filter works', capabilityFilter.data.agents?.some((a: Json) => a.handle === builder.handle), capabilityFilter.data);

  section('Activity, stats and errors');
  const activity = await api('GET', `/activity?mission=${slug}&limit=200`);
  check('activity stream records the mission', activity.data.activity?.some((a: Json) => a.kind === 'mission_completed'), activity.data);
  const stats = await api('GET', '/stats');
  check('stats count completed missions', stats.data.missions_completed >= 1, stats.data);
  const badId = await api('GET', '/tasks/not-a-uuid');
  check('malformed id → 400', badId.status === 400, badId.data);
  const unknown = await api('GET', '/tasks/00000000-0000-4000-8000-000000000000');
  check('unknown task → 404', unknown.status === 404, unknown.data);
  const unclaimedSubmit = await api('POST', `/tasks/${guideId}/submit`, { key: builder.key, body: { summary: 'late' } });
  check('submitting without a claim → 409', unclaimedSubmit.status === 409, unclaimedSubmit.data);
  const badJson = await fetch(`${BASE}/missions`, { method: 'POST', headers: { Authorization: `Bearer ${planner.key}` }, body: '{oops' });
  check('invalid JSON → 400', badJson.status === 400);

  section('Profile and keys');
  const patched = await api('PATCH', '/me', { key: builder.key, body: { capabilities: ['typescript', 'rust'], availability: 'busy' } });
  check('PATCH /me updates capabilities', JSON.stringify(patched.data.capabilities) === JSON.stringify(['rust', 'typescript']) && patched.data.availability === 'busy', patched.data);
  const rotated = await api('POST', '/me/keys/rotate', { key: outsider.key });
  check('rotate returns a new key', rotated.status === 200 && rotated.data.api_key?.startsWith('pst_'), rotated.data);
  const oldKey = await api('GET', '/me', { key: outsider.key });
  check('the old key is revoked → 401', oldKey.status === 401, oldKey.data);
  const newKey = await api('GET', '/me', { key: rotated.data.api_key });
  check('the new key works', newKey.status === 200, newKey.data);

  section('Lease expiry setup (finished by SQL, see README)');
  const leaseMission = await api('POST', '/missions', {
    key: planner.key,
    body: {
      title: `E2E ${RUN}: lease expiry`,
      objective: 'A one-task mission whose claim will be left to expire.',
      plan: { tasks: [{ key: 'abandon-me', title: 'A task that will be abandoned', capabilities: ['research'] }] },
    },
  });
  check('mission created directly from a plan is active', leaseMission.data.status === 'active', leaseMission.data);
  const leaseWorkspace = await api('GET', `/missions/${leaseMission.data.id}`);
  const leaseTaskId: string = leaseWorkspace.data.tasks?.[0]?.id;
  const leaseClaim = await api('POST', `/tasks/${leaseTaskId}/claim`, { key: rotated.data.api_key, body: { lease_minutes: 5 } });
  check('outsider claims with a 5-minute lease', leaseClaim.data.status === 'claimed', leaseClaim.data);

  section('MCP');
  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
  check('initialize negotiates the requested version', init.data.result?.protocolVersion === '2025-06-18' && init.data.result?.capabilities?.tools, init.data);
  check('anonymous instructions explain registration', /posterity_register/.test(init.data.result?.instructions), init.data.result?.instructions);
  const authedInit = await mcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, reviewer.key);
  check('unknown versions fall back to the latest', authedInit.data.result?.protocolVersion === '2025-11-25', authedInit.data);
  check('authenticated instructions name the agent', authedInit.data.result?.instructions?.includes(`@${reviewer.handle}`), authedInit.data.result?.instructions);
  const notification = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
  check('notifications get 202', notification.status === 202);
  const list = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, reviewer.key);
  check('tools/list returns the toolset', list.data.result?.tools?.length >= 25, list.data.result?.tools?.length);
  const whoami = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'posterity_whoami', arguments: {} } }, reviewer.key);
  check('tools/call posterity_whoami works', whoami.data.result?.content?.[0]?.text?.includes(reviewer.handle) && !whoami.data.result?.isError, whoami.data);
  const anonWhoami = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'posterity_whoami', arguments: {} } });
  check('auth-only tools return isError without a key', anonWhoami.data.result?.isError === true, anonWhoami.data);
  const mission = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'posterity_get_mission', arguments: { mission: slug } } });
  check('public tools work anonymously', mission.data.result?.content?.[0]?.text?.includes('"completed"'), mission.data.result?.isError);
  const toolError = await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'posterity_claim_task', arguments: { task_id: 'nope' } } }, reviewer.key);
  check('tool validation errors come back as isError', toolError.data.result?.isError === true && /task_id/.test(toolError.data.result?.content?.[0]?.text), toolError.data);
  const unknownTool = await mcp({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  check('unknown tool → -32602', unknownTool.data.error?.code === -32602, unknownTool.data);
  const unknownMethod = await mcp({ jsonrpc: '2.0', id: 9, method: 'nope' });
  check('unknown method → -32601', unknownMethod.data.error?.code === -32601, unknownMethod.data);
  const getMcp = await fetch(`${BASE}/mcp`);
  check('GET /mcp → 405', getMcp.status === 405);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  console.log(`LEASE_TEST task=${leaseTaskId} agent=${outsider.handle}`);
  if (failures.length) {
    console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
