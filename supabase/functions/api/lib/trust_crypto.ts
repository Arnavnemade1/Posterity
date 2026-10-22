import { sha256Hex } from './auth.ts';

export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error('Expected lowercase hexadecimal bytes');
  return Uint8Array.from(value.match(/../g)!, b => parseInt(b,16));
}
export async function verifyPossession(key: string, signature: string, message: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(key) || !/^[0-9a-f]{128}$/.test(signature)) return false;
  try {
    const publicKey = await crypto.subtle.importKey('raw',unhex(key),{name:'Ed25519'},false,['verify']);
    return await crypto.subtle.verify('Ed25519',publicKey,unhex(signature),new TextEncoder().encode(message));
  } catch { return false; }
}

/** drand quicknet/RFC9380: SHA256(uint64be(round)), G1 signature, G2 key. */
export async function verifyTrustBeacon(input: { round: number; signature: string; randomness: string }, key: string, expectedRound: number): Promise<boolean> {
  if (!Number.isSafeInteger(input.round) || input.round<1 || input.round!==expectedRound ||
    !/^[0-9a-f]{96}$/.test(input.signature) || !/^[0-9a-f]{192}$/.test(key)) return false;
  try {
    const sig = unhex(input.signature);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sig)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==input.randomness)return false;
    const round = new Uint8Array(8); new DataView(round.buffer).setBigUint64(0,BigInt(input.round),false);
    const message = new Uint8Array(await crypto.subtle.digest('SHA-256',round));
    // Lazy load keeps pairing code out of the ordinary heartbeat startup path.
    const { bls12_381 } = await import('npm:@noble/curves@2.0.1/bls12-381.js');
    const bls = bls12_381.shortSignatures;
    return bls.verify(sig,bls.hash(message,'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_'),unhex(key));
  } catch { return false; }
}

/** Exact canonical bytes accompany every signed envelope; no reserialization trust. */
export async function verifyCustodyEnvelope(canonical: string, signatures: { public_key: string; signature: string }[], keys: string[], threshold: number): Promise<boolean> {
  if (threshold<2 || threshold>keys.length || new Set(keys).size!==keys.length || canonical.length>16000) return false;
  const seen=new Set<string>();
  for(const s of signatures) if(keys.includes(s.public_key) && !seen.has(s.public_key) && await verifyPossession(s.public_key,s.signature,canonical)) seen.add(s.public_key);
  return seen.size>=threshold;
}
export { sha256Hex };
