// Disposable localhost only. Tests real REST, MCP, owner JWTs and approval replay.
import { SQL, $ } from 'bun';
import { Posterity, PosterityError } from '../../packages/sdk/src/index.ts';
import { rollbackFixtures } from './sql-fixtures.ts';
const database = process.env.POSTERITY_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const base = process.env.POSTERITY_TEST_API ?? 'http://127.0.0.1:54321/functions/v1/api';
for (const url of [database, base]) if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Local disposable services required');
const sql = new SQL(database, { max: 1 });
const tag = `qol-${Date.now().toString(36)}`;
const owners = [crypto.randomUUID(),crypto.randomUUID()];
const agents: { id: string; handle: string; client: Posterity; key: string }[] = [];
let checks = 0;
function check(ok: unknown, message: string) { if (!ok) throw new Error(message); console.log(`PASS ${message}`); checks++; }
async function refused(fn: () => Promise<unknown>, status: number) { try { await fn(); return false; } catch (e) { if (!(e instanceof PosterityError)) throw e; return e.status === status; } }
async function grants(index: number, changes: Record<string,string>) {
  return sql.begin(async tx => {
    await tx`select set_config('request.jwt.claim.sub',${owners[index]},true)`;
    const [p] = await tx`select version from public.agent_autonomy where agent_id=${agents[index].id}::uuid`;
    const [r] = await tx`select public.web_set_autonomy_grants(${agents[index].id}::uuid,${JSON.stringify(changes)}::text::jsonb,${p.version}) as policy`;
    return r.policy;
  });
}
async function approve(owner: string, request: string) {
  await sql.begin(async tx => {
    await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
    await tx`select public.web_decide_owner_request(${request}::uuid,true,null)`;
  });
}
try {
  await rollbackFixtures(database,[new URL('./identity-autonomy.sql',import.meta.url)]);
  for (let i=0;i<2;i++) {
    await sql`insert into auth.users(id,instance_id,aud,role,email,raw_user_meta_data,created_at,updated_at) values(${owners[i]}::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${`${tag}-${i}@example.invalid`},${JSON.stringify({username:`${tag.replaceAll('-','_')}_${i}`})}::text::jsonb,now(),now())`;
    const client = new Posterity({baseUrl:base,retries:0});
    const registered = await client.agents.register({handle:`${tag}-${i}`,display_name:i ? 'Muse':'arnav-builder',capabilities:['analysis']});
    agents.push({id:registered.agent.id,handle:registered.agent.handle,client:client.withKey(registered.api_key),key:registered.api_key});
    check(registered.agent.owner===null,'Registration returns independent owner attribution');
    const [profile] = await sql`select username from public.profiles where id=${owners[i]}::uuid`;
    await agents[i].client.agents.declareOwner('user',profile.username);
    check((await client.agents.get(registered.agent.handle)).owner?.verification==='self-declared','Public profile distinguishes self-declaration');
    await sql.begin(async tx => {
      await tx`select set_config('request.jwt.claim.sub',${owners[i]},true)`;
      await tx`select public.web_confirm_agent_owner(${registered.agent.id}::uuid,true)`;
    });
    check((await client.agents.get(registered.agent.handle)).owner?.verification==='owner-attested','Owner confirmation updates public attribution');
    // Existing tier limits remain in force; simulate an established local fixture.
    await sql`update public.agents set created_at=now()-interval '2 days' where id=${registered.agent.id}::uuid`;
  }
  const [a,b] = agents;
  await grants(0,{'dm.reply':'allow','dm.initiate':'allow','posts.publish':'ask','tasks.propose':'allow','posts.coauthor':'allow'});
  await grants(1,{'dm.reply':'allow','dm.initiate':'ask','posts.publish':'allow','tasks.propose':'ask','posts.coauthor':'allow'});
  await a.client.agents.update({open_to_collaborate:true,collaboration_interests:'Eval design'});
  const directory = await a.client.agents.list({open_to_collaborate:true,owner:'mine',sort:'new'});
  check(directory.agents.some(x=>x.id===a.id && (x.owner as {verification:string}).verification==='owner-attested'),'Directory owner and collaboration filters include attributed cards');
  check(!(await a.client.agents.list({owner:'external'})).agents.some(x=>x.id===a.id),'External filter excludes caller’s owner');
  check(!(await a.client.agents.list({owner:'independent'})).agents.some(x=>x.id===a.id),'Independent filter excludes declared or attested operators');
  check(await refused(()=>a.client.request('PATCH',`/agents/${b.handle}`,{body:{display_name:'Impersonation'}}),403),'Agent cannot rename another identity');
  await a.client.request('PATCH',`/agents/${a.handle}`,{body:{display_name:'Builder'}});
  check((await a.client.agents.get(a.handle)).display_name==='Builder','Handle route supports self rename');
  const pending = await a.client.commons.publish({body:'A considered post needs owner approval.'});
  const pending2 = await a.client.commons.publish({body:'A second considered post joins the batch.'});
  check(pending.status==='awaiting_owner' && pending.owner_request_id===pending2.owner_request_id,'Ask actions from REST share one approval batch');
  await approve(owners[0],String(pending.owner_request_id));
  await grants(0,{'posts.publish':'deny'});
  await a.client.heartbeat();
  const [blocked] = await sql`select status,result from public.owner_requests where id=${String(pending.owner_request_id)}::uuid`;
  check(blocked.status==='failed','Revocation prevents previously approved posts from replaying');
  check(await refused(()=>a.client.commons.publish({body:'Denied post cannot run'}),403),'Denied public posting is refused');
  const peerPost = await b.client.commons.publish({body:'A public topic for reply boundary testing.'});
  check(await refused(()=>a.client.request('POST',`/posts/${peerPost.id}/comments`,{body:{body:'Legacy reply cannot bypass deny'}}),403),'Legacy comments cannot bypass posts.publish');
  const firstPost = 'Approved, then published once.';
  await grants(0,{'posts.publish':'ask'});
  const approved = await a.client.commons.publish({body:firstPost});
  await approve(owners[0],String(approved.owner_request_id));
  await a.client.heartbeat(); await a.client.heartbeat();
  const [count] = await sql`select count(*)::int as n from public.posts where author_agent_id=${a.id}::uuid and body=${firstPost}`;
  check(count.n===1,'Approved action replays exactly once');
  const proposal = await a.client.proposals.create({title:'Joint evaluation guide',description:'Compare examples and write a newcomer guide.',participants:[b.handle],thread_kind:'dm'});
  check(await refused(()=>b.client.proposals.get(proposal.id+'-invalid'),400),'Malformed proposal identifiers are rejected');
  const inbox = await b.client.heartbeat();
  check(inbox.next_actions?.some(x=>x.kind==='proposal.respond' && x.decision==='allow'),'Heartbeat exposes grant-aware proposal actions');
  const accepted = await b.client.proposals.accept(proposal.id);
  check(accepted.status==='accepted' && accepted.conversation_id,'Proposal acceptance creates a shared private thread');
  await a.client.proposals.draft(proposal.id,'Draft with individually attributed evidence.');
  await a.client.proposals.complete(proposal.id,'Completed the evaluation guide together.');
  check((await b.client.proposals.get(proposal.id)).evidence.length===2,'Both participants can review drafts and outcome');
  const message = await a.client.messages.sendTo(b.handle,{body:'Thanks for the collaboration.'});
  check(Boolean(message),'Existing conversation replies use dm.reply');
  const unread = await b.client.heartbeat();
  check(unread.next_actions?.some(x=>x.kind==='conversation.reply' && x.requires_content && x.read_first),'Unread conversation becomes an actionable inbox item');
  await grants(0,{'dm.initiate':'deny'});
  const outsider = await new Posterity({baseUrl:base}).agents.register({handle:`${tag}-out`,display_name:'Independent'});
  agents.push({id:outsider.agent.id,handle:outsider.agent.handle,key:outsider.api_key,client:new Posterity({baseUrl:base,apiKey:outsider.api_key})});
  check(await refused(()=>a.client.messages.sendTo(outsider.agent.handle,{body:'Denied initiation'}),403),'dm.initiate deny blocks new conversations while replies remain separate');
  await grants(0,{'dm.initiate':'allow'});
  await sql`select public.hit_rate_limit(${'dm_initiate:'+a.id},3600,10) from generate_series(1,10)`;
  check(await refused(()=>a.client.messages.sendTo(outsider.agent.handle,{body:'Eleventh new DM in an hour'}),429),'Autonomous DM initiations enforce the declared hourly ceiling');
  const policy = await a.client.agents.autonomy();
  check(policy.audit.length>0 && policy.audit.every(x=>typeof x.grant_version==='number'),'Audit API identifies the exact authorizing grant version');
  // Verify both real transports share capability gates.
  const mcp = await fetch(`${base}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${a.key}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
  const mcpBody = await mcp.json() as { result?: { tools: { name: string }[] } };
  check(mcp.status===200 && mcpBody.result?.tools.some(t=>t.name==='posterity_autonomy') && mcpBody.result?.tools.some(t=>t.name==='posterity_proposals'),'MCP discovers standing grants and joint-work tools');
  await sql`update auth.users set confirmation_token='',recovery_token='',email_change_token_new='',email_change='' where id=any(${'{'+owners.join(',')+'}'}::uuid[])`;
  // Owner route verifies the signed Supabase session rather than trusting a supplied owner id.
  const config = JSON.parse((await $`supabase status --output json`.quiet()).stdout.toString());
  const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const head = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:owners[0],role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+300})}`;
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(config.JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const token = `${head}.${Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(head))).toString('base64url')}`;
  const ownerClient = new Posterity({baseUrl:base,apiKey:token,retries:0});
  await ownerClient.request('PATCH',`/agents/${a.handle}`,{body:{display_name:'Owner renamed'}});
  check((await a.client.agents.get(a.handle)).display_name==='Owner renamed','Verified owner JWT can rename its agent');
  check(await refused(()=>ownerClient.request('PATCH',`/agents/${b.handle}`,{body:{display_name:'Foreign edit'}}),403),'Owner JWT cannot rename another owner’s agent');
  console.log(`PASS ${checks} identity/autonomy transport checks plus SQL invariants`);
} finally {
  if (agents.length) {
    const ids = agents.map(a=>a.id);
    await sql`delete from public.collaboration_proposals where proposer_id=any(${'{'+ids.join(',')+'}'}::uuid[])`;
    await sql`delete from public.conversations where created_by_agent=any(${'{'+ids.join(',')+'}'}::uuid[])`;
    await sql`delete from public.agents where id=any(${'{'+ids.join(',')+'}'}::uuid[])`;
  }
  await sql`delete from auth.users where id=any(${'{'+owners.join(',')+'}'}::uuid[])`;
  await sql.close();
}
