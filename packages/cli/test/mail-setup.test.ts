import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Plain JS CLI
import { main } from '../posterity.mjs';

let dir:string;
let output:string[];
let errors:string[];
let env:Record<string,string>;
const api='https://posterity.test/api';
const agentKey='pst_saved_agent_12345678';
const modelKey='sk-ant-test-private';
type Call={url:string;body:Record<string,unknown>;headers:Record<string,string>};
let calls:Call[];
let choice={decision:'reply',body:'A useful automatic reply'};
let claimed=false;
const fetchMock=async(url:string,init:RequestInit={})=> {
  calls.push({url:String(url),body:init.body?JSON.parse(String(init.body)):{},headers:init.headers as Record<string,string>});
  const path=new URL(url).pathname;
  return Response.json(path.endsWith('/me')?{id:'agent-id',handle:'researcher'}
    :path.startsWith('/v1/models/')?{id:'claude-haiku-5-5'}
    :path==='/v1/messages'?{content:[{type:'tool_use',name:'mail_choice',input:choice}],stop_reason:'tool_use'}
    :path.endsWith('/mailbox/claim')?(claimed?{delivery:null}:(claimed=true,{delivery:{id:'letter',lease_token:'token',letter:{kind:'message',message:{body:'Please explain this result.'}}}}))
    :path.endsWith('/complete')?{status:'completed'}
    :path.endsWith('/me/directives')?{directives:[]}
    :path.endsWith('/mailbox')?{letters:[]}
    :path.endsWith('/retry')?{status:'retry_scheduled'}
    :path.endsWith('/heartbeat')?{mail_only:true}
    :{error:{message:'Unexpected endpoint'}});
};
const run=(args:string[],extra:Record<string,unknown>={})=>main(args,{env,fetch:fetchMock,out:(s:string)=>output.push(s),err:(s:string)=>errors.push(s),...extra});
beforeEach(async()=> {
  dir=await mkdtemp(join(tmpdir(),'posterity-mail-setup-'));
  env={POSTERITY_CONFIG_DIR:dir,POSTERITY_API:api,POSTERITY_KEY:agentKey,ANTHROPIC_API_KEY:modelKey};
  output=[];errors=[];calls=[];claimed=false;choice={decision:'reply',body:'A useful automatic reply'};
});
afterEach(async()=> {
  await run(['mail','stop']);
  await rm(dir,{recursive:true,force:true});
});

test('setup reuses keys, verifies connections without generating tokens, and saves privately',async()=> {
  expect(await run(['mail','setup','--no-start','--json'],{ask:()=>{throw new Error('No prompt needed');}})).toBe(0);
  const settings=JSON.parse(await readFile(join(dir,'mail.json'),'utf8'));
  expect(settings.identity).toEqual({id:'agent-id',handle:'researcher',api});
  expect(settings.claude).toEqual({model:'claude-haiku-5-5',api_key:modelKey});
  for(const name of ['credentials.json','mail.json'])expect((await stat(join(dir,name))).mode&0o777).toBe(0o600);
  expect(calls.filter(c=>c.url.startsWith('https://api.anthropic.com/')).map(c=>c.headers.Authorization)).toEqual([`Bearer ${modelKey}`]);
  expect(calls.filter(c=>c.url.startsWith(api)).every(c=>c.headers.Authorization===`Bearer ${agentKey}`)).toBe(true);
  expect(calls.some(c=>c.url.endsWith('/messages')||c.url.endsWith('/claim'))).toBe(false);
  expect(output.join('')).not.toContain(agentKey);expect(output.join('')).not.toContain(modelKey);
});

test('first-time setup asks only for missing credentials and never prints either key',async()=> {
  delete env.POSTERITY_KEY;delete env.ANTHROPIC_API_KEY;
  const prompts:{question:string;secret:boolean}[]=[];
  const answers=[agentKey,modelKey];
  expect(await run(['mail','setup','--no-start'],{ask:async(question:string,opts:{secret:boolean})=>{prompts.push({question,...opts});return answers.shift();}})).toBe(0);
  expect(prompts).toHaveLength(2);expect(prompts.every(p=>p.secret)).toBe(true);
  expect(output.join('')).not.toContain(agentKey);expect(output.join('')).not.toContain(modelKey);
});

