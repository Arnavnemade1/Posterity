// Local-only real possession/L2 transports plus rollback-only trust invariants.
import { SQL } from 'bun';
import { rollbackFixtures } from './sql-fixtures.ts';
import { Posterity,PosterityError,sealEnsembleDraft } from '../../packages/sdk/src/index.ts';
import { main as cliMain } from '../../packages/cli/posterity.mjs';
import quicknet from '../../supabase/functions/tests/fixtures/drand-quicknet.json';
const dbUrl=process.env.POSTERITY_TEST_DATABASE_URL??'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const baseUrl=process.env.POSTERITY_TEST_API??'http://127.0.0.1:54321/functions/v1/api';
for(const url of [dbUrl,baseUrl])if(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Disposable localhost services required');
const sql=new SQL(dbUrl,{max:4}),run='p15full-'+Date.now().toString(36),actors:string[]=[],hives:string[]=[];let mission:string|undefined,epoch:string|undefined;let checks=0;
const check=(value:unknown,label:string)=>{if(!value)throw new Error(label);checks++;console.log('PASS '+label);};
const hex=(v:Uint8Array)=>Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
const sign=async(k:CryptoKey,m:string)=>hex(new Uint8Array(await crypto.subtle.sign('Ed25519',k,new TextEncoder().encode(m))));
async function refused(action:()=>Promise<unknown>,status:number){try{await action();return false;}catch(e){return e instanceof PosterityError&&e.status===status;}}
try{
 await rollbackFixtures(dbUrl,['phase15_hives.sql','phase15_custody.sql'].map(file=>new URL(file,import.meta.url)));check(true,'full hive/standing/jury SQL contract');
 const people=[];
 for(let i=0;i<4;i++){
  const manifest={schema_version:1,lab:'fixture',models:['fixture'],capabilities:['analysis'],tools:[],languages:['en'],context_window:32000,strengths:[],roles:['proposer','critic','synthesizer']};
  const [r]=await sql`select public.register_manifest_agent(${'198.22.15.'+(i+1)},${run+'-'+i},p_manifest=>${JSON.stringify(manifest)}::text::jsonb) as result`;
  actors.push(r.result.agent.id);const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
  people.push({id:r.result.agent.id as string,client:new Posterity({apiKey:r.result.api_key,baseUrl,retries:0}),keys,public_key:hex(new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey)))});
 }
 const [a,b,c,d]=people;
 const declaration={name:'Declared fleet',operator_key:a.public_key,substrate_hash:'a'.repeat(64),declaration:'These agents share one operator and execution substrate. The entire declared hive is exactly one party.'};
 const challenge=await a.client.trust.challenge('hive_create',declaration);
 check(await refused(()=>a.client.trust.confirm(challenge.id,'0'.repeat(128)),403),'invalid possession signature refused');
 const signature=await sign(a.keys.privateKey,challenge.message);
 check(await refused(()=>b.client.trust.confirm(challenge.id,signature),404),'cross-actor possession replay refused');
 const created=await a.client.trust.confirm(challenge.id,signature);hives.push(String(created.hive_id));
 check(await refused(()=>a.client.trust.confirm(challenge.id,signature),409),'consumed challenge cannot replay');
 const join=await b.client.trust.challenge('hive_join',{hive_id:created.hive_id});
 const wrongSignature=await sign(b.keys.privateKey,join.message);
 check(await refused(()=>b.client.trust.confirm(join.id,wrongSignature),403),'membership needs the declared operator key');
 await b.client.trust.confirm(join.id,await sign(a.keys.privateKey,join.message));
 check((await a.client.trust.hive(String(created.hive_id))).members.length===2,'one hive declares multiple fleet identities');
 for(const [person,i]of [[c,1],[d,2]] as const){
  const challenge=await person.client.trust.challenge('hive_create',{...declaration,name:'Other hive '+i,operator_key:person.public_key,substrate_hash:String(i).repeat(64)});
  const created=await person.client.trust.confirm(challenge.id,await sign(person.keys.privateKey,challenge.message));hives.push(String(created.hive_id));
 }
 const identityKeys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
 const identity=await a.client.trust.challenge('identity',{hive_id:hives[0],public_key:hex(new Uint8Array(await crypto.subtle.exportKey('raw',identityKeys.publicKey))),track:'tenure'});
 await a.client.trust.confirm(identity.id,await sign(identityKeys.privateKey,identity.message));
 check(await refused(()=>a.client.trust.enroll(crypto.randomUUID()),409),'no enrollment into an undeclared epoch');
 check(await refused(()=>a.client.trust.auditQueue(),403),'an identity without T2 cannot read quarantined peer outputs');
 const [m]=await sql`insert into public.missions(slug,title,objective,status,created_by_agent,lead_agent_id,review_quorum,requires_final_approval)
  values(${run},'Inter-hive admissibility','Exercise three communication levels','active',${a.id}::uuid,${a.id}::uuid,1,false) returning id`;mission=m.id;
 const spec={key:'legible',title:'Inter-hive sealed draft',kind:'analysis',capabilities:['analysis'],ensemble:{distinct_labs:false,roles:[{role:'proposer'},{role:'critic'},{role:'synthesizer'}]}};
 const [task]=await sql`select public.insert_task_from_json(${mission}::uuid,${JSON.stringify(spec)}::text::jsonb,'open') as id`;
 const [en]=await sql`select id from public.ensembles where task_id=${task.id}::uuid`;const eid=en.id as string;
 await a.client.ensembles.join(eid,'proposer');
 check(await refused(()=>b.client.ensembles.join(eid,'critic'),409),'one hive cannot staff two ensemble roles');
 await c.client.ensembles.join(eid,'critic');await d.client.ensembles.join(eid,'synthesizer');
 const view=await a.client.ensembles.get(eid),team=[a,c,d],kinds=['draft','objection','synthesis'] as const;
 const accountability={reasoning:'The critic can engage with each explicit claim, inspect evidence and dispute the stated uncertainty.',claims:['An explicit trust boundary is tested'],assumptions:['Local fixtures simulate operators'],evidence:['A repeatable engine invariant'],uncertainties:['This is not production economic evidence']};
 const sealed=await Promise.all(team.map((p,i)=>sealEnsembleDraft({ensemble_id:eid,member_id:view.members.find(m=>m.agent_id===p.id)!.id,round:1,kind:kinds[i],summary:'Legible initial '+i,content:'Inter-hive evidence π 🧪 '+i,accountability,...(i===0?{vector_hash:'f'.repeat(64)}:{})})));
 check(await refused(()=>a.client.ensembles.commit(eid,1,sealed[0].digest),400),'inter-hive commitment binds full accountability');
 for(let i=0;i<3;i++)await team[i].client.ensembles.commit(eid,1,sealed[i].digest,sealed[i].algorithm);
 check(await refused(()=>a.client.ensembles.reveal(eid,{...sealed[0],accountability_wire:sealed[0].accountability_wire!.replace('boundary','false-boundary')}),400),'sealed accountability cannot be replaced after seeing peers');
 const outputs=[];for(let i=0;i<3;i++)outputs.push(await team[i].client.ensembles.reveal(eid,sealed[i]));
 check(outputs.length===3,'full legible drafts pass the sealed L2 barrier');
 const assessment=await c.client.ensembles.admissibility(outputs[0].id,true,'The summary states concrete claims and assumptions I can critique using the cited evidence.');
 check(Boolean(assessment.id),'independent critic admits vector-derived evidence through legible reasons');
 check(await refused(()=>a.client.ensembles.admissibility(outputs[0].id,true,'An author cannot declare its own vector-derived reasons independently admissible.'),403),'authors cannot self-certify vector admissibility');
 // A fixed official beacon with privileged local clock fixtures tests the actual
 // Edge pairing verifier. This unbound fixture cannot assign production work.
 const [ep]=await sql`insert into public.trust_epochs(starts_at,ends_at,stake_units,escrow_units,dispute_seconds,reward_cap,operator,reason)
   values(now()-interval '1 day',now()+interval '1 day',100,20,60,100,'local-fixture','Local beacon-verification fixture, not rollout evidence') returning id`;epoch=ep.id;
 const settings={beacon_public_key:quicknet.info.public_key,jury_size:3};
 await sql`insert into public.trust_protocols(epoch_id,settings,settings_hash) values(${epoch}::uuid,${JSON.stringify(settings)}::text::jsonb,${'a'.repeat(64)})`;
 const pool=[{hive_id:hives[0],agents:[a.id,b.id]},{hive_id:hives[1],agents:[c.id]}];
 const [draw]=await sql`insert into public.trust_draws(epoch_id,purpose,target_id,role,generation,pool,pool_hash,context,beacon_round,beacon_due,created_at)
   values(${epoch}::uuid,'assignment',${task.id}::uuid,'worker',1,${JSON.stringify(pool)}::text::jsonb,${'b'.repeat(64)},'{}',1,now()-interval '1 second',now()-interval '2 seconds') returning id`;
 check(await refused(()=>a.client.trust.finalizeDraw(draw.id,{...quicknet.beacon,round:2}),403),'Edge refuses a valid signature for the wrong committed beacon round');
 const verified=await a.client.trust.finalizeDraw(draw.id,quicknet.beacon);
 check(verified.selected?.length===1&&verified.signature===quicknet.beacon.signature,'actual Edge BLS verifier accepts the pinned official quicknet proof');
 const output:string[]=[];
 const exit=await cliMain(['trust','hive',JSON.stringify({hive_id:hives[0]}),'--json'],{env:{POSTERITY_API:baseUrl,POSTERITY_CONFIG_DIR:`/tmp/${run}`},out:(s:string)=>output.push(s),err:(s:string)=>{throw new Error(s);}});
 check(exit===0&&JSON.parse(output[0]).members.length===2,'CLI reads the same one-party hive');
 const schema=await a.client.openapi();check(Boolean(schema.paths['/trust/draws/{draw_id}/finalize']&&schema.paths['/me/trust/challenges']),'OpenAPI exposes possession and verified sortition');
 console.log(`PASS ${checks} full Phase 15 transport/security checks plus adversarial SQL`);
}finally{
 await sql.begin(async tx=>{
  await tx`set local session_replication_role=replica`;const ids='{'+actors.join(',')+'}',hiveIds='{'+hives.join(',')+'}';
  if(epoch){await tx`delete from public.trust_draws where epoch_id=${epoch}::uuid`;await tx`delete from public.trust_protocols where epoch_id=${epoch}::uuid`;await tx`delete from public.trust_epochs where id=${epoch}::uuid`;}
  await tx`delete from public.trust_behavior_samples where agent_id=any(${ids}::uuid[])`;
  if(mission){
   await tx`delete from public.ensemble_admissibility where contribution_id in(select c.id from public.ensemble_contributions c join public.ensembles e on e.id=c.ensemble_id join public.tasks t on t.id=e.task_id where t.mission_id=${mission}::uuid)`;
   await tx`delete from public.ensemble_sealing where ensemble_id in(select e.id from public.ensembles e join public.tasks t on t.id=e.task_id where t.mission_id=${mission}::uuid)`;
  }
  await tx`delete from public.trust_identity_keys where agent_id=any(${ids}::uuid[])`;
  await tx`delete from public.trust_key_challenges where agent_id=any(${ids}::uuid[])`;
  await tx`delete from public.trust_hive_members where agent_id=any(${ids}::uuid[])`;
  await tx`delete from public.trust_hives where id=any(${hiveIds}::uuid[])`;
 });
 if(mission)await sql`delete from public.missions where id=${mission}::uuid`;
 if(actors.length)await sql`delete from public.agents where id=any(${'{'+actors.join(',')+'}'}::uuid[])`;
 await sql.close();
}
