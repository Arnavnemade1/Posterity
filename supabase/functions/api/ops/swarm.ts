import { rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { id, int, object, oneOf, str, strList, type Input } from '../lib/validate.ts';
import { requireAgent, type Ctx } from './context.ts';

/** Explicit model-space agreement; byte transport does not imply shared semantics. */
export async function validateSwarmVector(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400,'bad_request','Vector envelope required');
  const v=value as Record<string,unknown>;
  if (v.encoding!=='f32le-base64' || typeof v.space!=='string' || v.space.length<3 || v.space.length>200 ||
    !Number.isInteger(v.dimensions) || Number(v.dimensions)<1 || Number(v.dimensions)>16384 ||
    typeof v.data!=='string' || v.data.length>87384 || typeof v.sha256!=='string' || !/^[0-9a-f]{64}$/.test(v.sha256)) {
    throw new ApiError(400,'bad_request','Declare vector space, f32le-base64 encoding, dimensions and SHA-256');
  }
  let binary:string;
  try { binary=atob(v.data); } catch { throw new ApiError(400,'bad_request','Invalid vector base64'); }
  if (btoa(binary)!==v.data || binary.length!==4*Number(v.dimensions)) throw new ApiError(400,'bad_request','Vector dimensions do not match canonical bytes');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
  for(let i=0;i<bytes.length;i+=4) if(!Number.isFinite(view.getFloat32(i,true))) throw new ApiError(400,'bad_request','Vector elements must be finite float32 values');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==v.sha256) throw new ApiError(400,'bad_request','Vector SHA-256 does not match its bytes');
}

export async function swarmTool(ctx: Ctx,input: Input) {
  const agent=requireAgent(ctx),task=id(input,'task_id');
  const action=oneOf(input,'action',['sync','event','checkpoint','claim','renew','release','pulse'] as const)??'sync';
  if(action==='sync') return rpc('hive_swarm_sync',{p_agent:agent.id,p_task:task,p_after:int(input,'after',{min:0,max:Number.MAX_SAFE_INTEGER})??0,
    p_spaces:strList(input,'spaces',{max:16,itemMax:200})??[],p_limit:int(input,'limit',{min:1,max:100})??50});
  const payload=object(input,'payload');
  if(!payload)throw new ApiError(400,'bad_request','Workspace payload object required');
  if(action==='event' && payload.kind==='vector')await validateSwarmVector(payload.vector);
  return rpc('hive_swarm_write',{p_agent:agent.id,p_task:task,p_action:action,p_payload:payload,p_client:id(input,'client_id'),
    p_task_hash:str(input,'task_hash',{required:true,max:64}),p_expected:int(input,'expected_version',{min:0,max:Number.MAX_SAFE_INTEGER})??null});
}
