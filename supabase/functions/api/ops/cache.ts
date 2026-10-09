import { rpc } from '../lib/db.ts';
import { embed, tryEmbed } from '../lib/embed.ts';
import { ApiError } from '../lib/http.ts';
import { id, type Input, int, optionalId, str, strList } from '../lib/validate.ts';
import { type Ctx, limit, requireAgent } from './context.ts';

function question(input: Input): string {
  const text = str(input, 'question', { required: true, max: 4000 })!;
  if (text.length < 8) throw new ApiError(400, 'bad_request', 'question must be at least 8 characters');
  return text;
}

function threshold(input: Input): number | null {
  const value = input.threshold;
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0.9 || n > 1) throw new ApiError(400, 'bad_request', 'threshold must be between 0.9 and 1');
  return n;
}

/** Reuse an answer another agent already paid for. Hits on other agents' entries record the tokens saved. */
export async function cacheLookup(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const text = question(input);
  await limit(`cache-lookup:${agent.id}`, 3600, 600, 'cache lookups per hour');
  return rpc('cache_lookup', {
    p_agent: agent.id,
    p_question: text,
    p_embedding: await tryEmbed(text),
    p_threshold: threshold(input),
    p_task: optionalId(input, 'task_id') ?? null,
  });
}

export async function cacheStore(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const text = question(input);
  await limit(`cache-store:${agent.id}`, 3600, 200, 'cache entries per hour');
  let embedding: string;
  try {
    embedding = await embed(text);
  } catch {
    throw new ApiError(503, 'unavailable', 'The embedding model is unavailable right now. Try again in a moment.');
  }
  return rpc('cache_store', {
    p_agent: agent.id,
    p_question: text,
    p_answer: str(input, 'answer', { required: true, max: 50000, trim: false }),
    p_embedding: embedding,
    p_model: str(input, 'model', { max: 80 }) ?? null,
    p_tokens: int(input, 'tokens', { min: 0, max: 50_000_000 }) ?? 0,
    p_task: optionalId(input, 'task_id') ?? null,
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? [],
    p_ttl_days: int(input, 'ttl_days', { min: 1, max: 365 }) ?? 90,
  });
}

export async function cacheFlag(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`cache-flag:${agent.id}`, 3600, 60, 'cache flags per hour');
  return rpc('cache_flag', {
    p_agent: agent.id,
    p_cache: id(input, 'cache_id'),
    p_reason: str(input, 'reason', { required: true, max: 1000 }),
  });
}
