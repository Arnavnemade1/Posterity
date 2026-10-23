import { PosterityError, type Posterity } from './client.js';
import type { HiveSwarmFrame, SwarmVector } from './types.js';

const hash=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

/** Space identifies model/checkpoint/layer semantics; the transport never invents an adapter. */
export async function encodeSwarmVector(space:string,values:ArrayLike<number>):Promise<SwarmVector> {
  if(space.length<3 || space.length>200 || values.length<1 || values.length>16384)throw new Error('Declare a vector space and 1-16384 elements');
  const bytes=new Uint8Array(values.length*4),view=new DataView(bytes.buffer);
  for(let i=0;i<values.length;i++) {
    view.setFloat32(i*4,values[i],true);
    if(!Number.isFinite(values[i]) || !Number.isFinite(view.getFloat32(i*4,true)))throw new Error('Finite float32 values required');
  }
  let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  return {space,encoding:'f32le-base64',dimensions:values.length,data:btoa(binary),sha256:await hash(bytes)};
}

export async function decodeSwarmVector(vector:SwarmVector,expectedSpace:string):Promise<Float32Array> {
  if(vector.space!==expectedSpace || vector.encoding!=='f32le-base64')throw new Error('Incompatible vector space; use an explicit adapter or text fallback');
  if(!Number.isInteger(vector.dimensions) || vector.dimensions<1 || vector.dimensions>16384 || typeof vector.data!=='string' || vector.data.length>87384)throw new Error('Invalid bounded vector');
  const binary=atob(vector.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(btoa(binary)!==vector.data || bytes.length!==4*vector.dimensions || await hash(bytes)!==vector.sha256)throw new Error('Corrupt vector dimensions or digest');
  const view=new DataView(bytes.buffer),values=new Float32Array(vector.dimensions);
  for(let i=0;i<values.length;i++) {values[i]=view.getFloat32(i*4,true);if(!Number.isFinite(values[i]))throw new Error('Nonfinite vector');}
  return values;
}

function pause(ms:number,signal?:AbortSignal) {
  return new Promise<void>(resolve=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();
  });
}

/** One in-flight read; drain cursor pages before sleeping. Consumer controls acknowledgement. */
export async function* followHiveTask(client:Pick<Posterity,'swarm'>,task:string,options:{after?:number;spaces?:string[];signal?:AbortSignal;pollMs?:number;maxIdleMs?:number}={}):AsyncGenerator<HiveSwarmFrame> {
  let cursor=options.after??0,idle=0,last='';const interval=Math.max(500,options.pollMs??1500),maximum=Math.max(interval,options.maxIdleMs??6000);
  const signature=(frame:HiveSwarmFrame)=>JSON.stringify([frame.version,frame.context.task_hash,frame.context.public_activity,frame.context.phase,frame.leases,frame.peers.map(p=>[p.agent_id,p.acknowledged,p.status,p.online])]);
  while(!options.signal?.aborted) {
    let frame:HiveSwarmFrame;
    try { frame=await client.swarm.sync(task,{after:cursor,spaces:options.spaces,signal:options.signal}); }
    catch(error) {if(options.signal?.aborted)return;throw error;}
    const changed=frame.events.length>0 || last!==signature(frame);
    if(changed)yield frame;
    if(options.signal?.aborted)return;
    // Reaching the next generator iteration means the consumer handled the frame.
    cursor=frame.next_cursor;
    if(frame.context.phase==='settled'){if(frame.has_more)continue;return;}
    try {await client.swarm.pulse(task,frame.context.task_hash,cursor,{},options.signal);}
    catch(error) {if(options.signal?.aborted)return;if(error instanceof PosterityError && error.status===409){last='';continue;}throw error;}
    last=signature(frame);
    if(frame.has_more){idle=0;continue;}
    idle=changed?0:Math.min(idle+1,3);
    await pause(Math.min(maximum,interval*2**idle),options.signal);
  }
}
