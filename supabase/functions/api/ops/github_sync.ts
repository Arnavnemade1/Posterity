// GitHub sync: the worker that turns a workspace's history into commits on GitHub and back.
//
// The database queues jobs (phase11_github.sql) and wakes this worker over pg_net; a cron sweep wakes
// it for retries. One worker holds a workspace at a time, so its jobs run in order:
//   link        check the repository, start an empty one, bring GitHub's history in if the workspace
//               is empty (two-way), then push every branch
//   push        create the branch's missing commits on GitHub (Git Data API) and move its ref:
//               posterity/<branch>, or (two-way) the default branch, fast-forward only
//   delete_ref  remove posterity/<branch> after the branch was deleted here
//   pr          open, update or close the pull request for a change request
//   pull        (two-way) bring GitHub's new default-branch commits in, or, when both sides moved,
//               put GitHub's side on github/<default> with a change request to merge it
//   import      a new workspace from a repository's tarball
//
// Posterity's tree has no file modes, so pushes build each tree on top of the parent's tree on GitHub
// and send only what changed: executable bits, symlinks and submodules there survive untouched.
import { db, query, rpc } from '../lib/db.ts';
import { type HashedFile, downloadBinary, hashFile, storeSystemFiles, toBase64 } from '../lib/blobs.ts';
import {
  dropInstallationToken,
  GitHub,
  GitHubError,
  GitHubNotConfigured,
  installationClient,
  refPath,
} from '../lib/github.ts';
import { ApiError } from '../lib/http.ts';
import { readTar, TarError } from '../lib/tar.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

export const MIRROR_PREFIX = 'posterity/';
const PUSH_BATCH = 40;
const TREE_CHUNK_ENTRIES = 400;
const TREE_CHUNK_BYTES = 2_500_000;
const FILE_MAX = 5_242_880;
const SYNC_FILES_MAX = 100_000;
const SYNC_FETCH_MAX = 1500;
const IMPORT_BYTES_MAX = 50 * 1_048_576;
const IMPORT_STREAM_MAX = 80 * 1_048_576;

// ----------------------------------------------------------------------------- shapes

export interface Remote {
  workspace_id: string;
  installation_id: number;
  repo_id: number;
  repo: string;
  private: boolean;
  default_branch: string;
  mode: 'mirror' | 'two_way';
  open_prs: boolean;
  status: 'linking' | 'active' | 'diverged' | 'paused' | 'error';
  bootstrap_sha: string | null;
  sync_change_request: number | null;
}

export interface JobContext {
  workspace: { id: string; slug: string; name: string; default_branch: string; visibility: string; created_by: string | null; head: string | null };
  site: string | null;
  remote: Remote | null;
  import: Record<string, unknown> | null;
}

export interface PlanParent {
  id: string;
  sha: string | null;
  tree: string | null;
  virtual: boolean;
}

export interface PlanChange {
  path: string;
  sha256: string | null;
  git_sha1: string | null;
  binary: boolean | null;
  size: number | null;
  existed: boolean;
  /** The file's mode in the workspace (absent from plans made before workspaces had modes). */
  executable?: boolean | null;
}

export interface PlanCommit {
  id: string;
  message: string;
  created_at: string;
  author: { handle: string; name: string } | null;
  parents: PlanParent[];
  changes: PlanChange[];
}

export interface PushPlan {
  branch: string;
  head: string;
  head_mirror: { sha: string; tree: string } | null;
  empty: boolean;
  total: number;
  more: boolean;
  commits: PlanCommit[];
}

export interface PrContext {
  id: string;
  number: number;
  title: string;
  body: string;
  status: 'draft' | 'open' | 'merged' | 'closed';
  source: string;
  target: string;
  author: string | null;
  workspace: string;
  default_branch: string;
  source_head: string | null;
  pull_request: { number: number; url: string; state: string; head_ref: string; base_ref: string } | null;
}

export interface Job {
  id: number;
  kind: 'link' | 'push' | 'delete_ref' | 'pr' | 'pull' | 'import';
  branch: string | null;
  change_request_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface ImportArgs {
  branch: string;
  parents: string[];
  expected: string | null;
  manifest: Record<string, string>;
  /** Executable files: {"path": "x"}. */
  modes?: Record<string, 'x'>;
  message: string;
  origin: Record<string, unknown>;
  repo?: number;
  sha?: string;
  tree?: string;
  force?: boolean;
}

/** Everything the sync needs from Posterity's side. The worker uses the database; tests use memory. */
export interface SyncStore {
  context(ws: string): Promise<JobContext | null>;
  pushPlan(ws: string, repo: number, branch: string, limit: number): Promise<PushPlan | null>;
  blobBytes(ws: string, shas: string[]): Promise<Map<string, Uint8Array>>;
  recordMirror(repo: number, row: { commit: string; sha: string; tree: string; direction: 'out' | 'in' }): Promise<void>;
  setRemote(ws: string, patch: Record<string, unknown>): Promise<void>;
  lastSynced(ws: string, repo: number, branch: string): Promise<{ head: string; commit: string | null; sha: string | null } | null>;
  commitBySha(repo: number, sha: string): Promise<string | null>;
  isAncestor(a: string, b: string): Promise<boolean>;
  blobsByGit(ws: string, gitShas: string[]): Promise<Record<string, string>>;
  putFiles(ws: string, files: HashedFile[]): Promise<void>;
  importCommit(ws: string, args: ImportArgs): Promise<{ commit: string; existed: boolean }>;
  openSyncCr(ws: string, source: string, title: string, body: string): Promise<{ number: number }>;
  prContext(cr: string): Promise<PrContext | null>;
  recordPr(cr: string, repo: number, pr: { number: number; url: string; state: string; head: string; base: string }): Promise<void>;
  finishImport(ws: string, state: Record<string, unknown>): Promise<void>;
  link(ws: string, agent: string, repo: string, mode: string, openPrs: boolean): Promise<void>;
  enqueue(ws: string, kind: Job['kind'], branch?: string | null): Promise<void>;
  enqueueUnsynced(ws: string): Promise<number>;
  branchExists(ws: string, branch: string): Promise<boolean>;
}

export interface Outcome {
  outcome?: 'done' | 'continue' | 'retry' | 'failed';
  result?: Record<string, unknown>;
  retryAfter?: number;
  error?: string;
}

/** A sync problem a person or agent has to fix (shown on the link), not worth retrying as is. */
export class SyncProblem extends Error {}

// ----------------------------------------------------------------------------- refs

/** Where a branch lives on GitHub: posterity/<branch>, or the real default branch for a two-way default. */
export function remoteRef(remote: Remote, workspaceDefault: string, branch: string): { ref: string; isDefault: boolean } {
  if (remote.mode === 'two_way' && branch === workspaceDefault) return { ref: remote.default_branch, isDefault: true };
  return { ref: MIRROR_PREFIX + branch, isDefault: false };
}

export async function refSha(gh: GitHub, repo: string, branch: string): Promise<string | null> {
  try {
    const ref = await gh.get<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${refPath(branch)}`);
    return ref.object.sha;
  } catch (err) {
    // 404: no such branch; 409: the repository is empty.
    if (err instanceof GitHubError && (err.status === 404 || err.status === 409)) return null;
    throw err;
  }
}

async function setRef(gh: GitHub, repo: string, branch: string, sha: string, force: boolean): Promise<'created' | 'updated' | 'same'> {
  const current = await refSha(gh, repo, branch);
  if (current === sha) return 'same';
  if (current === null) {
    await gh.post(`/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    return 'created';
  }
  await gh.patch(`/repos/${repo}/git/refs/heads/${refPath(branch)}`, { sha, force });
  return 'updated';
}

async function repoIsEmpty(gh: GitHub, repo: string): Promise<boolean> {
  const branches = await gh.get<unknown[]>(`/repos/${repo}/branches?per_page=1`);
  return Array.isArray(branches) && branches.length === 0;
}

// ----------------------------------------------------------------------------- pushing commits

const decoder = new TextDecoder();

interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob';
  sha?: string | null;
  content?: string;
}

