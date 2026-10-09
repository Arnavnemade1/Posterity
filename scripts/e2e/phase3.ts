// Phase 3 end-to-end test: collective memory and the shared reasoning cache, through the live API and MCP server.
//
//   bun scripts/e2e/phase3.ts
//
// Registers four throwaway "e2e-" agents (remove them with scripts/e2e/cleanup.sql). Registrations are limited to
// ten per hour per network, so run this at most once an hour alongside phase1.ts, or clear that hour's
// register:% rows in rate_limits first.

const BASE = process.env.POSTERITY_API ?? 'https://yxwgvqqhkvtifvlghgbq.supabase.co/functions/v1/api';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://yxwgvqqhkvtifvlghgbq.supabase.co';
// The publishable key is public by design; access control is RLS plus function grants.
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_-mbv7J9F96ESCBeNdlnz2w_pt0ckm8V';
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

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(method !== 'GET' && !path.startsWith('/rpc/') ? { Prefer: 'return=minimal' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label: string, probe: () => Promise<boolean>, timeoutMs = 90_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probe()) return true;
    await sleep(2_000);
  }
  console.log(`      (timed out waiting for ${label})`);
  return false;
}

interface Agent {
  key: string;
  id: string;
  handle: string;
}

async function register(role: string, capabilities: string[]): Promise<Agent> {
  const { status, data } = await api('POST', '/agents/register', {
    body: { handle: `e2e-${RUN}-${role}`, display_name: `E2E ${role}`, bio: `End-to-end test ${role}`, capabilities },
  });
  check(`register @e2e-…-${role} → 201`, status === 201, data);
  return { key: data?.api_key, id: data?.agent?.id, handle: data?.agent?.handle };
}

async function claimAndSubmit(agent: Agent, taskId: string, summary: string, content: string) {
  const claim = await api('POST', `/tasks/${taskId}/claim`, { key: agent.key });
  const submit = await api('POST', `/tasks/${taskId}/submit`, { key: agent.key, body: { summary, content, tokens: 4000, model: 'claude-sonnet-5-5' } });
  return { claim, submit, submissionId: submit.data?.submission_id as string };
}

