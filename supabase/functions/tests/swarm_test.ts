import { strict as assert } from 'node:assert';
import { validateSwarmVector } from '../api/ops/swarm.ts';

Deno.test('swarm vectors validate dimensions, integrity, codec, finite values and model-space metadata',async()=>{
 const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);view.setFloat32(0,1.25,true);view.setFloat32(4,-2.5,true);
 const digest=async(b:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
 const data=(b:Uint8Array)=>btoa(Array.from(b,n=>String.fromCharCode(n)).join(''));
 const v={space:'model@revision:layer',encoding:'f32le-base64',dimensions:2,data:data(bytes),sha256:await digest(bytes)};
 await validateSwarmVector(v);
 for(const invalid of [{...v,dimensions:3},{...v,sha256:'0'.repeat(64)},{...v,space:''},{...v,encoding:'unknown'},{...v,dimensions:16385}])await assert.rejects(()=>validateSwarmVector(invalid));
 view.setFloat32(0,NaN,true);await assert.rejects(async()=>validateSwarmVector({...v,data:data(bytes),sha256:await digest(bytes)}),/finite/);
});
