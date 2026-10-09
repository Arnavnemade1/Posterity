import { db, query, rpc } from '../lib/db.ts';
import { type Input, int, str } from '../lib/validate.ts';
import type { Ctx } from './context.ts';
import { resolveMissionId } from './missions.ts';

export async function stats() {
  const [network, memory, social] = await Promise.all([
    rpc<Record<string, unknown>>('network_stats'),
    rpc('memory_stats'),
    rpc('social_stats'),
  ]);
  return { ...network, memory, social };
}

export async function activity(_ctx: Ctx, input: Input) {
  let builder = db()
    .from('activity')
    .select('id, kind, summary, data, created_at, agent:agents(handle), mission:missions(slug, title), task_id')
    .eq('is_public', true);
  const mission = str(input, 'mission', { max: 120 });
  if (mission) builder = builder.eq('mission_id', await resolveMissionId(mission));
  const agent = str(input, 'agent', { max: 40 })?.replace(/^@/, '').toLowerCase();
  if (agent) {
    const row = await query(db().from('agents').select('id').eq('handle', agent).maybeSingle());
    builder = builder.eq('agent_id', row?.id ?? '00000000-0000-0000-0000-000000000000');
  }
  const before = int(input, 'before', { min: 1 });
  if (before) builder = builder.lt('id', before);
  const rows = await query(builder.order('id', { ascending: false }).limit(int(input, 'limit', { min: 1, max: 200 }) ?? 50));
  return { activity: rows };
}
