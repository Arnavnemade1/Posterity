import { expect, test } from 'bun:test';
import { Posterity, sealEnsembleDraft, responsesEnsembleAdapter } from '../src/index.ts';

const ensemble = '00000000-0000-0000-0000-000000000015';
const member = '00000000-0000-0000-0000-000000000016';
const nonce = '1'.repeat(64);

test('sealed drafts bind UTF-8 bytes, framing, nonce, round and membership', async () => {
  const input = { ensemble_id: ensemble, member_id: member, round: 1, kind: 'draft' as const, summary: ' Proposal π ', content: 'First line\n🧪' };
  const sealed = await sealEnsembleDraft(input, nonce);
  // Independent Python hashlib vector, also checked against PostgreSQL in integration.
  expect(sealed.digest).toBe('35bd31e8d440d669bc181437e8c749538e8abd5ad54aa5b0704a34e9d2b580c5');
  expect((await sealEnsembleDraft({ ...input, round: 2 }, nonce)).digest).not.toBe(sealed.digest);
  expect((await sealEnsembleDraft({ ...input, member_id: ensemble }, nonce)).digest).not.toBe(sealed.digest);
  expect((await sealEnsembleDraft(input, '2'.repeat(64))).digest).not.toBe(sealed.digest);
  const first = await sealEnsembleDraft({ ...input, summary: 'a:b', content: 'c' }, nonce);
  const second = await sealEnsembleDraft({ ...input, summary: 'a', content: 'b:c' }, nonce);
  expect(first.digest).not.toBe(second.digest);
  const random = await sealEnsembleDraft(input);
  expect(random.nonce).toMatch(/^[0-9a-f]{64}$/);
  expect((await sealEnsembleDraft(input)).nonce).not.toBe(random.nonce);
  await expect(sealEnsembleDraft({ ...input, round: 0 }, nonce)).rejects.toThrow();
  await expect(sealEnsembleDraft(input, 'short')).rejects.toThrow();
});

test('trust and sealed transports preserve actor boundaries and commit secrecy', async () => {
  const calls: { url: string; body: Record<string, unknown> | undefined }[] = [];
  const client = new Posterity({ apiKey: 'pst_test', baseUrl: 'https://api.test', retries: 0,
    fetch: (async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ id: ensemble, custody: 'test_units' }); }) as typeof fetch });
  const sealed = await sealEnsembleDraft({ ensemble_id: ensemble, member_id: member, round: 1, kind: 'draft', summary: 'Private text' }, nonce);
  await client.ensembles.commit(ensemble, sealed.round, sealed.digest);
  expect(calls[0].body).toEqual({ round: 1, digest: sealed.digest });
  expect(JSON.stringify(calls[0])).not.toContain(nonce);
  expect(JSON.stringify(calls[0])).not.toContain('Private text');
  await responsesEnsembleAdapter(client).execute({ type: 'function_call', name: 'posterity_ensemble', call_id: 'reveal',
    arguments: JSON.stringify({ action: 'reveal', ensemble_id: ensemble, ...sealed }) });
  expect(calls[1].url).toBe(`https://api.test/ensembles/${ensemble}/reveal`);
  await client.trust.status();
  await client.trust.account({ limit: 1, offset: 2 });
  await client.trust.enroll();
  await client.trust.release();
  await client.trust.appeal(ensemble, 'Evidence has a reproducible confound');
  expect(calls[2].url).toBe('https://api.test/trust');
  expect(calls[3].url).toBe('https://api.test/me/trust?limit=1&offset=2');
  expect(calls.slice(4).every(c => !c.body || !('agent_id' in c.body))).toBe(true);
  expect(calls[6].url).toBe(`https://api.test/trust/cases/${ensemble}/appeal`);
});
