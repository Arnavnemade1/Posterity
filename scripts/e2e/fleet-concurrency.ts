// Local Postgres integration and throughput probe. Requires `supabase start` with migrations applied.
// Runs real engine functions using 500 identities over a bounded 32-connection pool.
// This is database evidence, not an HTTP/realtime or production capacity certification.
// bun scripts/e2e/fleet-concurrency.ts
import { SQL } from 'bun';
import { createHash, randomBytes } from 'node:crypto';

const url = process.env.POSTERITY_LOAD_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('This write-heavy probe only accepts a local database. Use a disposable local Supabase instance.');
}
const sql = new SQL(url, { max: 32 });
const run = `load-${Date.now().toString(36)}`;
const owner = crypto.randomUUID();
const mission = crypto.randomUUID();
const agents = Array.from({ length: 500 }, () => crypto.randomUUID());
const tasks = Array.from({ length: 550 }, () => crypto.randomUUID());
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); console.log(`PASS ${message}`); }
const state = (e: unknown) => String((e as { errno?: string; sqlState?: string }).errno ?? (e as { sqlState?: string }).sqlState ?? '');
async function claim(agent: string, task: string) {
  try { const [r] = await sql`select public.claim_task(${agent}::uuid, ${task}::uuid) as result`; return { ok: true, result: r.result }; }
  catch (error) { return { ok: false, code: state(error), error }; }
}
async function benchmark(label: string, work: (i: number) => Promise<unknown>) {
  const times: number[] = []; const start = performance.now();
  await Promise.all(agents.map(async (_, i) => { const t = performance.now(); await work(i); times.push(performance.now() - t); }));
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ label, identities: agents.length, pool: 32, elapsed_ms: Math.round(performance.now() - start), p50_ms: Math.round(times[249]), p95_ms: Math.round(times[474]), p99_ms: Math.round(times[494]) }));
}
try {
  await sql`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values (${owner}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${run + '@example.invalid'}, ${JSON.stringify({ username: run.replaceAll('-', '_') })}::text::jsonb, now(), now())`;
  await sql`insert into public.profiles (id, username, display_name) values (${owner}::uuid, ${run.replaceAll('-', '_')}, 'Local scale probe') on conflict (id) do nothing`;
  await sql`insert into public.agents (id, handle, display_name, owner_id, runtime, last_seen_at)
    select id::uuid, ${run} || '-' || n, 'Load agent ' || n, ${owner}::uuid,
      (array['Claude Code','Codex','Custom Python','Cursor'])[1 + n % 4], now()
    from unnest(${'{' + agents.join(',') + '}'}::uuid[]) with ordinality as x(id, n)`;
  await sql`insert into public.agent_stats (agent_id) select id from public.agents where owner_id=${owner}::uuid on conflict do nothing`;
  await sql`insert into public.missions (id, slug, title, objective, status, created_by_user, requires_plan_approval)
    values (${mission}::uuid, ${run}, 'Local concurrency probe', 'Verify simultaneous collaboration invariants', 'active', ${owner}::uuid, false)`;
  await sql`insert into public.tasks (id, mission_id, key, title)
    select id::uuid, ${mission}::uuid, 'task-' || n, 'Concurrent task ' || n from unnest(${'{' + tasks.join(',') + '}'}::uuid[]) with ordinality as x(id,n)`;

  // Hold the stats row after claims have read capacity: the old implementation lets every
  // claimant through the count before any commits; the identity lock must limit winners to three.
  const blocker = await sql.reserve();
  let race;
  try {
    await blocker`begin`;
    await blocker`select agent_id from public.agent_stats where agent_id=${agents[0]}::uuid for update`;
    race = Promise.all(tasks.slice(0, 16).map((task) => claim(agents[0], task)));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await blocker`commit`;
  } finally { blocker.release(); }
  const capacity = await race!;
  check(capacity.filter((r) => r.ok).length === 3, '16 simultaneous claims by one identity yield exactly three assignments');
  check(capacity.filter((r) => !r.ok).every((r) => r.code === 'PT429'), 'excess claims return PT429');
  const [held] = await sql`select id from public.tasks where assignee_id=${agents[0]}::uuid limit 1`;
  const renewed = await claim(agents[0], held.id);
  check(renewed.ok && renewed.result.renewed, 'renewing an existing assignment is idempotent at capacity');

  const contenders = await Promise.all(agents.slice(1, 33).map((agent) => claim(agent, tasks[16])));
  check(contenders.filter((r) => r.ok).length === 1, '32 identities contesting one task yield exactly one winner');
  check(contenders.filter((r) => !r.ok).every((r) => r.code === 'PT409'), 'competing claims return PT409');

  await sql`update public.tasks set status='open', assignee_id=null, claimed_at=null, lease_expires_at=null where mission_id=${mission}::uuid`;
  await benchmark('claim_500', async (i) => { const r = await claim(agents[i], tasks[i]); if (!r.ok) throw r.error; });
  await benchmark('heartbeat_500', async (i) => { await sql`select public.agent_heartbeat(${agents[i]}::uuid)`; });
  const [counts] = await sql`select count(*)::int as total, count(distinct assignee_id)::int as identities from public.tasks where mission_id=${mission}::uuid and status='claimed'`;
  check(counts.total === 500 && counts.identities === 500, 'all 500 agents retain distinct, valid assignments');

  if (process.env.POSTERITY_LOAD_HTTP === '1') {
    const keys = agents.map(() => `pst_${randomBytes(24).toString('hex')}`);
    const rows = agents.map((id, i) => ({ id, hash: createHash('sha256').update(keys[i]).digest('hex'), prefix: keys[i].slice(0, 12) }));
    await sql`insert into public.agent_keys (agent_id, key_hash, prefix)
      select (x->>'id')::uuid, x->>'hash', x->>'prefix' from jsonb_array_elements(${JSON.stringify(rows)}::text::jsonb) x`;
    let index = 0;
    const latencies: number[] = [];
    const started = performance.now();
    const errors: Record<string, number> = {};
    const failures: { status: number | string; payload: unknown }[] = [];
    await Promise.all(Array.from({ length: 100 }, async () => {
      while (index < agents.length) {
        const i = index++; const start = performance.now();
        try {
          const response = await fetch('http://127.0.0.1:54321/functions/v1/api/heartbeat', {
            method: 'POST', headers: { Authorization: `Bearer ${keys[i]}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000),
          });
          const payload = await response.json() as { agent?: { id?: string }; code?: { review_requests?: unknown[] }; setup?: { heartbeats?: number }; you?: { paused?: boolean } };
          if (response.ok && (payload.agent?.id !== agents[i] || !Array.isArray(payload.code?.review_requests) || typeof payload.setup?.heartbeats !== 'number' || typeof payload.you?.paused !== 'boolean')) errors.contract = (errors.contract ?? 0) + 1;
          if (!response.ok) {
            errors[response.status] = (errors[response.status] ?? 0) + 1;
            if (failures.length < 5) failures.push({ status: response.status, payload });
          }
        } catch (error) {
          errors.network = (errors.network ?? 0) + 1;
          if (failures.length < 5) failures.push({ status: 'network', payload: String(error) });
        }
        latencies.push(performance.now() - start);
      }
    }));
    latencies.sort((a, b) => a - b);
    console.log(JSON.stringify({ label: 'http_heartbeat_500', identities: 500, concurrent_requests: 100, elapsed_ms: Math.round(performance.now() - started), p50_ms: Math.round(latencies[249]), p95_ms: Math.round(latencies[474]), p99_ms: Math.round(latencies[494]), errors, failures }));
    check(!Object.keys(errors).length, '500 full API heartbeats with 100 requests in flight complete without errors');
  }

  await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`;
    const [result] = await tx`select public.web_fleet_summary() as summary`;
    check(Object.keys(result.summary).length === 500 && Object.values(result.summary as Record<string, { tasks: number }>).every((s) => s.tasks === 1), 'fleet summary covers 500 owned identities with exact assignment counts');
    await tx`select set_config('request.jwt.claim.sub', ${crypto.randomUUID()}, true)`;
    const [other] = await tx`select public.web_fleet_summary() as summary`;
    check(Object.keys(other.summary).length === 0, 'fleet summary never exposes another owner’s identities');
  });
  const [grants] = await sql`select has_function_privilege('anon', 'public.agent_full_heartbeat(uuid,text)', 'EXECUTE') as heartbeat,
    has_function_privilege('authenticated', 'public.agent_full_heartbeat(uuid,text)', 'EXECUTE') as web_heartbeat,
    has_function_privilege('anon', 'public.web_fleet_summary()', 'EXECUTE') as fleet`;
  check(!grants.heartbeat && !grants.web_heartbeat && !grants.fleet, 'heartbeat and fleet RPCs keep their intended role boundaries');

  await sql`update public.tasks set lease_expires_at=now()-interval '1 minute' where id=${tasks[0]}::uuid`;
  check((await claim(agents[0], tasks[0])).code === 'PT409', 'expired leases cannot be renewed');
  await sql`select public.expire_leases()`;
  check((await claim(agents[0], tasks[0])).ok, 'the scheduled reaper makes expired work claimable again');
} finally {
  // Local fixture cleanup, scoped to generated IDs. Leaves unrelated local data intact.
  await sql`delete from public.missions where id=${mission}::uuid`;
  await sql`delete from public.agents where owner_id=${owner}::uuid`;
  await sql`delete from auth.users where id=${owner}::uuid`;
  await sql.close();
}
