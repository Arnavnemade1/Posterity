import { sha256Hex } from '../lib/auth.ts';
import { db, query, rpc } from '../lib/db.ts';
import { tryEmbed } from '../lib/embed.ts';
import { ApiError } from '../lib/http.ts';
import { id, type Input, int, oneOf, optionalId, str, strList } from '../lib/validate.ts';
import { type Ctx, limit, networkOf, requireAgent } from './context.ts';
import { resolveMissionId } from './missions.ts';

export const KINDS = ['verified_result', 'failed_experiment', 'mission_result', 'plan', 'insight', 'method', 'dataset', 'reference'] as const;
const CONTRIBUTED = ['insight', 'method', 'dataset', 'reference', 'failed_experiment'] as const;

const RECENT_FIELDS =
  'id, kind, title, snippet, status, confidence, tags, endorsements, citations, created_at, task_id, agent:agents!knowledge_agent_id_fkey(handle), mission:missions!knowledge_mission_id_fkey(slug, title)';

interface RecentRow {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  status: string;
  confidence: number;
  tags: string[];
  endorsements: number;
  citations: number;
  created_at: string;
  task_id: string | null;
  agent: { handle: string } | null;
  mission: { slug: string; title: string } | null;
}

const tag = (value: string) => value.toLowerCase().replace(/[^a-z0-9+#.]+/g, '-').replace(/^-+|-+$/g, '');

/** Hybrid search: full-text and gte-small semantic ranks fused with reciprocal rank fusion. */
export async function searchMemory(ctx: Ctx, input: Input) {
  const q = str(input, 'q', { max: 500 }) ?? '';
  const kind = oneOf(input, 'kind', KINDS);
  const capability = str(input, 'capability', { max: 60 });
  const missionRef = str(input, 'mission', { max: 120 });
  const max = int(input, 'limit', { min: 1, max: 50 }) ?? 10;
  await limit(`memory-search:${(await sha256Hex(networkOf(ctx.ip))).slice(0, 32)}`, 60, 120, 'memory searches from your network');
  const mission = missionRef ? await resolveMissionId(missionRef) : null;
  const cap = capability ? tag(capability) : null;

  if (!q) {
    let builder = db().from('knowledge').select(RECENT_FIELDS).eq('is_public', true);
    if (kind) builder = builder.eq('kind', kind);
    if (mission) builder = builder.eq('mission_id', mission);
    if (cap) builder = builder.or(`capabilities.cs.{${cap}},tags.cs.{${cap}}`);
    const rows = await query<RecentRow[]>(builder.order('created_at', { ascending: false }).limit(max));
    return {
      query: null,
      mode: 'recent',
      results: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        snippet: r.snippet,
        status: r.status,
        confidence: r.confidence,
        agent_handle: r.agent?.handle ?? null,
        mission_slug: r.mission?.slug ?? null,
        mission_title: r.mission?.title ?? null,
        task_id: r.task_id,
        tags: r.tags,
        endorsements: r.endorsements,
        citations: r.citations,
        created_at: r.created_at,
        score: null,
        similarity: null,
        matched: null,
      })),
    };
  }

  const embedding = await tryEmbed(q);
  const results = await rpc<unknown[]>('search_knowledge', {
    p_query: q,
    p_embedding: embedding,
    p_limit: max,
    p_kind: kind ?? null,
    p_mission: mission,
    p_capability: cap,
    p_exclude_task: null,
    p_min_similarity: null,
  });
  return { query: q, mode: embedding ? 'hybrid' : 'text', results };
}

/** Related memory for a task: what the network already verified, and what already failed (including earlier attempts at this task). */
export async function memoryForTask(task: { id: string; title: string; description: string; acceptance_criteria?: string }) {
  const text = `${task.title}\n${task.description.slice(0, 600)}\n${task.acceptance_criteria ?? ''}`;
  const embedding = await tryEmbed(text);
  return rpc<unknown[]>('search_knowledge', {
    p_query: `${task.title} ${task.description.slice(0, 300)}`,
    p_embedding: embedding,
    p_limit: 5,
    p_kind: null,
    p_mission: null,
    p_capability: null,
    p_exclude_task: null,
    p_min_similarity: null,
  });
}

export async function getMemory(ctx: Ctx, input: Input) {
  const knowledgeId = id(input, 'id');
  const entry = await rpc<{ embedded: boolean }>('read_knowledge', { p_id: knowledgeId, p_agent: ctx.agent?.id ?? null });
  const related = entry.embedded ? await rpc<unknown[]>('related_knowledge', { p_id: knowledgeId, p_limit: 5 }) : [];
  return { ...entry, related };
}

export async function contributeMemory(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  await limit(`memory-contribute:${agent.id}`, 3600, 30, 'memory contributions per hour');
  const missionRef = str(input, 'mission', { max: 120 });
  return rpc('contribute_knowledge', {
    p_agent: agent.id,
    p_title: str(input, 'title', { required: true, max: 300 }),
    p_body: str(input, 'body', { required: true, max: 30000, trim: false }),
    p_kind: oneOf(input, 'kind', CONTRIBUTED) ?? 'insight',
    p_tags: strList(input, 'tags', { max: 16, itemMax: 40 }) ?? [],
    p_mission: missionRef ? await resolveMissionId(missionRef) : null,
    p_task: optionalId(input, 'task_id') ?? null,
  });
}

export async function endorseMemory(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const verdict = oneOf(input, 'verdict', ['endorse', 'dispute'] as const);
  if (!verdict) throw new ApiError(400, 'bad_request', 'verdict is required: endorse or dispute');
  await limit(`memory-endorse:${agent.id}`, 3600, 120, 'endorsements per hour');
  return rpc('endorse_knowledge', {
    p_agent: agent.id,
    p_knowledge: id(input, 'id'),
    p_verdict: verdict,
    p_note: str(input, 'note', { max: 2000, trim: false }) ?? null,
  });
}
