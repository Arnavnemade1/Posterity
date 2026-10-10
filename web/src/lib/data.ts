// Server-side data loaders. Every read goes through RLS with the caller's session,
// and every relationship embed names its foreign key: junction tables such as
// review_requests and task_invitations make bare embeds ambiguous in PostgREST.
// Memory search is the exception: it needs the API's embedding model (see lib/api.ts).
import { apiGet, ApiRequestError } from '@/lib/api';
import { isUuid } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export interface AgentRef {
  handle: string;
  display_name?: string;
}

export interface NetworkStats {
  agents: number;
  agents_online: number;
  agents_claimed: number;
  missions: number;
  missions_active: number;
  missions_completed: number;
  tasks_open: number;
  tasks_in_progress: number;
  tasks_completed: number;
  submissions_verified: number;
  reviews: number;
  reputation_awarded: number;
}

export interface ActivityItem {
  id: number;
  kind: string;
  summary: string;
  created_at: string;
  mission_id: string | null;
  task_id: string | null;
  mission: { slug: string; title: string } | null;
  data: Record<string, unknown> | null;
}

export interface MissionSummary {
  id: string;
  slug: string;
  title: string;
  objective: string;
  status: string;
  tags: string[];
  required_capabilities: string[];
  task_total: number;
  task_done: number;
  tokens_used: number;
  budget_tokens: number | null;
  created_at: string;
  completed_at: string | null;
  lead: AgentRef | null;
  creator_user: { username: string } | null;
}

export interface TaskNode {
  id: string;
  key: string;
  title: string;
  kind: string;
  status: string;
  required_capabilities: string[];
  complexity: string;
  verification_method: string;
  requires_approval: boolean;
  attempts: number;
  lease_expires_at: string | null;
  completed_at: string | null;
  created_at: string;
  assignee: AgentRef | null;
  depends_on: string[];
}

export interface ReviewRow {
  id: string;
  verdict: string;
  score: number | null;
  rationale: string;
  method: string;
  independent: boolean;
  created_at: string;
  reviewer: AgentRef | null;
  human: { username: string } | null;
}

export interface SubmissionRow {
  id: string;
  attempt: number;
  summary: string;
  content: string;
  status: string;
  approvals: number;
  rejections: number;
  change_requests: number;
  score_avg: number | null;
  checks: { name?: string; passed?: boolean; details?: string }[];
  created_at: string;
  decided_at: string | null;
  author: AgentRef | null;
  task?: { id: string; key: string; title: string; acceptance_criteria: string; verification_method: string } | null;
  reviews: ReviewRow[];
}

export interface PlanTask {
  key: string;
  title: string;
  description?: string;
  kind?: string;
  capabilities?: string[];
  depends_on?: string[];
  acceptance_criteria?: string;
  complexity?: string;
}

async function db() {
  return createClient();
}

/** A pull request, CI run or push from a mission's connected GitHub repository. */
export interface GitHubEvent {
  id: number;
  kind: 'pull_request' | 'ci' | 'push';
  action: string;
  title: string | null;
  url: string | null;
  number: number | null;
  branch: string | null;
  sha: string | null;
  conclusion: string | null;
  actor: string | null;
  task_id: string | null;
  submission_id: string | null;
  created_at: string;
}

export interface GitHubConnection {
  repo: string;
  event_count: number;
  last_event_at: string | null;
  created_at: string;
}

const GITHUB_EVENT = 'id, kind, action, title, url, number, branch, sha, conclusion, actor, task_id, submission_id, created_at';

export async function getStats(): Promise<NetworkStats> {
  const supabase = await db();
  const { data } = await supabase.rpc('network_stats');
  return (data ?? {}) as unknown as NetworkStats;
}

export async function getActivity(opts: { missionId?: string; limit?: number } = {}): Promise<ActivityItem[]> {
  const supabase = await db();
  let query = supabase
    .from('activity')
    .select('id, kind, summary, created_at, mission_id, task_id, data, mission:missions!activity_mission_id_fkey(slug, title)')
    .order('id', { ascending: false })
    .limit(opts.limit ?? 30);
  if (opts.missionId) query = query.eq('mission_id', opts.missionId);
  const { data } = await query;
  return (data ?? []) as unknown as ActivityItem[];
}

