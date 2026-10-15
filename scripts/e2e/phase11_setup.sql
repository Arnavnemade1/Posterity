-- Stage 2 setup for scripts/e2e/phase11.ts: a throwaway owner claims the newest run's -alice and -bob,
-- has a (simulated) GitHub App installation with two repositories, and -alice's workspace is linked to
-- one of them. This commits; scripts/e2e/cleanup.sql removes it all. Run with the Supabase SQL editor
-- or MCP `execute_sql`.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_run text;
  v_alice uuid;
  v_bob uuid;
  v_ws uuid;
  v_installation bigint;
begin
  select id, substring(handle from '^e2e-(.+)-alice$') into v_alice, v_run
    from public.agents
   where handle like 'e2e-%-alice' and owner_id is null
   order by created_at desc
   limit 1;
  select id into v_bob from public.agents where handle = 'e2e-' || v_run || '-bob';
  select id into v_ws from public.workspaces where slug = 'e2e-' || v_run || '-gh';
  if v_alice is null or v_bob is null or v_ws is null then
    raise exception 'Run stage 1 first: bun scripts/e2e/phase11.ts';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'e2e-owner-' || v_run || '@phase11.invalid', jsonb_build_object('username', 'e2e_owner_' || v_run), now(), now());
  -- -bob stays unclaimed: an agent of someone else.
  update public.agents set owner_id = v_owner, claimed_at = now() where id = v_alice;

  -- Installation ids are GitHub's; e2e ones live far above real ones.
  v_installation := 900000000000 + (extract(epoch from now())::bigint % 1000000);
  perform public.gh_sync_installation(
    jsonb_build_object('id', v_installation, 'account', jsonb_build_object('login', 'e2e-' || v_run, 'id', 1, 'type', 'Organization')),
    jsonb_build_array(
      jsonb_build_object('id', v_installation + 1, 'full_name', 'e2e-' || v_run || '/site', 'private', false, 'default_branch', 'main'),
      jsonb_build_object('id', v_installation + 2, 'full_name', 'e2e-' || v_run || '/other', 'private', true, 'default_branch', 'main')),
    'replace', 'created');
  perform public.gh_claim_installation(v_installation, v_owner, 'e2e-' || v_run);
  perform public.gh_link(v_ws, v_alice, null, 'e2e-' || v_run || '/site', 'mirror', true);
  raise notice 'Owner % claimed @e2e-%-alice and installation %', v_owner, v_run, v_installation;
end $$;
