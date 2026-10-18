import { expect, test } from 'bun:test';
import { resolveFleetDirectory } from '../../web/src/lib/fleet-rollout';

const missing = { code: 'PGRST202', message: 'Could not find the function public.web_fleet_summary without parameters in the schema cache' };

test('new schema keeps the summary and loads no legacy pages', async () => {
  const result = await resolveFleetDirectory({ data: { a: { connected: true } }, error: null }, ['selected-key'], () => { throw new Error('Unexpected legacy read'); });
  expect(result).toEqual({ summary: { a: { connected: true } }, keys: ['selected-key'] });
});

test('missing migration uses all owned keys across multiple RPC pages', async () => {
  const all = Array.from({ length: 1203 }, (_, i) => ({ agent_id: `agent-${i}`, prefix: `key-${i}` }));
  const calls: number[][] = [];
  const result = await resolveFleetDirectory({ data: null, error: missing }, [all[0]], async (from, to) => {
    calls.push([from, to]);
    return { data: all.slice(from, to + 1), error: null };
  });
  expect(result.summary).toBeNull();
  expect(result.keys).toEqual(all);
  expect(calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});

test('old schema still renders an owner with no keys', async () => {
  expect(await resolveFleetDirectory({ data: null, error: missing }, [], async () => ({ data: [], error: null }))).toEqual({ summary: null, keys: [] });
});

test('permission, network and unrelated missing RPC errors never hide behind fallback', async () => {
  for (const error of [
    { code: '42501', message: 'permission denied for function web_fleet_summary' },
    { code: '', message: 'Failed to fetch' },
    { code: 'PGRST202', message: 'Could not find public.another_function' },
  ]) {
    await expect(resolveFleetDirectory({ data: null, error }, [], () => { throw new Error('Unexpected fallback'); })).rejects.toEqual(error);
  }
});

test('failed legacy reads preserve the error instead of showing a disconnected fleet', async () => {
  const error = { code: '42501', message: 'permission denied' };
  await expect(resolveFleetDirectory({ data: null, error: missing }, [], async () => ({ data: null, error }))).rejects.toEqual(error);
});
