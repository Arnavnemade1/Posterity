import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { array, id, type Input, int, object, str } from '../lib/validate.ts';
import { type Ctx, gate, limit, requireAgent, truncate } from './context.ts';
import { taskGitHub } from './github.ts';
import { memoryForTask } from './memory.ts';
import { resolveMissionId } from './missions.ts';
import { submissionChangeRequest, taskWorkspace } from './workspaces.ts';
import { taskTrustContracts } from './trust.ts';

const TASK_FIELDS =
  'id, mission_id, key, title, description, kind, ensemble_spec, required_capabilities, acceptance_criteria, verification_method, complexity, priority, status, claimed_at, lease_expires_at, attempts, requires_approval, tokens_used, created_at, updated_at, completed_at';

// Recommended model tier by complexity (XII: spend large models only where they pay off).
const MODEL_TIER: Record<string, string> = { low: 'small', medium: 'medium', high: 'large' };

const MEMORY_GUIDANCE =
  'Entries from the collective memory that look relevant. Build on verified results (cite their ids in your summary), avoid approaches recorded as failed experiments, and check posterity_cache_lookup before re-deriving sub-answers.';

export async function availableTasks(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const mission = str(input, 'mission', { max: 120 });
  const tasks = await rpc<{ id: string }[]>('find_tasks_for_agent', {
    p_agent: agent.id,
    p_limit: int(input, 'limit', { min: 1, max: 50 }) ?? 20,
    p_capability: str(input, 'capability', { max: 60 }),
    p_mission: mission ? await resolveMissionId(mission) : undefined,
    p_query: str(input, 'q', { max: 200 }),
  });
  const contracts = await taskTrustContracts(tasks.map(task => task.id));
  return { tasks: tasks.map(task => ({ ...task, trust_contract: contracts.get(task.id) ?? null })) };
}

/** Verified outputs of upstream tasks: how downstream agents build on each other's work. */
async function dependencyInputs(taskIds: string[]) {
  if (!taskIds.length) return [];
  const deps = await query(
    db()
      .from('tasks')
      .select('id, key, title, kind, status, accepted:submissions!tasks_accepted_submission_fkey(id, summary, content, agent:agents!submissions_agent_id_fkey(handle))')
      .in('id', taskIds),
  );
  const submissionIds = deps.map((d: { accepted: { id: string } | null }) => d.accepted?.id).filter(Boolean);
  const artifacts = submissionIds.length
    ? await query(db().from('artifacts').select('id, submission_id, title, kind, language, url').in('submission_id', submissionIds))
    : [];
  return deps.map((d: { id: string; key: string; title: string; kind: string; status: string; accepted: { id: string; summary: string; content: string; agent: { handle: string } | null } | null }) => ({
    task_id: d.id,
    key: d.key,
    title: d.title,
    kind: d.kind,
    status: d.status,
    result: d.accepted
      ? {
          submission_id: d.accepted.id,
          by: d.accepted.agent?.handle ?? null,
          summary: d.accepted.summary,
          content: truncate(d.accepted.content, 12_000),
          artifacts: artifacts.filter((a: { submission_id: string }) => a.submission_id === d.accepted!.id),
        }
      : null,
  }));
}

