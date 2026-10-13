// Previews: live pages built from a workspace's files.
//
// A preview pins one commit's folder behind an unguessable id. The web app serves it on its own
// origin inside a CSP sandbox (web/src/app/pv); it fetches each file from here, so no storage key
// lives on the web host. This layer publishes (after a lint for the mistakes that break previews),
// lists and revokes them, and answers "what is at this path".
import { db, rpc } from '../lib/db.ts';
import { ApiError, CORS_HEADERS } from '../lib/http.ts';
import { bool, int, type Input, oneOf, str } from '../lib/validate.ts';
import { type Ctx, gate, limit, networkOf, requireAgent } from './context.ts';

const BUCKET = 'workspace-blobs';
const PREVIEW_ID = /^[0-9a-f]{20}$/;

// What the lint reads: text files of the served folder, a few at a time, so one publish stays cheap.
const LINT_FILES = 40;
const LINT_FILE_MAX = 300_000;
const LINT_BYTES = 2_000_000;
const LINT_WARNINGS = 20;

/** Where previews are served from (a separate origin from the app; cookies and storage are not shared). */
function previewOrigin(): string {
  return (Deno.env.get('PREVIEW_ORIGIN') ?? 'https://posterity-preview.vercel.app').replace(/\/+$/, '');
}

export const previewUrl = (id: string) => `${previewOrigin()}/${id}/`;

const withUrl = <T extends { id: string }>(preview: T) => ({ ...preview, url: previewUrl(preview.id) });

// ----------------------------------------------------------------------------- lint

interface TreeEntry {
  path: string;
  sha256: string;
  size: number;
  binary: boolean;
}

interface Warning {
  file: string;
  line: number | null;
  message: string;
}

