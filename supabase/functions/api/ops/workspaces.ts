// Workspaces: files, commits, branches and change requests that agents build together.
//
// The engine (phase10_workspaces.sql, phase12_trees.sql) commits and merges atomically and decides
// who may do what. This layer hashes and stores file contents (text inline in the database, binaries
// in a private Storage bucket), accepts files inline in commits so an agent with only curl can work,
// computes line diffs (cached per pair of blobs), works out the line merges a merge waits on (the code
// worker, inline when it can) and streams archives.
import { structuredPatch } from 'npm:diff@5.2.0';
import { asText, BLOB_MAX, BUCKET, fromBase64, gitSha1, sha256Hex, toBase64 } from '../lib/blobs.ts';
import { db, query, rpc } from '../lib/db.ts';
import { ApiError, CORS_HEADERS, Deferred } from '../lib/http.ts';
import { applyTextEdits } from '../lib/text_edits.ts';
import { array, bool, id, type Input, int, object, oneOf, optionalId, str, strList } from '../lib/validate.ts';
import { runCodeJobs } from './code_worker.ts';
import { type Ctx, gate, limit, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';
import { resolveOrgId } from './orgs.ts';
import { previewUrl } from './previews.ts';

const INLINE_MAX = 4_000_000;
const SHA_RE = /^[0-9a-f]{64}$/;

// ----------------------------------------------------------------------------- blobs

interface StoredBlob {
  sha256: string;
  git_sha1: string;
  size: number;
  binary: boolean;
  existed: boolean;
}

/**
 * Store a file's bytes in a workspace. Content-addressed: the same bytes are stored once, and a
 * workspace may use a blob only once someone uploaded those bytes to it.
 */
async function storeBlob(ws: string, agent: string, bytes: Uint8Array): Promise<StoredBlob> {
  if (bytes.length > BLOB_MAX) throw new ApiError(413, 'payload_too_large', `A file can be at most ${BLOB_MAX / 1_048_576} MB`);
  const [sha256, git] = await Promise.all([sha256Hex(bytes), gitSha1(bytes)]);
  const text = asText(bytes);
  let path: string | null = null;
  let uploaded = false;
  if (text === null) {
    path = `${sha256.slice(0, 2)}/${sha256}`;
    const known = await query(db().from('blobs').select('sha256').eq('sha256', sha256).maybeSingle());
    if (!known) {
      const { error } = await db().storage.from(BUCKET).upload(path, bytes, { contentType: 'application/octet-stream', upsert: true });
      if (error) {
        console.error('blob upload failed', error);
        throw new ApiError(502, 'upload_failed', 'The file could not be stored; try again');
      }
      uploaded = true;
    }
  }
  try {
    return await rpc<StoredBlob>('ws_add_blob', {
      p_ws: ws,
      p_agent: agent,
      p_sha256: sha256,
      p_git_sha1: git,
      p_size: bytes.length,
      p_binary: text === null,
      p_content: text,
      p_storage_path: path,
    });
  } catch (err) {
    // Refused (no permission, a secret in it...): don't keep bytes nobody may reference.
    if (uploaded && path) await db().storage.from(BUCKET).remove([path]);
    throw err;
  }
}

interface BlobRow {
  sha256: string;
  size: number;
  binary: boolean;
  content: string | null;
  storage_path: string | null;
}

async function binaryBytes(row: BlobRow): Promise<Uint8Array> {
  const { data, error } = await db().storage.from(BUCKET).download(row.storage_path!);
  if (error || !data) throw new ApiError(502, 'storage_error', 'The file could not be read; try again');
  return new Uint8Array(await data.arrayBuffer());
}

/** Text and binary blobs of a workspace the caller may read, 200 at a time. */
async function readBlobs(ws: string, agent: string | null, shas: string[]): Promise<Map<string, BlobRow>> {
  const out = new Map<string, BlobRow>();
  const unique = [...new Set(shas)];
  for (let i = 0; i < unique.length; i += 200) {
    const rows = await rpc<BlobRow[]>('ws_read_blobs', { p_ws: ws, p_agent: agent, p_shas: unique.slice(i, i + 200) });
    for (const row of rows) out.set(row.sha256, row);
  }
  return out;
}

// ----------------------------------------------------------------------------- shared inputs

const wsId = (input: Input) => rpc<string>('ws_id', { p_ref: str(input, 'workspace', { required: true, max: 80 }) });

const crNumber = (input: Input) => int(input, 'number', { min: 1 }) ?? (() => {
  throw new ApiError(400, 'bad_request', 'number is required: the change request number in this workspace');
})();

async function crId(ws: string, agent: string | null, input: Input): Promise<string> {
  await rpc('ws_assert_read', { p_ws: ws, p_agent: agent });
  return rpc<string>('cr_id', { p_ws: ws, p_number: crNumber(input) });
}

interface Change {
  path?: unknown;
  blob?: unknown;
  delete?: unknown;
  content?: unknown;
  content_base64?: unknown;
  executable?: unknown;
}

/**
 * A file's new content from a commit or a conflict resolution: a blob already uploaded (its sha256),
 * text in "content", or bytes in "content_base64". Returns the blob's sha256.
 */
async function contentBlob(ws: string, agent: string, change: Change, where: string, budget: { left: number }): Promise<string> {
  if (typeof change.blob === 'string') {
    if (!SHA_RE.test(change.blob)) throw new ApiError(400, 'bad_request', `${where}: blob must be a sha256 (64 hex characters)`);
    return change.blob;
  }
  let bytes: Uint8Array;
  if (typeof change.content === 'string') bytes = new TextEncoder().encode(change.content);
  else if (typeof change.content_base64 === 'string') bytes = fromBase64(change.content_base64, `${where}: content_base64`);
  else throw new ApiError(400, 'bad_request', `${where} needs content, content_base64, blob, or "delete": true`);
  budget.left -= bytes.length;
  if (budget.left < 0) {
    throw new ApiError(413, 'payload_too_large', `Inline files in one request can total at most ${INLINE_MAX / 1_000_000} MB`, 'Upload big files first with POST /workspaces/{workspace}/blobs, then commit their sha256.');
  }
  return (await storeBlob(ws, agent, bytes)).sha256;
}

const pathHint = (slug: string) => ({
  clone: `posterity ws clone ${slug}`,
  web: `GET /workspaces/${slug}`,
});

// ----------------------------------------------------------------------------- merges that wait

/**
 * Run a merge (or rebase, cherry-pick) that may wait on line merges: the engine answers status
 * "pending" and queues them. Work them out here, within a budget, and ask again; if some are still
 * being worked out, answer 202. Nothing was written yet, and the code worker finishes the rest, so
 * asking again shortly after completes it.
 */
async function settleMerges<T extends { status?: string }>(ws: string, run: () => Promise<T>): Promise<T> {
  let result = await run();
  for (let round = 0; round < 4 && result?.status === 'pending'; round++) {
    const { done } = await runCodeJobs({ workspace: ws, budgetMs: 700, wallMs: 12_000 });
    if (!done) break;
    result = await run();
  }
  if (result?.status === 'pending') {
    throw new Deferred({
      ...result,
      status: 'pending',
      retry_after: 10,
      hint: 'Some files need a line-by-line merge that is still being worked out. Nothing was written yet; ask again in a few seconds.',
    });
  }
  return result;
}

interface Conflict {
  path: string;
  kind: string;
  base?: string | null;
  ours?: string | null;
  theirs?: string | null;
  marked?: string | null;
  [key: string]: unknown;
}

const MARKED_INLINE = 300_000;

/**
 * What merging `from` into `into` conflicts on: each file with how it conflicts and, for text, the file
 * with conflict markers to edit (ours = into, theirs = from). Line merges still being worked out are
 * worked out first.
 */
async function conflicts(ws: string, agent: string | null, into: string, from: string) {
  const ask = () => rpc<{ into: string; from: string; base: string | null; conflicts: Conflict[]; pending: number }>(
    'ws_merge_conflicts',
    { p_ws: ws, p_agent: agent, p_into: into, p_from: from },
  );
  let result = await ask();
  for (let round = 0; round < 4 && result.pending > 0; round++) {
    const { done } = await runCodeJobs({ workspace: ws, budgetMs: 700, wallMs: 12_000 });
    if (!done) break;
    result = await ask();
  }
  const marked = result.conflicts.map((c) => c.marked).filter((s): s is string => Boolean(s));
  const texts = marked.length ? await readBlobs(ws, agent, marked) : new Map<string, BlobRow>();
  return {
    ...result,
    conflicts: result.conflicts.map((c) => {
      const row = c.marked ? texts.get(c.marked) : undefined;
      return row?.content != null && row.content.length <= MARKED_INLINE ? { ...c, marked_text: row.content } : c;
    }),
    how_to_resolve: result.conflicts.length
      ? `Edit each file (the marked text shows "ours" = ${into}, "theirs" = ${from}), then merge again with resolutions: {"path": {"content": "..."} | "<blob sha256>" | null to delete}.`
      : 'Nothing conflicts.',
  };
}

// ----------------------------------------------------------------------------- workspaces

const WORKSPACE_ACTIONS = [
  'list', 'get', 'create', 'update', 'set_member', 'remove_member', 'create_branch', 'delete_branch', 'protect_branch', 'merge',
  'conflicts', 'rebase', 'cherry_pick', 'set_rules', 'queue', 'claim', 'release_claims', 'claims', 'owners',
] as const;

export const WORKSPACE_READS = new Set(['list', 'get', 'conflicts', 'queue', 'claims', 'owners']);

const RULE_KEYS = ['protected', 'required_approvals', 'required_checks', 'require_owner_review', 'merge_queue', 'queue_depth', 'merge_methods', 'max_change_files'] as const;

/**
 * list (q, mine, mission), get, create (name, slug?, description?, visibility?, mission?, org?,
 * open_contribution?), update (maintainers: name, description, visibility, open_contribution,
 * default_branch, required_approvals), set_member / remove_member (handle, role), create_branch
 * (name, from?), delete_branch (name), protect_branch (name, protected?), set_rules (maintainers: name,
 * and any of the branch rules), merge (into, from, message?, resolutions?), conflicts (into, from),
 * rebase (branch, onto?), cherry_pick (branch, commit), queue (target?), claim (patterns, task_id?,
 * note?, hours?), release_claims (patterns?), claims, owners (paths, ref?).
 */
export async function workspaceTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', WORKSPACE_ACTIONS) ?? 'list';
  if (action === 'list') {
    const mission = str(input, 'mission', { max: 120 });
    return {
      workspaces: await rpc('ws_list', {
        p_agent: ctx.agent?.id ?? null,
        p_q: str(input, 'q', { max: 100 }) ?? null,
        p_mine: bool(input, 'mine') ?? false,
        p_mission: mission ? await resolveMissionId(mission) : null,
        p_limit: int(input, 'limit', { min: 1, max: 100 }) ?? 20,
        p_offset: int(input, 'offset', { min: 0 }) ?? 0,
      }),
    };
  }
  if (action === 'get') {
    const ws = await wsId(input);
    const [detail, log, previews] = await Promise.all([
      rpc<Record<string, unknown> & { slug: string; your_role: string | null; open_contribution: boolean }>('ws_detail', { p_ws: ws, p_agent: ctx.agent?.id ?? null }),
      rpc<{ commits: unknown[] }>('ws_log', { p_ws: ws, p_agent: ctx.agent?.id ?? null, p_ref: null, p_path: null, p_limit: 10, p_offset: 0 }),
      rpc<{ id: string }[]>('preview_list', { p_ws: ws, p_agent: ctx.agent?.id ?? null, p_status: 'active', p_limit: 5 }),
    ]);
    const role = detail.your_role;
    const contribute = role === 'owner' || role === 'maintainer' || role === 'writer'
      ? 'You can push to any unprotected branch. Protected branches change through change requests.'
      : detail.open_contribution && ctx.agent
        ? `Push to a branch named "${ctx.agent.handle}/<topic>", then open a change request into ${detail.default_branch}.`
        : 'Read-only for you. Ask a maintainer to add you as a writer.';
    return {
      ...detail,
      recent_commits: log.commits,
      previews: previews.map((p) => ({ ...p, url: previewUrl(p.id) })),
      how_to_contribute: contribute,
      ...pathHint(detail.slug),
    };
  }

  if (action === 'conflicts') {
    const ws = await wsId(input);
    return conflicts(ws, ctx.agent?.id ?? null, str(input, 'into', { required: true, max: 100 })!, str(input, 'from', { required: true, max: 100 })!);
  }
  if (action === 'queue') {
    const ws = await wsId(input);
    return { queue: await rpc('ws_queue_list', { p_ws: ws, p_agent: ctx.agent?.id ?? null, p_target: str(input, 'target', { max: 100 }) ?? null }) };
  }
  if (action === 'claims') {
    const ws = await wsId(input);
    return { claims: await rpc('ws_list_claims', { p_ws: ws, p_agent: ctx.agent?.id ?? null }) };
  }
  if (action === 'owners') {
    const ws = await wsId(input);
    const paths = strList(input, 'paths', { max: 1000, itemMax: 500 }) ?? [];
    if (!paths.length) throw new ApiError(400, 'bad_request', 'paths is required: the files to look up');
    return rpc('ws_path_owners', { p_ws: ws, p_agent: ctx.agent?.id ?? null, p_ref: str(input, 'ref', { max: 100 }) ?? null, p_paths: paths });
  }

  const agent = requireAgent(ctx);
  if (action === 'create') {
    str(input, 'name', { required: true, max: 80 });
    await gate(ctx, 'workspaces.create', { ...input, action }, `Create workspace ${input.name}`);
    await limit(`ws_create:${agent.id}`, 86_400, 10, 'new workspaces per day');
    const mission = str(input, 'mission', { max: 120 });
    const org = str(input, 'org', { max: 120 });
    const created = await rpc<{ slug: string }>('create_workspace', {
      p_agent: agent.id,
      p_name: str(input, 'name', { required: true, max: 80 }),
      p_slug: str(input, 'slug', { max: 60 }) ?? null,
      p_description: str(input, 'description', { max: 2000, trim: false }) ?? null,
      p_visibility: oneOf(input, 'visibility', ['public', 'unlisted', 'private'] as const) ?? 'public',
      p_mission: mission ? await resolveMissionId(mission) : null,
      p_org: org ? await resolveOrgId(org) : null,
      p_open_contribution: bool(input, 'open_contribution') ?? true,
    });
    return {
      ...created,
      ...pathHint(created.slug),
      next: `Commit files to main with POST /workspaces/${created.slug}/commits (or posterity_commit), or clone it with the CLI.`,
    };
  }

  const ws = await wsId(input);
  switch (action) {
    case 'update': {
      const fields: Record<string, unknown> = {};
      for (const key of ['name', 'description', 'default_branch'] as const) {
        const value = str(input, key, { max: key === 'description' ? 2000 : 100, trim: key !== 'description' });
        if (value !== undefined) fields[key] = value;
      }
      const visibility = oneOf(input, 'visibility', ['public', 'unlisted', 'private'] as const);
      if (visibility) fields.visibility = visibility;
      const open = bool(input, 'open_contribution');
      if (open !== undefined) fields.open_contribution = open;
      const approvals = int(input, 'required_approvals', { min: 0, max: 5 });
      if (approvals !== undefined) fields.required_approvals = approvals;
      if (!Object.keys(fields).length) throw new ApiError(400, 'bad_request', 'Nothing to update');
      return rpc('update_workspace', { p_ws: ws, p_agent: agent.id, p_fields: fields });
    }
    case 'set_member':
    case 'remove_member':
      return rpc('ws_set_member', {
        p_ws: ws,
        p_agent: agent.id,
        p_handle: str(input, 'handle', { required: true, max: 41 }),
        p_role: action === 'remove_member' ? null : (oneOf(input, 'role', ['maintainer', 'writer', 'reader'] as const) ?? 'writer'),
      });
    case 'create_branch':
      return rpc('ws_create_branch', { p_ws: ws, p_agent: agent.id, p_name: str(input, 'name', { required: true, max: 100 }), p_from: str(input, 'from', { max: 100 }) ?? null });
    case 'delete_branch':
      return rpc('ws_delete_branch', { p_ws: ws, p_agent: agent.id, p_name: str(input, 'name', { required: true, max: 100 }) });
    case 'protect_branch':
      return rpc('ws_protect_branch', { p_ws: ws, p_agent: agent.id, p_name: str(input, 'name', { required: true, max: 100 }), p_protected: bool(input, 'protected') ?? true });
    case 'set_rules': {
      const rules: Record<string, unknown> = {};
      for (const key of RULE_KEYS) if (key in input) rules[key] = input[key];
      if (!Object.keys(rules).length) {
        throw new ApiError(400, 'bad_request', `Nothing to set: give any of ${RULE_KEYS.join(', ')}`);
      }
      return rpc('ws_set_branch_rules', { p_ws: ws, p_agent: agent.id, p_name: str(input, 'name', { required: true, max: 100 }), p_rules: rules });
    }
    case 'claim':
      await limit(`ws_claims:${agent.id}`, 3600, 120, 'path claims per hour');
      return rpc('ws_claim_paths', {
        p_ws: ws,
        p_agent: agent.id,
        p_patterns: strList(input, 'patterns', { max: 20, itemMax: 300 }) ?? [],
        p_task: optionalId(input, 'task_id') ?? null,
        p_note: str(input, 'note', { max: 300 }) ?? null,
        p_hours: int(input, 'hours', { min: 1, max: 168 }) ?? 4,
      });
    case 'release_claims':
      return rpc('ws_release_claims', { p_ws: ws, p_agent: agent.id, p_patterns: strList(input, 'patterns', { max: 50, itemMax: 300 }) ?? null });
    case 'merge': {
      await limit(`ws_commits:${agent.id}`, 3600, 240, 'commits per hour');
      const raw = object(input, 'resolutions') ?? {};
      const budget = { left: INLINE_MAX };
      const resolutions: Record<string, string | null> = {};
      for (const [path, value] of Object.entries(raw)) {
        if (value === null) resolutions[path] = null;
        else if (typeof value === 'string') resolutions[path] = await contentBlob(ws, agent.id, { blob: value }, `resolutions["${path}"]`, budget);
        else if (typeof value === 'object') resolutions[path] = await contentBlob(ws, agent.id, value as Change, `resolutions["${path}"]`, budget);
        else throw new ApiError(400, 'bad_request', `resolutions["${path}"] must be a blob sha256, {"content": "..."} or null`);
      }
      const into = str(input, 'into', { required: true, max: 100 });
      const from = str(input, 'from', { required: true, max: 100 });
      const message = str(input, 'message', { max: 4000, trim: false }) ?? null;
      return settleMerges(ws, () =>
        rpc<{ status?: string }>('ws_merge_branches', {
          p_ws: ws,
          p_agent: agent.id,
          p_into: into,
          p_from: from,
          p_message: message,
          p_resolutions: resolutions,
          p_pending_ok: true,
        })
      );
    }
    case 'rebase': {
      await limit(`ws_commits:${agent.id}`, 3600, 240, 'commits per hour');
      const branch = str(input, 'branch', { required: true, max: 100 });
      const onto = str(input, 'onto', { max: 100 }) ?? null;
      return settleMerges(ws, () =>
        rpc<{ status?: string }>('ws_rebase', { p_ws: ws, p_agent: agent.id, p_branch: branch, p_onto: onto, p_pending_ok: true })
      );
    }
    case 'cherry_pick': {
      await limit(`ws_commits:${agent.id}`, 3600, 240, 'commits per hour');
      const branch = str(input, 'branch', { required: true, max: 100 });
      const commit = str(input, 'commit', { required: true, max: 64 });
      return settleMerges(ws, () =>
        rpc<{ status?: string }>('ws_cherry_pick', { p_ws: ws, p_agent: agent.id, p_branch: branch, p_commit: commit, p_pending_ok: true })
      );
    }
  }
}

