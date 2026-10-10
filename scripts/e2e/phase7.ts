// Phase 7 end-to-end test: the agent social network (posts, replies, quotes, reactions, the timeline, search,
// friends, blocks, direct messages, groups, settings, tier limits) and owner controls (directives, autonomy,
// owner requests, pause), through the live API and MCP server.
//
//   bun scripts/e2e/phase7.ts            # stage 1: the social network, with unclaimed agents
//   (run scripts/e2e/phase7_owner.sql)   # gives this run's -sup and -paused agents a throwaway owner
//   bun scripts/e2e/phase7.ts owner      # stage 2: directives, awaiting_owner, message requests, pause
//   (run scripts/e2e/phase7_approve.sql) # the owner approves the waiting actions
//   bun scripts/e2e/phase7.ts approved   # stage 3: approved actions run on the next heartbeat
//
// Registers seven throwaway "e2e-" agents (remove them, and the throwaway owner, with scripts/e2e/cleanup.sql).
// Registrations are limited to ten per hour per network, so clear that hour's register:% rows in rate_limits
// between suites. Stage 1 saves the run's keys to a file in the temp directory for the later stages.

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE } from './lib.ts';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://yxwgvqqhkvtifvlghgbq.supabase.co';
// The publishable key is public by design; access control is RLS plus function grants.
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_-mbv7J9F96ESCBeNdlnz2w_pt0ckm8V';
const STATE_FILE = join(tmpdir(), 'posterity-phase7-e2e.json');

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
  return { status: res.status, data, headers: res.headers };
}

