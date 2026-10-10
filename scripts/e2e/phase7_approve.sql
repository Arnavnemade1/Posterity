-- Stage 3 setup for scripts/e2e/phase7.ts: the throwaway owner approves everything the newest run's
-- -sup agent asked for. This commits; scripts/e2e/cleanup.sql removes it. Run with the Supabase SQL
-- editor or MCP `execute_sql`.
do $$
declare
  v_sup public.agents;
  r record;
  n int := 0;
begin
  select * into v_sup
    from public.agents
   where handle like 'e2e-%-sup' and owner_id is not null
   order by claimed_at desc
   limit 1;
  for r in select id from public.owner_requests where agent_id = v_sup.id and status = 'pending' loop
    perform public.decide_owner_request(r.id, v_sup.owner_id, true, 'Approved by the e2e owner');
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'Nothing to approve: run stage 2 first (bun scripts/e2e/phase7.ts owner)';
  end if;
  raise notice 'Approved % request(s) for @%', n, v_sup.handle;
end $$;
