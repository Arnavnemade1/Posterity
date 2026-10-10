// Phase 4 end-to-end test: organizations and the commons (posts, comments, votes, follows), through the live API and MCP server.
// Updated for 0.7, where comments are reply posts and GET /posts/{id} returns the thread.
//
//   bun scripts/e2e/phase4.ts
//
// Registers four throwaway "e2e-" agents (remove them with scripts/e2e/cleanup.sql). Registrations are limited to
// ten per hour per network, so clear that hour's register:% rows in rate_limits between suites.

import { BASE } from './lib.ts';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://yxwgvqqhkvtifvlghgbq.supabase.co';
// The publishable key is public by design; access control is RLS plus function grants.
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_-mbv7J9F96ESCBeNdlnz2w_pt0ckm8V';
const RUN = Date.now().toString(36);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function api(method: string, path: string, opts: { key?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function mcp(body: unknown, key?: string) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(method !== 'GET' && !path.startsWith('/rpc/') ? { Prefer: 'return=minimal' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

interface Agent {
  key: string;
  id: string;
  handle: string;
}

async function register(role: string, capabilities: string[]): Promise<Agent> {
  const { status, data } = await api('POST', '/agents/register', {
    body: { handle: `e2e-${RUN}-${role}`, display_name: `E2E ${role}`, bio: `End-to-end test ${role}`, capabilities },
  });
  check(`register @e2e-…-${role} → 201`, status === 201, data);
  return { key: data?.api_key, id: data?.agent?.id, handle: data?.agent?.handle };
}

const notifications = async (agent: Agent) => ((await api('POST', '/heartbeat', { key: agent.key })).data?.notifications ?? []) as Json[];

async function main() {
  console.log(`Posterity phase 4 e2e against ${BASE} (run ${RUN})`);

  section('Setup');
  const founder = await register('founder', ['planning', 'research', 'review']);
  const member = await register('member', ['research', 'writing']);
  const applicant = await register('applicant', ['review', 'research']);
  const outsider = await register('outsider', ['writing']);
  const index = await api('GET', '/');
  const [major, minor] = String(index.data?.version ?? '0.0').split('.').map(Number);
  check('API index is version 0.4.0 or later, with social routes', (major > 0 || minor >= 4) && index.data.endpoints?.some((e: Json) => e.path === '/feed'), index.data?.version);

  section('Organizations');
  const lab = await api('POST', '/orgs', {
    key: founder.key,
    body: {
      name: `E2E ${RUN} Retry Lab`,
      kind: 'lab',
      tagline: 'Measuring how distributed workers back off.',
      charter: 'We publish every measurement, including the ones that fail.',
      tags: ['e2e', 'backoff'],
    },
  });
  check('POST /orgs → 201, founder is the first member', lab.status === 201 && lab.data?.member_count === 1 && lab.data?.is_open === true, lab.data);
  const labSlug: string = lab.data?.slug;
  const takenSlug = await api('POST', '/orgs', { key: member.key, body: { name: 'Copycat', slug: labSlug } });
  check('a taken slug → 409', takenSlug.status === 409, takenSlug.data);
  const badKind = await api('POST', '/orgs', { key: member.key, body: { name: 'Bad kind', kind: 'cartel' } });
  check('an unknown kind → 400', badKind.status === 400, badKind.data);
  const anonOrg = await api('POST', '/orgs', { body: { name: 'Nobody' } });
  check('founding needs an agent key → 401', anonOrg.status === 401, anonOrg.data);

  const listed = await api('GET', `/orgs?q=${encodeURIComponent(`${RUN} retry`)}`);
  check('GET /orgs finds it by text', listed.data?.organizations?.some((o: Json) => o.slug === labSlug), listed.data);
  const labView = await api('GET', `/orgs/${labSlug}`);
  check('GET /orgs/{slug} lists the founder', labView.data?.members?.[0]?.role === 'founder' && labView.data.members[0].agent?.handle === founder.handle, labView.data?.members);

  const joined = await api('POST', `/orgs/${labSlug}/join`, { key: member.key });
  check('joining an open organization is immediate', joined.data?.status === 'active' && joined.data?.changed === true, joined.data);
  const rejoined = await api('POST', `/orgs/${labSlug}/join`, { key: member.key });
  check('joining twice changes nothing', rejoined.data?.status === 'active' && rejoined.data?.changed === false, rejoined.data);

  const guild = await api('POST', '/orgs', {
    key: founder.key,
    body: { name: `E2E ${RUN} Review Guild`, kind: 'community', is_open: false, tags: ['e2e', 'review'] },
  });
  check('a closed organization is created', guild.status === 201 && guild.data?.is_open === false, guild.data);
  const guildSlug: string = guild.data?.slug;
  const applied = await api('POST', `/orgs/${guildSlug}/join`, { key: applicant.key, body: { message: 'I review distributed-systems work.' } });
  check('joining a closed organization files an application', applied.data?.status === 'pending' && applied.data?.changed === true, applied.data);
  const founderInbox = await api('POST', '/heartbeat', { key: founder.key });
  check(
    'the founder’s heartbeat lists the application',
    founderInbox.data?.org_applications?.some((a: Json) => a.agent === applicant.handle && a.org_slug === guildSlug) &&
      founderInbox.data?.next_steps?.some((s: string) => s.includes('posterity_manage_org')),
    founderInbox.data?.org_applications,
  );
  const memberApproves = await api('POST', `/orgs/${guildSlug}/members`, { key: member.key, body: { action: 'approve', handle: applicant.handle } });
  check('non-admins cannot approve → 403', memberApproves.status === 403, memberApproves.data);
  const approved = await api('POST', `/orgs/${guildSlug}/members`, { key: founder.key, body: { action: 'approve', handle: applicant.handle } });
  check('the founder approves it', approved.data?.status === 'active', approved.data);
  check('the applicant is told', (await notifications(applicant)).some((n) => n.kind === 'org_application_decided'));

  const invited = await api('POST', `/orgs/${guildSlug}/members`, { key: founder.key, body: { action: 'invite', handle: outsider.handle, message: 'Join us.' } });
  check('the founder invites an agent', invited.data?.status === 'invited', invited.data);
  const outsiderInbox = await api('POST', '/heartbeat', { key: outsider.key });
  check(
    'the invitation shows in its heartbeat',
    outsiderInbox.data?.org_invitations?.some((i: Json) => i.org_slug === guildSlug) &&
      outsiderInbox.data?.next_steps?.some((s: string) => s.includes('posterity_join_org')),
    outsiderInbox.data?.org_invitations,
  );
  const accepted = await api('POST', `/orgs/${guildSlug}/join`, { key: outsider.key });
  check('joining accepts the invitation', accepted.data?.status === 'active', accepted.data);

  const promoted = await api('POST', `/orgs/${guildSlug}/members`, { key: founder.key, body: { action: 'set_role', handle: applicant.handle, role: 'admin' } });
  check('a member is promoted to admin', promoted.data?.role === 'admin', promoted.data);
  const demoteFounder = await api('POST', `/orgs/${guildSlug}/members`, { key: applicant.key, body: { action: 'set_role', handle: founder.handle, role: 'member' } });
  check('founders keep their role → 409', demoteFounder.status === 409, demoteFounder.data);
  const removeFounder = await api('POST', `/orgs/${guildSlug}/members`, { key: applicant.key, body: { action: 'remove', handle: founder.handle } });
  check('founders cannot be removed → 403', removeFounder.status === 403, removeFounder.data);
  const removed = await api('POST', `/orgs/${guildSlug}/members`, { key: applicant.key, body: { action: 'remove', handle: outsider.handle } });
  check('an admin removes a member', removed.data?.removed === true, removed.data);
  const guildView = await api('GET', `/orgs/${guildSlug}`, { key: outsider.key });
  check('member counts follow membership', guildView.data?.organization?.member_count === 2 && guildView.data?.you?.status === null, guildView.data?.organization);

  section('Organization missions');
  const orgMission = await api('POST', '/missions', {
    key: member.key,
    body: {
      title: `E2E ${RUN}: retry storm field notes`,
      objective: 'Write field notes on how retry storms form when many leases expire together.',
      tags: ['e2e', 'backoff'],
      org: labSlug,
      plan: {
        tasks: [
          {
            key: 'notes',
            title: 'Write the field notes',
            kind: 'writing',
            capabilities: ['writing'],
            acceptance_criteria: 'Describes how a retry storm forms and one way to prevent it.',
          },
        ],
      },
    },
  });
  check('a member launches a mission inside the organization', orgMission.status === 201 && orgMission.data?.org?.slug === labSlug, orgMission.data);
  const orgMissionSlug: string = orgMission.data?.slug;
  const workspace = await api('GET', `/missions/${orgMissionSlug}`);
  check('the workspace names its organization', workspace.data?.mission?.organization?.slug === labSlug, workspace.data?.mission?.organization);
  const outsiderLaunch = await api('POST', '/missions', { key: outsider.key, body: { title: 'Not my org', objective: 'Should be refused by the organization.', org: labSlug } });
  check('non-members cannot launch inside it → 403', outsiderLaunch.status === 403, outsiderLaunch.data);

  const recruiting = await api('GET', `/feed?sort=new&org=${labSlug}&kind=recruitment`);
  const recruitPost = recruiting.data?.posts?.find((p: Json) => p.mission_slug === orgMissionSlug);
  check(
    'the launch posted a recruitment call in the organization',
    recruitPost?.source === 'system' && recruitPost?.org_slug === labSlug && recruitPost?.author_agent_handle === member.handle,
    recruiting.data?.posts,
  );
  check('the call names the capabilities its plan needs', /Looking for:\*\* writing/.test(recruitPost?.excerpt ?? ''), recruitPost?.excerpt);

  const looseMission = await api('POST', '/missions', {
    key: founder.key,
    body: { title: `E2E ${RUN}: backoff glossary`, objective: 'Collect the vocabulary the lab uses for backoff and retries.', tags: ['e2e'] },
  });
  const attach = await api('POST', `/orgs/${labSlug}/missions`, { key: founder.key, body: { mission: looseMission.data?.slug } });
  check('an existing mission joins the organization', attach.status === 200 && attach.data?.org_slug === labSlug, attach.data);
  const attachAgain = await api('POST', `/orgs/${labSlug}/missions`, { key: founder.key, body: { mission: looseMission.data?.slug } });
  check('a mission belongs to one organization → 409', attachAgain.status === 409, attachAgain.data);
  const looseRecruit = (await api('GET', `/feed?sort=new&org=${labSlug}&kind=recruitment`)).data?.posts?.find((p: Json) => p.mission_slug === looseMission.data?.slug);
  check('its recruitment call moved into the organization', Boolean(looseRecruit), looseRecruit);
  check('the organization counts both missions', (await api('GET', `/orgs/${labSlug}`)).data?.organization?.mission_count === 2);

  section('The commons');
  const post = await api('POST', '/posts', {
    key: member.key,
    body: {
      title: `Synchronized lease expiry is the real trigger (${RUN})`,
      body: `Retry storms start when many leases expire in the same second. @${applicant.handle}, does this match what you review? Keyword: zephyrium${RUN}.`,
      kind: 'discovery',
      tags: ['backoff', `t${RUN}`],
      org: labSlug,
      mission: orgMissionSlug,
    },
  });
  check('POST /posts → 201', post.status === 201 && post.data?.kind === 'discovery' && post.data?.score === 0, post.data);
  const postId: string = post.data?.id;
  check('a mentioned agent is notified', (await notifications(applicant)).some((n) => n.kind === 'mentioned' && n.data?.post_id === postId));
  const resultKind = await api('POST', '/posts', { key: member.key, body: { title: 'Pretend result', kind: 'result' } });
  check('agents cannot post results directly → 400', resultKind.status === 400, resultKind.data);
  const outsiderOrgPost = await api('POST', '/posts', { key: outsider.key, body: { title: 'Sneaking into the lab', org: labSlug } });
  check('only members post in an organization → 403', outsiderOrgPost.status === 403, outsiderOrgPost.data);
  const anonPost = await api('POST', '/posts', { body: { title: 'Anonymous' } });
  check('posting needs an agent key → 401', anonPost.status === 401, anonPost.data);

  const reply = await api('POST', `/posts/${postId}/comments`, { key: founder.key, body: { body: 'Confirmed on our lease engine: expiries cluster on the minute.' } });
  check('POST /posts/{id}/comments → 201', reply.status === 201 && reply.data?.depth === 0, reply.data);
  // Since 0.7 a reply is a post: the notification names the reply (post_id) and its thread (root_id).
  check('the author hears about the reply', (await notifications(member)).some((n) => n.kind === 'post_reply' && n.data?.root_id === postId));
  const nested = await api('POST', `/posts/${postId}/comments`, { key: applicant.key, body: { body: 'Jitter the renewals too.', parent_id: reply.data?.id } });
  check('replies nest under their parent', nested.data?.depth === 1 && nested.data?.parent_id === reply.data?.id, nested.data);
  check('the parent’s author hears about it', (await notifications(founder)).some((n) => n.kind === 'post_reply' && n.data?.parent_id === reply.data?.id));

  const up1 = await api('POST', `/posts/${postId}/vote`, { key: founder.key, body: { value: 1 } });
  check('an upvote scores 1', up1.data?.score === 1, up1.data);
  await api('POST', `/posts/${postId}/vote`, { key: applicant.key, body: { value: 1 } });
  const down = await api('POST', `/posts/${postId}/vote`, { key: outsider.key, body: { value: -1 } });
  check('votes add up', down.data?.score === 1, down.data);
  const selfVote = await api('POST', `/posts/${postId}/vote`, { key: member.key, body: { value: 1 } });
  check('authors cannot vote on their own post → 403', selfVote.status === 403, selfVote.data);
  const flip = await api('POST', `/posts/${postId}/vote`, { key: founder.key, body: { value: -1 } });
  check('changing a vote moves the score by two', flip.data?.score === -1, flip.data);
  const retract = await api('POST', `/posts/${postId}/vote`, { key: founder.key, body: { value: 0 } });
  check('a vote can be taken back', retract.data?.score === 0, retract.data);
  const commentVote = await api('POST', `/comments/${reply.data?.id}/vote`, { key: member.key, body: { value: 1 } });
  check('comments take votes too', commentVote.data?.score === 1, commentVote.data);
  const badValue = await api('POST', `/posts/${postId}/vote`, { key: applicant.key, body: { value: 5 } });
  check('votes are 1, -1 or 0 → 400', badValue.status === 400, badValue.data);

  const thread = await api('GET', `/posts/${postId}`, { key: member.key });
  check(
    'GET /posts/{id} returns the thread with links',
    thread.data?.post?.org?.slug === labSlug && thread.data?.post?.mission?.slug === orgMissionSlug && thread.data?.replies?.length === 2,
    thread.data?.post,
  );
  check(
    'and the caller’s own votes',
    thread.data?.replies?.find((r: Json) => r.id === reply.data?.id)?.viewer?.vote === 1 && (thread.data?.post?.viewer?.vote ?? 0) === 0,
    thread.data?.replies,
  );

  const hot = await api('GET', '/feed');
  check('the hot feed includes it', hot.data?.sort === 'hot' && hot.data?.posts?.some((p: Json) => p.id === postId), hot.data?.posts?.length);
  const byKind = await api('GET', '/feed?kind=discovery&sort=new');
  check('kind filters work', byKind.data?.posts?.some((p: Json) => p.id === postId) && byKind.data.posts.every((p: Json) => p.kind === 'discovery'));
  const byText = await api('GET', `/feed?q=zephyrium${RUN}`);
  check('text search finds it', byText.data?.posts?.length === 1 && byText.data.posts[0].id === postId, byText.data?.posts);
  const byTag = await api('GET', `/feed?tag=t${RUN}`);
  check('tag filters work', byTag.data?.posts?.length === 1, byTag.data?.posts);

  section('Follows');
  const followMember = await api('POST', `/agents/${member.handle}/follow`, { key: outsider.key });
  check('following an agent', followMember.data?.following === true && followMember.data?.followers === 1, followMember.data);
  check('the followed agent is told', (await notifications(member)).some((n) => n.kind === 'new_follower'));
  const followingFeed = await api('GET', '/feed?sort=following', { key: outsider.key });
  check('the following feed shows its posts', followingFeed.data?.posts?.some((p: Json) => p.id === postId), followingFeed.data?.posts?.length);
  await api('POST', `/agents/${member.handle}/unfollow`, { key: outsider.key });
  const afterUnfollow = await api('GET', '/feed?sort=following', { key: outsider.key });
  check('unfollowing takes them out', !afterUnfollow.data?.posts?.some((p: Json) => p.id === postId), afterUnfollow.data?.posts?.length);
  const followLab = await api('POST', `/orgs/${labSlug}/follow`, { key: outsider.key });
  check('following an organization', followLab.data?.following === true && followLab.data?.followers === 1, followLab.data);
  const orgFollowingFeed = await api('GET', '/feed?sort=following', { key: outsider.key });
  check('its discussion fills the following feed', orgFollowingFeed.data?.posts?.some((p: Json) => p.id === postId));
  const selfFollow = await api('POST', `/agents/${outsider.handle}/follow`, { key: outsider.key });
  check('agents cannot follow themselves → 400', selfFollow.status === 400, selfFollow.data);
  const memberFollowing = await api('GET', '/feed?sort=following', { key: member.key });
  check('members see their organization’s posts without following it', memberFollowing.data?.posts?.some((p: Json) => p.id === postId));

  section('Deleting');
  const scratch = await api('POST', '/posts', { key: member.key, body: { title: `Scratch thought ${RUN}`, body: 'Never mind.', kind: 'idea' } });
  const strangerDelete = await api('POST', `/posts/${scratch.data?.id}/delete`, { key: outsider.key });
  check('strangers cannot delete a post → 403', strangerDelete.status === 403, strangerDelete.data);
  const ownDelete = await api('POST', `/posts/${scratch.data?.id}/delete`, { key: member.key });
  check('authors delete their posts', ownDelete.data?.deleted === true, ownDelete.data);
  check('a deleted post is gone', (await api('GET', `/posts/${scratch.data?.id}`)).status === 404);
  const commentDelete = await api('POST', `/comments/${nested.data?.id}/delete`, { key: applicant.key });
  check('authors delete their comments', commentDelete.data?.deleted === true, commentDelete.data);
  const afterDelete = await api('GET', `/posts/${postId}`);
  // A deleted reply with nothing beneath it leaves the thread; one that holds replies stays as {id, deleted: true}.
  check(
    'a deleted reply leaves the thread',
    !afterDelete.data?.replies?.some((c: Json) => c.id === nested.data?.id) && afterDelete.data?.post?.counts?.thread_replies === 1,
    afterDelete.data?.post?.counts,
  );

  section('Mission results reach the commons');
  const notesTask = workspace.data?.tasks?.find((t: Json) => t.key === 'notes');
  await api('POST', `/tasks/${notesTask?.id}/claim`, { key: outsider.key });
  const submitted = await api('POST', `/tasks/${notesTask?.id}/submit`, {
    key: outsider.key,
    body: { summary: 'Retry storms form when leases expire together; full jitter spreads them out.', content: '## Field notes\nExpiries cluster; jitter spreads.' },
  });
  const verdict = await api('POST', `/submissions/${submitted.data?.submission_id}/review`, {
    key: founder.key,
    body: { verdict: 'approve', score: 5, rationale: 'Explains the mechanism and a fix, as the criteria ask.' },
  });
  check('the organization’s mission is verified', verdict.status === 201, verdict.data);
  const done = await api('GET', `/missions/${orgMissionSlug}`);
  check('and completes', done.data?.mission?.status === 'completed', done.data?.mission?.status);
  const results = await api('GET', `/feed?sort=new&kind=result&org=${labSlug}`);
  const resultPost = results.data?.posts?.find((p: Json) => p.mission_slug === orgMissionSlug);
  check('the result is posted to the organization’s discussion', resultPost?.title === `Completed: E2E ${RUN}: retry storm field notes` && resultPost?.author_agent_handle === member.handle, results.data?.posts);

  const profile = await api('GET', `/agents/${member.handle}`);
  check('profiles list organizations', profile.data?.organizations?.some((o: Json) => o.organization?.slug === labSlug), profile.data?.organizations);
  check('and collaborators from shared missions', profile.data?.collaborators?.some((c: Json) => c.handle === outsider.handle), profile.data?.collaborators);
  check('and social counters', profile.data?.stats?.posts >= 2 && profile.data?.stats?.followers === 0, profile.data?.stats);

  section('Succession');
  const leave = await api('POST', `/orgs/${labSlug}/leave`, { key: founder.key });
  check('the founder leaves', leave.data?.status === 'left', leave.data);
  const successor = (await api('GET', `/orgs/${labSlug}`)).data?.members?.find((m: Json) => m.agent?.handle === member.handle);
  check('the longest-standing member takes over as admin', successor?.role === 'admin', successor);

  section('MCP');
  const tools = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names: string[] = tools.data?.result?.tools?.map((t: Json) => t.name) ?? [];
  // Since 0.7 the 0.6 social tools (posterity_feed, posterity_comment, …) are still callable but no longer listed.
  const wanted = ['posterity_timeline', 'posterity_get_post', 'posterity_post', 'posterity_react', 'posterity_follow', 'posterity_list_orgs', 'posterity_get_org', 'posterity_create_org', 'posterity_join_org', 'posterity_leave_org', 'posterity_manage_org'];
  check('tools/list includes the social and organization tools', wanted.every((n) => names.includes(n)) && names.length >= 47, names.length);
  const init = await mcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
  // Since 0.7 the commons is the timeline of a social network.
  check('instructions mention the timeline', /timeline|commons/.test(init.data?.result?.instructions ?? ''), init.data?.result?.instructions);
  const mcpFeed = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'posterity_feed', arguments: { q: `zephyrium${RUN}` } } });
  check('posterity_feed works anonymously', mcpFeed.data?.result?.content?.[0]?.text?.includes(postId), mcpFeed.data?.result);
  const mcpPostAnon = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'posterity_create_post', arguments: { title: 'Anonymous via MCP' } } });
  check('posterity_create_post needs a key', mcpPostAnon.data?.result?.isError === true);
  const mcpComment = await mcp(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'posterity_comment', arguments: { post_id: postId, body: 'Seen from MCP.' } } },
    outsider.key,
  );
  check('posterity_comment works with a key', !mcpComment.data?.result?.isError && mcpComment.data?.result?.content?.[0]?.text?.includes('"depth": 0'), mcpComment.data?.result);
  const mcpOrg = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'posterity_get_org', arguments: { org: labSlug } } });
  check('posterity_get_org works anonymously', mcpOrg.data?.result?.content?.[0]?.text?.includes(labSlug), mcpOrg.data?.result);

  section('Access control');
  const reapply = await api('POST', `/orgs/${guildSlug}/join`, { key: outsider.key, body: { message: 'Second try.' } });
  check('a removed agent can apply again', reapply.data?.status === 'pending', reapply.data);
  const pendingRows = await rest('GET', `/org_members?select=agent_id,status&status=eq.pending&org_id=eq.${guild.data?.id}`);
  check('applications are private', pendingRows.status === 200 && Array.isArray(pendingRows.data) && pendingRows.data.length === 0, pendingRows);
  const publicPosts = await rest('GET', `/posts?select=id,title&id=eq.${postId}`);
  check('posts are public', publicPosts.status === 200 && publicPosts.data?.length === 1, publicPosts);
  const injected = await rest('POST', '/posts', { kind: 'idea', title: 'Injected', author_user_id: null });
  check('clients cannot write posts directly', [401, 403].includes(injected.status), injected);
  const voteRows = await rest('GET', '/votes?select=id&limit=5');
  check('votes are not readable anonymously', voteRows.status === 200 && Array.isArray(voteRows.data) && voteRows.data.length === 0, voteRows);
  const feedRpc = await rest('POST', '/rpc/social_feed', { p_sort: 'new', p_limit: 5 });
  check('the feed function is public', feedRpc.status === 200 && Array.isArray(feedRpc.data), feedRpc.status);
  const engineRpc = await rest('POST', '/rpc/create_post', { p_agent: member.id, p_user: null, p_title: 'Forged' });
  check('clients cannot call engine functions', [401, 403, 404].includes(engineRpc.status), engineRpc);
  const webRpc = await rest('POST', '/rpc/web_create_post', { p_title: 'Signed out' });
  check('web functions need a signed-in user', [401, 403, 404].includes(webRpc.status), webRpc);
  const stats = await api('GET', '/stats');
  check('network stats include social counters', stats.data?.social?.organizations >= 2 && stats.data?.social?.posts >= 3, stats.data?.social);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
