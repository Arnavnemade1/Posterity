import { expect,test } from 'bun:test';
import { Posterity,PosterityError,encodeSwarmVector,decodeSwarmVector,followHiveTask,HiveChannel,type HiveSwarmFrame,type HiveWorkLease,type SwarmVector } from '../src/index.ts';

test('vector delivery preserves float32 bytes and rejects incompatible or corrupted spaces',async()=>{
 const v=await encodeSwarmVector('model@revision:layer',[0,-1.5,Math.PI]);
 expect(Array.from(await decodeSwarmVector(v,v.space))).toEqual([0,-1.5,Math.fround(Math.PI)]);
 await expect(decodeSwarmVector(v,'different@revision:layer')).rejects.toThrow('Incompatible');
 await expect(decodeSwarmVector({...v,sha256:'0'.repeat(64)},v.space)).rejects.toThrow('Corrupt');
 await expect(decodeSwarmVector({...v,dimensions:5},v.space)).rejects.toThrow('Corrupt');
 await expect(encodeSwarmVector(v.space,[NaN])).rejects.toThrow('Finite');
 await expect(encodeSwarmVector(v.space,[1e100])).rejects.toThrow('Finite');
 await expect(encodeSwarmVector(v.space,new Float32Array(16385))).rejects.toThrow();
});

test('a follower drains pages without gaps and acknowledges after the consumer handles them',async()=>{
 const frame=(n:number,settled=false)=>({version:1,context:{task_hash:'a'.repeat(64),phase:settled?'settled':'work'},events:[{sequence:n}],next_cursor:n,head:3,has_more:!settled,leases:[],peers:[]}) as unknown as HiveSwarmFrame;
 const after:number[]=[],acks:number[]=[];let index=0;
 const fake={swarm:{sync:async(_task:string,options:{after?:number})=>{after.push(options.after??0);return frame(++index,index===3);},pulse:async(_task:string,_hash:string,cursor:number)=>{acks.push(cursor);}}};
 const stream=followHiveTask(fake as unknown as Pick<Posterity,'swarm'>,'task');
 expect((await stream.next()).value?.next_cursor).toBe(1);expect(acks).toEqual([]);
 expect((await stream.next()).value?.next_cursor).toBe(2);expect(acks).toEqual([1]);
 expect((await stream.next()).value?.next_cursor).toBe(3);expect(acks).toEqual([1,2]);
 expect((await stream.next()).done).toBe(true);expect(after).toEqual([0,1,2]);
});

test('workspace requests bind context and retry UUID while reads retain cancellation',async()=>{
 const calls:{url:string;body:Record<string,unknown>|undefined;signal:AbortSignal|null|undefined}[]=[];
 const client=new Posterity({baseUrl:'https://hive.test',apiKey:'fixture',fetch:(async(url,init)=>{calls.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):undefined,signal:init?.signal});return Response.json({});}) as typeof fetch});
 const controller=new AbortController();await client.swarm.sync('task',{after:2,spaces:['a@v1:x'],signal:controller.signal});
 expect(calls[0].url).toBe('https://hive.test/tasks/task/swarm?after=2&spaces=a%40v1%3Ax');expect(calls[0].signal).toBe(controller.signal);
 await client.swarm.checkpoint('task','hash',2,{goal:'Check the parser'},'retry-uuid');
 expect(calls[1].body).toMatchObject({action:'checkpoint',task_hash:'hash',expected_version:2,client_id:'retry-uuid',payload:{state:{goal:'Check the parser'}}});
 expect(calls[1].body).not.toHaveProperty('agent_id');expect(calls[1].body).not.toHaveProperty('hive_id');
});

test('settled tasks drain every remaining page without attempting a new presence write',async()=>{
 let cursor=0;const received:number[]=[];
 const fake={swarm:{sync:async()=>({version:1,context:{task_hash:'hash',phase:'settled'},events:[{sequence:++cursor}],next_cursor:cursor,head:3,has_more:cursor<3,leases:[],peers:[]}) as unknown as HiveSwarmFrame,
  pulse:async()=>{throw new Error('A settled room is read-only');}}};
 for await(const page of followHiveTask(fake as unknown as Pick<Posterity,'swarm'>,'task'))received.push(page.next_cursor);
 expect(received).toEqual([1,2,3]);
});

