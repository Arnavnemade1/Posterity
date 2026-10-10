import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { bool, id, type Input, int, isUuid, object, oneOf, optionalId, str, strList } from '../lib/validate.ts';
import { type Ctx, gate, limit, requireAgent } from './context.ts';
import { openListings } from './exchange.ts';
import { missionGitHub } from './github.ts';
import { resolveOrgId } from './orgs.ts';

const MISSION_FIELDS =
  'id, slug, title, objective, status, visibility, tags, required_capabilities, review_quorum, requires_plan_approval, requires_final_approval, budget_tokens, tokens_used, repo_url, task_total, task_done, created_at, updated_at, started_at, completed_at';
const STATUSES = ['planning', 'awaiting_approval', 'active', 'review', 'completed', 'cancelled'] as const;
const ARTIFACT_KINDS = ['code', 'dataset', 'document', 'notebook', 'report', 'link', 'model', 'diagram', 'other'] as const;

/** Missions are addressed by id or slug everywhere. */
export async function resolveMissionId(ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const row = await query(db().from('missions').select('id').eq('slug', ref.toLowerCase()).maybeSingle());
  if (!row) throw new ApiError(404, 'not_found', `No mission "${ref}"`);
  return row.id;
}

const missionRef = (input: Input) => resolveMissionId(str(input, 'mission', { required: true, max: 120 })!);

export async function listMissions(_ctx: Ctx, input: Input) {
  const max = int(input, 'limit', { min: 1, max: 100 }) ?? 30;
  const offset = int(input, 'offset', { min: 0 }) ?? 0;
  const status = oneOf(input, 'status', [...STATUSES, 'open'] as const);
  const q = str(input, 'q', { max: 200 });
  const capability = str(input, 'capability', { max: 60 })?.toLowerCase();

  let builder = db()
    .from('missions')
    .select(`${MISSION_FIELDS}, lead:agents!missions_lead_agent_id_fkey(handle, display_name)`)
    .eq('visibility', 'public');
  if (status === 'open') builder = builder.in('status', ['planning', 'active']);
  else if (status) builder = builder.eq('status', status);
  if (q) builder = builder.textSearch('search', q, { type: 'websearch', config: 'english' });
  if (capability) builder = builder.contains('required_capabilities', [capability]);
  return { missions: await query(builder.order('created_at', { ascending: false }).range(offset, offset + max - 1)) };
}

export async function getMission(_ctx: Ctx, input: Input) {
  const missionId = await missionRef(input);
  const mission = await query(
    db()
      .from('missions')
      .select(
        `${MISSION_FIELDS}, description, result_summary, lead:agents!missions_lead_agent_id_fkey(handle, display_name), creator_agent:agents!missions_created_by_agent_fkey(handle), creator_user:profiles!missions_created_by_user_fkey(username, display_name)`,
      )
      .eq('id', missionId)
      .maybeSingle(),
  );
  if (!mission) throw new ApiError(404, 'not_found', 'Mission not found');

  const [tasks, members, messages, approvals, artifacts, org, resources, github] = await Promise.all([
    query(
      db()
        .from('tasks')
        .select(
          'id, key, title, kind, status, required_capabilities, complexity, priority, verification_method, requires_approval, attempts, lease_expires_at, tokens_used, created_at, completed_at, assignee:agents!tasks_assignee_id_fkey(handle), deps:task_dependencies!task_dependencies_task_id_fkey(depends_on)',
        )
        .eq('mission_id', missionId)
        .order('created_at'),
    ),
    query(
      db()
        .from('mission_members')
        .select('role, joined_at, agent:agents(handle, display_name, capabilities)')
        .eq('mission_id', missionId)
        .order('joined_at'),
    ),
    query(
      db()
        .from('mission_messages')
        .select(
          'id, kind, body, reply_to, task_id, created_at, author_agent:agents!mission_messages_author_agent_id_fkey(handle), author_user:profiles!mission_messages_author_user_id_fkey(username)',
        )
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(30),
    ),
    query(
      db()
        .from('approvals')
        .select('id, kind, title, details, status, task_id, submission_id, created_at, requested_by:agents!approvals_requested_by_agent_fkey(handle)')
        .eq('mission_id', missionId)
        .eq('status', 'pending')
        .order('created_at'),
    ),
    query(
      db()
        .from('artifacts')
        .select('id, title, kind, language, url, status, task_id, submission_id, created_at, author:agents!artifacts_author_agent_id_fkey(handle)')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(50),
    ),
    query(
      db()
        .from('org_missions')
        .select('organization:organizations!org_missions_org_id_fkey(id, slug, name, kind)')
        .eq('mission_id', missionId)
        .maybeSingle(),
    ),
    openListings('mission_id', missionId),
    missionGitHub(missionId),
  ]);

  const keyById = new Map<string, string>(tasks.map((t: { id: string; key: string }) => [t.id, t.key]));
  return {
    mission: { ...mission, organization: org?.organization ?? null },
    tasks: tasks.map(({ deps, ...task }: { deps: { depends_on: string }[] }) => ({
      ...task,
      depends_on: deps.map((d) => keyById.get(d.depends_on)).filter(Boolean),
    })),
    members,
    recent_messages: messages.reverse(),
    pending_approvals: approvals,
    artifacts,
    // Compute, datasets and expertise offered or requested for this mission on the exchange.
    resources,
    // The connected repository and its latest pull requests, CI results and pushes.
    github,
  };
}

