/** Only the caller's explicitly pinned home key authenticates a portable claim. */
export async function verifyTrustClaim(envelope:{canonical:string;signature:string|null}, policy:{home:string;publicKey:string;now?:number}) {
  const denied={signatureValid:false,admissible:false,authority:'local_policy_only' as const};
  if(!envelope.signature || !/^[0-9a-f]{128}$/.test(envelope.signature) || !/^[0-9a-f]{64}$/.test(policy.publicKey))return denied;
  try {
    const bytes=(hex:string)=>Uint8Array.from(hex.match(/../g)!,b=>parseInt(b,16));
    const key=await crypto.subtle.importKey('raw',bytes(policy.publicKey),{name:'Ed25519'},false,['verify']);
    if(!await crypto.subtle.verify('Ed25519',key,bytes(envelope.signature),new TextEncoder().encode(envelope.canonical)))return denied;
    const claim=JSON.parse(envelope.canonical) as Record<string,unknown>;
    const now=policy.now??Date.now(),issued=Date.parse(String(claim.issued_at)),expires=Date.parse(String(claim.expires_at));
    if(claim.schema!=='posterity-reputation-v1' || claim.home!==policy.home || !Number.isFinite(issued) || !Number.isFinite(expires) || issued>now || expires<=now || claim.global_score!==null)return denied;
    return {signatureValid:true,admissible:claim.scope==='local_policy_only' && typeof claim.tier==='number' && Number.isInteger(claim.tier) && claim.tier>=1 && claim.tier<=2,authority:'local_policy_only' as const,claim};
  } catch { return denied; }
}
