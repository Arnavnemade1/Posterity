// Closed-testnet SQL + REST/MCP/SDK/CLI + concurrency. Never run on a remote database.
import { SQL } from 'bun';
import { rollbackFixtures } from './sql-fixtures.ts';
import { Posterity, PosterityError, sealEnsembleDraft, type CapabilityManifest } from '../../packages/sdk/src/index.ts';
import { main as cliMain } from '../../packages/cli/posterity.mjs';
const dbUrl = process.env.POSTERITY_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const baseUrl = process.env.POSTERITY_TEST_API ?? 'http://127.0.0.1:54321/functions/v1/api';
for (const url of [dbUrl, baseUrl]) if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Phase 15 requires disposable localhost services');
const sql = new SQL(dbUrl, { max: 8 });
const run = 'p15-' + Date.now().toString(36); const agents: string[] = []; const owners: string[] = []; const tasks: string[] = [];
let epoch: string | undefined; let mission: string | undefined; let checks = 0;
const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks++; console.log('PASS ' + label); };
async function denied(action: () => Promise<unknown>, status: number) {
  try { await action(); return false; } catch (error) { return error instanceof PosterityError && error.status === status; }
}
async function actor(n: number) {
  const manifest: CapabilityManifest = { schema_version: 1, lab: 'test-lab', models: ['fixture'], capabilities: ['analysis'], tools: [], languages: ['en'],
    context_window: 32000, strengths: [], roles: ['proposer','critic','synthesizer'] };
  const [r] = await sql`select public.register_manifest_agent(${'198.19.15.'+n},${run+'-'+n},p_manifest=>${JSON.stringify(manifest)}::text::jsonb) as result`;
  agents.push(r.result.agent.id);
  const [owner] = await sql`insert into auth.users(id,email) values(gen_random_uuid(),${run+'-'+n+'@fixture.invalid'}) returning id`;
  owners.push(owner.id); await sql`update public.agents set owner_id=${owner.id}::uuid where id=${r.result.agent.id}::uuid`;
  return { id: r.result.agent.id as string, key: r.result.api_key as string, client: new Posterity({ apiKey: r.result.api_key, baseUrl, retries: 0 }) };
}
async function task(key: string, ensemble = false) {
  const value = { key, title: 'Closed testnet '+key, kind: 'analysis', capabilities: ['analysis'], acceptance_criteria: 'Independently verified test evidence',
    ...(ensemble ? { ensemble: { distinct_labs: false, roles: [{role:'proposer'},{role:'critic'},{role:'synthesizer'}] } } : {}) };
  const [t] = await sql`select public.insert_task_from_json(${mission}::uuid,${JSON.stringify(value)}::text::jsonb,'open') as id`;
  tasks.push(t.id); await sql`select public.bind_trust_task(${t.id}::uuid,${ensemble})`; return t.id as string;
}
try {
  await sql`update public.app_config set value='http://supabase_kong_posterity:8000/functions/v1/api' where key='api_url'`;
  await rollbackFixtures(dbUrl,[new URL('phase15.sql',import.meta.url)]); check(true, 'rollback-only adversarial SQL contract');
  const [a,b,c] = await Promise.all([actor(1),actor(2),actor(3)]);
  const status = await a.client.trust.status();
  check(status.stage==='15.0-testnet' && !status.permissionless && status.blocked_stages.length===3, 'permissionless activation fails closed');
  check(status.custody==='test_units' && status.epoch===null, 'migration installs no epoch or real custody');
  check((await fetch(baseUrl+'/me/trust/enroll',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status===401, 'anonymous enrollment refused');
  check(await denied(()=>a.client.trust.enroll(),409), 'no enrollment without an active declared epoch');
  const [ep] = await sql`insert into public.trust_epochs(starts_at,ends_at,stake_units,escrow_units,dispute_seconds,reward_cap,operator,reason)
    values(now()-interval '1 day',now()+interval '1 day',100,60,60,5,'local-auditor','Privileged transport test clock fixture') returning id`;
  epoch = ep.id;
  await Promise.all([a.client.trust.enroll(),b.client.trust.enroll(),c.client.trust.enroll()]);
  for (const person of [a,b,c]) await sql`select public.credit_trust_test_units(${person.id}::uuid,100,${run+'-'+person.id},'local-auditor')`;
  check((await a.client.trust.account()).account?.balance===100, 'SDK exposes exact non-monetary test balance');
  const [m] = await sql`insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,review_quorum,requires_final_approval)
    values(${run},'Closed testnet transport','Verify staged trust boundaries','active',${a.id}::uuid,${a.id}::uuid,1,false) returning id`;
  mission = m.id;
  const first = await task('first'); const second = await task('second');
  const claims = await Promise.all([first,second].map(async id => {
    try { return { status:200, result:await a.client.tasks.claim(id) }; }
    catch(error) { return { status:error instanceof PosterityError ? error.status : 0 }; }
  }));
  check(claims.filter(s=>s.status===200).length===1 && claims.filter(s=>s.status===409).length===1, 'concurrent claims cannot spend the same escrow twice');
  const account = await a.client.trust.account({limit:1});
  check(account.escrows.length===1 && account.escrows[0].units===60 && account.events.length===1, 'escrow and history pagination remain exact after concurrent claims');
  const listed = await a.client.tasks.available({mission});
  check(listed.tasks.some(t=>t.trust_contract?.regime==='attested_staked_testnet'), 'task discovery declares trust regime before claiming');
  // A full task read also starts the existing on-device embedding model; this suite
  // isolates the trust contract from that unrelated runtime/CPU dependency.
  check(claims.find(s=>s.status===200)?.result?.trust_contract?.epoch_id===epoch, 'claim response pins the immutable epoch');
  await sql`select public.credit_trust_test_units(${a.id}::uuid,100,${run+'-more'},'local-auditor')`;
  const team = await task('team',true); const [en] = await sql`select id from public.ensembles where task_id=${team}::uuid`;
  const eid = en.id as string;
  await a.client.ensembles.join(eid,'proposer'); await b.client.ensembles.join(eid,'critic'); await c.client.ensembles.join(eid,'synthesizer');
  const view = await a.client.ensembles.get(eid);
  check(view.trust_contract?.sealed===true, 'ensemble evidence declares sealed regime');
  const actors = [a,b,c]; const kinds = ['draft','objection','synthesis'] as const;
  const sealed = await Promise.all(actors.map((person,i)=>sealEnsembleDraft({ ensemble_id:eid, round:1,
    member_id:view.members.find(m=>m.agent_id===person.id && m.state==='active')!.id, kind:kinds[i], summary:' Initial π '+i+' ', content:'Exact UTF-8\n🧪 '+i })));
  const [digest] = await sql`select public.sealed_text_digest(${eid}::uuid,1,${view.members.find(m=>m.agent_id===a.id)!.id}::uuid,'draft',${sealed[0].summary},${sealed[0].content},${sealed[0].nonce}) as value`;
  check(digest.value===sealed[0].digest, 'SDK and PostgreSQL agree on Unicode commitment bytes');
  await a.client.ensembles.commit(eid,1,sealed[0].digest);
  check(await denied(()=>a.client.ensembles.reveal(eid,sealed[0]),409), 'REST blocks reveal before all commitments');
  const headers = {Authorization:`Bearer ${b.key}`,'content-type':'application/json',accept:'application/json'};
  const committed = await fetch(baseUrl+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'posterity_ensemble',arguments:{action:'commit',ensemble_id:eid,round:1,digest:sealed[1].digest}}})});
  const committedResult = await committed.json() as any;
  check(!committedResult.result?.isError && committedResult.result?.content?.length, 'MCP uses the same sealed commitment engine');
  await c.client.ensembles.commit(eid,1,sealed[2].digest);
  check(await denied(()=>a.client.ensembles.reveal(eid,{...sealed[0],content:'Mutated content'}),400), 'REST rejects changed committed text');
  const revealed = await Promise.all(actors.map((person,i)=>person.client.ensembles.reveal(eid,sealed[i])));
  check(new Set(revealed.map(r=>r.id)).size===3, 'serialized concurrent reveals preserve all three initial drafts');
  check((await a.client.ensembles.reveal(eid,sealed[0])).id===revealed[0].id, 'lost reveal response can be retried idempotently');
  await b.client.ensembles.score(revealed[0].id,5,'Independent reviewer considered this exact committed draft');
  const complete = await a.client.ensembles.get(eid);
  check(complete.commitments?.every(c=>c.revealed_at && c.nonce) && complete.contributions.length===3, 'public evidence includes all commitments and revealed bytes');
  const [opened] = await sql`select public.open_trust_case(${a.id}::uuid,${account.escrows[0].task_id}::uuid,'correlation',${'a'.repeat(64)},'https://fixtures.invalid/p15-transport','local-auditor') as result`;
  const caseId = opened.result.id as string;
  await sql`select public.decide_trust_case(${caseId}::uuid,true,40,'attested-reserve','Confirmed after attested test evidence review')`;
  check(await denied(()=>b.client.trust.appeal(caseId,'Attempt to appeal another identity case'),404), 'SDK appeal cannot impersonate another identity');
  const appealed = await a.client.trust.appeal(caseId,'The correlation evidence has a reproducible confound');
  check(appealed.appeal!==null && appealed.resolved_at===null, 'own appeal records a pending attested resolution');
  check(await denied(()=>a.client.trust.release(),409), 'pending appeal blocks release through REST');
  await sql`select public.resolve_trust_appeal(${caseId}::uuid,false,'appeal-reserve','Attested appeal verified the evidence confound')`;
  check((await a.client.trust.account()).account?.balance===200, 'appeal restores exactly the slashed test units');
  const full = await a.client.trust.account({limit:100}); let previous='0'.repeat(64); let sequence=0;
  for (const event of full.events) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(event.canonical))), b=>b.toString(16).padStart(2,'0')).join('');
    check(event.hash===hash && event.previous_hash===previous && event.sequence===++sequence, 'transport event chain '+event.sequence);
    previous=event.hash;
  }
  check(full.head===previous, 'portable history head matches independently verified chain');
  const output:string[]=[];
  const exit = await cliMain(['trust','status','--json'],{env:{POSTERITY_API:baseUrl,POSTERITY_CONFIG_DIR:`/tmp/${run}`},out:(s:string)=>output.push(s),err:(s:string)=>{throw new Error(s);}});
  check(exit===0 && JSON.parse(output[0]).custody==='test_units', 'CLI exposes the same fail-closed regime without credentials');
  const toolsResponse = await fetch(baseUrl+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})});
  check((await toolsResponse.json() as any).result.tools.some((t:any)=>t.name==='posterity_trust'), 'MCP discovers staged trust contract');
  const openapi = await a.client.openapi();
  check(Boolean(openapi.paths['/me/trust/enroll'] && openapi.paths['/ensembles/{ensemble_id}/reveal']), 'OpenAPI exposes both staged trust and sealed drafts');
  await sql`update public.agents set paused_at=now() where id=${c.id}::uuid`;
  let paused = false;
  try { await c.client.ensembles.contribute(eid,{kind:'synthesis',summary:'Paused write',content:'This must be refused'}); }
  catch(error) { paused = error instanceof PosterityError && [403,423].includes(error.status); }
  check(paused, 'owner pause blocks contributions despite cached identity reads');
  console.log(`PASS ${checks} Phase 15 transport/security checks plus adversarial SQL assertions`);
} finally {
  // Immutable production history has no delete API. Only this localhost fixture owner
  // bypasses guards to remove its own exact test IDs, never unrelated trust records.
  await sql.begin(async tx=>{
    await tx`set local session_replication_role='replica'`;
    const actorIds='{'+agents.join(',')+'}'; const taskIds='{'+tasks.join(',')+'}';
    await tx`delete from public.ensemble_commitments where ensemble_id in(select id from public.ensembles where task_id=any(${taskIds}::uuid[]))`;
    await tx`delete from public.trust_events where agent_id=any(${actorIds}::uuid[])`;
    await tx`delete from public.trust_receipts where agent_id=any(${actorIds}::uuid[])`;
    await tx`delete from public.trust_cases where agent_id=any(${actorIds}::uuid[])`;
    await tx`delete from public.trust_escrows where agent_id=any(${actorIds}::uuid[])`;
    await tx`delete from public.trust_tasks where task_id=any(${taskIds}::uuid[])`;
    await tx`delete from public.trust_accounts where agent_id=any(${actorIds}::uuid[])`;
    if(epoch)await tx`delete from public.trust_epochs where id=${epoch}::uuid`;
  });
  if(mission)await sql`delete from public.missions where id=${mission}::uuid`;
  if(agents.length)await sql`delete from public.agents where id=any(${'{'+agents.join(',')+'}'}::uuid[])`;
  if(owners.length)await sql`delete from auth.users where id=any(${'{'+owners.join(',')+'}'}::uuid[])`;
  await sql.close();
}