/** A tree on top of base, in chunks so no request gets too big; deletions need a base. */
async function createTree(gh: GitHub, repo: string, base: string | undefined, entries: { entry: TreeEntry; bytes: number }[]): Promise<string> {
  let tree = base;
  let batch: TreeEntry[] = [];
  let bytes = 0;
  const flush = async () => {
    const res = await gh.post<{ sha: string }>(`/repos/${repo}/git/trees`, tree ? { base_tree: tree, tree: batch } : { tree: batch });
    tree = res.sha;
    batch = [];
    bytes = 0;
  };
  for (const { entry, bytes: size } of entries) {
    if (batch.length && (batch.length >= TREE_CHUNK_ENTRIES || bytes + size > TREE_CHUNK_BYTES)) await flush();
    batch.push(entry);
    bytes += size;
  }
  if (batch.length) await flush();
  if (!tree) throw new SyncProblem('A commit with no files has no tree on GitHub');
  return tree;
}

async function executablePaths(gh: GitHub, repo: string, tree: string): Promise<Set<string>> {
  const res = await gh.get<{ tree: { path: string; mode: string; type: string }[]; truncated: boolean }>(
    `/repos/${repo}/git/trees/${tree}?recursive=1`,
  );
  return new Set(res.tree.filter((e) => e.type === 'blob' && e.mode === '100755').map((e) => e.path));
}

export function commitMessage(c: PlanCommit, site: string | null, slug: string): string {
  const trailers = [`Posterity-Commit: ${c.id}`];
  if (c.author) trailers.push(`Posterity-Author: @${c.author.handle}`);
  if (site) trailers.push(`Posterity-Workspace: ${site.replace(/\/+$/, '')}/build/${slug}`);
  return `${c.message.trimEnd()}\n\n${trailers.join('\n')}\n`;
}

/**
 * Create the plan's commits on GitHub, oldest first, each on its parents' commits there. Records each
 * mirror as it goes, so a failed push resumes where it stopped. Returns the plan head's sha.
 */
export async function mirrorCommits(gh: GitHub, store: SyncStore, ctx: JobContext, remote: Remote, plan: PushPlan): Promise<string | null> {
  const repo = remote.repo;
  const created = new Map<string, { sha: string; tree: string }>();
  const execByTree = new Map<string, Set<string>>();
  for (const c of plan.commits) {
    const parents = c.parents.filter((p) => !p.virtual);
    const parentShas = parents.map((p) => p.sha ?? created.get(p.id)?.sha ?? null);
    if (parentShas.some((s) => !s)) throw new SyncProblem(`A parent of commit ${c.id.slice(0, 12)} is not on GitHub yet`);
    const first = parents[0];
    const baseTree = first ? (first.tree ?? created.get(first.id)!.tree) : undefined;

    let exec = baseTree ? execByTree.get(baseTree) : new Set<string>();
    if (!exec && c.changes.some((ch) => ch.existed && ch.sha256 && typeof ch.executable !== 'boolean')) {
      exec = await executablePaths(gh, repo, baseTree!);
      execByTree.set(baseTree!, exec);
    }

    const bytes = await store.blobBytes(ctx.workspace.id, c.changes.flatMap((ch) => (ch.sha256 ? [ch.sha256] : [])));
    const entries: { entry: TreeEntry; bytes: number }[] = [];
    for (const ch of c.changes) {
      if (!ch.sha256) {
        if (!baseTree) continue;
        entries.push({ entry: { path: ch.path, mode: '100644', type: 'blob', sha: null }, bytes: 100 });
        continue;
      }
      const data = bytes.get(ch.sha256);
      if (!data) throw new SyncProblem(`The file ${ch.path} could not be read`);
      // Workspaces know which files are executable; plans without modes keep what GitHub had.
      const mode = (typeof ch.executable === 'boolean' ? ch.executable : exec?.has(ch.path)) ? '100755' : '100644';
      if (!ch.binary) {
        entries.push({ entry: { path: ch.path, mode, type: 'blob', content: decoder.decode(data) }, bytes: data.length + 100 });
      } else {
        const blob = await gh.post<{ sha: string }>(`/repos/${repo}/git/blobs`, { content: toBase64(data), encoding: 'base64' });
        entries.push({ entry: { path: ch.path, mode, type: 'blob', sha: blob.sha }, bytes: 100 });
      }
    }
    const tree = entries.length ? await createTree(gh, repo, baseTree, entries) : baseTree;
    if (!tree) throw new SyncProblem(`Commit ${c.id.slice(0, 12)} has no files to put on GitHub`);
    if (exec) {
      const next = new Set(exec);
      for (const ch of c.changes) if (!ch.sha256) next.delete(ch.path);
      execByTree.set(tree, next);
    }
    const author = {
      name: c.author?.name || c.author?.handle || 'Posterity',
      email: `${c.author?.handle ?? 'posterity'}@agents.posterity.invalid`,
      date: new Date(c.created_at).toISOString(),
    };
    const commit = await gh.post<{ sha: string }>(`/repos/${repo}/git/commits`, {
      message: commitMessage(c, ctx.site, ctx.workspace.slug),
      tree,
      parents: parentShas,
      author,
    });
    created.set(c.id, { sha: commit.sha, tree });
    await store.recordMirror(remote.repo_id, { commit: c.id, sha: commit.sha, tree, direction: 'out' });
  }
  return created.get(plan.head)?.sha ?? plan.head_mirror?.sha ?? null;
}

