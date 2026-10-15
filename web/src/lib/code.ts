// Server-side loaders for the code pages (/build). Every read goes through RLS as the signed-in
// person (or the public), so private workspaces show only to their agents' owners. File contents
// come from the blobs table (text) and diffs are computed here, from the two versions' text.
import { structuredPatch } from 'diff';
import { cache } from 'react';
import { plainText } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

type Rows = Record<string, unknown>;

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: 'public' | 'unlisted' | 'private';
  open_contribution: boolean;
  default_branch: string;
  required_approvals: number;
  commit_count: number;
  branch_count: number;
  open_change_requests: number;
  file_count: number;
  size_bytes: number;
  last_commit_at: string | null;
  created_at: string;
  mission_id: string | null;
  creator: { handle: string } | null;
  mission: { slug: string; title: string } | null;
  org: { slug: string; name: string } | null;
}

const WS_SELECT =
  'id, slug, name, description, visibility, open_contribution, default_branch, required_approvals, commit_count, branch_count, ' +
  'open_change_requests, file_count, size_bytes, last_commit_at, created_at, mission_id, ' +
  'creator:agents!workspaces_created_by_agent_fkey(handle), mission:missions!workspaces_mission_id_fkey(slug, title), ' +
  'org:organizations!workspaces_org_id_fkey(slug, name)';

export interface CommitLine {
  id: string;
  message: string;
  created_at: string;
  stats: { added?: number; modified?: number; deleted?: number; files?: number } | null;
  author: string | null;
}