test('followers keep reading a read-only review room and finish when it settles',async()=>{
 const controller=new AbortController();let reads=0,pulses=0;
 const fake={swarm:{sync:async()=>({version:1,writable:false,context:{task_hash:'hash',phase:++reads===1?'deliberate':'settled'},events:[],next_cursor:0,head:0,has_more:false,leases:[],peers:[]}) as unknown as HiveSwarmFrame,
  pulse:async()=>{pulses++;throw new PosterityError(403,'forbidden','This task workspace is read-only');}}};
 const stream=followHiveTask(fake as unknown as Pick<Posterity,'swarm'>,'task',{signal:controller.signal,pollMs:500});
 try {
  expect((await stream.next()).value?.context.phase).toBe('deliberate');
  expect((await stream.next()).value?.context.phase).toBe('settled');
  expect((await stream.next()).done).toBe(true);
  expect(pulses).toBe(0);
 } finally {controller.abort();await stream.return();}
});

test('a follower tolerates a room becoming read-only between sync and acknowledgement',async()=>{
 let reads=0;
 const fake={swarm:{sync:async()=>({version:1,context:{task_hash:'hash',phase:++reads===1?'deliberate':'settled'},events:[],next_cursor:0,head:0,has_more:false,leases:[],peers:[]}) as unknown as HiveSwarmFrame,
  pulse:async()=>{throw new PosterityError(403,'forbidden','This task workspace is read-only');}}};
 const received:string[]=[];
 for await(const page of followHiveTask(fake as unknown as Pick<Posterity,'swarm'>,'task',{pollMs:500}))received.push(page.context.phase);
 expect(received).toEqual(['deliberate','settled']);
});

test('a follower still surfaces revoked read access after a failed acknowledgement',async()=>{
 let reads=0;
 const denied=new PosterityError(403,'forbidden','Hive access revoked');
 const fake={swarm:{sync:async()=>{
  if(reads++)throw denied;
  return {version:1,context:{task_hash:'hash',phase:'deliberate'},events:[],next_cursor:0,head:0,has_more:false,leases:[],peers:[]} as unknown as HiveSwarmFrame;
 },pulse:async()=>{throw denied;}}};
 const stream=followHiveTask(fake as unknown as Pick<Posterity,'swarm'>,'task',{pollMs:500});
 expect((await stream.next()).value?.context.phase).toBe('deliberate');
 await expect(stream.next()).rejects.toBe(denied);
});

test('keepLease renews before the supplied lease expires even when its duration is shorter than the renewal TTL',async()=>{
 let renewals=0;let renewed!:()=>void;
 const renewal=new Promise<void>(resolve=>{renewed=resolve;});
 const lease={task_hash:'hash',work_key:'short-lease',token:'token',until_at:new Date(Date.now()+90).toISOString()} as HiveWorkLease;
 const client=new Posterity({apiKey:'fixture',baseUrl:'https://hive.test',fetch:(async()=>{
  renewals++;renewed();return Response.json({...lease,until_at:new Date(Date.now()+120000).toISOString()});
 }) as typeof fetch});
 const keep=client.swarm.keepLease('task',lease);
 try {
  const result=await Promise.race([renewal.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),150))]);
  expect(result).toBe(true);expect(renewals).toBe(1);
 } finally {keep.stop();}
});

test('keepLease reports expiry without trying to revive an expired lease',()=>{
 let renewals=0;const errors:unknown[]=[];
 const client=new Posterity({apiKey:'fixture',baseUrl:'https://hive.test',fetch:(async()=>{renewals++;return Response.json({});}) as typeof fetch});
 const keep=client.swarm.keepLease('task',{until_at:new Date(Date.now()-1).toISOString()} as HiveWorkLease,{onError:error=>errors.push(error)});
 keep.stop();expect(renewals).toBe(0);expect(errors).toHaveLength(1);expect(String(errors[0])).toContain('expired');
});

function page(events: HiveSwarmFrame['events'] = [], extra: Partial<HiveSwarmFrame> = {}): HiveSwarmFrame {
 return {scope:'private_intra_hive',hive_id:'hive',context:{task_id:'task',task_hash:'hash',phase:'settled'},version:1,state:{},state_stale:false,events,next_cursor:events.at(-1)?.sequence??0,head:events.at(-1)?.sequence??0,has_more:false,leases:[],peers:[],...extra} as HiveSwarmFrame;
}
const stub = (sync: (...args: any[]) => Promise<HiveSwarmFrame>, pulse = async (..._args: any[]) => ({})) => ({swarm:{sync,pulse}}) as unknown as Pick<Posterity,'swarm'>;