/**
 * Push one branch: its missing commits, then its ref. Answers continue when there are more commits
 * than one run creates.
 */
export async function pushBranch(gh: GitHub, store: SyncStore, ctx: JobContext, remote: Remote, branch: string): Promise<Outcome> {
  const plan = await store.pushPlan(ctx.workspace.id, remote.repo_id, branch, PUSH_BATCH);
  if (!plan) return { result: { skipped: 'the branch no longer exists' } };
  if (plan.empty) return { result: { skipped: 'the branch has no files yet' } };
  const sha = await mirrorCommits(gh, store, ctx, remote, plan);
  if (plan.more) return { outcome: 'continue', result: { pushed: plan.commits.length, left: plan.total - plan.commits.length } };
  if (!sha) throw new SyncProblem(`The head of ${branch} is not on GitHub`);
  const { ref, isDefault } = remoteRef(remote, ctx.workspace.default_branch, branch);
  if (!isDefault) {
    const how = await setRef(gh, remote.repo, ref, sha, true);
    return { result: { ref, sha, how, pushed: plan.commits.length } };
  }

  // The real default branch moves only forward.
  const current = await refSha(gh, remote.repo, ref);
  if (current === sha) {
    await store.setRemote(ctx.workspace.id, { status: 'active', synced: true });
    return { result: { ref, sha, how: 'same' } };
  }
  if (current === null || (remote.bootstrap_sha && current === remote.bootstrap_sha)) {
    await setRef(gh, remote.repo, ref, sha, true);
    await store.setRemote(ctx.workspace.id, { status: 'active', synced: true });
    return { result: { ref, sha, how: current === null ? 'created' : 'replaced the placeholder' } };
  }
  const known = await store.commitBySha(remote.repo_id, current);
  if (known && (await store.isAncestor(known, plan.head))) {
    try {
      await gh.patch(`/repos/${remote.repo}/git/refs/heads/${refPath(ref)}`, { sha, force: false });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422) {
        await store.enqueue(ctx.workspace.id, 'pull');
        return { result: { held: `${ref} moved on GitHub while pushing; bringing its commits in first` } };
      }
      throw err;
    }
    await store.setRemote(ctx.workspace.id, { status: 'active', synced: true });
    return { result: { ref, sha, how: 'fast-forward', pushed: plan.commits.length } };
  }
  await store.enqueue(ctx.workspace.id, 'pull');
  return { result: { held: `${ref} has commits on GitHub that ${ctx.workspace.slug} does not; bringing them in first` } };
}

// ----------------------------------------------------------------------------- bringing GitHub in

/** Relative paths a workspace accepts (the same rule as ws_valid_path). */
export function validPath(path: string): boolean {
  if (!path || path.length > 500 || /[\u0000-\u001f\u007f\\]/.test(path) || path.startsWith('/') || path.endsWith('/') || path.includes('//')) {
    return false;
  }
  return path.split('/').every((seg) => seg !== '.' && seg !== '..' && !['.git', '.posterity'].includes(seg.toLowerCase()) && seg.length <= 255);
}

