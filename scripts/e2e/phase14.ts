// Local-only integration across SQL, REST, MCP, SDK, CLI and ordinary verified work.
import { SQL } from 'bun';
import { Posterity, PosterityError, type CapabilityManifest } from '../../packages/sdk/src/index.ts';
import { main as cliMain } from '../../packages/cli/posterity.mjs';
const dbUrl=process.env.POSTERITY_TEST_DATABASE_URL??'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const baseUrl=process.env.POSTERITY_TEST_API??'http://127.0.0.1:54321/functions/v1/api';
for(const url of [dbUrl,baseUrl]) if(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Phase 14 fixtures require localhost');
const sql=new SQL(dbUrl,{max:10});const run='p14-'+Date.now().toString(36);const agents:string[]=[];const extraMissions:string[]=[];let mission:string|undefined;let assertions=0;
const check=(condition:unknown,label:string)=>{if(!condition)throw new Error(label);assertions++;console.log('PASS '+label);};
async function actor(n:number,capability:string){
 const manifest:CapabilityManifest={schema_version:1,lab:'fixture-provider',models:['fixture-model'],tools:[],languages:['en'],capabilities:[capability],context_window:32000,strengths:[],roles:['specialist']};
 const [r]=await sql`select public.register_manifest_agent(${'198.51.'+(200+n)+'.1'},${run+'-'+n},p_manifest=>${JSON.stringify(manifest)}::text::jsonb) as result`;
 agents.push(r.result.agent.id);return {id:r.result.agent.id as string,key:r.result.api_key as string,client:new Posterity({apiKey:r.result.api_key,baseUrl,retries:0})};
}
try{
 await sql`update public.app_config set value='http://supabase_kong_posterity:8000/functions/v1/api' where key='api_url'`;
 await sql.unsafe(await Bun.file(new URL('phase14.sql',import.meta.url)).text());check(true,'Phase 14 adversarial SQL assertions');
 const [lead,worker,reviewer]=await Promise.all([actor(1,'planning'),actor(2,run),actor(3,'review')]);
 const [m]=await sql`insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,review_quorum,requires_final_approval)
 values(${run},'Advisory transport test','Validate optional matching transports','active',${lead.id}::uuid,${lead.id}::uuid,1,false) returning id`;
 mission=m.id;
 const tasks:string[]=[];
 for(let i=0;i<2;i++){
  const [t]=await sql`select public.insert_task_from_json(${mission}::uuid,${JSON.stringify({key:'transport-'+i,title:'Advisory work '+i,kind:'other',capabilities:[run],acceptance_criteria:'A reviewer independently checks this result'})}::text::jsonb,'open') as id`;tasks.push(t.id);
 }
 const anonymous=await fetch(baseUrl+`/missions/${mission}/orchestration/runs`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 check(anonymous.status===401,'anonymous matching writes refused');
 let denied=false;try{await worker.client.orchestration.configure(mission!,{weights:{quality:1,speed:0,cost:0},exploration:1,reason:'An outsider attempts to set mission policy'});}catch(e){denied=e instanceof PosterityError&&e.status===403;}
 check(denied,'SDK cannot change another mission objective');
 const toolsResponse=await fetch(baseUrl+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 const discovered=await toolsResponse.json() as any;
 check(discovered.result.tools.some((t:any)=>t.name==='posterity_orchestration'),'MCP discovers advisory tool');
 const configuration=await fetch(baseUrl+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${lead.key}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'posterity_orchestration',arguments:{action:'configure',mission,weights:{quality:0.6,speed:0.2,cost:0.2},exploration:0.2,reason:'Declare the objective before proposing matches'}}})});
 const configured=await configuration.json() as any;check(!configured.result?.isError&&configured.result?.content?.length,'MCP declares policy through the same authority boundary');
 const policy=await lead.client.orchestration.policy(mission!);check(policy.policy?.revision===1&&policy.policy.exploration===0.2,'SDK reads immutable declared objective');
 const attempts=await Promise.all(Array.from({length:4},async()=>{try{return {status:200,result:await lead.client.orchestration.run(mission!)};}catch(e){return {status:e instanceof PosterityError?e.status:0};}}));
 check(attempts.filter(a=>a.status===200).length===1&&attempts.filter(a=>a.status===429).length===3,'concurrent matching requests produce one bounded run');
 const generated=attempts.find(a=>a.status===200)!.result!;
 check(generated.suggestions===2,'matching proposes both ready tasks');
 const audit=await lead.client.orchestration.get(generated.run_id,{limit:1});
 check(audit.candidates.length===1&&audit.slots.length===2&&audit.policy.id===policy.policy?.id,'REST audit exposes pagination and pinned policy');
 const cliOutput:string[]=[];
 const cliCode=await cliMain(['orchestrate','get',JSON.stringify({run_id:generated.run_id,limit:1}),'--json'],{env:{POSTERITY_KEY:lead.key,POSTERITY_API:baseUrl,POSTERITY_CONFIG_DIR:`/tmp/${run}-cli`},out:(s:string)=>cliOutput.push(s),err:(s:string)=>{throw new Error(s);}});
 check(cliCode===0&&JSON.parse(cliOutput[0]).id===generated.run_id,'served CLI reads the same matching audit');
 const openapi=await lead.client.openapi();check(Boolean(openapi.paths['/missions/{mission}/orchestration/runs']),'OpenAPI exposes matching contract');
 const inbox=await worker.client.orchestration.suggestions();check(inbox.required===false&&inbox.suggestions.length===2,'SDK receives optional fitting suggestions');
 const heartbeat=await worker.client.heartbeat();
 check(heartbeat.orchestration?.suggestions.length===2,'heartbeat exposes advice without accepting it');
 const [unclaimed]=await sql`select count(*)::int as n from public.tasks where mission_id=${mission}::uuid and assignee_id is not null`;check(unclaimed.n===0,'reading advice leaves actual task claims untouched');
 const suggestion=inbox.suggestions[0];let premature=false;
 try{await worker.client.orchestration.respond(suggestion.suggestion_id,'followed','No actual claim exists yet');}catch(e){premature=e instanceof PosterityError&&e.status===409;}
 check(premature,'feedback cannot invent an assignment');
 await worker.client.tasks.claim(suggestion.task_id);
 await worker.client.orchestration.respond(suggestion.suggestion_id,'followed','Claimed through the existing task engine');
 const submitted=await worker.client.tasks.submit(suggestion.task_id,{summary:'Advisory result checked against criteria',content:'Independent review checks this output',tokens:120,model:'fixture-model'});
 await reviewer.client.reviews.review(submitted.submission_id,{verdict:'approve',score:5,rationale:'Independently checked every acceptance criterion'});
 const metrics=await lead.client.orchestration.metrics(mission!);
 check(metrics.independently_verified_outcomes===1&&metrics.unknown_outcomes===1,'metrics distinguish verified observations from unknown outcomes');
 check(metrics.mean_reported_tokens===120&&metrics.causal_claim===false,'cost units and observational limits remain explicit');
 const declined=inbox.suggestions[1];await worker.client.orchestration.respond(declined.suggestion_id,'appeal','The proposed task does not suit my current context');
 await worker.client.orchestration.respond(declined.suggestion_id,'decline','Declining the optional task recommendation');
 check((await worker.client.orchestration.suggestions()).suggestions.length===0,'decline removes advice without imposing a penalty');
 const proposed=await lead.client.orchestration.proposePlan(mission!,{tasks:[{key:'proposed',title:'A proposed decomposition task',kind:'other',acceptance_criteria:'Independently checked evidence'}]});
 check(proposed.materialized===false,'decomposition uses the existing approval flow');
 const [notMaterialized]=await sql`select count(*)::int as n from public.tasks where mission_id=${mission}::uuid and key='proposed'`;check(notMaterialized.n===0,'plan proposal creates no execution task');
 await lead.client.orchestration.configure(mission!,{weights:{quality:1,speed:0,cost:0},exploration:0,enabled:false,reason:'Disable advice while keeping ordinary work available'});
 await worker.client.tasks.claim(declined.task_id);
 check((await worker.client.orchestration.policy(mission!)).policy?.revision===2,'policy replacement is a visible revision');
 check((await worker.client.orchestration.policies(mission!)).policies.length===2,'objective history remains queryable');
 const [loadMission]=await sql`insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id)
   values(${run+'-load'},'Advisory load test','Match a network of more than one hundred agents','active',${lead.id}::uuid,${lead.id}::uuid) returning id`;
 extraMissions.push(loadMission.id);
 const fleet=Array.from({length:128},()=>crypto.randomUUID());agents.push(...fleet);
 const loadCap=run+'-load';
 await sql`insert into public.agents(id,handle,display_name,capabilities,last_seen_at)
   select id::uuid,${run+'-load-'}||n,'Local matching agent',array[${loadCap}],now() from unnest(${'{'+fleet.join(',')+'}'}::uuid[]) with ordinality x(id,n)`;
 await sql`insert into public.agent_stats(agent_id) select id from public.agents where id=any(${'{'+fleet.join(',')+'}'}::uuid[]) on conflict do nothing`;
 const fleetManifest={schema_version:1,lab:'fixture',models:['fixture'],tools:[],languages:[],capabilities:[loadCap],context_window:32000,strengths:[],roles:['specialist']};
 await sql`insert into public.agent_manifests(agent_id,manifest) select id,${JSON.stringify(fleetManifest)}::text::jsonb from public.agents where id=any(${'{'+fleet.join(',')+'}'}::uuid[])`;
 for(let i=0;i<20;i++)await sql`select public.insert_task_from_json(${loadMission.id}::uuid,${JSON.stringify({key:'load-'+i,title:'Load advisory task',kind:'other',capabilities:[loadCap],acceptance_criteria:'Independent evidence is checked'})}::text::jsonb,'open')`;
 await lead.client.orchestration.configure(loadMission.id,{weights:{quality:0.6,speed:0.2,cost:0.2},exploration:0.2,reason:'Declare the bounded matching load probe'});
 const [claimable]=await sql`select id from public.tasks where mission_id=${loadMission.id}::uuid order by key limit 1`;
 const start=performance.now();let load:any;let committed=false;
 const pending=await sql.reserve();
 try{
  await pending`begin`;await pending`set local role posterity_orchestrator`;
  const [r]=await pending`select public.run_network_orchestration(${loadMission.id}::uuid) as result`;load=r.result;
  const independent=await sql.begin(async tx=>{
    await tx`set local lock_timeout='500ms'`;
    const [claimed]=await tx`select public.claim_task(${fleet[0]}::uuid,${claimable.id}::uuid) as result`;return claimed.result;
  });
  check(independent.status==='claimed','an open matcher transaction cannot block ordinary claiming');
  await sql.begin(async tx=>{
    await tx`set local lock_timeout='500ms'`;
    await tx`select public.set_orchestration_policy(${loadMission.id}::uuid,${lead.id}::uuid,'{"quality":1,"speed":0,"cost":0}',0,false,'Owner can disable advice while a network transaction is still open')`;
  });
  check(true,'an open matcher transaction cannot block owner opt-out');
  await pending`commit`;committed=true;
 }finally{if(!committed)await pending`rollback`;pending.release();}
 check(load.suggestions===20&&load.sampled_agents>=128,'bounded run matches twenty tasks against 128 eligible identities');
 const [capacity]=await sql`select max(n)::int as n from (select count(*) as n from public.orchestration_candidates where run_id=${load.run_id}::uuid and selected group by agent_id) s`;
 check(capacity.n<=3,'large matching run preserves virtual capacity');
 console.log(JSON.stringify({matching_agents:128,task_slots:20,elapsed_ms:Math.round(performance.now()-start),sampled_agents:load.sampled_agents,production_capacity_claim:false}));
 console.log(`PASS ${assertions} Phase 14 transport/security checks plus SQL assertions`);
}finally{
 for(const extra of extraMissions)await sql`delete from public.missions where id=${extra}::uuid`;
 if(mission){
  await sql`delete from public.notifications where data->>'mission_id'=${mission}`;
  await sql`delete from public.activity where mission_id=${mission}::uuid or agent_id=any(${'{'+agents.join(',')+'}'}::uuid[])`;
  await sql`delete from public.knowledge where mission_id=${mission}::uuid or agent_id=any(${'{'+agents.join(',')+'}'}::uuid[])`;
  await sql`delete from public.workspaces where mission_id=${mission}::uuid`;
  await sql`delete from public.missions where id=${mission}::uuid`;
 }
 if(agents.length)await sql`delete from public.agents where id=any(${'{'+agents.join(',')+'}'}::uuid[])`;
 await sql.close();
}
