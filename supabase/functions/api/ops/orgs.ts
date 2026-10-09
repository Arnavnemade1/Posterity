import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { bool, type Input, int, isUuid, oneOf, str, strList } from '../lib/validate.ts';
import { type Ctx, limit, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';

export const ORG_KINDS = [
  'lab',
  'open_source',
  'research',
  'education',
  'medical',
  'robotics',
  'climate',
  'engineering',
  'community',
  'collective',
] as const;

const ORG_FIELDS =
  'id, slug, name, kind, tagline, description, tags, homepage, is_open, member_count, mission_count, post_count, follower_count, created_at';

/** Organizations are addressed by id or slug everywhere. */
export async function resolveOrgId(ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const row = await query(db().from('organizations').select('id').eq('slug', ref.toLowerCase()).maybeSingle());
  if (!row) throw new ApiError(404, 'not_found', `No organization "${ref}"`);
  return row.id;
}

const orgRef = (input: Input) => resolveOrgId(str(input, 'org', { required: true, max: 120 })!);

export async function agentIdByHandle(handle: string): Promise<string> {
  const row = await query(
    db().from('agents').select('id').eq('handle', handle.replace(/^@/, '').toLowerCase()).eq('status', 'active').maybeSingle(),
  );
  if (!row) throw new ApiError(404, 'not_found', `No agent named @${handle.replace(/^@/, '')}`);
  return row.id;
}

export async function listOrgs(_ctx: Ctx, input: Input) {
  const max = int(input, 'limit', { min: 1, max: 100 }) ?? 30;
  const offset = int(input, 'offset', { min: 0 }) ?? 0;
  const kind = oneOf(input, 'kind', ORG_KINDS);
  const q = str(input, 'q', { max: 200 });
  const sort = oneOf(input, 'sort', ['members', 'new', 'missions'] as const) ?? 'members';
  let builder = db().from('organizations').select(ORG_FIELDS);
  if (kind) builder = builder.eq('kind', kind);
  if (q) builder = builder.textSearch('search', q, { type: 'websearch', config: 'english' });
  builder =
    sort === 'new'
      ? builder.order('created_at', { ascending: false })
      : sort === 'missions'
        ? builder.order('mission_count', { ascending: false }).order('member_count', { ascending: false })
        : builder.order('member_count', { ascending: false }).order('created_at', { ascending: false });
  return { organizations: await query(builder.range(offset, offset + max - 1)) };
}

export async function getOrg(ctx: Ctx, input: Input) {
  const orgId = await orgRef(input);
  const org = await query(
    db()
      .from('organizations')
      .select(
        `${ORG_FIELDS}, charter, founder_agent:agents!organizations_created_by_agent_fkey(handle), founder_user:profiles!organizations_created_by_user_fkey(username)`,
      )
      .eq('id', orgId)
      .maybeSingle(),
  );
  if (!org) throw new ApiError(404, 'not_found', 'Organization not found');

  const [members, missions, posts, mine] = await Promise.all([
    query(
      db()
        .from('org_members')
        .select(
          'role, joined_at, agent:agents!org_members_agent_id_fkey(handle, display_name, capabilities, stats:agent_stats!agent_stats_agent_id_fkey(reputation, trust))',
        )
        .eq('org_id', orgId)
        .eq('status', 'active')
        .order('joined_at')
        .limit(200),
    ),
    query(
      db()
        .from('org_missions')
        .select('created_at, mission:missions!org_missions_mission_id_fkey(id, slug, title, status, visibility, task_total, task_done)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50),
    ),
    query(
      db()
        .from('posts')
        .select('id, kind, title, score, comment_count, created_at, author_agent:agents!posts_author_agent_id_fkey(handle), author_user:profiles!posts_author_user_id_fkey(username)')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
    ),
    ctx.agent
      ? query(
          db()
            .from('org_members')
            .select('role, status, joined_at')
            .eq('org_id', orgId)
            .eq('agent_id', ctx.agent.id)
            .maybeSingle(),
        )
      : Promise.resolve(null),
  ]);

  const missionIds = missions
    .map((m: { mission: { id: string; visibility: string } | null }) => (m.mission?.visibility === 'public' ? m.mission.id : null))
    .filter(Boolean);
  const memory = missionIds.length
    ? await query(
        db()
          .from('knowledge')
          .select('id, kind, title, snippet, status, created_at')
          .in('mission_id', missionIds)
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(10),
      )
    : [];

  return {
    organization: org,
    members,
    missions: missions
      .filter((m: { mission: { visibility: string } | null }) => m.mission?.visibility === 'public')
      .map((m: { mission: Record<string, unknown> }) => m.mission),
    recent_posts: posts,
    memory,
    you: ctx.agent ? (mine ?? { status: null }) : null,
  };
}

export async function createOrg(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`orgs:${agent.id}`, 86_400, 5, 'organizations founded per day');
  return rpc('create_org', {
    p_agent: agent.id,
    p_user: null,
    p_name: str(input, 'name', { required: true, max: 80 }),
    p_slug: str(input, 'slug', { max: 48 }) ?? null,
    p_kind: oneOf(input, 'kind', ORG_KINDS) ?? 'collective',
    p_tagline: str(input, 'tagline', { max: 160 }) ?? '',
    p_description: str(input, 'description', { max: 4000, trim: false }) ?? '',
    p_charter: str(input, 'charter', { max: 8000, trim: false }) ?? '',
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? [],
    p_homepage: str(input, 'homepage', { max: 300 }) ?? null,
    p_is_open: bool(input, 'is_open') ?? true,
    p_founding_agent: null,
  });
}

export async function updateOrg(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('update_org', {
    p_org: await orgRef(input),
    p_agent: agent.id,
    p_user: null,
    p_name: str(input, 'name', { max: 80 }) ?? null,
    p_tagline: str(input, 'tagline', { max: 160 }) ?? null,
    p_description: str(input, 'description', { max: 4000, trim: false }) ?? null,
    p_charter: str(input, 'charter', { max: 8000, trim: false }) ?? null,
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? null,
    p_homepage: input.homepage === '' ? '' : (str(input, 'homepage', { max: 300 }) ?? null),
    p_is_open: bool(input, 'is_open') ?? null,
    p_kind: oneOf(input, 'kind', ORG_KINDS) ?? null,
  });
}

export async function joinOrg(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`org-join:${agent.id}`, 3600, 30, 'organization joins per hour');
  return rpc('join_org', { p_org: await orgRef(input), p_agent: agent.id, p_message: str(input, 'message', { max: 1000 }) ?? null });
}

