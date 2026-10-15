// File contents as workspaces store them: hashed twice (sha256 for Posterity, git's sha1 for GitHub),
// text inline in the database, binaries in a private Storage bucket.
import { db, query, rpc } from './db.ts';
import { ApiError } from './http.ts';

export const BUCKET = 'workspace-blobs';
export const TEXT_MAX = 1_048_576;
export const BLOB_MAX = 5_242_880;

async function digest(algorithm: 'SHA-256' | 'SHA-1', bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(bytes)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const sha256Hex = (bytes: Uint8Array) => digest('SHA-256', bytes);

/** Git's blob id, so a workspace can mirror to GitHub without rehashing. */
export function gitSha1(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  return digest('SHA-1', all);
}

/** The bytes as text when they are text: valid UTF-8 without NUL bytes, at most 1 MB. */
export function asText(bytes: Uint8Array): string | null {
  if (bytes.length > TEXT_MAX || bytes.includes(0)) return null;
  try {
    // ignoreBOM keeps a byte order mark, so the text re-encodes to exactly these bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function fromBase64(data: string, what: string): Uint8Array {
  try {
    const raw = atob(data.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    throw new ApiError(400, 'bad_request', `${what} must be base64`);
  }
}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export const storagePath = (sha256: string) => `${sha256.slice(0, 2)}/${sha256}`;

export async function downloadBinary(path: string): Promise<Uint8Array> {
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error || !data) throw new ApiError(502, 'storage_error', 'A file could not be read; try again');
  return new Uint8Array(await data.arrayBuffer());
}

export interface HashedFile {
  sha256: string;
  git_sha1: string;
  size: number;
  text: string | null;
  bytes: Uint8Array;
}

export async function hashFile(bytes: Uint8Array): Promise<HashedFile> {
  if (bytes.length > BLOB_MAX) throw new ApiError(413, 'payload_too_large', `A file can be at most ${BLOB_MAX / 1_048_576} MB`);
  const [sha256, git] = await Promise.all([sha256Hex(bytes), gitSha1(bytes)]);
  return { sha256, git_sha1: git, size: bytes.length, text: asText(bytes), bytes };
}

const ROW_BUDGET = 3_000_000;

/**
 * Store files that came from outside (GitHub) in a workspace, without an agent's upload rights: the
 * worker vouches for them. Binaries go to Storage first; the rows go in a few batched calls.
 */
export async function storeSystemFiles(ws: string, files: HashedFile[]): Promise<void> {
  if (!files.length) return;
  const binaries = files.filter((f) => f.text === null);
  if (binaries.length) {
    const known = new Set(
      (await query<{ sha256: string }[]>(db().from('blobs').select('sha256').in('sha256', binaries.map((f) => f.sha256)))).map((r) => r.sha256),
    );
    for (const f of binaries) {
      if (known.has(f.sha256)) continue;
      const { error } = await db().storage.from(BUCKET).upload(storagePath(f.sha256), f.bytes, { contentType: 'application/octet-stream', upsert: true });
      if (error) throw new ApiError(502, 'upload_failed', `A file could not be stored: ${error.message}`);
    }
  }
  let batch: Record<string, unknown>[] = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length) await rpc('gh_add_blobs', { p_ws: ws, p_blobs: batch });
    batch = [];
    bytes = 0;
  };
  for (const f of files) {
    const row = f.text === null
      ? { sha256: f.sha256, git_sha1: f.git_sha1, size: f.size, binary: true, storage_path: storagePath(f.sha256) }
      : { sha256: f.sha256, git_sha1: f.git_sha1, size: f.size, binary: false, content: f.text };
    if (batch.length && (bytes + f.size > ROW_BUDGET || batch.length >= 500)) await flush();
    batch.push(row);
    bytes += f.text === null ? 100 : f.size;
  }
  await flush();
}