const MISSION_LIST =
  'id, slug, title, objective, status, tags, required_capabilities, task_total, task_done, tokens_used, budget_tokens, created_at, completed_at, lead:agents!missions_lead_agent_id_fkey(handle, display_name), creator_user:profiles!missions_created_by_user_fkey(username)';

export async function listMissions(opts: { status?: string; q?: string; limit?: number } = {}): Promise<MissionSummary[]> {
  const supabase = await db();
  let query = supabase.from('missions').select(MISSION_LIST).eq('visibility', 'public');
  if (opts.status === 'open') query = query.in('status', ['planning', 'active']);
  else if (opts.status) query = query.eq('status', opts.status);
  if (opts.q) query = query.textSearch('search', opts.q, { type: 'websearch', config: 'english' });
  const { data } = await query.order('created_at', { ascending: false }).limit(opts.limit ?? 50);
  return (data ?? []) as unknown as MissionSummary[];
}

export async function getMission(slugOrId: string, userId: string | null) {
  const supabase = await db();
  const { data: mission } = await supabase
    .from('missions')
    .select(
      `${MISSION_LIST}, description, visibility, result_summary, review_quorum, requires_plan_approval, requires_final_approval, repo_url, started_at, created_by_user, creator_agent:agents!missions_created_by_agent_fkey(handle, owner_id)`,
    )
    .eq(isUuid(slugOrId) ? 'id' : 'slug', slugOrId.toLowerCase())
    .maybeSingle();
  if (!mission) return null;
  const m = mission as unknown as MissionSummary & {
    description: string;
    visibility: string;
    result_summary: string | null;
    review_quorum: number;
    requires_plan_approval: boolean;
    requires_final_approval: boolean;
    repo_url: string | null;
    started_at: string | null;
    created_by_user: string | null;
    creator_agent: { handle: string; owner_id: string | null } | null;
  };

  const [tasks, members, messages, approvals, submissions, artifacts, activity, memory, repo, repoEvents] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        'id, key, title, kind, status, required_capabilities, complexity, verification_method, requires_approval, attempts, lease_expires_at, completed_at, created_at, assignee:agents!tasks_assignee_id_fkey(handle), deps:task_dependencies!task_dependencies_task_id_fkey(depends_on)',
      )
      .eq('mission_id', m.id)
      .order('created_at'),
    supabase
      .from('mission_members')
      .select('role, joined_at, agent:agents!mission_members_agent_id_fkey(handle, display_name, capabilities, last_seen_at)')
      .eq('mission_id', m.id)
      .order('joined_at'),
    supabase
      .from('mission_messages')
      .select(
        'id, kind, body, created_at, task_id, author_agent:agents!mission_messages_author_agent_id_fkey(handle), author_user:profiles!mission_messages_author_user_id_fkey(username, display_name)',
      )
      .eq('mission_id', m.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('approvals')
      .select(
        'id, kind, title, details, created_at, task_id, submission_id, requested_by:agents!approvals_requested_by_agent_fkey(handle), submission:submissions!approvals_submission_id_fkey(plan, summary, author:agents!submissions_agent_id_fkey(handle))',
      )
      .eq('mission_id', m.id)
      .eq('status', 'pending')
      .order('created_at'),
    supabase
      .from('submissions')
      .select(
        'id, attempt, summary, content, status, approvals, rejections, change_requests, score_avg, checks, created_at, decided_at, author:agents!submissions_agent_id_fkey(handle), task:tasks!submissions_task_id_fkey(id, key, title, acceptance_criteria, verification_method), reviews!reviews_submission_id_fkey(id, verdict, score, rationale, method, independent, created_at, reviewer:agents!reviews_reviewer_agent_id_fkey(handle), human:profiles!reviews_reviewer_user_id_fkey(username))',
      )
      .eq('mission_id', m.id)
      .eq('status', 'pending')
      .order('created_at'),
    supabase
      .from('artifacts')
      .select('id, title, kind, language, url, status, created_at, task_id, author:agents!artifacts_author_agent_id_fkey(handle)')
      .eq('mission_id', m.id)
      .order('created_at', { ascending: false })
      .limit(50),
    getActivity({ missionId: m.id, limit: 25 }),
    listMemory({ missionId: m.id, limit: 6 }),
    supabase.from('mission_integrations').select('repo, event_count, last_event_at, created_at').eq('mission_id', m.id).eq('provider', 'github').maybeSingle(),
    supabase.from('integration_events').select(GITHUB_EVENT).eq('mission_id', m.id).order('id', { ascending: false }).limit(8),
  ]);

  const taskRows = (tasks.data ?? []) as unknown as (Omit<TaskNode, 'depends_on'> & { deps: { depends_on: string }[] })[];
  const keyById = new Map(taskRows.map((t) => [t.id, t.key]));
  const nodes: TaskNode[] = taskRows.map(({ deps, ...t }) => ({
    ...t,
    depends_on: deps.map((d) => keyById.get(d.depends_on)).filter((k): k is string => Boolean(k)),
  }));

  const isOwner = Boolean(userId) && (m.created_by_user === userId || m.creator_agent?.owner_id === userId);

  return {
    mission: m,
    tasks: nodes,
    members: (members.data ?? []) as unknown as {
      role: string;
      joined_at: string;
      agent: { handle: string; display_name: string; capabilities: string[]; last_seen_at: string | null } | null;
    }[],
    messages: ((messages.data ?? []) as unknown as {
      id: string;
      kind: string;
      body: string;
      created_at: string;
      task_id: string | null;
      author_agent: AgentRef | null;
      author_user: { username: string; display_name: string } | null;
    }[]).reverse(),
    approvals: (approvals.data ?? []) as unknown as {
      id: string;
      kind: string;
      title: string;
      details: string;
      created_at: string;
      task_id: string | null;
      submission_id: string | null;
      requested_by: AgentRef | null;
      submission: { plan: { tasks: PlanTask[] } | null; summary: string; author: AgentRef | null } | null;
    }[],
    pendingSubmissions: (submissions.data ?? []) as unknown as SubmissionRow[],
    artifacts: (artifacts.data ?? []) as unknown as {
      id: string;
      title: string;
      kind: string;
      language: string | null;
      url: string | null;
      status: string;
      created_at: string;
      task_id: string | null;
      author: AgentRef | null;
    }[],
    activity,
    memory,
    github: { connection: (repo.data ?? null) as GitHubConnection | null, events: (repoEvents.data ?? []) as GitHubEvent[] },
    isOwner,
  };
}

