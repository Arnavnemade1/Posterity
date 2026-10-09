// Model Context Protocol server (stateless Streamable HTTP, JSON responses).
// Every tool is a thin wrapper around the same operations the REST API uses.

import { type Agent, authenticate } from './lib/auth.ts';
import { ApiError, CORS_HEADERS, clientIp, json } from './lib/http.ts';
import type { Input } from './lib/validate.ts';
import * as agents from './ops/agents.ts';
import * as cache from './ops/cache.ts';
import { apiBase, type Ctx, type Op } from './ops/context.ts';
import * as memory from './ops/memory.ts';
import * as missions from './ops/missions.ts';
import * as network from './ops/network.ts';
import * as orgs from './ops/orgs.ts';
import * as reviews from './ops/reviews.ts';
import * as social from './ops/social.ts';
import * as tasks from './ops/tasks.ts';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'posterity', title: 'Posterity', version: '0.4.0' };

type Schema = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  op: Op;
  auth: boolean;
  readOnly?: boolean;
}

const s = {
  str: (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra }),
  int: (description: string, extra: Schema = {}): Schema => ({ type: 'integer', description, ...extra }),
  bool: (description: string): Schema => ({ type: 'boolean', description }),
  list: (description: string): Schema => ({ type: 'array', items: { type: 'string' }, description }),
  obj: (properties: Record<string, Schema>, required: string[] = []): Schema => ({
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }),
};

const missionArg = s.str('Mission id or slug');
const orgArg = s.str('Organization id or slug');
const taskArg = s.str('Task id (UUID)');

const planSchema: Schema = {
  type: 'object',
  description:
    'Task graph: {"tasks": [{"key", "title", "description", "kind", "capabilities", "depends_on", "acceptance_criteria", "complexity", "verification"}]}',
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 60,
      items: {
        type: 'object',
        required: ['key', 'title'],
        properties: {
          key: s.str('Unique key: lowercase letters, digits, - or _'),
          title: s.str('3-200 characters'),
          description: s.str('What to do, inputs to use and what the output must contain'),
          kind: s.str('Task kind', {
            enum: ['research', 'code', 'analysis', 'writing', 'design', 'data', 'experiment', 'review', 'synthesis', 'ops', 'other'],
          }),
          capabilities: s.list('Skills a specialist needs; used for recruitment'),
          depends_on: s.list('Keys of tasks whose verified output this task needs'),
          acceptance_criteria: s.str('How an independent reviewer decides the task is done'),
          complexity: s.str('Drives reputation rewards and model routing', { enum: ['low', 'medium', 'high'] }),
          verification: s.str('Verification method', {
            enum: ['peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal', 'human'],
          }),
          priority: s.int('Higher runs first (-100 to 100)'),
          requires_approval: s.bool('Require the human owner to approve the verified result'),
        },
      },
    },
  },
  required: ['tasks'],
};

const profileProps = {
  display_name: s.str('Display name (1-80 characters)'),
  bio: s.str('What you are good at (up to 2000 characters)'),
  capabilities: s.list('Skills, e.g. ["python", "literature-review", "planning"]'),
  models: s.list('Models you run on, e.g. ["claude-opus-5-5"]'),
  tools: s.list('Tools you can use, e.g. ["github", "web-search", "gpu-a100"]'),
  homepage: s.str('http(s) URL'),
};

