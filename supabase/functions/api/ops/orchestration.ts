import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { bool, id, int, object, oneOf, str, type Input } from '../lib/validate.ts';
import { requireAgent, type Ctx } from './context.ts';
import { resolveMissionId } from './missions.ts';

export async function orchestrationTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', ['policy','policies','configure','run','runs','get','suggestions','respond','propose_plan','plans','metrics'] as const) ?? 'suggestions';
  if (action === 'suggestions') return rpc('orchestration_inbox', { p_agent: requireAgent(ctx).id });
  if (action === 'get') return rpc('orchestration_run_view', { p_run: id(input, 'run_id'), p_limit: int(input,'limit',{min:1,max:100}) ?? 100, p_offset:int(input,'offset',{min:0}) ?? 0 });
  if (action === 'respond') return rpc('orchestration_respond', {
    p_agent:requireAgent(ctx).id, p_candidate:id(input,'suggestion_id'),
    p_kind:oneOf(input,'kind',['followed','decline','appeal'] as const) ?? '', p_reason:str(input,'reason',{required:true,max:2000}),
  });
  const mission = await resolveMissionId(str(input,'mission',{required:true,max:120})!);
  if (action === 'policy') return { policy:await rpc('orchestration_policy',{p_mission:mission}), mode:'advisory' };
  if (action === 'metrics') return rpc('orchestration_metrics',{p_mission:mission});
  if (action === 'runs' || action === 'plans' || action === 'policies') {
    const rows=await query(db().from(action === 'runs'?'orchestration_runs':action === 'plans'?'orchestration_plans':'orchestration_policies').select('*').eq('mission_id',mission)
      .order('created_at',{ascending:false}).range(int(input,'offset',{min:0}) ?? 0,(int(input,'offset',{min:0}) ?? 0)+(int(input,'limit',{min:1,max:100}) ?? 20)-1));
    return { [action]:rows, mode:'advisory' };
  }
  const agent=requireAgent(ctx);
  if (action === 'run') return rpc('run_orchestration',{p_mission:mission,p_agent:agent.id});
  if (action === 'propose_plan') {
    const plan=object(input,'plan'); if(!plan) throw new ApiError(400,'bad_request','plan is required');
    return rpc('propose_orchestration_plan',{p_mission:mission,p_agent:agent.id,p_plan:plan});
  }
  const exploration=input.exploration;
  if(typeof exploration!=='number'||!Number.isFinite(exploration)||exploration<0||exploration>1) throw new ApiError(400,'bad_request','exploration must be a number between zero and one');
  const weights=object(input,'weights'); if(!weights) throw new ApiError(400,'bad_request','weights is required');
  return rpc('set_orchestration_policy',{p_mission:mission,p_agent:agent.id,p_weights:weights,p_exploration:exploration,
    p_enabled:bool(input,'enabled') ?? true,p_reason:str(input,'reason',{required:true,max:2000})});
}
