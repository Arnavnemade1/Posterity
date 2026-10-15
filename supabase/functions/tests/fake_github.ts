// An in-memory GitHub for the sync tests: git objects (blobs hashed as git does), trees with base_tree
// and deletions, commits, refs with fast-forward checks, compare, contents (for empty repositories)
// and pull requests. It answers the REST calls the sync makes, through a fetch function.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function sha1(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', new Uint8Array(bytes)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  return sha1(all);
}

function b64(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
}

function unb64(text: string): Uint8Array {
  const raw = atob(text.replace(/\s+/g, ''));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Entry = { mode: string; sha: string };
type Tree = Map<string, Entry>;
interface Commit {
  tree: string;
  parents: string[];
  message: string;
  author: { name: string; email: string; date: string };
}
interface Pull {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  draft: boolean;
}

const json = (status: number, data: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, message: string) => json(status, { message });

export class FakeGitHub {
  readonly base = 'https://api.test';
  readonly blobs = new Map<string, Uint8Array>();
  readonly trees = new Map<string, Tree>();
  readonly commits = new Map<string, Commit>();
  readonly refs = new Map<string, string>();
  readonly pulls: Pull[] = [];
  readonly log: string[] = [];
  repo = { id: 501, full_name: 'acme/site', private: false, archived: false, default_branch: 'main' };
  /** Make the next matching request fail once, e.g. to test resuming a push. */
  failNext: ((method: string, path: string) => boolean) | null = null;
  private counter = 0;

  // ------------------------------------------------------------------ objects

  private async putBlob(bytes: Uint8Array): Promise<string> {
    const sha = await gitBlobSha(bytes);
    this.blobs.set(sha, bytes);
    return sha;
  }

  private async putTree(tree: Tree): Promise<string> {
    const canonical = [...tree.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, e]) => `${e.mode} ${p} ${e.sha}`).join('\n');
    const sha = await sha1(enc.encode(`tree\n${canonical}`));
    this.trees.set(sha, new Map(tree));
    return sha;
  }

  private async putCommit(commit: Commit): Promise<string> {
    const sha = await sha1(enc.encode(JSON.stringify({ ...commit, n: this.counter++ })));
    this.commits.set(sha, commit);
    return sha;
  }

  ancestors(sha: string): Set<string> {
    const seen = new Set<string>();
    const queue = [sha];
    while (queue.length) {
      const s = queue.shift()!;
      if (seen.has(s)) continue;
      seen.add(s);
      queue.push(...(this.commits.get(s)?.parents ?? []));
    }
    return seen;
  }

  isAncestor(a: string, b: string): boolean {
    return this.ancestors(b).has(a);
  }

  /** The files at a branch or commit, as text. */
  files(ref: string): Record<string, string> {
    const sha = this.refs.get(ref) ?? ref;
    const tree = this.trees.get(this.commits.get(sha)!.tree)!;
    return Object.fromEntries([...tree].map(([p, e]) => [p, dec.decode(this.blobs.get(e.sha) ?? new Uint8Array())]));
  }

  modes(ref: string): Record<string, string> {
    const sha = this.refs.get(ref) ?? ref;
    const tree = this.trees.get(this.commits.get(sha)!.tree)!;
    return Object.fromEntries([...tree].map(([p, e]) => [p, e.mode]));
  }

  /** A person pushing to GitHub: files to set (text, or {content, mode}) or remove (null). */
  async humanCommit(branch: string, changes: Record<string, string | { content: string; mode: string } | null>, message = 'Change on GitHub'): Promise<string> {
    const head = this.refs.get(branch);
    const tree: Tree = head ? new Map(this.trees.get(this.commits.get(head)!.tree)!) : new Map();
    for (const [path, value] of Object.entries(changes)) {
      if (value === null) tree.delete(path);
      else if (typeof value === 'string') tree.set(path, { mode: tree.get(path)?.mode ?? '100644', sha: await this.putBlob(enc.encode(value)) });
      else tree.set(path, { mode: value.mode, sha: await this.putBlob(enc.encode(value.content)) });
    }
    const sha = await this.putCommit({
      tree: await this.putTree(tree),
      parents: head ? [head] : [],
      message,
      author: { name: 'Octo Human', email: 'octo@example.com', date: new Date().toISOString() },
    });
    this.refs.set(branch, sha);
    return sha;
  }

  // ------------------------------------------------------------------ the REST surface

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname;
    this.log.push(`${method} ${path}`);
    if (this.failNext?.(method, path)) {
      this.failNext = null;
      return fail(502, 'Server Error');
    }
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const prefix = `/repos/${this.repo.full_name}`;
    if (!path.startsWith(prefix)) return fail(404, 'Not Found');
    const rest = path.slice(prefix.length);
    const empty = this.refs.size === 0;

    if (rest === '' && method === 'GET') return json(200, this.repo);
    if (rest === '/branches' && method === 'GET') return json(200, [...this.refs.keys()].slice(0, 1).map((name) => ({ name })));

    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\/git\/ref\/heads\/(.+)$/)) && method === 'GET') {
      if (empty) return fail(409, 'Git Repository is empty.');
      const sha = this.refs.get(decodeURIComponent(m[1]));
      return sha ? json(200, { object: { sha } }) : fail(404, 'Not Found');
    }
    if (rest.startsWith('/git/') && method !== 'GET' && empty && !rest.startsWith('/git/refs/heads')) {
      return fail(409, 'Git Repository is empty.');
    }
    if (rest === '/git/refs' && method === 'POST') {
      if (empty) return fail(422, 'Reference cannot be created in an empty repository');
      const name = String(body.ref).replace(/^refs\/heads\//, '');
      if (this.refs.has(name)) return fail(422, 'Reference already exists');
      if (!this.commits.has(body.sha)) return fail(422, 'Object does not exist');
      this.refs.set(name, body.sha);
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if ((m = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const name = decodeURIComponent(m[1]);
      const current = this.refs.get(name);
      if (method === 'PATCH') {
        if (!current) return fail(422, 'Reference does not exist');
        if (!this.commits.has(body.sha)) return fail(422, 'Object does not exist');
        if (!body.force && !this.isAncestor(current, body.sha)) return fail(422, 'Update is not a fast forward');
        this.refs.set(name, body.sha);
        return json(200, { object: { sha: body.sha } });
      }
      if (method === 'DELETE') {
        if (!current) return fail(422, 'Reference does not exist');
        this.refs.delete(name);
        return json(204, null);
      }
    }
    if (rest === '/git/blobs' && method === 'POST') {
      const bytes = body.encoding === 'base64' ? unb64(body.content) : enc.encode(body.content);
      return json(201, { sha: await this.putBlob(bytes) });
    }
    if ((m = rest.match(/^\/git\/blobs\/([0-9a-f]{40})$/)) && method === 'GET') {
      const bytes = this.blobs.get(m[1]);
      return bytes ? json(200, { sha: m[1], content: b64(bytes), encoding: 'base64', size: bytes.length }) : fail(404, 'Not Found');
    }
    if (rest === '/git/trees' && method === 'POST') {
      const tree: Tree = body.base_tree ? new Map(this.trees.get(body.base_tree) ?? []) : new Map();
      if (body.base_tree && !this.trees.has(body.base_tree)) return fail(422, 'base_tree is not a tree');
      for (const e of body.tree as { path: string; mode: string; sha?: string | null; content?: string }[]) {
        if (e.sha === null) {
          if (!tree.has(e.path)) return fail(422, `${e.path} does not exist`);
          tree.delete(e.path);
        } else if (e.content !== undefined) {
          if (e.sha !== undefined) return fail(422, 'sha and content are mutually exclusive');
          tree.set(e.path, { mode: e.mode, sha: await this.putBlob(enc.encode(e.content)) });
        } else {
          if (!this.blobs.has(e.sha!)) return fail(422, `blob ${e.sha} does not exist`);
          tree.set(e.path, { mode: e.mode, sha: e.sha! });
        }
      }
      return json(201, { sha: await this.putTree(tree) });
    }
    if ((m = rest.match(/^\/git\/trees\/([0-9a-f]{40})$/)) && method === 'GET') {
      const tree = this.trees.get(m[1]);
      if (!tree) return fail(404, 'Not Found');
      return json(200, {
        sha: m[1],
        truncated: false,
        tree: [...tree].map(([path, e]) => ({
          path,
          mode: e.mode,
          type: e.mode === '160000' ? 'commit' : 'blob',
          sha: e.sha,
          size: this.blobs.get(e.sha)?.length ?? 0,
        })),
      });
    }
    if (rest === '/git/commits' && method === 'POST') {
      if (!this.trees.has(body.tree)) return fail(422, 'tree does not exist');
      for (const p of body.parents) if (!this.commits.has(p)) return fail(422, `parent ${p} does not exist`);
      const sha = await this.putCommit({ tree: body.tree, parents: body.parents, message: body.message, author: body.author });
      return json(201, { sha });
    }
    if ((m = rest.match(/^\/git\/commits\/([0-9a-f]{40})$/)) && method === 'GET') {
      const c = this.commits.get(m[1]);
      if (!c) return fail(404, 'Not Found');
      return json(200, { sha: m[1], tree: { sha: c.tree }, message: c.message, author: c.author, parents: c.parents.map((sha) => ({ sha })) });
    }
    if ((m = rest.match(/^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/)) && method === 'GET') {
      const [, base, head] = m;
      const headAnc = this.ancestors(head);
      const baseAnc = this.ancestors(base);
      const ahead = [...headAnc].filter((s) => !baseAnc.has(s));
      const status = base === head ? 'identical' : headAnc.has(base) ? 'ahead' : baseAnc.has(head) ? 'behind' : 'diverged';
      // Nearest common ancestor, walking back from head.
      let mergeBase = '';
      const queue = [head];
      const seen = new Set<string>();
      while (queue.length && !mergeBase) {
        const s = queue.shift()!;
        if (seen.has(s)) continue;
        seen.add(s);
        if (baseAnc.has(s)) mergeBase = s;
        queue.push(...(this.commits.get(s)?.parents ?? []));
      }
      return json(200, {
        status,
        merge_base_commit: { sha: mergeBase },
        total_commits: ahead.length,
        commits: ahead.reverse().map((sha) => ({ sha, commit: { message: this.commits.get(sha)!.message, author: { name: this.commits.get(sha)!.author.name } } })),
      });
    }
    if ((m = rest.match(/^\/contents\/(.+)$/)) && method === 'PUT') {
      const head = this.refs.get(this.repo.default_branch);
      const tree: Tree = head ? new Map(this.trees.get(this.commits.get(head)!.tree)!) : new Map();
      tree.set(decodeURIComponent(m[1]), { mode: '100644', sha: await this.putBlob(unb64(body.content)) });
      const sha = await this.putCommit({
        tree: await this.putTree(tree),
        parents: head ? [head] : [],
        message: body.message,
        author: { name: 'posterity[bot]', email: 'bot@example.com', date: new Date().toISOString() },
      });
      this.refs.set(this.repo.default_branch, sha);
      return json(201, { commit: { sha } });
    }
    if (rest === '/pulls' && method === 'POST') {
      const head = this.refs.get(body.head);
      const base = this.refs.get(body.base);
      if (!head || !base) return fail(422, 'Validation Failed: head or base invalid');
      if (this.pulls.some((p) => p.state === 'open' && p.head === body.head)) {
        return json(422, { message: 'Validation Failed', errors: [{ message: `A pull request already exists for acme:${body.head}.` }] });
      }
      const common = [...this.ancestors(head)].some((s) => this.ancestors(base).has(s));
      if (!common) return json(422, { message: 'Validation Failed', errors: [{ message: `The ${body.head} branch has no history in common with ${body.base}` }] });
      if (this.isAncestor(head, base)) return json(422, { message: 'Validation Failed', errors: [{ message: `No commits between ${body.base} and ${body.head}` }] });
      const pr: Pull = { number: this.pulls.length + 1, head: body.head, base: body.base, title: body.title, body: body.body, state: 'open', draft: Boolean(body.draft) };
      this.pulls.push(pr);
      return json(201, { number: pr.number, html_url: `https://github.com/${this.repo.full_name}/pull/${pr.number}` });
    }
    if ((m = rest.match(/^\/pulls\/(\d+)$/)) && method === 'PATCH') {
      const pr = this.pulls.find((p) => p.number === Number(m![1]));
      if (!pr) return fail(404, 'Not Found');
      Object.assign(pr, body);
      return json(200, { number: pr.number });
    }
    if (rest === '/pulls' && method === 'GET') {
      const head = (url.searchParams.get('head') ?? '').split(':')[1];
      return json(200, this.pulls.filter((p) => p.state === 'open' && (!head || p.head === head))
        .map((p) => ({ number: p.number, html_url: `https://github.com/${this.repo.full_name}/pull/${p.number}`, base: { ref: p.base } })));
    }
    return fail(404, `Not Found: ${method} ${rest}`);
  };
}
