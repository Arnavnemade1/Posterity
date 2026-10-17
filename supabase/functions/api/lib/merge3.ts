// Line-level three-way merges of text, and how alike two texts are (to find files that were renamed and
// edited). Pure functions: the code worker feeds them blobs and stores what they return.
import { diffArrays } from 'npm:diff@5.2.0';

/** A text's lines with their line endings, so joining them gives the text back exactly. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

interface Hunk {
  /** base[start, end) is replaced by lines. */
  start: number;
  end: number;
  lines: string[];
  side: 0 | 1;
}

// A diff of two huge, unrelated texts can cost seconds; past these it counts as unmergeable.
const LIMITS = { maxEditLength: 20_000, timeout: 1_500 };

function hunks(base: string[], side: string[], which: 0 | 1): Hunk[] | null {
  const parts = diffArrays(base, side, LIMITS);
  if (!parts) return null;
  const out: Hunk[] = [];
  let at = 0;
  let open: Hunk | null = null;
  for (const part of parts) {
    if (part.added) {
      open ??= { start: at, end: at, lines: [], side: which };
      for (const line of part.value) open.lines.push(line);
    } else if (part.removed) {
      open ??= { start: at, end: at, lines: [], side: which };
      at += part.value.length;
      open.end = at;
    } else {
      if (open) out.push(open);
      open = null;
      at += part.value.length;
    }
  }
  if (open) out.push(open);
  return out;
}

function pushAll(out: string[], lines: string[]) {
  for (const line of lines) out.push(line);
}

/** base[start, end) with one side's hunks (all inside that range) applied. */
function applySide(base: string[], start: number, end: number, side: Hunk[]): string[] {
  const out: string[] = [];
  let at = start;
  for (const h of side) {
    pushAll(out, base.slice(at, h.start));
    pushAll(out, h.lines);
    at = h.end;
  }
  pushAll(out, base.slice(at, end));
  return out;
}

const withNewline = (lines: string[]) =>
  lines.length && !lines[lines.length - 1].endsWith('\n') ? [...lines.slice(0, -1), `${lines[lines.length - 1]}\n`] : lines;

export interface MergeResult {
  conflict: boolean;
  /** The merged text, or with conflicts the text with git-style markers (ours, base, theirs). */
  text: string;
  /** Conflicting regions. */
  hunks: number;
}

/**
 * Merge two edits of a text. Changes to separate lines combine; changes that overlap or touch (as git
 * treats adjacent lines) conflict unless both sides made the same change. Null when the texts are too
 * large and different to diff in time.
 */
export function merge3(base: string, ours: string, theirs: string): MergeResult | null {
  if (ours === theirs) return { conflict: false, text: ours, hunks: 0 };
  if (base === ours) return { conflict: false, text: theirs, hunks: 0 };
  if (base === theirs) return { conflict: false, text: ours, hunks: 0 };
  const b = splitLines(base);
  const mine = hunks(b, splitLines(ours), 0);
  const yours = hunks(b, splitLines(theirs), 1);
  if (!mine || !yours) return null;
  const all = [...mine, ...yours].sort((x, y) => x.start - y.start || x.end - y.end || x.side - y.side);
  const out: string[] = [];
  let at = 0;
  let conflicts = 0;
  for (let i = 0; i < all.length;) {
    const group = [all[i]];
    let end = all[i].end;
    let j = i + 1;
    while (j < all.length && all[j].start <= end) {
      group.push(all[j]);
      end = Math.max(end, all[j].end);
      j++;
    }
    const start = group[0].start;
    pushAll(out, b.slice(at, start));
    const ourSide = group.filter((h) => h.side === 0);
    const theirSide = group.filter((h) => h.side === 1);
    if (!ourSide.length || !theirSide.length) {
      pushAll(out, applySide(b, start, end, group));
    } else {
      const a = applySide(b, start, end, ourSide);
      const c = applySide(b, start, end, theirSide);
      if (a.join('') === c.join('')) {
        pushAll(out, a);
      } else {
        conflicts++;
        out.push('<<<<<<< ours\n');
        pushAll(out, withNewline(a));
        out.push('||||||| base\n');
        pushAll(out, withNewline(b.slice(start, end)));
        out.push('=======\n');
        pushAll(out, withNewline(c));
        out.push('>>>>>>> theirs\n');
      }
    }
    at = end;
    i = j;
  }
  pushAll(out, b.slice(at));
  return { conflict: conflicts > 0, text: out.join(''), hunks: conflicts };
}

/** How alike two texts are, 0 to 1: shared non-blank lines (as a multiset) over all of them. */
export function similarity(a: string, b: string): number {
  const left = splitLines(a).map((l) => l.trim()).filter(Boolean);
  const right = splitLines(b).map((l) => l.trim()).filter(Boolean);
  if (!left.length || !right.length) return 0;
  const counts = new Map<string, number>();
  for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1);
  let common = 0;
  for (const line of right) {
    const n = counts.get(line);
    if (n) {
      common++;
      counts.set(line, n - 1);
    }
  }
  return (2 * common) / (left.length + right.length);
}

export interface RenameCandidate {
  path: string;
  text: string;
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const extension = (path: string) => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
};

/**
 * Which deleted files reappear, edited, as added ones: pairs scoring at least `threshold`, best first,
 * each file used once. Compares likely pairs first (same name, then same extension) and at most
 * `budget` pairs in all.
 */
export function pairRenames(deleted: RenameCandidate[], added: RenameCandidate[], threshold = 0.5, budget = 2000): Record<string, string> {
  const ranked: { d: RenameCandidate; a: RenameCandidate; rank: number }[] = [];
  for (const d of deleted) {
    for (const a of added) {
      const ratio = (a.text.length + 1) / (d.text.length + 1);
      if (ratio < 0.33 || ratio > 3) continue;
      const rank = basename(a.path) === basename(d.path) ? 0 : extension(a.path) === extension(d.path) ? 1 : 2;
      ranked.push({ d, a, rank });
    }
  }
  ranked.sort((x, y) => x.rank - y.rank);
  const scored = ranked.slice(0, budget)
    .map((p) => ({ ...p, score: similarity(p.d.text, p.a.text) }))
    .filter((p) => p.score >= threshold)
    .sort((x, y) => y.score - x.score || x.rank - y.rank || x.d.path.localeCompare(y.d.path));
  const pairs: Record<string, string> = {};
  const taken = new Set<string>();
  for (const p of scored) {
    if (p.d.path in pairs || taken.has(p.a.path)) continue;
    pairs[p.d.path] = p.a.path;
    taken.add(p.a.path);
  }
  return pairs;
}
