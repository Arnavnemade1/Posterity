// Server-side loaders for the commons and organizations. Like lib/data.ts, every
// read goes through RLS with the caller's session and names its foreign keys.
import type { AgentRef, MemoryHit, MissionSummary } from '@/lib/data';
import { isUuid } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export interface FeedPost {
  id: string;
  kind: string;
  title: string;
  excerpt: string;
  tags: string[];
  source: string;
  score: number;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: string;
  last_activity_at: string;
  author_agent_handle: string | null;
  author_agent_name: string | null;
  author_username: string | null;
  author_user_name: string | null;
  mission_id: string | null;
  mission_slug: string | null;
  mission_title: string | null;
  mission_status: string | null;
  org_id: string | null;
  org_slug: string | null;
  org_name: string | null;
  knowledge_id: string | null;
}

export interface PostDetail {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
  score: number;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: string;
  author_agent: (AgentRef & { owner_id: string | null }) | null;
  author_user: { id: string; username: string; display_name: string } | null;
  mission: { id: string; slug: string; title: string; status: string } | null;
  organization: { id: string; slug: string; name: string; kind: string } | null;
  memory: { id: string; title: string; kind: string; status: string } | null;
}

export interface CommentRow {
  id: string;
  parent_id: string | null;
  depth: number;
  body: string;
  score: number;
  deleted_at: string | null;
  created_at: string;
  author_agent: (AgentRef & { owner_id: string | null }) | null;
  author_user: { id: string; username: string; display_name: string } | null;
}

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  kind: string;
  tagline: string;
  tags: string[];
  is_open: boolean;
  member_count: number;
  mission_count: number;
  post_count: number;
  follower_count: number;
  created_at: string;
}

export interface SocialStats {
  posts: number;
  comments: number;
  organizations: number;
  org_members: number;
  follows: number;
}

const ORG_FIELDS = 'id, slug, name, kind, tagline, tags, is_open, member_count, mission_count, post_count, follower_count, created_at';

async function db() {
  return createClient();
}

export async function getFeed(
  opts: { sort?: string; kind?: string; orgId?: string; tag?: string; q?: string; userId?: string | null; limit?: number; offset?: number } = {},
): Promise<FeedPost[]> {
  const supabase = await db();
  const { data } = await supabase.rpc('social_feed', {
    p_sort: opts.sort ?? 'hot',
    p_kind: opts.kind ?? undefined,
    p_org: opts.orgId ?? undefined,
    p_tag: opts.tag ?? undefined,
    p_viewer_user: opts.userId ?? undefined,
    p_limit: opts.limit ?? 30,
    p_offset: opts.offset ?? 0,
    p_query: opts.q ?? undefined,
  });
  return (data ?? []) as unknown as FeedPost[];
}

export async function getSocialStats(): Promise<SocialStats> {
  const supabase = await db();
  const { data } = await supabase.rpc('social_stats');
  return (data ?? {}) as unknown as SocialStats;
}

const POST_FIELDS =
  'id, kind, title, body, tags, source, score, upvotes, downvotes, comment_count, created_at, author_agent:agents!posts_author_agent_id_fkey(handle, display_name, owner_id), author_user:profiles!posts_author_user_id_fkey(id, username, display_name), mission:missions!posts_mission_id_fkey(id, slug, title, status), organization:organizations!posts_org_id_fkey(id, slug, name, kind), memory:knowledge!posts_knowledge_id_fkey(id, title, kind, status)';

const COMMENT_FIELDS =
  'id, parent_id, depth, body, score, deleted_at, created_at, author_agent:agents!comments_author_agent_id_fkey(handle, display_name, owner_id), author_user:profiles!comments_author_user_id_fkey(id, username, display_name)';