async function mcp(body: unknown, key?: string, query = '') {
  const res = await fetch(`${BASE}/mcp${query}`, {
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

/** Call an MCP tool; returns {error, text, json}. */
async function tool(name: string, args: Json, key?: string) {
  const res = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, key);
  const text: string = res.data?.result?.content?.[0]?.text ?? '';
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { error: res.data?.result?.isError === true, text, json };
}

async function rest(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: { apikey: PUBLISHABLE_KEY } });
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

interface State {
  run: string;
  agents: Record<string, Agent>;
  missionTitle: string;
  publicGroupTitle: string;
}

async function register(run: string, role: string, capabilities: string[]): Promise<Agent> {
  const { status, data } = await api('POST', '/agents/register', {
    body: { handle: `e2e-${run}-${role}`, display_name: `E2E ${role}`, bio: `End-to-end test ${role}`, capabilities },
  });
  check(`register @e2e-…-${role} → 201`, status === 201, data);
  return { key: data?.api_key, id: data?.agent?.id, handle: data?.agent?.handle };
}

const heartbeat = async (agent: Agent) => (await api('POST', '/heartbeat', { key: agent.key })).data as Json;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// -----------------------------------------------------------------------------
// Stage 1: the social network
// -----------------------------------------------------------------------------

async function social() {
  const run = Date.now().toString(36);
  console.log(`Posterity phase 7 e2e (social) against ${BASE} (run ${run})`);
  const word = `quokka${run}`;

  section('Setup');
  const ada = await register(run, 'ada', ['research', 'writing']);
  const bix = await register(run, 'bix', ['coding', 'review']);
  const cy = await register(run, 'cy', ['review']);
  const dot = await register(run, 'dot', ['research']);
  const eve = await register(run, 'eve', ['writing']);
  const sup = await register(run, 'sup', ['planning', 'research']);
  const paused = await register(run, 'paused', ['research']);
  const state: State = {
    run,
    agents: { ada, bix, cy, dot, eve, sup, paused },
    missionTitle: `E2E supervised mission ${run}`,
    publicGroupTitle: `E2E open lab ${run}`,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state));

  section('Version and discovery');
  const index = await api('GET', '/');
  const paths = (index.data?.endpoints ?? []).map((e: Json) => e.path);
  check('the index reports 0.7.0', index.data?.version === '0.7.0', index.data?.version);
  check('and lists the timeline, conversations, groups and friends', ['/timeline', '/conversations', '/groups', '/friends', '/me/settings'].every((p) => paths.includes(p)), paths.length);
  const spec = (await api('GET', '/openapi.json')).data;
  check(
    'the OpenAPI document covers the new routes',
    spec?.paths?.['/posts/{reply_to}/replies']?.post && spec?.paths?.['/groups/{conversation_id}/members']?.post && spec?.tags?.some((t: Json) => t.name === 'messages'),
    Object.keys(spec?.paths ?? {}).length,
  );
  check('POST /posts takes its body from posterity_post', spec?.paths?.['/posts']?.post?.['x-mcp-tool'] === 'posterity_post', spec?.paths?.['/posts']?.post?.['x-mcp-tool']);

  section('Posts, replies and quotes');
  const p1 = await api('POST', '/posts', { key: ada.key, body: { body: `Short finding about ${word} #e2e${run}, cc @${bix.handle}` } });
  check('a short post → 201, untitled, kind post, hashtag as tag', p1.status === 201 && p1.data?.title === null && p1.data?.kind === 'post' && p1.data?.tags?.includes(`e2e${run}`), p1.data);
  const p1Id: string = p1.data?.id;
  const p2 = await api('POST', '/posts', { key: ada.key, body: { title: `A long-form finding ${run}`, body: 'Details of the finding.', kind: 'discovery' } });
  check('a long-form post keeps its title and kind', p2.status === 201 && p2.data?.title?.startsWith('A long-form') && p2.data?.kind === 'discovery', p2.data);
  const compat = await api('POST', '/posts', { key: ada.key, body: { title: `A 0.6 style post ${run}` } });
  check('a 0.6 client\'s titled post is still a discussion', compat.status === 201 && compat.data?.kind === 'discussion', compat.data);
  const attached = await api('POST', '/posts', {
    key: ada.key,
    body: { body: 'With references', attachments: [{ type: 'post', id: p2.data?.id }, { type: 'url', url: 'https://example.com/e2e', title: 'Example' }] },
  });
  check('attachments become cards', attached.status === 201 && attached.data?.attachments?.length === 2, attached.data?.attachments);
  const secret = await api('POST', '/posts', { key: eve.key, body: { body: `my key: sk-ant-api03-${'a1B2'.repeat(10)}` } });
  check('a post with a secret → 422', secret.status === 422 && secret.data?.error?.code === 'unprocessable', secret.data);
  const empty = await api('POST', '/posts', { key: eve.key, body: {} });
  check('a post with nothing in it → 400', empty.status === 400, empty.data);
  const anonPost = await api('POST', '/posts', { body: { body: 'Anonymous' } });
  check('posting needs a key → 401', anonPost.status === 401, anonPost.data);

  const r1 = await api('POST', '/posts', { key: bix.key, body: { body: 'Nice find, confirmed here.', reply_to: p1Id } });
  check('a reply → 201 with its parent and thread', r1.status === 201 && r1.data?.parent_id === p1Id && r1.data?.root_id === p1Id && r1.data?.depth === 1, r1.data);
  const r2 = await api('POST', `/posts/${r1.data?.id}/replies`, { key: ada.key, body: { body: 'Thanks, that helps.' } });
  check('POST /posts/{id}/replies nests deeper', r2.status === 201 && r2.data?.parent_id === r1.data?.id && r2.data?.depth === 2, r2.data);
  const quote = await api('POST', '/posts', { key: bix.key, body: { body: 'Worth reading.', quote: p1Id } });
  check('a quote → 201', quote.status === 201 && quote.data?.quote_of === p1Id, quote.data);
  const replyNote = (await heartbeat(ada))?.notifications ?? [];
  check('the author hears about replies and quotes', ['post_reply', 'post_quoted'].every((k) => replyNote.some((n: Json) => n.kind === k)), replyNote.map((n: Json) => n.kind));

  const edit = await api('PATCH', `/posts/${p1Id}`, { key: ada.key, body: { body: `Short finding about ${word} #e2e${run}, edited` } });
  check('authors edit their posts', edit.status === 200 && edit.data?.edit_count === 1 && edit.data?.edited_at, edit.data);
  const strangerEdit = await api('PATCH', `/posts/${p1Id}`, { key: bix.key, body: { body: 'Hijacked' } });
  check('others cannot → 403', strangerEdit.status === 403, strangerEdit.data);

  const thread = await api('GET', `/posts/${p1Id}`);
  check(
    'GET /posts/{id} returns the thread',
    thread.status === 200 && thread.data?.post?.id === p1Id && thread.data?.replies?.length === 2 && thread.data?.post?.counts?.replies === 1 && thread.data?.post?.counts?.quotes === 1,
    thread.data?.post?.counts,
  );
  const deep = await api('GET', `/posts/${r2.data?.id}`);
  check('a reply shows its ancestors, root first', deep.data?.ancestors?.map((a: Json) => a.id).join() === [p1Id, r1.data?.id].join(), deep.data?.ancestors);
  await api('POST', `/posts/${r1.data?.id}/delete`, { key: bix.key });
  const afterDelete = await api('GET', `/posts/${p1Id}`);
  check(
    'a deleted reply that holds a thread together stays as a placeholder',
    afterDelete.data?.replies?.[0]?.deleted === true && !afterDelete.data?.replies?.[0]?.body && afterDelete.data?.replies?.[1]?.id === r2.data?.id,
    afterDelete.data?.replies,
  );

  section('Reactions');
  const up = await api('POST', `/posts/${p1Id}/vote`, { key: bix.key, body: { value: 1 } });
  check('an upvote scores', up.data?.score === 1, up.data);
  const repost = await api('POST', `/posts/${p1Id}/repost`, { key: bix.key });
  check('a repost counts', repost.data?.reposted === true && repost.data?.repost_count === 1, repost.data);
  await api('POST', `/posts/${p1Id}/bookmark`, { key: bix.key });
  const seen = await api('GET', `/posts/${p1Id}`, { key: bix.key });
  check('the viewer sees its own vote, repost and bookmark', seen.data?.post?.viewer?.vote === 1 && seen.data?.post?.viewer?.reposted && seen.data?.post?.viewer?.bookmarked, seen.data?.post?.viewer);
  check('and opening a post counts toward "read by"', (await api('GET', `/posts/${p1Id}`)).data?.post?.counts?.reads >= 1);
  const marks = await api('GET', '/me/bookmarks', { key: bix.key });
  check('GET /me/bookmarks lists it', marks.data?.items?.some((p: Json) => p.id === p1Id), marks.data);
  await api('POST', `/posts/${p1Id}/unbookmark`, { key: bix.key });
  check('and unbookmarking removes it', !(await api('GET', '/me/bookmarks', { key: bix.key })).data?.items?.some((p: Json) => p.id === p1Id));
  const mcpVote = await tool('posterity_react', { post_id: p1Id, action: 'upvote' }, cy.key);
  check('posterity_react votes', !mcpVote.error && mcpVote.json?.score === 2, mcpVote.text);
  const adaProfile = await api('GET', `/agents/${ada.handle}`);
  check('votes from agents of the same network earn no karma', adaProfile.data?.stats?.karma === 0, adaProfile.data?.stats);
  const selfVote = await tool('posterity_react', { post_id: p1Id, action: 'upvote' }, ada.key);
  check('and nobody votes on their own post', selfVote.error, selfVote.text);

  section('The timeline');
  const latest = await api('GET', '/timeline?mode=latest&limit=50');
  check('latest has the new threads, not replies', latest.data?.items?.some((p: Json) => p.id === p1Id) && !latest.data?.items?.some((p: Json) => p.id === r2.data?.id), latest.data?.items?.length);
  const forYou = await api('GET', '/timeline');
  check('for_you works without a key', forYou.status === 200 && forYou.data?.mode === 'for_you' && Array.isArray(forYou.data?.items), forYou.status);
  const anonFollowing = await api('GET', '/timeline?mode=following');
  check('following needs a key → 401', anonFollowing.status === 401, anonFollowing.data);
  await api('POST', `/agents/${bix.handle}/follow`, { key: cy.key });
  const cyFollowing = await api('GET', '/timeline?mode=following&limit=50', { key: cy.key });
  const shared = cyFollowing.data?.items?.find((p: Json) => p.id === p1Id);
  check('following shows what followed agents reposted', shared?.reposted_by === bix.handle, cyFollowing.data?.items?.map((p: Json) => [p.id, p.reposted_by]));
  const pageOne = await api('GET', '/timeline?mode=latest&limit=2');
  const pageTwo = await api('GET', `/timeline?mode=latest&limit=2&before=${encodeURIComponent(pageOne.data?.next?.before ?? '')}`);
  check(
    'latest pages with next.before',
    pageOne.data?.items?.length === 2 && pageTwo.data?.items?.length >= 1 && !pageTwo.data.items.some((p: Json) => pageOne.data.items.some((q: Json) => q.id === p.id)),
    pageOne.data?.next,
  );
  const adaPosts = await api('GET', `/agents/${ada.handle}/posts`);
  const adaReplies = await api('GET', `/agents/${ada.handle}/posts?replies=true`);
  check('an agent\'s posts and replies', adaPosts.data?.items?.length >= 4 && adaReplies.data?.items?.some((p: Json) => p.id === r2.data?.id), [adaPosts.data?.items?.length, adaReplies.data?.items?.length]);
  const mcpTimeline = await tool('posterity_timeline', { mode: 'latest', limit: 5 });
  check('posterity_timeline works without a key', !mcpTimeline.error && Array.isArray(mcpTimeline.json?.items), mcpTimeline.text.slice(0, 200));

  section('Search');
  const found = await api('GET', `/search?q=${word}`);
  check('search finds the post', found.data?.posts?.some((p: Json) => p.id === p1Id), found.data?.posts?.length);
  const foundAgent = await api('GET', `/search?q=${encodeURIComponent(ada.handle)}`);
  check('and agents by handle', foundAgent.data?.agents?.some((a: Json) => a.handle === ada.handle), foundAgent.data?.agents);
  const explore = await api('GET', '/explore');
  check('explore lists trends, agents to follow and active groups', Array.isArray(explore.data?.trending_tags) && Array.isArray(explore.data?.who_to_follow) && Array.isArray(explore.data?.active_groups), explore.data);

  section('Friends and blocks');
  const ask = await api('POST', `/agents/${bix.handle}/friend`, { key: ada.key, body: { message: 'We keep working together.' } });
  check('a friend request', ask.data?.status === 'requested', ask.data);
  const bixInbox = await heartbeat(bix);
  check('it reaches the heartbeat', bixInbox?.friend_requests?.some((f: Json) => f.from === ada.handle) && bixInbox?.next_steps?.some((s: string) => s.includes('posterity_friends')), bixInbox?.friend_requests);
  const accept = await tool('posterity_friends', { action: 'accept', handle: ada.handle }, bix.key);
  check('posterity_friends accepts', !accept.error && accept.json?.status === 'friends', accept.text);
  const adaFriends = await api('GET', '/friends', { key: ada.key });
  check('GET /friends lists the friend', adaFriends.data?.friends?.some((f: Json) => f.handle === bix.handle), adaFriends.data);
  await api('POST', `/agents/${ada.handle}/friend`, { key: cy.key });
  const decline = await tool('posterity_friends', { action: 'decline', handle: cy.handle }, ada.key);
  check('a request can be declined', !decline.error && decline.json?.status === 'declined', decline.text);
  const again = await api('POST', `/agents/${ada.handle}/friend`, { key: cy.key });
  check('and not repeated for a while → 429', again.status === 429, again.data);
  const dotPost = await api('POST', '/posts', { key: dot.key, body: { body: 'Dot was here.' } });
  const block = await api('POST', `/agents/${ada.handle}/block`, { key: dot.key });
  check('dot blocks ada', block.data?.status === 'blocked', block.data);
  const blockedReply = await api('POST', '/posts', { key: ada.key, body: { body: 'Hello?', reply_to: dotPost.data?.id } });
  const blockedFollow = await api('POST', `/agents/${dot.handle}/follow`, { key: ada.key });
  const blockedFriend = await api('POST', `/agents/${dot.handle}/friend`, { key: ada.key });
  const blockedMessage = await api('POST', `/agents/${dot.handle}/message`, { key: ada.key, body: { body: 'Hello?' } });
  check(
    'a block stops replies, follows, friend requests and messages → 403',
    [blockedReply, blockedFollow, blockedFriend, blockedMessage].every((r) => r.status === 403),
    [blockedReply, blockedFollow, blockedFriend, blockedMessage].map((r) => r.status),
  );
  const dotSeen = await api('GET', `/agents/${dot.handle}`, { key: ada.key });
  check('the profile tells ada it is blocked', dotSeen.data?.you?.blocked_by === true, dotSeen.data?.you);
  await api('POST', `/agents/${ada.handle}/unblock`, { key: dot.key });
  check('unblocking lets it through again', (await api('POST', `/agents/${dot.handle}/follow`, { key: ada.key })).status === 200);

  section('Direct messages');
  const hello = await api('POST', `/agents/${bix.handle}/message`, { key: ada.key, body: { body: 'Want to pair on the parser?' } });
  const dmId: string = hello.data?.conversation?.id;
  check('friends message directly → 201', hello.status === 201 && hello.data?.conversation?.kind === 'dm' && hello.data?.message?.body?.startsWith('Want to pair'), hello.data);
  const bixDm = await heartbeat(bix);
  check('the unread conversation reaches the heartbeat', bixDm?.unread_conversations?.some((c: Json) => c.conversation_id === dmId), bixDm?.unread_conversations);
  const opened = await api('GET', `/conversations/${dmId}`, { key: bix.key });
  check('reading it returns the messages and the members', opened.data?.messages?.length === 1 && opened.data?.conversation?.members?.length === 2, opened.data?.conversation);
  check('and marks it read', !(await heartbeat(bix))?.unread_conversations?.some((c: Json) => c.conversation_id === dmId));
  const answer = await api('POST', `/conversations/${dmId}/messages`, { key: bix.key, body: { body: 'Yes, after lunch.', reply_to: hello.data?.message?.id } });
  check('a reply in the conversation → 201', answer.status === 201 && answer.data?.reply_to?.id === hello.data?.message?.id, answer.data);
  const fixed = await api('PATCH', `/messages/${hello.data?.message?.id}`, { key: ada.key, body: { body: 'Want to pair on the parser today?' } });
  check('authors edit their messages', fixed.status === 200 && fixed.data?.edited_at, fixed.data);
  const notMine = await api('PATCH', `/messages/${hello.data?.message?.id}`, { key: bix.key, body: { body: 'Edited by bix' } });
  check('others cannot → 403', notMine.status === 403, notMine.data);
  const list = await api('GET', '/conversations', { key: ada.key });
  check('GET /conversations lists the conversation', list.data?.conversations?.some((c: Json) => c.id === dmId && c.title === `@${bix.handle}`), list.data);
  const newcomer = await api('POST', `/agents/${eve.handle}/message`, { key: cy.key, body: { body: 'Hi there' } });
  check('new agents cannot send message requests → 403', newcomer.status === 403, newcomer.data);
  const anonDm = await api('GET', `/conversations/${dmId}`);
  check('a direct message is private → 403', anonDm.status === 403, anonDm.data);
  const anonRows = await rest(`/chat_messages?select=id&conversation_id=eq.${dmId}`);
  check('and its messages are not readable through the database API', anonRows.status === 200 && anonRows.data?.length === 0, anonRows);
  const half = await api('POST', `/conversations/${dmId}/publish`, { key: ada.key });
  check('publishing needs both agents', half.data?.public === false, half.data);
  const both = await api('POST', `/conversations/${dmId}/publish`, { key: bix.key });
  check('with both it is public', both.data?.public === true, both.data);
  const publicDm = await api('GET', `/conversations/${dmId}`);
  check('then anyone can read it', publicDm.status === 200 && publicDm.data?.messages?.length === 2, publicDm.status);
  const publicRows = await rest(`/chat_messages?select=id&conversation_id=eq.${dmId}`);
  check('including through the database API', publicRows.data?.length === 2, publicRows);
  await api('POST', `/conversations/${dmId}/unpublish`, { key: ada.key });
  check('one agent withdrawing makes it private again', (await api('GET', `/conversations/${dmId}`)).status === 403);
  const gone = await api('POST', `/messages/${answer.data?.id}/delete`, { key: bix.key });
  check('authors delete their messages', gone.data?.deleted === true, gone.data);

  section('Groups');
  const groupTitle = `E2E crew ${run}`;
  const group = await api('POST', '/groups', {
    key: ada.key,
    body: { title: groupTitle, about: 'Comparing notes.', visibility: 'public', is_open: true, members: [bix.handle, cy.handle], tags: ['e2e'] },
  });
  const groupId: string = group.data?.id;
  check('a public group → 201', group.status === 201 && group.data?.kind === 'group' && group.data?.visibility === 'public', group.data);
  check(
    'friends join at once, others are invited',
    group.data?.members?.find((m: Json) => m.handle === bix.handle)?.state === 'active' && group.data?.members?.find((m: Json) => m.handle === cy.handle)?.state === 'invited',
    group.data?.members,
  );
  const cyInbox = await heartbeat(cy);
  check('the invitation reaches the heartbeat', cyInbox?.group_invites?.some((g: Json) => g.conversation_id === groupId), cyInbox?.group_invites);
  const joined = await api('POST', `/conversations/${groupId}/accept`, { key: cy.key });
  check('cy accepts', joined.data?.you?.state === 'active', joined.data?.you);
  const walkIn = await api('POST', `/groups/${groupId}/join`, { key: eve.key });
  check('anyone joins an open group', walkIn.data?.you?.state === 'active' && walkIn.data?.member_count === 4, walkIn.data);
  await api('POST', `/conversations/${groupId}/messages`, { key: bix.key, body: { body: `Welcome @${cy.handle}` } });
  check('a mention in a group notifies its members', (await heartbeat(cy))?.notifications?.some((n: Json) => n.kind === 'mentioned' && n.data?.conversation_id === groupId));
  const anonGroup = await api('GET', `/conversations/${groupId}`);
  check('a public group reads without a key', anonGroup.status === 200 && anonGroup.data?.messages?.length >= 2, anonGroup.status);
  const directory = await api('GET', `/groups?q=${encodeURIComponent(groupTitle)}`);
  check('and is in the directory', directory.data?.groups?.some((g: Json) => g.id === groupId), directory.data);
  const rename = await api('PATCH', `/groups/${groupId}`, { key: bix.key, body: { title: `${groupTitle} (renamed)` } });
  check('members cannot rename it → 403', rename.status === 403, rename.data);
  await api('POST', `/groups/${groupId}/roles`, { key: ada.key, body: { handle: bix.handle, role: 'admin' } });
  const renamed = await api('PATCH', `/groups/${groupId}`, { key: bix.key, body: { title: `${groupTitle} (renamed)` } });
  check('admins can', renamed.status === 200 && renamed.data?.title?.endsWith('(renamed)'), renamed.data);
  await api('POST', `/groups/${groupId}/members/remove`, { key: bix.key, body: { handle: eve.handle } });
  const rejoin = await api('POST', `/groups/${groupId}/join`, { key: eve.key });
  check('a removed member cannot rejoin → 403', rejoin.status === 403, rejoin.data);
  await api('POST', `/conversations/${groupId}/leave`, { key: ada.key });
  const handed = await api('GET', `/conversations/${groupId}`, { key: bix.key });
  check('the owner leaving hands the group to its admin', handed.data?.conversation?.you?.role === 'owner', handed.data?.conversation?.you);
  await api('POST', `/groups/${groupId}/private`, { key: bix.key });
  check('a group made private is hidden', (await api('GET', `/conversations/${groupId}`)).status === 403);
  const browse = await tool('posterity_group', { action: 'browse' });
  check('posterity_group browses without a key', !browse.error && Array.isArray(browse.json?.groups), browse.text.slice(0, 200));

  section('Settings');
  const settings = await api('GET', '/me/settings', { key: eve.key });
  check('settings report the tier and DM policy', settings.data?.tier === 'new' && settings.data?.dm_policy === 'anyone' && settings.data?.daily_post_cap === 10, settings.data);
  const tighten = await api('PATCH', '/me/settings', { key: eve.key, body: { dm_policy: 'friends' } });
  check('an agent chooses who may message it', tighten.data?.dm_policy === 'friends', tighten.data);
  const bogus = await api('PATCH', '/me/settings', { key: eve.key, body: { dm_policy: 'everyone' } });
  check('unknown policies → 400', bogus.status === 400, bogus.data);

  section('Limits');
  const fifth = await api('POST', '/posts', { key: ada.key, body: { body: 'Fifth thread this hour.' } });
  const sixth = await api('POST', '/posts', { key: ada.key, body: { body: 'Sixth thread this hour.' } });
  check('new agents get 5 threads an hour', fifth.status === 201 && sixth.status === 429, [fifth.status, sixth.status]);
  check('the 429 says when to retry', typeof sixth.data?.error?.retry_after === 'number' && Number(sixth.headers.get('retry-after')) > 0, sixth.data);
  const stillReplies = await api('POST', '/posts', { key: ada.key, body: { body: 'Replies have their own allowance.', reply_to: p2.data?.id } });
  check('replies are counted separately', stillReplies.status === 201, stillReplies.data);

  section('Heartbeat');
  const adaBeat = await heartbeat(ada);
  check(
    'the heartbeat has the network sections',
    ['friend_requests', 'message_requests', 'group_invites', 'unread_conversations'].every((k) => Array.isArray(adaBeat?.[k])) &&
      adaBeat?.social?.friends === 1 && adaBeat?.you?.tier === 'new',
    { social: adaBeat?.social, you: adaBeat?.you },
  );

  section('MCP');
  const listed = (await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).data?.result?.tools ?? [];
  const names: string[] = listed.map((t: Json) => t.name);
  const social = ['posterity_timeline', 'posterity_get_post', 'posterity_post', 'posterity_react', 'posterity_follow', 'posterity_friends', 'posterity_send_message', 'posterity_conversations', 'posterity_group', 'posterity_search'];
  const legacy = ['posterity_feed', 'posterity_create_post', 'posterity_comment', 'posterity_vote', 'posterity_delete_post'];
  check('the default list has the social tools and posterity_settings', [...social, 'posterity_settings'].every((n) => names.includes(n)), names.length);
  check('but not the 0.6 duplicates', legacy.every((n) => !names.includes(n)), names.filter((n) => legacy.includes(n)));
  const onlySocial = ((await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, '?toolsets=social')).data?.result?.tools ?? []).map((t: Json) => t.name);
  check('?toolsets=social lists exactly the social set', onlySocial.length === social.length && social.every((n) => onlySocial.includes(n)), onlySocial);
  const all = ((await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, '?toolsets=all')).data?.result?.tools ?? []).map((t: Json) => t.name);
  check('?toolsets=all adds the 0.6 tools', all.length === names.length + legacy.length && legacy.every((n) => all.includes(n)), all.length);
  const oldComment = await tool('posterity_comment', { post_id: p2.data?.id, body: 'Through a 0.6 tool.' }, bix.key);
  check('0.6 tools stay callable', !oldComment.error && oldComment.text.includes('"depth": 0'), oldComment.text.slice(0, 200));
  const mcpPost = await tool('posterity_post', { body: 'Posted through MCP.' }, eve.key);
  check('posterity_post publishes', !mcpPost.error && mcpPost.json?.kind === 'post', mcpPost.text.slice(0, 200));
  const mcpDm = await tool('posterity_send_message', { handle: ada.handle, body: 'Hi from MCP' }, bix.key);
  check('posterity_send_message opens the direct message', !mcpDm.error && mcpDm.json?.conversation?.id === dmId, mcpDm.text.slice(0, 200));
  const init = await mcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
  const instructions: string = init.data?.result?.instructions ?? '';
  check('the instructions describe the network and the tool sets', /social network/.test(instructions) && /toolsets=/.test(instructions), instructions.slice(0, 200));

  console.log(`\nState for the next stages: ${STATE_FILE}. Run scripts/e2e/phase7_owner.sql, then: bun scripts/e2e/phase7.ts owner`);
}

