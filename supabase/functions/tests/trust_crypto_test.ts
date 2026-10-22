import { verifyPossession, verifyTrustBeacon, verifyCustodyEnvelope } from '../api/lib/trust_crypto.ts';
import { bls12_381 } from 'npm:@noble/curves@2.0.1/bls12-381.js';
import quicknet from './fixtures/drand-quicknet.json' with { type: 'json' };
const check=(value:unknown,label:string)=>{if(!value)throw new Error(label);};
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
Deno.test('official quicknet round-one fixture verifies against its pinned public key',async()=>{
  check(await verifyTrustBeacon(quicknet.beacon,quicknet.info.public_key,1),'official network proof verifies');
});
Deno.test('possession is bound to the exact actor, challenge and requested declaration',async()=>{
  const key=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
  const publicKey=hex(new Uint8Array(await crypto.subtle.exportKey('raw',key.publicKey)));
  const message='posterity-possession-v1:challenge:actor:identity:{"hive_id":"bound"}';
  const sig=hex(new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,new TextEncoder().encode(message))));
  check(await verifyPossession(publicKey,sig,message),'valid possession');
  check(!await verifyPossession(publicKey,sig,message.replace('actor','another-actor')),'cross-actor replay rejected');
  check(!await verifyPossession(publicKey,sig,message.replace('bound','different-hive')),'hive substitution rejected');
  check(!await verifyPossession(publicKey,'00'.repeat(64),message),'invalid signature rejected');
});
Deno.test('beacons verify round, pinned BLS key, message encoding, signature and randomness',async()=>{
  const bls=bls12_381.shortSignatures,{secretKey,publicKey}=bls.keygen();
  const round=1234,bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(round),false);
  const message=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const signatureBytes=bls.sign(bls.hash(message,'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_'),secretKey).toBytes();
  const beacon={round,signature:hex(signatureBytes),randomness:hex(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(signatureBytes))))};
  const pk=publicKey.toBytes();
  check(await verifyTrustBeacon(beacon,hex(pk),round),'valid fixed beacon');
  check(!await verifyTrustBeacon(beacon,hex(pk),round+1),'wrong round rejected');
  check(!await verifyTrustBeacon({...beacon,randomness:'00'.repeat(32)},hex(pk),round),'wrong entropy rejected');
  const other=bls.keygen();
  check(!await verifyTrustBeacon(beacon,hex(other.publicKey.toBytes()),round),'unpinned signer rejected');
  check(!await verifyTrustBeacon({...beacon,signature:'00'.repeat(48)},hex(pk),round),'invalid signature rejected');
});
Deno.test('custody threshold counts distinct approved signers, never duplicate signatures',async()=>{
  const pairs=await Promise.all([1,2,3].map(()=>crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as Promise<CryptoKeyPair>));
  const keys=await Promise.all(pairs.map(async k=>hex(new Uint8Array(await crypto.subtle.exportKey('raw',k.publicKey)))));
  const canonical='{"receipt_id":"unique-finalized-deposit","units":"100"}';
  const sigs=await Promise.all(pairs.map(async(k,i)=>({public_key:keys[i],signature:hex(new Uint8Array(await crypto.subtle.sign('Ed25519',k.privateKey,new TextEncoder().encode(canonical))))})));
  check(await verifyCustodyEnvelope(canonical,sigs.slice(0,2),keys,2),'two approved signers');
  check(!await verifyCustodyEnvelope(canonical,[sigs[0],sigs[0]],keys,2),'duplicate signer cannot meet threshold');
  check(!await verifyCustodyEnvelope(canonical.replace('100','1000'),sigs,keys,2),'changed amount rejected');
  check(!await verifyCustodyEnvelope(canonical,sigs.slice(0,2),[keys[0],keys[2]],2),'unapproved signer cannot meet threshold');
});