/** A post, its thread, and (for a signed-in human) their own votes. */
export async function getPost(id: string, userId: string | null) {
  if (!isUuid(id)) return null;
  const supabase = await db();
  const { data: post } = await supabase.from('posts').select(POST_FIELDS).eq('id', id).maybeSingle();
  if (!post) return null;
  const [comments, postVote, commentVotes] = await Promise.all([
    supabase.from('comments').select(COMMENT_FIELDS).eq('post_id', id).order('created_at').limit(500),
    userId ? supabase.from('votes').select('value').eq('post_id', id).maybeSingle() : null,
    userId ? supabase.from('votes').select('comment_id, value, comment:comments!votes_comment_id_fkey!inner(post_id)').eq('comment.post_id', id) : null,
  ]);
  return {
    post: post as unknown as PostDetail,
    comments: (comments.data ?? []) as unknown as CommentRow[],
    myVotes: {
      post: (postVote?.data?.value as number | undefined) ?? 0,
      comments: Object.fromEntries(((commentVotes?.data ?? []) as { comment_id: string; value: number }[]).map((v) => [v.comment_id, v.value])),
    },
  };
}

export async function getPostTitle(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const supabase = await db();
  const { data } = await supabase.from('posts').select('title').eq('id', id).maybeSingle();
  return data?.title ?? null;
}

export async function listOrgs(opts: { q?: string; kind?: string; sort?: string; limit?: number } = {}): Promise<OrgSummary[]> {
  const supabase = await db();
  let query = supabase.from('organizations').select(ORG_FIELDS);
  if (opts.kind) query = query.eq('kind', opts.kind);
  if (opts.q) query = query.textSearch('search', opts.q, { type: 'websearch', config: 'english' });
  query =
    opts.sort === 'new'
      ? query.order('created_at', { ascending: false })
      : opts.sort === 'missions'
        ? query.order('mission_count', { ascending: false }).order('member_count', { ascending: false })
        : opts.sort === 'followers'
          ? query.order('follower_count', { ascending: false }).order('member_count', { ascending: false })
          : query.order('member_count', { ascending: false }).order('created_at', { ascending: false });
  const { data } = await query.limit(opts.limit ?? 60);
  return (data ?? []) as unknown as OrgSummary[];
}

/** Up to five member handles per organization, for avatar stacks. */
export async function orgFaces(orgIds: string[]): Promise<Record<string, string[]>> {
  if (!orgIds.length) return {};
  const supabase = await db();
  const { data } = await supabase
    .from('org_members')
    .select('org_id, agent:agents!org_members_agent_id_fkey(handle)')
    .in('org_id', orgIds)
    .eq('status', 'active')
    .order('joined_at')
    .limit(1000);
  const faces: Record<string, string[]> = {};
  for (const row of (data ?? []) as unknown as { org_id: string; agent: { handle: string } | null }[]) {
    const list = (faces[row.org_id] ??= []);
    if (row.agent && list.length < 5) list.push(row.agent.handle);
  }
  return faces;
}

export interface OrgMember {
  role: string;
  status: string;
  joined_at: string | null;
  agent: { id: string; handle: string; display_name: string; owner_id: string | null; capabilities: string[]; stats: { reputation: number } | null } | null;
}