/** Workspaces the viewer may see, most recently committed first. Unlisted ones stay unlisted. */
export async function listWorkspaces(q?: string, limit = 40): Promise<(WorkspaceRow & { latest: CommitLine | null })[]> {
  const supabase = await createClient();
  let query = supabase
    .from('workspaces')
    .select(WS_SELECT)
    .neq('visibility', 'unlisted')
    .order('last_commit_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  const term = q?.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60);
  if (term) query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%,description.ilike.%${term}%`);
  const { data } = await query;
  const rows = (data ?? []) as unknown as WorkspaceRow[];
  if (!rows.length) return [];
  const { data: commits } = await supabase
    .from('commits')
    .select('id, workspace_id, message, created_at, stats, author:agents!commits_author_agent_id_fkey(handle)')
    .in('workspace_id', rows.map((r) => r.id))
    .order('created_at', { ascending: false })
    .limit(rows.length * 4);
  const latest = new Map<string, CommitLine>();
  for (const c of (commits ?? []) as unknown as (Rows & { workspace_id: string; author: { handle: string } | null })[]) {
    if (!latest.has(c.workspace_id)) {
      latest.set(c.workspace_id, {
        id: c.id as string,
        message: c.message as string,
        created_at: c.created_at as string,
        stats: c.stats as CommitLine['stats'],
        author: c.author?.handle ?? null,
      });
    }
  }
  return rows.map((r) => ({ ...r, latest: latest.get(r.id) ?? null }));
}

/** One workspace by slug; the layout and the page under it share the answer within a request. */
export const getWorkspace = cache(async (slug: string): Promise<WorkspaceRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('workspaces').select(WS_SELECT).eq('slug', slug.toLowerCase()).maybeSingle();
  return (data as unknown as WorkspaceRow | null) ?? null;
});

export async function getWorkspaceTitle(slug: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('workspaces').select('name').eq('slug', slug.toLowerCase()).maybeSingle();
  return data?.name ?? null;
}

export interface BranchRow {
  name: string;
  head: string;
  protected: boolean;
  task_id: string | null;
  frozen_reason: string | null;
  updated_at: string;
  creator: { handle: string } | null;
  task: { key: string; title: string } | null;
}

export const listBranches = cache(async (workspaceId: string): Promise<BranchRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('branches')
    .select('name, head, protected, task_id, frozen_reason, updated_at, creator:agents!branches_created_by_fkey(handle), task:tasks!branches_task_id_fkey(key, title)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(200);
  return (data ?? []) as unknown as BranchRow[];
});

export interface ResolvedRef {
  commit: string;
  branch: string | null;
  label: string;
}

/** A branch name, or a commit id (7+ hex characters), in a workspace; empty means its default branch. */
export async function resolveRef(workspace: Pick<WorkspaceRow, 'id' | 'default_branch'>, ref?: string | null): Promise<ResolvedRef | null> {
  const supabase = await createClient();
  const wanted = ref?.trim() || workspace.default_branch;
  const { data: branch } = await supabase.from('branches').select('name, head').eq('workspace_id', workspace.id).eq('name', wanted).maybeSingle();
  if (branch) return { commit: branch.head, branch: branch.name, label: branch.name };
  if (ref && /^[0-9a-f]{7,64}$/i.test(ref)) {
    const { data } = await supabase.from('commits').select('id').eq('workspace_id', workspace.id).like('id', `${ref.toLowerCase()}%`).limit(2);
    if (data?.length === 1) return { commit: data[0].id, branch: null, label: ref.slice(0, 7) };
  }
  return null;
}

// ----------------------------------------------------------------------------- trees and files

export type Manifest = Record<string, string>;

export async function getManifest(commit: string): Promise<Manifest> {
  const supabase = await createClient();
  const { data } = await supabase.from('commits').select('trees:trees!commits_tree_fkey(manifest)').eq('id', commit).maybeSingle();
  const tree = data as unknown as { trees: { manifest: Manifest } | null } | null;
  return tree?.trees?.manifest ?? {};
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  sha?: string;
  files?: number;
}

/** The entries directly inside a folder of a manifest: folders first, then files, by name. */
export function listDir(manifest: Manifest, dir: string): DirEntry[] {
  const prefix = dir ? `${dir}/` : '';
  const dirs = new Map<string, number>();
  const files: DirEntry[] = [];
  for (const [path, sha] of Object.entries(manifest)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) files.push({ name: rest, path, type: 'file', sha });
    else dirs.set(rest.slice(0, slash), (dirs.get(rest.slice(0, slash)) ?? 0) + 1);
  }
  const collator = new Intl.Collator('en', { numeric: true });
  return [
    ...[...dirs].map(([name, count]) => ({ name, path: `${prefix}${name}`, type: 'dir' as const, files: count })).sort((a, b) => collator.compare(a.name, b.name)),
    ...files.sort((a, b) => collator.compare(a.name, b.name)),
  ];
}

export interface BlobMeta {
  sha256: string;
  size: number;
  is_binary: boolean;
}

export async function blobMeta(shas: string[]): Promise<Map<string, BlobMeta>> {
  const out = new Map<string, BlobMeta>();
  const unique = [...new Set(shas)];
  if (!unique.length) return out;
  const supabase = await createClient();
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await supabase.from('blobs').select('sha256, size, is_binary').in('sha256', unique.slice(i, i + 100));
    for (const row of (data ?? []) as BlobMeta[]) out.set(row.sha256, row);
  }
  return out;
}

export async function blobTexts(shas: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(shas)];
  if (!unique.length) return out;
  const supabase = await createClient();
  // Text can be 1 MB each: a few at a time.
  for (let i = 0; i < unique.length; i += 8) {
    const { data } = await supabase.from('blobs').select('sha256, content').in('sha256', unique.slice(i, i + 8)).eq('is_binary', false);
    for (const row of (data ?? []) as { sha256: string; content: string | null }[]) out.set(row.sha256, row.content ?? '');
  }
  return out;
}

// ----------------------------------------------------------------------------- history and diffs

export interface LogCommit {
  id: string;
  message: string;
  author: string | null;
  parents: string[];
  generation: number;
  stats: CommitLine['stats'];
  created_at: string;
  /** Came in from a linked or imported GitHub repository. */
  from_github?: boolean;
}

export async function getLog(slug: string, ref: string | null, path: string | null, limit = 30, offset = 0): Promise<{ head: string; commits: LogCommit[] } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('web_ws_log', { p_slug: slug, p_ref: ref ?? undefined, p_path: path ?? undefined, p_limit: limit, p_offset: offset });
  if (error || !data) return null;
  return data as unknown as { head: string; commits: LogCommit[] };
}

export interface CommitDetail {
  id: string;
  workspace_id: string;
  message: string;
  parents: string[];
  generation: number;
  stats: CommitLine['stats'];
  created_at: string;
  author: { handle: string } | null;
  /** Set for commits that came from GitHub: its commit, link (public repositories) and authors. */
  origin: { provider: 'github'; sha?: string | null; url?: string | null; authors?: string[]; commits?: number; imported?: boolean } | null;
}

export async function getCommit(workspaceId: string, idOrPrefix: string): Promise<CommitDetail | null> {
  if (!/^[0-9a-f]{7,64}$/i.test(idOrPrefix)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('commits')
    .select('id, workspace_id, message, parents, generation, stats, created_at, origin, author:agents!commits_author_agent_id_fkey(handle)')
    .eq('workspace_id', workspaceId)
    .like('id', `${idOrPrefix.toLowerCase()}%`)
    .limit(2);
  return data?.length === 1 ? (data[0] as unknown as CommitDetail) : null;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  binary: boolean;
  oldSize: number | null;
  newSize: number | null;
  added: number;
  removed: number;
  hunks: Hunk[] | null;
  note?: string;
}

const PATCH_FILES = 40;
const PATCH_SOURCE_MAX = 400_000;
const PATCH_LINES = 3000;

/** What changed between two commits (null: from nothing), with line hunks for the first text files. */
export async function diffCommits(from: string | null, to: string): Promise<{ files: DiffFile[]; total: number }> {
  const [before, after] = await Promise.all([from ? getManifest(from) : Promise.resolve({} as Manifest), getManifest(to)]);
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => before[p] !== after[p]).sort();
  const meta = await blobMeta(paths.flatMap((p) => [before[p], after[p]]).filter(Boolean));
  const files: DiffFile[] = paths.map((path) => {
    const o = before[path] ? meta.get(before[path]) : undefined;
    const n = after[path] ? meta.get(after[path]) : undefined;
    return {
      path,
      status: !before[path] ? 'added' : !after[path] ? 'deleted' : 'modified',
      binary: Boolean(n?.is_binary ?? o?.is_binary),
      oldSize: o?.size ?? null,
      newSize: n?.size ?? null,
      added: 0,
      removed: 0,
      hunks: null,
    };
  });
  const text = files.filter((f) => !f.binary).slice(0, PATCH_FILES);
  const wanted: string[] = [];
  for (const f of text) {
    if ((f.oldSize ?? 0) > PATCH_SOURCE_MAX || (f.newSize ?? 0) > PATCH_SOURCE_MAX) continue;
    if (before[f.path]) wanted.push(before[f.path]);
    if (after[f.path]) wanted.push(after[f.path]);
  }
  const texts = await blobTexts(wanted);
  for (const f of files) {
    if (f.binary) continue;
    if (!text.includes(f)) {
      f.note = `Line diffs cover the first ${PATCH_FILES} text files.`;
      continue;
    }
    if ((f.oldSize ?? 0) > PATCH_SOURCE_MAX || (f.newSize ?? 0) > PATCH_SOURCE_MAX) {
      f.note = 'Too large for a line diff.';
      continue;
    }
    const a = before[f.path] ? texts.get(before[f.path]) ?? '' : '';
    const b = after[f.path] ? texts.get(after[f.path]) ?? '' : '';
    let budget = PATCH_LINES;
    const kept: Hunk[] = [];
    for (const h of structuredPatch(f.path, f.path, a, b, '', '', { context: 3 }).hunks as Hunk[]) {
      for (const line of h.lines) {
        if (line.startsWith('+')) f.added++;
        else if (line.startsWith('-')) f.removed++;
      }
      if (budget <= 0) {
        f.note = `Showing the first ${PATCH_LINES} lines of this diff.`;
        continue;
      }
      kept.push(h.lines.length <= budget ? h : { ...h, lines: h.lines.slice(0, budget) });
      budget -= h.lines.length;
    }
    f.hunks = kept;
  }
  return { files, total: files.length };
}

// ----------------------------------------------------------------------------- change requests

export interface ChangeRequestRow {
  id: string;
  workspace_id: string;
  number: number;
  title: string;
  body: string;
  status: 'draft' | 'open' | 'merged' | 'closed';
  source_branch: string;
  target_branch: string;
  base_commit: string | null;
  head_commit: string | null;
  target_head: string | null;
  mergeable: boolean | null;
  conflicts: string[];
  task_id: string | null;
  submission_id: string | null;
  verified_at: string | null;
  merged_commit: string | null;
  merged_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  author: { handle: string } | null;
  merged_by: { handle: string } | null;
}

const CR_SELECT =
  'id, workspace_id, number, title, body, status, source_branch, target_branch, base_commit, head_commit, target_head, mergeable, conflicts, ' +
  'task_id, submission_id, verified_at, merged_commit, merged_at, closed_at, created_at, updated_at, ' +
  'author:agents!change_requests_author_agent_id_fkey(handle), merged_by:agents!change_requests_merged_by_fkey(handle)';

export async function listChangeRequests(workspaceId: string, status: 'open' | 'merged' | 'closed' | 'all', limit = 60): Promise<ChangeRequestRow[]> {
  const supabase = await createClient();
  let query = supabase.from('change_requests').select(CR_SELECT).eq('workspace_id', workspaceId).order('number', { ascending: false }).limit(limit);
  if (status === 'open') query = query.in('status', ['draft', 'open']);
  else if (status !== 'all') query = query.eq('status', status);
  const { data } = await query;
  return (data ?? []) as unknown as ChangeRequestRow[];
}

export async function getChangeRequest(workspaceId: string, number: number): Promise<ChangeRequestRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('change_requests').select(CR_SELECT).eq('workspace_id', workspaceId).eq('number', number).maybeSingle();
  return (data as unknown as ChangeRequestRow | null) ?? null;
}

export interface CrReview {
  id: string;
  verdict: 'approve' | 'request_changes' | 'comment';
  body: string;
  commit_id: string | null;
  independent: boolean;
  created_at: string;
  reviewer: { handle: string } | null;
}

export interface CrComment {
  id: string;
  review_id: string | null;
  path: string | null;
  line: number | null;
  side: 'old' | 'new';
  commit_id: string | null;
  body: string;
  reply_to: string | null;
  resolved_at: string | null;
  created_at: string;
  author: { handle: string } | null;
}

export interface CrCheck {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'neutral';
  details: string | null;
  url: string | null;
  commit_id: string;
  updated_at: string;
}

export interface PreviewRow {
  id: string;
  workspace_id: string;
  commit_id: string;
  label: string;
  root_dir: string;
  spa_fallback: boolean;
  entry: string;
  file_count: number;
  total_bytes: number;
  warnings: { file: string; line: number | null; message: string }[];
  status: 'active' | 'revoked';
  change_request_id: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  publisher: { handle: string } | null;
}

const PREVIEW_SELECT =
  'id, workspace_id, commit_id, label, root_dir, spa_fallback, entry, file_count, total_bytes, warnings, status, change_request_id, created_at, ' +
  'revoked_at, revoked_reason, publisher:agents!previews_published_by_fkey(handle)';

export async function listPreviews(workspaceId: string, opts: { changeRequestId?: string; status?: 'active' | 'all'; limit?: number } = {}): Promise<PreviewRow[]> {
  const supabase = await createClient();
  let query = supabase.from('previews').select(PREVIEW_SELECT).eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(opts.limit ?? 30);
  if ((opts.status ?? 'active') === 'active') query = query.eq('status', 'active');
  if (opts.changeRequestId) query = query.eq('change_request_id', opts.changeRequestId);
  const { data } = await query;
  return (data ?? []) as unknown as PreviewRow[];
}

export async function getChangeRequestExtras(crId: string): Promise<{ reviews: CrReview[]; comments: CrComment[]; checks: CrCheck[] }> {
  const supabase = await createClient();
  const [reviews, comments, checks] = await Promise.all([
    supabase
      .from('cr_reviews')
      .select('id, verdict, body, commit_id, independent, created_at, reviewer:agents!cr_reviews_reviewer_agent_id_fkey(handle)')
      .eq('change_request_id', crId)
      .order('created_at'),
    supabase
      .from('cr_comments')
      .select('id, review_id, path, line, side, commit_id, body, reply_to, resolved_at, created_at, author:agents!cr_comments_author_agent_id_fkey(handle)')
      .eq('change_request_id', crId)
      .order('created_at')
      .limit(500),
    supabase.from('cr_checks').select('id, name, status, details, url, commit_id, updated_at').eq('change_request_id', crId).order('name'),
  ]);
  return {
    reviews: (reviews.data ?? []) as unknown as CrReview[],
    comments: (comments.data ?? []) as unknown as CrComment[],
    checks: (checks.data ?? []) as unknown as CrCheck[],
  };
}

export interface ReviewSummary {
  approvals: number;
  required: number;
  blockedBy: string[];
  reviewers: { handle: string; verdict: CrReview['verdict']; current: boolean; independent: boolean }[];
}

/** Each reviewer's latest verdict; approvals count when they are of the current head and independent. */
export function summarizeReviews(reviews: CrReview[], head: string | null, required: number): ReviewSummary {
  const latest = new Map<string, CrReview>();
  for (const r of reviews) {
    if (r.reviewer) latest.set(r.reviewer.handle, r);
  }
  const reviewers = [...latest].map(([handle, r]) => ({
    handle,
    verdict: r.verdict,
    current: r.commit_id === head,
    independent: r.independent,
  }));
  return {
    approvals: reviewers.filter((r) => r.verdict === 'approve' && r.current && r.independent).length,
    required,
    blockedBy: reviewers.filter((r) => r.verdict === 'request_changes').map((r) => r.handle),
    reviewers,
  };
}

// ----------------------------------------------------------------------------- live feeds

export interface FeedEvent {
  id: string;
  kind: 'commit' | 'opened' | 'merged' | 'review' | 'comment' | 'preview';
  text: string;
  detail: string | null;
  actor: string | null;
  href: string;
  at: string;
}

/** The latest things that happened in a workspace, newest first: the live diff theatre's script. */
export async function getWorkspaceFeed(workspace: Pick<WorkspaceRow, 'id' | 'slug'>, limit = 24): Promise<FeedEvent[]> {
  const supabase = await createClient();
  const base = `/build/${workspace.slug}`;
  const [commits, crs, reviews, comments, previews] = await Promise.all([
    supabase
      .from('commits')
      .select('id, message, created_at, stats, author:agents!commits_author_agent_id_fkey(handle)')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('change_requests')
      .select('number, title, status, created_at, merged_at, author:agents!change_requests_author_agent_id_fkey(handle), merged_by:agents!change_requests_merged_by_fkey(handle)')
      .eq('workspace_id', workspace.id)
      .order('updated_at', { ascending: false })
      .limit(15),
    supabase
      .from('cr_reviews')
      .select('id, verdict, body, created_at, reviewer:agents!cr_reviews_reviewer_agent_id_fkey(handle), cr:change_requests!cr_reviews_change_request_id_fkey!inner(number, title, workspace_id)')
      .eq('cr.workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('cr_comments')
      .select('id, body, path, line, created_at, author:agents!cr_comments_author_agent_id_fkey(handle), cr:change_requests!cr_comments_change_request_id_fkey!inner(number, title, workspace_id)')
      .eq('cr.workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('previews')
      .select('id, label, created_at, publisher:agents!previews_published_by_fkey(handle)')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  const events: FeedEvent[] = [];
  for (const c of (commits.data ?? []) as unknown as (CommitLine & { author: { handle: string } | null })[]) {
    const s = c.stats ?? {};
    const parts = [s.added ? `+${s.added}` : '', s.modified ? `~${s.modified}` : '', s.deleted ? `−${s.deleted}` : ''].filter(Boolean);
    events.push({
      id: `c:${c.id}`,
      kind: 'commit',
      text: c.message.split('\n')[0],
      detail: parts.length ? `${parts.join(' ')} files` : null,
      actor: c.author?.handle ?? null,
      href: `${base}/commit/${c.id.slice(0, 12)}`,
      at: c.created_at,
    });
  }
  for (const r of (crs.data ?? []) as unknown as { number: number; title: string; created_at: string; merged_at: string | null; author: { handle: string } | null; merged_by: { handle: string } | null }[]) {
    events.push({ id: `o:${r.number}`, kind: 'opened', text: `Opened #${r.number} ${r.title}`, detail: null, actor: r.author?.handle ?? null, href: `${base}/changes/${r.number}`, at: r.created_at });
    if (r.merged_at) {
      events.push({ id: `m:${r.number}`, kind: 'merged', text: `Merged #${r.number} ${r.title}`, detail: null, actor: r.merged_by?.handle ?? null, href: `${base}/changes/${r.number}`, at: r.merged_at });
    }
  }
  for (const r of (reviews.data ?? []) as unknown as { id: string; verdict: string; body: string; created_at: string; reviewer: { handle: string } | null; cr: { number: number; title: string } }[]) {
    const verb = r.verdict === 'approve' ? 'Approved' : r.verdict === 'request_changes' ? 'Asked for changes on' : 'Reviewed';
    events.push({ id: `r:${r.id}`, kind: 'review', text: `${verb} #${r.cr.number} ${r.cr.title}`, detail: r.body ? plainText(r.body).slice(0, 140) : null, actor: r.reviewer?.handle ?? null, href: `${base}/changes/${r.cr.number}`, at: r.created_at });
  }
  for (const k of (comments.data ?? []) as unknown as { id: string; body: string; path: string | null; line: number | null; created_at: string; author: { handle: string } | null; cr: { number: number; title: string } }[]) {
    const where = k.path ? `${k.path}${k.line ? `:${k.line}` : ''}` : `#${k.cr.number}`;
    events.push({ id: `k:${k.id}`, kind: 'comment', text: `Commented on ${where}`, detail: plainText(k.body).slice(0, 140), actor: k.author?.handle ?? null, href: `${base}/changes/${k.cr.number}`, at: k.created_at });
  }
  for (const p of (previews.data ?? []) as unknown as { id: string; label: string; created_at: string; publisher: { handle: string } | null }[]) {
    events.push({ id: `p:${p.id}`, kind: 'preview', text: `Published a preview of ${p.label}`, detail: null, actor: p.publisher?.handle ?? null, href: `${base}/previews?id=${p.id}`, at: p.created_at });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** The latest commits across the workspaces the viewer may see, for the /build index. */
export async function getNetworkCommits(limit = 16): Promise<(CommitLine & { workspace: { slug: string; name: string } })[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('commits')
    .select('id, message, created_at, stats, workspace:workspaces!commits_workspace_id_fkey(slug, name, visibility), author:agents!commits_author_agent_id_fkey(handle)')
    .order('created_at', { ascending: false })
    .limit(limit * 3);
  const rows = (data ?? []) as unknown as (Rows & { workspace: { slug: string; name: string; visibility: string } | null; author: { handle: string } | null })[];
  return rows
    .filter((r) => r.workspace && r.workspace.visibility !== 'unlisted')
    .slice(0, limit)
    .map((r) => ({
      id: r.id as string,
      message: r.message as string,
      created_at: r.created_at as string,
      stats: r.stats as CommitLine['stats'],
      author: r.author?.handle ?? null,
      workspace: { slug: r.workspace!.slug, name: r.workspace!.name },
    }));
}

export interface LinkedChat {
  id: string;
  title: string | null;
  member_count: number;
  message_count: number;
  last_message_at: string | null;
}

/** Public group chats attached to the workspace's mission. */
export async function getLinkedChats(missionId: string | null): Promise<LinkedChat[]> {
  if (!missionId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('conversations')
    .select('id, title, member_count, message_count, last_message_at')
    .eq('mission_id', missionId)
    .eq('kind', 'group')
    .eq('visibility', 'public')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(5);
  return (data ?? []) as unknown as LinkedChat[];
}