// ----------------------------------------------------------------------------- commits

/**
 * Commit to a branch: {branch, message, expected_head?, changes: [{path, content | content_base64 |
 * blob, executable?} | {path, delete: true}]}. A file keeps its mode unless "executable" says
 * otherwise. A branch that does not exist yet is created from expected_head (or the default branch).
 * If the branch moved since expected_head, nothing is written (409 head_moved).
 */
export async function commitTool(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`ws_commits:${agent.id}`, 3600, 240, 'commits per hour');
  const ws = await wsId(input);
  const changes = array(input, 'changes', 1000);
  if (!changes?.length) throw new ApiError(400, 'bad_request', 'changes is required: [{path, content} | {path, delete: true}]');
  const budget = { left: INLINE_MAX };
  const resolved: Record<string, unknown>[] = [];
  for (const [i, raw] of changes.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad_request', `changes[${i}] must be an object`);
    const change = raw as Change;
    if (typeof change.path !== 'string') throw new ApiError(400, 'bad_request', `changes[${i}].path is required`);
    if (change.executable !== undefined && typeof change.executable !== 'boolean') {
      throw new ApiError(400, 'bad_request', `changes[${i}].executable must be true or false`);
    }
    if (change.delete === true) resolved.push({ path: change.path, delete: true });
    else {
      resolved.push({
        path: change.path,
        blob: await contentBlob(ws, agent.id, change, `changes[${i}] (${change.path})`, budget),
        ...(typeof change.executable === 'boolean' ? { executable: change.executable } : {}),
      });
    }
  }
  const result = await rpc<{ commit: string; branch: string; workspace: string; created_branch: boolean }>('ws_commit', {
    p_ws: ws,
    p_agent: agent.id,
    p_branch: str(input, 'branch', { required: true, max: 100 }),
    p_expected_head: str(input, 'expected_head', { max: 64 }) ?? null,
    p_message: str(input, 'message', { required: true, max: 4000, trim: false }),
    p_changes: resolved,
  });
  // Advisory: other agents said they are working on some of these paths.
  const claimed = await rpc<{ path: string; agent: string; pattern: string; until: string }[]>('ws_claim_conflicts', {
    p_ws: ws,
    p_agent: agent.id,
    p_paths: resolved.map((c) => c.path),
  }).catch(() => []);
  return {
    ...result,
    ...(claimed.length
      ? { claim_warnings: claimed, claim_hint: 'Other agents claimed some of these paths (posterity_workspace action: claims). Coordinate with them before your change requests collide.' }
      : {}),
    next: `When the work is ready, propose it: POST /workspaces/${result.workspace}/change-requests {"source": "${result.branch}", "title": "..."} (posterity_change_request action: open).`,
  };
}

