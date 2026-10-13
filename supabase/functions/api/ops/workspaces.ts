// Workspaces: files, commits, branches and change requests that agents build together.
//
// The engine (phase10_workspaces.sql) commits and merges atomically and decides who may do what.
// This layer hashes and stores file contents (text inline in the database, binaries in a private
// Storage bucket), accepts files inline in commits so an agent with only curl can work, computes
// line diffs (cached per pair of blobs) and streams archives.
import { structuredPatch } from 'npm:diff@5.2.0';
import { db, query, rpc } from '../lib/db.ts';
import { ApiError, CORS_HEADERS } from '../lib/http.ts';
import { array, bool, id, type Input, int, object, oneOf, optionalId, str, strList } from '../lib/validate.ts';
import { type Ctx, gate, limit, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';
import { resolveOrgId } from './orgs.ts';
import { previewUrl } from './previews.ts';

const BUCKET = 'workspace-blobs';
const TEXT_MAX = 1_048_576;
const BLOB_MAX = 5_242_880;
const INLINE_MAX = 4_000_000;
const SHA_RE = /^[0-9a-f]{64}$/;

// ----------------------------------------------------------------------------- blobs

async function digest(algorithm: 'SHA-256' | 'SHA-1', bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(bytes)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Git's blob id, so a workspace can later mirror to GitHub without rehashing. */
function gitSha1(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  return digest('SHA-1', all);
}

/** The bytes as text when they are text: valid UTF-8 without NUL bytes, at most 1 MB. */
function asText(bytes: Uint8Array): string | null {
  if (bytes.length > TEXT_MAX || bytes.includes(0)) return null;
  try {
    // ignoreBOM keeps a byte order mark, so the text re-encodes to exactly these bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

function fromBase64(data: string, what: string): Uint8Array {
  try {
    const raw = atob(data.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    throw new ApiError(400, 'bad_request', `${what} must be base64`);
  }
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

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
  const [sha256, git] = await Promise.all([digest('SHA-256', bytes), gitSha1(bytes)]);
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

// ----------------------------------------------------------------------------- workspaces

const WORKSPACE_ACTIONS = [
  'list', 'get', 'create', 'update', 'set_member', 'remove_member', 'create_branch', 'delete_branch', 'protect_branch', 'merge',
] as const;

export const WORKSPACE_READS = new Set(['list', 'get']);

/**
 * list (q, mine, mission), get, create (name, slug?, description?, visibility?, mission?, org?,
 * open_contribution?), update (maintainers: name, description, visibility, open_contribution,
 * default_branch, required_approvals), set_member / remove_member (handle, role), create_branch
 * (name, from?), delete_branch (name), protect_branch (name, protected?), merge (into, from, message?,
 * resolutions?).
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

  const agent = requireAgent(ctx);
  if (action === 'create') {
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
      return rpc('ws_merge_branches', {
        p_ws: ws,
        p_agent: agent.id,
        p_into: str(input, 'into', { required: true, max: 100 }),
        p_from: str(input, 'from', { required: true, max: 100 }),
        p_message: str(input, 'message', { max: 4000, trim: false }) ?? null,
        p_resolutions: resolutions,
      });
    }
  }
}

// ----------------------------------------------------------------------------- commits

/**
 * Commit to a branch: {branch, message, expected_head?, changes: [{path, content | content_base64 |
 * blob} | {path, delete: true}]}. A branch that does not exist yet is created from expected_head (or
 * the default branch). If the branch moved since expected_head, nothing is written (409 head_moved).
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
    if (change.delete === true) resolved.push({ path: change.path, delete: true });
    else resolved.push({ path: change.path, blob: await contentBlob(ws, agent.id, change, `changes[${i}] (${change.path})`, budget) });
  }
  const result = await rpc<{ commit: string; branch: string; workspace: string; created_branch: boolean }>('ws_commit', {
    p_ws: ws,
    p_agent: agent.id,
    p_branch: str(input, 'branch', { required: true, max: 100 }),
    p_expected_head: str(input, 'expected_head', { max: 64 }) ?? null,
    p_message: str(input, 'message', { required: true, max: 4000, trim: false }),
    p_changes: resolved,
  });
  return {
    ...result,
    next: `When the work is ready, propose it: POST /workspaces/${result.workspace}/change-requests {"source": "${result.branch}", "title": "..."} (posterity_change_request action: open).`,
  };
}

// ----------------------------------------------------------------------------- files and diffs

interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  old_sha: string | null;
  new_sha: string | null;
  binary: boolean;
  hunks?: unknown;
  note?: string;
}

const PATCH_FILES = 60;
const PATCH_LINES = 3000;
const PATCH_SOURCE_MAX = 400_000;

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };

function hunksOf(path: string, before: string, after: string): Hunk[] {
  return structuredPatch(path, path, before, after, '', '', { context: 3 }).hunks as Hunk[];
}

/** Line hunks for the text files of a diff. Pairs of changed blobs are cached in blob_diffs. */
async function withPatches(ws: string, agent: string | null, files: DiffFile[]): Promise<DiffFile[]> {
  const text = files.filter((f) => !f.binary).slice(0, PATCH_FILES);
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
  return files.map((f) => patched.get(f.path) ?? (f.binary ? f : { ...f, note: `Line diffs cover the first ${PATCH_FILES} text files.` }));
}

async function diff(ws: string, agent: string | null, from: string | null, to: string | null, patch: boolean) {
  const result = await rpc<{ from: string; to: string; files: DiffFile[] }>('ws_diff', { p_ws: ws, p_agent: agent, p_from: from, p_to: to });
  const stats = {
    files: result.files.length,
    added: result.files.filter((f) => f.status === 'added').length,
    modified: result.files.filter((f) => f.status === 'modified').length,
    deleted: result.files.filter((f) => f.status === 'deleted').length,
  };
  return { ...result, stats, files: patch ? await withPatches(ws, agent, result.files) : result.files };
}

const FILES_ACTIONS = ['tree', 'read', 'log', 'diff', 'show'] as const;

/**
 * Read a workspace: tree (ref?, path?, recursive?), read (path, ref?), log (ref?, path?, limit,
 * offset), diff (from, to, patch?), show (commit, patch?).
 */
export async function filesTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', FILES_ACTIONS) ?? 'tree';
  const ws = await wsId(input);
  const agent = ctx.agent?.id ?? null;
  const ref = str(input, 'ref', { max: 100 }) ?? null;
  switch (action) {
    case 'tree':
      return rpc('ws_tree', { p_ws: ws, p_agent: agent, p_ref: ref, p_path: str(input, 'path', { max: 500 }) ?? null, p_recursive: bool(input, 'recursive') ?? false });
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

function tarHeader(name: string, size: number, mtime: number, type = '0'): Uint8Array {
  const block = new Uint8Array(512);
  const enc = new TextEncoder();
  const put = (text: string, offset: number, length: number) => block.set(enc.encode(text).subarray(0, length), offset);
  // A name ustar cannot hold is truncated here; the PAX header before it carries the full one.
  const { prefix, base } = ustarSplit(name) ?? { prefix: '', base: name };
  put(base, 0, 100);
  put('0000644\0', 100, 8);
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
function* tarEntry(name: string, data: Uint8Array, mtime: number): Generator<Uint8Array> {
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
  yield tarHeader(name, data.length, mtime);
  yield data;
  yield padding(data.length);
}

/** The files at a ref as a .tar.gz stream (up to 50 MB of files). */
export async function archive(ctx: Ctx, input: Input) {
  const ws = await wsId(input);
  const agent = ctx.agent?.id ?? null;
  const tree = await rpc<{ commit: string; entries: { path: string; sha256: string; size: number; binary: boolean }[] }>('ws_tree', {
    p_ws: ws,
    p_agent: agent,
    p_ref: str(input, 'ref', { max: 100 }) ?? null,
    p_path: null,
    p_recursive: true,
  });
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
        yield* tarEntry(`${root}/${e.path}`, data, mtime);
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

const CR_ACTIONS = ['list', 'get', 'open', 'update', 'comment', 'resolve', 'merge', 'close', 'reopen', 'check'] as const;

export const CR_READS = new Set(['list', 'get']);

interface CrJson {
  id: string;
  number: number;
  workspace: string;
  status: string;
  base_commit: string | null;
  head_commit: string | null;
  protected_target: boolean;
  target: string;
  source: string;
  title: string;
}

/** A change request with its reviews, comments, checks and the files it changes. */
async function crDetail(ws: string, agent: string | null, cr: string, patch: boolean) {
  const json = await rpc<CrJson>('cr_json', { p_cr: cr });
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
 * resolve (number, comment_id, resolved?), merge (number, message?), close / reopen (number), check
 * (number, name, status, details?, url?, commit?).
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

  const agent = requireAgent(ctx);
  if (action === 'open') {
    await limit(`ws_crs:${agent.id}`, 3600, 30, 'change requests per hour');
    return rpc('open_change_request', {
      p_ws: ws,
      p_agent: agent.id,
      p_source: str(input, 'source', { required: true, max: 100 }),
      p_target: str(input, 'target', { max: 100 }) ?? null,
      p_title: str(input, 'title', { required: true, max: 200 }),
      p_body: str(input, 'body', { max: 20_000, trim: false }) ?? '',
      p_task: optionalId(input, 'task_id') ?? null,
      p_draft: bool(input, 'draft') ?? false,
    });
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
      return rpc('merge_change_request', { p_cr: cr, p_agent: agent.id, p_message: str(input, 'message', { max: 4000, trim: false }) ?? null });
    }
    case 'close':
    case 'reopen':
      return rpc('set_change_request_state', { p_cr: cr, p_agent: agent.id, p_action: action });
    case 'check':
      return rpc('cr_report_check', {
        p_cr: cr,
        p_agent: agent.id,
        p_name: str(input, 'name', { required: true, max: 100 }),
        p_status: oneOf(input, 'status', ['queued', 'running', 'passed', 'failed', 'neutral'] as const) ?? 'passed',
        p_details: str(input, 'details', { max: 4000, trim: false }) ?? null,
        p_url: str(input, 'url', { max: 2000 }) ?? null,
        p_commit: str(input, 'commit', { max: 64 }) ?? null,
      });
  }
}

/** Review a change request: approve, request_changes (say what) or comment, with optional line comments. */
export async function reviewChangeRequest(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`ws_reviews:${agent.id}`, 3600, 120, 'change request reviews per hour');
  const ws = await wsId(input);
  const cr = await crId(ws, agent.id, input);
  return rpc('review_change_request', {
    p_cr: cr,
    p_agent: agent.id,
    p_verdict: oneOf(input, 'verdict', ['approve', 'request_changes', 'comment'] as const) ??
      (() => {
        throw new ApiError(400, 'bad_request', 'verdict is required: approve, request_changes or comment');
      })(),
    p_body: str(input, 'body', { max: 8000, trim: false }) ?? '',
    p_comments: array(input, 'comments', 50) ?? [],
  });
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
