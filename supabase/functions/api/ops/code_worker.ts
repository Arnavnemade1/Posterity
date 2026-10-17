// The code worker: line-level merges and rename searches that merges wait on (merge_jobs), computed
// here and cached in the database (blob_merges, rename_pairs), which then finishes the merges. The
// database wakes it over pg_net; merge endpoints also run a workspace's jobs inline, so a merge an agent
// asks for usually completes in the same request.
import { gitSha1, TEXT_MAX } from '../lib/blobs.ts';
import { db, query, rpc } from '../lib/db.ts';
import { merge3, pairRenames } from '../lib/merge3.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

export interface CodeJob {
  kind: 'content' | 'renames';
  key: string;
  payload: Record<string, unknown>;
  workspace_id: string | null;
}

const RENAME_TEXT_MAX = 200_000;

/** Text of these blobs (binaries and unknown hashes are left out). */
async function texts(shas: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(shas.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 40) {
    const rows = await query<{ sha256: string; content: string | null }[]>(
      db().from('blobs').select('sha256, content').in('sha256', unique.slice(i, i + 40)).eq('is_binary', false),
    );
    for (const row of rows) if (row.content !== null) out.set(row.sha256, row.content);
  }
  return out;
}

const encoder = new TextEncoder();

/** One job, computed and stored. Returns the milliseconds spent computing (not waiting). */
export async function computeJob(job: CodeJob): Promise<number> {
  if (job.kind === 'content') {
    const { base, ours, theirs } = job.payload as { base: string; ours: string; theirs: string };
    const found = await texts([base, ours, theirs]);
    const started = performance.now();
    const missing = (base && !found.has(base)) || !found.has(ours) || !found.has(theirs);
    const result = missing ? null : merge3(base ? found.get(base)! : '', found.get(ours)!, found.get(theirs)!);
    const spent = performance.now() - started;
    const bytes = result ? encoder.encode(result.text) : null;
    const storable = result && bytes && bytes.length <= TEXT_MAX;
    await rpc('code_store_merge', {
      p_base: base,
      p_ours: ours,
      p_theirs: theirs,
      // Unmergeable in time, or too large to store as text: a conflict without markers.
      p_conflict: result ? result.conflict || !storable : true,
      p_content: storable ? result.text : null,
      p_sha1: storable ? await gitSha1(bytes) : null,
      p_hunks: result?.hunks ?? 0,
    });
    return spent;
  }
  const { base_root, side_root, deleted, added } = job.payload as {
    base_root: string;
    side_root: string;
    deleted: { path: string; sha: string }[];
    added: { path: string; sha: string }[];
  };
  const found = await texts([...deleted, ...added].map((f) => f.sha));
  const pick = (files: { path: string; sha: string }[]) =>
    files.flatMap((f) => {
      const text = found.get(f.sha);
      return text !== undefined && text.length <= RENAME_TEXT_MAX ? [{ path: f.path, text }] : [];
    });
  const started = performance.now();
  const pairs = pairRenames(pick(deleted), pick(added));
  const spent = performance.now() - started;
  await rpc('code_store_renames', { p_base_root: base_root, p_side_root: side_root, p_pairs: pairs });
  return spent;
}

/**
 * Run jobs until there are none or `budgetMs` of computing is spent. With a workspace, its jobs are run
 * directly (a merge waiting in this request); otherwise jobs are claimed from the shared queue. Change
 * requests of the workspaces touched are refreshed afterwards.
 */
export async function runCodeJobs(opts: { workspace?: string; budgetMs?: number; wallMs?: number } = {}): Promise<{ done: number; failed: number; more: boolean }> {
  const budget = opts.budgetMs ?? 1000;
  const deadline = Date.now() + (opts.wallMs ?? 20_000);
  let spent = 0;
  let done = 0;
  let failed = 0;
  let more = false;
  const workspaces = new Set<string>();
  while (spent < budget && Date.now() < deadline) {
    const batch = opts.workspace
      ? await query<CodeJob[]>(db().from('merge_jobs').select('kind, key, payload, workspace_id').eq('workspace_id', opts.workspace).limit(20))
      : await rpc<CodeJob[]>('code_claim', { p_limit: 10 });
    if (!batch.length) break;
    let progressed = false;
    for (const job of batch) {
      if (spent >= budget || Date.now() >= deadline) {
        more = true;
        break;
      }
      try {
        spent += await computeJob(job);
        done++;
        progressed = true;
      } catch (err) {
        failed++;
        console.error('code job failed', job.kind, job.key, err);
        await rpc('code_fail_job', { p_kind: job.kind, p_key: job.key, p_error: err instanceof Error ? err.message : String(err) })
          .catch((e) => console.error('code_fail_job failed', e));
      }
      if (job.workspace_id) workspaces.add(job.workspace_id);
    }
    // Inline runs see the same rows until they are stored; stop rather than loop on a failing one.
    if (opts.workspace && !progressed) break;
  }
  if (workspaces.size) {
    await rpc('code_after', { p_workspaces: [...workspaces] }).catch((e) => console.error('code_after failed', e));
    // Queues that waited on these merges move on in calls of their own (see ws_queue_kick).
    for (const ws of workspaces) await rpc('ws_queue_kick', { p_ws: ws }).catch((e) => console.error('ws_queue_kick failed', e));
  }
  return { done, failed, more };
}

let draining: Promise<void> | null = null;

/** The pg_net wake-up: drain the queue, and wake a fresh worker if more is left than one run's budget. */
export function kickCode(): Promise<void> {
  draining ??= runCodeJobs({ budgetMs: 1200, wallMs: 25_000 })
    .then(async ({ done, failed, more }) => {
      console.log(`code worker: ${done} done, ${failed} failed${more ? ', more queued' : ''}`);
      if (more) await rpc('kick_code_worker');
    })
    .catch((err) => console.error('code worker failed', err))
    .finally(() => {
      draining = null;
    });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(draining);
  return draining;
}
