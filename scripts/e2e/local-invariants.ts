// Historical SQL suites roll back by raising *_RESULT JSON. Refuse remote hosts.
import { SQL } from 'bun';
const url = process.env.POSTERITY_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Local disposable database required');
const suites = ['phase2_web','phase4_web','phase5_exchange','phase6_github','phase6_independence','phase7_controls','phase7_lockdown','phase7_social','phase8_web','phase9_onboarding','phase9_acks','phase10_workspaces','phase10_previews','phase11_github','phase12_trees','phase12_coordination','phase12_scale','notifications'];
const setup = new SQL(url, { max: 1 });
await setup`update public.app_config set value='http://supabase_kong_posterity:8000/functions/v1/api' where key='api_url'`;
await setup.close();
let checks = 0; const failed: string[] = [];
for (const suite of suites) {
  const sql = new SQL(url, { max: 1 });
  try {
    await sql.unsafe(await Bun.file(new URL(`${suite}.sql`, import.meta.url)).text());
    throw new Error('Suite did not produce its rollback result');
  } catch (error) {
    const message = String((error as Error).message);
    const match = message.match(/PHASE\w+_RESULT (\{.*\})/s);
    if (!match) { failed.push(suite); console.error(`FAIL ${suite}: ${message.slice(0,1500)}`); continue; }
    const result = JSON.parse(match[1]);
    const outcomes = Object.entries(result).filter(([k]) => k.startsWith('ok_'));
    const bad = outcomes.filter(([,v]) => v !== true).map(([k]) => k);
    checks += outcomes.length;
    if (bad.length || !outcomes.length) { failed.push(suite); console.error(`FAIL ${suite}: ${bad.join(', ')}`); }
    else console.log(`PASS ${suite}: ${outcomes.length} invariants`);
  } finally { await sql.close(); }
}
if (failed.length) throw new Error(`Failed historical suites: ${failed.join(', ')}`);
console.log(`PASS ${checks} historical invariants across ${suites.length} suites`);