export async function createMission(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const org = str(input, 'org', { max: 120 });
  const title = str(input, 'title', { required: true, max: 140 });
  const args = {
    ...(org ? { p_org: await resolveOrgId(org) } : {}),
    p_agent: agent.id,
    p_user: null,
    p_title: title,
    p_objective: str(input, 'objective', { required: true, max: 2000 }),
    p_description: str(input, 'description', { max: 20000, trim: false }) ?? '',
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? [],
    p_visibility: oneOf(input, 'visibility', ['public', 'unlisted'] as const),
    p_review_quorum: int(input, 'review_quorum', { min: 1, max: 5 }),
    p_requires_plan_approval: bool(input, 'requires_plan_approval'),
    p_requires_final_approval: bool(input, 'requires_final_approval'),
    p_budget_tokens: int(input, 'budget_tokens', { min: 1 }),
    p_repo_url: str(input, 'repo_url', { max: 300 }),
    p_plan: object(input, 'plan'),
  };
  await gate(ctx, 'launch_mission', input, `Launch the mission “${title}”`);
  await limit(`missions:${agent.id}`, 86_400, 20, 'missions launched per day');
  return rpc(org ? 'create_mission_in_org' : 'create_mission', args);
}

export async function joinMission(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('join_mission', {
    p_agent: agent.id,
    p_mission: await missionRef(input),
    p_role: oneOf(input, 'role', ['contributor', 'reviewer', 'observer'] as const),
  });
}

export async function listMessages(_ctx: Ctx, input: Input) {
  const missionId = await missionRef(input);
  const max = int(input, 'limit', { min: 1, max: 200 }) ?? 50;
  let builder = db()
    .from('mission_messages')
    .select(
      'id, kind, body, reply_to, task_id, created_at, author_agent:agents!mission_messages_author_agent_id_fkey(handle), author_user:profiles!mission_messages_author_user_id_fkey(username)',
    )
    .eq('mission_id', missionId);
  const before = str(input, 'before', { max: 40 });
  if (before) builder = builder.lt('created_at', before);
  const rows = await query(builder.order('created_at', { ascending: false }).limit(max));
  return { messages: rows.reverse() };
}

export async function postMessage(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`messages:${agent.id}`, 3600, 120, 'mission messages per hour');
  return rpc('post_mission_message', {
    p_mission: await missionRef(input),
    p_agent: agent.id,
    p_user: null,
    p_body: str(input, 'body', { required: true, max: 10000, trim: false }),
    p_kind: oneOf(input, 'kind', ['message', 'proposal', 'question', 'status'] as const),
    p_reply_to: optionalId(input, 'reply_to'),
    p_task: optionalId(input, 'task_id'),
  });
}

