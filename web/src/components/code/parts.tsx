import { Check, ChevronDown, GitBranch, Lock, Snowflake } from 'lucide-react';
import Link from 'next/link';
import { cx, Pill } from '@/components/ui';
import type { BranchRow, ChangeRequestRow, CrCheck, CrReview } from '@/lib/code';

export function CrStatus({ cr }: { cr: Pick<ChangeRequestRow, 'status' | 'mergeable' | 'conflicts'> }) {
  if (cr.status === 'merged') return <Pill tone="done">Merged</Pill>;
  if (cr.status === 'closed') return <Pill tone="faint">Closed</Pill>;
  if (cr.status === 'draft') return <Pill tone="faint">Draft</Pill>;
  if (cr.mergeable === false || cr.conflicts.length > 0) return <Pill tone="danger">Conflicts</Pill>;
  return <Pill tone="open">Open</Pill>;
}

const VERDICT: Record<CrReview['verdict'], [string, 'done' | 'danger' | 'faint']> = {
  approve: ['Approved', 'done'],
  request_changes: ['Asked for changes', 'danger'],
  comment: ['Commented', 'faint'],
};

export function VerdictPill({ verdict }: { verdict: CrReview['verdict'] }) {
  const [label, tone] = VERDICT[verdict];
  return <Pill tone={tone}>{label}</Pill>;
}

const CHECK_TONE: Record<CrCheck['status'], 'done' | 'danger' | 'claimed' | 'faint'> = {
  passed: 'done',
  failed: 'danger',
  running: 'claimed',
  queued: 'faint',
  neutral: 'faint',
};

export function CheckPill({ status }: { status: CrCheck['status'] }) {
  return <Pill tone={CHECK_TONE[status]}>{status[0].toUpperCase() + status.slice(1)}</Pill>;
}

/** A branch (or commit) picker as a plain disclosure of links, so it needs no script. */
export function RefMenu({ base, current, branches, search = '' }: { base: string; current: string; branches: BranchRow[]; search?: string }) {
  return (
    <details className="group relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-14 text-text ring-1 ring-inset ring-line-strong transition-colors hover:bg-hover [&::-webkit-details-marker]:hidden">
        <GitBranch className="size-4 text-faint" aria-hidden />
        <span className="max-w-[200px] truncate font-mono text-13">{current}</span>
        <ChevronDown className="size-3.5 text-faint transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="glass absolute left-0 top-full z-30 mt-1.5 max-h-72 w-72 overflow-y-auto rounded-xl py-1.5">
        {branches.map((b) => (
          <Link
            key={b.name}
            href={`${base}?ref=${encodeURIComponent(b.name)}${search}`}
            className="flex items-center gap-2 px-3.5 py-2 text-14 transition-colors hover:bg-hover"
          >
            <span className="w-4">{b.name === current && <Check className="size-4 text-done" aria-hidden />}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-13 text-text">{b.name}</span>
            {b.protected && <Lock className="size-3.5 text-faint" aria-label="Protected" />}
            {b.frozen_reason && <Snowflake className="size-3.5 text-claimed" aria-label="Frozen for review" />}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** Folder breadcrumbs: the workspace, then each folder, ending on the current path. */
export function Crumbs({ base, name, path, refName }: { base: string; name: string; path: string; refName: string | null }) {
  const parts = path ? path.split('/') : [];
  const suffix = refName ? `?ref=${encodeURIComponent(refName)}` : '';
  return (
    <nav aria-label="Path" className="flex min-w-0 flex-wrap items-center gap-1 text-14">
      <Link href={`${base}${suffix}`} className={cx('font-medium hover:underline', parts.length ? 'text-link' : 'text-text')}>
        {name}
      </Link>
      {parts.map((part, i) => {
        const to = parts.slice(0, i + 1).join('/');
        const last = i === parts.length - 1;
        return (
          <span key={to} className="flex items-center gap-1">
            <span className="text-faint">/</span>
            {last ? (
              <span className="font-mono text-13 font-medium text-text">{part}</span>
            ) : (
              <Link href={`${base}/files/${to.split('/').map(encodeURIComponent).join('/')}${suffix}`} className="font-mono text-13 text-link hover:underline">
                {part}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export const filePath = (base: string, path: string, ref: string | null) =>
  `${base}/files/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;

export function shortSha(id: string) {
  return id.slice(0, 7);
}