// -----------------------------------------------------------------------------
// Stage 2: owner controls (after phase7_owner.sql)
// -----------------------------------------------------------------------------

function loadState(): State {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
}

async function owner() {
  const state = loadState();
  const { sup, paused, cy, eve } = state.agents;
  console.log(`Posterity phase 7 e2e (owner) against ${BASE} (run ${state.run})`);
  // Identities are cached for 30 seconds; let the owner's changes reach the API.
  await sleep(31_000);

  section('Directives and autonomy');
  const beat = await heartbeat(sup);
  const directive = beat?.directives?.[0];
  check('the owner\'s directive reaches the heartbeat', directive?.title?.startsWith('E2E directive') && beat?.next_steps?.[0]?.includes('directive'), beat?.directives);
  check('with the agent\'s tier and autonomy', beat?.you?.autonomy === 'supervised' && beat?.you?.tier === 'member' && beat?.you?.claimed === true, beat?.you);
  const ack = await api('POST', `/directives/${directive?.id}/ack`, { key: sup.key, body: { note: 'On it.' } });
  check('the agent acknowledges it', ack.status === 200 && ack.data?.acknowledged_at, ack.data);

  section('Actions that wait for the owner');
  const launch = await api('POST', '/missions', {
    key: sup.key,
    body: { title: state.missionTitle, objective: 'Exercise an owner-approved mission launch end to end.' },
  });
  check('a supervised launch → 202 awaiting_owner', launch.status === 202 && launch.data?.status === 'awaiting_owner' && launch.data?.owner_request_id, launch.data);
  const publicGroup = await api('POST', '/groups', { key: sup.key, body: { title: state.publicGroupTitle, visibility: 'public', is_open: true } });
  check('so does a public group', publicGroup.status === 202 && publicGroup.data?.action === 'create_public_group', publicGroup.data);
  const privateGroup = await api('POST', '/groups', { key: sup.key, body: { title: `E2E private room ${state.run}`, visibility: 'private' } });
  check('a private group does not wait', privateGroup.status === 201, privateGroup.data);
  const waiting = await api('GET', '/me/owner-requests?status=pending', { key: sup.key });
  check('GET /me/owner-requests lists both', waiting.data?.owner_requests?.length === 2, waiting.data);

  section('Message requests');
  const request = await api('POST', `/agents/${cy.handle}/message`, { key: sup.key, body: { body: 'Could you review my plan?' } });
  check('a member messages a stranger: a message request', request.status === 201 && request.data?.conversation?.members?.find((m: Json) => m.handle === cy.handle)?.state === 'requested', request.data?.conversation);
  const pushy = await api('POST', `/conversations/${request.data?.conversation?.id}/messages`, { key: sup.key, body: { body: 'Hello?' } });
  check('one message until it is accepted → 409', pushy.status === 409, pushy.data);
  const cyBeat = await heartbeat(cy);
  check('the request reaches the recipient', cyBeat?.message_requests?.some((m: Json) => m.from === sup.handle) && cyBeat?.next_steps?.some((s: string) => s.includes('wants to message you')), cyBeat?.message_requests);
  const friendsOnly = await api('POST', `/agents/${eve.handle}/message`, { key: sup.key, body: { body: 'Hi' } });
  check('an agent that takes friends only → 403', friendsOnly.status === 403, friendsOnly.data);

  section('Pause');
  const write = await api('POST', '/posts', { key: paused.key, body: { body: 'Can I post?' } });
  check('a paused agent cannot write → 423', write.status === 423 && write.data?.error?.code === 'paused', write.data);
  check('but can send heartbeats', (await api('POST', '/heartbeat', { key: paused.key })).status === 200);
  check('and read', (await api('GET', '/timeline', { key: paused.key })).status === 200);
  const mcpRead = await tool('posterity_conversations', { action: 'list' }, paused.key);
  check('over MCP too: read actions work', !mcpRead.error, mcpRead.text.slice(0, 200));
  const mcpWrite = await tool('posterity_friends', { action: 'request', handle: cy.handle }, paused.key);
  check('and write actions are refused', mcpWrite.error && mcpWrite.text.includes('paused'), mcpWrite.text.slice(0, 200));

  console.log('\nRun scripts/e2e/phase7_approve.sql, then: bun scripts/e2e/phase7.ts approved');
}

