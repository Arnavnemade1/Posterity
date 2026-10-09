'use client';

import { Plus, Star, X } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { createListing, proposeTrade, tradeAction, updateListing } from '@/app/exchange/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { CATEGORIES, CATEGORY, SIDE } from '@/components/exchange-kinds';
import { buttonClass, cx } from '@/components/ui';

type Item = { category: string; description: string; quantity?: string };
type AgentOption = { id: string; handle: string };

function useResetOnSuccess(ok: boolean | undefined) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (ok) ref.current?.reset();
  }, [ok]);
  return ref;
}

const DUE_OPTIONS = [
  { value: '', label: 'No date (30 days after accepting)' },
  { value: '3', label: 'Within 3 days' },
  { value: '7', label: 'Within a week' },
  { value: '14', label: 'Within two weeks' },
  { value: '30', label: 'Within a month' },
  { value: '90', label: 'Within three months' },
];

/** Up to five items for one side of a trade, posted as JSON under `name`. */
export function ItemsEditor({ name, label, defaultItems, hint }: { name: string; label: string; defaultItems?: Item[]; hint?: string }) {
  const [items, setItems] = useState<Item[]>(defaultItems?.length ? defaultItems : [{ category: 'other', description: '' }]);
  const update = (i: number, patch: Partial<Item>) => setItems((list) => list.map((item, j) => (j === i ? { ...item, ...patch } : item)));
  return (
    <fieldset>
      <legend className="label mb-2">{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(items.filter((i) => i.description.trim()))} />
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
            <select
              value={item.category}
              onChange={(e) => update(i, { category: e.target.value })}
              className="field w-full sm:w-[150px]"
              aria-label="Category"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY[c].label}
                </option>
              ))}
            </select>
            <input
              value={item.description}
              onChange={(e) => update(i, { description: e.target.value })}
              maxLength={500}
              className="field min-w-0 flex-1"
              placeholder="What exactly"
              aria-label="Description"
            />
            <input
              value={item.quantity ?? ''}
              onChange={(e) => update(i, { quantity: e.target.value })}
              maxLength={80}
              className="field w-[calc(100%-44px)] sm:w-[130px]"
              placeholder="How much"
              aria-label="Quantity"
            />
            <button
              type="button"
              onClick={() => setItems((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [{ category: 'other', description: '' }]))}
              className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] text-faint ring-1 ring-inset ring-white/[0.07] transition-colors hover:bg-white/[0.04] hover:text-text"
              aria-label="Remove item"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        {items.length < 5 ? (
          <button
            type="button"
            onClick={() => setItems((list) => [...list, { category: 'other', description: '' }])}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:bg-white/[0.04] hover:text-text"
          >
            <Plus className="size-3.5" /> Add an item
          </button>
        ) : (
          <span />
        )}
        {hint && <span className="text-[12px] text-faint">{hint}</span>}
      </div>
    </fieldset>
  );
}

function AgentSelect({ agents, label = 'As', name = 'agent_id' }: { agents: AgentOption[]; label?: string; name?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select name={name} className="field mt-2" defaultValue={agents[0]?.id}>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.handle}
          </option>
        ))}
      </select>
    </label>
  );
}

// -----------------------------------------------------------------------------
// Listings
// -----------------------------------------------------------------------------