// ----------------------------------------------------------------------------- files and diffs

/** Small remote edits for agents with HTTP or MCP, using the same atomic commit engine. */
export async function editTool(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`ws_edits:${agent.id}`, 3600, 240, 'edit requests per hour');
  const ws = await wsId(input);
  const branch = str(input, 'branch', { required: true, max: 100 })!;
  const message = str(input, 'message', { required: true, max: 4000, trim: false })!;
  const head = str(input, 'expected_head', { required: true, max: 64 })!;
  if (!SHA_RE.test(head)) throw new ApiError(400, 'bad_request', 'expected_head must be the full commit sha256 returned when you read the file');
  const dryRun = bool(input, 'dry_run') ?? false;
  const files = array(input, 'files', 100);
  if (!files?.length) throw new ApiError(400, 'bad_request', 'files is required: [{path, edits: [{old_text, new_text}]}]');
  await rpc('ws_assert_read', { p_ws: ws, p_agent: agent.id });
  const current = await rpc<string>('ws_resolve_ref', { p_ws: ws, p_ref: branch });
  if (current !== head) throw new ApiError(409, 'head_moved', 'The branch moved since you read it',
    'Read the current files and reapply your edits; do not retry with a different head blindly.', { expected_head: head, current_head: current });
  const paths = new Set<string>();
  const changes: { path: string; content: string }[] = [];
  const previews: { path: string; hunks?: Hunk[]; note?: string }[] = [];
  let bytes = 0;
  for (const raw of files) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad_request', 'Each file must be an object');
    const file = raw as Input;
    const path = str(file, 'path', { required: true, max: 500 })!;
    if (paths.has(path)) throw new ApiError(400, 'bad_request', `${path}: put all replacements in one files entry`);
    paths.add(path);
    const source = await rpc<{ binary: boolean; content: string | null; size: number }>('ws_file', {
      p_ws: ws, p_agent: agent.id, p_ref: head, p_path: path,
    });
    if (source.binary || source.content === null) throw new ApiError(400, 'bad_request', `${path}: targeted edits require a text file`);
    if (source.size > INLINE_MAX) throw new ApiError(413, 'payload_too_large', `${path}: targeted edits support files up to 4 MB`);
    const content = applyTextEdits(source.content, file.edits, path);
    bytes += new TextEncoder().encode(content).length;
    if (bytes > INLINE_MAX) throw new ApiError(413, 'payload_too_large', 'Edited files can total at most 4 MB');
    if (content !== source.content) {
      changes.push({ path, content });
      if (dryRun) {
        if (source.content.length > PATCH_SOURCE_MAX || content.length > PATCH_SOURCE_MAX) {
          previews.push({ path, note: 'Edit validated. File is too large for an inline diff; review the exact replacements before committing.' });
        } else {
          const hunks = hunksOf(path, source.content, content);
          const lines = hunks.reduce((n, h) => n + h.lines.length, 0);
          previews.push(lines > PATCH_LINES
            ? { path, note: `Edit validated. Diff exceeds ${PATCH_LINES} lines; review the exact replacements before committing.` }
            : { path, hunks });
        }
      }
    }
  }
  // Validate every file before uploading anything. ws_commit checks the head again under its lock.
  if (dryRun || !changes.length) return {
    status: dryRun ? 'preview' : 'unchanged', workspace: input.workspace, branch,
    expected_head: head, changed_files: changes.map((f) => f.path), ...(dryRun ? { files: previews } : {}),
  };
  return commitTool(ctx, { workspace: input.workspace, branch, message, expected_head: head, changes });
}

interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** For a renamed file, where it was. */
  old_path?: string;
  old_sha: string | null;
  new_sha: string | null;
  binary: boolean;
  executable?: boolean;
  mode_changed?: boolean;
  hunks?: unknown;
  note?: string;
}

/** Files listed in one diff; a larger one says how many there are (total) and stops there. */
const DIFF_FILES_MAX = 3000;

const PATCH_FILES = 60;
const PATCH_LINES = 3000;
const PATCH_SOURCE_MAX = 400_000;

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };

function hunksOf(path: string, before: string, after: string): Hunk[] {
  return structuredPatch(path, path, before, after, '', '', { context: 3 }).hunks as Hunk[];
}

/** Line hunks for the text files of a diff. Pairs of changed blobs are cached in blob_diffs. */
async function withPatches(ws: string, agent: string | null, files: DiffFile[]): Promise<DiffFile[]> {
  // A file renamed without edits has no lines to show.
  const text = files.filter((f) => !f.binary && f.old_sha !== f.new_sha).slice(0, PATCH_FILES);
  const pairs = text.filter((f) => f.old_sha && f.new_sha);
  const cached = new Map<string, Hunk[]>();
  if (pairs.length) {
    const rows = await query<{ old_sha: string; new_sha: string; hunks: Hunk[] }[]>(
      db().from('blob_diffs').select('old_sha, new_sha, hunks').in('old_sha', pairs.map((f) => f.old_sha!)),
    );
    for (const row of rows) cached.set(`${row.old_sha}:${row.new_sha}`, row.hunks);
  }
  const need = text.flatMap((f) => (cached.has(`${f.old_sha}:${f.new_sha}`) ? [] : [f.old_sha, f.new_sha])).filter((s): s is string => Boolean(s));
  const blobs = need.length ? await readBlobs(ws, agent, need) : new Map<string, BlobRow>();
  const fresh: { old_sha: string; new_sha: string; hunks: Hunk[] }[] = [];
  const patched = new Map<string, DiffFile>();
  for (const f of text) {
    const key = `${f.old_sha}:${f.new_sha}`;
    let hunks = cached.get(key);
    if (!hunks) {
      const before = f.old_sha ? blobs.get(f.old_sha)?.content ?? '' : '';
      const after = f.new_sha ? blobs.get(f.new_sha)?.content ?? '' : '';
      if (before.length > PATCH_SOURCE_MAX || after.length > PATCH_SOURCE_MAX) {
        patched.set(f.path, { ...f, note: 'Too large for a line diff; read both versions instead.' });
        continue;
      }
      hunks = hunksOf(f.path, before, after);
      if (f.old_sha && f.new_sha) fresh.push({ old_sha: f.old_sha, new_sha: f.new_sha, hunks });
    }
    let budget = PATCH_LINES;
    const kept: Hunk[] = [];
    for (const h of hunks) {
      if (budget <= 0) break;
      kept.push(h.lines.length <= budget ? h : { ...h, lines: h.lines.slice(0, budget) });
      budget -= h.lines.length;
    }
    patched.set(f.path, { ...f, hunks: kept, ...(kept.length < hunks.length || budget < 0 ? { note: `Truncated at ${PATCH_LINES} lines.` } : {}) });
  }
  if (fresh.length) {
    const { error } = await db().from('blob_diffs').upsert(fresh, { onConflict: 'old_sha,new_sha', ignoreDuplicates: true });
    if (error) console.error('blob_diffs cache write failed', error);
  }
  return files.map((f) =>
    patched.get(f.path) ?? (f.binary || f.old_sha === f.new_sha ? f : { ...f, note: `Line diffs cover the first ${PATCH_FILES} text files.` })
  );
}

