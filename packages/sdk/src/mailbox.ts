import { type Posterity, PosterityError } from './client.js';
import type { MailDelivery, MailReceipt } from './types.js';

export interface MailHandlerContext {
  client: Posterity;
  /** Stops on shutdown or lost lease. Check it before performing external effects. */
  signal: AbortSignal;
  /** Stable across redelivery. Use for idempotency when calling external services. */
  idempotencyKey: string;
}
/** Use the SDK for permitted work; return a reply or receipt, or null to defer with backoff. */
export type MailHandler = (delivery: MailDelivery, context: MailHandlerContext) => Promise<{ reply?: string; note?: string } | null>;
export interface MailboxOptions {
  signal?: AbortSignal;
  /** Maximum letters per pass, default 10. */
  limit?: number;
  /** 30-900 seconds, default 300. Automatically renewed while the handler works. */
  leaseSeconds?: number;
  onResult?: (result: MailboxResult) => void;
}
export interface MailboxResult {
  id: string;
  status: 'completed' | 'awaiting_owner' | 'deferred' | 'failed';
  receipt?: MailReceipt;
  error?: string;
}

function validate(options: MailboxOptions) {
  const lease = options.leaseSeconds ?? 300;
  const limit = options.limit ?? 10;
  if (!Number.isInteger(lease) || lease < 30 || lease > 900) throw new Error('leaseSeconds must be 30-900');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1-100');
  return { lease, limit };
}

/** Bounded, sequential processing. The server owns delivery state, so restarts lose no mail. */
export async function processMailbox(client: Posterity, handler: MailHandler, options: MailboxOptions = {}): Promise<MailboxResult[]> {
  const { lease, limit } = validate(options);
  const results: MailboxResult[] = [];
  for (let i = 0; i < limit && !options.signal?.aborted; i++) {
    const { delivery } = await client.mailbox.claim(lease);
    if (!delivery) break;
    const stop = new AbortController();
    const abort = () => stop.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    let renewal: Promise<unknown> = Promise.resolve();
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing || stop.signal.aborted) return;
      renewing = true;
      renewal = client.mailbox.renew(delivery, lease).catch(error => stop.abort(error)).finally(() => { renewing = false; });
    }, lease * 1000 / 3);
    let result: MailboxResult;
    try {
      stop.signal.throwIfAborted();
      const choice = await handler(delivery, { client, signal: stop.signal, idempotencyKey: delivery.id });
      clearInterval(timer);
      await renewal;
      stop.signal.throwIfAborted();
      if (choice === null) {
        await client.mailbox.retry(delivery, 'Worker deferred this letter');
        result = { id: delivery.id, status: 'deferred' };
      } else {
        if (!choice || typeof choice !== 'object' || Array.isArray(choice)
          || Object.keys(choice).some(key => key !== 'reply' && key !== 'note')
          || (choice.reply !== undefined && (typeof choice.reply !== 'string' || !choice.reply.trim() || choice.reply.length > 8000))
          || (choice.note !== undefined && (typeof choice.note !== 'string' || choice.note.length > 2000))) throw new Error('Invalid mailbox handler result');
        const receipt = await client.mailbox.complete(delivery, choice);
        result = { id: delivery.id, status: receipt.status, receipt };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A completed delivery rejects retry; its transactional reply cannot be repeated.
      await client.mailbox.retry(delivery, message.slice(0, 2000)).catch(() => {});
      result = { id: delivery.id, status: 'failed', error: message };
    } finally {
      clearInterval(timer);
      await renewal;
      options.signal?.removeEventListener('abort', abort);
    }
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    if (signal?.aborted) done();
  });
}

/** Run on the agent's host or server, with no browser session. Transient outages back off. */
export async function watchMailbox(client: Posterity, handler: MailHandler, options: MailboxOptions & {
  pollMs?: number; onError?: (error: unknown) => void;
} = {}): Promise<void> {
  const interval = options.pollMs ?? 30_000;
  if (!Number.isFinite(interval) || interval < 1000) throw new Error('pollMs must be at least 1000');
  validate(options);
  let failures = 0;
  while (!options.signal?.aborted) {
    try {
      const results = await processMailbox(client, handler, options);
      failures = 0;
      if (results.length === (options.limit ?? 10) && results.every(r => r.status !== 'failed')) continue;
    } catch (error) {
      failures++;
      options.onError?.(error);
      if (error instanceof PosterityError && (error.status === 401 || error.status === 403)) throw error;
    }
    await pause(Math.min(300_000, interval * 2 ** Math.min(failures, 4)), options.signal);
  }
}
