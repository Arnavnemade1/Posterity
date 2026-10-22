import { expect, test } from 'bun:test';
import { Posterity, sealEnsembleDraft, responsesEnsembleAdapter, verifyTrustClaim } from '../src/index.ts';

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

test('accountable drafts bind reasons and vector reference as exact sealed bytes', async () => {
  const input={ensemble_id:ensemble,member_id:member,round:1,kind:'draft' as const,summary:'Claim π',
    accountability:{reasoning:'The critic can inspect this explicit explanation and challenge the declared evidence.',claims:['Inspect evidence'],assumptions:[],evidence:['Fixture'],uncertainties:[]},vector_hash:'a'.repeat(64)};
  const sealed=await sealEnsembleDraft(input,nonce);
  expect(sealed.algorithm).toBe('accountable-v1');
  expect((await sealEnsembleDraft({...input,vector_hash:'b'.repeat(64)},nonce)).digest).not.toBe(sealed.digest);
  expect((await sealEnsembleDraft({...input,accountability:{...input.accountability,claims:['A different claim']}},nonce)).digest).not.toBe(sealed.digest);
  await expect(sealEnsembleDraft({...input,accountability:undefined},nonce)).rejects.toThrow('accountability');
});

test('portable claims require a pinned home signature and keep T0 or suspended standing nonexportable', async () => {
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
  const hex=(v:Uint8Array)=>Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
  const publicKey=hex(new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey)));
  const now=Date.now(),policy={home:'https://home.test',publicKey,now};
  const claim={schema:'posterity-reputation-v1',home:policy.home,tier:2,scope:'local_policy_only',issued_at:new Date(now-1000).toISOString(),expires_at:new Date(now+1000).toISOString(),global_score:null};
  const sign=async(value:unknown)=>{const canonical=JSON.stringify(value);return {canonical,signature:hex(new Uint8Array(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(canonical))))};};
  const valid=await sign(claim);
  expect(await verifyTrustClaim(valid,policy)).toMatchObject({signatureValid:true,admissible:true,authority:'local_policy_only'});
  expect((await verifyTrustClaim({...valid,canonical:valid.canonical.replace('"tier":2','"tier":1')},policy)).signatureValid).toBe(false);
  expect((await verifyTrustClaim({...valid,signature:null},policy)).admissible).toBe(false);
  expect((await verifyTrustClaim(valid,{...policy,home:'https://other.test'})).admissible).toBe(false);
  expect((await verifyTrustClaim(valid,{...policy,now:now+2000})).admissible).toBe(false);
  expect((await verifyTrustClaim(await sign({...claim,global_score:999}),policy)).admissible).toBe(false);
  expect(await verifyTrustClaim(await sign({...claim,tier:0,scope:'quarantine_nonexport'}),policy)).toMatchObject({signatureValid:true,admissible:false});
  expect((await verifyTrustClaim(await sign({...claim,scope:'suspended_nonexport'}),policy)).admissible).toBe(false);
  expect((await verifyTrustClaim(await sign({...claim,tier:1.5}),policy)).admissible).toBe(false);
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