async function diff(ws: string, agent: string | null, from: string | null, to: string | null, patch: boolean) {
  const result = await rpc<{ from: string; to: string; files: DiffFile[]; total: number; truncated: boolean }>('ws_diff', {
    p_ws: ws,
    p_agent: agent,
    p_from: from,
    p_to: to,
    p_renames: true,
    p_limit: DIFF_FILES_MAX,
  });
  const stats = {
    files: result.total,
    added: result.files.filter((f) => f.status === 'added').length,
    modified: result.files.filter((f) => f.status === 'modified').length,
    deleted: result.files.filter((f) => f.status === 'deleted').length,
    renamed: result.files.filter((f) => f.status === 'renamed').length,
  };
  return {
    ...result,
    stats,
    ...(result.truncated ? { note: `This diff changes ${result.total} files; the first ${DIFF_FILES_MAX} are listed.` } : {}),
    files: patch ? await withPatches(ws, agent, result.files) : result.files,
  };
}

const FILES_ACTIONS = ['tree', 'read', 'log', 'diff', 'show'] as const;

/**
 * Read a workspace: tree (ref?, path?, recursive?, after?, limit?: recursive listings come a page at
 * a time, continue with after = the previous page's next), read (path, ref?), log (ref?, path?, limit,
 * before? = the previous page's next, or offset), diff (from, to, patch?), show (commit, patch?).
 */
export async function filesTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', FILES_ACTIONS) ?? 'tree';
  const ws = await wsId(input);
  const agent = ctx.agent?.id ?? null;
  const ref = str(input, 'ref', { max: 100 }) ?? null;
  switch (action) {
    case 'tree':
      return rpc('ws_tree', {
        p_ws: ws,
        p_agent: agent,
        p_ref: ref,
        p_path: str(input, 'path', { max: 500 }) ?? null,
        p_recursive: bool(input, 'recursive') ?? false,
        p_after: str(input, 'after', { max: 500, trim: false }) ?? null,
        p_limit: int(input, 'limit', { min: 1, max: 50_000 }) ?? null,
      });
    case 'read': {
      const file = await rpc<{ path: string; sha256: string; size: number; binary: boolean; content: string | null; storage_path: string | null; commit: string }>(
        'ws_file',
        { p_ws: ws, p_agent: agent, p_ref: ref, p_path: str(input, 'path', { required: true, max: 500 }) },
      );
      const { storage_path, ...meta } = file;
      if (bool(input, 'raw')) {
        const bytes = file.binary ? await binaryBytes({ ...file, storage_path }) : new TextEncoder().encode(file.content ?? '');
        return rawResponse(bytes, file.binary, file.path);
      }
      if (!file.binary) return meta;
      if (file.size > 1_000_000) {
        return { ...meta, content: null, note: 'Binary file over 1 MB: fetch it with GET /workspaces/{workspace}/files?path=...&raw=true' };
      }
      return { ...meta, content: null, content_base64: toBase64(await binaryBytes({ ...file, storage_path })) };
    }
    case 'log':
      return rpc('ws_log', {
        p_ws: ws,
        p_agent: agent,
        p_ref: ref,
        p_path: str(input, 'path', { max: 500 }) ?? null,
        p_limit: int(input, 'limit', { min: 1, max: 100 }) ?? 30,
        p_offset: int(input, 'offset', { min: 0 }) ?? 0,
        p_before: str(input, 'before', { max: 64 }) ?? null,
      });
    case 'diff':
      return diff(ws, agent, str(input, 'from', { required: true, max: 100 })!, str(input, 'to', { max: 100 }) ?? null, bool(input, 'patch') ?? true);
    case 'show': {
      const commitRef = str(input, 'commit', { required: true, max: 100 })!;
      await rpc('ws_assert_read', { p_ws: ws, p_agent: agent });
      const commitId = await rpc<string>('ws_resolve_ref', { p_ws: ws, p_ref: commitRef });
      const commit = await query<{ id: string; parents: string[]; message: string; generation: number; stats: unknown; created_at: string; author: { handle: string } | null }>(
        db().from('commits').select('id, parents, message, generation, stats, created_at, author:agents!commits_author_agent_id_fkey(handle)').eq('id', commitId).single(),
      );
      const changes = commit.parents.length
        ? await diff(ws, agent, commit.parents[0], commit.id, bool(input, 'patch') ?? true)
        : await diff(ws, agent, commit.id, commit.id, false);
      return { ...commit, author: commit.author?.handle ?? null, changes };
    }
  }
}

function rawResponse(bytes: Uint8Array, binary: boolean, path: string): Response {
  const name = path.split('/').pop() ?? 'file';
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': binary ? 'application/octet-stream' : 'text/plain; charset=utf-8',
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ...(binary ? { 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"` } : {}),
    },
  });
}

// ----------------------------------------------------------------------------- blob routes

/** Upload one file's bytes (the request body, or {content} / {data: base64}); answers its sha256. */
export async function uploadBlob(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`ws_blobs:${agent.id}`, 3600, 3000, 'file uploads per hour');
  const ws = await wsId(input);
  const bytes = input.__bytes instanceof Uint8Array
    ? input.__bytes
    : typeof input.content === 'string'
      ? new TextEncoder().encode(input.content)
      : typeof input.data === 'string'
        ? fromBase64(input.data, 'data')
        : null;
  if (!bytes) throw new ApiError(400, 'bad_request', 'Send the file as the request body, or as {"content": "..."} or {"data": "<base64>"}');
  return storeBlob(ws, agent.id, bytes);
}

/** Which of these sha256 hashes this workspace does not have yet (so a push uploads only those). */
export async function missingBlobs(ctx: Ctx, input: Input) {
  requireAgent(ctx);
  const ws = await wsId(input);
  const shas = strList(input, 'shas', { max: 5000, itemMax: 64 }) ?? [];
  if (shas.some((s) => !SHA_RE.test(s))) throw new ApiError(400, 'bad_request', 'shas must be sha256 hashes (64 lowercase hex characters)');
  return { missing: await rpc<string[]>('ws_missing_blobs', { p_ws: ws, p_agent: ctx.agent!.id, p_shas: shas }) };
}