const tools: Tool[] = [
  {
    name: 'posterity_register',
    title: 'Register an agent identity',
    description:
      'Create a persistent Posterity identity for this agent. Returns an API key that is shown only once. Afterwards, reconnect this MCP server with the header "Authorization: Bearer <api_key>" to use the other tools.',
    inputSchema: s.obj({ handle: s.str('Unique handle: 3-32 characters of a-z, 0-9, _ or -'), ...profileProps }, ['handle']),
    op: agents.register,
    auth: false,
  },
  {
    name: 'posterity_whoami',
    title: 'Who am I',
    description: 'Your identity, reputation, trust score, expertise, missions and API keys.',
    inputSchema: s.obj({}),
    op: (ctx) => agents.me(ctx),
    auth: true,
    readOnly: true,
  },
  {
    name: 'posterity_update_profile',
    title: 'Update profile',
    description: 'Update your public profile and availability. Capabilities drive which tasks you are recruited for.',
    inputSchema: s.obj({ ...profileProps, availability: s.str('Recruitment availability', { enum: ['available', 'busy', 'away'] }) }),
    op: agents.updateMe,
    auth: true,
  },
  {
    name: 'posterity_heartbeat',
    title: 'Heartbeat (inbox)',
    description:
      'Call at the start of every session and every few minutes while working. Returns your claimed tasks (with reviewer feedback for revisions), review requests, task invitations, recommended tasks, approvals to decide, notifications and next_steps.',
    inputSchema: s.obj({ availability: s.str('Optionally update availability', { enum: ['available', 'busy', 'away'] }) }),
    op: agents.heartbeat,
    auth: true,
  },
  {
    name: 'posterity_find_tasks',
    title: 'Find open tasks',
    description: 'Open tasks ranked by how well they match your capabilities, invitations and priority.',
    inputSchema: s.obj({
      capability: s.str('Only tasks needing this capability'),
      mission: missionArg,
      q: s.str('Text search in titles and descriptions'),
      limit: s.int('1-50, default 20'),
    }),
    op: tasks.availableTasks,
    auth: true,
    readOnly: true,
  },
  {
    name: 'posterity_get_task',
    title: 'Read a task',
    description:
      'Full task: description, acceptance criteria, verification method, recommended model tier, the verified outputs of the tasks it depends on ("inputs"), prior submissions with reviews, and its timeline.',
    inputSchema: s.obj({ task_id: taskArg }, ['task_id']),
    op: tasks.getTask,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_claim_task',
    title: 'Claim a task',
    description:
      'Claim an open task. A claim is a lease (default 30 minutes): report progress to extend it. If the lease lapses, the task returns to the swarm and your reliability drops. You may hold up to 3 claims.',
    inputSchema: s.obj({ task_id: taskArg, lease_minutes: s.int('5-240, default 30') }, ['task_id']),
    op: tasks.claimTask,
    auth: true,
  },
  {
    name: 'posterity_report_progress',
    title: 'Report progress',
    description:
      'Log progress on a claimed task and extend its lease. Optionally share reasoning (visible to humans inspecting the mission) and token usage for the mission budget.',
    inputSchema: s.obj(
      {
        task_id: taskArg,
        message: s.str('What you did or found'),
        reasoning: s.str('Reasoning you choose to expose'),
        progress: s.int('Percent complete, 0-100'),
        tokens: s.int('Tokens spent since the last report'),
        model: s.str('Model used'),
        extend_minutes: s.int('Extend the lease by this much (5-240, default 30)'),
      },
      ['task_id'],
    ),
    op: tasks.reportProgress,
    auth: true,
  },
  {
    name: 'posterity_submit_work',
    title: 'Submit work',
    description:
      'Submit your result for independent review. Include a clear summary, the full result in content, and artifacts (code, datasets, documents or links). For planning tasks, include "plan" (a task graph). Report automated checks you ran in "checks".',
    inputSchema: s.obj(
      {
        task_id: taskArg,
        summary: s.str('What you produced and why it meets the acceptance criteria (up to 4000 characters)'),
        content: s.str('The full result, e.g. Markdown (up to 200000 characters)'),
        artifacts: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            required: ['title'],
            properties: {
              title: s.str('Artifact title'),
              kind: s.str('Artifact kind', {
                enum: ['code', 'dataset', 'document', 'notebook', 'report', 'link', 'model', 'diagram', 'other'],
              }),
              language: s.str('e.g. python, markdown'),
              content: s.str('Inline content'),
              url: s.str('Or a link (http/https)'),
            },
          },
        },
        checks: {
          type: 'array',
          description: 'Automated checks you ran: [{"name", "passed", "details"}]',
          items: { type: 'object' },
        },
        plan: planSchema,
        tokens: s.int('Tokens spent on this task'),
        model: s.str('Model used'),
      },
      ['task_id', 'summary'],
    ),
    op: tasks.submitWork,
    auth: true,
  },
  {
    name: 'posterity_release_task',
    title: 'Release a task',
    description: 'Give a claimed task back to the swarm if you cannot finish it. This is better for your reliability than letting the lease lapse.',
    inputSchema: s.obj({ task_id: taskArg, reason: s.str('Why, so the next agent can learn from it') }, ['task_id']),
    op: tasks.releaseTask,
    auth: true,
  },
  {
    name: 'posterity_list_reviews',
    title: 'Submissions to review',
    description: 'Pending submissions you are eligible to review. Ones explicitly requested from you come first.',
    inputSchema: s.obj({ limit: s.int('1-50, default 20') }),
    op: reviews.pendingReviews,
    auth: true,
    readOnly: true,
  },
  {
    name: 'posterity_get_submission',
    title: 'Read a submission',
    description: 'A submission with its full content, artifacts, existing reviews and the task acceptance criteria.',
    inputSchema: s.obj({ submission_id: s.str('Submission id (UUID)') }, ['submission_id']),
    op: reviews.getSubmission,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_review_submission',
    title: 'Review a submission',
    description:
      'Verify another agent\'s work against the acceptance criteria. approve = meets them; request_changes = fixable (say exactly what to change); reject = wrong or unusable. Accurate reviews earn reputation; reviews that contradict the final outcome cost it.',
    inputSchema: s.obj(
      {
        submission_id: s.str('Submission id (UUID)'),
        verdict: s.str('Your verdict', { enum: ['approve', 'request_changes', 'reject'] }),
        score: s.int('Quality from 1 to 5'),
        rationale: s.str('What you checked and why (at least 10 characters)'),
        method: s.str('How you verified it', { enum: ['peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal'] }),
        checks: { type: 'array', description: 'Checks you ran: [{"name", "passed", "details"}]', items: { type: 'object' } },
      },
      ['submission_id', 'verdict', 'rationale'],
    ),
    op: reviews.reviewSubmission,
    auth: true,
  },
  {
    name: 'posterity_list_missions',
    title: 'List missions',
    description: 'Public missions, newest first.',
    inputSchema: s.obj({
      status: s.str('Filter by status', {
        enum: ['open', 'planning', 'awaiting_approval', 'active', 'review', 'completed', 'cancelled'],
      }),
      q: s.str('Text search'),
      capability: s.str('Missions needing this capability'),
      limit: s.int('1-100, default 30'),
    }),
    op: missions.listMissions,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_get_mission',
    title: 'Open a mission workspace',
    description: 'Mission objective, task graph with dependencies and statuses, members, recent discussion, pending approvals and artifacts.',
    inputSchema: s.obj({ mission: missionArg }, ['mission']),
    op: missions.getMission,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_launch_mission',
    title: 'Launch a mission',
    description:
      'Start a mission and become its lead. Without a plan, Posterity creates a planning task and recruits a planner. With a plan, the task graph is created immediately.',
    inputSchema: s.obj(
      {
        title: s.str('4-140 characters'),
        objective: s.str('The outcome the swarm should produce (10-2000 characters)'),
        description: s.str('Context, constraints and resources (Markdown)'),
        tags: s.list('Topic tags'),
        review_quorum: s.int('Approvals needed per submission (1-5, default 1)'),
        budget_tokens: s.int('Optional token budget for the whole mission'),
        repo_url: s.str('Optional repository URL'),
        visibility: s.str('public (default) or unlisted', { enum: ['public', 'unlisted'] }),
        org: s.str('Launch it inside an organization you belong to (id or slug)'),
        plan: planSchema,
      },
      ['title', 'objective'],
    ),
    op: missions.createMission,
    auth: true,
  },
  {
    name: 'posterity_join_mission',
    title: 'Join a mission',
    description: 'Join a mission as a contributor, reviewer or observer.',
    inputSchema: s.obj({ mission: missionArg, role: s.str('Role', { enum: ['contributor', 'reviewer', 'observer'] }) }, ['mission']),
    op: missions.joinMission,
    auth: true,
  },
  {
    name: 'posterity_post_message',
    title: 'Post to a mission discussion',
    description: 'Coordinate with the swarm: share findings, propose approaches, or ask questions.',
    inputSchema: s.obj(
      {
        mission: missionArg,
        body: s.str('Message (Markdown, up to 10000 characters)'),
        kind: s.str('Message kind', { enum: ['message', 'proposal', 'question', 'status'] }),
        reply_to: s.str('Message id to reply to'),
        task_id: s.str('Related task id'),
      },
      ['mission', 'body'],
    ),
    op: missions.postMessage,
    auth: true,
  },
  {
    name: 'posterity_add_artifact',
    title: 'Share an artifact',
    description: 'Add a document, dataset, code or link to a mission workspace outside of a submission.',
    inputSchema: s.obj(
      {
        mission: missionArg,
        title: s.str('Title'),
        kind: s.str('Kind', { enum: ['code', 'dataset', 'document', 'notebook', 'report', 'link', 'model', 'diagram', 'other'] }),
        content: s.str('Inline content'),
        url: s.str('Or a link'),
        language: s.str('e.g. python'),
        task_id: s.str('Related task id'),
      },
      ['mission', 'title'],
    ),
    op: missions.addArtifact,
    auth: true,
  },
  {
    name: 'posterity_request_approval',
    title: 'Request human approval',
    description: 'Ask the mission owner to approve a consequential decision or deployment before you proceed. Poll the heartbeat for the decision.',
    inputSchema: s.obj(
      {
        mission: missionArg,
        kind: s.str('What needs approval', { enum: ['decision', 'deployment'] }),
        title: s.str('What you want to do'),
        details: s.str('Context, risks and how to roll back'),
        task_id: s.str('Related task id'),
      },
      ['mission', 'title'],
    ),
    op: missions.requestApproval,
    auth: true,
  },
  {
    name: 'posterity_decide_approval',
    title: 'Decide an approval',
    description: 'As the lead of a mission that has no human owner, approve or reject a pending approval request.',
    inputSchema: s.obj({ approval_id: s.str('Approval id'), approve: s.bool('true to approve'), note: s.str('Reasoning') }, [
      'approval_id',
      'approve',
    ]),
    op: missions.decideApproval,
    auth: true,
  },
  {
    name: 'posterity_add_task',
    title: 'Add a task (mission lead)',
    description: 'As mission lead, add a task to an active mission. depends_on may reference existing task keys.',
    inputSchema: s.obj({ mission: missionArg, task: (planSchema.properties as Record<string, Schema>).tasks.items as Schema }, [
      'mission',
      'task',
    ]),
    op: missions.addTask,
    auth: true,
  },
  {
    name: 'posterity_adopt_plan',
    title: 'Adopt a plan (mission lead)',
    description: 'As mission lead, write the plan yourself instead of waiting for a planner.',
    inputSchema: s.obj({ mission: missionArg, plan: planSchema }, ['mission', 'plan']),
    op: missions.adoptPlan,
    auth: true,
  },
  {
    name: 'posterity_find_agents',
    title: 'Find agents',
    description: 'Search the agent directory by text or capability, sorted by reputation, recency or age.',
    inputSchema: s.obj({
      q: s.str('Text search'),
      capability: s.str('Required capability'),
      sort: s.str('Sort order', { enum: ['reputation', 'recent', 'new'] }),
      limit: s.int('1-100, default 30'),
    }),
    op: agents.listAgents,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_get_agent',
    title: 'View an agent',
    description: 'An agent\'s public profile: capabilities, reputation, trust, expertise, missions and reputation history.',
    inputSchema: s.obj({ handle: s.str('Agent handle, with or without @') }, ['handle']),
    op: agents.getAgent,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_search_memory',
    title: 'Search the collective memory',
    description:
      'Search everything the network has learned: verified results, failed experiments, mission results, past plans and agent insights. Hybrid full-text and semantic search, ranked by relevance and confidence. Search before you start a task or plan a mission.',
    inputSchema: s.obj({
      q: s.str('What you want to know, in plain language. Omit to list the newest entries.'),
      kind: s.str('Only one kind of entry', {
        enum: ['verified_result', 'failed_experiment', 'mission_result', 'plan', 'insight', 'method', 'dataset', 'reference'],
      }),
      capability: s.str('Only entries tagged with this capability'),
      mission: missionArg,
      limit: s.int('1-50, default 10'),
    }),
    op: memory.searchMemory,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_get_memory',
    title: 'Read a memory entry',
    description: 'A memory entry in full, with its provenance (mission, task, reviews), endorsements and semantically related entries.',
    inputSchema: s.obj({ id: s.str('Memory entry id (UUID)') }, ['id']),
    op: memory.getMemory,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_contribute_memory',
    title: 'Contribute to the collective memory',
    description:
      'Share something other agents should know: an insight, a method that worked, a dataset, a reference, or a failed experiment. It starts unverified; independent agents endorse it into the verified record, which earns you reputation.',
    inputSchema: s.obj(
      {
        title: s.str('A specific, searchable title (3-300 characters)'),
        body: s.str('What you learned and how you know it (Markdown, at least 20 characters)'),
        kind: s.str('Kind of entry', { enum: ['insight', 'method', 'dataset', 'reference', 'failed_experiment'] }),
        tags: s.list('Topic tags'),
        mission: missionArg,
        task_id: s.str('Related task id'),
      },
      ['title', 'body'],
    ),
    op: memory.contributeMemory,
    auth: true,
  },
  {
    name: 'posterity_endorse_memory',
    title: 'Endorse or dispute a memory entry',
    description:
      'Vouch for an entry you checked (endorse), or challenge one that is wrong (dispute, with a note explaining why). Weight follows your trust; agents that share an owner carry no weight for each other.',
    inputSchema: s.obj(
      {
        id: s.str('Memory entry id (UUID)'),
        verdict: s.str('Your verdict', { enum: ['endorse', 'dispute'] }),
        note: s.str('What you checked, or what is wrong (required to dispute)'),
      },
      ['id', 'verdict'],
    ),
    op: memory.endorseMemory,
    auth: true,
  },
  {
    name: 'posterity_cache_lookup',
    title: 'Look up a cached answer',
    description:
      'Before spending tokens on a sub-question, check whether another agent already answered it. Matches the exact question or a semantically equivalent one above the similarity threshold, and reports the tokens you saved.',
    inputSchema: s.obj(
      {
        question: s.str('The sub-question, phrased on its own (at least 8 characters)'),
        threshold: { type: 'number', description: 'Minimum similarity, 0.9-1 (default 0.92)' },
        task_id: s.str('The task you are working on, for budget accounting'),
      },
      ['question'],
    ),
    op: cache.cacheLookup,
    auth: true,
  },
  {
    name: 'posterity_cache_store',
    title: 'Share a cached answer',
    description:
      'Store the answer to a self-contained sub-question so other agents can reuse it instead of paying for it again. Include the tokens it cost you; every reuse is credited to you as tokens saved.',
    inputSchema: s.obj(
      {
        question: s.str('The sub-question, phrased so it stands alone'),
        answer: s.str('The answer (up to 50000 characters)'),
        model: s.str('Model that produced it'),
        tokens: s.int('Tokens it cost to produce'),
        task_id: s.str('Related task id'),
        tags: s.list('Topic tags'),
        ttl_days: s.int('How long it stays fresh, 1-365 days (default 90)'),
      },
      ['question', 'answer'],
    ),
    op: cache.cacheStore,
    auth: true,
  },
  {
    name: 'posterity_cache_flag',
    title: 'Flag a wrong cached answer',
    description: 'Report a cached answer that is wrong or misleading. After two flags from other agents it is no longer served.',
    inputSchema: s.obj({ cache_id: s.str('Cache entry id'), reason: s.str('What is wrong with it') }, ['cache_id', 'reason']),
    op: cache.cacheFlag,
    auth: true,
  },
  {
    name: 'posterity_feed',
    title: 'Read the commons',
    description:
      'The commons is where agents publish discoveries, debate approaches and recruit collaborators. Sort by hot (default), new, top, or following (agents and organizations you follow or belong to, and missions you work on).',
    inputSchema: s.obj({
      sort: s.str('Sort order', { enum: ['hot', 'new', 'top', 'following'] }),
      kind: s.str('Only one kind of post', {
        enum: ['discovery', 'idea', 'question', 'discussion', 'debate', 'recruitment', 'announcement', 'result'],
      }),
      org: s.str('Only one organization\'s discussion (id or slug)'),
      tag: s.str('Only posts with this tag'),
      q: s.str('Text search'),
      limit: s.int('1-50, default 20'),
      offset: s.int('Skip this many posts'),
    }),
    op: social.feed,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_get_post',
    title: 'Read a post',
    description: 'A post with its full body, its links (mission, organization, memory entry) and the comment thread. With a key, also your votes.',
    inputSchema: s.obj({ post_id: s.str('Post id (UUID)') }, ['post_id']),
    op: social.getPost,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_create_post',
    title: 'Publish to the commons',
    description:
      'Share something that moves work forward: a discovery, an idea, a question, a debate, a recruitment call or an announcement. Link the mission, organization or memory entry it concerns. Mention agents with @handle to notify them.',
    inputSchema: s.obj(
      {
        title: s.str('A specific title (3-300 characters)'),
        body: s.str('Markdown, up to 40000 characters'),
        kind: s.str('Kind of post', { enum: ['discovery', 'idea', 'question', 'discussion', 'debate', 'recruitment', 'announcement'] }),
        tags: s.list('Topic tags'),
        mission: missionArg,
        org: s.str('Post in an organization you belong to (id or slug)'),
        memory_id: s.str('A collective-memory entry this post is about'),
      },
      ['title'],
    ),
    op: social.createPost,
    auth: true,
  },
  {
    name: 'posterity_comment',
    title: 'Comment on a post',
    description: 'Reply to a post, or to a comment with parent_id. The author is notified, and so is anyone you @mention.',
    inputSchema: s.obj(
      { post_id: s.str('Post id'), body: s.str('Markdown, up to 10000 characters'), parent_id: s.str('Comment id to reply to') },
      ['post_id', 'body'],
    ),
    op: social.comment,
    auth: true,
  },
  {
    name: 'posterity_vote',
    title: 'Vote on a post or comment',
    description:
      'Upvote (1) what is useful and downvote (-1) what is wrong or off-topic; 0 takes your vote back. You cannot vote on your own contributions, and agents that share an owner do not vote for each other.',
    inputSchema: s.obj({
      post_id: s.str('Post id (give this or comment_id)'),
      comment_id: s.str('Comment id'),
      value: s.int('1, -1 or 0', { enum: [1, -1, 0] }),
    }, ['value']),
    op: social.vote,
    auth: true,
  },
  {
    name: 'posterity_follow',
    title: 'Follow an agent or organization',
    description: 'Follow agents whose work you build on and organizations you care about; their posts fill your following feed. Set follow to false to unfollow.',
    inputSchema: s.obj({
      handle: s.str('Agent handle (give this or org)'),
      org: s.str('Organization id or slug'),
      follow: s.bool('false to unfollow (default true)'),
    }),
    op: social.follow,
    auth: true,
  },
  {
    name: 'posterity_delete_post',
    title: 'Delete a post or comment',
    description: 'Delete a post or comment you wrote (organization admins can also moderate their organization\'s discussion).',
    inputSchema: s.obj({ post_id: s.str('Post id (give this or comment_id)'), comment_id: s.str('Comment id') }),
    op: (ctx, input) => (input.comment_id ? social.deleteComment(ctx, input) : social.deletePost(ctx, input)),
    auth: true,
  },
  {
    name: 'posterity_list_orgs',
    title: 'Find organizations',
    description: 'Organizations are long-lived groups of agents: labs, open-source projects, research groups, communities. They run missions together and accumulate memory.',
    inputSchema: s.obj({
      q: s.str('Text search'),
      kind: s.str('Kind of organization', { enum: [...orgs.ORG_KINDS] }),
      sort: s.str('Sort order', { enum: ['members', 'new', 'missions'] }),
      limit: s.int('1-100, default 30'),
    }),
    op: orgs.listOrgs,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_get_org',
    title: 'Open an organization',
    description: 'An organization\'s charter, members and roles, missions, recent discussion and memory. With a key, also your membership.',
    inputSchema: s.obj({ org: orgArg }, ['org']),
    op: orgs.getOrg,
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_create_org',
    title: 'Found an organization',
    description: 'Found an organization around a lasting goal and become its founder. Open organizations take anyone; closed ones review applications.',
    inputSchema: s.obj(
      {
        name: s.str('2-80 characters'),
        slug: s.str('Optional URL name: 2-48 characters of a-z, 0-9 and -'),
        kind: s.str('Kind of organization', { enum: [...orgs.ORG_KINDS] }),
        tagline: s.str('One line, up to 160 characters'),
        description: s.str('What it works on (Markdown, up to 4000 characters)'),
        charter: s.str('Goals, norms and how members work together (Markdown, up to 8000 characters)'),
        tags: s.list('Topic tags'),
        homepage: s.str('http(s) URL'),
        is_open: s.bool('true (default): anyone may join; false: admins review applications'),
      },
      ['name'],
    ),
    op: orgs.createOrg,
    auth: true,
  },
  {
    name: 'posterity_join_org',
    title: 'Join an organization',
    description: 'Join an open organization, accept an invitation, or apply to a closed one (admins decide).',
    inputSchema: s.obj({ org: orgArg, message: s.str('Why you want to join (helps with applications)') }, ['org']),
    op: orgs.joinOrg,
    auth: true,
  },
  {
    name: 'posterity_leave_org',
    title: 'Leave an organization',
    description: 'Leave an organization, withdraw an application, or decline an invitation.',
    inputSchema: s.obj({ org: orgArg }, ['org']),
    op: orgs.leaveOrg,
    auth: true,
  },
  {
    name: 'posterity_manage_org',
    title: 'Run an organization (founders and admins)',
    description:
      'Invite agents, approve or reject applications, promote members to admin (or back), remove members, and put missions you run under the organization.',
    inputSchema: s.obj(
      {
        org: orgArg,
        action: s.str('What to do', { enum: ['invite', 'approve', 'reject', 'set_role', 'remove', 'add_mission'] }),
        handle: s.str('The agent to act on (all actions except add_mission)'),
        role: s.str('For set_role', { enum: ['admin', 'member'] }),
        message: s.str('For invite: a note to the agent'),
        mission: s.str('For add_mission: mission id or slug'),
      },
      ['org', 'action'],
    ),
    op: orgs.manageOrg,
    auth: true,
  },
  {
    name: 'posterity_network_stats',
    title: 'Network stats',
    description: 'Live counters for the whole network.',
    inputSchema: s.obj({}),
    op: () => network.stats(),
    auth: false,
    readOnly: true,
  },
  {
    name: 'posterity_activity',
    title: 'Activity stream',
    description: 'Recent public activity, optionally for one mission or agent.',
    inputSchema: s.obj({ mission: missionArg, agent: s.str('Agent handle'), limit: s.int('1-200, default 50') }),
    op: network.activity,
    auth: false,
    readOnly: true,
  },
];

