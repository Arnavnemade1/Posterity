// A streaming reader for tar archives (ustar, pax and GNU long names), enough for the tarballs GitHub
// serves. Files over the size limit are skipped without being held in memory.

export interface TarEntry {
  type: 'file' | 'dir' | 'symlink' | 'other' | 'global';
  path: string;
  size: number;
  /** Unix permission bits, e.g. 0o755. */
  mode: number;
  /** The file's bytes, or null when skipped (too big, or not a file). */
  data: Uint8Array | null;
  /** pax records: a global header's (GitHub puts the commit id in "comment"), or the entry's own. */
  pax: Record<string, string>;
}

export class TarError extends Error {}

class Reader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private done = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(stream: ReadableStream<Uint8Array>, private readonly maxBytes: number) {
    this.reader = stream.getReader();
  }

  /** Bytes read from the stream so far, for the size limit. */
  consumed = 0;

  private async fill(n: number): Promise<boolean> {
    while (this.buffered < n && !this.done) {
      const { value, done } = await this.reader.read();
      if (done) {
        this.done = true;
        break;
      }
      if (value?.length) {
        this.chunks.push(value);
        this.buffered += value.length;
        this.consumed += value.length;
        if (this.consumed > this.maxBytes) {
          await this.reader.cancel().catch(() => {});
          throw new TarError(`The archive is larger than ${Math.round(this.maxBytes / 1_048_576)} MB`);
        }
      }
    }
    return this.buffered >= n;
  }

  /** Exactly n bytes, or null at the end of the stream. */
  async read(n: number): Promise<Uint8Array | null> {
    if (!(await this.fill(n))) return null;
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const head = this.chunks[0];
      const take = Math.min(head.length, n - offset);
      out.set(head.subarray(0, take), offset);
      offset += take;
      if (take === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(take);
    }
    this.buffered -= n;
    return out;
  }

  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (!this.buffered && !(await this.fill(1))) throw new TarError('The archive ends in the middle of a file');
      const head = this.chunks[0];
      const take = Math.min(head.length, left);
      if (take === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(take);
      this.buffered -= take;
      left -= take;
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => {});
  }
}

const decoder = new TextDecoder();

function cstring(block: Uint8Array, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
}

function number(block: Uint8Array, offset: number, length: number): number {
  // Base-256 for values octal cannot hold (GNU): the high bit of the first byte is set.
  if (block[offset] & 0x80) {
    let value = block[offset] & 0x7f;
    for (let i = 1; i < length; i++) value = value * 256 + block[offset + i];
    return value;
  }
  const text = cstring(block, offset, length).trim();
  return text ? parseInt(text, 8) : 0;
}

function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const text = decoder.decode(data);
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space === -1) break;
    const length = parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, i + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += length;
  }
  return out;
}

const pad = (size: number) => (512 - (size % 512)) % 512;

/**
 * The entries of a tar stream, in order. Files up to maxFileBytes come with their bytes; bigger ones
 * are skipped (data null). The whole stream may be at most maxStreamBytes.
 */
export async function* readTar(
  stream: ReadableStream<Uint8Array>,
  opts: { maxFileBytes: number; maxStreamBytes: number },
): AsyncGenerator<TarEntry> {
  const reader = new Reader(stream, opts.maxStreamBytes);
  let pax: Record<string, string> = {};
  let longName: string | null = null;
  try {
    while (true) {
      const block = await reader.read(512);
      if (!block || block.every((b) => b === 0)) break;
      const typeflag = String.fromCharCode(block[156] || 48);
      let size = number(block, 124, 12);
      const mode = number(block, 100, 8);
      const magic = cstring(block, 257, 6);
      const prefix = magic.startsWith('ustar') ? cstring(block, 345, 155) : '';
      const name = cstring(block, 0, 100);

      if (typeflag === 'x' || typeflag === 'g' || typeflag === 'L') {
        const data = await reader.read(size);
        if (!data) throw new TarError('The archive ends in the middle of a header');
        await reader.skip(pad(size));
        if (typeflag === 'g') yield { type: 'global', path: '', size: 0, mode: 0, data: null, pax: parsePax(data) };
        else if (typeflag === 'x') pax = parsePax(data);
        else longName = decoder.decode(data).replace(/\0+$/, '');
        continue;
      }

      const path = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
      if (pax.size) size = Number(pax.size);
      const entryPax = pax;
      pax = {};
      longName = null;
      const type = typeflag === '0' || typeflag === '7' ? 'file' : typeflag === '5' ? 'dir' : typeflag === '2' ? 'symlink' : 'other';
      let data: Uint8Array | null = null;
      if (type === 'file' && size <= opts.maxFileBytes) {
        data = await reader.read(size);
        if (!data) throw new TarError('The archive ends in the middle of a file');
      } else {
        await reader.skip(size);
      }
      await reader.skip(pad(size));
      yield { type, path, size, mode, data, pax: entryPax };
    }
  } finally {
    await reader.cancel();
  }
}