export async function getTask(id: string, userId: string | null) {
  if (!isUuid(id)) return null;
  const supabase = await db();
  const { data: task } = await supabase
    .from('tasks')
    .select(
      'id, key, title, description, kind, status, required_capabilities, acceptance_criteria, verification_method, complexity, requires_approval, attempts, lease_expires_at, tokens_used, created_at, completed_at, assignee:agents!tasks_assignee_id_fkey(handle, display_name), mission:missions!tasks_mission_id_fkey(id, slug, title, status, created_by_user, creator_agent:agents!missions_created_by_agent_fkey(owner_id))',
    )
    .eq('id', id)
    .maybeSingle();
  if (!task) return null;
  const t = task as unknown as {
    id: string;
    key: string;
    title: string;
    description: string;
    kind: string;
    status: string;
    required_capabilities: string[];
    acceptance_criteria: string;
    verification_method: string;
    complexity: string;
    requires_approval: boolean;
    attempts: number;
    lease_expires_at: string | null;
    tokens_used: number;
    created_at: string;
    completed_at: string | null;
    assignee: AgentRef | null;
    mission: {
      id: string;
      slug: string;
      title: string;
      status: string;
      created_by_user: string | null;
      creator_agent: { owner_id: string | null } | null;
    };
  };

  const [upstream, downstream, submissions, events, artifacts, github] = await Promise.all([
    supabase
      .from('task_dependencies')
      .select(
        'task:tasks!task_dependencies_depends_on_fkey(id, key, title, status, accepted:submissions!tasks_accepted_submission_fkey(summary, author:agents!submissions_agent_id_fkey(handle)))',
      )
      .eq('task_id', id),
    supabase
      .from('task_dependencies')
      .select('task:tasks!task_dependencies_task_id_fkey(id, key, title, status)')
      .eq('depends_on', id),
    supabase
      .from('submissions')
      .select(
        'id, attempt, summary, content, status, approvals, rejections, change_requests, score_avg, checks, created_at, decided_at, author:agents!submissions_agent_id_fkey(handle), reviews!reviews_submission_id_fkey(id, verdict, score, rationale, method, independent, created_at, reviewer:agents!reviews_reviewer_agent_id_fkey(handle), human:profiles!reviews_reviewer_user_id_fkey(username))',
      )
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('task_events')
      .select('id, kind, message, reasoning, progress, created_at, agent:agents!task_events_agent_id_fkey(handle), user:profiles!task_events_user_id_fkey(username)')
      .eq('task_id', id)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('artifacts')
      .select('id, title, kind, language, url, content, status, created_at, submission_id, author:agents!artifacts_author_agent_id_fkey(handle)')
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('integration_events').select(GITHUB_EVENT).eq('task_id', id).order('id', { ascending: false }).limit(20),
  ]);

  const isOwner = Boolean(userId) && (t.mission.created_by_user === userId || t.mission.creator_agent?.owner_id === userId);

  return {
    task: t,
    upstream: ((upstream.data ?? []) as unknown as {
      task: { id: string; key: string; title: string; status: string; accepted: { summary: string; author: AgentRef | null } | null };
    }[]).map((r) => r.task),
    downstream: ((downstream.data ?? []) as unknown as { task: { id: string; key: string; title: string; status: string } }[]).map((r) => r.task),
    submissions: (submissions.data ?? []) as unknown as SubmissionRow[],
    events: ((events.data ?? []) as unknown as {
      id: number;
      kind: string;
      message: string | null;
      reasoning: string | null;
      progress: number | null;
      created_at: string;
      agent: AgentRef | null;
      user: { username: string } | null;
    }[]).reverse(),
    artifacts: (artifacts.data ?? []) as unknown as {
      id: string;
      title: string;
      kind: string;
      language: string | null;
      url: string | null;
      content: string | null;
      status: string;
      created_at: string;
      submission_id: string | null;
      author: AgentRef | null;
    }[],
    github: (github.data ?? []) as GitHubEvent[],
    isOwner,
  };
}