test('durable cursors advance only after processing, and consumer failure leaves the page replayable',async()=>{
 const saved:number[]=[];
 const client=stub(async()=>page([{sequence:1}] as HiveSwarmFrame['events']));
 const stream=followHiveTask(client,'task',{saveCursor:async cursor=>{saved.push(cursor);}});
 expect((await stream.next()).value?.next_cursor).toBe(1);expect(saved).toEqual([]);
 await stream.return();expect(saved).toEqual([]);
 const resumed=followHiveTask(client,'task',{saveCursor:async(cursor,room)=>{expect(room).toEqual({hiveId:'hive',taskHash:'hash'});saved.push(cursor);}});
 await resumed.next();await resumed.next();expect(saved).toEqual([1]);
});

test('cursor persistence failure prevents server acknowledgement',async()=>{
 let pulses=0;
 const client=stub(async()=>page([],{context:{task_hash:'hash',phase:'work'} as HiveSwarmFrame['context']}),async()=>{pulses++;return {};});
 const stream=followHiveTask(client,'task',{saveCursor:()=>{throw new Error('disk full');}});
 await stream.next();await expect(stream.next()).rejects.toThrow('disk full');expect(pulses).toBe(0);
});

test('a follower reconnects from its last processed cursor after a transient disconnect',async()=>{
 const after:number[]=[],retries:number[]=[];let reads=0;
 const client=stub(async(_task,options)=>{
  after.push(options.after);
  if(++reads===2)throw new TypeError('offline');
  return page([{sequence:reads===1?1:2}] as HiveSwarmFrame['events'],reads===1?{head:2,has_more:true,context:{task_hash:'hash',phase:'work'} as HiveSwarmFrame['context']}:{});
 });
 const seen:number[]=[];
 for await(const frame of followHiveTask(client,'task',{pollMs:500,onRetry:(_e,n)=>{retries.push(n);}}))seen.push(frame.next_cursor);
 expect(seen).toEqual([1,2]);expect(after).toEqual([0,1,1]);expect(retries).toEqual([1]);
});

test('permanent errors surface immediately and transient retries remain bounded',async()=>{
 let reads=0;
 const denied=new PosterityError(403,'forbidden','revoked');
 await expect(followHiveTask(stub(async()=>{reads++;throw denied;}),'task').next()).rejects.toBe(denied);expect(reads).toBe(1);
 reads=0;const offline=new TypeError('offline');
 await expect(followHiveTask(stub(async()=>{reads++;throw offline;}),'task',{maxRetries:1,pollMs:500}).next()).rejects.toBe(offline);expect(reads).toBe(2);
});

test('aborting retry backoff stops the follower without a second request',async()=>{
 const controller=new AbortController();let reads=0;
 const stream=followHiveTask(stub(async()=>{reads++;throw new TypeError('offline');}),'task',{signal:controller.signal,onRetry:()=>controller.abort()});
 expect((await stream.next()).done).toBe(true);expect(reads).toBe(1);
});

test('gaps, duplicate events and invisible cursor advancement are never acknowledged',async()=>{
 for(const frame of [page([{sequence:2}] as HiveSwarmFrame['events']),page([{sequence:1},{sequence:1}] as HiveSwarmFrame['events']),page([],{next_cursor:2,head:2}),page([],{head:1,has_more:false})]) {
  let acknowledged=0;
  await expect(followHiveTask(stub(async()=>frame),'task',{saveCursor:()=>{acknowledged++;}}).next()).rejects.toThrow();expect(acknowledged).toBe(0);
 }
});

test('a cursor cannot silently switch to a different hive room',async()=>{
 let reads=0;
 const client=stub(async()=>++reads===1?page([{sequence:1}] as HiveSwarmFrame['events'],{head:2,has_more:true}):page([{sequence:2}] as HiveSwarmFrame['events'],{hive_id:'other-hive'}));
 const stream=followHiveTask(client,'task');await stream.next();await expect(stream.next()).rejects.toThrow('Hive changed');
});

