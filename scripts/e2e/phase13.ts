// Disposable localhost integration: real SQL, REST, MCP discovery, and native adapters.
import { SQL } from 'bun';
import { main as cliMain } from '../../packages/cli/posterity.mjs';
import { Posterity, PosterityError, responsesEnsembleAdapter, mcpEnsembleAdapter, cliEnsembleAdapter, type CapabilityManifest, type EnsembleRole } from '../../packages/sdk/src/index.ts';
const dbUrl = process.env.POSTERITY_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const baseUrl = process.env.POSTERITY_TEST_API ?? 'http://127.0.0.1:54321/functions/v1/api';
for (const url of [dbUrl,baseUrl]) if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('This fixture writer requires localhost');
const sql = new SQL(dbUrl,{ max: 20 });
const run = `p13-${Date.now().toString(36)}`;
const ids: string[] = []; let mission: string | undefined; let assertions=0;
function check(value: unknown,label: string) { if (!value) throw new Error(label); assertions++; console.log(`PASS ${label}`); }
const manifest = (lab: string,roles: EnsembleRole[]): CapabilityManifest => ({ schema_version: 1,lab,roles,models:['unknown-future-model'],tools:[],languages:['en'],capabilities:['analysis'],context_window:32000,strengths:['verification'] });
async function agent(n: number,role: EnsembleRole) {
  const [r] = await sql`select public.register_manifest_agent(${`198.51.${Math.floor(n/200)}.${n%200+1}`},${run+'-'+n},p_manifest=>${JSON.stringify(manifest('lab-'+n,[role]))}::text::jsonb) as result`;
  const id=r.result.agent.id as string; ids.push(id);
  await sql`select public.record_lab_verification(${id}::uuid,${'lab-'+n},${JSON.stringify(['unknown-future-model'])}::text::jsonb,'https://fixtures.invalid/evidence',${'a'.repeat(64)},'local-test-operator',now()+interval '1 day')`;
  return { id, key:r.result.api_key as string, client: new Posterity({ apiKey:r.result.api_key, baseUrl,retries:0 }) };
}
const spec = { roles:[{role:'proposer'},{role:'critic'},{role:'synthesizer'}],distinct_labs:true };
async function task(key: string, specification = spec) {
  const [r] = await sql`select public.insert_task_from_json(${mission}::uuid,${JSON.stringify({key,title:'Ensemble analysis '+key,kind:'analysis',capabilities:['analysis'],acceptance_criteria:'Check boundary cases',ensemble:specification})}::text::jsonb,'open') as id`;
  const [e] = await sql`select id from public.ensembles where task_id=${r.id}::uuid`;
  return { id:r.id as string,eid:e.id as string };
}
try {
  await sql`update public.app_config set value='http://supabase_kong_posterity:8000/functions/v1/api' where key='api_url'`;
  await sql.unsafe(await Bun.file(new URL('phase13_release.sql',import.meta.url)).text());
  await sql.unsafe(await Bun.file(new URL('phase13-contribution-starvation.sql',import.meta.url)).text());
  await sql.unsafe(await Bun.file(new URL('phase13-cr-independence.sql',import.meta.url)).text());
  await sql.unsafe(await Bun.file(new URL('phase13.sql',import.meta.url)).text());
  check(true,'transactional engine assertions');
  const nativeRegistration = await Posterity.register({ handle: run+'-native', manifest: manifest('new-lab',['specialist']) }, { baseUrl });
  ids.push(nativeRegistration.result.agent.id);
  const published=await nativeRegistration.client.agents.manifest();
  check(published.manifest?.lab === 'new-lab','new agent registers using only a manifest');
  check(published.lab_identity?.status === 'self_declared','REST reports unverified provider claims honestly');
  check((await nativeRegistration.client.ensembles.labs()).execution_attested === false,'public roster exposes operator trust limit');
  const [a,b,c,d] = await Promise.all([agent(1,'proposer'),agent(2,'critic'),agent(3,'synthesizer'),agent(4,'critic')]);
  const publicIdentity=await fetch(baseUrl+'/agents/'+run+'-1').then(r=>r.json()) as any;
  check(publicIdentity.lab_identity?.status==='operator_verified','public agent profile distinguishes verified provider identity');
  const [m] = await sql`insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,review_quorum,requires_final_approval) values(${run},'Native protocol ensemble','Verify real transports','active',${d.id}::uuid,${d.id}::uuid,1,false) returning id`;
  mission=m.id;
  const t=await task('transport');
  const contested=await task('contested'); // Keep the mission active for contention probes.
  const nativeRole=await task('native-manifest',{roles:[...spec.roles,{role:'specialist'}],distinct_labs:false});
  const nativeInbox=await nativeRegistration.client.heartbeat();
  check(nativeInbox.ensembles?.assignments.some((r)=>r.ensemble_id===nativeRole.eid&&r.role==='specialist'),'manifest-only REST registration receives a role in one heartbeat');
  for (const [actor,role] of [[a,'proposer'],[b,'critic'],[c,'synthesizer']] as const) {
    const h=await actor.client.heartbeat();
    check(h.ensembles?.assignments.some((r)=>r.ensemble_id===t.eid&&r.role===role),'first HTTP heartbeat assigns '+role);
  }
  const openapi=await a.client.openapi();
  check(Boolean(openapi.paths['/ensembles/{ensemble_id}/submit']),'OpenAPI exposes ensemble synthesis');
  check(Boolean((openapi.paths['/me/manifest'] as any)?.patch?.requestBody),'OpenAPI exposes manifest body');
  const toolsResponse=await fetch(baseUrl+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  const tools=await toolsResponse.json() as any;
  check(tools.result.tools.some((t:any)=>t.name==='posterity_ensemble')&&tools.result.tools.some((t:any)=>t.name==='posterity_manifest'),'MCP discovers ensemble and manifest tools');
  const call=await responsesEnsembleAdapter(a.client).execute({type:'function_call',name:'posterity_ensemble',call_id:'native-1',arguments:JSON.stringify({action:'contribute',ensemble_id:t.eid,kind:'draft',summary:'Parser boundary proposal',content:'Process ordinary input'})});
  const draft=JSON.parse(call.output).id;
  check(call.call_id==='native-1','Responses preserves native call ID');
  const critique=await mcpEnsembleAdapter(b.client).execute({name:'posterity_ensemble',arguments:{action:'contribute',ensemble_id:t.eid,kind:'objection',summary:'Empty input is missing',content:'Handle empty input explicitly',responds_to:draft}});
  const objection=JSON.parse(critique.content[0].text).id;
  const synthesis=JSON.parse(await cliEnsembleAdapter(c.client).execute(JSON.stringify({action:'contribute',ensemble_id:t.eid,kind:'synthesis',summary:'Boundary-complete parser analysis',content:'Ordinary input and empty input are handled explicitly'}))).id;
  await b.client.ensembles.score(draft,4,'Useful proposal with a verifiable boundary omission');
  await a.client.ensembles.score(objection,5,'The objection catches a real missing empty input case');
  await a.client.ensembles.score(synthesis,5,'Synthesis incorporates all verified boundary cases');
  const scoredResponse = await fetch(baseUrl+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${b.key}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'posterity_ensemble',arguments:{action:'score',contribution_id:synthesis,score:5,rationale:'The critic verified that synthesis addresses the objection'}}})});
  const scored=await scoredResponse.json() as any;
  check(Boolean(scored.result?.content?.length)&&!scored.result.isError,'authenticated MCP executes a role action');
  const cliOutput: string[]=[];
  const cliCode=await cliMain(['ensemble','get',JSON.stringify({ensemble_id:t.eid}),'--json'],{env:{POSTERITY_KEY:a.key,POSTERITY_API:baseUrl,POSTERITY_CONFIG_DIR:`${process.cwd()}/work/${run}-cli`},out:(s:string)=>cliOutput.push(s),err:(s:string)=>{throw new Error(s);}});
  check(cliCode===0&&JSON.parse(cliOutput[0]).id===t.eid,'single-file CLI reads the same live ensemble');
  const submitted=await c.client.ensembles.submit(t.eid,{synthesis_id:synthesis,contributions:[draft,objection,synthesis],resolutions:[{contribution_id:objection,upheld:true,rationale:'The final analysis explicitly handles empty input'}]});
  const submission=await d.client.reviews.submission(submitted.submission_id);
  check(submission.ensemble?.submissions.some((s)=>s.submission_id===submitted.submission_id && s.lab_evidence?.length===3 && s.lab_evidence.every((v)=> (v.identity as any)?.status==='operator_verified')),'final reviewer sees frozen attribution and provider evidence');
  await d.client.reviews.review(submitted.submission_id,{verdict:'approve',score:5,rationale:'Boundary cases and acceptance criteria independently checked',checks:[{name:'Empty boundary verified',passed:true,objection_id:objection,upheld:true}]});
  const finished=await a.client.ensembles.get(t.eid);
  check(finished.status==='completed'&&Boolean(finished.submissions[0].settlement),'three adapters complete one independently reviewed ensemble');
  const [rep]=await sql`select s.budget,s.allocated,(select sum(delta) from public.reputation_events where submission_id=s.submission_id and kind in ('submission_accepted','ensemble_contribution')) as ledger from public.ensemble_settlements s where submission_id=${submitted.submission_id}::uuid`;
  check(rep.budget===rep.allocated&&rep.budget===rep.ledger,'HTTP lifecycle preserves reward pool exactly');
  const competitors=await Promise.all(Array.from({length:16},(_,i)=>agent(i+10,'proposer')));
  const race=await Promise.all(competitors.map(async(a)=>{try {await a.client.ensembles.join(contested.eid,'proposer');return 200;}catch(e){return e instanceof PosterityError?e.status:0;}}));
  check(race.filter((s)=>s===200).length===1&&race.filter((s)=>s===409).length===15,'16 concurrent role joins yield exactly one winner');
  const holder=await agent(50,'proposer'); const tasks=await Promise.all(Array.from({length:8},(_,i)=>task('capacity-'+i)));
  const capacity=await Promise.all(tasks.map(async(t)=>{try{await holder.client.ensembles.join(t.eid,'proposer');return 200;}catch(e){return e instanceof PosterityError?e.status:0;}}));
  check(capacity.filter((s)=>s===200).length===3&&capacity.filter((s)=>s===429).length===5,'concurrent ensemble joins respect the shared three-task limit');
  const anonymous=await fetch(baseUrl+`/ensembles/${contested.eid}/join`,{method:'POST',headers:{'content-type':'application/json'},body:'{"role":"critic"}'});
  check(anonymous.status===401,'anonymous callers cannot claim roles');
  const quotaAgent=await agent(90,'critic');
  const quotaTask=await task('quota-race');
  await quotaAgent.client.ensembles.join(quotaTask.eid,'critic');
  const quota=await Promise.all(Array.from({length:24},async(_,i)=>{
    try {await quotaAgent.client.ensembles.contribute(quotaTask.eid,{kind:'objection',summary:'Concurrent objection '+i}); return 200;}
    catch(e){return e instanceof PosterityError?e.status:0;}
  }));
  check(quota.filter(s=>s===200).length===16&&quota.filter(s=>s===429).length===8,'concurrent contributions cannot exceed the per-role budget');
  const recoveryRace=await Promise.all(Array.from({length:4},async()=>{
    try {await sql`select public.recover_ensemble_round(${quotaTask.eid}::uuid,1,'local-operator','Recover exhausted concurrent critic work')`; return 'ok';}
    catch(e){return String((e as {errno?:string}).errno);}
  }));
  check(recoveryRace.filter(s=>s==='ok').length===1&&recoveryRace.filter(s=>s==='PT409').length===3,'concurrent recoveries advance the expected round exactly once');
  const archived=await quotaAgent.client.ensembles.get(quotaTask.eid);
  check(archived.round===2&&archived.recoveries?.[0].contributions.length===16,'REST and SDK expose every archived contribution');
  console.log(`PASS ${assertions} Phase 13 transport/concurrency checks plus SQL assertions`);
} finally {
  if(mission) {
    await sql`delete from public.notifications where data->>'mission_id'=${mission}`;
    await sql`delete from public.activity where mission_id=${mission}::uuid or agent_id=any(${'{'+ids.join(',')+'}'}::uuid[])`;
    await sql`delete from public.knowledge where mission_id=${mission}::uuid or agent_id=any(${'{'+ids.join(',')+'}'}::uuid[])`;
    await sql`delete from public.workspaces where mission_id=${mission}::uuid`;
    await sql`delete from public.missions where id=${mission}::uuid`;
  }
  if(ids.length) await sql`delete from public.agents where id=any(${'{'+ids.join(',')+'}'}::uuid[])`;
  await sql.close();
}
