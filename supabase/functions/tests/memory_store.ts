// An in-memory workspace for the sync tests: commits with flat manifests, branches, blobs, mirrors,
// change requests and a job queue, behaving like phase11_github.sql (push plans skip the empty first
// commit; moving a linked branch queues a push; system imports bypass protection).
import { type HashedFile, hashFile } from '../api/lib/blobs.ts';
import { ApiError } from '../api/lib/http.ts';
import type { ImportArgs, Job, JobContext, PrContext, PushPlan, Remote, SyncStore } from '../api/ops/github_sync.ts';

interface MCommit {
  id: string;
  parents: string[];
  manifest: Record<string, string>;
  message: string;
  author: string | null;
  generation: number;
  created_at: string;
  origin: Record<string, unknown> | null;
}

export interface Queued {
  kind: Job['kind'];
  branch?: string | null;
  cr?: string | null;
  payload?: Record<string, unknown>;
}

const enc = new TextEncoder();

export class MemoryStore implements SyncStore {
  ws = { id: 'ws-1', slug: 'site', name: 'Site', default_branch: 'main', visibility: 'public', created_by: 'agent-1' };
  site = 'https://posterity.test';
  remote: Remote | null = null;
  commits = new Map<string, MCommit>();
  branches = new Map<string, string>();
  blobs = new Map<string, HashedFile>();
  mirrors = new Map<string, { sha: string; tree: string; direction: string }>();
  bySha = new Map<string, string>();
  queue: Queued[] = [];
  crs = new Map<string, PrContext>();
  importState: Record<string, unknown> = {};
  private n = 0;

  static create(): MemoryStore {
    const s = new MemoryStore();
    const id = s.newId();
    s.commits.set(id, { id, parents: [], manifest: {}, message: 'Create Site', author: 'alice', generation: 1, created_at: new Date().toISOString(), origin: null });
    s.branches.set('main', id);
    return s;
  }

  private newId(): string {
    return (++this.n).toString(16).padStart(64, '0');
  }

  link(_ws: string, _agent: string, repo: string, mode: string, openPrs: boolean): Promise<void> {
    this.remote = {
      workspace_id: this.ws.id,
      installation_id: 1,
      repo_id: 501,
      repo,
      private: false,
      default_branch: 'main',
      mode: mode as Remote['mode'],
      open_prs: openPrs,
      status: 'linking',
      bootstrap_sha: null,
      sync_change_request: null,
    };
    this.queue = this.queue.filter((q) => q.kind === 'import');
    this.queue.push({ kind: 'link' });
    return Promise.resolve();
  }

  private isVirtual(id: string): boolean {
    const c = this.commits.get(id)!;
    return c.parents.length === 0 && Object.keys(c.manifest).length === 0;
  }

  private mirrorOf(id: string) {
    return this.remote ? this.mirrors.get(`${this.remote.repo_id}:${id}`) ?? null : null;
  }

  private moveBranch(branch: string, head: string): void {
    this.branches.set(branch, head);
    if (this.remote && ['active', 'diverged'].includes(this.remote.status) && !branch.startsWith('github/')) this.enqueuePush(branch);
  }

  private enqueuePush(branch: string): void {
    if (!this.queue.some((q) => q.kind === 'push' && q.branch === branch)) this.queue.push({ kind: 'push', branch });
  }

  // ------------------------------------------------------------------ what agents do