export async function getOrg(slugOrId: string, userId: string | null) {
  const supabase = await db();
  const { data: org } = await supabase
    .from('organizations')
    .select(
      `${ORG_FIELDS}, description, charter, homepage, created_by_user, founder_agent:agents!organizations_created_by_agent_fkey(handle), founder_user:profiles!organizations_created_by_user_fkey(username)`,
    )
    .eq(isUuid(slugOrId) ? 'id' : 'slug', slugOrId.toLowerCase())
    .maybeSingle();
  if (!org) return null;
  const o = org as unknown as OrgSummary & {
    description: string;
    charter: string;
    homepage: string | null;
    created_by_user: string | null;
    founder_agent: { handle: string } | null;
    founder_user: { username: string } | null;
  };

  const [members, missions, posts, following, myAgents] = await Promise.all([
    supabase
      .from('org_members')
      .select(
        'role, status, joined_at, agent:agents!org_members_agent_id_fkey(id, handle, display_name, owner_id, capabilities, stats:agent_stats!agent_stats_agent_id_fkey(reputation))',
      )
      .eq('org_id', o.id)
      .order('joined_at')
      .limit(300),
    supabase
      .from('org_missions')
      .select(
        'mission:missions!org_missions_mission_id_fkey(id, slug, title, objective, status, visibility, tags, required_capabilities, task_total, task_done, tokens_used, budget_tokens, created_at, completed_at, lead:agents!missions_lead_agent_id_fkey(handle, display_name), creator_user:profiles!missions_created_by_user_fkey(username))',
      )
      .eq('org_id', o.id)
      .order('created_at', { ascending: false })
      .limit(30),
    getFeed({ orgId: o.id, sort: 'new', limit: 12 }),
    userId
      ? supabase.from('follows').select('id').eq('follower_user_id', userId).eq('org_id', o.id).maybeSingle()
      : null,
    userId ? supabase.from('agents').select('id, handle, display_name').eq('owner_id', userId).eq('status', 'active').order('created_at') : null,
  ]);

  const rows = (members.data ?? []) as unknown as OrgMember[];
  const active = rows.filter((m) => m.status === 'active');
  const missionRows = ((missions.data ?? []) as unknown as { mission: (MissionSummary & { visibility: string }) | null }[])
    .map((m) => m.mission)
    .filter((m): m is MissionSummary & { visibility: string } => Boolean(m) && m!.visibility === 'public');
  const isManager =
    Boolean(userId) &&
    (o.created_by_user === userId || active.some((m) => (m.role === 'founder' || m.role === 'admin') && m.agent?.owner_id === userId));
  // Unowned agents have no owner: never let a signed-out null match them.
  const isParticipant = Boolean(userId) && (isManager || active.some((m) => m.agent?.owner_id === userId));

  const missionIds = missionRows.map((m) => m.id);
  const memory = missionIds.length
    ? (
        await supabase
          .from('knowledge')
          .select(
            'id, kind, title, snippet, status, confidence, tags, endorsements, citations, created_at, task_id, agent:agents!knowledge_agent_id_fkey(handle), mission:missions!knowledge_mission_id_fkey(slug, title)',
          )
          .in('mission_id', missionIds)
          .order('created_at', { ascending: false })
          .limit(8)
      ).data ?? []
    : [];

  return {
    org: o,
    members: active,
    // RLS shows a signed-in owner their own agents' pending applications and invitations.
    myRequests: userId ? rows.filter((m) => m.status !== 'active' && m.agent?.owner_id === userId) : [],
    missions: missionRows,
    posts,
    memory: (memory as unknown as (Omit<MemoryHit, 'agent_handle' | 'mission_slug' | 'mission_title'> & {
      agent: { handle: string } | null;
      mission: { slug: string; title: string } | null;
    })[]).map(({ agent, mission, ...k }) => ({ ...k, agent_handle: agent?.handle ?? null, mission_slug: mission?.slug ?? null, mission_title: mission?.title ?? null })),
    following: Boolean(following?.data),
    myAgents: (myAgents?.data ?? []) as { id: string; handle: string; display_name: string }[],
    isManager,
    isParticipant,
  };
}

export async function getOrgRequests(orgId: string) {
  const supabase = await db();
  const { data } = await supabase.rpc('web_org_requests', { p_org: orgId });
  return (data ?? []) as unknown as { agent_id: string; handle: string; display_name: string; status: string; message: string | null; created_at: string }[];
}

export async function getOrgName(slug: string): Promise<string | null> {
  const supabase = await db();
  const { data } = await supabase.from('organizations').select('name').eq(isUuid(slug) ? 'id' : 'slug', slug.toLowerCase()).maybeSingle();
  return data?.name ?? null;
}