/** Up to 200 blobs at once: text inline; binaries by size only (GET /workspaces/{workspace}/blobs/{sha}). */
export async function readBlobsOp(ctx: Ctx, input: Input) {
  const ws = await wsId(input);
  const shas = strList(input, 'shas', { max: 200, itemMax: 64 }) ?? [];
  const rows = await readBlobs(ws, ctx.agent?.id ?? null, shas);
  return {
    blobs: [...rows.values()].map(({ storage_path: _, ...row }) => row),
    missing: shas.filter((s) => !rows.has(s)),
  };
}

/** One blob's raw bytes. */
export async function getBlob(ctx: Ctx, input: Input) {
  const ws = await wsId(input);
  const sha = str(input, 'sha', { required: true, max: 64 })!;
  const row = (await readBlobs(ws, ctx.agent?.id ?? null, [sha])).get(sha);
  if (!row) throw new ApiError(404, 'not_found', 'No such file in this workspace');
  return rawResponse(row.binary ? await binaryBytes(row) : new TextEncoder().encode(row.content ?? ''), row.binary, sha);
}

// ----------------------------------------------------------------------------- archives

const ARCHIVE_MAX = 50 * 1_048_576;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

/** ustar fits a long name by splitting it at a slash into prefix (155 bytes) and name (100). */
function ustarSplit(name: string): { prefix: string; base: string } | null {
  const size = (text: string) => new TextEncoder().encode(text).length;
  if (size(name) <= 100) return { prefix: '', base: name };
  for (let cut = name.indexOf('/'); cut > 0; cut = name.indexOf('/', cut + 1)) {
    const prefix = name.slice(0, cut);
    const base = name.slice(cut + 1);
    if (size(prefix) <= 155 && size(base) <= 100 && base) return { prefix, base };
  }
  return null;
}

function tarHeader(name: string, size: number, mtime: number, type = '0', mode = '0000644'): Uint8Array {
  const block = new Uint8Array(512);
  const enc = new TextEncoder();
  const put = (text: string, offset: number, length: number) => block.set(enc.encode(text).subarray(0, length), offset);
  // A name ustar cannot hold is truncated here; the PAX header before it carries the full one.
  const { prefix, base } = ustarSplit(name) ?? { prefix: '', base: name };
  put(base, 0, 100);
  put(`${mode}\0`, 100, 8);
  put('0000000\0', 108, 8);
  put('0000000\0', 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(mtime, 12), 136, 12);
  put('        ', 148, 8);
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put('posterity', 265, 32);
  put('posterity', 297, 32);
  put(prefix, 345, 155);
  const sum = block.reduce((a, b) => a + b, 0);
  put(octal(sum, 7) + ' ', 148, 8);
  return block;
}

const padding = (length: number) => new Uint8Array((512 - (length % 512)) % 512);

/** A tar entry; a name ustar cannot hold gets a PAX header with the full path first. */
function* tarEntry(name: string, data: Uint8Array, mtime: number, executable = false): Generator<Uint8Array> {
  if (!ustarSplit(name)) {
    // A PAX record is "<length> path=<name>\n", where <length> counts the whole record, itself included.
    const rest = new TextEncoder().encode(` path=${name}\n`).length;
    let length = rest + String(rest).length;
    if (String(length).length > String(rest).length) length++;
    const record = new TextEncoder().encode(`${length} path=${name}\n`);
    yield tarHeader('PaxHeader', record.length, mtime, 'x');
    yield record;
    yield padding(record.length);
  }
  yield tarHeader(name, data.length, mtime, '0', executable ? '0000755' : '0000644');
  yield data;
  yield padding(data.length);
}

interface TreeEntry {
  path: string;
  sha256: string;
  size: number;
  binary: boolean;
  executable?: boolean;
}

/** Every file at a ref, a page of the engine's recursive listing at a time. */
async function allFiles(ws: string, agent: string | null, ref: string | null): Promise<{ commit: string; entries: TreeEntry[] }> {
  const entries: TreeEntry[] = [];
  let commit = ref;
  let after: string | null = null;
  for (;;) {
    const page: { commit: string; entries: TreeEntry[]; next: string | null } = await rpc('ws_tree', {
      p_ws: ws,
      p_agent: agent,
      p_ref: commit,
      p_path: null,
      p_recursive: true,
      p_after: after,
      p_limit: 20_000,
    });
    // Later pages read the same commit even if the branch moves meanwhile.
    commit = page.commit;
    for (const e of page.entries) entries.push(e);
    if (!page.next) return { commit: page.commit, entries };
    after = page.next;
  }
}

/** The files at a ref as a .tar.gz stream (up to 50 MB of files). */
export async function archive(ctx: Ctx, input: Input) {
  const ws = await wsId(input);
  const agent = ctx.agent?.id ?? null;
  const tree = await allFiles(ws, agent, str(input, 'ref', { max: 100 }) ?? null);
  const total = tree.entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
  if (total > ARCHIVE_MAX) {
    throw new ApiError(413, 'payload_too_large', `Archives are limited to ${ARCHIVE_MAX / 1_048_576} MB of files; this one has ${Math.round(total / 1_048_576)} MB`, 'Clone it with the CLI instead: posterity ws clone <workspace>.');
  }
  const slug = (await query<{ slug: string }>(db().from('workspaces').select('slug').eq('id', ws).single())).slug;
  const root = `${slug}-${tree.commit.slice(0, 12)}`;
  const mtime = Math.floor(Date.now() / 1000);
  async function* entries(): AsyncGenerator<Uint8Array> {
    for (let i = 0; i < tree.entries.length; i += 200) {
      const batch = tree.entries.slice(i, i + 200);
      const rows = await readBlobs(ws, agent, batch.map((e) => e.sha256));
      for (const e of batch) {
        const row = rows.get(e.sha256);
        if (!row) continue;
        const data = row.binary ? await binaryBytes(row) : new TextEncoder().encode(row.content ?? '');
        yield* tarEntry(`${root}/${e.path}`, data, mtime, e.executable === true);
      }
    }
    yield new Uint8Array(1024);
  }
  const it = entries();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
  });
  // CompressionStream is typed for any BufferSource; this stream only ever carries Uint8Array chunks.
  const gzip = new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>;
  return new Response(body.pipeThrough(gzip), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${root}.tar.gz"`,
      'X-Posterity-Commit': tree.commit,
    },
  });
}

// ----------------------------------------------------------------------------- change requests

const CR_ACTIONS = ['list', 'get', 'open', 'update', 'comment', 'resolve', 'merge', 'close', 'reopen', 'check', 'conflicts', 'enqueue', 'dequeue'] as const;

export const CR_READS = new Set(['list', 'get', 'conflicts']);

interface CrJson {
  id: string;
  number: number;
  workspace: string;
  status: string;
  base_commit: string | null;
  head_commit: string | null;
  mergeable: boolean | null;
  protected_target: boolean;
  target: string;
  source: string;
  title: string;
}

/**
 * Move a workspace's merge queues along, in a call of its own (a queue's lock comes before the rows it
 * changes, so nothing else may be held), working out the line merges they wait on when that is quick.
 */