function fromBase64(data: string): Uint8Array {
  const raw = atob(data.replace(/\s+/g, ''));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * A tree on GitHub as a workspace manifest and its executable files: files stored here as needed;
 * symlinks, submodules and big files skipped.
 */
export async function importTree(
  gh: GitHub,
  store: SyncStore,
  ws: string,
  repo: string,
  tree: string,
): Promise<{ manifest: Record<string, string>; modes: Record<string, 'x'>; skipped: string[] }> {
  const listing = await gh.get<{ tree: { path: string; mode: string; type: string; sha: string; size?: number }[]; truncated: boolean }>(
    `/repos/${repo}/git/trees/${tree}?recursive=1`,
  );
  if (listing.truncated) throw new SyncProblem('The repository has more files than GitHub lists at once; it is too big to sync');
  const skipped: string[] = [];
  const files = listing.tree.filter((e) => {
    if (e.type === 'tree') return false;
    if (e.type !== 'blob' || e.mode === '120000') {
      skipped.push(`${e.path} (${e.type === 'commit' ? 'submodule' : 'symlink'})`);
      return false;
    }
    if (!validPath(e.path)) {
      skipped.push(`${e.path} (path not allowed)`);
      return false;
    }
    if ((e.size ?? 0) > FILE_MAX) {
      skipped.push(`${e.path} (over 5 MB)`);
      return false;
    }
    return true;
  });
  if (files.length > SYNC_FILES_MAX) throw new SyncProblem(`The repository has ${files.length} files; a workspace holds at most ${SYNC_FILES_MAX}`);
  const known: Record<string, string> = {};
  for (let i = 0; i < files.length; i += 1000) {
    Object.assign(known, await store.blobsByGit(ws, files.slice(i, i + 1000).map((f) => f.sha)));
  }
  const missing = [...new Set(files.filter((f) => !known[f.sha]).map((f) => f.sha))];
  if (missing.length > SYNC_FETCH_MAX) {
    throw new SyncProblem(`${missing.length} new files at once is more than a sync brings in; import the repository into a new workspace instead`);
  }
  // Fetched a few at a time and stored in batches, so memory holds one batch.
  for (let i = 0; i < missing.length; i += 48) {
    const batch: HashedFile[] = [];
    await pool(missing.slice(i, i + 48), 6, async (sha) => {
      const blob = await gh.get<{ content: string; encoding: string }>(`/repos/${repo}/git/blobs/${sha}`);
      const bytes = blob.encoding === 'base64' ? fromBase64(blob.content) : new TextEncoder().encode(blob.content);
      const file = await hashFile(bytes);
      if (file.git_sha1 !== sha) throw new SyncProblem(`GitHub sent different bytes for ${sha.slice(0, 12)}`);
      batch.push(file);
    });
    await store.putFiles(ws, batch);
    for (const file of batch) known[file.git_sha1] = file.sha256;
  }
  const manifest: Record<string, string> = {};
  const modes: Record<string, 'x'> = {};
  for (const f of files) {
    manifest[f.path] = known[f.sha];
    if (f.mode === '100755') modes[f.path] = 'x';
  }
  return { manifest, modes, skipped };
}

interface GitCommit {
  sha: string;
  tree: { sha: string };
  message: string;
  author: { name: string; date: string } | null;
  parents: { sha: string }[];
}

interface CompareCommit {
  sha: string;
  commit: { message: string; author: { name: string } | null };
}

/** GitHub's commit as a Posterity commit on a branch, mapped to it. `between` are the commits it brings in. */
async function importGitHubCommit(
  gh: GitHub,
  store: SyncStore,
  ctx: JobContext,
  remote: Remote,
  sha: string,
  target: { branch: string; parents: string[]; expected: string | null; force?: boolean },
  between: CompareCommit[] = [],
): Promise<string> {
  const commit = await gh.get<GitCommit>(`/repos/${remote.repo}/git/commits/${sha}`);
  const { manifest, modes, skipped } = await importTree(gh, store, ctx.workspace.id, remote.repo, commit.tree.sha);
  const subject = (m: string) => m.split('\n')[0].slice(0, 120);
  const message = between.length > 1
    ? `Sync ${between.length} commits from GitHub\n\n${between.slice(-20).map((c) => `- ${c.sha.slice(0, 7)} ${subject(c.commit.message)}${c.commit.author ? ` (${c.commit.author.name})` : ''}`).join('\n')}` +
      (between.length > 20 ? `\n- …and ${between.length - 20} earlier` : '')
    : `${commit.message.trimEnd()}\n\nFrom GitHub: ${sha.slice(0, 7)}${commit.author ? ` by ${commit.author.name}` : ''}`;
  const authors = [...new Set((between.length ? between.map((c) => c.commit.author?.name) : [commit.author?.name]).filter(Boolean))].slice(0, 10);
  const result = await store.importCommit(ctx.workspace.id, {
    branch: target.branch,
    parents: target.parents,
    expected: target.expected,
    manifest,
    modes,
    message: message.slice(0, 4000),
    origin: {
      provider: 'github',
      sha,
      url: remote.private ? null : `https://github.com/${remote.repo}/commit/${sha}`,
      authors,
      commits: Math.max(between.length, 1),
      skipped: skipped.slice(0, 50),
    },
    repo: remote.repo_id,
    sha,
    tree: commit.tree.sha,
    force: target.force,
  });
  return result.commit;
}

/** Two-way: bring the default branch's new commits on GitHub in, or set up the merge when both moved. */
export async function pull(gh: GitHub, store: SyncStore, ctx: JobContext, remote: Remote): Promise<Outcome> {
  if (remote.mode !== 'two_way') return { result: { skipped: 'mirror links only push' } };
  const ws = ctx.workspace;
  const G = await refSha(gh, remote.repo, remote.default_branch);
  if (!G) return { result: { skipped: `${remote.default_branch} does not exist on GitHub` } };
  if (G === remote.bootstrap_sha || (await store.commitBySha(remote.repo_id, G))) {
    if (remote.status === 'active') await store.setRemote(ws.id, { synced: true });
    return { result: { up_to_date: true } };
  }
  const last = await store.lastSynced(ws.id, remote.repo_id, ws.default_branch);
  if (!last?.commit || !last.sha) {
    throw new SyncProblem(`${ws.slug} and ${remote.repo} have unrelated histories. Unlink, then import the repository into a new workspace.`);
  }
  const cmp = await gh.get<{ status: string; merge_base_commit: { sha: string }; commits: CompareCommit[]; total_commits: number }>(
    `/repos/${remote.repo}/compare/${last.sha}...${G}`,
  );
  if (cmp.status === 'identical') return { result: { up_to_date: true } };
  if (cmp.status === 'behind') {
    await store.enqueue(ws.id, 'push', ws.default_branch);
    return { result: { github_behind: true } };
  }
  if (cmp.status === 'ahead' && last.head === last.commit) {
    const commit = await importGitHubCommit(gh, store, ctx, remote, G, { branch: ws.default_branch, parents: [last.head], expected: last.head }, cmp.commits);
    await store.setRemote(ws.id, { status: 'active', synced: true });
    return { result: { imported: commit, commits: cmp.total_commits } };
  }
  // Both moved. GitHub's side goes on github/<default>, from the last commit both sides had.
  let base = last.commit;
  if (cmp.status === 'diverged') {
    const known = await store.commitBySha(remote.repo_id, cmp.merge_base_commit.sha);
    if (!known) {
      throw new SyncProblem(`${remote.default_branch} on GitHub was rewritten (force-pushed) past what ${ws.slug} knows. Restore it, or unlink and import the repository again.`);
    }
    base = known;
  }
  const branch = `github/${remote.default_branch}`.replace(/[^A-Za-z0-9._/-]/g, '-');
  await importGitHubCommit(gh, store, ctx, remote, G, { branch, parents: [base], expected: null, force: true }, cmp.commits);
  const cr = await store.openSyncCr(
    ws.id,
    branch,
    `Bring in ${remote.default_branch} from GitHub`,
    `${remote.default_branch} changed on GitHub (${cmp.total_commits} commit${cmp.total_commits === 1 ? '' : 's'}) while ${ws.default_branch} changed here. ` +
      `Merge this to bring the two together; pushes to GitHub's ${remote.default_branch} wait until it is merged.`,
  );
  await store.setRemote(ws.id, {
    status: 'diverged',
    detail: `${remote.default_branch} changed on both sides. Merge change request #${cr.number} (${branch} into ${ws.default_branch}) to bring them together.`,
  });
  return { result: { diverged: true, change_request: cr.number } };
}

// ----------------------------------------------------------------------------- linking

function placeholderReadme(ctx: JobContext): string {
  const site = ctx.site?.replace(/\/+$/, '');
  const where = site ? `[${ctx.workspace.slug}](${site}/build/${ctx.workspace.slug})` : ctx.workspace.slug;
  return `# ${ctx.workspace.name}\n\nThis repository is linked to the Posterity workspace ${where}, where AI agents build software together. ` +
    `Posterity pushes the workspace's branches here as posterity/<branch>.\n`;
}

export async function link(gh: GitHub, store: SyncStore, ctx: JobContext, remote: Remote): Promise<Outcome> {
  const ws = ctx.workspace;
  let info: { full_name: string; private: boolean; archived: boolean; default_branch: string; permissions?: { push?: boolean } };
  try {
    info = await gh.get(`/repos/${remote.repo}`);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      throw new SyncProblem(`The Posterity GitHub App cannot see ${remote.repo}. Add it to the app's installation, then resync.`);
    }
    throw err;
  }
  if (info.archived) throw new SyncProblem(`${info.full_name} is archived on GitHub, so nothing can be pushed to it`);
  if (info.private && remote.mode === 'two_way' && ws.visibility !== 'private') {
    throw new SyncProblem(`${info.full_name} became private; a two-way link needs a private workspace. Make ${ws.slug} private or link it as a mirror.`);
  }
  const patch: Record<string, unknown> = { default_branch: info.default_branch, private: info.private, repo: info.full_name };
  const current: Remote = { ...remote, repo: info.full_name, private: info.private, default_branch: info.default_branch };

  let head = await refSha(gh, current.repo, current.default_branch);
  if (!head && (await repoIsEmpty(gh, current.repo))) {
    // The Git Data API refuses an empty repository; one placeholder commit opens it.
    const res = await gh.put<{ commit: { sha: string } }>(`/repos/${current.repo}/contents/README.md`, {
      message: 'Connect to Posterity',
      content: toBase64(new TextEncoder().encode(placeholderReadme(ctx))),
    });
    head = res.commit.sha;
    patch.bootstrap_sha = head;
    current.bootstrap_sha = head;
  }

  if (current.mode === 'two_way' && head && head !== current.bootstrap_sha && !(await store.commitBySha(current.repo_id, head))) {
    const last = await store.lastSynced(ws.id, current.repo_id, ws.default_branch);
    if (last?.commit) {
      await store.enqueue(ws.id, 'pull');
    } else {
      const plan = await store.pushPlan(ws.id, current.repo_id, ws.default_branch, 1);
      if (!plan?.empty || !ws.head) {
        throw new SyncProblem(
          `${ws.slug} and ${current.repo} both have history, and it is unrelated. Link an empty workspace (its files come from GitHub), use mirror mode, or import the repository into a new workspace.`,
        );
      }
      await importGitHubCommit(gh, store, ctx, current, head, { branch: ws.default_branch, parents: [ws.head], expected: ws.head });
    }
  }
  await store.setRemote(ws.id, { ...patch, status: 'active', synced: true });
  const queued = await store.enqueueUnsynced(ws.id);
  return { result: { linked: current.repo, default_branch: current.default_branch, queued } };
}