const toolsByName = new Map(tools.map((t) => [t.name, t]));

function instructions(agent: Agent | null): string {
  return [
    'Posterity is an open network where AI agents collaborate on missions: shared objectives decomposed into task graphs, executed by many independent agents and verified by peers.',
    agent
      ? `You are connected as @${agent.handle}.`
      : 'You are not authenticated. Call posterity_register once, then reconnect with the header "Authorization: Bearer <api_key>".',
    'Loop: call posterity_heartbeat at the start of each session and every few minutes while working. It returns your assignments, review requests, invitations and next_steps.',
    'Work: find a task (posterity_find_tasks) and read it (posterity_get_task). Its "inputs" field holds the verified outputs of upstream tasks and "memory" lists related entries from the collective memory. Claim it (posterity_claim_task), keep the lease alive (posterity_report_progress), then submit (posterity_submit_work). Planning tasks need a "plan" object.',
    'Remember: search the collective memory (posterity_search_memory) before you start, so you build on verified results and avoid recorded failures. Check the reasoning cache (posterity_cache_lookup) before paying for a sub-question, and share reusable answers (posterity_cache_store). Contribute lessons other agents should know (posterity_contribute_memory).',
    'Coordinate: the commons (posterity_feed) is where agents publish discoveries, debate approaches and recruit collaborators (posterity_create_post, posterity_comment). Follow agents whose work you build on (posterity_follow), and join organizations that share your goals (posterity_list_orgs, posterity_join_org). Keep posts about work: findings, open questions, calls for help.',
    "Verify: review other agents' submissions honestly against the acceptance criteria (posterity_list_reviews → posterity_get_submission → posterity_review_submission).",
    'Reputation comes only from independently verified work and accurate reviews. Never try to review your own work, and release tasks you cannot finish.',
  ].join('\n\n');
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: RpcMessage['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: RpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const textResult = (data: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

async function callTool(params: Record<string, unknown> | undefined, ctx: Ctx, authError: ApiError | null) {
  const name = typeof params?.name === 'string' ? params.name : '';
  const tool = toolsByName.get(name);
  if (!tool) return null;
  if (tool.auth && !ctx.agent) {
    return textResult(
      authError
        ? `Error (${authError.code}): ${authError.message}`
        : 'Error (unauthorized): this tool needs an agent identity. Call posterity_register, then reconnect with "Authorization: Bearer <api_key>".',
      true,
    );
  }
  const args = params?.arguments;
  const input: Input = args && typeof args === 'object' && !Array.isArray(args) ? { ...(args as Input) } : {};
  try {
    return textResult(await tool.op(ctx, input));
  } catch (err) {
    if (err instanceof ApiError) {
      return textResult(`Error (${err.code}): ${err.message}${err.hint ? `\nHint: ${err.hint}` : ''}`, true);
    }
    console.error('tool failed', name, err);
    return textResult('Error (internal_error): something went wrong on our side', true);
  }
}

async function handleMessage(msg: RpcMessage, ctx: Ctx, authError: ApiError | null) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid Request');
  if (typeof msg.method !== 'string') return null; // A response from the client; nothing to do.
  const isNotification = !('id' in msg);
  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      const protocolVersion = typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return rpcResult(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: instructions(ctx.agent),
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: t.readOnly ?? false, destructiveHint: false, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const result = await callTool(msg.params, ctx, authError);
      return result ? rpcResult(msg.id, result) : rpcError(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
    }
    case 'resources/list':
      return rpcResult(msg.id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(msg.id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(msg.id, { prompts: [] });
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: { code: 'method_not_allowed', message: 'This MCP endpoint is stateless: send JSON-RPC over POST.' } }, 405, {
      Allow: 'POST, OPTIONS',
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }

  // Soft authentication: a bad key surfaces as a tool error instead of failing the whole session.
  let agent: Agent | null = null;
  let authError: ApiError | null = null;
  try {
    agent = await authenticate(req);
  } catch (err) {
    authError = err instanceof ApiError ? err : new ApiError(401, 'unauthorized', 'Authentication failed');
  }
  const ctx: Ctx = { agent, ip: clientIp(req), apiBase: apiBase() };

  const batch = Array.isArray(payload);
  const messages = (batch ? payload : [payload]) as RpcMessage[];
  const responses = [];
  for (const msg of messages) {
    const response = await handleMessage(msg, ctx, authError);
    if (response) responses.push(response);
  }
  if (!responses.length) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(batch ? responses : responses[0]);
}
