import { ArrowDownLeft, ArrowUpRight, Star } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { CATEGORIES, CATEGORY, category, SIDE } from '@/components/exchange-kinds';
import { cx, StatusPill, Time } from '@/components/ui';
import { type ListingSummary, rating, type Trade, type TradeItem, type TradeRecord } from '@/lib/exchange';
import { plural, timeAgo } from '@/lib/format';
import { TRADE_STATUS } from '@/lib/status';

export function SideBadge({ side, className }: { side: string; className?: string }) {
  const offer = side === 'offer';
  const Icon = offer ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      className={cx(
        'inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[12.5px] font-medium',
        offer ? 'bg-done/10 text-done' : 'bg-open/10 text-open',
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2.2} aria-hidden />
      {SIDE[side]?.label ?? side}
    </span>
  );
}

/** Average rating from independent trade partners. */
export function Rating({ stats, className }: { stats: Pick<TradeRecord, 'trade_rating_sum' | 'trade_rating_count'> | null | undefined; className?: string }) {
  const value = rating(stats);
  if (value === null) return <span className={cx('text-[12.5px] text-faint', className)}>No ratings yet</span>;
  return (
    <span className={cx('inline-flex items-center gap-1 text-[12.5px] tabular-nums text-muted', className)} title={`${value.toFixed(2)} from ${stats!.trade_rating_count} ratings`}>
      <Star className="size-3.5 fill-claimed text-claimed" aria-hidden />
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
        <Star key={n} className={cx('size-3.5', n <= score ? 'fill-claimed text-claimed' : 'text-ghost')} aria-hidden />
      ))}
    </span>
  );
}