// ----------------------------------------------------------------------------- pull requests

export async function syncPullRequest(gh: GitHub, store: SyncStore, ctx: JobContext, remote: Remote, crId: string): Promise<Outcome> {
  const cr = await store.prContext(crId);
  if (!cr || cr.source.startsWith('github/')) return { result: { skipped: true } };
  const pr = cr.pull_request;
  const repo = remote.repo;
  if (cr.status === 'closed' || cr.status === 'merged') {
    if (pr && pr.state === 'open' && (cr.status === 'closed' || remote.mode === 'two_way')) {
      if (cr.status === 'closed') {
        await gh.patch(`/repos/${repo}/pulls/${pr.number}`, { state: 'closed' });
        await store.recordPr(cr.id, remote.repo_id, { number: pr.number, url: pr.url, state: 'closed', head: pr.head_ref, base: pr.base_ref });
      }
    }
    return { result: { status: cr.status } };
  }
  if (!remote.open_prs) return { result: { skipped: 'pull requests are off for this link' } };

  // The source branch has to be on GitHub first.
  const pushed = await pushBranch(gh, store, ctx, remote, cr.source);
  if (pushed.outcome === 'continue') return pushed;
  const site = ctx.site?.replace(/\/+$/, '');
  const link = site ? `[${cr.workspace} #${cr.number}](${site}/build/${cr.workspace}/changes/${cr.number})` : `${cr.workspace} #${cr.number}`;
  const body = `${cr.body.trim() ? `${cr.body.trim()}\n\n---\n` : ''}Proposed on Posterity${cr.author ? ` by @${cr.author}` : ''} as ${link}. ` +
    (remote.mode === 'two_way'
      ? 'Agents review it there; merging it on Posterity merges this pull request.'
      : 'Posterity keeps this branch up to date; merge it here when you are ready.');
  const head = MIRROR_PREFIX + cr.source;

  if (pr) {
    const state = pr.state === 'merged' ? 'merged' : 'open';
    if (pr.state !== 'merged') {
      await gh.patch(`/repos/${repo}/pulls/${pr.number}`, { title: cr.title, body: body.slice(0, 60_000), state: 'open' });
    }
    await store.recordPr(cr.id, remote.repo_id, { number: pr.number, url: pr.url, state, head: pr.head_ref, base: pr.base_ref });
    return { result: { pull_request: pr.number, updated: true } };
  }

  const bases = cr.target === cr.default_branch ? [remote.default_branch, MIRROR_PREFIX + cr.target] : [MIRROR_PREFIX + cr.target];
  let lastError: GitHubError | null = null;
  for (const base of bases) {
    if (base.startsWith(MIRROR_PREFIX)) {
      const target = await pushBranch(gh, store, ctx, remote, base.slice(MIRROR_PREFIX.length));
      if (target.outcome === 'continue') return target;
    }
    try {
      const created = await gh.post<{ number: number; html_url: string }>(`/repos/${repo}/pulls`, {
        title: cr.title,
        head,
        base,
        body: body.slice(0, 60_000),
        draft: cr.status === 'draft',
        maintainer_can_modify: false,
      });
      await store.recordPr(cr.id, remote.repo_id, { number: created.number, url: created.html_url, state: 'open', head, base });
      return { result: { pull_request: created.number, base } };
    } catch (err) {
      if (!(err instanceof GitHubError) || err.status !== 422) throw err;
      const text = JSON.stringify(err.body ?? '');
      if (/already exists/i.test(text)) {
        const [owner] = repo.split('/');
        const open = await gh.get<{ number: number; html_url: string; base: { ref: string } }[]>(
          `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`,
        );
        if (open[0]) {
          await store.recordPr(cr.id, remote.repo_id, { number: open[0].number, url: open[0].html_url, state: 'open', head, base: open[0].base.ref });
          return { result: { pull_request: open[0].number, adopted: true } };
        }
      }
      if (/No commits between/i.test(text)) return { result: { skipped: 'nothing to compare yet' } };
      if (/draft/i.test(text) && cr.status === 'draft') {
        cr.status = 'open';
        bases.push(base);
        continue;
      }
      lastError = err;
    }
  }
  throw lastError ?? new SyncProblem('GitHub refused the pull request');
}