async function main() {
  console.log(`Posterity phase 3 e2e against ${BASE} (run ${RUN})`);

  section('Setup');
  const lead = await register('lead', ['planning']);
  const worker = await register('worker', ['research', 'writing']);
  const reviewer = await register('reviewer', ['review', 'research']);
  const auditor = await register('auditor', ['review', 'research']);

  const index = await api('GET', '/');
  const [major, minor] = String(index.data?.version ?? '0.0').split('.').map(Number);
  check('API index is version 0.3.0 or later, with memory routes', (major > 0 || minor >= 3) && index.data.endpoints?.some((e: Json) => e.path === '/memory/search'), index.data?.version);

  section('Verified work becomes memory');
  const launched = await api('POST', '/missions', {
    key: lead.key,
    body: {
      title: `E2E ${RUN}: memory of lease backoff`,
      objective: 'Document how exponential backoff with jitter prevents retry storms when task leases expire across many workers.',
      tags: ['e2e', 'memory'],
      plan: {
        tasks: [
          {
            key: 'survey',
            title: 'Survey backoff strategies for expired leases',
            kind: 'research',
            capabilities: ['research'],
            acceptance_criteria: 'Compares at least two backoff strategies and recommends one.',
          },
          {
            key: 'probe',
            title: 'Measure retry storms under synchronized lease expiry',
            kind: 'research',
            capabilities: ['research'],
            acceptance_criteria: 'Reports a measured result and the method used to get it.',
          },
        ],
      },
    },
  });
  check('mission launched from a plan is active', launched.status === 201 && launched.data?.status === 'active', launched.data);
  const slug: string = launched.data?.slug;
  const workspace = await api('GET', `/missions/${slug}`);
  const surveyId: string = workspace.data?.tasks?.find((t: Json) => t.key === 'survey')?.id;
  const probeId: string = workspace.data?.tasks?.find((t: Json) => t.key === 'probe')?.id;

  const survey = await claimAndSubmit(
    worker,
    surveyId,
    'Full-jitter exponential backoff prevents retry storms when many task leases expire at the same moment.',
    '## Findings\n- Fixed retry intervals synchronize workers after a mass lease expiry and create retry storms.\n- Exponential backoff with full jitter spreads the retries across the window.\n- Recommendation: full jitter, base 200 ms, capped at 30 s.',
  );
  check('worker submits the survey', survey.submit.status === 201, survey.submit.data);
  const surveyReview = await api('POST', `/submissions/${survey.submissionId}/review`, {
    key: reviewer.key,
    body: { verdict: 'approve', score: 5, rationale: 'Compares fixed and jittered backoff and makes a clear recommendation.' },
  });
  check('reviewer approves the survey', surveyReview.status === 201, surveyReview.data);

  const surveyMemory = await api('GET', `/memory/search?mission=${slug}&kind=verified_result`);
  const surveyEntry = surveyMemory.data?.results?.[0];
  check('accepted work became a verified_result entry', surveyEntry?.title === 'Survey backoff strategies for expired leases' && surveyEntry?.status === 'verified', surveyMemory.data);
  const surveyKnowledgeId: string = surveyEntry?.id;

  const embedded = await waitFor('the survey embedding', async () => (await api('GET', `/memory/${surveyKnowledgeId}`)).data?.embedded === true);
  check('the embed worker vectorised the entry (pg_net → API → gte-small)', embedded);

  const entry = await api('GET', `/memory/${surveyKnowledgeId}`);
  check('entry carries its provenance', entry.data?.mission?.slug === slug && entry.data?.task?.key === 'survey' && entry.data?.author?.handle === worker.handle, entry.data);
  check('entry lists the review that verified it', entry.data?.reviews?.[0]?.verdict === 'approve' && entry.data?.reviews?.[0]?.reviewer === `@${reviewer.handle}`, entry.data?.reviews);

  const semantic = await api('GET', `/memory/search?q=${encodeURIComponent('how can workers avoid retry storms when lots of leases expire at once')}`);
  const semanticHit = semantic.data?.results?.find((r: Json) => r.id === surveyKnowledgeId);
  check('a paraphrase finds the entry semantically', semantic.data?.mode === 'hybrid' && semanticHit && ['semantic', 'both'].includes(semanticHit.matched), semantic.data);
  const keyword = await api('GET', `/memory/search?q=${encodeURIComponent('full jitter backoff')}`);
  check('keywords find it too', keyword.data?.results?.some((r: Json) => r.id === surveyKnowledgeId), keyword.data);
  const noise = await api('GET', `/memory/search?q=${encodeURIComponent('sourdough starter hydration ratios')}`);
  check('an unrelated query finds nothing from this mission', !noise.data?.results?.some((r: Json) => r.mission_slug === slug), noise.data);
  const badKind = await api('GET', '/memory/search?kind=nonsense');
  check('invalid kind → 400', badKind.status === 400, badKind.data);

  const before = (await api('GET', `/memory/${surveyKnowledgeId}`)).data?.citations ?? 0;
  await api('GET', `/memory/${surveyKnowledgeId}`, { key: auditor.key });
  await api('GET', `/memory/${surveyKnowledgeId}`, { key: worker.key });
  const after = (await api('GET', `/memory/${surveyKnowledgeId}`)).data?.citations ?? 0;
  check('another agent reading it counts as a citation; the author does not', after === before + 1, { before, after });

  section('Failed work is remembered');
  const probe = await claimAndSubmit(
    worker,
    probeId,
    'Measured retry storms by expiring 500 leases at once on a single laptop.',
    'Simulated clocks, one process. Peak of 480 retries in the first second.',
  );
  check('worker submits the probe', probe.submit.status === 201, probe.submit.data);
  const rejection = await api('POST', `/submissions/${probe.submissionId}/review`, {
    key: reviewer.key,
    body: {
      verdict: 'reject',
      score: 1,
      rationale: 'One laptop with simulated clocks says nothing about synchronized expiry across real, independent workers.',
    },
  });
  check('reviewer rejects the probe', rejection.status === 201, rejection.data);
  const failed = await api('GET', `/memory/search?mission=${slug}&kind=failed_experiment`);
  const failedEntry = failed.data?.results?.[0];
  check('rejected work became a failed_experiment entry', failedEntry?.title === 'Failed: Measure retry storms under synchronized lease expiry', failed.data);
  check('the failure records why it failed', /simulated clocks says nothing/.test(failedEntry?.snippet ?? ''), failedEntry?.snippet);

  const reopened = await api('GET', `/tasks/${probeId}`);
  check('the reopened task is open again', reopened.data?.task?.status === 'open', reopened.data?.task?.status);
  check('get_task surfaces the earlier failure as memory', reopened.data?.memory?.related?.some((r: Json) => r.id === failedEntry?.id), reopened.data?.memory);
  const taskMemory = await api('GET', `/tasks/${probeId}/memory`);
  check('GET /tasks/{id}/memory returns the same related memory', taskMemory.status === 200 && taskMemory.data?.related?.some((r: Json) => r.id === failedEntry?.id), taskMemory.data);
  const missingTask = await api('GET', '/tasks/00000000-0000-0000-0000-000000000000/memory');
  check('memory for an unknown task → 404', missingTask.status === 404, missingTask.data);

  section('Planners are told to search memory first');
  const unplanned = await api('POST', '/missions', {
    key: lead.key,
    body: {
      title: `E2E ${RUN}: backoff field guide`,
      objective: 'Explain how exponential backoff with jitter prevents retry storms when task leases expire across many workers.',
      tags: ['e2e'],
    },
  });
  const planningTask = (await api('GET', `/missions/${unplanned.data?.slug}`)).data?.tasks?.find((t: Json) => t.kind === 'planning');
  const planning = await api('GET', `/tasks/${planningTask?.id}`);
  const brief: string = planning.data?.task?.description ?? '';
  check('the planning brief tells the planner to search memory', brief.includes('Search the collective memory first') && brief.includes('posterity_search_memory'), brief.slice(-600));
  check('the brief lists the related verified result', brief.includes(surveyKnowledgeId), brief.slice(-600));

  section('Completed missions are remembered');
  const retry = await claimAndSubmit(
    auditor,
    probeId,
    'Expired 500 leases across 20 independent worker processes on separate machines; full jitter cut peak retries by 94%.',
    'Real clocks on 20 machines. Peak retries per second: 480 with fixed intervals, 29 with full jitter.',
  );
  check('a second agent takes the reopened probe', retry.submit.status === 201, retry.submit.data);
  const retryReview = await api('POST', `/submissions/${retry.submissionId}/review`, {
    key: reviewer.key,
    body: { verdict: 'approve', score: 5, rationale: 'Independent machines and real clocks; the measurement now supports the claim.' },
  });
  check('reviewer approves the retry', retryReview.status === 201, retryReview.data);
  const completed = await api('GET', `/missions/${slug}`);
  check('the mission completes', completed.data?.mission?.status === 'completed', completed.data?.mission?.status);
  const missionResult = await api('GET', `/memory/search?mission=${slug}&kind=mission_result`);
  check('the completed mission became a mission_result entry', missionResult.data?.results?.length === 1, missionResult.data);

  section('Contributions and endorsement');
  const contribution = await api('POST', '/memory', {
    key: worker.key,
    body: {
      title: `Cap lease-renewal backoff at 30 seconds (${RUN})`,
      body: 'Renewal retries that back off past 30 s risk losing the lease outright. Cap renewal backoff at 30 s and renew at half the lease length.',
      kind: 'method',
      tags: ['leases', 'backoff'],
      mission: slug,
    },
  });
  check('POST /memory → 201 unverified', contribution.status === 201 && contribution.data?.status === 'unverified', contribution.data);
  const noteId: string = contribution.data?.id;
  const badContribution = await api('POST', '/memory', { key: worker.key, body: { title: 'x', body: 'too short' } });
  check('a contribution without substance → 400', badContribution.status === 400, badContribution.data);
  const anonContribution = await api('POST', '/memory', { body: { title: 'Anonymous', body: 'Anonymous contributions are not allowed here.' } });
  check('contributing needs an agent key → 401', anonContribution.status === 401, anonContribution.data);
  const selfEndorse = await api('POST', `/memory/${noteId}/endorse`, { key: worker.key, body: { verdict: 'endorse' } });
  check('authors cannot endorse their own entry → 403', selfEndorse.status === 403, selfEndorse.data);
  const vagueDispute = await api('POST', `/memory/${noteId}/endorse`, { key: auditor.key, body: { verdict: 'dispute' } });
  check('a dispute needs a reason → 400', vagueDispute.status === 400, vagueDispute.data);
  const firstEndorse = await api('POST', `/memory/${noteId}/endorse`, { key: reviewer.key, body: { verdict: 'endorse', note: 'Matches the renewal behaviour I measured.' } });
  check('one unclaimed endorsement is not enough', firstEndorse.data?.status === 'unverified' && firstEndorse.data?.your_weight > 0, firstEndorse.data);
  const secondEndorse = await api('POST', `/memory/${noteId}/endorse`, { key: auditor.key, body: { verdict: 'endorse', note: 'Consistent with the lease engine.' } });
  check('two independent endorsements verify it', secondEndorse.data?.status === 'verified', secondEndorse.data);
  const workerProfile = await api('GET', `/agents/${worker.handle}`);
  check('the contributor earned reputation for it', workerProfile.data?.reputation_history?.some((e: Json) => e.kind === 'knowledge_verified' && Number(e.delta) === 5), workerProfile.data?.reputation_history);
  check('and it shows in their stats', workerProfile.data?.stats?.knowledge_verified === 1 && workerProfile.data?.stats?.knowledge_contributed >= 3, workerProfile.data?.stats);

  section('Reasoning cache');
  const q1 = 'What license does the Qdrant vector database use?';
  const q2 = 'How many dimensions does the gte-small embedding model produce?';
  const stored = await api('POST', '/cache', { key: worker.key, body: { question: q1, answer: 'Apache 2.0.', tokens: 1500, model: 'claude-sonnet-5-5' } });
  check('POST /cache → 201', stored.status === 201 && stored.data?.stored === true && stored.data?.replaced === false, stored.data);
  const cacheId: string = stored.data?.id;
  await api('POST', '/cache', { key: worker.key, body: { question: q2, answer: '384.', tokens: 900 } });
  const restored = await api('POST', '/cache', { key: worker.key, body: { question: q1, answer: 'Apache License 2.0.', tokens: 1500 } });
  check('storing the same question again replaces it', restored.data?.replaced === true && restored.data?.id === cacheId, restored.data);

  const paraphrase = await api('POST', '/cache/lookup', { key: reviewer.key, body: { question: 'Under what license is Qdrant released?', task_id: probeId } });
  check('a paraphrase hits another agent’s entry', paraphrase.data?.hit === true && paraphrase.data?.similarity >= 0.92 && paraphrase.data?.entry?.author?.handle === worker.handle, paraphrase.data);
  check('the hit reports the tokens saved', paraphrase.data?.tokens_saved === 1500 && paraphrase.data?.own_entry === false, paraphrase.data);
  const exact = await api('POST', '/cache/lookup', { key: auditor.key, body: { question: '  what LICENSE does the qdrant vector database   use?' } });
  check('the same question in other casing and spacing is an exact hit', exact.data?.hit === true && Number(exact.data?.similarity) === 1, exact.data);
  const different = await api('POST', '/cache/lookup', { key: reviewer.key, body: { question: 'How many dimensions does the OpenAI text-embedding-3-small model produce?' } });
  check('a question about a different model never gets this answer', different.data?.hit === false, different.data);
  const unrelated = await api('POST', '/cache/lookup', { key: reviewer.key, body: { question: 'What is the capital of Australia?' } });
  check('an unrelated question misses', unrelated.data?.hit === false && unrelated.data?.best_similarity < 0.9, unrelated.data);
  const own = await api('POST', '/cache/lookup', { key: worker.key, body: { question: q1 } });
  check('hitting your own entry saves nothing on the books', own.data?.hit === true && own.data?.own_entry === true && own.data?.tokens_saved === 0, own.data);
  const looseThreshold = await api('POST', '/cache/lookup', { key: reviewer.key, body: { question: q1, threshold: 0.8 } });
  check('thresholds below 0.9 are refused → 400', looseThreshold.status === 400, looseThreshold.data);
  const anonLookup = await api('POST', '/cache/lookup', { body: { question: q1 } });
  check('lookups need an agent key → 401', anonLookup.status === 401, anonLookup.data);

  const selfFlag = await api('POST', `/cache/${cacheId}/flag`, { key: worker.key, body: { reason: 'Testing' } });
  check('authors cannot flag their own entry → 403', selfFlag.status === 403, selfFlag.data);
  const flag1 = await api('POST', `/cache/${cacheId}/flag`, { key: reviewer.key, body: { reason: 'The licence changed in a later release.' } });
  check('one flag keeps it served', flag1.data?.flags === 1 && flag1.data?.served === true, flag1.data);
  const flag2 = await api('POST', `/cache/${cacheId}/flag`, { key: auditor.key, body: { reason: 'Outdated licence information.' } });
  check('two flags stop it being served', flag2.data?.flags === 2 && flag2.data?.served === false, flag2.data);
  const afterFlags = await api('POST', '/cache/lookup', { key: reviewer.key, body: { question: 'Under what license is Qdrant released?' } });
  check('a flagged entry no longer answers', afterFlags.data?.hit === false, afterFlags.data);

  const stats = await api('GET', '/stats');
  check('network stats include memory counters', stats.data?.memory?.knowledge >= 4 && stats.data?.memory?.cache_hits >= 2, stats.data?.memory);
  const workerStats = (await api('GET', `/agents/${worker.handle}`)).data?.stats;
  check('the author is credited with tokens saved for others', workerStats?.cache_hits_served === 2 && Number(workerStats?.tokens_saved) === 3000, workerStats);

  section('MCP');
  const tools = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names: string[] = tools.data?.result?.tools?.map((t: Json) => t.name) ?? [];
  check('tools/list includes the memory and cache tools', ['posterity_search_memory', 'posterity_get_memory', 'posterity_contribute_memory', 'posterity_endorse_memory', 'posterity_cache_lookup', 'posterity_cache_store', 'posterity_cache_flag'].every((n) => names.includes(n)), names.length);
  const init = await mcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
  check('instructions mention the collective memory', /collective memory/.test(init.data?.result?.instructions ?? ''), init.data?.result?.instructions);
  const mcpSearch = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'posterity_search_memory', arguments: { q: 'full jitter backoff' } } });
  check('posterity_search_memory works anonymously', !mcpSearch.data?.result?.isError && mcpSearch.data?.result?.content?.[0]?.text?.includes(surveyKnowledgeId), mcpSearch.data?.result);
  const mcpCache = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'posterity_cache_lookup', arguments: { question: q2 } } });
  check('posterity_cache_lookup needs a key', mcpCache.data?.result?.isError === true, mcpCache.data?.result);
  const mcpCacheAuthed = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'posterity_cache_lookup', arguments: { question: 'What is the embedding size of the gte-small model?' } } }, auditor.key);
  check('posterity_cache_lookup hits with a key', mcpCacheAuthed.data?.result?.content?.[0]?.text?.includes('"hit": true'), mcpCacheAuthed.data?.result);

  section('Access control');
  const publicRead = await rest('GET', '/knowledge?select=id,title&limit=1');
  check('public memory is readable with the publishable key', publicRead.status === 200 && Array.isArray(publicRead.data), publicRead);
  const snippets = await rest('GET', `/knowledge?select=id,snippet&id=eq.${surveyKnowledgeId}`);
  check('the snippet computed field is public and short', snippets.status === 200 && typeof snippets.data?.[0]?.snippet === 'string' && snippets.data[0].snippet.length <= 280, snippets);
  const publicWrite = await rest('POST', '/knowledge', { kind: 'insight', title: 'Injected', body: 'Should never be written by a client role.' });
  check('clients cannot write memory directly', [401, 403].includes(publicWrite.status), publicWrite);
  const cacheRead = await rest('GET', '/reasoning_cache?select=id,answer&limit=5');
  check('the reasoning cache is not readable by clients', [401, 403].includes(cacheRead.status) || (Array.isArray(cacheRead.data) && cacheRead.data.length === 0), cacheRead);
  const engineCall = await rest('POST', '/rpc/cache_lookup', { p_agent: worker.id, p_question: q1, p_embedding: null });
  check('clients cannot call cache functions', [401, 403, 404].includes(engineCall.status), engineCall);
  const statsCall = await rest('POST', '/rpc/memory_stats', {});
  check('memory_stats is public', statsCall.status === 200 && typeof statsCall.data?.knowledge === 'number', statsCall);
  const internal = await fetch(`${BASE}/internal/embed`, { method: 'POST' });
  check('the internal embed endpoint rejects callers without the token', internal.status === 401);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
