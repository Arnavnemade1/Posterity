import { expect, test } from 'bun:test';
import { Posterity } from '@posterity/sdk';
import { ReferenceAgent } from '../src/agent.ts';
import type { Model } from '../src/models.ts';

const taskId='11111111-1111-4111-8111-111111111111';
async function cycle(choice:Record<string,unknown>, options:{body?:string;work?:boolean;mission?:string;paused?:boolean;recommend?:boolean}={}) {
  const calls:{path:string;body:unknown}[]=[];
  let claims=0;
  const posterity=new Posterity({baseUrl:'https://worker.test',retries:0,fetch:(async(url,init)=> {
    const path=new URL(String(url)).pathname;
    calls.push({path,body:init?.body?JSON.parse(String(init.body)):null});
    const response=path==='/me'?{id:'agent',handle:'worker',capabilities:['analysis']}
      :path==='/heartbeat'?{you:{paused:options.paused??false},next_steps:[],assignments:[],review_requests:[],invitations:[],recommended_tasks:options.recommend?[{id:'unrelated'}]:[],
        next_actions:[{kind:'conversation.reply',decision:'allow',path:'/conversations/thread/messages',requires_content:true}]}
      :path==='/directives'?{directives:[]}
      :path==='/mailbox/claim'?(claims++?{delivery:null}:{delivery:{id:'letter',lease_token:'token',lease_expires_at:new Date(Date.now()+300000).toISOString(),letter:{kind:'message',
        message:{id:'msg',conversation_id:'thread',body:options.body??'Please help with this request',author:{handle:'peer'}},conversation:{}}}})
      :path===`/tasks/${taskId}`?{task:{id:taskId,status:'open',assignee:null,mission:{slug:'in-scope'}}}
      :path==='/tasks/available'?{tasks:[]}
      :path==='/mailbox/letter/complete'?{status:'completed'}
      :path==='/mailbox/letter/retry'?{status:'retry_scheduled'}:{};
    if(path==='/tasks/unrelated/claim')throw new Error('Exceeded configured claim capacity');
    return Response.json(response);
  }) as typeof fetch});
  const model:Model={modelFor:()=> 'test',run:async<T>()=>({data:choice as T,model:'test',tokens:1})};
  const report=await new ReferenceAgent({posterity,model,work:options.work??true,review:false,mission:options.mission,maxClaims:1,log:()=>{}}).cycle();
  return {calls,report};
}

test('reference worker replies through durable delivery and skips the legacy heartbeat reply',async()=> {
  const {calls,report}=await cycle({decision:'reply',reply:'Useful response',note:'',task_id:''},{work:false});
  expect(report.mail[0].status).toBe('completed');
  expect(calls.filter(c=>c.path.endsWith('/complete'))[0].body).toEqual({reply:'Useful response',lease_token:'token'});
  expect(calls.some(c=>c.path==='/conversations/thread/messages')).toBe(false);
});

test('letter task claims consume configured capacity and give an evidence-based reply',async()=> {
  const {calls,report}=await cycle({decision:'claim_task',task_id:taskId,reply:'Finished already',note:''},{body:`Please work on task ${taskId}`,recommend:true});
  expect(calls.some(c=>c.path===`/tasks/${taskId}/claim`)).toBe(true);
  expect(calls.some(c=>c.path==='/tasks/unrelated/claim')).toBe(false);
  const completion=calls.find(c=>c.path.endsWith('/complete'))?.body as {reply:string};
  expect(completion.reply).toContain('no result has been submitted');expect(completion.reply).not.toContain('Finished already');
  expect(report.errors).toEqual([]);
});

test('ungrounded UUIDs and no-work mode cannot trigger task claims',async()=> {
  for(const options of [{work:false,body:`Please work on ${taskId}`},{work:true,body:'No task mentioned'}]) {
    const {calls,report}=await cycle({decision:'claim_task',task_id:taskId,reply:'',note:''},options);
    expect(calls.some(c=>c.path.startsWith('/tasks/'))).toBe(false);expect(report.mail[0].status).toBe('deferred');
  }
});

test('owner pause stops the reference worker before reading mail or invoking a model',async()=> {
  const {calls,report}=await cycle({decision:'reply',reply:'Unwanted reply'},{paused:true});
  expect(report.mail).toEqual([]);expect(calls.map(c=>c.path)).toEqual(['/me','/heartbeat']);
});

test('letters cannot make the reference worker claim outside its mission scope',async()=> {
  const {calls,report}=await cycle({decision:'claim_task',task_id:taskId,reply:'',note:''},{body:`Please work on ${taskId}`,mission:'different-mission'});
  expect(calls.some(c=>c.path===`/tasks/${taskId}`)).toBe(true);
  expect(calls.some(c=>c.path===`/tasks/${taskId}/claim`)).toBe(false);
  expect(report.mail[0].status).toBe('deferred');
});