// ----------------------------------------------------------------------------- imports

/** The tarball of a repository at a ref: public ones straight from GitHub, private ones through the installation. */
async function tarball(source: { repo: string; ref?: string | null; private?: boolean }, gh: GitHub | null, fetchImpl: typeof fetch): Promise<Response> {
  const ref = source.ref?.trim() || null;
  if (gh) {
    const res = await gh.raw('GET', `/repos/${source.repo}/tarball${ref ? `/${refPath(ref)}` : ''}`, { redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) return fetchImpl(location);
    if (res.ok) return res;
    throw new SyncProblem(res.status === 404 ? `${source.repo}${ref ? ` at ${ref}` : ''} was not found` : `GitHub answered ${res.status} for the archive`);
  }
  const url = `https://github.com/${source.repo}/archive/${ref ? refPath(ref) : 'HEAD'}.tar.gz`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Posterity' } });
  if (res.status === 404) {
    throw new SyncProblem(`${source.repo}${ref ? ` at ${ref}` : ''} was not found. A private repository needs your owner's GitHub App installation.`);
  }
  if (!res.ok) throw new SyncProblem(`GitHub answered ${res.status} for the archive`);
  return res;
}

export interface ImportPayload {
  source: { repo: string; ref?: string | null; private?: boolean; installation?: number | null };
  link?: { mode?: string; open_prs?: boolean } | null;
  agent?: string | null;
}

export async function importRepository(
  store: SyncStore,
  ctx: JobContext,
  payload: ImportPayload,
  clientFor: (installation: number) => GitHub,
  fetchImpl: typeof fetch = fetch,
): Promise<Outcome> {
  const ws = ctx.workspace;
  const source = payload.source;
  await store.finishImport(ws.id, { status: 'running' });
  const gh = source.installation ? clientFor(source.installation) : null;
  const res = await tarball(source, gh, fetchImpl);
  if (!res.body) throw new SyncProblem('GitHub sent an empty archive');
  const stream = res.body.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);

  let sha: string | null = null;
  let root: string | null = null;
  const manifest: Record<string, string> = {};
  const modes: Record<string, 'x'> = {};
  const skipped: string[] = [];
  let pending: HashedFile[] = [];
  let pendingBytes = 0;
  let total = 0;
  let files = 0;
  const flush = async () => {
    await store.putFiles(ws.id, pending);
    pending = [];
    pendingBytes = 0;
  };
  try {
    for await (const entry of readTar(stream, { maxFileBytes: FILE_MAX, maxStreamBytes: IMPORT_STREAM_MAX })) {
      if (entry.type === 'global') {
        const comment = entry.pax.comment ?? '';
        if (/^[0-9a-f]{40}$/.test(comment)) sha = comment;
        continue;
      }
      // GitHub puts everything under one top folder, <repo>-<sha>/.
      const slash = entry.path.indexOf('/');
      root ??= slash > 0 ? entry.path.slice(0, slash) : null;
      const path = root && entry.path.startsWith(`${root}/`) ? entry.path.slice(root.length + 1).replace(/\/+$/, '') : entry.path;
      if (!path || entry.type === 'dir') continue;
      if (entry.type !== 'file') {
        skipped.push(`${path} (${entry.type === 'symlink' ? 'symlink' : 'not a file'})`);
        continue;
      }
      if (!entry.data) {
        skipped.push(`${path} (over 5 MB)`);
        continue;
      }
      if (!validPath(path)) {
        skipped.push(`${path} (path not allowed)`);
        continue;
      }
      if (++files > SYNC_FILES_MAX) throw new SyncProblem(`The repository has more than ${SYNC_FILES_MAX} files, the most a workspace holds`);
      total += entry.data.length;
      if (total > IMPORT_BYTES_MAX) {
        throw new SyncProblem(`The repository has more than ${IMPORT_BYTES_MAX / 1_048_576} MB of files; import a smaller one, or push it with the CLI`);
      }
      const file = await hashFile(entry.data);
      manifest[path] = file.sha256;
      if (entry.mode & 0o111) modes[path] = 'x';
      pending.push(file);
      pendingBytes += file.size;
      if (pending.length >= 200 || pendingBytes > 3_000_000) await flush();
    }
  } catch (err) {
    if (err instanceof TarError) throw new SyncProblem(err.message);
    throw err;
  }
  if (pending.length) await flush();
  if (!Object.keys(manifest).length) throw new SyncProblem('The repository has no files to import');
  if (!ws.head) throw new SyncProblem('The workspace has no first commit');

  const repo = source.repo;
  const label = source.private ? 'a private repository' : repo;
  const result = await store.importCommit(ws.id, {
    branch: ws.default_branch,
    parents: [ws.head],
    expected: ws.head,
    manifest,
    modes,
    message: `Import ${label}${source.ref ? ` at ${source.ref}` : ''}${sha ? ` (${sha.slice(0, 7)})` : ''}`,
    origin: {
      provider: 'github',
      sha,
      url: source.private || !sha ? null : `https://github.com/${repo}/commit/${sha}`,
      imported: true,
      skipped: skipped.slice(0, 50),
    },
  });

  let linked: string | null = null;
  if (payload.link && payload.agent && gh && sha) {
    const info = await gh.get<{ id: number }>(`/repos/${repo}`);
    const commit = await gh.get<GitCommit>(`/repos/${repo}/git/commits/${sha}`);
    await store.recordMirror(info.id, { commit: result.commit, sha, tree: commit.tree.sha, direction: 'in' });
    await store.link(ws.id, payload.agent, repo, payload.link.mode ?? 'mirror', payload.link.open_prs ?? false);
    linked = payload.link.mode ?? 'mirror';
  }
  const summary = `${files} file${files === 1 ? '' : 's'}${skipped.length ? `, ${skipped.length} skipped` : ''}`;
  await store.finishImport(ws.id, {
    status: 'done',
    sha,
    files,
    bytes: total,
    skipped: skipped.slice(0, 50),
    summary,
    linked,
    finished_at: new Date().toISOString(),
  });
  return { result: { commit: result.commit, files, skipped: skipped.length, linked } };
}

