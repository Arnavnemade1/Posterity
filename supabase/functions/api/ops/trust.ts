import { db, query, rpc } from '../lib/db.ts';
import { id, int, oneOf, str, type Input } from '../lib/validate.ts';
import { requireAgent, type Ctx } from './context.ts';
import { ApiError } from '../lib/http.ts';
import { object, bool } from '../lib/validate.ts';
import { verifyPossession, verifyTrustBeacon } from '../lib/trust_crypto.ts';

/** Batch declarations with task discovery, so the regime is visible before claiming. */
export async function taskTrustContracts(taskIds: string[]) {
  if (!taskIds.length) return new Map<string, unknown>();
  const rows = await query<{ task_id: string; epoch: unknown }[]>(db().from('trust_tasks').select('*,epoch:trust_epochs(*)').in('task_id', taskIds));
  return new Map(rows.map(row => [row.task_id, row]));
}

/** Governance/custody administration is separate from every agent-facing action. */
export async function trustTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', ['status','account','enroll','release','appeal','challenge','confirm','hive','promote','vouch','release_vouch',
    'sandbox','sandbox_submit','audit','audit_queue','prepare_draw','draw','finalize_draw','jury_vote','settle_jury','rewards','claim','withdraw','adopt_epoch'] as const) ?? 'status';
  if (action === 'status') return rpc('trust_status');
  if (action === 'hive') return rpc('trust_hive_view',{p_hive:id(input,'hive_id')});
  if (action === 'draw') {
    const result=await query(db().from('trust_draws').select('*').eq('id',id(input,'draw_id')).maybeSingle());
    if(!result)throw new ApiError(404,'not_found','Draw not found'); return result;
  }
  const agent = requireAgent(ctx);
  if(action==='audit_queue')return rpc('trust_audit_queue',{p_agent:agent.id,p_limit:int(input,'limit',{min:1,max:100})??50});
  if(action==='adopt_epoch')return rpc('adopt_trust_epoch',{p_agent:agent.id,p_epoch:id(input,'epoch_id')});
  if (action === 'challenge') {
    const payload=object(input,'payload');if(!payload)throw new ApiError(400,'bad_request','payload is required');
    return rpc('issue_trust_challenge',{p_agent:agent.id,p_purpose:oneOf(input,'purpose',['hive_create','hive_join','identity'] as const)??'',p_payload:payload});
  }
  if (action === 'confirm') {
    const challenge=await query(db().from('trust_key_challenges').select('*').eq('id',id(input,'challenge_id')).eq('agent_id',agent.id).maybeSingle());
    if(!challenge)throw new ApiError(404,'not_found','Challenge not found');
    if(!await verifyPossession(challenge.public_key,str(input,'signature',{required:true,max:128})!,challenge.message))throw new ApiError(403,'forbidden','Invalid Ed25519 possession signature');
    return rpc('confirm_trust_possession',{p_agent:agent.id,p_challenge:challenge.id,p_signature:str(input,'signature',{required:true,max:128})});
  }
  if(action==='promote')return rpc('promote_trust_identity',{p_agent:agent.id});
  if(action==='rewards')return rpc('release_trust_rewards',{p_agent:agent.id});
  if(action==='vouch')return rpc('vouch_trust_identity',{p_voucher:agent.id,p_vouchee:id(input,'agent_id'),p_reason:str(input,'reason',{required:true,max:4000})});
  if(action==='release_vouch')return rpc('release_trust_vouch',{p_agent:agent.id,p_vouch:id(input,'vouch_id')});
  if(action==='withdraw') {
    const units=int(input,'units',{min:1,max:1000000000}),nonce=str(input,'nonce',{required:true,max:64})!;
    const key=await query(db().from('trust_identity_keys').select('public_key').eq('agent_id',agent.id).maybeSingle());
    if(!units || !/^[0-9a-f]{64}$/.test(nonce) || !key || !await verifyPossession(key.public_key,str(input,'signature',{required:true,max:128})!,`posterity-withdraw-v1:${agent.id}:${units}:${nonce}`))
      throw new ApiError(403,'forbidden','Identity-key signature over this withdrawal amount and nonce required');
    return rpc('request_signed_trust_withdrawal',{p_agent:agent.id,p_units:units,p_nonce:nonce});
  }
  if(action==='sandbox') {
    const standing=await query(db().from('trust_standing').select('epoch_id').eq('agent_id',agent.id).maybeSingle());
    if(!standing)throw new ApiError(403,'forbidden','Enroll in the trust ladder first');
    return {tasks:await query(db().from('trust_sandbox_tasks').select('*').eq('epoch_id',standing.epoch_id).order('created_at').limit(50)),
      outputs:await query(db().from('trust_sandbox_outputs').select('*').eq('agent_id',agent.id).order('created_at',{ascending:false}).limit(50)),scope:'quarantine_nonexport'};
  }
  if(action==='sandbox_submit')return rpc('submit_sandbox_output',{p_agent:agent.id,p_task:id(input,'task_id'),p_content:str(input,'content',{required:true,max:200000,trim:false})});
  if(action==='audit')return rpc('record_trust_audit',{p_agent:id(input,'agent_id'),p_task:id(input,'task_id'),p_sandbox:bool(input,'sandbox')??false,p_passed:bool(input,'passed'),
    p_reviewer:agent.id,p_reserve:null,p_hash:str(input,'evidence_hash',{required:true,max:64}),p_reason:str(input,'reason',{required:true,max:8000})});
  if(action==='prepare_draw')return rpc('prepare_trust_draw',{p_target:id(input,'target_id'),p_role:str(input,'role',{required:true,max:80}),p_purpose:oneOf(input,'purpose',['assignment','jury','appeal_jury'] as const)??'assignment'});
  if(action==='finalize_draw') {
    const draw=await query(db().from('trust_draws').select('id,epoch_id,beacon_round').eq('id',id(input,'draw_id')).maybeSingle());
    if(!draw)throw new ApiError(404,'not_found','Draw not found');
    const cfg=await rpc<Record<string,unknown>>('trust_cfg',{p_epoch:draw.epoch_id});
    const beacon={round:int(input,'round',{min:1,max:Number.MAX_SAFE_INTEGER})??0,signature:str(input,'signature',{required:true,max:96})!,randomness:str(input,'randomness',{required:true,max:64})!};
    if(!await verifyTrustBeacon(beacon,String(cfg.beacon_public_key),Number(draw.beacon_round)))throw new ApiError(403,'forbidden','Invalid signature or wrong committed beacon round');
    return rpc('finalize_trust_draw',{p_draw:draw.id,p_signature:beacon.signature,p_randomness:beacon.randomness});
  }
  if(action==='jury_vote')return rpc('cast_trust_jury_vote',{p_agent:agent.id,p_draw:id(input,'draw_id'),p_confirm:bool(input,'confirm'),p_units:int(input,'units',{min:0,max:1000000000}),p_reason:str(input,'reason',{required:true,max:8000})});
  if(action==='settle_jury')return rpc('settle_trust_jury',{p_draw:id(input,'draw_id')});
  if(action==='claim') {
    const claim=await rpc<Record<string,unknown>|null>('trust_portable_claim',{p_agent:agent.id,p_home:ctx.apiBase});
    if(!claim)throw new ApiError(404,'not_found','No permissionless claim to export');
    const canonical=JSON.stringify(claim),key=Deno.env.get('POSTERITY_TRUST_SIGNING_KEY_PKCS8');
    if(!key)return {claim,canonical,signature:null,assurance:'unsigned_home_log_claim'};
    const signingKey=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(key),c=>c.charCodeAt(0)),{name:'Ed25519'},false,['sign']);
    const signature=Array.from(new Uint8Array(await crypto.subtle.sign('Ed25519',signingKey,new TextEncoder().encode(canonical))),b=>b.toString(16).padStart(2,'0')).join('');
    return {claim,canonical,signature,assurance:'home_signed_claim; receiving deployment assigns weight locally'};
  }
  if (action === 'account') return rpc('trust_account_view', {
    p_agent: agent.id, p_limit: int(input, 'limit', { min: 1, max: 100 }) ?? 50,
    p_offset: int(input, 'offset', { min: 0 }) ?? 0,
  });
  if (action === 'enroll') return input.epoch_id ? rpc('enroll_permissionless',{p_agent:agent.id,p_epoch:id(input,'epoch_id')}) : rpc('trust_enroll', { p_agent: agent.id });
  if (action === 'release') return rpc('trust_release', { p_agent: agent.id });
  return rpc('appeal_trust_case', {
    p_agent: agent.id, p_case: id(input, 'case_id'), p_reason: str(input, 'reason', { required: true, max: 4000 }),
  });
}
