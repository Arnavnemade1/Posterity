import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { array, id, type Input, int, object, oneOf, optionalId, str } from '../lib/validate.ts';
import { type Ctx, gate, requireAgent } from './context.ts';

export async function manifestTool(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  if (input.action === 'set') {
    const manifest = object(input, 'manifest');
    if (!manifest) throw new ApiError(400, 'bad_request', 'manifest is required');
    return rpc('set_capability_manifest', { p_agent: agent.id, p_manifest: manifest });
  }
  const [manifest, reliability, lab_identity] = await Promise.all([
    query(db().from('agent_manifests').select('manifest, revision, updated_at').eq('agent_id', agent.id).maybeSingle()),
    query(db().from('agent_capability_reliability').select('*').eq('agent_id', agent.id)),
    rpc('agent_lab_identity', { p_agent: agent.id }),
  ]);
  return { ...(manifest ?? { manifest: null }), reliability, lab_identity };
}

export async function ensembleTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', ['list','get','open','join','contribute','score','leave','submit','metrics','labs','commit','reveal','admissibility'] as const) ?? 'list';
  if (action === 'labs') return rpc('lab_verification_readiness');
  if (action === 'metrics') return rpc('ensemble_metrics');
  if (action === 'list') {
    let q = db().from('ensembles').select('*').order('created_at', { ascending: false }).limit(int(input, 'limit', { min: 1, max: 50 }) ?? 20);
    if (input.task_id) q = q.eq('task_id', id(input, 'task_id'));
    const status = oneOf(input, 'status', ['recruiting','active','in_review','completed','cancelled'] as const);
    if (status) q = q.eq('status', status);
    return { ensembles: await query(q) };
  }
  if (action === 'get') return rpc('ensemble_view', { p_ensemble: id(input, 'ensemble_id') });
  const agent = requireAgent(ctx);
  if (action === 'admissibility') {
    if(typeof input.admissible!=='boolean')throw new ApiError(400,'bad_request','admissible must be a boolean');
    return rpc('assess_ensemble_admissibility',{p_agent:agent.id,p_contribution:id(input,'contribution_id'),p_admissible:input.admissible,
      p_reason:str(input,'rationale',{required:true,max:4000})});
  }
  if (action === 'open') return rpc('ensemble_open', { p_agent: agent.id, p_task: id(input, 'task_id'), p_spec: object(input, 'spec') });
  if (action === 'score') {
    const score = int(input, 'score', { min: 0, max: 5 });
    if (score === undefined) throw new ApiError(400, 'bad_request', 'score is required');
    return rpc('ensemble_score', { p_agent: agent.id, p_contribution: id(input, 'contribution_id'), p_score: score, p_rationale: str(input, 'rationale', { required: true, max: 8000 }) });
  }
  const p_ensemble = id(input, 'ensemble_id');
  if (action === 'commit' || action === 'reveal') {
    const round = int(input, 'round', { min: 1, max: 2147483647 });
    if (round === undefined) throw new ApiError(400, 'bad_request', 'round is required');
    if (action === 'commit') return rpc(input.algorithm==='accountable-v1'?'ensemble_commit_accountable':'ensemble_commit', { p_agent: agent.id, p_ensemble, p_round: round,
      p_digest: str(input, 'digest', { required: true, max: 64 }),...(input.algorithm==='accountable-v1'?{p_algorithm:'accountable-v1'}:{}) });
    return rpc(input.accountability_wire!==undefined?'ensemble_reveal_accountable':'ensemble_reveal', { p_agent: agent.id, p_ensemble, p_round: round,
      p_kind: oneOf(input, 'kind', ['draft','objection','review','evidence','synthesis'] as const) ?? '',
      p_summary: str(input, 'summary', { required: true, max: 4000, trim: false }),
      p_content: str(input, 'content', { max: 200000, trim: false }) ?? '',
      p_nonce: str(input, 'nonce', { required: true, max: 64 }),...(input.accountability_wire!==undefined?{
        p_accountability_wire:str(input,'accountability_wire',{required:true,max:32000,trim:false}),p_vector_hash:str(input,'vector_hash',{max:64})??null}:{}) });
  }
  if (action === 'join') {
    const role = oneOf(input, 'role', ['proposer','critic','specialist','synthesizer'] as const);
    if (!role) throw new ApiError(400, 'bad_request', 'role is required');
    await gate(ctx, 'tasks.claim', { ...input, action }, `Join ensemble ${p_ensemble} as ${role}`);
    return rpc('ensemble_join', { p_agent: agent.id, p_ensemble, p_role: role });
  }
  if (action === 'contribute') {
    const kind = oneOf(input, 'kind', ['draft','objection','review','evidence','synthesis'] as const);
    if (!kind) throw new ApiError(400, 'bad_request', 'kind is required');
    if ('vectors' in input || 'embedding' in input)throw new ApiError(400,'bad_request','Opaque vectors stay at L0/L1; L2 accepts a vector hash with legible accountability');
    return rpc(input.accountability_wire!==undefined?'ensemble_contribute_accountable':'ensemble_contribute', { p_agent: agent.id, p_ensemble, p_kind: kind,
      p_summary: str(input, 'summary', { required: true, max: 4000 }), p_content: str(input, 'content', { max: 200000, trim: false }) ?? '',
      p_responds_to: optionalId(input, 'responds_to'), p_tokens: int(input, 'tokens', { min: 0, max: 50000000 }), p_model: str(input, 'model', { max: 80 }),
      ...(input.accountability_wire!==undefined?{p_accountability_wire:str(input,'accountability_wire',{required:true,max:32000,trim:false}),p_vector_hash:str(input,'vector_hash',{max:64})??null}:{}) });
  }
  if (action === 'leave') return rpc('ensemble_leave', { p_agent: agent.id, p_ensemble, p_reason: str(input, 'reason', { required: true, max: 2000 }), p_capability: str(input, 'capability', { max: 120 }) });
  const contributions = array(input, 'contributions', 64) ?? [];
  for (const contribution_id of contributions) id({ contribution_id }, 'contribution_id');
  const result = await rpc<Record<string, unknown>>('ensemble_submit', { p_agent: agent.id, p_ensemble, p_synthesis: id(input, 'synthesis_id'), p_contributions: contributions,
    p_resolutions: array(input, 'resolutions', 64) ?? [], p_artifacts: array(input, 'artifacts', 20) ?? [], p_checks: array(input, 'checks', 100) ?? [] });
  return { ...result, next: 'Independent reviewers will check the final output and each upheld objection. Watch your heartbeat for acceptance or a new revision round.' };
}
