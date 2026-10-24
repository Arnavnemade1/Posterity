import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { kindMeta } from '@/components/memory-kinds';
import { cx, Time } from '@/components/ui';
import type { MemoryHit } from '@/lib/data';
import { compact, plainText, timeAgo } from '@/lib/format';
import { KNOWLEDGE_STATUS, lookup, TONE_TEXT } from '@/lib/status';

export { kindMeta };

export function KindBadge({ kind, href }: { kind: string; href?: string }) {
  const { label, tone } = kindMeta(kind);
  const className = cx('inline-flex items-center text-12 font-medium', TONE_TEXT[tone]);
  return href ? (
    <Link href={href} className={cx(className, 'hover:underline')}>
      {label}
    </Link>
  ) : (
    <span className={className}>{label}</span>
  );
}

export function KnowledgeStatus({ status }: { status: string }) {
  const [label] = lookup(KNOWLEDGE_STATUS, status);
  return (
    <span className="inline-flex items-center gap-1.5 text-12 text-muted">
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
    <span className="inline-flex items-center gap-2 text-12 text-faint">
      {sim !== null && (
        <span className="relative h-1 w-10 overflow-hidden rounded-full bg-active" aria-hidden>
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
      <Link href={`/memory/${hit.id}`} transitionTypes={['nav-forward']} className="group block rounded-xl px-3 py-4 transition-colors duration-100 hover:bg-hover">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <KindBadge kind={hit.kind} />
            <KnowledgeStatus status={hit.status} />
            <span className="ml-auto">
              <MatchMeter similarity={hit.similarity} matched={hit.matched} />
            </span>
          </div>
          <h3 className="mt-2 text-16 font-semibold leading-snug tracking-[-0.015em] text-text transition-colors group-hover:text-text">{hit.title}</h3>
          {hit.snippet && <p className="mt-1.5 line-clamp-2 text-14 leading-relaxed text-muted">{plainText(hit.snippet)}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-12 text-faint">
            {hit.agent_handle && (
              <span className="flex items-center gap-1.5">
                <AgentAvatar handle={hit.agent_handle} size={16} />
                <span className="text-12 text-muted">@{hit.agent_handle}</span>
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
          <Link href={`/memory/${hit.id}`} className="block px-2 py-2.5 transition-colors hover:bg-hover">
            <span className="block min-w-0">
              <span className="line-clamp-2 text-13 leading-snug text-text">{hit.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 text-12 text-faint">
                <span className={TONE_TEXT[kindMeta(hit.kind).tone]}>{kindMeta(hit.kind).label}</span>
                {!hideAuthor && hit.agent_handle && <span>@{hit.agent_handle}</span>}
                <span>{timeAgo(hit.created_at, now)}</span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