test('setup can create and save an identity directly from a chosen handle',async()=> {
  delete env.POSTERITY_KEY;
  expect(await run(['mail','setup','--handle','researcher','--code','PST-TEST-CODE','--no-start'],{
    fetch:async(url:string,init:RequestInit)=>url.endsWith('/agents/register')?
      Response.json({agent:{id:'agent-id',handle:'researcher'},api_key:agentKey}):fetchMock(url,init),
    ask:()=>{throw new Error('No prompt needed');},
  })).toBe(0);
  expect(JSON.parse(await readFile(join(dir,'credentials.json'),'utf8')).api_key).toBe(agentKey);
});

test('failed provider validation preserves previous settings and returns an actionable error',async()=> {
  await writeFile(join(dir,'mail.json'),'{}');
  expect(await run(['mail','setup','--no-start'],{fetch:async(url:string,init:RequestInit)=>String(url).includes('api.anthropic.com')?
    Response.json({error:{message:modelKey}},{status:401}):fetchMock(url,init)})).toBe(1);
  expect(await readFile(join(dir,'mail.json'),'utf8')).toBe('{}');
  expect(errors.join('')).toContain('Claude returned 401');expect(errors.join('')).not.toContain(modelKey);
});

test('setup explains missing server support before requesting a model key',async()=> {
  delete env.ANTHROPIC_API_KEY;
  expect(await run(['mail','setup','--no-start'],{ask:()=>{throw new Error('Do not prompt before mailbox works');},
    fetch:async(url:string,init:RequestInit)=>url.includes('/mailbox')?Response.json({error:{message:'Missing'}},{status:404}):fetchMock(url,init)})).toBe(1);
  expect(errors.join('')).toContain('has not enabled mail yet');
});

test('configured built-in replies work without an executable and preserve delivery fencing',async()=> {
  await run(['mail','setup','--no-start']);calls=[];
  expect(await run(['mail','watch','--once','--json'])).toBe(0);
  expect(calls.find(c=>c.url.endsWith('/letter/complete'))?.body).toEqual({reply:'A useful automatic reply',lease_token:'token'});
  expect(calls.some(c=>c.url===`${api}/me/directives`)).toBe(true);
  expect(calls.find(c=>c.url.endsWith('/heartbeat'))?.body).toEqual({mail_only:true});
  const provider=calls.find(c=>c.url.endsWith('/v1/messages'))!;
  expect(provider.body.system).toContain('never claim');
  expect(JSON.stringify(provider.body)).not.toContain(agentKey);expect(JSON.stringify(provider.body)).not.toContain('lease_token');
});

test('deferred model choices leave mail for retry and receipt notes do not invent replies',async()=> {
  await run(['mail','setup','--no-start']);calls=[];choice={decision:'defer',body:''};
  expect(await run(['mail','watch','--once'])).toBe(0);
  expect(calls.some(c=>c.url.endsWith('/complete'))).toBe(false);
  expect(calls.find(c=>c.url.endsWith('/retry'))?.body.lease_token).toBe('token');
});

test('a different saved identity cannot reuse the previous worker configuration',async()=> {
  await run(['mail','setup','--no-start']);
  expect(await run(['mail','start'],{fetch:async(url:string,init:RequestInit)=>url.endsWith('/me')?Response.json({id:'other-agent',handle:'other'}):fetchMock(url,init)})).toBe(1);
  expect(errors.join('')).toContain('saved agent changed');
});

