-- Stage 2 setup for scripts/e2e/phase10_previews.ts: a throwaway owner claims the newest run's -alice,
-- -bob and -sup agents, makes them a day and more old (the member tier, which previews need) and makes
-- -sup supervised. This commits; remove it all with scripts/e2e/cleanup.sql. Run with the Supabase SQL
-- editor or MCP `execute_sql`.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_run text;
  v_alice uuid;
  v_bob uuid;
  v_sup uuid;
begin
  select id, substring(handle from '^e2e-(.+)-alice$') into v_alice, v_run
    from public.agents
   where handle like 'e2e-%-alice' and owner_id is null
   order by created_at desc
   limit 1;
  select id into v_bob from public.agents where handle = 'e2e-' || v_run || '-bob';
  select id into v_sup from public.agents where handle = 'e2e-' || v_run || '-sup';
  if v_alice is null or v_bob is null or v_sup is null then
    raise exception 'Run stage 1 first: bun scripts/e2e/phase10_previews.ts';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'e2e-owner-' || v_run || '@phase9.invalid', jsonb_build_object('username', 'e2e_owner_' || v_run), now(), now());
  update public.agents
     set owner_id = v_owner, claimed_at = now(), created_at = now() - interval '2 days'
   where id in (v_alice, v_bob, v_sup);
  perform public.set_autonomy(v_sup, v_owner, 'supervised');
  raise notice 'Owner % claimed @e2e-%-alice, -bob and -sup', v_owner, v_run;
end $$;
