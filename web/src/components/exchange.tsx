import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Star } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { category, SIDE } from '@/components/exchange-kinds';
import { cx, StatusPill, Time } from '@/components/ui';
import { type ListingSummary, rating, type Trade, type TradeItem, type TradeRecord } from '@/lib/exchange';
import { plural, timeAgo } from '@/lib/format';
import { TRADE_STATUS } from '@/lib/status';

/** A category's icon on a tinted tile. */
export function CategoryTile({ kind, size = 'md', className }: { kind: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { icon: Icon, hex, label } = category(kind);
  const box = size === 'lg' ? 'size-12 rounded-[14px]' : size === 'sm' ? 'size-7 rounded-[8px]' : 'size-10 rounded-[11px]';
  const glyph = size === 'lg' ? 'size-5' : size === 'sm' ? 'size-3.5' : 'size-[18px]';
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center', box, className)}
      style={{ color: hex, background: `${hex}14`, boxShadow: `inset 0 0 0 1px ${hex}33` }}
      title={label}
    >
      <Icon className={glyph} aria-hidden />
    </span>
  );
}

export function SideBadge({ side, className }: { side: string; className?: string }) {
  const offer = side === 'offer';
  const Icon = offer ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      className={cx(
        'inline-flex h-[21px] items-center gap-1 rounded-full px-2 text-[11.5px] font-medium ring-1 ring-inset',
        offer ? 'bg-done/[0.08] text-done ring-done/25' : 'bg-open/[0.08] text-open ring-open/25',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {SIDE[side]?.label ?? side}
    </span>
  );
}

/** Average rating from independent trade partners. */
export function Rating({ stats, className }: { stats: Pick<TradeRecord, 'trade_rating_sum' | 'trade_rating_count'> | null | undefined; className?: string }) {
  const value = rating(stats);
  if (value === null) return <span className={cx('text-[12px] text-faint', className)}>No ratings yet</span>;
  return (
    <span className={cx('inline-flex items-center gap-1 text-[12px] tabular-nums text-muted', className)} title={`${value.toFixed(2)} from ${stats!.trade_rating_count} ratings`}>
      <Star className="size-3 fill-claimed text-claimed" aria-hidden />
      {value.toFixed(1)}
      <span className="text-faint">({stats!.trade_rating_count})</span>
    </span>
  );
}

/** A 1-5 score as stars. */
export function Stars({ score, className }: { score: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)} aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cx('size-3.5', n <= score ? 'fill-claimed text-claimed' : 'text-white/15')} aria-hidden />
      ))}
    </span>
  );
}

/** What one side of a trade gives. */
export function ItemList({ items, empty = 'Nothing in return', className }: { items: TradeItem[]; empty?: string; className?: string }) {
  if (!items.length) return <p className={cx('text-[13px] italic text-faint', className)}>{empty}</p>;
  return (
    <ul className={cx('space-y-2', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <CategoryTile kind={item.category} size="sm" className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] leading-snug text-text">{item.description}</span>
            <span className="mt-0.5 block text-[11.5px] text-faint">
              {category(item.category).label}
              {item.quantity ? ` · ${item.quantity}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ListingCard({ listing, now }: { listing: ListingSummary; now: number }) {
  const meta = category(listing.category);
  return (
    <Link
      href={`/exchange/${listing.id}`}
      className="card spotlight group flex h-full flex-col p-5 transition-transform duration-300 hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3.5">
        <CategoryTile kind={listing.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SideBadge side={listing.side} />
            <span className="text-[12px] text-faint">{meta.label}</span>
          </div>
          <h3 className="mt-1.5 line-clamp-2 text-[15.5px] font-semibold leading-snug tracking-[-0.015em] text-text group-hover:text-white">{listing.title}</h3>
        </div>
      </div>
      {listing.quantity && (
        <span className="mt-3 inline-flex w-fit items-center rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11.5px] text-muted ring-1 ring-inset ring-white/[0.07]">
          {listing.quantity}
        </span>
      )}
      <p className="mt-3 line-clamp-2 min-h-[2lh] text-[13px] leading-relaxed text-muted">
        {listing.terms ? (
          <>
            <span className="text-faint">{SIDE[listing.side]?.termsLabel}: </span>
            {listing.terms}
          </>
        ) : (
          <span className="text-faint">Open to offers.</span>
        )}
      </p>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3.5">
        {listing.agent ? (
          <span className="flex min-w-0 items-center gap-2">
            <AgentAvatar handle={listing.agent.handle} size={20} />
            <span className="truncate font-mono text-[11.5px] text-muted">@{listing.agent.handle}</span>
            <Rating stats={listing.agent.stats} className="hidden sm:inline-flex" />
          </span>
        ) : (
          <span />
        )}
        <span className="shrink-0 text-[11.5px] tabular-nums text-faint">
          {listing.trade_count ? `${plural(listing.trade_count, 'trade')} · ` : ''}
          <Time iso={listing.created_at}>{timeAgo(listing.created_at, now)}</Time>
        </span>
      </div>
    </Link>
  );
}

/** One trade in a list, from the point of view of one of its parties (or neutrally). */
export function TradeRow({
  trade,
  now,
  side,
  pending,
}: {
  trade: Trade;
  now: number;
  side?: 'proposer' | 'counterparty' | 'arbiter';
  pending?: string | null;
}) {
  const other =
    side === 'proposer' ? trade.counterparty : side === 'counterparty' ? trade.proposer : null;
  return (
    <Link href={`/trades/${trade.id}`} className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-white/[0.025] sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.04] ring-1 ring-inset ring-white/[0.07]">
        <ArrowLeftRight className="size-4 text-muted" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-text group-hover:text-white">{trade.title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-faint">
          {other ? (
            <>
              with <span className="font-mono text-muted">@{other.handle}</span>
            </>
          ) : (
            <>
              <span className="font-mono text-muted">@{trade.proposer?.handle}</span> and <span className="font-mono text-muted">@{trade.counterparty?.handle}</span>
            </>
          )}
          {side === 'arbiter' ? ' · you arbitrate' : ''} · <Time iso={trade.updated_at}>{timeAgo(trade.updated_at, now)}</Time>
        </span>
      </span>
      {pending ? (
        <span className="hidden shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[11.5px] font-medium text-accent ring-1 ring-inset ring-accent/25 sm:inline">{pending}</span>
      ) : null}
      <StatusPill map={TRADE_STATUS} status={trade.status} className="shrink-0" />
    </Link>
  );
}
