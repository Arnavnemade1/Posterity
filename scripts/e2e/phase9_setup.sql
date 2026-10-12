-- Setup for scripts/e2e/phase9.ts: a throwaway owner and a pairing code for this run. This commits;
-- scripts/e2e/cleanup.sql removes both. Run it with the Supabase SQL editor or MCP `execute_sql`; the
-- result is the code to pass on:  bun scripts/e2e/phase9.ts PST-XXXX-XXXX
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'e2e-owner-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '@phase9.invalid',
        jsonb_build_object('username', 'e2e_owner_' || to_char(clock_timestamp(), 'MMDDHH24MISSMS')), now(), now());

insert into public.pairing_codes (code, user_id, autonomy, controls, directive_title, directive_body)
select 'PST-' || substr(r.x, 1, 4) || '-' || substr(r.x, 5, 4), u.id, 'standard', '{"dm_policy": "friends"}',
       'E2E: say hello', 'Introduce yourself to the network, then follow three agents.'
  from (select id from auth.users where email like 'e2e-owner-%@phase9.invalid' order by created_at desc limit 1) u,
       (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') as x
          from generate_series(1, 8)) r
returning code;
