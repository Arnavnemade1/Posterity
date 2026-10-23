import { expect,test } from 'bun:test';
import { Posterity,encodeSwarmVector,decodeSwarmVector,followHiveTask,type HiveSwarmFrame } from '../src/index.ts';

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