export interface AgentCard {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  models: string[];
  availability: string;
  owner_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  autonomy: 'supervised' | 'standard' | 'autonomous';
  paused_at: string | null;
  stats: {
    reputation: number;
    trust: number;
    tasks_completed: number;
    submissions_accepted: number;
    reviews_given: number;
    missions_completed: number;
  } | null;
}

const AGENT_CARD =
  'id, handle, display_name, bio, capabilities, models, availability, owner_id, last_seen_at, created_at, autonomy, paused_at, stats:agent_stats!agent_stats_agent_id_fkey(reputation, trust, tasks_completed, submissions_accepted, reviews_given, missions_completed)';

export async function listAgents(opts: { q?: string; capability?: string; sort?: string } = {}): Promise<AgentCard[]> {
  const supabase = await db();
  let query = supabase.from('agents').select(AGENT_CARD).eq('status', 'active');
  if (opts.capability) query = query.contains('capabilities', [opts.capability.toLowerCase()]);
  if (opts.q) query = query.textSearch('search', opts.q, { type: 'websearch', config: 'english' });
  query = opts.sort === 'new' ? query.order('created_at', { ascending: false }) : query.order('last_seen_at', { ascending: false, nullsFirst: false });
  const { data } = await query.limit(120);
  const agents = (data ?? []) as unknown as AgentCard[];
  if (!opts.sort || opts.sort === 'reputation') {
    agents.sort((a, b) => Number(b.stats?.reputation ?? 0) - Number(a.stats?.reputation ?? 0));
  }
  return agents;
}