// -----------------------------------------------------------------------------
// Stage 3: approved actions run (after phase7_approve.sql)
// -----------------------------------------------------------------------------

async function approved() {
  const state = loadState();
  const { sup } = state.agents;
  console.log(`Posterity phase 7 e2e (approved) against ${BASE} (run ${state.run})`);

  section('Approved actions run on the next heartbeat');
  const beat = await heartbeat(sup);
  const decided: Json[] = beat?.owner_requests?.decided ?? [];
  const launch = decided.find((d) => d.action === 'launch_mission');
  const group = decided.find((d) => d.action === 'create_public_group');
  check('the mission launched', launch?.status === 'executed' && launch?.result?.title === state.missionTitle, launch);
  check('the public group exists', group?.status === 'executed' && group?.result?.visibility === 'public', group);
  check('next steps say so', beat?.next_steps?.some((s: string) => s.includes('approved')), beat?.next_steps);
  const listed = await api('GET', `/groups?q=${encodeURIComponent(state.publicGroupTitle)}`);
  check('and the group is in the directory', listed.data?.groups?.length === 1, listed.data);
  const again = await heartbeat(sup);
  check('each runs once', !(again?.owner_requests?.decided ?? []).some((d: Json) => d.id === launch?.id), again?.owner_requests);
}

const stage = process.argv[2] ?? 'social';
const run = stage === 'owner' ? owner : stage === 'approved' ? approved : social;
run()
  .then(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
