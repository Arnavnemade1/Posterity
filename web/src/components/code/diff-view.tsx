import { FileDiff, FileMinus2, FilePlus2 } from 'lucide-react';
import Link from 'next/link';
import { Markdown } from '@/components/markdown';
import { cx, Pill } from '@/components/ui';
import type { CrComment, DiffFile, Hunk } from '@/lib/code';
import { timeAgo } from '@/lib/format';

interface Row {
  type: 'ctx' | 'add' | 'del' | 'note';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

function hunkRows(hunk: Hunk): Row[] {
  let o = hunk.oldStart;
  let n = hunk.newStart;
  const rows: Row[] = [];
  for (const line of hunk.lines) {
    const mark = line[0];
    const text = line.slice(1);
    if (mark === '+') rows.push({ type: 'add', oldNo: null, newNo: n++, text });
    else if (mark === '-') rows.push({ type: 'del', oldNo: o++, newNo: null, text });
    else if (mark === '\\') rows.push({ type: 'note', oldNo: null, newNo: null, text });
    else rows.push({ type: 'ctx', oldNo: o++, newNo: n++, text });
  }
  return rows;
}

type SplitRow = { left: Row | null; right: Row | null } | { note: string };

/** Side by side: a run of removals sits next to the run of additions that replaces it. */
function splitRows(rows: Row[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: Row[] = [];
  let adds: Row[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const row of rows) {
    if (row.type === 'del') dels.push(row);
    else if (row.type === 'add') adds.push(row);
    else {
      flush();
      if (row.type === 'ctx') out.push({ left: row, right: row });
      else out.push({ note: row.text });
    }
  }
  flush();
  return out;
}

export interface Thread {
  root: CrComment;
  replies: CrComment[];
}

/** Line comments grouped into threads keyed by "path|side|line". */
export function threadsByLine(comments: CrComment[]): Map<string, Thread[]> {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: CrComment): CrComment => {
    let cur = c;
    for (let i = 0; i < 20 && cur.reply_to && byId.has(cur.reply_to); i++) cur = byId.get(cur.reply_to)!;
    return cur;
  };
  const threads = new Map<string, Thread>();
  for (const c of comments) {
    const root = rootOf(c);
    if (!root.path || !root.line) continue;
    const thread = threads.get(root.id) ?? { root, replies: [] };
    if (c.id !== root.id) thread.replies.push(c);
    threads.set(root.id, thread);
  }
  const out = new Map<string, Thread[]>();
  for (const t of threads.values()) {
    const key = `${t.root.path}|${t.root.side}|${t.root.line}`;
    out.set(key, [...(out.get(key) ?? []), t]);
  }
  return out;
}

export function CommentCard({ comment, head, now }: { comment: CrComment; head?: string | null; now: number }) {
  // Comments on the old side belong to the base; only the new side goes stale as the head moves.
  const outdated = Boolean(head && comment.side === 'new' && comment.commit_id && comment.commit_id !== head);
  return (
    <div className="border-l-2 border-line-strong bg-panel/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        {comment.author ? (
          <Link href={`/agents/${comment.author.handle}`} className="font-mono text-muted hover:text-text">
            @{comment.author.handle}
          </Link>
        ) : (
          <span>Someone</span>
        )}
        <span>{timeAgo(comment.created_at, now)}</span>
        {comment.resolved_at && <Pill tone="done">Resolved</Pill>}
        {outdated && <Pill tone="faint" dot={false}>On an earlier commit</Pill>}
      </div>
      <Markdown className="mt-1 text-[13.5px]">{comment.body}</Markdown>
    </div>
  );
}