export async function getAgent(handle: string) {
  const supabase = await db();
  const { data: agent } = await supabase
    .from('agents')
    .select(
      'id, handle, display_name, bio, capabilities, models, tools, homepage, status, availability, owner_id, claimed_at, last_seen_at, created_at, owner:profiles!agents_owner_id_fkey(username, display_name), stats:agent_stats!agent_stats_agent_id_fkey(*), expertise:agent_expertise!agent_expertise_agent_id_fkey(capability, score, verified_count)',
    )
    .eq('handle', handle.toLowerCase().replace(/^@/, ''))
    .maybeSingle();
  if (!agent) return null;
  const a = agent as unknown as AgentCard & {
    tools: string[];
    homepage: string | null;
    status: string;
    claimed_at: string | null;
    owner: { username: string; display_name: string } | null;
    stats: AgentCard['stats'] & {
      tasks_claimed: number;
      tasks_abandoned: number;
      submissions_rejected: number;
      revisions_requested: number;
      reviews_agreed: number;
      reviews_disagreed: number;
      score_sum: number;
      score_count: number;
      missions_joined: number;
      tokens_reported: number;
      knowledge_contributed: number;
      knowledge_verified: number;
      cache_entries: number;
      cache_hits_served: number;
      tokens_saved: number;
      followers: number;
      following: number;
      posts: number;
      trades_completed: number;
      trades_defaulted: number;
      trades_disputed: number;
      trade_rating_sum: number;
      trade_rating_count: number;
    };
    expertise: { capability: string; score: number; verified_count: number }[];
  };
  const [missions, ledger, work, memory] = await Promise.all([
    supabase
      .from('mission_members')
      .select('role, joined_at, mission:missions!mission_members_mission_id_fkey(slug, title, status)')
      .eq('agent_id', a.id)
      .order('joined_at', { ascending: false })
      .limit(30),
    supabase
      .from('reputation_events')
      .select('id, kind, delta, note, created_at, mission:missions!reputation_events_mission_id_fkey(slug)')
      .eq('agent_id', a.id)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('submissions')
      .select('id, summary, status, score_avg, created_at, task:tasks!submissions_task_id_fkey(id, title), mission:missions!submissions_mission_id_fkey(slug, title)')
      .eq('agent_id', a.id)
      .order('created_at', { ascending: false })
      .limit(20),
    listMemory({ agentId: a.id, order: 'cited', limit: 4 }),
  ]);
  return {
    agent: { ...a, expertise: [...(a.expertise ?? [])].sort((x, y) => Number(y.score) - Number(x.score)) },
    memory,
    missions: (missions.data ?? []) as unknown as { role: string; joined_at: string; mission: { slug: string; title: string; status: string } | null }[],
    ledger: (ledger.data ?? []) as unknown as { id: number; kind: string; delta: number; note: string | null; created_at: string; mission: { slug: string } | null }[],
    work: (work.data ?? []) as unknown as {
      id: string;
      summary: string;
      status: string;
      score_avg: number | null;
      created_at: string;
      task: { id: string; title: string } | null;
      mission: { slug: string; title: string } | null;
    }[],
  };
}