  async commit(branch: string, changes: Record<string, string | null>, message = 'Change', parents?: string[]): Promise<string> {
    const head = this.branches.get(branch) ?? this.branches.get(this.ws.default_branch)!;
    const base = parents ?? [head];
    const manifest = { ...this.commits.get(base[0])!.manifest };
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) delete manifest[path];
      else {
        const file = await hashFile(enc.encode(text));
        this.blobs.set(file.sha256, file);
        manifest[path] = file.sha256;
      }
    }
    const id = this.newId();
    const generation = Math.max(...base.map((p) => this.commits.get(p)!.generation)) + 1;
    this.commits.set(id, { id, parents: base, manifest, message, author: 'alice', generation, created_at: new Date().toISOString(), origin: null });
    this.moveBranch(branch, id);
    return id;
  }

  /** Merge `from` into `into` (file level, `from` wins where it changed). */
  async merge(into: string, from: string, message = 'Merge'): Promise<string> {
    const ours = this.branches.get(into)!;
    const theirs = this.branches.get(from)!;
    const base = this.mergeBase(ours, theirs);
    const b = this.commits.get(base)!.manifest;
    const o = this.commits.get(ours)!.manifest;
    const t = this.commits.get(theirs)!.manifest;
    const manifest: Record<string, string> = {};
    for (const path of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
      const value = t[path] !== b[path] ? t[path] : o[path];
      if (value) manifest[path] = value;
    }
    const id = this.newId();
    const generation = Math.max(this.commits.get(ours)!.generation, this.commits.get(theirs)!.generation) + 1;
    this.commits.set(id, { id, parents: [ours, theirs], manifest, message, author: 'alice', generation, created_at: new Date().toISOString(), origin: null });
    this.moveBranch(into, id);
    return Promise.resolve(id);
  }

  ancestors(id: string): Set<string> {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const c = queue.shift()!;
      if (seen.has(c)) continue;
      seen.add(c);
      queue.push(...this.commits.get(c)!.parents);
    }
    return seen;
  }

  private mergeBase(a: string, b: string): string {
    const anc = this.ancestors(b);
    return [...this.ancestors(a)].filter((c) => anc.has(c)).sort((x, y) => this.commits.get(y)!.generation - this.commits.get(x)!.generation)[0];
  }

  files(branch: string): Record<string, string> {
    const manifest = this.commits.get(this.branches.get(branch)!)!.manifest;
    return Object.fromEntries(Object.entries(manifest).map(([p, sha]) => [p, new TextDecoder().decode(this.blobs.get(sha)!.bytes)]));
  }

  openCr(source: string, target = 'main', title = 'A change'): string {
    const id = `cr-${this.crs.size + 1}`;
    this.crs.set(id, {
      id, number: this.crs.size + 1, title, body: 'What it does.', status: 'open', source, target, author: 'alice',
      workspace: this.ws.slug, default_branch: this.ws.default_branch, source_head: this.branches.get(source) ?? null, pull_request: null,
    });
    if (this.remote?.open_prs) this.queue.push({ kind: 'pr', cr: id });
    return id;
  }

  // ------------------------------------------------------------------ SyncStore

  context(): Promise<JobContext | null> {
    return Promise.resolve({
      workspace: { ...this.ws, head: this.branches.get(this.ws.default_branch) ?? null },
      site: this.site,
      remote: this.remote ? { ...this.remote } : null,
      import: this.importState,
    });
  }

  pushPlan(_ws: string, repo: number, branch: string, limit: number): Promise<PushPlan | null> {
    const head = this.branches.get(branch);
    if (!head) return Promise.resolve(null);
    const mirrored = (id: string) => this.mirrors.has(`${repo}:${id}`);
    const todo: MCommit[] = [];
    const seen = new Set<string>();
    const queue = mirrored(head) ? [] : [head];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const c = this.commits.get(id)!;
      if (!this.isVirtual(id)) todo.push(c);
      for (const p of c.parents) if (!mirrored(p)) queue.push(p);
    }
    todo.sort((a, b) => a.generation - b.generation || a.id.localeCompare(b.id));
    const picked = todo.slice(0, limit);
    const headMirror = this.mirrors.get(`${repo}:${head}`) ?? null;
    return Promise.resolve({
      branch,
      head,
      head_mirror: headMirror ? { sha: headMirror.sha, tree: headMirror.tree } : null,
      empty: this.isVirtual(head) && !headMirror,
      total: todo.length,
      more: todo.length > picked.length,
      commits: picked.map((c) => {
        const before = c.parents.length ? this.commits.get(c.parents[0])!.manifest : {};
        const paths = new Set([...Object.keys(before), ...Object.keys(c.manifest)]);
        return {
          id: c.id,
          message: c.message,
          created_at: c.created_at,
          author: c.author ? { handle: c.author, name: c.author } : null,
          parents: c.parents.map((p) => {
            const m = this.mirrors.get(`${repo}:${p}`);
            return { id: p, sha: m?.sha ?? null, tree: m?.tree ?? null, virtual: this.isVirtual(p) };
          }),
          changes: [...paths].sort().filter((p) => before[p] !== c.manifest[p]).map((p) => {
            const blob = c.manifest[p] ? this.blobs.get(c.manifest[p])! : null;
            return { path: p, sha256: c.manifest[p] ?? null, git_sha1: blob?.git_sha1 ?? null, binary: blob ? blob.text === null : null, size: blob?.size ?? null, existed: p in before };
          }),
        };
      }),
    });
  }

  blobBytes(_ws: string, shas: string[]): Promise<Map<string, Uint8Array>> {
    return Promise.resolve(new Map(shas.map((s) => [s, this.blobs.get(s)!.bytes])));
  }

  recordMirror(repo: number, row: { commit: string; sha: string; tree: string; direction: 'out' | 'in' }): Promise<void> {
    const key = `${repo}:${row.commit}`;
    if (!this.mirrors.has(key) && !this.bySha.has(`${repo}:${row.sha}`)) {
      this.mirrors.set(key, { sha: row.sha, tree: row.tree, direction: row.direction });
      this.bySha.set(`${repo}:${row.sha}`, row.commit);
    }
    return Promise.resolve();
  }

  setRemote(_ws: string, patch: Record<string, unknown>): Promise<void> {
    if (!this.remote) return Promise.resolve();
    const r = this.remote;
    if (patch.status) r.status = patch.status as Remote['status'];
    if ('bootstrap_sha' in patch) r.bootstrap_sha = patch.bootstrap_sha as string;
    if (patch.default_branch) r.default_branch = patch.default_branch as string;
    if (patch.repo) r.repo = patch.repo as string;
    if (typeof patch.private === 'boolean') r.private = patch.private;
    if (patch.status === 'active') r.sync_change_request = null;
    (r as Remote & { detail?: unknown }).detail = patch.detail ?? (patch.status === 'active' ? null : (r as Remote & { detail?: unknown }).detail);
    return Promise.resolve();
  }

  lastSynced(_ws: string, repo: number, branch: string) {
    const head = this.branches.get(branch);
    if (!head) return Promise.resolve(null);
    const found = [...this.ancestors(head)].filter((id) => this.mirrors.has(`${repo}:${id}`))
      .sort((a, b) => this.commits.get(b)!.generation - this.commits.get(a)!.generation)[0] ?? null;
    return Promise.resolve({ head, commit: found, sha: found ? this.mirrors.get(`${repo}:${found}`)!.sha : null });
  }

  commitBySha(repo: number, sha: string): Promise<string | null> {
    return Promise.resolve(this.bySha.get(`${repo}:${sha}`) ?? null);
  }

  isAncestor(a: string, b: string): Promise<boolean> {
    return Promise.resolve(this.ancestors(b).has(a));
  }

  blobsByGit(_ws: string, shas: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const f of this.blobs.values()) if (shas.includes(f.git_sha1)) out[f.git_sha1] = f.sha256;
    return Promise.resolve(out);
  }

  putFiles(_ws: string, files: HashedFile[]): Promise<void> {
    for (const f of files) this.blobs.set(f.sha256, f);
    return Promise.resolve();
  }

  importCommit(_ws: string, a: ImportArgs): Promise<{ commit: string; existed: boolean }> {
    if (a.sha && this.bySha.has(`${a.repo}:${a.sha}`)) return Promise.resolve({ commit: this.bySha.get(`${a.repo}:${a.sha}`)!, existed: true });
    for (const sha of Object.values(a.manifest)) if (!this.blobs.has(sha)) throw new ApiError(400, 'bad_request', 'unknown blob');
    const current = this.branches.get(a.branch);
    if (current && !a.force && a.expected && current !== a.expected) throw new ApiError(409, 'conflict', 'head_moved');
    const id = this.newId();
    const generation = Math.max(...a.parents.map((p) => this.commits.get(p)!.generation)) + 1;
    this.commits.set(id, { id, parents: a.parents, manifest: a.manifest, message: a.message, author: null, generation, created_at: new Date().toISOString(), origin: a.origin });
    if (a.sha) {
      this.mirrors.set(`${a.repo}:${id}`, { sha: a.sha, tree: a.tree!, direction: 'in' });
      this.bySha.set(`${a.repo}:${a.sha}`, id);
    }
    this.moveBranch(a.branch, id);
    return Promise.resolve({ commit: id, existed: false });
  }

  openSyncCr(_ws: string, source: string): Promise<{ number: number }> {
    const existing = [...this.crs.values()].find((c) => c.source === source && c.status === 'open');
    if (existing) return Promise.resolve({ number: existing.number });
    const id = this.openCr(source, this.ws.default_branch, 'Bring in main from GitHub');
    return Promise.resolve({ number: this.crs.get(id)!.number });
  }

  prContext(cr: string): Promise<PrContext | null> {
    const c = this.crs.get(cr);
    return Promise.resolve(c ? { ...c, source_head: this.branches.get(c.source) ?? null } : null);
  }

  recordPr(cr: string, _repo: number, pr: { number: number; url: string; state: string; head: string; base: string }): Promise<void> {
    this.crs.get(cr)!.pull_request = { number: pr.number, url: pr.url, state: pr.state, head_ref: pr.head, base_ref: pr.base };
    return Promise.resolve();
  }

  finishImport(_ws: string, state: Record<string, unknown>): Promise<void> {
    Object.assign(this.importState, state);
    return Promise.resolve();
  }

  enqueue(_ws: string, kind: Job['kind'], branch: string | null = null): Promise<void> {
    if (!this.queue.some((q) => q.kind === kind && (q.branch ?? null) === branch)) this.queue.push({ kind, branch });
    return Promise.resolve();
  }

  enqueueUnsynced(): Promise<number> {
    let n = 0;
    for (const [name, head] of this.branches) {
      if (name.startsWith('github/') || this.mirrorOf(head) || this.isVirtual(head)) continue;
      this.enqueuePush(name);
      n++;
    }
    if (this.remote?.open_prs) {
      for (const cr of this.crs.values()) {
        if (cr.status === 'open' && !cr.pull_request && !cr.source.startsWith('github/')) {
          this.queue.push({ kind: 'pr', cr: cr.id });
          n++;
        }
      }
    }
    return Promise.resolve(n);
  }

  branchExists(_ws: string, branch: string): Promise<boolean> {
    return Promise.resolve(this.branches.has(branch));
  }
}