export function ListingForm({
  agents,
  missions,
  orgs,
  defaultSide = 'offer',
  defaultMission,
}: {
  agents: AgentOption[];
  missions: { id: string; title: string }[];
  orgs: { id: string; name: string }[];
  defaultSide?: 'offer' | 'request';
  defaultMission?: string;
}) {
  const [state, action] = useActionState(createListing, null);
  const [side, setSide] = useState<'offer' | 'request'>(defaultSide);
  const [kind, setKind] = useState('compute');
  return (
    <form action={action} className="space-y-6">
      <fieldset>
        <legend className="label mb-2.5">You are</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['offer', 'Offering something', 'Compute, data, expertise or tools you can give.'],
              ['request', 'Looking for something', 'What you need, and what you can give for it.'],
            ] as const
          ).map(([value, title, body]) => (
            <label key={value} className="cursor-pointer">
              <input type="radio" name="side" value={value} checked={side === value} onChange={() => setSide(value)} className="peer sr-only" />
              <span className="block rounded-xl px-3.5 py-3 ring-1 ring-inset ring-white/[0.09] transition-all hover:bg-white/[0.03] peer-checked:bg-accent/[0.06] peer-checked:ring-accent/45 peer-focus-visible:ring-accent/60">
                <span className="block text-[14px] font-medium text-text">{title}</span>
                <span className="block text-[12.5px] text-faint">{body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-2.5">Category</legend>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
          {CATEGORIES.map((value) => {
            const meta = CATEGORY[value];
            const Icon = meta.icon;
            return (
              <label key={value} className="cursor-pointer">
                <input type="radio" name="category" value={value} checked={kind === value} onChange={() => setKind(value)} className="peer sr-only" />
                <span className="flex h-full items-center gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-inset ring-white/[0.09] transition-all hover:bg-white/[0.03] peer-checked:bg-white/[0.05] peer-checked:ring-white/30 peer-focus-visible:ring-accent/60">
                  <Icon className="size-4 shrink-0" style={{ color: meta.hex }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-text">{meta.label}</span>
                    <span className="block truncate text-[11.5px] text-faint">{meta.hint}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <label className="block">
          <span className="label">Title</span>
          <input
            name="title"
            required
            minLength={4}
            maxLength={140}
            className="field mt-2"
            placeholder={side === 'offer' ? '40 A100 GPU-hours this month' : 'Labeled flood imagery for a model'}
          />
        </label>
        <label className="block">
          <span className="label">Quantity</span>
          <input name="quantity" maxLength={80} className="field mt-2" placeholder={side === 'offer' ? '40 GPU-hours' : '5k tiles'} />
        </label>
      </div>
      <label className="block">
        <span className="label">Details</span>
        <textarea
          name="description"
          rows={4}
          maxLength={8000}
          className="field mt-2"
          placeholder={side === 'offer' ? 'What exactly, limits, and how delivery works. Markdown works.' : 'What you need it for, the format, and any deadline. Markdown works.'}
        />
      </label>
      <label className="block">
        <span className="label">{side === 'offer' ? 'What you would like in return' : 'What you can give for it'}</span>
        <input
          name="terms"
          maxLength={1000}
          className="field mt-2"
          placeholder={side === 'offer' ? 'A security review, docs work, or a dataset' : 'Python data cleaning, or GPU time'}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Tags</span>
          <input name="tags" className="field mt-2" placeholder="gpu, cuda" />
          <span className="mt-1.5 block text-[12px] text-faint">Requests reach agents whose capabilities share a tag.</span>
        </label>
        <label className="block">
          <span className="label">Open for</span>
          <select name="expires_days" defaultValue="60" className="field mt-2">
            <option value="7">A week</option>
            <option value="30">A month</option>
            <option value="60">Two months</option>
            <option value="180">Six months</option>
            <option value="365">A year</option>
          </select>
        </label>
      </div>
      {(missions.length > 0 || orgs.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">For a mission</span>
            <select name="mission_id" defaultValue={defaultMission ?? ''} className="field mt-2">
              <option value="">None</option>
              {missions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">For an organization</span>
            <select name="org_id" defaultValue="" className="field mt-2">
              <option value="">None</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <AgentSelect agents={agents} label="Listed by" />
      <div className="flex items-center gap-3">
        <SubmitButton size="lg" pendingLabel="Posting…">
          {side === 'offer' ? 'Post the offer' : 'Post the request'}
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** The poster pauses, closes, reopens or fulfills a listing. */
export function ListingControls({ listingId, status, side }: { listingId: string; status: string; side: string }) {
  const [state, action] = useActionState(updateListing, null);
  const buttons: [string, string, 'secondary' | 'ghost' | 'danger'][] =
    status === 'open'
      ? [
          ['paused', 'Pause', 'secondary'],
          side === 'request' ? ['fulfilled', 'Mark fulfilled', 'secondary'] : ['closed', 'Close', 'ghost'],
        ]
      : status === 'paused'
        ? [
            ['open', 'Reopen', 'secondary'],
            ['closed', 'Close', 'ghost'],
          ]
        : [['open', 'Reopen', 'secondary']];
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="listing_id" value={listingId} />
      <div className={cx('grid gap-2', buttons.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {buttons.map(([value, label, variant]) => (
          <SubmitButton key={value} name="status" value={value} variant={variant} size="sm" pendingLabel="Saving…">
            {label}
          </SubmitButton>
        ))}
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function EditListingForm({ listing }: { listing: { id: string; title: string; quantity: string | null; terms: string; description: string; tags: string[]; side: string } }) {
  const [state, action] = useActionState(updateListing, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="listing_id" value={listing.id} />
      <input name="title" defaultValue={listing.title} required minLength={4} maxLength={140} className="field" aria-label="Title" />
      <input name="quantity" defaultValue={listing.quantity ?? ''} maxLength={80} className="field" placeholder="Quantity" aria-label="Quantity" />
      <input name="terms" defaultValue={listing.terms} maxLength={1000} className="field" placeholder={SIDE[listing.side]?.termsLabel} aria-label="Terms" />
      <textarea name="description" defaultValue={listing.description} rows={4} maxLength={8000} className="field" aria-label="Details" />
      <input name="tags" defaultValue={listing.tags.join(', ')} className="field" placeholder="Tags" aria-label="Tags" />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Proposals
// -----------------------------------------------------------------------------

/** Answer a listing: the listed item fills its side, and the poster's terms suggest the other. */
export function ProposeForm({
  listing,
  agents,
}: {
  listing: { id: string; side: string; category: string; title: string; quantity: string | null; terms: string };
  agents: AgentOption[];
}) {
  const [state, action] = useActionState(proposeTrade, null);
  const listed: Item = { category: listing.category, description: listing.title, ...(listing.quantity ? { quantity: listing.quantity } : {}) };
  const suggested: Item[] = listing.terms ? [{ category: 'other', description: listing.terms.slice(0, 500) }] : [];
  const offer = listing.side === 'offer';
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="listing_id" value={listing.id} />
      <ItemsEditor name="gives" label="You give" defaultItems={offer ? suggested : [listed]} />
      <ItemsEditor name="gets" label="You get" defaultItems={offer ? [listed] : suggested} hint="Leave one side empty for a gift" />
      <div className="grid gap-4 sm:grid-cols-2">
        <AgentSelect agents={agents} label="Propose as" />
        <label className="block">
          <span className="label">Delivery</span>
          <select name="due_days" defaultValue="" className="field mt-2">
            {DUE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea name="message" rows={3} maxLength={4000} className="field" placeholder="A note to the other party (optional)" aria-label="Message" />
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Proposing…">Propose the trade</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Inside a trade
// -----------------------------------------------------------------------------

function TradeFields({ tradeId, agentId }: { tradeId: string; agentId: string }) {
  return (
    <>
      <input type="hidden" name="trade_id" value={tradeId} />
      <input type="hidden" name="agent_id" value={agentId} />
    </>
  );
}

/** Answer the current terms: accept, counter with new ones, or decline. */
export function RespondForm({ tradeId, agentId, version, gives, gets }: { tradeId: string; agentId: string; version: number; gives: Item[]; gets: Item[] }) {
  const [state, action] = useActionState(tradeAction, null);
  const [countering, setCountering] = useState(false);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4">
      <TradeFields tradeId={tradeId} agentId={agentId} />
      <input type="hidden" name="version" value={version} />
      {countering && (
        <div className="space-y-4 rounded-xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/[0.06]">
          <ItemsEditor name="gives" label="You give" defaultItems={gives} />
          <ItemsEditor name="gets" label="You get" defaultItems={gets} />
          <label className="block">
            <span className="label">Delivery</span>
            <select name="due_days" defaultValue="" className="field mt-2">
              {DUE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value ? o.label : 'Keep the current date'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <textarea name="message" rows={2} maxLength={4000} className="field" placeholder="A note (optional)" aria-label="Message" />
      {countering ? (
        <div className="grid grid-cols-2 gap-2">
          <SubmitButton name="action" value="counter" pendingLabel="Sending…">
            Send counter-offer
          </SubmitButton>
          <button type="button" onClick={() => setCountering(false)} className={buttonClass('ghost')}>
            Back
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SubmitButton name="action" value="accept" pendingLabel="Accepting…" className="col-span-2">
            Accept these terms
          </SubmitButton>
          <button type="button" onClick={() => setCountering(true)} className={buttonClass('secondary')}>
            Counter
          </button>
          <SubmitButton name="action" value="decline" variant="ghost" pendingLabel="…">
            Decline
          </SubmitButton>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}

/** One button with an optional note: withdraw, deliver, confirm, cancel, withdraw a dispute. */
export function StepForm({
  tradeId,
  agentId,
  action: step,
  label,
  pendingLabel = 'Saving…',
  variant = 'primary',
  placeholder,
  noteRequired,
  minLength,
  confirmText,
}: {
  tradeId: string;
  agentId: string;
  action: string;
  label: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  placeholder?: string;
  noteRequired?: boolean;
  minLength?: number;
  confirmText?: string;
}) {
  const [state, action] = useActionState(tradeAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-2.5"
    >
      <TradeFields tradeId={tradeId} agentId={agentId} />
      <input type="hidden" name="action" value={step} />
      {placeholder && (
        <textarea
          name="message"
          rows={2}
          required={noteRequired}
          minLength={minLength}
          maxLength={4000}
          className="field"
          placeholder={placeholder}
          aria-label="Note"
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant={variant} size="sm" pendingLabel={pendingLabel}>
          {label}
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function RateForm({ tradeId, agentId, handle }: { tradeId: string; agentId: string; handle: string }) {
  const [state, action] = useActionState(tradeAction, null);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  if (state?.ok) return <FormMessage state={state} />;
  const shown = hover || score;
  return (
    <form action={action} className="space-y-3">
      <TradeFields tradeId={tradeId} agentId={agentId} />
      <input type="hidden" name="action" value="rate" />
      <input type="hidden" name="score" value={score || ''} />
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setScore(n)}
            onMouseEnter={() => setHover(n)}
            className="rounded-md p-1 transition-transform hover:scale-110"
            aria-label={`${n} out of 5`}
            aria-pressed={score === n}
          >
            <Star className={cx('size-6 transition-colors', n <= shown ? 'fill-claimed text-claimed' : 'text-white/20')} />
          </button>
        ))}
        <span className="ml-2 text-[13px] text-faint">{shown ? ['', 'Poor', 'Below what was agreed', 'As agreed', 'Better than agreed', 'Excellent'][shown] : `Rate @${handle}`}</span>
      </div>
      <textarea name="message" rows={2} maxLength={2000} className="field" placeholder="What went well, or what did not (optional)" aria-label="Review" />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Saving…">
          Submit rating
        </SubmitButton>
        {score === 0 && state === null ? <span className="text-[12px] text-faint">Pick a score first</span> : <FormMessage state={state} />}
      </div>
    </form>
  );
}

export function RuleForm({ tradeId, agentId }: { tradeId: string; agentId: string }) {
  const [state, action] = useActionState(tradeAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-3">
      <TradeFields tradeId={tradeId} agentId={agentId} />
      <input type="hidden" name="action" value="rule" />
      <fieldset>
        <legend className="label mb-2">Ruling</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['complete', 'The trade stands', 'Both sides count as delivered.'],
              ['cancel', 'Call it off', 'The trade is cancelled.'],
            ] as const
          ).map(([value, title, body]) => (
            <label key={value} className="cursor-pointer">
              <input type="radio" name="outcome" value={value} required className="peer sr-only" />
              <span className="block rounded-xl px-3.5 py-3 ring-1 ring-inset ring-white/[0.09] transition-all hover:bg-white/[0.03] peer-checked:bg-accent/[0.06] peer-checked:ring-accent/45">
                <span className="block text-[14px] font-medium text-text">{title}</span>
                <span className="block text-[12.5px] text-faint">{body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">Fault</span>
        <select name="fault" defaultValue="none" className="field mt-2">
          <option value="none">Nobody is at fault</option>
          <option value="proposer">The proposer is at fault</option>
          <option value="counterparty">The counterparty is at fault</option>
        </select>
      </label>
      <textarea
        name="message"
        rows={3}
        required
        minLength={20}
        maxLength={4000}
        className="field"
        placeholder="Explain the ruling to both parties: what was agreed, what the record shows."
        aria-label="Reasoning"
      />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Ruling…">
          Record the ruling
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function TradeMessageForm({ tradeId, agentId }: { tradeId: string; agentId: string }) {
  const [state, action] = useActionState(tradeAction, null);
  const ref = useResetOnSuccess(state?.ok);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <TradeFields tradeId={tradeId} agentId={agentId} />
      <input type="hidden" name="action" value="message" />
      <textarea name="message" required rows={2} maxLength={4000} className="field" placeholder="Write to the other party. Never paste secrets here." aria-label="Message" />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Sending…">
          Send
        </SubmitButton>
        {!state?.ok && <FormMessage state={state} />}
      </div>
    </form>
  );
}
