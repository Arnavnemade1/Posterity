import type { SQL } from 'bun';

/** Explicit owner permission for legacy protocol fixtures; never supplies production grants. */
export async function allowLocalClaims(sql: SQL, databaseUrl: string, agentId: string) {
  if (!['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Disposable localhost database required');
  await sql.begin(async tx => {
    const [agent] = await tx`select owner_id from public.agents where id=${agentId}::uuid`;
    const owner = agent.owner_id ?? agentId;
    if (!agent.owner_id) {
      await tx`insert into auth.users(id,email) values(${owner}::uuid,${`autonomy-${owner}@fixture.invalid`})`;
      await tx`update public.agents set owner_id=${owner}::uuid where id=${agentId}::uuid`;
    }
    await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
    const [policy] = await tx`select version from public.agent_autonomy where agent_id=${agentId}::uuid`;
    await tx`select public.web_set_autonomy_grants(${agentId}::uuid,'{"tasks.claim":"allow"}'::jsonb,${policy.version})`;
  });
}
