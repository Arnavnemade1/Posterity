import { expect, test } from 'bun:test';
import { Posterity, processInbox } from '../src/index.ts';
import type { Heartbeat, InboxAction } from '../src/types.ts';

const action = (patch: Partial<InboxAction> = {}): InboxAction => ({ kind:'conversation.reply', capability:'dm.reply', decision:'allow', grant_version:3, method:'POST', path:'/conversations/thread/messages', read_first:'/conversations/thread', requires_content:true, summary:'Unread reply', ...patch });

test('worker skips denied capabilities without reading or asking the model, and logs why', async () => {
  const log: unknown[] = [];
  const client = new Posterity({fetch: async () => { throw new Error('Unexpected network call'); }});
  const result = await processInbox(client,{next_actions:[action({decision:'deny'})]} as Heartbeat,async () => { throw new Error('Unexpected model call'); },r=>log.push(r));
  expect(result[0].status).toBe('skipped'); expect(result[0].reason).toContain('v3 denies dm.reply'); expect(log.length).toBe(1);
});

test('worker reads context and sends exact reply input; ask responses remain pending', async () => {
  const writes: {path:string;body:unknown}[]=[];
  const client=new Posterity({baseUrl:'https://example.test/api',retries:0,fetch:async (url,init)=> {
    if(init?.method==='GET')return Response.json({messages:[{body:'Topic context'}]});
    writes.push({path:new URL(String(url)).pathname,body:JSON.parse(String(init?.body))});
    return Response.json({status:'awaiting_owner',owner_request_id:'batch'}, {status:202});
  }});
  const result=await processInbox(client,{next_actions:[action({decision:'ask'})]} as Heartbeat,async (_action,context)=> {
    expect(context?.messages).toBeArray(); return {body:'A relevant reply'};
  });
  expect(result[0].status).toBe('awaiting_owner'); expect(writes).toEqual([{path:'/api/conversations/thread/messages',body:{body:'A relevant reply'}}]);
});

test('worker honors server revocation after its heartbeat snapshot and never retries a write', async () => {
  let attempts=0;
  const client=new Posterity({baseUrl:'https://example.test',fetch:async()=> {
    attempts++;return Response.json({error:{code:'not_allowed',message:'Standing grant was revoked'}},{status:403});
  }});
  const result=await processInbox(client,{next_actions:[action({read_first:undefined})]} as Heartbeat,async()=>({body:'Reply after revocation'}));
  expect(attempts).toBe(1);expect(result[0].status).toBe('failed');expect(result[0].reason).toContain('revoked');
});

test('worker can decline an invitation and defers empty generated replies', async()=> {
  const paths:string[]=[];
  const client=new Posterity({baseUrl:'https://example.test',fetch:async url=>{paths.push(new URL(String(url)).pathname);return Response.json({ok:true});}});
  const result=await processInbox(client,{next_actions:[action({kind:'proposal.respond',read_first:undefined,path:'/proposals/id/accept',requires_content:false}),action({read_first:undefined})]} as Heartbeat,async a=>a.kind==='proposal.respond'?{accept:false}:{body:'   '});
  expect(paths).toEqual(['/proposals/id/decline']);expect(result.map(r=>r.status)).toEqual(['executed','skipped']);
});
