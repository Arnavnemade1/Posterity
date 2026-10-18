import { expect, test } from 'bun:test';
import { Posterity, responsesEnsembleAdapter, mcpEnsembleAdapter, cliEnsembleAdapter } from '../src/index.ts';
const id = '00000000-0000-0000-0000-000000000013';
function fixture(status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const client = new Posterity({ apiKey: 'pst_test', baseUrl: 'https://api.test', retries: 0,
    fetch: (async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(status === 200 ? { id, status: 'active' } : { error: { code: 'conflict', message: 'Role taken' } }), { status }); }) as typeof fetch });
  return { client, calls };
}
test('three native interfaces execute the same contribution without provider branching', async () => {
  const action = { action: 'contribute', ensemble_id: id, kind: 'draft', summary: 'Attributed solution', content: 'Evidence' };
  const { client, calls } = fixture();
  const response = await responsesEnsembleAdapter(client).execute({ type: 'function_call', name: 'posterity_ensemble', arguments: JSON.stringify(action), call_id: 'call-native' });
  expect(response.call_id).toBe('call-native');
  expect(response.type).toBe('function_call_output');
  expect(JSON.parse(response.output).id).toBe(id);
  const mcp = await mcpEnsembleAdapter(client).execute({ name: 'posterity_ensemble', arguments: action });
  expect(JSON.parse(mcp.content[0].text).id).toBe(id);
  expect(JSON.parse(await cliEnsembleAdapter(client).execute(JSON.stringify(action))).id).toBe(id);
  expect(calls).toHaveLength(3);
  expect(new Set(calls.map((c) => c.url)).size).toBe(1);
  expect(calls[0].url).toBe(`https://api.test/ensembles/${id}/contributions`);
});
test('adapters reject unknown tools, actions, routing injection and malformed JSON before sending', async () => {
  const { client, calls } = fixture();
  await expect(responsesEnsembleAdapter(client).execute({ type: 'function_call', name: 'not_posterity', arguments: '{}', call_id: 'x' })).rejects.toThrow();
  await expect(cliEnsembleAdapter(client).execute('{')).rejects.toThrow();
  await expect(cliEnsembleAdapter(client).execute('{"action":"delete"}')).rejects.toThrow();
  await expect(cliEnsembleAdapter(client).execute('{"action":"get","ensemble_id":"../me"}')).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
test('native adapters preserve conflicts without retrying writes', async () => {
  const { client, calls } = fixture(409);
  await expect(cliEnsembleAdapter(client).execute(JSON.stringify({ action: 'join', ensemble_id: id, role: 'critic' }))).rejects.toMatchObject({ status: 409, code: 'conflict' });
  expect(calls).toHaveLength(1);
});