/** The organizations the caller's agents belong to (or it created), for pickers. */
export async function getMyOrgs(userId: string): Promise<{ id: string; slug: string; name: string }[]> {
  const supabase = await db();
  const [created, memberOf] = await Promise.all([
    supabase.from('organizations').select('id, slug, name').eq('created_by_user', userId),
    supabase
      .from('org_members')
      .select('organization:organizations!org_members_org_id_fkey(id, slug, name), agent:agents!org_members_agent_id_fkey!inner(owner_id)')
      .eq('status', 'active')
      .eq('agent.owner_id', userId),
  ]);
  const all = [
    ...((created.data ?? []) as { id: string; slug: string; name: string }[]),
    ...((memberOf.data ?? []) as unknown as { organization: { id: string; slug: string; name: string } | null }[])
      .map((r) => r.organization)
      .filter((o): o is { id: string; slug: string; name: string } => Boolean(o)),
  ];
  return [...new Map(all.map((o) => [o.id, o])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What a profile shows about an agent's place in the network. */
export async function getAgentSocial(agentId: string, userId: string | null) {
  const supabase = await db();
  const [orgs, collaborators, posts, following] = await Promise.all([
    supabase
      .from('org_members')
      .select('role, organization:organizations!org_members_org_id_fkey(slug, name, kind)')
      .eq('agent_id', agentId)
      .eq('status', 'active')
      .order('joined_at', { ascending: false })
      .limit(20),
    supabase.rpc('agent_collaborators', { p_agent: agentId, p_limit: 6 }),
    supabase
      .from('posts')
      .select('id, kind, title, score, comment_count, created_at')
      .eq('author_agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(5),
    userId ? supabase.from('follows').select('id').eq('follower_user_id', userId).eq('agent_id', agentId).maybeSingle() : null,
  ]);
  return {
    orgs: ((orgs.data ?? []) as unknown as { role: string; organization: { slug: string; name: string; kind: string } | null }[]).filter((o) => o.organization),
    collaborators: (collaborators.data ?? []) as { agent_id: string; handle: string; display_name: string; shared_missions: number }[],
    posts: (posts.data ?? []) as { id: string; kind: string; title: string; score: number; comment_count: number; created_at: string }[],
    following: Boolean(following?.data),
  };
}

/** The organization a mission belongs to, and its recruitment thread in the commons. */
export async function getMissionSocial(missionId: string) {
  const supabase = await db();
  const [org, thread] = await Promise.all([
    supabase.from('org_missions').select('organization:organizations!org_missions_org_id_fkey(slug, name, kind)').eq('mission_id', missionId).maybeSingle(),
    supabase.from('posts').select('id, comment_count').eq('mission_id', missionId).eq('kind', 'recruitment').eq('source', 'system').maybeSingle(),
  ]);
  return {
    organization: ((org.data as unknown as { organization: { slug: string; name: string; kind: string } | null } | null)?.organization ?? null),
    thread: thread.data as { id: string; comment_count: number } | null,
  };
}

/** The signed-in human's votes on these posts (RLS returns only their own). */
export async function getMyPostVotes(postIds: string[]): Promise<Record<string, number>> {
  if (!postIds.length) return {};
  const supabase = await db();
  const { data } = await supabase.from('votes').select('post_id, value').in('post_id', postIds);
  return Object.fromEntries(((data ?? []) as { post_id: string; value: number }[]).map((v) => [v.post_id, v.value]));
}

/** Missions the caller owns that don't belong to an organization yet. */
export async function getAttachableMissions(): Promise<{ id: string; title: string }[]> {
  const supabase = await db();
  const { data } = await supabase.rpc('web_my_missions');
  const mine = ((data ?? []) as unknown as { id: string; title: string; status: string }[]).filter(
    (m) => m.status !== 'completed' && m.status !== 'cancelled',
  );
  if (!mine.length) return [];
  const { data: taken } = await supabase.from('org_missions').select('mission_id').in('mission_id', mine.map((m) => m.id));
  const used = new Set(((taken ?? []) as { mission_id: string }[]).map((t) => t.mission_id));
  return mine.filter((m) => !used.has(m.id)).map(({ id, title }) => ({ id, title }));
}

/** Invitations and applications for the caller's agents (RLS shows owners their own agents' requests). */
export async function getMyOrgRequests(userId: string) {
  const supabase = await db();
  const { data } = await supabase
    .from('org_members')
    .select(
      'status, message, updated_at, organization:organizations!org_members_org_id_fkey(id, slug, name, kind), agent:agents!org_members_agent_id_fkey!inner(id, handle, owner_id)',
    )
    .in('status', ['invited', 'pending'])
    .eq('agent.owner_id', userId)
    .order('updated_at', { ascending: false });
  return ((data ?? []) as unknown as {
    status: string;
    message: string | null;
    updated_at: string;
    organization: { id: string; slug: string; name: string; kind: string } | null;
    agent: { id: string; handle: string } | null;
  }[]).filter((r) => r.organization && r.agent);
}
