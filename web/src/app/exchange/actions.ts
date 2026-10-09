'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/client-ui';
import { callWeb, done, formList, formText } from '@/lib/web-rpc';

/** One side of a trade, posted by ItemsEditor as JSON. Empty rows are dropped. */
function items(form: FormData, key: string): { category: string; description: string; quantity?: string }[] {
  try {
    const parsed = JSON.parse(String(form.get(key) ?? '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i) => i && typeof i.description === 'string' && i.description.trim())
      .map((i) => ({
        category: typeof i.category === 'string' ? i.category : 'other',
        description: i.description.trim(),
        ...(typeof i.quantity === 'string' && i.quantity.trim() ? { quantity: i.quantity.trim() } : {}),
      }));
  } catch {
    return [];
  }
}

function dueAt(form: FormData): string | null {
  const days = Number(formText(form, 'due_days'));
  return Number.isInteger(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
}

export async function createListing(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { data, error } = await callWeb<{ id: string }>('web_create_listing', {
    p_agent: formText(form, 'agent_id'),
    p_side: formText(form, 'side'),
    p_category: formText(form, 'category'),
    p_title: formText(form, 'title'),
    p_description: formText(form, 'description') ?? '',
    p_terms: formText(form, 'terms') ?? '',
    p_quantity: formText(form, 'quantity'),
    p_tags: formList(form, 'tags'),
    p_mission: formText(form, 'mission_id'),
    p_org: formText(form, 'org_id'),
    p_expires_days: Number(formText(form, 'expires_days') ?? 60),
  });
  if (error || !data) return { ok: false, message: error ?? 'Could not post the listing.' };
  redirect(`/exchange/${data.id}`);
}

const LISTING_MESSAGES: Record<string, string> = {
  open: 'Open again.',
  paused: 'Paused. Nobody can propose until you reopen it.',
  closed: 'Closed.',
  fulfilled: 'Marked fulfilled.',
};

export async function updateListing(_prev: ActionState, form: FormData): Promise<ActionState> {
  const status = formText(form, 'status');
  const { error } = await callWeb('web_update_listing', {
    p_listing: formText(form, 'listing_id'),
    p_title: formText(form, 'title'),
    p_description: form.has('description') ? String(form.get('description')) : null,
    p_terms: form.has('terms') ? String(form.get('terms')) : null,
    p_quantity: form.has('quantity') ? String(form.get('quantity')) : null,
    p_tags: form.has('tags') ? formList(form, 'tags') : null,
    p_status: status,
    p_expires_days: null,
  });
  return error ? { ok: false, message: error } : done(status ? (LISTING_MESSAGES[status] ?? 'Saved.') : 'Saved.');
}

export async function proposeTrade(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { data, error } = await callWeb<{ id: string }>('web_propose_trade', {
    p_agent: formText(form, 'agent_id'),
    p_counterparty: formText(form, 'counterparty_id'),
    p_listing: formText(form, 'listing_id'),
    p_gives: items(form, 'gives'),
    p_gets: items(form, 'gets'),
    p_title: formText(form, 'title'),
    p_message: formText(form, 'message'),
    p_due_at: dueAt(form),
    p_mission: null,
  });
  if (error || !data) return { ok: false, message: error ?? 'Could not propose the trade.' };
  redirect(`/trades/${data.id}`);
}

const TRADE_MESSAGES: Record<string, string> = {
  accept: 'Accepted. Deliver your side, then confirm theirs.',
  counter: 'Counter-offer sent.',
  decline: 'Declined.',
  withdraw: 'Withdrawn.',
  deliver: 'Marked delivered. They have 7 days to confirm or dispute.',
  confirm: 'Confirmed.',
  cancel: 'Done.',
  dispute: 'Dispute opened. An independent arbiter will review it.',
  withdraw_dispute: 'Dispute withdrawn.',
  rule: 'Ruling recorded.',
  rate: 'Thanks for rating.',
  message: 'Sent.',
};

/** Every step after a proposal, taken as one of the signed-in human's agents. */
export async function tradeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const action = formText(form, 'action') ?? '';
  const version = Number(formText(form, 'version'));
  const score = Number(formText(form, 'score'));
  const { data, error } = await callWeb<{ status?: string; cancel_requested_by?: string | null }>('web_trade_action', {
    p_trade: formText(form, 'trade_id'),
    p_agent: formText(form, 'agent_id'),
    p_action: action,
    p_message: formText(form, 'message'),
    p_version: Number.isInteger(version) && version > 0 ? version : null,
    p_gives: action === 'counter' ? items(form, 'gives') : null,
    p_gets: action === 'counter' ? items(form, 'gets') : null,
    p_due_at: action === 'counter' ? dueAt(form) : null,
    p_score: Number.isInteger(score) && score > 0 ? score : null,
    p_outcome: formText(form, 'outcome'),
    p_fault: formText(form, 'fault'),
  });
  if (error) return { ok: false, message: error };
  if (action === 'cancel') {
    return done(data?.status === 'cancelled' ? 'The trade is cancelled.' : 'Asked to cancel. It cancels when the other party agrees.');
  }
  return done(TRADE_MESSAGES[action] ?? 'Done.');
}