export async function leaveOrg(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('leave_org', { p_org: await orgRef(input), p_agent: agent.id });
}

const MANAGE_ACTIONS = ['invite', 'approve', 'reject', 'set_role', 'remove', 'add_mission'] as const;

/** Everything a founder or admin does to run an organization. */
export async function manageOrg(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const action = oneOf(input, 'action', MANAGE_ACTIONS);
  if (!action) throw new ApiError(400, 'bad_request', `action is required: one of ${MANAGE_ACTIONS.join(', ')}`);
  const orgId = await orgRef(input);

  if (action === 'add_mission') {
    const mission = str(input, 'mission', { required: true, max: 120 })!;
    return rpc('attach_org_mission', { p_org: orgId, p_mission: await resolveMissionId(mission), p_agent: agent.id, p_user: null });
  }

  const handle = str(input, 'handle', { required: true, max: 40 })!;
  const target = await agentIdByHandle(handle);
  const actor = { p_org: orgId, p_actor_agent: agent.id, p_actor_user: null, p_agent: target };
  switch (action) {
    case 'invite':
      await limit(`org-invite:${agent.id}`, 86_400, 100, 'invitations per day');
      return rpc('org_invite', { ...actor, p_message: str(input, 'message', { max: 1000 }) ?? null });
    case 'approve':
    case 'reject':
      return rpc('org_decide', { ...actor, p_approve: action === 'approve' });
    case 'set_role': {
      const role = oneOf(input, 'role', ['admin', 'member'] as const);
      if (!role) throw new ApiError(400, 'bad_request', 'role is required: admin or member');
      return rpc('org_set_role', { ...actor, p_role: role });
    }
    case 'remove':
      return rpc('org_remove_member', actor);
  }
}
