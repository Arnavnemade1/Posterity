import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Plain JS CLI
import { main } from '../posterity.mjs';

test('mail watch feeds JSON to an operator executable and completes its reply without a browser',async()=> {
  const dir=await mkdtemp(join(tmpdir(),'posterity-mail-'));
  try {
    const handler=join(dir,'handler');
    await writeFile(handler,`#!${process.execPath}\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const {delivery,idempotency_key}=JSON.parse(input);if(idempotency_key!==delivery.id)process.exit(1);console.log(JSON.stringify({reply:'Action completed off-site'}));});`,{mode:0o700});
    const calls:{path:string;body:unknown}[]=[];
    let claims=0;
    const output:string[]=[];
    const code=await main(['mail','watch','--handler',handler,'--once','--json'],{
      env:{POSTERITY_CONFIG_DIR:dir,POSTERITY_KEY:'pst_local_test',POSTERITY_API:'https://mail.test'},out:(s:string)=>output.push(s),
      fetch:async(url:string,init:RequestInit)=> {
        const path=new URL(url).pathname;calls.push({path,body:JSON.parse(String(init.body))});
        return Response.json(path==='/mailbox/claim'?(claims++?{delivery:null}:{delivery:{id:'letter',lease_token:'token',letter:{kind:'message',message:{body:'Request'}}}}):{status:'completed'});
      },
    });
    expect(code).toBe(0);expect(JSON.parse(output[0])).toEqual({processed:1,failed:0});
    expect(calls.find(c=>c.path.endsWith('/complete'))?.body).toEqual({reply:'Action completed off-site',lease_token:'token'});
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('invalid handler output retries mail, reports failure, and never acknowledges',async()=> {
  const dir=await mkdtemp(join(tmpdir(),'posterity-mail-'));
  try {
    const handler=join(dir,'handler');
    await writeFile(handler,`#!${process.execPath}\nconsole.log('{"command":"unapproved"}');`,{mode:0o700});
    const paths:string[]=[];
    const code=await main(['mail','watch','--handler',handler,'--once','--limit','1'],{
      env:{POSTERITY_CONFIG_DIR:dir,POSTERITY_KEY:'pst_local_test',POSTERITY_API:'https://mail.test'},err:()=>{},out:()=>{},
      fetch:async(url:string)=> {
        const path=new URL(url).pathname;paths.push(path);
        return Response.json(path==='/mailbox/claim'?{delivery:{id:'letter',lease_token:'token'}}:{status:'retry_scheduled'});
      },
    });
    expect(code).toBe(1);expect(paths.some(p=>p.endsWith('/complete'))).toBe(false);expect(paths.some(p=>p.endsWith('/retry'))).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true});}
});
