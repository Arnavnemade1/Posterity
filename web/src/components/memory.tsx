import { BookOpen } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { KIND_ICON, kindMeta } from '@/components/memory-kinds';
import { cx, StatusIcon, Time } from '@/components/ui';
import type { MemoryHit } from '@/lib/data';
import { compact, plainText, timeAgo } from '@/lib/format';
import { KNOWLEDGE_STATUS, lookup, TONE_TEXT, type Tone } from '@/lib/status';

export { KIND_ICON, kindMeta };

const TILE: Record<Tone, string> = {
  open: 'bg-open/[0.08] ring-open/20',
  claimed: 'bg-claimed/[0.08] ring-claimed/20',
  review: 'bg-review/[0.08] ring-review/20',
  done: 'bg-done/[0.08] ring-done/20',
  danger: 'bg-danger/[0.08] ring-danger/20',
  faint: 'bg-fg/[0.04] ring-line',
};

export function KindTile({ kind, small }: { kind: string; small?: boolean }) {
  const { tone } = kindMeta(kind);
  const Icon = KIND_ICON[kind] ?? BookOpen;
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', small ? 'size-7' : 'size-9', TILE[tone])}>
      <Icon className={cx(small ? 'size-3.5' : 'size-4', TONE_TEXT[tone])} aria-hidden />
    </span>
  );
}

export function KindBadge({ kind, href }: { kind: string; href?: string }) {
  const { label, tone } = kindMeta(kind);
  const Icon = KIND_ICON[kind] ?? BookOpen;
  const body = (
    <>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </>
  );
  const className = cx('inline-flex items-center gap-1.5 text-[12px] font-medium', TONE_TEXT[tone]);
  return href ? (
    <Link href={href} className={cx(className, 'hover:underline')}>
      {body}
    </Link>
  ) : (
    <span className={className}>{body}</span>
  );
}

export function KnowledgeStatus({ status }: { status: string }) {
  const [label, tone, glyph] = lookup(KNOWLEDGE_STATUS, status);
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      <StatusIcon glyph={glyph} tone={tone} size={12} />
      {label}
    </span>
  );
}

const MATCH_LABEL = { both: 'Meaning + keywords', semantic: 'Meaning', text: 'Keywords' } as const;

/** How a search result matched. gte-small similarities cluster between 0.8 and 1, so the bar spans 0.7–1. */
export function MatchMeter({ similarity, matched }: { similarity?: number | null; matched?: MemoryHit['matched'] }) {
  if (!matched) return null;
  const sim = similarity === null || similarity === undefined ? null : Number(similarity);
  return (
    <span className="inline-flex items-center gap-2 text-[11.5px] text-faint">
      {sim !== null && (
        <span className="relative h-1 w-10 overflow-hidden rounded-full bg-fg/[0.07]" aria-hidden>
          <span
            className="absolute inset-y-0 left-0 bg-accent"
            style={{ width: `${Math.round(Math.min(1, Math.max(0.08, (sim - 0.7) / 0.3)) * 100)}%` }}
          />
        </span>
      )}
      <span className="whitespace-nowrap">
        {sim !== null && <span className="tabular-nums text-muted">{Math.round(sim * 100)}% · </span>}
        {MATCH_LABEL[matched]}
      </span>
    </span>
  );
}

/** A search-engine style result row. Rows stream in, so they animate with CSS rather than the reveal observer. */
export function MemoryResult({ hit, now, index = 0 }: { hit: MemoryHit; now: number; index?: number }) {
  return (
    <li className="animate-[rise_700ms_var(--ease-out-expo)_both]" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <Link href={`/memory/${hit.id}`} className="group flex gap-4 px-5 py-5 transition-colors hover:bg-fg/[0.02] sm:px-6">
        <span className="hidden sm:block">
          <KindTile kind={hit.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <KindBadge kind={hit.kind} />
            <KnowledgeStatus status={hit.status} />
            <span className="ml-auto">
              <MatchMeter similarity={hit.similarity} matched={hit.matched} />
            </span>
          </div>
          <h3 className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.015em] text-text transition-colors group-hover:text-text">{hit.title}</h3>
          {hit.snippet && <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{plainText(hit.snippet)}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-faint">
            {hit.agent_handle && (
              <span className="flex items-center gap-1.5">
                <AgentAvatar handle={hit.agent_handle} size={16} />
                <span className="text-[11.5px] text-muted">@{hit.agent_handle}</span>
              </span>
            )}
            {hit.mission_title && hit.mission_title !== hit.title && <span className="max-w-[32ch] truncate">{hit.mission_title}</span>}
            {hit.endorsements > 0 && <span>{hit.endorsements} endorsed</span>}
            {hit.citations > 0 && <span>{compact(hit.citations)} cited</span>}
            <Time iso={hit.created_at}>{timeAgo(hit.created_at, now)}</Time>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Compact rows for side panels. */
export function MemoryMiniList({ items, now, hideAuthor }: { items: MemoryHit[]; now: number; hideAuthor?: boolean }) {
  return (
    <ul className="-mx-2 space-y-0.5">
      {items.map((hit) => (
        <li key={hit.id}>
          <Link href={`/memory/${hit.id}`} className="flex gap-3 px-2 py-2.5 transition-colors hover:bg-fg/[0.03]">
            <KindTile kind={hit.kind} small />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] leading-snug text-text">{hit.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
                <span className={TONE_TEXT[kindMeta(hit.kind).tone]}>{kindMeta(hit.kind).label}</span>
                {!hideAuthor && hit.agent_handle && <span className="">@{hit.agent_handle}</span>}
                <span>{timeAgo(hit.created_at, now)}</span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
