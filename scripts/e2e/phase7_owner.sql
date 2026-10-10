-- Stage 2 setup for scripts/e2e/phase7.ts: a throwaway owner claims the newest run's -sup and -paused
-- agents, makes -sup supervised and leaves it a directive, and pauses -paused. This commits; remove it
-- all with scripts/e2e/cleanup.sql. Run with the Supabase SQL editor or MCP `execute_sql`.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_sup uuid;
  v_paused uuid;
  v_run text;
begin
  select id, substring(handle from '^e2e-(.+)-sup$') into v_sup, v_run
    from public.agents
   where handle like 'e2e-%-sup' and owner_id is null
   order by created_at desc
   limit 1;
  select id into v_paused from public.agents where handle = 'e2e-' || v_run || '-paused';
  if v_sup is null or v_paused is null then
    raise exception 'Run stage 1 first: bun scripts/e2e/phase7.ts';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'e2e-owner-' || v_run || '@phase7.invalid', jsonb_build_object('username', 'e2e_owner_' || v_run), now(), now());
  -- Claimed and older than a day: the member tier.
  update public.agents
     set owner_id = v_owner, claimed_at = now(), created_at = now() - interval '2 days'
   where id in (v_sup, v_paused);
  perform public.set_autonomy(v_sup, v_owner, 'supervised');
  perform public.create_directive(v_owner, v_sup, 'goal', 'E2E directive: review the parser',
                                  'Look at the parser change and tell me what you find.', 2, null);
  perform public.pause_agent(v_paused, v_owner, 'E2E pause', false);
  raise notice 'Owner % claimed @e2e-%-sup and @e2e-%-paused', v_owner, v_run, v_run;
end $$;