// Root-relative references: "/assets/app.js" points at the preview host's root, not at the preview.
const ABSOLUTE_ATTR = /\b(?:src|href|action|poster)\s*=\s*(["'])(\/(?!\/)[^"']*)\1/gi;
const ABSOLUTE_URL = /url\(\s*(["']?)(\/(?!\/)[^)"']*)\1\s*\)/gi;
const STORAGE_API = /\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Mistakes that make a built page break under /<preview-id>/, found in the files about to be served. */
export function lintFiles(files: { path: string; text: string }[]): Warning[] {
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const add = (w: Warning) => {
    const key = `${w.file}:${w.message}`;
    if (warnings.length < LINT_WARNINGS && !seen.has(key)) {
      seen.add(key);
      warnings.push(w);
    }
  };
  for (const { path, text } of files) {
    const lower = path.toLowerCase();
    const markup = lower.endsWith('.html') || lower.endsWith('.htm');
    const style = lower.endsWith('.css');
    if (markup) {
      for (const m of text.matchAll(ABSOLUTE_ATTR)) {
        add({
          file: path,
          line: lineOf(text, m.index ?? 0),
          message: `"${m[2].slice(0, 80)}" is an absolute path. A preview is served under /<id>/, so it points outside the preview. Use a relative path ("${m[2].replace(/^\/+/, './').slice(0, 80)}"), or build with a relative base (Vite: base: "./").`,
        });
      }
    }
    if (markup || style) {
      for (const m of text.matchAll(ABSOLUTE_URL)) {
        add({
          file: path,
          line: lineOf(text, m.index ?? 0),
          message: `url(${m[2].slice(0, 80)}) is an absolute path and will not load under /<id>/. Use a relative path.`,
        });
      }
    }
    if ((markup || lower.endsWith('.js') || lower.endsWith('.mjs')) && STORAGE_API.test(text)) {
      add({
        file: path,
        line: null,
        message: 'Uses browser storage (localStorage, sessionStorage, IndexedDB or cookies). Previews run in a sandbox without it: calls throw unless guarded with try/catch.',
      });
    }
  }
  return warnings;
}

interface BlobRow {
  sha256: string;
  size: number;
  binary: boolean;
  content: string | null;
}

async function lintPreview(ws: string, agent: string, commit: string, root: string): Promise<Warning[]> {
  const tree = await rpc<{ entries: TreeEntry[] }>('ws_tree', { p_ws: ws, p_agent: agent, p_ref: commit, p_path: root || null, p_recursive: true });
  const prefix = root ? `${root}/` : '';
  const candidates = tree.entries
    .filter((e) => !e.binary && e.size <= LINT_FILE_MAX && /\.(?:html?|css|m?js)$/i.test(e.path))
    // Pages and styles first: their mistakes break the whole preview.
    .sort((a, b) => Number(/\.html?$/i.test(b.path)) - Number(/\.html?$/i.test(a.path)) || a.path.localeCompare(b.path));
  const chosen: TreeEntry[] = [];
  let bytes = 0;
  for (const e of candidates) {
    if (chosen.length >= LINT_FILES || bytes + e.size > LINT_BYTES) break;
    chosen.push(e);
    bytes += e.size;
  }
  if (!chosen.length) return [];
  const rows = await rpc<BlobRow[]>('ws_read_blobs', { p_ws: ws, p_agent: agent, p_shas: [...new Set(chosen.map((e) => e.sha256))] });
  const bySha = new Map(rows.map((r) => [r.sha256, r.content]));
  return lintFiles(
    chosen.flatMap((e) => {
      const text = bySha.get(e.sha256);
      return typeof text === 'string' ? [{ path: e.path.slice(prefix.length), text }] : [];
    }),
  );
}

// ----------------------------------------------------------------------------- tool

const ACTIONS = ['list', 'get', 'publish', 'revoke'] as const;

export const PREVIEW_READS = new Set(['list', 'get']);

const previewRef = (input: Input) => str(input, 'preview', { required: true, max: 40 })!.toLowerCase();

/**
 * list (workspace, status?), get (preview), publish (workspace, ref? | change_request?, root_dir?,
 * spa_fallback?, label?), revoke (preview, reason?).
 */
export async function previewTool(ctx: Ctx, input: Input) {
  const action = oneOf(input, 'action', ACTIONS) ?? 'list';
  const viewer = ctx.agent?.id ?? null;

  if (action === 'get') {
    return withUrl(await rpc<{ id: string }>('preview_get', { p_id: previewRef(input), p_agent: viewer }));
  }
  if (action === 'revoke') {
    const agent = requireAgent(ctx);
    return withUrl(await rpc<{ id: string }>('preview_revoke', { p_id: previewRef(input), p_agent: agent.id, p_reason: str(input, 'reason', { max: 300 }) ?? null }));
  }

  const slug = str(input, 'workspace', { required: true, max: 80 })!;
  const ws = await rpc<string>('ws_id', { p_ref: slug });
  if (action === 'list') {
    const status = oneOf(input, 'status', ['active', 'revoked', 'all'] as const) ?? 'active';
    const previews = await rpc<{ id: string }[]>('preview_list', { p_ws: ws, p_agent: viewer, p_status: status, p_limit: int(input, 'limit', { min: 1, max: 100 }) ?? 20 });
    return { previews: previews.map(withUrl) };
  }

  const agent = requireAgent(ctx);
  const ref = str(input, 'ref', { max: 100 });
  const crNumber = int(input, 'change_request', { min: 1 });
  const root = (str(input, 'root_dir', { max: 500 }) ?? '').replace(/^\/+|\/+$/g, '');
  const spa = bool(input, 'spa_fallback') ?? false;
  const label = str(input, 'label', { max: 100 });
  const what = crNumber ? `change request #${crNumber}` : (ref ?? 'the default branch');
  await limit(`pv_publish:${agent.id}`, 3600, 30, 'previews per hour');
  await gate(ctx, 'publish_preview', input, `Publish a live preview of ${slug} (${what}${root ? `, folder ${root}` : ''})`);

  // The commit the preview will pin, to lint what it serves. Permission and the rest are the database's.
  let commit: string;
  if (crNumber) {
    await rpc('ws_assert_read', { p_ws: ws, p_agent: agent.id });
    const cr = await rpc<{ head_commit: string | null }>('cr_json', { p_cr: await rpc<string>('cr_id', { p_ws: ws, p_number: crNumber }) });
    if (!cr.head_commit) throw new ApiError(409, 'conflict', `Change request #${crNumber} has no commits to preview`);
    commit = cr.head_commit;
  } else {
    await rpc('ws_assert_read', { p_ws: ws, p_agent: agent.id });
    commit = await rpc<string>('ws_resolve_ref', { p_ws: ws, p_ref: ref ?? '' });
  }
  const warnings = await lintPreview(ws, agent.id, commit, root).catch((err) => {
    // A lint that cannot run must not stop a publish; the database still checks everything that matters.
    console.error('preview lint failed', err);
    return [] as Warning[];
  });

  const preview = await rpc<{ id: string; existed: boolean; warnings: Warning[] }>('preview_publish', {
    p_ws: ws,
    p_agent: agent.id,
    p_ref: ref ?? null,
    p_change_request: crNumber ?? null,
    p_root: root,
    p_spa: spa,
    p_label: label ?? null,
    p_warnings: warnings,
  });
  return {
    ...withUrl(preview),
    next: preview.warnings.length
      ? 'Open the preview and fix the warnings: paths must be relative, and browser storage is unavailable in the sandbox. Publish again from the new commit.'
      : 'Share the url; it shows exactly these files. Publish again after new commits (a preview never changes), and revoke it when it is out of date.',
  };
}

// ----------------------------------------------------------------------------- serving

interface Resolved {
  preview: string;
  workspace: string;
  commit: string;
  label: string;
  published_by: string | null;
  path: string;
  dir: boolean;
  fallback: boolean;
  sha256: string;
  size: number;
  binary: boolean;
  content: string | null;
  storage_path: string | null;
}

/**
 * One file of a preview (?path=, relative to its folder): the bytes, with where they came from in
 * X-Posterity-* headers. The web app's preview origin adds the content type and the sandbox.
 */
export async function previewFile(ctx: Ctx, input: Input) {
  await limit(`pv_serve:${networkOf(ctx.ip)}`, 60, 3000, 'preview file requests');
  const id = previewRef(input);
  if (!PREVIEW_ID.test(id)) throw new ApiError(404, 'not_found', 'Preview not found');
  const file = await rpc<Resolved>('preview_resolve', { p_id: id, p_path: str(input, 'path', { max: 600, trim: false }) ?? '' });
  let bytes: Uint8Array;
  if (file.binary) {
    const { data, error } = await db().storage.from(BUCKET).download(file.storage_path!);
    if (error || !data) throw new ApiError(502, 'storage_error', 'The file could not be read; try again');
    bytes = new Uint8Array(await data.arrayBuffer());
  } else {
    bytes = new TextEncoder().encode(file.content ?? '');
  }
  const header = (value: string) => encodeURIComponent(value).slice(0, 300);
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Posterity-Path': header(file.path),
      'X-Posterity-Dir': file.dir ? '1' : '0',
      'X-Posterity-Fallback': file.fallback ? '1' : '0',
      'X-Posterity-Commit': file.commit,
      'X-Posterity-Workspace': file.workspace,
      'X-Posterity-Label': header(file.label),
      'X-Posterity-Published-By': header(file.published_by ?? ''),
    },
  });
}
