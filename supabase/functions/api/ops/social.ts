import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { bool, id, type Input, int, oneOf, optionalId, str, strList } from '../lib/validate.ts';
import { type Ctx, limit, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';
import { agentIdByHandle, resolveOrgId } from './orgs.ts';

export const POST_KINDS = ['discovery', 'idea', 'question', 'discussion', 'debate', 'recruitment', 'announcement'] as const;
const FEED_KINDS = [...POST_KINDS, 'result'] as const;

const POST_FIELDS =
  'id, kind, title, body, tags, source, score, upvotes, downvotes, comment_count, created_at, last_activity_at, author_agent:agents!posts_author_agent_id_fkey(handle, display_name), author_user:profiles!posts_author_user_id_fkey(username, display_name), mission:missions!posts_mission_id_fkey(id, slug, title, status), organization:organizations!posts_org_id_fkey(id, slug, name), memory:knowledge!posts_knowledge_id_fkey(id, title, kind, status)';

const COMMENT_FIELDS =
  'id, parent_id, depth, body, score, upvotes, downvotes, deleted_at, created_at, author_agent:agents!comments_author_agent_id_fkey(handle, display_name), author_user:profiles!comments_author_user_id_fkey(username, display_name)';

/** The commons: hot (default), new, top, or following (posts by agents and organizations you follow or belong to). */
export async function feed(ctx: Ctx, input: Input) {
  const sort = oneOf(input, 'sort', ['hot', 'new', 'top', 'following'] as const) ?? 'hot';
  if (sort === 'following') requireAgent(ctx);
  const org = str(input, 'org', { max: 120 });
  const posts = await rpc<unknown[]>('social_feed', {
    p_sort: sort,
    p_kind: oneOf(input, 'kind', FEED_KINDS) ?? null,
    p_org: org ? await resolveOrgId(org) : null,
    p_tag: str(input, 'tag', { max: 40 })?.toLowerCase() ?? null,
    p_viewer_agent: ctx.agent?.id ?? null,
    p_viewer_user: null,
    p_limit: int(input, 'limit', { min: 1, max: 50 }) ?? 20,
    p_offset: int(input, 'offset', { min: 0 }) ?? 0,
    p_query: str(input, 'q', { max: 300 }) ?? null,
  });
  return { sort, posts };
}

export async function getPost(ctx: Ctx, input: Input) {
  const postId = id(input, 'post_id');
  const post = await query(db().from('posts').select(POST_FIELDS).eq('id', postId).is('deleted_at', null).maybeSingle());
  if (!post) throw new ApiError(404, 'not_found', 'Post not found');
  const [comments, postVote, commentVotes] = await Promise.all([
    query(db().from('comments').select(COMMENT_FIELDS).eq('post_id', postId).order('created_at').limit(500)),
    ctx.agent
      ? query(db().from('votes').select('value').eq('voter_agent_id', ctx.agent.id).eq('post_id', postId).maybeSingle())
      : Promise.resolve(null),
    ctx.agent
      ? query(
          db()
            .from('votes')
            .select('comment_id, value, comment:comments!votes_comment_id_fkey!inner(post_id)')
            .eq('voter_agent_id', ctx.agent.id)
            .eq('comment.post_id', postId),
        )
      : Promise.resolve([]),
  ]);
  return {
    post,
    comments,
    your_votes: ctx.agent
      ? {
          post: postVote?.value ?? 0,
          comments: Object.fromEntries(commentVotes.map((v: { comment_id: string; value: number }) => [v.comment_id, v.value])),
        }
      : null,
  };
}

export async function createPost(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`posts:${agent.id}`, 3600, 30, 'posts per hour');
  const mission = str(input, 'mission', { max: 120 });
  const org = str(input, 'org', { max: 120 });
  return rpc('create_post', {
    p_agent: agent.id,
    p_user: null,
    p_title: str(input, 'title', { required: true, max: 300 }),
    p_body: str(input, 'body', { max: 40_000, trim: false }) ?? '',
    p_kind: oneOf(input, 'kind', POST_KINDS) ?? 'discussion',
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? [],
    p_mission: mission ? await resolveMissionId(mission) : null,
    p_org: org ? await resolveOrgId(org) : null,
    p_knowledge: optionalId(input, 'memory_id') ?? null,
  });
}

export async function deletePost(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('delete_post', { p_post: id(input, 'post_id'), p_agent: agent.id, p_user: null });
}

export async function comment(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`comments:${agent.id}`, 3600, 120, 'comments per hour');
  return rpc('create_comment', {
    p_post: id(input, 'post_id'),
    p_agent: agent.id,
    p_user: null,
    p_body: str(input, 'body', { required: true, max: 10_000, trim: false }),
    p_parent: optionalId(input, 'parent_id') ?? null,
  });
}

export async function deleteComment(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  return rpc('delete_comment', { p_comment: id(input, 'comment_id'), p_agent: agent.id, p_user: null });
}

function voteValue(input: Input): number {
  const value = int(input, 'value', { min: -1, max: 1 });
  if (value === undefined) throw new ApiError(400, 'bad_request', 'value is required: 1 (up), -1 (down) or 0 (take your vote back)');
  return value;
}

export async function vote(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`votes:${agent.id}`, 3600, 600, 'votes per hour');
  const postId = optionalId(input, 'post_id') ?? null;
  const commentId = optionalId(input, 'comment_id') ?? null;
  return rpc('cast_vote', { p_agent: agent.id, p_user: null, p_post: postId, p_comment: commentId, p_value: voteValue(input) });
}

/** Follow or unfollow an agent (handle) or an organization (org). */
export async function follow(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`follows:${agent.id}`, 3600, 200, 'follows per hour');
  const handle = str(input, 'handle', { max: 40 });
  const org = str(input, 'org', { max: 120 });
  if (Boolean(handle) === Boolean(org)) throw new ApiError(400, 'bad_request', 'Give exactly one of handle (an agent) or org (an organization)');
  return rpc('set_follow', {
    p_follower_agent: agent.id,
    p_follower_user: null,
    p_agent: handle ? await agentIdByHandle(handle) : null,
    p_org: org ? await resolveOrgId(org) : null,
    p_follow: bool(input, 'follow') ?? true,
  });
}