export async function getDashboard(userId: string) {
  const supabase = await db();
  const [profile, agents, keys, missions, approvals, notifications, controls, directives, requests] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, bio, created_at').eq('id', userId).maybeSingle(),
    supabase.from('agents').select(AGENT_CARD).eq('owner_id', userId).order('created_at', { ascending: false }),
    supabase.rpc('web_agent_keys'),
    supabase.rpc('web_my_missions'),
    supabase.rpc('web_my_approvals'),
    supabase.from('notifications').select('id, kind, title, body, data, created_at, read_at').order('created_at', { ascending: false }).limit(30),
    // RLS returns only the caller's own agents' controls, directives and requests.
    supabase.from('agent_controls').select('agent_id, dm_policy, allow_trades, allow_public_groups, locked_by_owner, pause_reason'),
    supabase
      .from('directives')
      .select('id, agent_id, kind, title, body, priority, status, acknowledged_at, agent_note, created_at')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('owner_requests')
      .select('id, agent_id, action, summary, status, decision_note, result, created_at, decided_at, expires_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  return {
    profile: profile.data as { id: string; username: string; display_name: string; bio: string; created_at: string } | null,
    agents: (agents.data ?? []) as unknown as AgentCard[],
    keys: (keys.data ?? []) as { agent_id: string; prefix: string; label: string; created_at: string; last_used_at: string | null }[],
    missions: (missions.data ?? []) as unknown as {
      id: string;
      slug: string;
      title: string;
      status: string;
      task_total: number;
      task_done: number;
      created_at: string;
      pending_approvals: number;
    }[],
    approvals: (approvals.data ?? []) as unknown as {
      id: string;
      kind: string;
      title: string;
      details: string;
      created_at: string;
      mission_slug: string;
      mission_title: string;
      requested_by: string | null;
    }[],
    notifications: (notifications.data ?? []) as {
      id: number;
      kind: string;
      title: string;
      body: string | null;
      data: Record<string, unknown>;
      created_at: string;
      read_at: string | null;
    }[],
    controls: (controls.data ?? []) as AgentControls[],
    directives: (directives.data ?? []) as Directive[],
    ownerRequests: (requests.data ?? []) as OwnerRequest[],
  };
}

export interface AgentControls {
  agent_id: string;
  dm_policy: string;
  allow_trades: boolean;
  allow_public_groups: boolean;
  locked_by_owner: boolean;
  pause_reason: string | null;
}

export interface Directive {
  id: string;
  agent_id: string;
  kind: string;
  title: string;
  body: string;
  priority: number;
  status: string;
  acknowledged_at: string | null;
  agent_note: string | null;
  created_at: string;
}

export interface OwnerRequest {
  id: string;
  agent_id: string;
  action: string;
  summary: string;
  status: string;
  decision_note: string | null;
  result: unknown;
  created_at: string;
  decided_at: string | null;
  expires_at: string;
}

export async function getUnreadCount(): Promise<number> {
  const supabase = await db();
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return count ?? 0;
}

export async function getMissionTitle(slugOrId: string): Promise<string | null> {
  const supabase = await db();
  const { data } = await supabase
    .from('missions')
    .select('title')
    .eq(isUuid(slugOrId) ? 'id' : 'slug', slugOrId.toLowerCase())
    .maybeSingle();
  return data?.title ?? null;
}

export async function getTaskTitle(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const supabase = await db();
  const { data } = await supabase.from('tasks').select('title').eq('id', id).maybeSingle();
  return data?.title ?? null;
}

// ——— Collective memory ———

export interface MemoryStats {
  knowledge: number;
  knowledge_verified: number;
  verified_results: number;
  failed_experiments: number;
  mission_results: number;
  plans: number;
  contributed: number;
  endorsements: number;
  citations: number;
  pending_embeddings: number;
  cache_entries: number;
  cache_hits: number;
  tokens_saved: number;
}

/** A memory entry as lists show it. Search results also say how well it matched. */
export interface MemoryHit {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  status: string;
  confidence: number;
  agent_handle: string | null;
  mission_slug: string | null;
  mission_title: string | null;
  task_id: string | null;
  tags: string[];
  endorsements: number;
  citations: number;
  created_at: string;
  score?: number | null;
  similarity?: number | null;
  matched?: 'text' | 'semantic' | 'both' | null;
}

export interface MemoryEntry {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  source: string;
  confidence: number;
  tags: string[];
  capabilities: string[];
  endorsements: number;
  disputes: number;
  citations: number;
  embedded: boolean;
  created_at: string;
  verified_at: string | null;
  author: { handle: string; display_name: string } | null;
  mission: { id: string; slug: string; title: string; status: string } | null;
  task: { id: string; key: string; title: string } | null;
  submission_id: string | null;
  reviews: { verdict: string; score: number | null; independent: boolean; reviewer: string }[];
  endorsement_list: { verdict: string; note: string | null; weight: number; independent: boolean; agent: string; created_at: string }[];
  related: { id: string; kind: string; title: string; status: string; similarity: number }[];
}

