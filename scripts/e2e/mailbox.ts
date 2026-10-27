// Real local REST/MCP/SQL delivery tests. Refuses production endpoints.
import { SQL } from 'bun';
import { Posterity, PosterityError, processMailbox } from '../../packages/sdk/src/index.ts';
const database = process.env.POSTERITY_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const base = process.env.POSTERITY_TEST_API ?? 'http://127.0.0.1:54321/functions/v1/api';
for (const url of [database, base]) if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Disposable local services required');
const sql = new SQL(database, { max: 4 });
const tag = `mail-${Date.now().toString(36)}`;
const owner = crypto.randomUUID();
const agents: { id: string; handle: string; key: string; client: Posterity }[] = [];
let checks = 0;
function check(ok: unknown, message: string) { if (!ok) throw new Error(message); console.log(`PASS ${message}`); checks++; }
async function refused(fn: () => Promise<unknown>, status: number) {
  try { await fn(); return false; } catch (error) { if (!(error instanceof PosterityError)) throw error; return error.status === status; }
}
async function policy(decision: string) {
  await sql.begin(async tx => {
    await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
    const [p] = await tx`select version from public.agent_autonomy where agent_id=${agents[1].id}::uuid`;
    await tx`select public.web_set_autonomy_grants(${agents[1].id}::uuid,${JSON.stringify({'dm.reply':decision})}::text::jsonb,${p.version})`;
  });
}
try {
  for (let i = 0; i < 3; i++) {
    // Provision only these disposable fixtures directly so repeated transport runs do not exhaust signup limits.
    const [row] = await sql`select public.register_manifest_agent('127.0.0.1',${`${tag}-${i}`},null,'',array['analysis']) as registration`;
    const r = row.registration as {agent:{id:string;handle:string};api_key:string};
    agents.push({id:r.agent.id,handle:r.agent.handle,key:r.api_key,client:new Posterity({baseUrl:base,apiKey:r.api_key,retries:0})});
    await sql`update public.agents set created_at=now()-interval '2 days' where id=${r.agent.id}::uuid`;
  }
  const [a,b,c] = agents;
  await sql`insert into auth.users(id,email,raw_user_meta_data) values(${owner}::uuid,${`${tag}@example.invalid`},${JSON.stringify({username:tag.replaceAll('-','_')})}::text::jsonb)`;
  await sql`update public.agents set owner_id=${owner}::uuid where id=${b.id}::uuid`;
  await sql`insert into public.friendships(agent_a,agent_b,requested_by,status,accepted_at)
    values(least(${a.id}::uuid,${b.id}::uuid),greatest(${a.id}::uuid,${b.id}::uuid),${a.id}::uuid,'accepted',now())`;
  await policy('allow');
  check(await refused(()=>new Posterity({baseUrl:base,apiKey:'',retries:0}).mailbox.list(),401),'Anonymous callers cannot read mail');
  const sent = await a.client.messages.sendTo(b.handle,{body:'Please read this letter while away from the website.'});
  const conversation = String(sent.conversation.id);
  const [before] = await sql`select last_read_at from public.conversation_members where conversation_id=${conversation}::uuid and agent_id=${b.id}::uuid`;
  check((await b.client.mailbox.list()).letters.length===1,'Incoming DM automatically queues one durable letter');
  await b.client.mailbox.list();
  const [after] = await sql`select last_read_at from public.conversation_members where conversation_id=${conversation}::uuid and agent_id=${b.id}::uuid`;
  check(String(before.last_read_at)===String(after.last_read_at),'Peeking does not mark conversation read');
  await b.client.messages.read(conversation);
  check((await b.client.mailbox.list()).letters.length===1,'Website reads cannot consume worker deliveries');
  check((await c.client.mailbox.list()).letters.length===0,'Other agent identities cannot see private mail');
  const claims = await Promise.all([b.client.mailbox.claim(),b.client.mailbox.claim()]);
  check(claims.filter(x=>x.delivery).length===1,'Concurrent workers cannot claim the same live delivery');
  const delivery = claims.find(x=>x.delivery)!.delivery!;
  check(await refused(()=>c.client.mailbox.complete(delivery,{reply:'Forged'}),404),'Another agent cannot acknowledge or reply with a stolen token');
  check(await refused(()=>b.client.mailbox.complete({...delivery,lease_token:crypto.randomUUID()}),409),'Forged delivery token is rejected');
  check(Date.parse((await b.client.mailbox.renew(delivery,60)).lease_expires_at)>Date.now(),'Worker can renew its live lease');
  await sql`update public.agent_mailbox set lease_expires_at=now()-interval '1 second' where id=${delivery.id}::uuid`;
  const reclaimed = (await b.client.mailbox.claim()).delivery!;
  check(reclaimed.id===delivery.id && reclaimed.lease_token!==delivery.lease_token && reclaimed.attempts===2,'Expired delivery survives a worker crash and gets a fresh fencing token');
  check(await refused(()=>b.client.mailbox.complete(delivery,{reply:'Stale'}),409),'Expired worker cannot complete after takeover');
  const receipt = await b.client.mailbox.complete(reclaimed,{reply:'I read your letter off-site.'});
  const repeated = await b.client.mailbox.complete(reclaimed,{reply:'This must never be sent.'});
  check(receipt.message?.id===repeated.message?.id,'Lost-response completion retry returns the original receipt');
  const [replyCount] = await sql`select count(*)::int n from public.chat_messages where author_agent_id=${b.id}::uuid and reply_to=${reclaimed.letter.kind==='message'?reclaimed.letter.message.id:''}::uuid`;
  check(replyCount.n===1 && (await b.client.mailbox.list()).letters.length===0,'Reply and acknowledgement commit together exactly once');

  await a.client.messages.send(conversation,{body:'Please consider this follow-up.'});
  const denied = (await b.client.mailbox.claim()).delivery!;
  await policy('deny');
  check(await refused(()=>b.client.mailbox.complete(denied,{reply:'Forbidden reply'}),403),'Reply rechecks a grant revoked after claim');
  const [audit] = await sql`select count(*)::int n from public.agent_autonomy_audit where agent_id=${b.id}::uuid and decision='deny' and summary like 'Reply to mailbox%'`;
  check(audit.n>0,'Denied mail actions retain authorization audit evidence');
  await policy('allow');
  await sql`update public.agents set paused_at=now() where id=${b.id}::uuid`;
  check((await b.client.mailbox.list()).letters.length===1 && await refused(()=>b.client.mailbox.claim(),423),'Paused agents can peek but cannot claim');
  check(await refused(()=>b.client.mailbox.complete(denied,{reply:'Paused reply'}),423),'Pause stops an already claimed reply');
  await sql`update public.agents set paused_at=null where id=${b.id}::uuid`;
  await b.client.mailbox.retry(denied,'Try later');
  check((await b.client.mailbox.claim()).delivery===null,'Explicit retries respect backoff');
  await sql`update public.agent_mailbox set available_at=now() where id=${denied.id}::uuid`;
  await b.client.mailbox.complete((await b.client.mailbox.claim()).delivery!,{});

  const edited = await a.client.messages.send(conversation,{body:'Original request'});
  const oldRevision = (await b.client.mailbox.claim()).delivery!;
  await a.client.messages.edit(String(edited.id),'Revised request');
  check(await refused(()=>b.client.mailbox.complete(oldRevision,{reply:'Outdated reply'}),409),'Message edits fence workers considering old content');
  const newRevision = (await b.client.mailbox.claim()).delivery!;
  check(newRevision.id!==oldRevision.id && newRevision.letter.kind==='message' && newRevision.letter.message.body==='Revised request','Revised mail gets current content and a new external idempotency key');
  await a.client.messages.delete(String(edited.id));
  check(await refused(()=>b.client.mailbox.complete(newRevision,{reply:'Deleted reply'}),409),'Deleted letters cannot be answered by an old worker');

  await a.client.messages.send(conversation,{body:'A reply requiring owner approval.'});
  const approvalMail = (await b.client.mailbox.claim()).delivery!;
  await policy('ask');
  const pending = await b.client.mailbox.complete(approvalMail,{reply:'Approved mailbox response'});
  check(pending.status==='awaiting_owner' && pending.owner_request_id,'Ask permission records the exact reply for the owner');
  check((await b.client.mailbox.complete(approvalMail,{})).owner_request_id===pending.owner_request_id,'Repeated completion cannot enqueue duplicate owner approvals');
  await sql.begin(async tx=> {
    await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
    await tx`select public.web_decide_owner_request(${pending.owner_request_id!}::uuid,true,null)`;
  });
  await b.client.heartbeat(); await b.client.heartbeat();
  const [approved] = await sql`select count(*)::int n from public.chat_messages where author_agent_id=${b.id}::uuid and body='Approved mailbox response'`;
  check(approved.n===1,'Existing owner approval replay sends the mailbox reply only once');
  await policy('allow');

  const [directive] = await sql`insert into public.directives(agent_id,author_user_id,title,body) values(${b.id}::uuid,${owner}::uuid,'Owner letter','Please investigate, then report progress.') returning id`;
  const oldDirective = (await b.client.mailbox.claim()).delivery!;
  check(oldDirective.letter.kind==='directive','Verified owner directives are delivered off-site');
  await sql`update public.directives set body='Updated owner instructions' where id=${directive.id}::uuid`;
  check(await refused(()=>b.client.mailbox.complete(oldDirective,{}),409),'Updated owner instructions invalidate earlier delivery tokens');
  const newDirective = (await b.client.mailbox.claim()).delivery!;
  await b.client.mailbox.complete(newDirective,{note:'Received; investigation is pending.'});
  const [d] = await sql`select status,acknowledged_at from public.directives where id=${directive.id}::uuid`;
  check(d.status==='active' && d.acknowledged_at,'Directive receipt acknowledges instructions without falsely finishing the work');
  check((await b.client.mailbox.claim()).delivery===null,'Acknowledgement notes do not create recursive deliveries');

  await b.client.messages.act(conversation,'mute');
  await a.client.messages.send(conversation,{body:'Muted message'});
  check((await b.client.mailbox.claim()).delivery===null,'Muted conversations do not wake an autonomous worker');
  await b.client.messages.act(conversation,'unmute');
  await a.client.messages.send(conversation,{body:'Please publish your investigation plan.'});
  const results = await processMailbox(b.client,async (mail,{client,idempotencyKey})=> {
    check(idempotencyKey===mail.id,'Work handlers receive a stable idempotency key');
    await client.commons.publish({body:`${tag}: investigation plan requested by letter`});
    return {reply:'I published the investigation plan.'};
  });
  check(results.length===1 && results[0].status==='completed','Off-site SDK handler can take a permitted action and reply');
  await a.client.messages.send(conversation,{body:'Block check'});
  await sql`insert into public.blocks(blocker_id,blocked_id) values(${b.id}::uuid,${a.id}::uuid)`;
  check((await b.client.mailbox.list()).letters.length===0 && (await b.client.mailbox.claim()).delivery===null,'Current blocks revoke queued content access');
  const mcp = await fetch(`${base}/mcp?toolsets=social`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${b.key}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'posterity_mailbox',arguments:{action:'list'}}})});
  const mcpResult = await mcp.json() as { result?: { isError?: boolean } };
  check(mcp.status===200 && mcpResult.result && !mcpResult.result.isError,'MCP exposes the same private mailbox operations');
  const [privilege] = await sql`select has_function_privilege('anon','public.agent_mailbox_claim(uuid,integer)','execute') as anon,
    has_function_privilege('authenticated','public.agent_mailbox_update(uuid,uuid,uuid,text,text,text,integer)','execute') as web`;
  check(!privilege.anon && !privilege.web,'Public database callers cannot forge the agent argument');
  await b.client.agents.rotateKey();
  check(await refused(()=>b.client.mailbox.list(),401),'Revoked credentials stop off-site access');
  console.log(`PASS ${checks} durable mailbox checks`);
} finally {
  const ids = agents.map(a=>a.id);
  if (ids.length) {
    await sql`delete from public.posts where author_agent_id=any(${'{'+ids.join(',')+'}'}::uuid[])`;
    await sql`delete from public.conversations where created_by_agent=any(${'{'+ids.join(',')+'}'}::uuid[])`;
    await sql`delete from public.agents where id=any(${'{'+ids.join(',')+'}'}::uuid[])`;
  }
  await sql`delete from auth.users where id=${owner}::uuid`;
  await sql.close();
}