function Threads({ threads, head, now, colSpan }: { threads: Thread[]; head: string | null; now: number; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-ink px-4 py-2.5">
        <div className="space-y-2.5">
          {threads.map((t) => (
            <div key={t.root.id} className="space-y-px overflow-hidden rounded-lg ring-1 ring-inset ring-line">
              <CommentCard comment={t.root} head={head} now={now} />
              {t.replies.map((r) => (
                <CommentCard key={r.id} comment={r} head={head} now={now} />
              ))}
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

const ROW_BG = { add: 'bg-done/[0.09]', del: 'bg-danger/[0.09]', ctx: '', note: '' } as const;
const MARK = { add: '+', del: '−', ctx: ' ', note: '' } as const;
const MARK_TONE = { add: 'text-done', del: 'text-danger', ctx: 'text-faint', note: 'text-faint' } as const;

const gutter = 'select-none px-2 text-right align-top text-[11.5px] text-faint';

function Unified({ file, threads, head, now }: { file: DiffFile; threads: Map<string, Thread[]>; head: string | null; now: number }) {
  return (
    <table className="w-full border-collapse font-mono text-[12.5px] leading-[1.55]">
      <tbody>
        {(file.hunks ?? []).map((hunk, h) => (
          <HunkBlock key={h}>
            <tr className="bg-open/[0.07] text-faint">
              <td colSpan={3} className="px-3 py-1 text-[11.5px]">
                @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </td>
            </tr>
            {hunkRows(hunk).map((row, i) => {
              const found = [
                ...(row.newNo !== null ? threads.get(`${file.path}|new|${row.newNo}`) ?? [] : []),
                ...(row.oldNo !== null && row.type === 'del' ? threads.get(`${file.path}|old|${row.oldNo}`) ?? [] : []),
              ];
              return (
                <HunkBlock key={i}>
                  <tr className={ROW_BG[row.type]}>
                    <td className={cx(gutter, 'w-10')}>{row.oldNo ?? ''}</td>
                    <td className={cx(gutter, 'w-10 border-r border-line')}>{row.newNo ?? ''}</td>
                    <td className="whitespace-pre-wrap break-all px-3 text-prose">
                      <span className={cx('mr-2 inline-block w-2', MARK_TONE[row.type])}>{MARK[row.type]}</span>
                      {row.type === 'note' ? <em className="text-faint">{row.text}</em> : row.text || ' '}
                    </td>
                  </tr>
                  {found.length > 0 && <Threads threads={found} head={head} now={now} colSpan={3} />}
                </HunkBlock>
              );
            })}
          </HunkBlock>
        ))}
      </tbody>
    </table>
  );
}

function Split({ file, threads, head, now }: { file: DiffFile; threads: Map<string, Thread[]>; head: string | null; now: number }) {
  const cell = (row: Row | null, side: 'left' | 'right') =>
    row ? (
      <>
        <td className={cx(gutter, side === 'right' && 'border-l border-line', row.type !== 'ctx' && ROW_BG[row.type])}>
          {side === 'left' ? row.oldNo : row.newNo}
        </td>
        <td className={cx('whitespace-pre-wrap break-all px-2 text-prose', row.type !== 'ctx' && ROW_BG[row.type])}>
          <span className={cx('mr-1.5 inline-block w-2', MARK_TONE[row.type])}>{row.type === 'ctx' ? '' : MARK[row.type]}</span>
          {row.text || ' '}
        </td>
      </>
    ) : (
      <>
        <td className={cx(gutter, 'bg-fg/[0.02]', side === 'right' && 'border-l border-line')} />
        <td className="bg-fg/[0.02]" />
      </>
    );
  return (
    <table className="w-full table-fixed border-collapse font-mono text-[12.5px] leading-[1.55]">
      {/* Fixed layout reads the first row, which is a hunk header spanning everything: say the widths here. */}
      <colgroup>
        <col style={{ width: '3rem' }} />
        <col />
        <col style={{ width: '3rem' }} />
        <col />
      </colgroup>
      <tbody>
        {(file.hunks ?? []).map((hunk, h) => (
          <HunkBlock key={h}>
            <tr className="bg-open/[0.07] text-faint">
              <td colSpan={4} className="px-3 py-1 text-[11.5px]">
                @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </td>
            </tr>
            {splitRows(hunkRows(hunk)).map((row, i) => {
              if ('note' in row) {
                return (
                  <tr key={i}>
                    <td colSpan={4} className="px-3 text-[11.5px] italic text-faint">
                      {row.note}
                    </td>
                  </tr>
                );
              }
              const found = [
                ...(row.right && row.right.newNo !== null ? threads.get(`${file.path}|new|${row.right.newNo}`) ?? [] : []),
                ...(row.left && row.left.type === 'del' && row.left.oldNo !== null ? threads.get(`${file.path}|old|${row.left.oldNo}`) ?? [] : []),
              ];
              return (
                <HunkBlock key={i}>
                  <tr>
                    {cell(row.left, 'left')}
                    {cell(row.right, 'right')}
                  </tr>
                  {found.length > 0 && <Threads threads={found} head={head} now={now} colSpan={4} />}
                </HunkBlock>
              );
            })}
          </HunkBlock>
        ))}
      </tbody>
    </table>
  );
}

/** A fragment for table bodies: rows need a keyed wrapper that adds no element. */
function HunkBlock({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const STATUS_ICON = { added: FilePlus2, deleted: FileMinus2, modified: FileDiff } as const;
const STATUS_TONE = { added: 'text-done', deleted: 'text-danger', modified: 'text-claimed' } as const;

const kb = (n: number | null) => (n === null ? '—' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/** The files of a diff: one collapsible block each, unified or side by side, with line comments in place. */
export function DiffView({
  files,
  comments = [],
  mode,
  head = null,
  now,
}: {
  files: DiffFile[];
  comments?: CrComment[];
  mode: 'unified' | 'split';
  head?: string | null;
  now: number;
}) {
  const threads = threadsByLine(comments);
  const strays = comments.filter((c) => c.path && !files.some((f) => f.path === c.path)).length;
  return (
    <div className="space-y-4">
      {files.map((file) => {
        const Icon = STATUS_ICON[file.status];
        const lines = (file.hunks ?? []).reduce((n, h) => n + h.lines.length, 0);
        const fileComments = comments.filter((c) => c.path === file.path).length;
        return (
          <details key={file.path} id={`file-${file.path}`} open={lines <= 400} className="group overflow-hidden rounded-xl ring-1 ring-inset ring-line">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 bg-panel/70 px-3 py-2.5 text-[13px] [&::-webkit-details-marker]:hidden">
              <Icon className={cx('size-4 shrink-0', STATUS_TONE[file.status])} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-text">{file.path}</span>
              {fileComments > 0 && <span className="text-[12px] text-faint">{fileComments} comment{fileComments === 1 ? '' : 's'}</span>}
              {!file.binary && (
                <span className="numeric shrink-0 text-[12px]">
                  <span className="text-done">+{file.added}</span> <span className="text-danger">−{file.removed}</span>
                </span>
              )}
            </summary>
            <div className="overflow-x-auto border-t border-line bg-ink">
              {file.binary ? (
                <p className="px-4 py-3 text-[13px] text-faint">
                  Binary file {file.status === 'added' ? 'added' : file.status === 'deleted' ? 'deleted' : 'changed'} ({kb(file.oldSize)} → {kb(file.newSize)}).
                </p>
              ) : file.hunks === null ? (
                <p className="px-4 py-3 text-[13px] text-faint">{file.note ?? 'No line diff for this file.'}</p>
              ) : file.hunks.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-faint">{file.status === 'added' ? 'An empty file.' : 'No visible line changes.'}</p>
              ) : mode === 'split' ? (
                <Split file={file} threads={threads} head={head} now={now} />
              ) : (
                <Unified file={file} threads={threads} head={head} now={now} />
              )}
              {file.hunks && file.note && <p className="border-t border-line px-4 py-2 text-[12px] text-faint">{file.note}</p>}
            </div>
          </details>
        );
      })}
      {strays > 0 && <p className="text-[12.5px] text-faint">{strays} comment{strays === 1 ? '' : 's'} on files this change no longer touches.</p>}
    </div>
  );
}
