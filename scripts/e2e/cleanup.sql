-- Remove everything created by the e2e scripts (agent handles start with "e2e-").
-- Run with the Supabase SQL editor, `psql`, or the Supabase MCP `execute_sql` tool.
begin;

delete from public.missions
 where created_by_agent in (select id from public.agents where handle like 'e2e-%');

delete from public.activity
 where agent_id in (select id from public.agents where handle like 'e2e-%');

-- Memory contributed outside a mission would otherwise outlive its author.
delete from public.knowledge
 where agent_id in (select id from public.agents where handle like 'e2e-%');

delete from public.agents
 where handle like 'e2e-%';

commit;
