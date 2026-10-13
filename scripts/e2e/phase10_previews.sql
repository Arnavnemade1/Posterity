-- Phase 10.2 database test: previews and the code pages' history reads. The member-tier rule, who may
-- publish what (default branch, a contributor's branch, a change request, a commit), the entry page
-- and folder checks, the same files being the same preview, resolving request paths (files, folder
-- indexes, single-page fallback, binaries, escapes), revoking, private workspaces, the 30-preview cap,
-- the owner-approval gate, row level security and web_ws_log.
--
-- Runs entirely inside one transaction and ends by raising PHASE10_PV_RESULT, which rolls everything
-- back. Every "ok_*" key in the JSON should be true. Run it with the Supabase SQL editor or MCP
-- `execute_sql`, after phase10_previews.sql is applied.
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  r jsonb; j jsonb;
  a uuid; b uuid; c uuid; x uuid;
  ws uuid;
  h0 text; h1 text; hb text;
  s_html text; s_css text; s_docs text; s_dist text; s_js text; s_png text;
  pv1 text; pv2 text; pv_root text; pv_spa text; pv_cr text;
  n int;
  ok boolean;
begin
  create function pg_temp.fails(p_sql text, p_code text) returns boolean
  language plpgsql as $fn$
  begin
    execute p_sql;
    return false;
  exception when others then
    return sqlstate = p_code;
  end
  $fn$;

  create function pg_temp.err(p_sql text) returns text
  language plpgsql as $fn$
  begin
    execute p_sql;
    return null;
  exception when others then
    return sqlerrm;
  end
  $fn$;

  create function pg_temp.blob(p_ws uuid, p_agent uuid, p_text text) returns text
  language plpgsql as $fn$
  declare
    v_sha text := encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.ws_add_blob(p_ws, p_agent, v_sha, encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha1'), 'hex'),
                               octet_length(convert_to(p_text, 'UTF8')), false, p_text, null);
    return v_sha;
  end
  $fn$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@phase10pv.invalid', '{"username":"phase10pv_u1"}', now(), now()),
         (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@phase10pv.invalid', '{"username":"phase10pv_u2"}', now(), now()),
         (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u3@phase10pv.invalid', '{"username":"phase10pv_u3"}', now(), now());

  a := (public.register_agent('pv-alice', 'Alice', '', '{code}', '{}', '{}', null, u1, 'api') -> 'agent' ->> 'id')::uuid;
  b := (public.register_agent('pv-bob', 'Bob', '', '{code}', '{}', '{}', null, u2, 'api') -> 'agent' ->> 'id')::uuid;
  c := (public.register_agent('pv-carol', 'Carol', '', '{code}', '{}', '{}', null, u3, 'api') -> 'agent' ->> 'id')::uuid;
  x := (public.register_agent('pv-xena', 'Xena', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;

  -- ------------------------------------------------------------ grants and the gate
  perform public.set_autonomy(c, u3, 'supervised');
  out := out || jsonb_build_object(
    'ok_grants', has_function_privilege('anon', 'public.web_ws_log(text, text, text, int, int)', 'execute')
                 and has_function_privilege('authenticated', 'public.web_ws_log(text, text, text, int, int)', 'execute')
                 and not has_function_privilege('anon', 'public.preview_publish(uuid, uuid, text, int, text, boolean, text, jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.preview_publish(uuid, uuid, text, int, text, boolean, text, jsonb)', 'execute')
                 and not has_function_privilege('anon', 'public.preview_resolve(text, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.preview_revoke(text, uuid, text)', 'execute'),
    'ok_gate', public.autonomy_gate(a, 'publish_preview') = 'allow'
               and public.autonomy_gate(c, 'publish_preview') = 'ask'
               and pg_temp.fails(format('select public.autonomy_gate(%L, %L)', a, 'publish_everything'), 'PT400'),
    'ok_gate_request', (public.request_owner(c, 'publish_preview', '{"workspace": "x"}', 'Publish a preview of x') ->> 'status') = 'pending');

  -- ------------------------------------------------------------ a workspace with a small site
  r := public.create_workspace(a, 'Preview Lab', 'preview-lab', 'A site to preview.');
  ws := (r ->> 'id')::uuid;
  h0 := r ->> 'head';
  s_html := pg_temp.blob(ws, a, '<!doctype html><html><body><h1>Hello</h1><script src="app.js"></script></body></html>');
  s_css := pg_temp.blob(ws, a, 'body { margin: 0 }');
  s_docs := pg_temp.blob(ws, a, '<!doctype html><title>Docs</title><p>Docs</p>');
  s_dist := pg_temp.blob(ws, a, '<!doctype html><title>Built</title><div id="root"></div>');
  s_js := pg_temp.blob(ws, a, 'document.getElementById("root").textContent = "built";');
  s_png := encode(extensions.digest('png-bytes', 'sha256'), 'hex');
  perform public.ws_add_blob(ws, a, s_png, encode(extensions.digest('png-bytes', 'sha1'), 'hex'), 9, true, null, 'ab/' || s_png);
  h1 := public.ws_commit(ws, a, 'main', h0, 'A small site', jsonb_build_array(
          jsonb_build_object('path', 'index.html', 'blob', s_html),
          jsonb_build_object('path', 'app.js', 'blob', s_js),
          jsonb_build_object('path', 'style.css', 'blob', s_css),
          jsonb_build_object('path', 'docs/index.html', 'blob', s_docs),
          jsonb_build_object('path', 'img/logo.png', 'blob', s_png),
          jsonb_build_object('path', 'dist/index.html', 'blob', s_dist),
          jsonb_build_object('path', 'dist/app.js', 'blob', s_js))) ->> 'commit';

  -- ------------------------------------------------------------ the tier rule
  -- Alice is claimed but registered a moment ago: still the new tier.
  out := out || jsonb_build_object(
    'ok_new_tier_refused', public.agent_tier(a) = 'new'
        and pg_temp.fails(format('select public.preview_publish(%L, %L)', ws, a), 'PT403'),
    'ok_unclaimed_refused', pg_temp.fails(format('select public.preview_publish(%L, %L)', ws, x), 'PT403'));
  update public.agents set created_at = now() - interval '3 days' where id in (a, b, c);
  out := out || jsonb_build_object('ok_aged_member', public.agent_tier(a) = 'member');

  -- ------------------------------------------------------------ publishing
  r := public.preview_publish(ws, a);
  pv1 := r ->> 'id';
  out := out || jsonb_build_object(
    'ok_publish', pv1 ~ '^[0-9a-f]{20}$' and r ->> 'workspace' = 'preview-lab' and r ->> 'commit' = h1
                  and r ->> 'label' = 'main' and r ->> 'root_dir' = '' and (r ->> 'files')::int = 7
                  and r ->> 'status' = 'active' and r ->> 'published_by' = 'pv-alice' and (r ->> 'existed')::boolean = false
                  and r ->> 'entry' = 'index.html',
    'ok_publish_activity', exists (select 1 from public.activity where kind = 'preview_published' and agent_id = a
                                    and data ->> 'preview' = pv1));
  r := public.preview_publish(ws, a);
  out := out || jsonb_build_object(
    'ok_same_preview', r ->> 'id' = pv1 and (r ->> 'existed')::boolean,
    'ok_one_row', (select count(*) from public.previews where workspace_id = ws) = 1);

  -- A folder: only its files count, and it needs its own index.html.
  r := public.preview_publish(ws, a, null, null, 'dist', true, 'The build');
  pv_root := r ->> 'id';
  out := out || jsonb_build_object(
    'ok_root_dir', r ->> 'root_dir' = 'dist' and (r ->> 'files')::int = 2 and (r ->> 'spa_fallback')::boolean
                   and r ->> 'label' = 'The build' and pv_root <> pv1,
    'ok_no_index', pg_temp.fails(format('select public.preview_publish(%L, %L, null, null, %L)', ws, a, 'img'), 'PT422'),
    'ok_no_index_hint', coalesce(pg_temp.err(format('select public.preview_publish(%L, %L, null, null, %L)', ws, a, 'img')), '')
                        like '%Folders with an index.html:%dist%',
    'ok_bad_root', pg_temp.fails(format('select public.preview_publish(%L, %L, null, null, %L)', ws, a, '../x'), 'PT400'));
  r := public.preview_publish(ws, a, null, null, '', true);
  pv_spa := r ->> 'id';
  out := out || jsonb_build_object('ok_spa_is_new_preview', pv_spa <> pv1 and (r ->> 'spa_fallback')::boolean);

  -- ------------------------------------------------------------ who may publish what
  -- Bob reads the workspace, and is a member by tier, but may not publish main.
  out := out || jsonb_build_object(
    'ok_reader_refused', pg_temp.fails(format('select public.preview_publish(%L, %L)', ws, b), 'PT403')
                         and pg_temp.fails(format('select public.preview_publish(%L, %L, %L)', ws, b, h1), 'PT403'));
  -- ...but his own branch in an open workspace, and the change request from it.
  hb := public.ws_commit(ws, b, 'pv-bob/feature', h1, 'A feature', jsonb_build_array(
          jsonb_build_object('path', 'index.html', 'blob', pg_temp.blob(ws, b, '<!doctype html><h1>Feature</h1>')))) ->> 'commit';
  r := public.preview_publish(ws, b, 'pv-bob/feature', null, '', true);
  out := out || jsonb_build_object(
    'ok_own_branch', r ->> 'commit' = hb and r ->> 'label' = 'pv-bob/feature' and r ->> 'published_by' = 'pv-bob');
  j := public.open_change_request(ws, b, 'pv-bob/feature', null, 'A feature', 'Adds the feature.', null, false);
  r := public.preview_publish(ws, a, null, (j ->> 'number')::int);
  pv_cr := r ->> 'id';
  out := out || jsonb_build_object(
    'ok_cr_preview', r ->> 'commit' = hb and r ->> 'label' = 'change request #1' and (r ->> 'change_request')::int = 1
                     and (select change_request_id from public.previews where id = pv_cr) = (j ->> 'id')::uuid,
    'ok_cr_author', public.preview_publish(ws, b, null, 1) ->> 'id' = pv_cr,
    'ok_cr_missing', pg_temp.fails(format('select public.preview_publish(%L, %L, null, 99)', ws, a), 'PT404'),
    'ok_branch_missing', pg_temp.fails(format('select public.preview_publish(%L, %L, %L)', ws, a, 'no-such-branch'), 'PT404'));

  -- ------------------------------------------------------------ resolving requests
  r := public.preview_resolve(pv1, '');
  out := out || jsonb_build_object(
    'ok_resolve_root', r ->> 'path' = 'index.html' and (r ->> 'dir')::boolean and r ->> 'sha256' = s_html
                       and r ->> 'content' like '%<h1>Hello</h1>%' and not (r ->> 'binary')::boolean
                       and r ->> 'workspace' = 'preview-lab' and r ->> 'commit' = h1);
  r := public.preview_resolve(pv1, 'style.css');
  out := out || jsonb_build_object('ok_resolve_file', r ->> 'path' = 'style.css' and not (r ->> 'dir')::boolean and r ->> 'content' = 'body { margin: 0 }');
  r := public.preview_resolve(pv1, 'docs');
  out := out || jsonb_build_object('ok_resolve_dir', r ->> 'path' = 'docs/index.html' and (r ->> 'dir')::boolean
                                                     and public.preview_resolve(pv1, 'docs/') ->> 'path' = 'docs/index.html');
  r := public.preview_resolve(pv1, 'img/logo.png');
  out := out || jsonb_build_object('ok_resolve_binary', (r ->> 'binary')::boolean and r ->> 'content' is null
                                                        and r ->> 'storage_path' = 'ab/' || s_png);
  out := out || jsonb_build_object(
    'ok_resolve_missing', pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv1, 'nope.html'), 'PT404'),
    'ok_resolve_no_spa', pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv1, 'dashboard/settings'), 'PT404'),
    'ok_resolve_escape', pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv1, '../secrets'), 'PT404')
                         and pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv1, 'a/../../b'), 'PT404')
                         and pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv1, '.git/config'), 'PT404'),
    'ok_resolve_unknown_id', pg_temp.fails(format('select public.preview_resolve(%L, %L)', repeat('0', 20), ''), 'PT404'));
  r := public.preview_resolve(pv_spa, 'dashboard/settings');
  out := out || jsonb_build_object(
    'ok_spa_fallback', r ->> 'path' = 'index.html' and (r ->> 'fallback')::boolean and not (r ->> 'dir')::boolean,
    'ok_spa_asset_404', pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv_spa, 'missing.js'), 'PT404'));
  -- A folder preview serves that folder as its root and nothing outside it.
  out := out || jsonb_build_object(
    'ok_root_serves_folder', public.preview_resolve(pv_root, 'app.js') ->> 'sha256' = s_js
                             and public.preview_resolve(pv_root, '') ->> 'sha256' = s_dist
                             and public.preview_resolve(pv_root, 'deep/route') ->> 'path' = 'index.html',
    'ok_root_hides_outside', pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv_root, 'style.css'), 'PT404')
                             and pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv_root, 'docs/index.html'), 'PT404'));

  -- ------------------------------------------------------------ listing and reading
  j := public.preview_list(ws, null);
  out := out || jsonb_build_object(
    'ok_list', jsonb_array_length(j) = 5,
    'ok_list_limit', jsonb_array_length(public.preview_list(ws, null, 'active', 2)) = 2,
    'ok_get', public.preview_get(pv1, null) ->> 'id' = pv1 and public.preview_get(upper(pv1), b) ->> 'id' = pv1
              and pg_temp.fails(format('select public.preview_get(%L, null)', repeat('1', 20)), 'PT404'));

  -- ------------------------------------------------------------ revoking
  out := out || jsonb_build_object(
    'ok_revoke_refused', pg_temp.fails(format('select public.preview_revoke(%L, %L)', pv1, b), 'PT403'));
  r := public.preview_revoke(pv1, a, 'Out of date');
  out := out || jsonb_build_object(
    'ok_revoked', r ->> 'status' = 'revoked' and r ->> 'revoked_reason' = 'Out of date' and r ->> 'revoked_at' is not null
                  and (select revoked_by from public.previews where id = pv1) = a,
    'ok_revoked_404', pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv1, ''), 'PT404'),
    'ok_revoke_again', public.preview_revoke(pv1, a) ->> 'status' = 'revoked',
    'ok_list_hides_revoked', not exists (select 1 from jsonb_array_elements(public.preview_list(ws, null)) e where e ->> 'id' = pv1)
                             and exists (select 1 from jsonb_array_elements(public.preview_list(ws, null, 'all')) e where e ->> 'id' = pv1),
    -- Publishing the same files again after a revoke is a new preview.
    'ok_republish', public.preview_publish(ws, a) ->> 'id' <> pv1);
  -- A maintainer may revoke someone else's: add bob as a maintainer and let him revoke alice's folder preview.
  perform public.ws_set_member(ws, a, 'pv-bob', 'maintainer');
  out := out || jsonb_build_object(
    'ok_maintainer_revokes', public.preview_revoke(pv_root, b) ->> 'status' = 'revoked');

  -- ------------------------------------------------------------ the cap
  insert into public.previews (id, workspace_id, commit_id, label, status, created_at)
  select substr(encode(extensions.digest('cap' || i::text, 'sha256'), 'hex'), 1, 20), ws, h1, 'cap ' || i, 'active', now() - interval '1 day' - (i || ' minutes')::interval
    from generate_series(1, 30) i;
  n := (select count(*) from public.previews where workspace_id = ws and status = 'active');
  r := public.preview_publish(ws, a, null, null, 'dist');
  out := out || jsonb_build_object(
    'ok_cap_before', n > 30,
    'ok_cap_after', (select count(*) from public.previews where workspace_id = ws and status = 'active') = 30,
    'ok_cap_oldest_revoked', (select status from public.previews where label = 'cap 30' and workspace_id = ws) = 'revoked'
                             and (select revoked_reason from public.previews where label = 'cap 30' and workspace_id = ws) like 'Superseded%'
                             and (select status from public.previews where id = r ->> 'id') = 'active');

  -- ------------------------------------------------------------ history for the code pages
  set local role anon;
  j := public.web_ws_log('preview-lab');
  begin
    perform public.web_ws_log('no-such-workspace');
    ok := false;
  exception when others then
    ok := sqlstate = 'PT404';
  end;
  out := out || jsonb_build_object(
    'ok_log_public', j ->> 'head' = h1 and jsonb_array_length(j -> 'commits') = 2 and j -> 'commits' -> 0 ->> 'message' = 'A small site'
                     and j -> 'commits' -> 0 ->> 'author' = 'pv-alice',
    'ok_log_branch', public.web_ws_log('preview-lab', 'pv-bob/feature') ->> 'head' = hb
                     and jsonb_array_length(public.web_ws_log('preview-lab', 'pv-bob/feature') -> 'commits') = 3,
    'ok_log_path', jsonb_array_length(public.web_ws_log('preview-lab', 'main', 'style.css') -> 'commits') = 1,
    'ok_log_missing', ok,
    'ok_rls_previews_anon', (select count(*) from public.previews where workspace_id = ws) > 0);
  reset role;

  -- ------------------------------------------------------------ private workspaces
  perform public.update_workspace(ws, a, '{"visibility": "private"}'::jsonb);
  out := out || jsonb_build_object(
    'ok_private_not_served', pg_temp.fails(format('select public.preview_resolve(%L, %L)', pv_spa, ''), 'PT404'),
    'ok_private_no_publish', pg_temp.fails(format('select public.preview_publish(%L, %L)', ws, a), 'PT403'));
  set local role anon;
  begin
    perform public.web_ws_log('preview-lab');
    ok := false;
  exception when others then
    ok := sqlstate = 'PT404';
  end;
  out := out || jsonb_build_object('ok_private_rls_anon', (select count(*) from public.previews where workspace_id = ws) = 0 and ok);
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  out := out || jsonb_build_object(
    'ok_private_rls_owner', (select count(*) from public.previews where workspace_id = ws) > 0
                            and jsonb_array_length(public.web_ws_log('preview-lab') -> 'commits') = 2);
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  begin
    perform public.web_ws_log('preview-lab');
    ok := false;
  exception when others then
    ok := sqlstate = 'PT404';
  end;
  out := out || jsonb_build_object('ok_private_rls_other', (select count(*) from public.previews where workspace_id = ws) = 0 and ok);
  reset role;

  raise exception 'PHASE10_PV_RESULT %', out::text;
exception when others then
  if sqlerrm like 'PHASE10_PV_RESULT%' then
    raise;
  end if;
  raise exception 'PHASE10_PV_FAILED (%): % | so far: %', sqlstate, sqlerrm, out::text;
end $test$;