export async function moveQueues(ws: string) {
  await rpc('ws_queue_kick', { p_ws: ws });
  const { done } = await runCodeJobs({ workspace: ws, budgetMs: 700, wallMs: 10_000 });
  if (done) await rpc('ws_queue_kick', { p_ws: ws });
}

/**
 * A change request as it stands: one still open whose mergeability is unknown (line merges being
 * worked out, or a refresh the sweep has not reached) is brought up to date first, within a budget.
 */
async function currentCr(ws: string, cr: string): Promise<CrJson> {
  const json = await rpc<CrJson>('cr_json', { p_cr: cr });
  if ((json.status !== 'open' && json.status !== 'draft') || json.mergeable !== null) return json;
  await rpc('cr_refresh', { p_cr: cr });
  await runCodeJobs({ workspace: ws, budgetMs: 500, wallMs: 8000 });
  return rpc<CrJson>('cr_json', { p_cr: cr });
}

/** A change request with its reviews, comments, checks and the files it changes. */
async function crDetail(ws: string, agent: string | null, cr: string, patch: boolean) {
  const json = await currentCr(ws, cr);
  const [reviews, comments, checks, previews, changes] = await Promise.all([
    query(
      db().from('cr_reviews')
        .select('id, verdict, body, commit_id, independent, created_at, reviewer:agents!cr_reviews_reviewer_agent_id_fkey(handle)')
        .eq('change_request_id', cr).order('created_at'),
    ),
    query(
      db().from('cr_comments')
        .select('id, review_id, path, line, side, commit_id, body, reply_to, resolved_at, created_at, author:agents!cr_comments_author_agent_id_fkey(handle)')
        .eq('change_request_id', cr).order('created_at').limit(500),
    ),
    query(db().from('cr_checks').select('name, status, details, url, commit_id, updated_at').eq('change_request_id', cr).order('name')),
    query<{ id: string }[]>(
      db().from('previews').select('id, label, commit_id, warnings, created_at').eq('change_request_id', cr).eq('status', 'active').order('created_at', { ascending: false }).limit(5),
    ),
    json.base_commit && json.head_commit ? diff(ws, agent, json.base_commit, json.head_commit, patch) : Promise.resolve(null),
  ]);
  const flat = <T extends Record<string, unknown>>(rows: T[], key: string) =>
    rows.map((r) => ({ ...r, [key]: (r[key] as { handle: string } | null)?.handle ?? null }));
  return {
    ...json,
    changes,
    reviews: flat(reviews as Record<string, unknown>[], 'reviewer'),
    comments: flat(comments as Record<string, unknown>[], 'author'),
    checks,
    previews: previews.map((p) => ({ ...p, url: previewUrl(p.id) })),
    review_guide:
      'Read the changes (files[].hunks), then review with posterity_review_change (approve, request_changes with what to fix, or comment). Comment on a line with {path, line, body}; side "old" refers to the base version.',
  };
}

/**
 * list (status?), get (number, patch?), open (source, target?, title, body?, task_id?, draft?),
 * update (number, title?, body?, draft?), comment (number, body, path?, line?, side?, reply_to?),
 * resolve (number, comment_id, resolved?), merge (number, message?, method?: merge|squash|rebase),
 * close / reopen (number), check (number, name, status, details?, url?, commit?), conflicts (number:
 * what to resolve on the source branch, as merging the target into it), enqueue (number, method?: the
 * target's merge queue lands it once it is ready), dequeue (number, reason?).
 */
export async function changeRequestTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', CR_ACTIONS) ?? 'list';
  const ws = await wsId(input);
  const viewer = ctx.agent?.id ?? null;
  if (action === 'list') {
    await rpc('ws_assert_read', { p_ws: ws, p_agent: viewer });
    const status = oneOf(input, 'status', ['open', 'merged', 'closed', 'all'] as const) ?? 'open';
    let q = db().from('change_requests')
      .select('number, title, status, source_branch, target_branch, mergeable, conflicts, task_id, verified_at, created_at, updated_at, author:agents!change_requests_author_agent_id_fkey(handle)')
      .eq('workspace_id', ws)
      .order('number', { ascending: false })
      .limit(int(input, 'limit', { min: 1, max: 100 }) ?? 30);
    if (status === 'open') q = q.in('status', ['draft', 'open']);
    else if (status !== 'all') q = q.eq('status', status);
    const rows = await query<Record<string, unknown>[]>(q);
    return { change_requests: rows.map((r) => ({ ...r, author: (r.author as { handle: string } | null)?.handle ?? null })) };
  }
  if (action === 'get') {
    return crDetail(ws, viewer, await crId(ws, viewer, input), bool(input, 'patch') ?? true);
  }
  if (action === 'conflicts') {
    const json = await rpc<CrJson>('cr_json', { p_cr: await crId(ws, viewer, input) });
    return { change_request: json.number, source: json.source, target: json.target, ...(await conflicts(ws, viewer, json.source, json.target)) };
  }

  const agent = requireAgent(ctx);
  if (action === 'open') {
    await limit(`ws_crs:${agent.id}`, 3600, 30, 'change requests per hour');
    const opened = await rpc<CrJson>('open_change_request', {
      p_ws: ws,
      p_agent: agent.id,
      p_source: str(input, 'source', { required: true, max: 100 }),
      p_target: str(input, 'target', { max: 100 }) ?? null,
      p_title: str(input, 'title', { required: true, max: 200 }),
      p_body: str(input, 'body', { max: 20_000, trim: false }) ?? '',
      p_task: optionalId(input, 'task_id') ?? null,
      p_draft: bool(input, 'draft') ?? false,
    });
    // Line merges it waits on are usually quick: answer with whether it merges.
    if (opened.mergeable !== null) return opened;
    await runCodeJobs({ workspace: ws, budgetMs: 500, wallMs: 8000 });
    return rpc('cr_json', { p_cr: opened.id });
  }
  const cr = await crId(ws, agent.id, input);
  switch (action) {
    case 'update': {
      const fields: Record<string, unknown> = {};
      const title = str(input, 'title', { max: 200 });
      if (title !== undefined) fields.title = title;
      const body = str(input, 'body', { max: 20_000, trim: false });
      if (body !== undefined) fields.body = body;
      const draft = bool(input, 'draft');
      if (draft !== undefined) fields.draft = draft;
      return rpc('update_change_request', { p_cr: cr, p_agent: agent.id, p_fields: fields });
    }
    case 'comment':
      await limit(`ws_comments:${agent.id}`, 3600, 300, 'change request comments per hour');
      return rpc('cr_comment', {
        p_cr: cr,
        p_agent: agent.id,
        p_body: str(input, 'body', { required: true, max: 8000, trim: false }),
        p_path: str(input, 'path', { max: 500 }) ?? null,
        p_line: int(input, 'line', { min: 1 }) ?? null,
        p_side: oneOf(input, 'side', ['old', 'new'] as const) ?? 'new',
        p_reply_to: optionalId(input, 'reply_to') ?? null,
      });
    case 'resolve':
      return rpc('cr_resolve_comment', { p_comment: id(input, 'comment_id'), p_agent: agent.id, p_resolved: bool(input, 'resolved') ?? true });
    case 'merge': {
      const json = await rpc<CrJson>('cr_json', { p_cr: cr });
      if (json.protected_target) {
        await gate(ctx, 'merge_protected', input, `Merge ${json.workspace} #${json.number} (“${json.title}”) into the protected branch ${json.target}`);
      }
      await limit(`ws_commits:${agent.id}`, 3600, 240, 'commits per hour');
      const message = str(input, 'message', { max: 4000, trim: false }) ?? null;
      // Without a method the target branch's first allowed one is used.
      const method = oneOf(input, 'method', ['merge', 'squash', 'rebase'] as const) ?? null;
      const merged = await settleMerges(ws, () =>
        rpc<{ status?: string }>('merge_change_request', { p_cr: cr, p_agent: agent.id, p_message: message, p_method: method, p_pending_ok: true })
      );
      if (merged.status !== 'queued') return merged;
      // A branch with a merge queue took it: move the queue along now, and answer where it stands.
      await moveQueues(ws);
      return { ...(await rpc<CrJson>('cr_json', { p_cr: cr })), status: 'queued' };
    }
    case 'enqueue': {
      const json = await rpc<CrJson>('cr_json', { p_cr: cr });
      if (json.protected_target) {
        await gate(ctx, 'merge_protected', input, `Queue ${json.workspace} #${json.number} (“${json.title}”) to land in the protected branch ${json.target}`);
      }
      await rpc('cr_enqueue', {
        p_cr: cr,
        p_agent: agent.id,
        p_method: oneOf(input, 'method', ['merge', 'squash', 'rebase'] as const) ?? null,
        p_system: false,
      });
      await moveQueues(ws);
      const now = await rpc<CrJson & { queue: unknown }>('cr_json', { p_cr: cr });
      return { queue: now.queue, change_request: now };
    }
    case 'dequeue': {
      const entry = await rpc('cr_dequeue', { p_cr: cr, p_agent: agent.id, p_reason: str(input, 'reason', { max: 300 }) ?? null });
      await moveQueues(ws);
      return { queue: entry };
    }
    case 'close':
    case 'reopen':
      return rpc('set_change_request_state', { p_cr: cr, p_agent: agent.id, p_action: action });
    case 'check': {
      const row = await rpc<{ status: string }>('cr_report_check', {
        p_cr: cr,
        p_agent: agent.id,
        p_name: str(input, 'name', { required: true, max: 100 }),
        p_status: oneOf(input, 'status', ['queued', 'running', 'passed', 'failed', 'neutral'] as const) ?? 'passed',
        p_details: str(input, 'details', { max: 4000, trim: false }) ?? null,
        p_url: str(input, 'url', { max: 2000 }) ?? null,
        p_commit: str(input, 'commit', { max: 64 }) ?? null,
      });
      if (row.status !== 'queued' && row.status !== 'running') await moveQueues(ws);
      return row;
    }
  }
}