// ----------------------------------------------------------------------------- the database store

interface BlobRow {
  sha256: string;
  is_binary: boolean;
  content: string | null;
  storage_path: string | null;
}

export const dbStore: SyncStore = {
  context: (ws) => rpc<JobContext | null>('gh_job_context', { p_ws: ws }),
  pushPlan: (ws, repo, branch, limit) => rpc<PushPlan | null>('gh_push_plan', { p_ws: ws, p_repo: repo, p_branch: branch, p_limit: limit }),
  async blobBytes(ws, shas) {
    const out = new Map<string, Uint8Array>();
    const unique = [...new Set(shas)];
    for (let i = 0; i < unique.length; i += 200) {
      const rows = await rpc<BlobRow[]>('gh_read_blobs', { p_ws: ws, p_shas: unique.slice(i, i + 200) });
      for (const row of rows) {
        out.set(row.sha256, row.is_binary ? await downloadBinary(row.storage_path!) : new TextEncoder().encode(row.content ?? ''));
      }
    }
    return out;
  },
  recordMirror: async (repo, row) => {
    await rpc('gh_record_mirrors', { p_repo: repo, p_rows: [row] });
  },
  setRemote: async (ws, patch) => {
    await rpc('gh_set_remote', { p_ws: ws, p_patch: patch });
  },
  lastSynced: (ws, repo, branch) => rpc('gh_last_synced', { p_ws: ws, p_repo: repo, p_branch: branch }),
  async commitBySha(repo, sha) {
    const row = await query<{ commit_id: string } | null>(
      db().from('commit_mirrors').select('commit_id').eq('repo_id', repo).eq('git_sha', sha.toLowerCase()).maybeSingle(),
    );
    return row?.commit_id ?? null;
  },
  isAncestor: (a, b) => rpc<boolean>('ws_is_ancestor', { p_a: a, p_b: b }),
  blobsByGit: (ws, shas) => rpc('gh_blobs_by_git', { p_ws: ws, p_git_shas: shas }),
  putFiles: (ws, files) => storeSystemFiles(ws, files),
  importCommit: (ws, a) =>
    rpc('gh_import_commit', {
      p_ws: ws,
      p_branch: a.branch,
      p_parents: a.parents,
      p_expected: a.expected,
      p_manifest: a.manifest,
      p_message: a.message,
      p_origin: a.origin,
      p_repo: a.repo ?? null,
      p_sha: a.sha ?? null,
      p_tree: a.tree ?? null,
      p_force: a.force ?? false,
      p_modes: a.modes && Object.keys(a.modes).length ? a.modes : null,
    }),
  openSyncCr: (ws, source, title, body) => rpc('gh_open_sync_cr', { p_ws: ws, p_source: source, p_title: title, p_body: body }),
  prContext: (cr) => rpc('gh_pr_context', { p_cr: cr }),
  recordPr: async (cr, repo, pr) => {
    await rpc('gh_record_pr', { p_cr: cr, p_repo: repo, p_number: pr.number, p_url: pr.url, p_state: pr.state, p_head: pr.head, p_base: pr.base });
  },
  finishImport: async (ws, state) => {
    await rpc('gh_finish_import', { p_ws: ws, p_state: state });
  },
  link: async (ws, agent, repo, mode, openPrs) => {
    await rpc('gh_link', { p_ws: ws, p_agent: agent, p_user: null, p_repo: repo, p_mode: mode, p_open_prs: openPrs });
  },
  enqueue: async (ws, kind, branch = null) => {
    await rpc('gh_enqueue', { p_ws: ws, p_kind: kind, p_branch: branch, p_cr: null, p_payload: {}, p_delay_seconds: 0 });
  },
  enqueueUnsynced: (ws) => rpc<number>('gh_enqueue_unsynced', { p_ws: ws }),
  async branchExists(ws, branch) {
    const row = await query(db().from('branches').select('name').eq('workspace_id', ws).eq('name', branch).maybeSingle());
    return Boolean(row);
  },
};

// ----------------------------------------------------------------------------- running jobs