test('profiles keep agent and provider credentials separate during setup',async()=> {
  await run(['login','pst_alpha_12345678','--profile','alpha']);
  await run(['login','pst_beta_12345678','--profile','beta']);
  expect(await run(['mail','setup','--profile','alpha','--no-start'])).toBe(0);
  delete env.ANTHROPIC_API_KEY;
  expect(await run(['mail','setup','--profile','beta','--no-start'],{ask:async()=> 'sk-ant-beta-private'})).toBe(0);
  const alpha=JSON.parse(await readFile(join(dir,'profiles/alpha/mail.json'),'utf8'));
  const beta=JSON.parse(await readFile(join(dir,'profiles/beta/mail.json'),'utf8'));
  expect(alpha.claude.api_key).toBe(modelKey);expect(beta.claude.api_key).toBe('sk-ant-beta-private');
  const lastAgentCall=calls.filter(c=>c.url.endsWith('/me')).at(-1)!;
  expect(lastAgentCall.headers.Authorization).toBe('Bearer pst_beta_12345678');
});

test('rerunning setup repairs invalid configuration instead of leaving users stuck',async()=> {
  await writeFile(join(dir,'mail.json'),'broken');
  expect(await run(['mail','setup','--no-start'])).toBe(0);
  expect(JSON.parse(await readFile(join(dir,'mail.json'),'utf8')).identity.handle).toBe('researcher');
});

test('setup privately replaces expired saved keys instead of reusing them forever',async()=> {
  await run(['mail','setup','--no-start']);
  delete env.POSTERITY_KEY;delete env.ANTHROPIC_API_KEY;
  const replacementAgent='pst_replacement_12345678';
  const replacementModel='sk-ant-replacement-private';
  const prompts:string[]=[];
  expect(await run(['mail','setup','--no-start'],{
    ask:async(question:string)=>{prompts.push(question);return question.includes('Posterity')?replacementAgent:replacementModel;},
    fetch:async(url:string,init:RequestInit)=> {
      const authorization=(init.headers as Record<string,string>).Authorization;
      if(authorization===`Bearer ${agentKey}`||authorization===`Bearer ${modelKey}`)return Response.json({error:{message:'Expired'}},{status:401});
      return fetchMock(url,init);
    },
  })).toBe(0);
  expect(prompts).toHaveLength(2);
  expect(JSON.parse(await readFile(join(dir,'credentials.json'),'utf8')).api_key).toBe(replacementAgent);
  expect(JSON.parse(await readFile(join(dir,'mail.json'),'utf8')).claude.api_key).toBe(replacementModel);
  expect(output.join('')).not.toContain(replacementAgent);expect(output.join('')).not.toContain(replacementModel);
});

test('real background lifecycle survives terminal detachment, avoids duplicate workers, and stops without credentials',async()=> {
  const server=createServer((req,res)=> {
    const path=req.url??'';
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(path.endsWith('/me')?{id:'real-agent',handle:'background'}
      :path.endsWith('/claim')?{delivery:null}:path.includes('/mailbox')?{letters:[]}:{next_steps:[]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};
  env={...process.env,POSTERITY_CONFIG_DIR:dir,POSTERITY_API:`http://127.0.0.1:${address.port}`,POSTERITY_KEY:agentKey} as Record<string,string>;
  const handler=join(dir,'handler');
  await writeFile(handler,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log('{}'));`,{mode:0o700});
  try {
    expect(await run(['mail','setup','--handler',handler,'--json'],{fetch:globalThis.fetch})).toBe(0);
    const first=JSON.parse(output.at(-1)!);expect(first.running).toBe(true);
    expect(await run(['mail','start','--json'],{fetch:globalThis.fetch})).toBe(0);
    expect(JSON.parse(output.at(-1)!).pid).toBe(first.pid);
    await rm(join(dir,'credentials.json'));delete env.POSTERITY_KEY;
    expect(await run(['mail','status','--json'])).toBe(0);expect(JSON.parse(output.at(-1)!).running).toBe(true);
    expect(await run(['mail','stop','--json'])).toBe(0);
    expect(await run(['mail','status','--json'])).toBe(0);expect(JSON.parse(output.at(-1)!).running).toBe(false);
    for(const name of ['mail.json','mail-worker.mjs','mail.log'])expect((await stat(join(dir,name))).mode&0o777).toBe(0o600);
  } finally {await run(['mail','stop']);await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);
