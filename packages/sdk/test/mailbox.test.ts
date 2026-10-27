import { expect, spyOn, test } from 'bun:test';
import { Posterity, processMailbox, watchMailbox } from '../src/index.ts';
import type { MailDelivery } from '../src/types.ts';

const mail: MailDelivery = { id:'letter',lease_token:'fence',lease_expires_at:new Date(Date.now()+300_000).toISOString(),attempts:1,created_at:new Date().toISOString(),
  letter:{kind:'message',message:{id:'message',conversation_id:'thread',body:'Please investigate',author:{handle:'peer',display_name:'Peer'}},conversation:{}} };
function client(handler: (path:string,body:Record<string,unknown>)=>unknown) {
  const calls: {path:string;body:Record<string,unknown>}[]=[];
  return {calls,api:new Posterity({baseUrl:'https://mail.test',apiKey:'pst_test',retries:0,fetch:async (url,init)=> {
    const path=new URL(String(url)).pathname;
    const body=init?.body?JSON.parse(String(init.body)):{};
    calls.push({path,body});
    const response=await handler(path,body);
    return response instanceof Response?response:Response.json(response);
  }})};
}

test('off-site handler receives the SDK and stable identity, then atomically replies and completes',async()=> {
  let claimed=false;
  const {api,calls}=client(path=>path.endsWith('/claim')?(claimed?{delivery:null}:(claimed=true,{delivery:mail})):{status:'completed',message:{id:'reply'}});
  const result=await processMailbox(api,async (delivery,ctx)=> {
    expect(ctx.client).toBe(api);expect(ctx.idempotencyKey).toBe(delivery.id);expect(ctx.signal.aborted).toBe(false);
    return {reply:'Investigation result',note:'Handled'};
  });
  expect(result[0].status).toBe('completed');
  expect(calls[1]).toEqual({path:'/mailbox/letter/complete',body:{reply:'Investigation result',note:'Handled',lease_token:'fence'}});
  expect(calls.some(c=>c.path==='/conversations/thread')).toBe(false);
});

test('owner approvals are receipts, not failures to resend',async()=> {
  const {api,calls}=client(path=>path.endsWith('/claim')?{delivery:mail}:Response.json({status:'awaiting_owner',owner_request_id:'approval'},{status:202}));
  const result=await processMailbox(api,async()=>({reply:'Owner-reviewed reply'}),{limit:1});
  expect(result[0].status).toBe('awaiting_owner');expect(calls).toHaveLength(2);
});

test('handler failure, malformed output, and deferral never acknowledge a letter',async()=> {
  for(const choice of ['throw','invalid','defer']) {
    const {api,calls}=client(path=>path.endsWith('/claim')?{delivery:mail}:{status:'retry_scheduled'});
    const result=await processMailbox(api,async()=> {
      if(choice==='throw')throw new Error('Worker unavailable');
      if(choice==='defer')return null;
      return {reply:'',unexpected:'route'} as never;
    },{limit:1});
    expect(result[0].status).toBe(choice==='defer'?'deferred':'failed');
    expect(calls.map(c=>c.path)).toEqual(['/mailbox/claim','/mailbox/letter/retry']);
  }
});

test('lost completion responses never replay the handler or issue another reply',async()=> {
  const {api,calls}=client(path=> {
    if(path.endsWith('/claim'))return {delivery:mail};
    if(path.endsWith('/complete'))throw new Error('Response lost after commit');
    return Response.json({error:{code:'conflict',message:'Already completed'}},{status:409});
  });
  let runs=0;
  const result=await processMailbox(api,async()=>{runs++;return {reply:'Only once'};},{limit:1});
  expect(runs).toBe(1);expect(result[0].status).toBe('failed');
  expect(calls.filter(c=>c.path.endsWith('/complete'))).toHaveLength(1);
});

test('lost lease cancels the handler and fences completion',async()=> {
  const realInterval=globalThis.setInterval;
  const timer=spyOn(globalThis,'setInterval').mockImplementation(((fn:()=>void)=>realInterval(fn,5)) as typeof setInterval);
  try {
    const {api,calls}=client(path=>path.endsWith('/claim')?{delivery:mail}:path.endsWith('/renew')?
      Response.json({error:{code:'conflict',message:'Lease lost'}},{status:409}):{status:'retry_scheduled'});
    const result=await processMailbox(api,async(_delivery,{signal})=> {
      await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
      return {reply:'Must not be sent'};
    },{limit:1,leaseSeconds:30});
    expect(result[0].status).toBe('failed');expect(calls.some(c=>c.path.endsWith('/renew'))).toBe(true);
    expect(calls.some(c=>c.path.endsWith('/complete'))).toBe(false);
  } finally {timer.mockRestore();}
});

test('shutdown stops mailbox polling and refuses invalid cadence before network calls',async()=> {
  const stop=new AbortController();
  const {api,calls}=client(()=>{stop.abort();return {delivery:null};});
  await watchMailbox(api,async()=>({}),{signal:stop.signal});
  expect(calls).toHaveLength(1);
  await expect(watchMailbox(api,async()=>({}),{pollMs:0})).rejects.toThrow('pollMs');
  await expect(processMailbox(api,async()=>({}),{leaseSeconds:0})).rejects.toThrow('leaseSeconds');
  await expect(processMailbox(api,async()=>({}),{limit:NaN})).rejects.toThrow('limit');
  await expect(watchMailbox(api,async()=>({}),{limit:0})).rejects.toThrow('limit');
  expect(calls).toHaveLength(1);
});

test('revoked credentials stop the background watcher instead of polling forever',async()=> {
  const {api,calls}=client(()=>Response.json({error:{code:'unauthorized',message:'Key revoked'}},{status:401}));
  await expect(watchMailbox(api,async()=>({}))).rejects.toThrow('Key revoked');
  expect(calls).toHaveLength(1);
});

test('shutdown during claim releases delivery without starting the handler',async()=> {
  const stop=new AbortController();
  const {api,calls}=client(path=> {
    if(path.endsWith('/claim')) {stop.abort();return {delivery:mail};}
    return {status:'retry_scheduled'};
  });
  let runs=0;
  await processMailbox(api,async()=>{runs++;return {};},{signal:stop.signal});
  expect(runs).toBe(0);expect(calls.map(c=>c.path)).toEqual(['/mailbox/claim','/mailbox/letter/retry']);
});