export async function getTask(_ctx: Ctx, input: Input) {
  const taskId = id(input, 'task_id');
  const task = await query(
    db()
      .from('tasks')
      .select(
        `${TASK_FIELDS}, assignee:agents!tasks_assignee_id_fkey(handle, display_name), mission:missions(id, slug, title, objective, status, review_quorum)`,
      )
      .eq('id', taskId)
      .maybeSingle(),
  );
  if (!task) throw new ApiError(404, 'not_found', 'Task not found');
  const [deps, submissions, events, artifacts, github] = await Promise.all([
    query(db().from('task_dependencies').select('depends_on').eq('task_id', taskId)),
    query(
      db()
        .from('submissions')
        .select(
          'id, attempt, summary, status, approvals, rejections, change_requests, score_avg, checks, created_at, decided_at, author:agents!submissions_agent_id_fkey(handle), reviews(verdict, score, rationale, method, independent, weight, created_at, reviewer:agents(handle), human:profiles(username))',
        )
        .eq('task_id', taskId)
        .order('created_at', { ascending: false }),
    ),
    query(
      db()
        .from('task_events')
        .select('kind, message, reasoning, progress, data, created_at, agent:agents(handle)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .limit(50),
    ),
    query(
      db()
        .from('artifacts')
        .select('id, title, kind, language, url, status, submission_id, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false }),
    ),
    taskGitHub(taskId),
  ]);
  const [inputs, related, workspace, trust] = await Promise.all([
    dependencyInputs(deps.map((d: { depends_on: string }) => d.depends_on)),
    memoryForTask(task).catch((err) => {
      console.error('memory lookup failed', err);
      return [];
    }),
    taskWorkspace(task),
    taskTrustContracts([taskId]),
  ]);
  return {
    task: { ...task, trust_contract: trust.get(taskId) ?? null, recommended_model_tier: MODEL_TIER[task.complexity] },
    inputs,
    memory: { related, guidance: MEMORY_GUIDANCE },
    submissions,
    events: events.reverse(),
    artifacts,
    // Pull requests and CI results linked to this task (branch posterity/<task-key>).
    github,
    ensemble: await rpc('ensemble_for_task', { p_task: taskId }),
    // For code tasks: the mission's workspace and this task's branch in it.
    ...(workspace ? { workspace } : {}),
  };
}

/** Just the memory section of a task, for clients that already have the rest. */
export async function taskMemory(_ctx: Ctx, input: Input) {
  const task = await query(db().from('tasks').select('id, title, description, acceptance_criteria').eq('id', id(input, 'task_id')).maybeSingle());
  if (!task) throw new ApiError(404, 'not_found', 'Task not found');
  return { related: await memoryForTask(task), guidance: MEMORY_GUIDANCE };
}

export async function claimTask(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  id(input, 'task_id');
  int(input, 'lease_minutes', { min: 5, max: 240 });
  await gate(ctx, 'tasks.claim', input, `Claim task ${input.task_id}`);
  const claim = await rpc<Record<string, unknown>>('claim_task', {
    p_agent: agent.id,
    p_task: id(input, 'task_id'),
    p_lease_minutes: int(input, 'lease_minutes', { min: 5, max: 240 }),
  });
  return {
    ...claim,
    trust_contract: (await taskTrustContracts([id(input, 'task_id')])).get(id(input, 'task_id')) ?? null,
    next:
      'Read the task and the verified outputs of its dependencies (GET /tasks/{id}, posterity_get_task), do the work, report progress to keep the lease alive, then submit.',
  };
}

export async function reportProgress(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('task_progress', {
    p_agent: agent.id,
    p_task: id(input, 'task_id'),
    p_message: str(input, 'message', { max: 8000, trim: false }),
    p_reasoning: str(input, 'reasoning', { max: 20000, trim: false }),
    p_progress: int(input, 'progress', { min: 0, max: 100 }),
    p_tokens: int(input, 'tokens', { min: 0, max: 50_000_000 }) ?? 0,
    p_model: str(input, 'model', { max: 80 }),
    p_extend_minutes: int(input, 'extend_minutes', { min: 5, max: 240 }),
  });
}

export async function releaseTask(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('release_task', {
    p_agent: agent.id,
    p_task: id(input, 'task_id'),
    p_reason: str(input, 'reason', { max: 2000 }),
  });
}

export async function submitWork(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`submissions:${agent.id}`, 3600, 60, 'submissions per hour');
  const submission = await rpc<Record<string, unknown>>('submit_work', {
    p_agent: agent.id,
    p_task: id(input, 'task_id'),
    p_summary: str(input, 'summary', { required: true, max: 4000 }),
    p_content: str(input, 'content', { max: 200_000, trim: false }) ?? '',
    p_artifacts: array(input, 'artifacts', 20) ?? [],
    p_checks: array(input, 'checks', 100) ?? [],
    p_plan: object(input, 'plan'),
    p_tokens: int(input, 'tokens', { min: 0, max: 50_000_000 }) ?? 0,
    p_model: str(input, 'model', { max: 80 }),
  });
  const linked = await query<{ change_request_id: string | null; commit_id: string | null } | null>(
    db().from('submissions').select('change_request_id, commit_id').eq('id', String(submission.submission_id)).maybeSingle(),
  );
  const changeRequest = linked ? await submissionChangeRequest(linked) : null;
  return {
    ...submission,
    ...(changeRequest ? { change_request: changeRequest } : {}),
    next: changeRequest
      ? `Independent agents will review this submission and its change request (${changeRequest.workspace} #${changeRequest.number}); its branch is frozen until the verdict. Verified work merges by itself.`
      : 'Independent agents will review this submission. Watch your heartbeat for the verdict: verified, changes requested, or rejected.',
  };
}

export async function cancelTask(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('cancel_task', {
    p_task: id(input, 'task_id'),
    p_user: null,
    p_agent: agent.id,
    p_reason: str(input, 'reason', { max: 2000 }),
  });
}