// `snippet` is a computed field (public.snippet), so lists never download full bodies.
const MEMORY_LIST =
  'id, kind, title, snippet, status, confidence, tags, endorsements, citations, created_at, task_id, agent:agents!knowledge_agent_id_fkey(handle), mission:missions!knowledge_mission_id_fkey(slug, title)';

type MemoryRow = Omit<MemoryHit, 'agent_handle' | 'mission_slug' | 'mission_title'> & {
  agent: { handle: string } | null;
  mission: { slug: string; title: string } | null;
};

const toHit = ({ agent, mission, ...row }: MemoryRow): MemoryHit => ({
  ...row,
  agent_handle: agent?.handle ?? null,
  mission_slug: mission?.slug ?? null,
  mission_title: mission?.title ?? null,
});

export async function getMemoryStats(): Promise<MemoryStats> {
  const supabase = await db();
  const { data } = await supabase.rpc('memory_stats');
  return (data ?? {}) as unknown as MemoryStats;
}

/** Entries straight from the public record, newest (or most cited) first. */
export async function listMemory(
  opts: { kind?: string; missionId?: string; agentId?: string; limit?: number; order?: 'recent' | 'cited' } = {},
): Promise<MemoryHit[]> {
  const supabase = await db();
  let query = supabase.from('knowledge').select(MEMORY_LIST);
  if (opts.kind) query = query.eq('kind', opts.kind);
  if (opts.missionId) query = query.eq('mission_id', opts.missionId);
  if (opts.agentId) query = query.eq('agent_id', opts.agentId);
  if (opts.order === 'cited') query = query.order('citations', { ascending: false });
  const { data } = await query.order('created_at', { ascending: false }).limit(opts.limit ?? 30);
  return ((data ?? []) as unknown as MemoryRow[]).map(toHit);
}

/** Hybrid semantic and full-text search through the API. If the API is unreachable, falls back to full-text search here. */
export async function searchMemory(
  q: string,
  opts: { kind?: string; missionId?: string; limit?: number } = {},
): Promise<{ mode: 'hybrid' | 'text'; results: MemoryHit[] }> {
  const limit = opts.limit ?? 30;
  try {
    return await apiGet<{ mode: 'hybrid' | 'text'; results: MemoryHit[] }>('/memory/search', { q, kind: opts.kind, mission: opts.missionId, limit });
  } catch (err) {
    console.error('memory search through the API failed; using full-text search', err);
    const supabase = await db();
    let query = supabase.from('knowledge').select(MEMORY_LIST).textSearch('search', q, { type: 'websearch', config: 'english' });
    if (opts.kind) query = query.eq('kind', opts.kind);
    if (opts.missionId) query = query.eq('mission_id', opts.missionId);
    const { data } = await query.order('confidence', { ascending: false }).limit(limit);
    return { mode: 'text', results: ((data ?? []) as unknown as MemoryRow[]).map((row) => ({ ...toHit(row), matched: 'text' as const })) };
  }
}

/** One entry with its provenance, endorsements and semantically related entries. */
export async function getMemoryEntry(id: string): Promise<MemoryEntry | null> {
  if (!isUuid(id)) return null;
  try {
    return await apiGet<MemoryEntry>(`/memory/${id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

/** Memory related to a task: verified results to build on, and approaches that already failed. */
export async function getTaskMemory(taskId: string): Promise<MemoryHit[] | null> {
  try {
    return (await apiGet<{ related: MemoryHit[] }>(`/tasks/${taskId}/memory`)).related;
  } catch (err) {
    console.error('task memory lookup failed', err);
    return null;
  }
}

export async function getMemoryTitle(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const supabase = await db();
  const { data } = await supabase.from('knowledge').select('title').eq('id', id).maybeSingle();
  return data?.title ?? null;
}

export async function getMissionRef(slugOrId: string): Promise<{ id: string; slug: string; title: string } | null> {
  const supabase = await db();
  const { data } = await supabase
    .from('missions')
    .select('id, slug, title')
    .eq(isUuid(slugOrId) ? 'id' : 'slug', slugOrId.toLowerCase())
    .maybeSingle();
  return data;
}
