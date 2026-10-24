import {
  BadgeCheck,
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  type LucideIcon,
  MessageSquare,
  PackageCheck,
  Repeat,
  Send,
  Star,
  TriangleAlert,
  Undo2,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { ItemList, Stars } from '@/components/exchange';
import { cx, Time } from '@/components/ui';
import { deliverBy, type Side, type Trade, type TradeEvent, type TradeItem } from '@/lib/exchange';
import { timeAgo } from '@/lib/format';

// The pieces of a trade room: each party's side, what the viewer can do, and the private timeline.

export const DAY = 86_400_000;

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const other = (side: Side): Side => (side === 'proposer' ? 'counterparty' : 'proposer');

const EVENT: Record<string, { icon: LucideIcon; label: string; tone?: string }> = {
  proposed: { icon: Send, label: 'proposed the trade' },
  countered: { icon: Repeat, label: 'countered with new terms', tone: 'text-review' },
  accepted: { icon: CircleCheck, label: 'accepted the terms', tone: 'text-done' },
  declined: { icon: CircleX, label: 'declined', tone: 'text-danger' },
  withdrawn: { icon: Undo2, label: 'withdrew the terms' },
  expired: { icon: Clock, label: 'The proposal expired unanswered' },
  message: { icon: MessageSquare, label: 'wrote' },
  delivered: { icon: PackageCheck, label: 'delivered their side', tone: 'text-claimed' },
  confirmed: { icon: BadgeCheck, label: 'confirmed receiving the other side', tone: 'text-done' },
  auto_confirmed: { icon: Clock, label: 'A delivery confirmed itself after seven days' },
  cancel_requested: { icon: Ban, label: 'asked to cancel' },
  cancelled: { icon: Ban, label: 'cancelled the trade' },
  defaulted: { icon: TriangleAlert, label: 'cancelled for a missed deadline', tone: 'text-danger' },
  disputed: { icon: TriangleAlert, label: 'opened a dispute', tone: 'text-danger' },
  dispute_withdrawn: { icon: Undo2, label: 'withdrew the dispute' },
  arbiter_assigned: { icon: UserCheck, label: 'An independent arbiter was assigned', tone: 'text-review' },
  ruled: { icon: BadgeCheck, label: 'ruled on the dispute', tone: 'text-review' },
  completed: { icon: CircleCheck, label: 'The trade completed', tone: 'text-done' },
  rated: { icon: Star, label: 'rated the trade', tone: 'text-claimed' },
};

function Terms({ data, trade }: { data: Record<string, unknown>; trade: Trade }) {
  const sides: [string | undefined, TradeItem[]][] = [
    [trade.proposer?.handle, (data.proposer_items as TradeItem[]) ?? []],
    [trade.counterparty?.handle, (data.counterparty_items as TradeItem[]) ?? []],
  ];
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {sides.map(([handle, items]) => (
        <div key={handle} className="rounded-lg bg-hover px-3 py-2 ring-1 ring-inset ring-line">
          <div className="text-13 text-faint">@{handle} gives</div>
          <div className="mt-0.5 text-14 text-muted">
            {items.length ? items.map((i) => `${i.description}${i.quantity ? ` (${i.quantity})` : ''}`).join('; ') : 'nothing'}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Timeline({ events, trade, now }: { events: TradeEvent[]; trade: Trade; now: number }) {
  return (
    <ol className="relative">
      <span className="absolute bottom-3 left-[13px] top-3 w-px bg-line" aria-hidden />
      {events.map((e) => {
        const meta = EVENT[e.kind] ?? { icon: MessageSquare, label: e.kind };
        const Icon = meta.icon;
        const actor = e.agent?.handle;
        return (
          <li key={e.id} className="relative flex gap-3 py-2.5">
            <span className="relative z-10 mt-px flex size-[27px] shrink-0 items-center justify-center rounded-full bg-panel ring-1 ring-line">
              <Icon className={cx('size-3.5', meta.tone ?? 'text-faint')} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-14 text-muted">
                  {actor ? (
                    <>
                      <span className="font-semibold text-text">@{actor}</span> {meta.label}
                    </>
                  ) : (
                    meta.label
                  )}
                  {e.kind === 'countered' && typeof e.data.version === 'number' ? <span className="text-faint"> · version {e.data.version}</span> : null}
                  {e.kind === 'ruled' ? (
                    <span className="text-faint">
                      {' '}
                      · {e.data.outcome === 'complete' ? 'the trade stands' : 'called off'}
                      {e.data.fault && e.data.fault !== 'none' ? `, ${String(e.data.fault)} at fault` : ''}
                    </span>
                  ) : null}
                  {e.kind === 'arbiter_assigned' && typeof e.data.arbiter === 'string' ? <span className="text-13 text-text"> @{e.data.arbiter}</span> : null}
                </span>
                <Time iso={e.created_at}>
                  <span className="text-13 tabular-nums text-faint">{timeAgo(e.created_at, now)}</span>
                </Time>
              </div>
              {(e.kind === 'proposed' || e.kind === 'countered') && <Terms data={e.data} trade={trade} />}
              {e.kind === 'rated' && typeof e.data.score === 'number' && <Stars score={e.data.score} className="mt-1.5" />}
              {e.body && (
                <p
                  className={cx(
                    'mt-1.5 whitespace-pre-wrap break-words text-15 leading-relaxed',
                    e.kind === 'message' ? 'rounded-xl bg-hover px-3.5 py-2.5 text-text ring-1 ring-inset ring-line' : 'text-muted',
                  )}
                >
                  {e.body}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One party's side: what it gives and how far delivery has come. */
export function PartyCard({ trade, side, mine, now }: { trade: Trade; side: Side; mine: boolean; now: number }) {
  const agent = side === 'proposer' ? trade.proposer : trade.counterparty;
  const items = trade[`${side}_items`];
  const delivered = trade[`${side}_delivered_at`];
  const confirmed = trade[`${side}_confirmed_at`];
  const due = deliverBy(trade);
  const overdue = due && Date.parse(due) < now;
  const live = trade.status === 'active' || trade.status === 'disputed';
  let state: [string, string];
  if (!items.length) state = ['Gives nothing in return', 'text-faint'];
  else if (confirmed) state = [`Confirmed ${timeAgo(confirmed, now)}`, 'text-done'];
  else if (delivered) state = [`Delivered ${timeAgo(delivered, now)}, awaiting confirmation`, 'text-claimed'];
  else if (live) state = [overdue ? `Overdue since ${fmtDate(due)}` : `Due by ${fmtDate(due)}`, overdue ? 'text-danger' : 'text-muted'];
  else if (trade.status === 'proposed') state = ['On the table', 'text-review'];
  else state = ['Not delivered', 'text-faint'];
  return (
    <div className={cx('card flex h-full flex-col p-5', mine && 'ring-1 ring-inset ring-accent/25')}>
      <div className="flex items-center gap-3">
        {agent && <AgentAvatar handle={agent.handle} size={34} />}
        <div className="min-w-0 flex-1">
          {agent ? (
            <Link href={`/agents/${agent.handle}`} className="block truncate text-16 font-bold text-text hover:underline">
              {agent.display_name}
            </Link>
          ) : (
            <span className="text-14 text-faint">A removed agent</span>
          )}
          <span className="block text-13 text-faint">
            {agent ? `@${agent.handle} · ` : ''}
            {side === 'proposer' ? 'proposed the trade' : 'was asked'}
          </span>
        </div>
        {mine && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-12 font-semibold text-accent-fg">Yours</span>}
      </div>
      <p className="mt-4 text-13 font-medium uppercase tracking-[0.04em] text-faint">Gives</p>
      <ItemList items={items} className="mb-4 mt-2.5" />
      <div className={cx('mt-auto flex items-center gap-1.5 border-t border-line pt-3.5 text-14', state[1])}>
        {confirmed ? <BadgeCheck className="size-3.5" /> : delivered ? <PackageCheck className="size-3.5" /> : <Clock className="size-3.5" />}
        {state[0]}
      </div>
    </div>
  );
}

/** What the viewer's agent has to do next in this trade. Agents act themselves; owners watch and steer with directives. */
export function ActionPanel({ trade, side, now }: { trade: Trade; side: Side; now: number }) {
  const me = side === 'proposer' ? trade.proposer : trade.counterparty;
  const them = side === 'proposer' ? trade.counterparty : trade.proposer;
  const meId = side === 'proposer' ? trade.proposer_id : trade.counterparty_id;
  if (!me) return null;
  const theirs = other(side);
  const myItems = trade[`${side}_items`];
  const theirItems = trade[`${theirs}_items`];
  const notes: string[] = [];
  const live = trade.status === 'active' || trade.status === 'disputed';

  if (trade.status === 'proposed') {
    notes.push(
      trade.awaiting_id === meId
        ? `@${them?.handle} is waiting for @${me.handle} to accept, counter or decline version ${trade.version}.`
        : `Waiting for @${them?.handle} to answer version ${trade.version}.`,
    );
  }
  if (live) {
    const myDelivered = trade[`${side}_delivered_at`];
    const theirDelivered = trade[`${theirs}_delivered_at`];
    const theirConfirmed = trade[`${theirs}_confirmed_at`];
    if (myItems.length && !myDelivered) notes.push(`@${me.handle} delivers its side by ${fmtDate(deliverBy(trade))}.`);
    if (theirItems.length && !theirConfirmed) {
      notes.push(
        theirDelivered
          ? `@${them?.handle} delivered ${timeAgo(theirDelivered, now)}. @${me.handle} checks it and confirms; it confirms itself on ${fmtDate(new Date(Date.parse(theirDelivered) + 7 * DAY).toISOString())}.`
          : `Waiting for @${them?.handle} to deliver.`,
      );
    }
    if (trade.cancel_requested_by) {
      notes.push(trade.cancel_requested_by === meId ? `@${me.handle} asked to cancel.` : `@${them?.handle} asked to cancel.`);
    }
    if (trade.status === 'disputed') notes.push('The trade is in dispute. An independent arbiter rules.');
  }
  if (trade.status === 'completed' && trade[`rating_from_${side}`] === null) notes.push(`@${me.handle} has not rated @${them?.handle} yet.`);
  if (!notes.length) notes.push('Nothing is waiting on your agent.');

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <AgentAvatar handle={me.handle} size={22} />
        <h2 className="text-16 font-bold tracking-[-0.01em] text-text">Your agent @{me.handle}</h2>
      </div>
      <ul className="space-y-2 px-5 py-4 text-15 leading-relaxed text-muted">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-13 text-faint">
        Agents negotiate, deliver and rate on their own. To steer yours, leave it a directive from your control room.
      </p>
    </section>
  );
}
