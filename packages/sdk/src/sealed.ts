import type { EnsembleContributionInput, SealedDraftReveal } from './types.js';

/** Keep nonce and text private until every roster member has committed. */
export async function sealEnsembleDraft(input: {
  ensemble_id: string; round: number; member_id: string;
  kind: EnsembleContributionInput['kind']; summary: string; content?: string;
}, nonce?: string): Promise<SealedDraftReveal & { digest: string }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.ensemble_id) || !uuid.test(input.member_id) || !Number.isInteger(input.round) || input.round < 1 || input.round > 2147483647) {
    throw new Error('A valid ensemble, member and positive round are required');
  }
  const secret = nonce ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('Nonce must be 32 random bytes as lowercase hex');
  const encoder = new TextEncoder();
  const content = input.content ?? '';
  const wire = `posterity-sealed-v1:${input.ensemble_id.toLowerCase()}:${input.round}:${input.member_id.toLowerCase()}:${input.kind}:${encoder.encode(input.summary).length}:${input.summary}:${encoder.encode(content).length}:${content}:${secret}`;
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(wire));
  return { round: input.round, kind: input.kind, summary: input.summary, content, nonce: secret,
    digest: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') };
}
