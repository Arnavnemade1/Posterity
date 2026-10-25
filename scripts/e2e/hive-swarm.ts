import { SQL } from 'bun';
import { Posterity,PosterityError,HiveChannel,encodeSwarmVector,decodeSwarmVector } from '../../packages/sdk/src/index.ts';

/** Real transports; additional declared-hive memberships are privileged local fixtures. */
export async function hiveSwarmChecks(sql:SQL,people:{id:string;client:Posterity}[],task:string,ensemble:string) {
 const [a,b,c]=people;let checks=0;const helperIds:string[]=[];
 const check=(v:unknown,label:string)=>{if(!v)throw new Error(label);checks++;console.log('PASS '+label);};
 const denied=async(action:()=>Promise<unknown>,status:number)=>{try{await action();return false;}catch(e){return e instanceof PosterityError&&e.status===status;}};
 const initial=await a.client.swarm.sync(task),hash=initial.context.task_hash;
 check(initial.context.phase==='commit'&&initial.context.roster.length===3,'swarm peers see the same sealed ensemble phase and roster');
 const race=await Promise.all([a,b].map(async p=>{try{return {status:200,result:await p.client.swarm.checkpoint(task,hash,0,{goal:'Shared parser plan',owner:p.id})};}catch(e){return {status:e instanceof PosterityError?e.status:0};}}));
 check(race.filter(r=>r.status===200).length===1&&race.filter(r=>r.status===409).length===1,'concurrent checkpoints cannot silently overwrite one another');
 const frame=await b.client.swarm.sync(task);
 check(frame.version===1&&frame.state.goal==='Shared parser plan','supporting hive agents share the authoritative working plan');
 const foreign=await c.client.swarm.sync(task);
 check(foreign.hive_id!==frame.hive_id&&foreign.events.length===0&&Object.keys(foreign.state).length===0,'another hive sees its own isolated room, never private peer state');
 const client_id=crypto.randomUUID(),event={kind:'handoff' as const,summary:'Parser boundary work is ready for the next helper'};
 const first=await a.client.swarm.publish(task,hash,event,client_id),retry=await a.client.swarm.publish(task,hash,event,client_id);
 check(first.sequence===retry.sequence&&retry.replayed===true,'retrying a handoff publishes exactly one ordered event');
 check(await denied(()=>a.client.swarm.publish(task,hash,{...event,summary:'Alter the previously bound handoff'},client_id),409),'a retry UUID cannot be rebound to another message');
 const claims=await Promise.all([a,b].map(async p=>{try{return {person:p,lease:await p.client.swarm.claim(task,hash,'parser-boundaries')};}catch(e){return {person:p,status:e instanceof PosterityError?e.status:0};}}));
 const winner=claims.find(r=>'lease' in r)!,loser=claims.find(r=>!('lease' in r))!;
 check(claims.filter(r=>'lease' in r).length===1&&'status' in loser&&loser.status===409,'one subtask has exactly one current worker under contention');
 const lease=winner.lease!;
 check(await denied(()=>loser.person.client.swarm.publish(task,hash,{kind:'progress',summary:'Pretend to finish another worker’s item',work_key:lease.work_key,token:lease.token}),409),'a fencing token cannot authorize another identity');
 await sql`update public.hive_task_leases set until_at=now()-interval '1 second' where task_id=${task}::uuid and hive_id=${frame.hive_id}::uuid and work_key='parser-boundaries'`;
 const replacement=await loser.person.client.swarm.claim(task,hash,'parser-boundaries');
 check(replacement.token!==lease.token&&await denied(()=>winner.person.client.swarm.renew(task,lease),409),'expired work is reclaimed and late workers stay fenced out');
 await loser.person.client.swarm.publish(task,hash,{kind:'progress',summary:'The current worker checked the boundary cases',work_key:replacement.work_key,token:replacement.token});
 const vector=await encodeSwarmVector('fixture-model@v1:embedding',[1.25,-2.5,3]);
 await a.client.swarm.vector(task,hash,vector,{summary:'Local vector state for the shared parser plan'});
 const compatible=await b.client.swarm.sync(task,{spaces:[vector.space]});
 const delivered=compatible.events.find(e=>e.result.kind==='vector')!;
 check(delivered.compatible&&Array.from(await decodeSwarmVector(delivered.result.vector as typeof vector,vector.space)).join(',')==='1.25,-2.5,3','vector bytes round-trip across real agent identities in one declared space');
 const incompatible=await b.client.swarm.sync(task,{spaces:['different-model@v1:embedding']});
 const withheld=incompatible.events.find(e=>e.result.kind==='vector')!;
 check(!withheld.compatible&&!('data' in (withheld.result.vector as object))&&Boolean(withheld.result.summary),'incompatible spaces receive metadata and text fallback, never silently misdecoded vectors');
 check(await denied(()=>a.client.swarm.vector(task,hash,{...vector,dimensions:4}),400),'malformed vector dimensions are rejected at the transport boundary');
 let cursor=0,seen:number[]=[];for(let i=0;i<20;i++){const page=await b.client.swarm.sync(task,{after:cursor,limit:2});seen.push(...page.events.map(e=>e.sequence));cursor=page.next_cursor;if(!page.has_more)break;}
 check(seen.length===new Set(seen).size&&seen.every((n,i)=>n===i+1)&&cursor===compatible.head,'paged synchronization loses or duplicates no committed events');
 await b.client.swarm.pulse(task,hash,cursor,{status:'Boundary checks complete; waiting for synthesis'});
 check((await b.client.heartbeat()).swarm?.some(r=>r.task_id===task&&r.unread===0),'heartbeat reports private-room delivery progress without resending vector payloads');
 const [before]=await sql`select acceptance_criteria from public.tasks where id=${task}::uuid`;
 await sql`update public.tasks set acceptance_criteria=acceptance_criteria||' Updated independent criterion.' where id=${task}::uuid`;
 check(await denied(()=>a.client.swarm.publish(task,hash,{kind:'decision',summary:'A result based on an outdated task contract'}),409),'outdated task context cannot silently publish a fresh result');
 const changed=await a.client.swarm.sync(task);
 check(changed.state_stale&&changed.context.task_hash!==hash,'task changes visibly mark the old shared checkpoint stale');
 await sql`update public.tasks set acceptance_criteria=${before.acceptance_criteria} where id=${task}::uuid`;
 const restored=await a.client.swarm.sync(task);
 check(restored.context.task_hash!==hash,'restoring old criteria cannot resurrect obsolete work tokens');
 const oldVector=restored.events.find(e=>e.result.kind==='vector')!;
 check(oldVector.context_stale&&!oldVector.compatible&&!('data' in (oldVector.result.vector as object)),'old vector state is withheld after a task context change');
 await a.client.swarm.checkpoint(task,restored.context.task_hash,restored.version,{goal:'Shared parser plan',rebased:true});
 check(!(await b.client.swarm.sync(task)).state_stale,'an explicit rebase establishes a fresh shared checkpoint');
 // Hold an uncommitted public-context edit while publishing through the real API.
 // The write must fail promptly, never commit against the obsolete visible hash.
 for(const target of ['task','mission'] as const) {
  const rollback=new Error('rollback private coordination contention fixture');let fenced=false;
  try {
   await sql.begin(async tx=>{
    if(target==='task')await tx`update public.tasks set acceptance_criteria=acceptance_criteria||' Concurrent edit.' where id=${task}::uuid`;
    else await tx`update public.missions set objective=objective||' Concurrent edit.' where id=(select mission_id from public.tasks where id=${task}::uuid)`;
    fenced=await denied(()=>a.client.swarm.publish(task,restored.context.task_hash,{kind:'progress',summary:'An old-context result racing with a public edit'}),409);
    throw rollback;
   });
  } catch(error) {if(error!==rollback)throw error;}
  check(fenced,`a concurrent ${target} edit fences private writes before they commit`);
 }
 try {
  const clients=[];
  for(let i=0;i<32;i++) {
   const [r]=await sql`select public.register_manifest_agent(${'198.24.15.'+(i+1)},${'swarm-'+Date.now().toString(36)+'-'+i}) as result`;
   helperIds.push(r.result.agent.id);
   await sql`insert into public.trust_hive_members(agent_id,hive_id) values(${r.result.agent.id}::uuid,${frame.hive_id}::uuid)`;
   clients.push(new Posterity({apiKey:r.result.api_key,baseUrl:a.client.baseUrl,retries:0}));
  }
  const started=performance.now(),frames=await Promise.all(clients.map(p=>p.swarm.sync(task,{spaces:[vector.space]})));
  check(frames.every(f=>f.version===2&&f.head===frames[0].head&&f.state.rebased===true),'32 hive helpers synchronize to one checkpoint and committed event head');
  await Promise.all(clients.map((p,i)=>p.swarm.pulse(task,frames[i].context.task_hash,frames[i].next_cursor,{status:'Ready for the shared next step'})));
  const presence=await a.client.swarm.sync(task);
  check(presence.peers.filter(p=>helperIds.includes(p.agent_id)&&p.online).length===32,'the hive can see which helpers are current and available');
  const [roles]=await sql`select count(*)::int n from public.ensemble_members where ensemble_id=${ensemble}::uuid and state='active'`;
  check(roles.n===3,'private swarm helpers gain no extra ensemble roles or independence votes');
  console.log(JSON.stringify({hive_helpers:32,elapsed_ms:Math.round(performance.now()-started),production_capacity_claim:false}));
  const rounds=Number(process.env.POSTERITY_SWARM_LOAD_ROUNDS??0);
  if(!Number.isInteger(rounds)||rounds<0||rounds>50)throw new Error('Swarm load supports 0–50 rounds');
  if(rounds) {
   if(!['localhost','127.0.0.1','[::1]'].includes(new URL(a.client.baseUrl).hostname))throw new Error('Swarm load requires localhost');
   const adapter={space:'load-fixture@v1:shared-state',dimensions:3,encode:(v:number[])=>v,decode:(v:Float32Array)=>Array.from(v)};
   const channels=clients.map(client=>new HiveChannel(client,task,adapter));
   const latencies:number[]=[],sequences:number[]=[];let conflicts=0,requests=0;
   const start=performance.now();
   for(let round=0;round<rounds;round++) {
    await Promise.all(channels.map(async(channel,i)=>{
     const id=crypto.randomUUID(),t=performance.now();
     for(let attempt=0;;attempt++) {
      try {
       requests++;
       const result=await channel.send(frames[i],[round,i,1.25],{summary:`Round ${round}, helper ${i}: shared state ready`,clientId:id});
       sequences.push(Number(result.sequence));break;
      } catch(error) {
       if(!(error instanceof PosterityError&&error.status===409)||attempt>=20)throw error;
       conflicts++;await new Promise(resolve=>setTimeout(resolve,25+Math.random()*75));
      }
     }
     latencies.push(performance.now()-t);
    }));
   }
   check(new Set(sequences).size===32*rounds,'contended vector broadcasts commit exactly once per client UUID');
   const final=await a.client.swarm.sync(task),head=final.head;
   let delivered=0,reconnects=0;
   await Promise.all(channels.map(async(channel,i)=>{
    let cursor=0,count=0,saved=0;
    const controller=new AbortController();
    for await(const {frame:page,signals} of channel.follow({
     pageSize:7,signal:controller.signal,
     saveCursor:processed=>{saved=processed;if(processed===head)controller.abort();},
     onRetry:()=>{reconnects++;},
    })) {
     requests++;
     for(const event of page.events) {
      checkSequence(event.sequence===cursor+1);cursor=event.sequence;
     }
     for(const signal of signals) if(signal.delivery==='decoded') {
      const decoded=signal.state!;
      checkSequence(decoded[0]>=0&&decoded[0]<rounds&&decoded[1]>=0&&decoded[1]<32&&decoded[2]===1.25);count++;
     }
     if(cursor<head)requests++; // Presence acknowledgement between pages.
     if(!page.events.length&&cursor<head)throw new Error('Hive drain stalled before the committed head');
    }
    checkSequence(cursor===head&&saved===head&&count===32*rounds);delivered+=count;
    requests++;await clients[i].swarm.pulse(task,final.context.task_hash,cursor,{status:'Load replay complete'});
   }));
   check(delivered===32*32*rounds,'all 32 helpers replay every shared vector in order without gaps, duplicates or byte corruption');
   const acknowledged=await a.client.swarm.sync(task);
   check(acknowledged.peers.filter(peer=>helperIds.includes(peer.agent_id)&&peer.acknowledged===head).length===32,'all helpers acknowledge the same final committed head after load');
   latencies.sort((a,b)=>a-b);
   console.log(JSON.stringify({label:'hive_vector_load',helpers:32,rounds,broadcasts:32*rounds,delivered_vectors:delivered,requests,conflict_retries:conflicts,reconnects,elapsed_ms:Math.round(performance.now()-start),publish_p95_ms:Math.round(latencies[Math.ceil(latencies.length*.95)-1]),head,production_capacity_claim:false}));
  }
 } finally {
  if(helperIds.length)await sql.begin(async tx=>{await tx`set local session_replication_role=replica`;const ids='{'+helperIds.join(',')+'}';await tx`delete from public.hive_task_presence where agent_id=any(${ids}::uuid[])`;await tx`delete from public.trust_hive_members where agent_id=any(${ids}::uuid[])`;await tx`delete from public.agents where id=any(${ids}::uuid[])`;});
 }
 check((await sql`select not has_table_privilege('authenticated','public.hive_task_events','SELECT') and not has_function_privilege('anon','public.hive_swarm_sync(uuid,uuid,bigint,text[],integer)','EXECUTE') as private`)[0].private,'browser and anonymous RPC roles cannot bypass private hive delivery');
 return checks;
}

function checkSequence(ok:boolean) {if(!ok)throw new Error('Hive load lost event ordering, vector integrity or final convergence');}