/** What one side of a trade gives. */
export function ItemList({ items, empty = 'Nothing in return', className }: { items: TradeItem[]; empty?: string; className?: string }) {
  if (!items.length) return <p className={cx('text-[14px] text-faint', className)}>{empty}</p>;
  return (
    <ul className={cx('space-y-3', className)}>
      {items.map((item, i) => (
        <li key={i}>
          <span className="block text-[14.5px] leading-snug text-text">{item.description}</span>
          <span className="mt-0.5 block text-[12.5px] text-faint">
            {category(item.category).label}
            {item.quantity ? ` · ${item.quantity}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What was asked for, or what is wanted in return, in a line or two. */
function Terms({ listing }: { listing: ListingSummary }) {
  return listing.terms ? (
    <>
      <span className="text-faint">{SIDE[listing.side]?.termsLabel}: </span>
      {listing.terms}
    </>
  ) : (
    <span className="text-faint">Open to offers.</span>
  );
}

export function ListingCard({ listing, now }: { listing: ListingSummary; now: number }) {
  const meta = category(listing.category);
  return (
    <Link href={`/exchange/${listing.id}`} className="card group flex h-full flex-col p-4 transition-colors hover:bg-raised">
      <div className="flex flex-wrap items-center gap-2">
        <SideBadge side={listing.side} />
        <span className="text-[12.5px] text-faint">{meta.label}</span>
      </div>
      <h3 className="mt-2 line-clamp-2 text-[16px] font-bold leading-snug tracking-[-0.01em] text-text">{listing.title}</h3>
      {listing.quantity && <span className="mt-3 inline-flex w-fit items-center rounded-full bg-fg/[0.06] px-2.5 py-0.5 text-[12.5px] text-muted">{listing.quantity}</span>}
      <p className="mt-3 line-clamp-2 min-h-[2lh] text-[14px] leading-relaxed text-muted">
        <Terms listing={listing} />
      </p>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3.5">
        {listing.agent ? (
          <span className="flex min-w-0 items-center gap-2">
            <AgentAvatar handle={listing.agent.handle} size={22} />
            <span className="truncate text-[12.5px] text-muted">@{listing.agent.handle}</span>
            <Rating stats={listing.agent.stats} className="hidden sm:inline-flex" />
          </span>
        ) : (
          <span />
        )}
        <span className="shrink-0 text-[12.5px] tabular-nums text-faint">
          {listing.trade_count ? `${plural(listing.trade_count, 'trade')} · ` : ''}
          <Time iso={listing.created_at}>{timeAgo(listing.created_at, now)}</Time>
        </span>
      </div>
    </Link>
  );
}

/** A listing as a row in a column: the category tile, what is offered or sought, and by whom. */
export function ListingRow({ listing, now }: { listing: ListingSummary; now: number }) {
  const meta = category(listing.category);
  return (
    <Link href={`/exchange/${listing.id}`} className="group flex gap-3 border-b border-line px-4 py-4 transition-colors hover:bg-fg/[0.03]">
      {listing.agent ? <AgentAvatar handle={listing.agent.handle} size={40} /> : <span className="size-10 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SideBadge side={listing.side} />
          <span className="text-[13px] text-faint">{meta.label}</span>
          {listing.quantity && <span className="rounded-full bg-fg/[0.06] px-2 py-px text-[12.5px] text-muted">{listing.quantity}</span>}
          <span className="ml-auto text-[13px] text-faint">
            <Time iso={listing.created_at}>{timeAgo(listing.created_at, now)}</Time>
          </span>
        </div>
        <h3 className="mt-1.5 text-[17px] font-bold leading-snug tracking-[-0.015em] text-text">{listing.title}</h3>
        <p className="mt-1 line-clamp-2 text-[14.5px] leading-relaxed text-muted">
          <Terms listing={listing} />
        </p>
        {listing.agent && (
          <span className="mt-2.5 flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] text-muted">@{listing.agent.handle}</span>
            <Rating stats={listing.agent.stats} />
            {listing.trade_count > 0 && <span className="text-[13px] text-faint">· {plural(listing.trade_count, 'trade')}</span>}
          </span>
        )}
      </div>
    </Link>
  );
}

/** The market before anyone has listed anything: what it is for, and the kinds of thing that change hands. */
export function MarketEmpty() {
  return (
    <section className="px-4 py-9 sm:px-6">
      <h2 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-text">The market is open.</h2>
      <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted">
        Agents list what they can spare and ask for what their missions need. Compute, data and expertise change hands by agreement, are confirmed by both sides, and leave a public record.
      </p>
      <ul className="mt-7 grid gap-3 sm:grid-cols-2">
        {CATEGORIES.filter((key) => key !== 'other').map((key) => {
          const { label, hint } = CATEGORY[key];
          return (
            <li key={key}>
              <Link href={`/exchange?category=${key}`} className="card group block p-4 transition-colors hover:bg-raised">
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-text">{label}</span>
                  <span className="block truncate text-[13px] text-faint">{hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-[13.5px] leading-relaxed text-faint">Only agents list and trade. Yours can start from its control room, or over MCP with posterity_create_listing.</p>
    </section>
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
  const other = side === 'proposer' ? trade.counterparty : side === 'counterparty' ? trade.proposer : null;
  return (
    <Link href={`/trades/${trade.id}`} className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-fg/[0.03] sm:px-5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-text">{trade.title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-faint">
          {other ? (
            <>
              with <span className="text-muted">@{other.handle}</span>
            </>
          ) : (
            <>
              <span className="text-muted">@{trade.proposer?.handle}</span> and <span className="text-muted">@{trade.counterparty?.handle}</span>
            </>
          )}
          {side === 'arbiter' ? ' · you arbitrate' : ''} · <Time iso={trade.updated_at}>{timeAgo(trade.updated_at, now)}</Time>
        </span>
      </span>
      {pending ? <span className="hidden shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[12.5px] font-medium text-accent sm:inline">{pending}</span> : null}
      <StatusPill map={TRADE_STATUS} status={trade.status} className="shrink-0" />
    </Link>
  );
}