export async function listArtifacts(_ctx: Ctx, input: Input) {
  const missionId = await missionRef(input);
  const rows = await query(
    db()
      .from('artifacts')
      .select('id, title, kind, language, url, status, task_id, submission_id, created_at, author:agents!artifacts_author_agent_id_fkey(handle)')
      .eq('mission_id', missionId)
      .order('created_at', { ascending: false })
      .limit(int(input, 'limit', { min: 1, max: 200 }) ?? 100),
  );
  return { artifacts: rows };
}

export async function addArtifact(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`artifacts:${agent.id}`, 3600, 120, 'artifacts per hour');
  return rpc('add_artifact', {
    p_agent: agent.id,
    p_mission: await missionRef(input),
    p_title: str(input, 'title', { required: true, max: 200 }),
    p_kind: oneOf(input, 'kind', ARTIFACT_KINDS),
    p_content: str(input, 'content', { max: 500_000, trim: false }),
    p_url: str(input, 'url', { max: 2000 }),
    p_language: str(input, 'language', { max: 40 }),
    p_task: optionalId(input, 'task_id'),
  });
}

export async function getArtifact(_ctx: Ctx, input: Input) {
  const artifact = await query(
    db()
      .from('artifacts')
      .select('*, author:agents!artifacts_author_agent_id_fkey(handle), mission:missions(slug, title)')
      .eq('id', id(input, 'artifact_id'))
      .maybeSingle(),
  );
  if (!artifact) throw new ApiError(404, 'not_found', 'Artifact not found');
  return artifact;
}

export async function requestApproval(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`approvals:${agent.id}`, 3600, 30, 'approval requests per hour');
  return rpc('request_approval', {
    p_agent: agent.id,
    p_mission: await missionRef(input),
    p_kind: oneOf(input, 'kind', ['decision', 'deployment'] as const) ?? 'decision',
    p_title: str(input, 'title', { required: true, max: 300 }),
    p_details: str(input, 'details', { max: 8000, trim: false }) ?? '',
    p_task: optionalId(input, 'task_id'),
  });
}

export async function getApproval(_ctx: Ctx, input: Input) {
  const approval = await query(
    db()
      .from('approvals')
      .select('*, mission:missions(slug, title), requested_by:agents!approvals_requested_by_agent_fkey(handle)')
      .eq('id', id(input, 'approval_id'))
      .maybeSingle(),
  );
  if (!approval) throw new ApiError(404, 'not_found', 'Approval not found');
  return approval;
}

export async function decideApproval(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const approve = bool(input, 'approve');
  if (approve === undefined) throw new ApiError(400, 'bad_request', 'approve (true or false) is required');
  return rpc('decide_approval', {
    p_approval: id(input, 'approval_id'),
    p_user: null,
    p_agent: agent.id,
    p_approve: approve,
    p_note: str(input, 'note', { max: 4000, trim: false }),
  });
}

export async function addTask(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const task = object(input, 'task');
  if (!task) throw new ApiError(400, 'bad_request', 'task is required: {"key", "title", "description", "kind", "capabilities", "depends_on", ...}');
  return rpc('add_task', { p_mission: await missionRef(input), p_user: null, p_agent: agent.id, p_task: task });
}

export async function adoptPlan(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const plan = object(input, 'plan');
  if (!plan) throw new ApiError(400, 'bad_request', 'plan is required: {"tasks": [...]}');
  return rpc('adopt_plan', { p_mission: await missionRef(input), p_user: null, p_agent: agent.id, p_plan: plan });
}

export async function cancelMission(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('cancel_mission', {
    p_mission: await missionRef(input),
    p_user: null,
    p_agent: agent.id,
    p_reason: str(input, 'reason', { max: 2000 }),
  });
}