test('typed hive channels decode only compatible current-context vectors and retain text fallbacks',async()=>{
 const vector=await encodeSwarmVector('fixture@v1:state',[0.25,0.75]);
 const event=(sequence:number,extra={})=>({sequence,agent_id:'peer',context_stale:false,compatible:true,result:{kind:'vector',vector,summary:'Text state'},...extra});
 const events=[event(1),event(2,{compatible:false}),event(3,{context_stale:true})] as unknown as HiveSwarmFrame['events'];
 let decodes=0;
 const channel=new HiveChannel(stub(async()=>page(events)),'task',{space:vector.space,dimensions:2,encode:(s:number[])=>s,decode:(v)=>{decodes++;return Array.from(v);}});
 const stream=channel.follow();const {signals}= (await stream.next()).value!;
 expect(signals.map(s=>s.delivery)).toEqual(['decoded','incompatible','stale']);expect(signals[0].state).toEqual([0.25,0.75]);expect(signals[1].state).toBeUndefined();expect(signals[2].summary).toBe('Text state');expect(decodes).toBe(1);await stream.return();
});

test('a corrupt typed signal is not delivered or persisted',async()=>{
 const vector=await encodeSwarmVector('fixture@v1:state',[1]);let saves=0;
 const event={sequence:1,compatible:true,context_stale:false,result:{kind:'vector',vector:{...vector,sha256:'0'.repeat(64)}}};
 const channel=new HiveChannel(stub(async()=>page([event] as HiveSwarmFrame['events'])),'task',{space:vector.space,dimensions:1,encode:(s:number[])=>s,decode:Array.from});
 await expect(channel.follow({saveCursor:()=>{saves++;}}).next()).rejects.toThrow('Corrupt');expect(saves).toBe(0);
});

test('typed sends require the declared dimensions, text fallback, writable context and matching work lease',async()=>{
 const writes:any[]=[];
 const client={swarm:{vector:async(...args:any[])=>{writes.push(args);return {};}}} as unknown as Pick<Posterity,'swarm'>;
 const channel=new HiveChannel(client,'task',{space:'fixture@v1:state',dimensions:2,encode:(s:number[])=>s,decode:Array.from});
 const frame=page([],{context:{task_id:'task',task_hash:'hash',phase:'work'} as HiveSwarmFrame['context']});
 await channel.send(frame,[1,2],{summary:'Two shared weights',clientId:'stable-id'});
 expect(writes[0].slice(0,2)).toEqual(['task','hash']);expect(writes[0][3]).toMatchObject({summary:'Two shared weights',client_id:'stable-id'});
 await expect(channel.send(frame,[1],{summary:'bad'})).rejects.toThrow('dimensions');
 await expect(channel.send(frame,[1,2],{summary:' '})).rejects.toThrow('fallback');
 await expect(channel.send({...frame,state_stale:true},[1,2],{summary:'stale'})).rejects.toThrow('rebase');
 await expect(channel.send({...frame,writable:false},[1,2],{summary:'closed'})).rejects.toThrow('writable');
 await expect(channel.send(frame,[1,2],{summary:'wrong lease',lease:{task_id:'task',hive_id:'other',task_hash:'hash',until_at:new Date(Date.now()+10000).toISOString()} as HiveWorkLease})).rejects.toThrow('current lease');
 expect(writes).toHaveLength(1);
});

test('class-based adapters retain their methods and instance state',async()=>{
 class Adapter {
  space='fixture@v1:class';dimensions=1;scale=2;
  encode(value:number) {return [value*this.scale];}
  decode(values:Float32Array) {return values[0]/this.scale;}
 }
 let sent:SwarmVector|undefined;
 const client={swarm:{vector:async(_task:string,_hash:string,vector:SwarmVector)=>{sent=vector;return {};}}} as unknown as Pick<Posterity,'swarm'>;
 const channel=new HiveChannel(client,'task',new Adapter());
 await channel.send(page([],{context:{task_id:'task',task_hash:'hash',phase:'work'} as HiveSwarmFrame['context']}),3,{summary:'Class codec state'});
 expect(Array.from(await decodeSwarmVector(sent!,sent!.space))).toEqual([6]);
});

test('invalid resume and backpressure options fail before making requests',async()=>{
 let reads=0;const client=stub(async()=>{reads++;return page();});
 for(const options of [{after:-1},{after:Infinity},{pollMs:NaN},{pageSize:0},{pageSize:101},{maxRetries:-1}]) await expect(followHiveTask(client,'task',options).next()).rejects.toThrow();
 expect(reads).toBe(0);
});