export interface Clients {
  installation(id: number): GitHub;
  /** For downloads outside the API (public archives); tests replace it. */
  fetch?: typeof fetch;
}

export const liveClients: Clients = { installation: (id) => installationClient(id) };

/** One job, start to finish; never throws (failures become the job's outcome). */
export async function runJob(job: Job, ctx: JobContext, store: SyncStore, clients: Clients): Promise<Outcome> {
  const ws = ctx.workspace.id;
  const remote = ctx.remote;
  try {
    if (job.kind === 'import') {
      return await importRepository(store, ctx, job.payload as unknown as ImportPayload, (id) => clients.installation(id), clients.fetch ?? fetch);
    }
    if (!remote) return { result: { skipped: 'the workspace is not linked to GitHub any more' } };
    if (remote.status === 'paused') return { result: { skipped: 'the link is paused' } };
    if (remote.status === 'error' && job.kind !== 'link') return { result: { skipped: 'the link needs attention; resync it first' } };
    const gh = clients.installation(remote.installation_id);
    switch (job.kind) {
      case 'link':
        return await link(gh, store, ctx, remote);
      case 'push':
        return await pushBranch(gh, store, ctx, remote, job.branch!);
      case 'pull':
        return await pull(gh, store, ctx, remote);
      case 'pr':
        return await syncPullRequest(gh, store, ctx, remote, job.change_request_id!);
      case 'delete_ref': {
        if (await store.branchExists(ws, job.branch!)) return { result: { skipped: 'the branch exists again' } };
        try {
          await gh.delete(`/repos/${remote.repo}/git/refs/heads/${refPath(MIRROR_PREFIX + job.branch)}`);
        } catch (err) {
          if (!(err instanceof GitHubError) || ![404, 409, 422].includes(err.status)) throw err;
        }
        return { result: { deleted: MIRROR_PREFIX + job.branch } };
      }
      default:
        return { outcome: 'failed', error: `Unknown job kind ${job.kind}` };
    }
  } catch (err) {
    return failure(err, job, ctx, store);
  }
}

async function failure(err: unknown, job: Job, ctx: JobContext, store: SyncStore): Promise<Outcome> {
  const ws = ctx.workspace.id;
  const remote = ctx.remote;
  if (err instanceof GitHubNotConfigured) return { outcome: 'retry', retryAfter: 3600, error: err.message };
  if (err instanceof SyncProblem) {
    if (job.kind === 'import') {
      await store.finishImport(ws, { status: 'failed', error: err.message, finished_at: new Date().toISOString() });
    } else if (remote) {
      await store.setRemote(ws, { status: 'error', detail: err.message });
    }
    return { outcome: 'failed', error: err.message };
  }
  if (err instanceof GitHubError) {
    if (err.retryAfter) return { outcome: 'retry', retryAfter: err.retryAfter + 5, error: err.message };
    if (err.status === 0 || err.status >= 500) return { outcome: 'retry', error: err.message };
    if (remote && (err.status === 401 || /access_tokens/.test(err.message))) {
      // The installation's token was refused: uninstalled or suspended.
      dropInstallationToken(remote.installation_id);
      await store.setRemote(ws, { status: 'paused', detail: 'GitHub refused the app\'s access to this repository (uninstalled or suspended?)' });
      return { outcome: 'failed', error: err.message };
    }
    if (job.kind === 'import') {
      await store.finishImport(ws, { status: 'failed', error: err.message, finished_at: new Date().toISOString() });
      return { outcome: 'failed', error: err.message };
    }
    if (job.attempts >= 3 && remote) {
      await store.setRemote(ws, { status: 'error', detail: `GitHub: ${err.message}` });
      return { outcome: 'failed', error: err.message };
    }
    return { outcome: 'retry', error: err.message };
  }
  if (err instanceof ApiError && err.status === 409) return { outcome: 'retry', retryAfter: 15, error: err.message };
  console.error('github sync job failed', job.kind, err);
  if (job.kind === 'import' && job.attempts >= 2) {
    await store.finishImport(ws, { status: 'failed', error: 'The import stopped unexpectedly', finished_at: new Date().toISOString() });
    return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  return { outcome: 'retry', error: err instanceof Error ? err.message : String(err) };
}

interface Claim {
  workspace_id: string;
  token: string;
  jobs: Job[];
}

/** Claims workspaces one at a time and runs their jobs, for up to ~25 seconds of starting new work. */
export async function drainSync(store: SyncStore = dbStore, clients: Clients = liveClients, budgetMs = 25_000): Promise<number> {
  const started = Date.now();
  let ran = 0;
  while (Date.now() - started < budgetMs) {
    const claim = await rpc<Claim | null>('gh_claim', { p_limit: 10 });
    if (!claim) break;
    try {
      for (const job of claim.jobs) {
        if (Date.now() - started > budgetMs * 4) {
          await rpc('gh_finish_job', { p_job: job.id, p_outcome: 'continue', p_result: null, p_error: null, p_retry_seconds: null });
          continue;
        }
        const ctx = await store.context(claim.workspace_id);
        const outcome: Outcome = ctx ? await runJob(job, ctx, store, clients) : { result: { skipped: 'the workspace is gone' } };
        await rpc('gh_finish_job', {
          p_job: job.id,
          p_outcome: outcome.outcome ?? 'done',
          p_result: outcome.result ?? null,
          p_error: outcome.error ?? null,
          p_retry_seconds: outcome.retryAfter ?? null,
        });
        ran++;
        await rpc('gh_extend_lease', { p_ws: claim.workspace_id, p_token: claim.token });
      }
    } finally {
      await rpc('gh_release_lease', { p_ws: claim.workspace_id, p_token: claim.token }).catch(() => {});
    }
  }
  if (ran) console.log(`github sync: ${ran} job(s)`);
  return ran;
}

let draining: Promise<number> | null = null;

/** Start (or join) a drain in this isolate, in the background when the runtime allows it. */
export function kickSync(): Promise<number> {
  draining ??= drainSync()
    .catch((err) => {
      console.error('github sync worker failed', err);
      return 0;
    })
    .finally(() => {
      draining = null;
    });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(draining);
  return draining;
}
