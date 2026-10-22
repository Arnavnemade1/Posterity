import type { EnsembleContributionInput, SealedDraftReveal, Accountability } from './types.js';

/** Exact JSON bytes are committed; all fields are explicit, even empty lists. */
export function encodeAccountability(input: Accountability): string {
  return JSON.stringify({reasoning:input.reasoning,claims:input.claims,assumptions:input.assumptions,evidence:input.evidence,uncertainties:input.uncertainties});
}

/** Keep nonce and text private until every roster member has committed. */
export async function sealEnsembleDraft(input: {
  ensemble_id: string; round: number; member_id: string;
  kind: EnsembleContributionInput['kind']; summary: string; content?: string; accountability?: Accountability; vector_hash?: string;
}, nonce?: string): Promise<SealedDraftReveal & { digest: string }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.ensemble_id) || !uuid.test(input.member_id) || !Number.isInteger(input.round) || input.round < 1 || input.round > 2147483647) {
    throw new Error('A valid ensemble, member and positive round are required');
  }
  const secret = nonce ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('Nonce must be 32 random bytes as lowercase hex');
  if (input.vector_hash !== undefined && (!input.accountability || !/^[0-9a-f]{64}$/.test(input.vector_hash))) {
    throw new Error('Vector-derived evidence requires legible accountability and a lowercase SHA-256 digest');
  }
  const encoder = new TextEncoder();
  const content = input.content ?? '';
  const wire = `posterity-sealed-v1:${input.ensemble_id.toLowerCase()}:${input.round}:${input.member_id.toLowerCase()}:${input.kind}:${encoder.encode(input.summary).length}:${input.summary}:${encoder.encode(content).length}:${content}:${secret}`;
  const base = await crypto.subtle.digest('SHA-256', encoder.encode(wire));
  const baseHex=Array.from(new Uint8Array(base),b=>b.toString(16).padStart(2,'0')).join('');
  const accountability_wire=input.accountability?encodeAccountability(input.accountability):undefined;
  const hash=accountability_wire===undefined?base:await crypto.subtle.digest('SHA-256',encoder.encode(`posterity-accountable-v1:${baseHex}:${encoder.encode(accountability_wire).length}:${accountability_wire}:${input.vector_hash??''}`));
  return { round: input.round, kind: input.kind, summary: input.summary, content, nonce: secret,
    ...(accountability_wire===undefined?{}:{accountability_wire,vector_hash:input.vector_hash,algorithm:'accountable-v1' as const}),
    digest: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') };
}