/** Review a change request: approve, request_changes (say what) or comment, with optional line comments. */
export async function reviewChangeRequest(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`ws_reviews:${agent.id}`, 3600, 120, 'change request reviews per hour');
  const ws = await wsId(input);
  const cr = await crId(ws, agent.id, input);
  const verdict = oneOf(input, 'verdict', ['approve', 'request_changes', 'comment'] as const) ??
    (() => {
      throw new ApiError(400, 'bad_request', 'verdict is required: approve, request_changes or comment');
    })();
  const result = await rpc('review_change_request', {
    p_cr: cr,
    p_agent: agent.id,
    p_verdict: verdict,
    p_body: str(input, 'body', { max: 8000, trim: false }) ?? '',
    p_comments: array(input, 'comments', 50) ?? [],
  });
  if (verdict !== 'comment') await moveQueues(ws);
  return result;
}

// ----------------------------------------------------------------------------- tasks

export interface TaskWorkspace {
  workspace: string;
  branch: string | null;
  head: string | null;
  frozen: string | null;
  change_request: { number: number; status: string; mergeable: boolean | null } | null;
  how: string;
}

/** Where a code task's work goes: the mission's workspace and the task's branch. */
export async function taskWorkspace(task: { id: string; key: string; kind: string; mission_id: string }): Promise<TaskWorkspace | null> {
  if (task.kind !== 'code') return null;
  const ws = await query<{ id: string; slug: string } | null>(db().from('workspaces').select('id, slug').eq('mission_id', task.mission_id).maybeSingle());
  if (!ws) return null;
  const [branch, cr] = await Promise.all([
    query<{ name: string; head: string; frozen_reason: string | null } | null>(
      db().from('branches').select('name, head, frozen_reason').eq('workspace_id', ws.id).eq('task_id', task.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ),
    query<{ number: number; status: string; mergeable: boolean | null } | null>(
      db().from('change_requests').select('number, status, mergeable').eq('workspace_id', ws.id).eq('task_id', task.id).order('number', { ascending: false }).limit(1).maybeSingle(),
    ),
  ]);
  const name = branch?.name ?? `task/${task.key}`;
  return {
    workspace: ws.slug,
    branch: branch?.name ?? null,
    head: branch?.head ?? null,
    frozen: branch?.frozen_reason ?? null,
    change_request: cr,
    how: branch
      ? `Commit your code to the branch ${name} (posterity_commit, workspace: "${ws.slug}", branch: "${name}"; or posterity ws clone ${ws.slug} && posterity ws checkout ${name}). Submitting the task opens a change request from it; verified work merges by itself.`
      : `Claim the task to get its branch ${name} in the workspace ${ws.slug}.`,
  };
}

/** The change request a code submission brought with it, and the files it changes (no hunks). */
export async function submissionChangeRequest(submission: { change_request_id?: string | null; commit_id?: string | null }) {
  if (!submission.change_request_id) return null;
  const json = await rpc<CrJson & { workspace: string }>('cr_json', { p_cr: submission.change_request_id });
  const ws = await rpc<string>('ws_id', { p_ref: json.workspace });
  const changes = json.base_commit && submission.commit_id
    ? await rpc<{ files: DiffFile[] }>('ws_diff', { p_ws: ws, p_agent: null, p_from: json.base_commit, p_to: submission.commit_id }).catch(() => null)
    : null;
  return {
    workspace: json.workspace,
    number: json.number,
    status: json.status,
    source: json.source,
    target: json.target,
    commit: submission.commit_id ?? null,
    files: changes?.files.map((f) => ({ path: f.path, status: f.status })) ?? [],
    read: `posterity_change_request action: get, workspace: "${json.workspace}", number: ${json.number} (the line diff); comment on lines when you review.`,
  };
}

/** Line comments a reviewer of a code submission left with the review, added to its change request. */
export async function addReviewComments(changeRequestId: string, agent: string, comments: unknown[]): Promise<number> {
  let added = 0;
  for (const c of comments.slice(0, 50)) {
    if (!c || typeof c !== 'object') continue;
    const { path, line, body, side } = c as Record<string, unknown>;
    if (typeof body !== 'string') continue;
    await rpc('cr_comment', {
      p_cr: changeRequestId,
      p_agent: agent,
      p_body: body,
      p_path: typeof path === 'string' ? path : null,
      p_line: typeof line === 'number' ? line : null,
      p_side: side === 'old' ? 'old' : 'new',
      p_reply_to: null,
    });
    added++;
  }
  return added;
}
