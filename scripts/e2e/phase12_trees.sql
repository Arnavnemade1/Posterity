-- Phase 12.1 and 12.2 database test: folders (content-addressed tree nodes, sharing, modes), commit
-- changes, paged history, merge bases, three-way merges over changed paths (line merges through the
-- worker's cache, renames exact and similar, modify/delete, file/folder clashes, modes), squash and
-- rebase merges, rebasing a branch, cherry-picking, the worker's job queue, the web reads, GitHub's
-- push plan and imports, and grants.
--
-- Runs entirely inside one transaction and ends by raising PHASE12_TREES_RESULT, which rolls
-- everything back. Every "ok_*" key in the JSON should be true. Run it with the Supabase SQL editor or
-- MCP `execute_sql`, after 20261017045227_phase12_trees.sql through 20261017143707_phase12_import_speed.sql
-- are applied.
do $test$
declare
  u1 uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  r jsonb; j jsonb; e jsonb;
  a uuid; b uuid;
  ws uuid; mws uuid;
  s1 text; s2 text; s3 text; s4 text; s5 text; sx text;
  r1 text; r2 text; r3 text; r4 text;
  h0 text; h1 text; h2 text; hm text; hf text; hs text;
  c1 text; c2 text;
  n int;
  v_err text;
  v_detail text;
  cr uuid;
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

  create function pg_temp.sha(p_text text) returns text
  language sql as $fn$ select encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex') $fn$;

  create function pg_temp.git(p_text text) returns text
  language sql as $fn$
    select encode(extensions.digest(convert_to('blob ' || octet_length(convert_to(p_text, 'UTF8')), 'UTF8') || '\x00'::bytea
                                    || convert_to(p_text, 'UTF8'), 'sha1'), 'hex')
  $fn$;

  -- Upload a text file to a workspace as an agent; returns its sha256.
  create function pg_temp.blob(p_ws uuid, p_agent uuid, p_text text) returns text
  language plpgsql as $fn$
  begin
    perform public.ws_add_blob(p_ws, p_agent, pg_temp.sha(p_text), pg_temp.git(p_text),
                               octet_length(convert_to(p_text, 'UTF8')), false, p_text, null);
    return pg_temp.sha(p_text);
  end
  $fn$;

  -- A bare blob (no workspace), for tree-level checks.
  create function pg_temp.raw(p_text text) returns text
  language plpgsql as $fn$
  begin
    insert into public.blobs (sha256, git_sha1, size, is_binary, content)
    values (pg_temp.sha(p_text), pg_temp.git(p_text), octet_length(convert_to(p_text, 'UTF8')), false, p_text)
    on conflict do nothing;
    return pg_temp.sha(p_text);
  end
  $fn$;

  create function pg_temp.edit(p_root text, p_changes jsonb) returns text
  language sql as $fn$ select public.ws_tree_edit(p_root, p_changes, true, '') ->> 'node' $fn$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@phase12.invalid', '{"username":"phase12_u1"}', now(), now());
  a := (public.register_agent('p12-ada', 'Ada', '', '{code}', '{}', '{}', null, u1, 'api') -> 'agent' ->> 'id')::uuid;
  b := (public.register_agent('p12-bo', 'Bo', '', '{code}', '{}', '{}', null, null, 'api') -> 'agent' ->> 'id')::uuid;

  -- ------------------------------------------------------------ folders
  -- A stable function reads the snapshot its statement started with, so trees are built in one
  -- statement and read in the next.
  s1 := pg_temp.raw('one'); s2 := pg_temp.raw('two'); s3 := pg_temp.raw('three');
  r1 := pg_temp.edit(null, jsonb_build_array(jsonb_build_object('p', 'a/b.txt', 's', s1), jsonb_build_object('p', 'a/c.txt', 's', s2),
                                              jsonb_build_object('p', 'd.txt', 's', s3)));
  r2 := pg_temp.edit(null, jsonb_build_array(jsonb_build_object('p', 'd.txt', 's', s3), jsonb_build_object('p', 'a/c.txt', 's', s2),
                                              jsonb_build_object('p', 'a/b.txt', 's', s1)));
  r3 := pg_temp.edit(r1, jsonb_build_array(jsonb_build_object('p', 'd.txt', 's', s1)));
  r4 := pg_temp.edit(r1, jsonb_build_array(jsonb_build_object('p', 'a/b.txt', 's', null), jsonb_build_object('p', 'a/c.txt', 's', null)));
  hs := pg_temp.edit(r1, jsonb_build_array(jsonb_build_object('p', 'd.txt', 's', null), jsonb_build_object('p', 'd.txt/inner', 's', s1)));
  out := out || jsonb_build_object(
    'ok_empty_root', public.ws_node_hash('{}') = public.ws_empty_root() and exists (select 1 from public.tree_nodes where sha256 = public.ws_empty_root())
                     and pg_temp.edit(null, '[]') = public.ws_empty_root(),
    'ok_hash_stable', r1 = r2,
    'ok_entry', public.ws_tree_entry(r1, 'a') ->> 't' = 'd' and (public.ws_tree_entry(r1, 'a') ->> 'n')::int = 2
                and public.ws_tree_entry(r1, 'a/b.txt') ->> 's' = s1 and public.ws_tree_entry(r1, 'a/x') is null
                and public.ws_tree_entry(r1, 'd.txt/x') is null and public.ws_tree_entry(r1, '') ->> 's' = r1,
    'ok_counts', (select file_count from public.tree_nodes where sha256 = r1) = 3
                 and (select total_bytes from public.tree_nodes where sha256 = r1) = 3 + 3 + 5,
    'ok_sharing', public.ws_tree_entry(r3, 'a') ->> 's' = public.ws_tree_entry(r1, 'a') ->> 's' and r3 <> r1,
    'ok_flatten', public.ws_flatten(r1) = jsonb_build_object('a/b.txt', s1, 'a/c.txt', s2, 'd.txt', s3),
    'ok_walk', (select count(*) from public.ws_walk(public.ws_tree_entry(r1, 'a') ->> 's', 'a')) = 2,
    'ok_delete_empties', r4 is not null and public.ws_tree_entry(r4, 'a') is null and public.ws_tree_entry(r4, 'd.txt') ->> 's' = s3,
    'ok_strict_missing', pg_temp.fails(format('select pg_temp.edit(%L, %L)', r1, '[{"p": "nope.txt", "s": null}]'), 'PT400'),
    'ok_strict_clash', pg_temp.fails(format('select pg_temp.edit(%L, %L)', r1, jsonb_build_array(jsonb_build_object('p', 'd.txt/e', 's', s1))), 'PT400')
                       and pg_temp.fails(format('select pg_temp.edit(%L, %L)', r1, jsonb_build_array(jsonb_build_object('p', 'a', 's', s1))), 'PT400'),
    'ok_file_to_folder', public.ws_tree_entry(hs, 'd.txt/inner') ->> 's' = s1 and public.ws_tree_entry(hs, 'd.txt') ->> 't' = 'd',
    'ok_loose_clash', public.ws_tree_edit(r1, jsonb_build_array(jsonb_build_object('p', 'd.txt/e', 's', s1),
                                                                 jsonb_build_object('p', 'f.txt', 's', s1)), false, '') -> 'conflicts' = '["d.txt/e"]'::jsonb,
    'ok_unknown_blob', pg_temp.fails(format('select pg_temp.edit(null, %L)', jsonb_build_array(jsonb_build_object('p', 'z', 's', repeat('9', 64)))), 'PT400'));

  r4 := pg_temp.edit(r1, jsonb_build_array(jsonb_build_object('p', 'd.txt', 's', s3, 'm', 'x')));
  hs := pg_temp.edit(r4, jsonb_build_array(jsonb_build_object('p', 'd.txt', 's', s1)));
  out := out || jsonb_build_object(
    'ok_mode_set', public.ws_tree_entry(r4, 'd.txt') ->> 't' = 'x' and r4 <> r1,
    'ok_mode_kept', public.ws_tree_entry(hs, 'd.txt') ->> 't' = 'x' and public.ws_tree_entry(hs, 'd.txt') ->> 's' = s1,
    'ok_mode_diff', (select new_mode from public.ws_diff_roots(r1, r4) where path = 'd.txt') = 'x'
                    and (select count(*) from public.ws_diff_roots(r1, r4)) = 1,
    'ok_diff_roots', (select jsonb_object_agg(path, coalesce(new_blob, 'gone')) from public.ws_diff_roots(r1, r3)) = jsonb_build_object('d.txt', s1)
                     and (select count(*) from public.ws_diff_roots(null, r1)) = 3
                     and (select count(*) from public.ws_diff_roots(r1, r1)) = 0);

  -- Exact renames in diffs.
  r2 := pg_temp.edit(r1, jsonb_build_array(jsonb_build_object('p', 'a/b.txt', 's', null), jsonb_build_object('p', 'moved/b.txt', 's', s1)));
  j := public.ws_diff_json(r1, r2, true);
  out := out || jsonb_build_object(
    'ok_diff_rename', (j ->> 'total')::int = 1 and j -> 'files' -> 0 ->> 'status' = 'renamed'
                      and j -> 'files' -> 0 ->> 'old_path' = 'a/b.txt' and j -> 'files' -> 0 ->> 'path' = 'moved/b.txt',
    'ok_diff_no_rename', (public.ws_diff_json(r1, r2, false) ->> 'total')::int = 2,
    'ok_diff_limit', (public.ws_diff_json(null, r1, false, 2) ->> 'truncated')::boolean
                     and jsonb_array_length(public.ws_diff_json(null, r1, false, 2) -> 'files') = 2);

  -- ------------------------------------------------------------ commits and reading
  ws := (public.create_workspace(a, 'Phase Twelve Yard') ->> 'id')::uuid;
  h0 := public.ws_resolve_ref(ws, null);
  s1 := pg_temp.blob(ws, a, E'line 1\nline 2\nline 3\n');
  s2 := pg_temp.blob(ws, a, E'#!/bin/sh\necho hi\n');
  s3 := pg_temp.blob(ws, a, E'# Yard\n');
  r := public.ws_commit(ws, a, 'main', h0, 'Start', jsonb_build_array(
         jsonb_build_object('path', 'src/lib/one.txt', 'blob', s1),
         jsonb_build_object('path', 'bin/run.sh', 'blob', s2, 'executable', true),
         jsonb_build_object('path', 'README.md', 'blob', s3)));
  h1 := r ->> 'commit';
  out := out || jsonb_build_object(
    'ok_commit_root', (select root from public.commits where id = h1) = r ->> 'root'
                      and (select tree from public.commits where id = h1) is not null
                      and (select manifest from public.trees t join public.commits c on c.tree = t.sha256 where c.id = h1) ? 'bin/run.sh',
    'ok_commit_changes', (select count(*) from public.commit_changes where commit_id = h1) = 3
                         and (select new_mode from public.commit_changes where commit_id = h1 and path = 'bin/run.sh') = 'x'
                         and (r -> 'stats' ->> 'added')::int = 3 and (r -> 'stats' ->> 'files')::int = 3,
    'ok_ws_counts', (select file_count from public.workspaces where id = ws) = 3,
    'ok_limits_raised', (select file_limit from public.workspaces where id = ws) = 100000
                        and (select byte_limit from public.workspaces where id = ws) = 2147483648,
    'ok_exec_flag_type', pg_temp.fails(format('select public.ws_commit(%L, %L, %L, null, %L, %L)', ws, a, 'main', 'Bad',
                                       jsonb_build_array(jsonb_build_object('path', 'x', 'blob', s1, 'executable', 'yes'))), 'PT400'),
    'ok_file_exec', (public.ws_file(ws, b, null, 'bin/run.sh') ->> 'executable')::boolean
                    and not (public.ws_file(ws, b, null, 'README.md') ->> 'executable')::boolean,
    'ok_file_folder_read', pg_temp.fails(format('select public.ws_file(%L, %L, null, %L)', ws, b, 'src'), 'PT400'),
    'ok_tree_listing', public.ws_tree(ws, b, null, null) -> 'entries' -> 0 ->> 'name' = 'bin'
                       and (public.ws_tree(ws, b, null, null) -> 'entries' -> 0 ->> 'files')::int = 1
                       and public.ws_tree(ws, b, null, 'bin') -> 'entries' -> 0 ->> 'executable' = 'true',
    'ok_tree_paged', jsonb_array_length(public.ws_tree(ws, b, null, null, true, null, 2) -> 'entries') = 2
                     and public.ws_tree(ws, b, null, null, true, null, 2) ->> 'next' = 'bin/run.sh'
                     and public.ws_tree(ws, b, null, null, true, 'bin/run.sh', 2) -> 'entries' -> 0 ->> 'path' = 'src/lib/one.txt'
                     and public.ws_tree(ws, b, null, null, true, 'README.md', 2) ->> 'next' is null);

  -- Keep pushing: a history to page through.
  s4 := pg_temp.blob(ws, a, E'line 1\nline 2 changed\nline 3\n');
  h2 := public.ws_commit(ws, a, 'main', null, 'Change line 2', jsonb_build_array(jsonb_build_object('path', 'src/lib/one.txt', 'blob', s4))) ->> 'commit';
  for n in 1 .. 5 loop
    perform public.ws_commit(ws, a, 'main', null, 'Note ' || n, jsonb_build_array(jsonb_build_object('path', 'notes.txt', 'blob', pg_temp.blob(ws, a, 'note ' || n))));
  end loop;
  j := public.ws_log(ws, b, 'main', null, 3);
  out := out || jsonb_build_object(
    'ok_log_page', jsonb_array_length(j -> 'commits') = 3 and j ->> 'next' = j -> 'commits' -> 2 ->> 'id',
    'ok_log_next', public.ws_log(ws, b, 'main', null, 3, 0, j ->> 'next') -> 'commits' -> 0 ->> 'message' = 'Note 2'
                   and jsonb_array_length(public.ws_log(ws, b, 'main', null, 30, 0, j ->> 'next') -> 'commits') = 5,
    'ok_log_offset', public.ws_log(ws, b, 'main', null, 1, 3) -> 'commits' -> 0 ->> 'message' = 'Note 2',
    'ok_log_path', (select jsonb_agg(c ->> 'message') from jsonb_array_elements(public.ws_log(ws, b, 'main', 'src/lib/one.txt') -> 'commits') c)
                   = '["Change line 2", "Start"]'::jsonb
                   and jsonb_array_length(public.ws_log(ws, b, 'main', 'src') -> 'commits') = 2
                   and jsonb_array_length(public.ws_log(ws, b, 'main', 'src/lib/one') -> 'commits') = 0,
    'ok_log_bad_cursor', pg_temp.fails(format('select public.ws_log(%L, %L, %L, null, 3, 0, %L)', ws, b, 'main', repeat('f', 40)), 'PT404'),
    'ok_web_log', jsonb_array_length(public.web_ws_log('phase-twelve-yard', 'main', null, 2) -> 'commits') = 2,
    'ok_ancestor', public.ws_is_ancestor(h1, public.ws_resolve_ref(ws, 'main')) and not public.ws_is_ancestor(public.ws_resolve_ref(ws, 'main'), h1)
                   and public.ws_is_ancestor(h1, h1),
    'ok_diff_api', (public.ws_diff(ws, b, h1, h2) -> 'files' -> 0 ->> 'status') = 'modified'
                   and (public.ws_diff(ws, b, h1, h2) ->> 'total')::int = 1);

  -- ------------------------------------------------------------ merges
  update public.workspaces set open_contribution = true where id = ws;
  perform public.ws_set_member(ws, a, '@p12-bo', 'writer');
  hm := public.ws_resolve_ref(ws, 'main');
  perform public.ws_create_branch(ws, b, 'p12-bo/feature', 'main');
  -- Different files: clean.
  perform public.ws_commit(ws, b, 'p12-bo/feature', null, 'Bo edits the readme', jsonb_build_array(
            jsonb_build_object('path', 'README.md', 'blob', pg_temp.blob(ws, b, E'# Yard\nBy Bo.\n'))));
  perform public.ws_commit(ws, a, 'main', null, 'Ada adds a file', jsonb_build_array(
            jsonb_build_object('path', 'src/two.txt', 'blob', pg_temp.blob(ws, a, 'two'))));
  r := public.ws_merge_branches(ws, b, 'p12-bo/feature', 'main');
  out := out || jsonb_build_object(
    'ok_clean_merge', r ->> 'status' = 'merged' and not (r ->> 'fast_forward')::boolean
                      and public.ws_file(ws, b, 'p12-bo/feature', 'src/two.txt') ->> 'content' = 'two'
                      and public.ws_file(ws, b, 'p12-bo/feature', 'README.md') ->> 'content' = E'# Yard\nBy Bo.\n'
                      and cardinality((select parents from public.commits where id = r ->> 'commit')) = 2);

  -- Same file, different lines: pending until the worker merges it.
  s5 := pg_temp.blob(ws, b, E'line 1 by Bo\nline 2 changed\nline 3\n');
  perform public.ws_commit(ws, b, 'p12-bo/feature', null, 'Bo edits line 1', jsonb_build_array(jsonb_build_object('path', 'src/lib/one.txt', 'blob', s5)));
  sx := pg_temp.blob(ws, a, E'line 1\nline 2 changed\nline 3 by Ada\n');
  perform public.ws_commit(ws, a, 'main', null, 'Ada edits line 3', jsonb_build_array(jsonb_build_object('path', 'src/lib/one.txt', 'blob', sx)));
  v_err := pg_temp.err(format('select public.ws_merge_branches(%L, %L, %L, %L)', ws, b, 'p12-bo/feature', 'main'));
  r := public.ws_merge_branches(ws, b, 'p12-bo/feature', 'main', null, null, true);
  out := out || jsonb_build_object(
    'ok_pending_raises', v_err like 'merge_pending:%',
    'ok_pending_status', r ->> 'status' = 'pending' and (r ->> 'pending')::int = 1,
    'ok_job_queued', exists (select 1 from public.merge_jobs where kind = 'content' and workspace_id = ws
                              and payload ->> 'ours' = s5 and payload ->> 'theirs' = sx and payload ->> 'base' = s4));
  j := public.code_claim(10);
  out := out || jsonb_build_object(
    'ok_claim', jsonb_array_length(j) >= 1 and (select locked_until from public.merge_jobs where kind = 'content' and payload ->> 'ours' = s5) > now(),
    'ok_claim_skips_locked', not exists (select 1 from jsonb_array_elements(public.code_claim(10)) x where x -> 'payload' ->> 'ours' = s5));
  perform public.code_store_merge(s4, s5, sx, false, E'line 1 by Bo\nline 2 changed\nline 3 by Ada\n',
                                  pg_temp.git(E'line 1 by Bo\nline 2 changed\nline 3 by Ada\n'));
  out := out || jsonb_build_object(
    'ok_store_bad_sha1', pg_temp.fails(format('select public.code_store_merge(%L, %L, %L, false, %L, %L)', s1, s2, s3, 'x', repeat('0', 40)), 'PT400'),
    'ok_job_done', not exists (select 1 from public.merge_jobs where kind = 'content' and payload ->> 'ours' = s5));
  r := public.ws_merge_branches(ws, b, 'p12-bo/feature', 'main');
  out := out || jsonb_build_object(
    'ok_line_merge', r ->> 'status' = 'merged'
                     and public.ws_file(ws, b, 'p12-bo/feature', 'src/lib/one.txt') ->> 'content' = E'line 1 by Bo\nline 2 changed\nline 3 by Ada\n'
                     and exists (select 1 from public.workspace_blobs where workspace_id = ws
                                  and sha256 = pg_temp.sha(E'line 1 by Bo\nline 2 changed\nline 3 by Ada\n')));

  -- Same lines: a conflict with markers; resolutions settle it.
  perform public.ws_commit(ws, b, 'p12-bo/feature', null, 'Bo rewrites line 2', jsonb_build_array(jsonb_build_object('path', 'src/lib/one.txt',
            'blob', pg_temp.blob(ws, b, E'line 1 by Bo\nline 2 by Bo\nline 3 by Ada\n'))));
  perform public.ws_commit(ws, a, 'main', null, 'Ada rewrites line 2', jsonb_build_array(jsonb_build_object('path', 'src/lib/one.txt',
            'blob', pg_temp.blob(ws, a, E'line 1\nline 2 by Ada\nline 3 by Ada\n'))));
  perform public.ws_merge_branches(ws, b, 'p12-bo/feature', 'main', null, null, true);
  j := (select payload from public.merge_jobs where kind = 'content' and workspace_id = ws limit 1);
  perform public.code_store_merge(j ->> 'base', j ->> 'ours', j ->> 'theirs', true, E'<<<<<<< ours\nline 2 by Bo\n=======\nline 2 by Ada\n>>>>>>> theirs\n',
                                  pg_temp.git(E'<<<<<<< ours\nline 2 by Bo\n=======\nline 2 by Ada\n>>>>>>> theirs\n'), 1);
  begin
    perform public.ws_merge_branches(ws, b, 'p12-bo/feature', 'main');
    v_err := null;
  exception when others then
    get stacked diagnostics v_err = message_text, v_detail = pg_exception_detail;
  end;
  j := public.ws_merge_conflicts(ws, b, 'p12-bo/feature', 'main');
  out := out || jsonb_build_object(
    'ok_conflict_raised', v_err like 'conflict: 1 file(s)%src/lib/one.txt%' and (v_detail::jsonb -> 'conflicts' -> 0 ->> 'kind') = 'content',
    'ok_conflict_listing', j -> 'conflicts' -> 0 ->> 'kind' = 'content' and j -> 'conflicts' -> 0 ->> 'marked' is not null
                           and exists (select 1 from public.workspace_blobs where workspace_id = ws and sha256 = j -> 'conflicts' -> 0 ->> 'marked'),
    'ok_conflict_resolved', public.ws_merge_branches(ws, b, 'p12-bo/feature', 'main', 'Settle line 2',
                              jsonb_build_object('src/lib/one.txt', pg_temp.blob(ws, b, E'line 1 by Bo\nline 2 by both\nline 3 by Ada\n'))) ->> 'status' = 'merged');

  -- Renames: we edit a file, they move it (exactly).
  perform public.ws_create_branch(ws, b, 'p12-bo/move', 'main');
  perform public.ws_commit(ws, b, 'p12-bo/move', null, 'Move the readme', jsonb_build_array(
            jsonb_build_object('path', 'README.md', 'delete', true),
            jsonb_build_object('path', 'docs/README.md', 'blob', (select new_blob from public.commit_changes cc
                                                                    where cc.commit_id = h1 and cc.path = 'README.md'))));
  perform public.ws_commit(ws, a, 'main', null, 'Ada edits the readme', jsonb_build_array(
            jsonb_build_object('path', 'README.md', 'blob', pg_temp.blob(ws, a, E'# Yard\nEdited by Ada.\n'))));
  r := public.ws_merge_branches(ws, b, 'p12-bo/move', 'main');
  out := out || jsonb_build_object(
    'ok_rename_follows', r ->> 'status' = 'merged'
                         and public.ws_file(ws, b, 'p12-bo/move', 'docs/README.md') ->> 'content' = E'# Yard\nEdited by Ada.\n'
                         and pg_temp.fails(format('select public.ws_file(%L, %L, %L, %L)', ws, b, 'p12-bo/move', 'README.md'), 'PT404'));

  -- Renames with edits: found by the worker's similarity search.
  perform public.ws_create_branch(ws, b, 'p12-bo/move2', 'main');
  perform public.ws_commit(ws, b, 'p12-bo/move2', null, 'Move and tweak the readme', jsonb_build_array(
            jsonb_build_object('path', 'README.md', 'delete', true),
            jsonb_build_object('path', 'guide/README.md', 'blob', pg_temp.blob(ws, b, E'# Yard\nEdited by Ada.\nMoved.\n'))));
  perform public.ws_commit(ws, a, 'main', null, 'Ada edits the readme again', jsonb_build_array(
            jsonb_build_object('path', 'README.md', 'blob', pg_temp.blob(ws, a, E'# Yard (v2)\nEdited by Ada.\n'))));
  r := public.ws_merge_branches(ws, b, 'p12-bo/move2', 'main', null, null, true);
  j := (select payload from public.merge_jobs where kind = 'renames' and workspace_id = ws limit 1);
  out := out || jsonb_build_object(
    'ok_rename_search_pending', r ->> 'status' = 'pending' and j ->> 'side_root' is not null
                                and j -> 'deleted' -> 0 ->> 'path' = 'README.md' and j -> 'added' -> 0 ->> 'path' = 'guide/README.md');
  perform public.code_store_renames(j ->> 'base_root', j ->> 'side_root', '{"README.md": "guide/README.md"}');
  r := public.ws_merge_branches(ws, b, 'p12-bo/move2', 'main', null, null, true);
  j := (select payload from public.merge_jobs where kind = 'content' and workspace_id = ws limit 1);
  out := out || jsonb_build_object('ok_rename_then_content', r ->> 'status' = 'pending' and j ->> 'path' = 'guide/README.md');
  perform public.code_store_merge(j ->> 'base', j ->> 'ours', j ->> 'theirs', false, E'# Yard (v2)\nEdited by Ada.\nMoved.\n',
                                  pg_temp.git(E'# Yard (v2)\nEdited by Ada.\nMoved.\n'));
  r := public.ws_merge_branches(ws, b, 'p12-bo/move2', 'main');
  out := out || jsonb_build_object(
    'ok_similar_rename_merge', public.ws_file(ws, b, 'p12-bo/move2', 'guide/README.md') ->> 'content' = E'# Yard (v2)\nEdited by Ada.\nMoved.\n'
                               and pg_temp.fails(format('select public.ws_file(%L, %L, %L, %L)', ws, b, 'p12-bo/move2', 'README.md'), 'PT404'));

  -- Modify/delete, binary-free mode merges, and a file meeting a folder.
  perform public.ws_create_branch(ws, b, 'p12-bo/odd', 'main');
  perform public.ws_commit(ws, b, 'p12-bo/odd', null, 'Bo drops notes', jsonb_build_array(jsonb_build_object('path', 'notes.txt', 'delete', true)));
  perform public.ws_commit(ws, a, 'main', null, 'Ada edits notes', jsonb_build_array(jsonb_build_object('path', 'notes.txt', 'blob', pg_temp.blob(ws, a, 'notes, edited'))));
  j := public.ws_merge_conflicts(ws, b, 'p12-bo/odd', 'main');
  out := out || jsonb_build_object('ok_modify_delete', j -> 'conflicts' -> 0 ->> 'kind' = 'modify_delete' and j -> 'conflicts' -> 0 ->> 'path' = 'notes.txt');
  perform public.ws_merge_branches(ws, b, 'p12-bo/odd', 'main', null, '{"notes.txt": null}');
  perform public.ws_commit(ws, b, 'p12-bo/odd', null, 'Bo makes run.sh plain', jsonb_build_array(
            jsonb_build_object('path', 'bin/run.sh', 'blob', s2, 'executable', false)));
  perform public.ws_commit(ws, a, 'main', null, 'Ada edits run.sh', jsonb_build_array(
            jsonb_build_object('path', 'bin/run.sh', 'blob', pg_temp.blob(ws, a, E'#!/bin/sh\necho hello\n'))));
  r := public.ws_merge_branches(ws, b, 'p12-bo/odd', 'main');
  out := out || jsonb_build_object(
    'ok_mode_merge', public.ws_file(ws, b, 'p12-bo/odd', 'bin/run.sh') ->> 'content' = E'#!/bin/sh\necho hello\n'
                     and not (public.ws_file(ws, b, 'p12-bo/odd', 'bin/run.sh') ->> 'executable')::boolean);
  perform public.ws_commit(ws, b, 'p12-bo/odd', null, 'Bo makes a folder', jsonb_build_array(
            jsonb_build_object('path', 'cfg/app.json', 'blob', pg_temp.blob(ws, b, '{}'))));
  perform public.ws_commit(ws, a, 'main', null, 'Ada makes a file', jsonb_build_array(
            jsonb_build_object('path', 'cfg', 'blob', pg_temp.blob(ws, a, 'cfg file'))));
  j := public.ws_merge_conflicts(ws, b, 'p12-bo/odd', 'main');
  out := out || jsonb_build_object('ok_file_dir', exists (select 1 from jsonb_array_elements(j -> 'conflicts') x where x ->> 'kind' = 'file_dir'));

  -- ------------------------------------------------------------ change requests: squash and rebase
  perform public.ws_create_branch(ws, b, 'p12-bo/sq', 'main');
  perform public.ws_commit(ws, b, 'p12-bo/sq', null, 'Squash 1', jsonb_build_array(jsonb_build_object('path', 'sq/a.txt', 'blob', pg_temp.blob(ws, b, 'a'))));
  perform public.ws_commit(ws, b, 'p12-bo/sq', null, 'Squash 2', jsonb_build_array(jsonb_build_object('path', 'sq/b.txt', 'blob', pg_temp.blob(ws, b, 'b'))));
  cr := (public.open_change_request(ws, b, 'p12-bo/sq', 'main', 'Two files', 'Adds a and b.') ->> 'id')::uuid;
  hm := public.ws_resolve_ref(ws, 'main');
  r := public.merge_change_request(cr, a, null, 'squash');
  hs := public.ws_resolve_ref(ws, 'main');
  out := out || jsonb_build_object(
    'ok_squash', r ->> 'status' = 'merged' and (select parents from public.commits where id = hs) = array[hm]
                 and (select message from public.commits where id = hs) like 'Two files (#%)%Adds a and b.'
                 and (select merge_method from public.change_requests where id = cr) = 'squash'
                 and public.ws_file(ws, b, 'main', 'sq/b.txt') ->> 'content' = 'b');

  perform public.ws_create_branch(ws, b, 'p12-bo/rb', 'main');
  perform public.ws_commit(ws, b, 'p12-bo/rb', null, 'Rebase 1', jsonb_build_array(jsonb_build_object('path', 'rb/a.txt', 'blob', pg_temp.blob(ws, b, 'ra'))));
  perform public.ws_commit(ws, b, 'p12-bo/rb', null, 'Rebase 2', jsonb_build_array(jsonb_build_object('path', 'rb/b.txt', 'blob', pg_temp.blob(ws, b, 'rb'))));
  perform public.ws_commit(ws, a, 'main', null, 'Main moves on', jsonb_build_array(jsonb_build_object('path', 'main.txt', 'blob', pg_temp.blob(ws, a, 'main'))));
  cr := (public.open_change_request(ws, b, 'p12-bo/rb', 'main', 'Rebase me', '') ->> 'id')::uuid;
  hm := public.ws_resolve_ref(ws, 'main');
  r := public.merge_change_request(cr, a, null, 'rebase');
  hs := public.ws_resolve_ref(ws, 'main');
  out := out || jsonb_build_object(
    'ok_rebase_merge', r ->> 'status' = 'merged' and (select message from public.commits where id = hs) = 'Rebase 2'
                       and (select parents from public.commits where id = (select parents[1] from public.commits where id = hs)) = array[hm]
                       and cardinality((select parents from public.commits where id = hs)) = 1
                       and (select author_agent_id from public.commits where id = hs) = b
                       and public.ws_file(ws, b, 'main', 'rb/a.txt') ->> 'content' = 'ra');

  -- Rebasing a branch, and cherry-picking.
  perform public.ws_create_branch(ws, b, 'p12-bo/topic', 'main');
  c1 := public.ws_commit(ws, b, 'p12-bo/topic', null, 'Topic 1', jsonb_build_array(jsonb_build_object('path', 'topic/1.txt', 'blob', pg_temp.blob(ws, b, 't1')))) ->> 'commit';
  c2 := public.ws_commit(ws, b, 'p12-bo/topic', null, 'Topic 2', jsonb_build_array(jsonb_build_object('path', 'topic/2.txt', 'blob', pg_temp.blob(ws, b, 't2')))) ->> 'commit';
  perform public.ws_commit(ws, a, 'main', null, 'Main again', jsonb_build_array(jsonb_build_object('path', 'main2.txt', 'blob', pg_temp.blob(ws, a, 'm2'))));
  hm := public.ws_resolve_ref(ws, 'main');
  r := public.ws_rebase(ws, b, 'p12-bo/topic', 'main');
  hf := public.ws_resolve_ref(ws, 'p12-bo/topic');
  out := out || jsonb_build_object(
    'ok_rebase_branch', r ->> 'status' = 'rebased' and (r ->> 'replayed')::int = 2 and public.ws_is_ancestor(hm, hf)
                        and hf <> c2 and public.ws_file(ws, b, 'p12-bo/topic', 'main2.txt') ->> 'content' = 'm2'
                        and public.ws_file(ws, b, 'p12-bo/topic', 'topic/2.txt') ->> 'content' = 't2',
    'ok_rebase_up_to_date', pg_temp.fails(format('select public.ws_rebase(%L, %L, %L, %L)', ws, b, 'p12-bo/topic', 'main'), 'PT409'));
  perform public.ws_create_branch(ws, b, 'p12-bo/pick', 'main');
  r := public.ws_cherry_pick(ws, b, 'p12-bo/pick', c1);
  out := out || jsonb_build_object(
    'ok_cherry_pick', r ->> 'status' = 'picked' and public.ws_file(ws, b, 'p12-bo/pick', 'topic/1.txt') ->> 'content' = 't1'
                      and pg_temp.fails(format('select public.ws_file(%L, %L, %L, %L)', ws, b, 'p12-bo/pick', 'topic/2.txt'), 'PT404')
                      and (select message from public.commits where id = r ->> 'commit') like 'Topic 1%cherry picked from commit%',
    'ok_cherry_pick_again', pg_temp.fails(format('select public.ws_cherry_pick(%L, %L, %L, %L)', ws, b, 'p12-bo/pick', c1), 'PT409'));

  -- ------------------------------------------------------------ change requests wait on line merges
  perform public.ws_create_branch(ws, b, 'p12-bo/wait', 'main');
  perform public.ws_commit(ws, b, 'p12-bo/wait', null, 'Bo edits main.txt top', jsonb_build_array(
            jsonb_build_object('path', 'main.txt', 'blob', pg_temp.blob(ws, b, E'top by Bo\nmain\nbottom\n'))));
  perform public.ws_commit(ws, a, 'main', null, 'Ada pads main.txt', jsonb_build_array(
            jsonb_build_object('path', 'main.txt', 'blob', pg_temp.blob(ws, a, E'top\nmain\nbottom by Ada\n'))));
  cr := (public.open_change_request(ws, b, 'p12-bo/wait', 'main', 'Wait for it', '') ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_cr_pending', (select mergeable from public.change_requests where id = cr) is null
                     and ((select merge_state from public.change_requests where id = cr) ->> 'pending')::int = 1
                     and ((select merge_state from public.change_requests where id = cr) ->> 'files')::int = 1,
    'ok_cr_merge_pending', (public.merge_change_request(cr, a, null, 'merge', true) ->> 'status') = 'pending');
  j := (select payload from public.merge_jobs where kind = 'content' and workspace_id = ws limit 1);
  perform public.code_store_merge(j ->> 'base', j ->> 'ours', j ->> 'theirs', true, null, null, 2);
  n := public.code_after(array[ws]);
  out := out || jsonb_build_object(
    'ok_code_after', n >= 1 and (select mergeable from public.change_requests where id = cr) is false
                     and (select conflicts from public.change_requests where id = cr) = array['main.txt']);

  -- Failed jobs settle after five tries.
  perform public.ws_request_merges(ws, jsonb_build_array(jsonb_build_object('kind', 'content', 'base', s1, 'ours', s2, 'theirs', s3)));
  update public.merge_jobs set attempts = 5 where kind = 'content' and key = concat_ws(':', s1, s2, s3);
  perform public.code_fail_job('content', concat_ws(':', s1, s2, s3), 'boom');
  out := out || jsonb_build_object(
    'ok_fail_settles', not exists (select 1 from public.merge_jobs where key = concat_ws(':', s1, s2, s3))
                       and (select conflict from public.blob_merges where base_sha = s1 and ours_sha = s2 and theirs_sha = s3));

  -- ------------------------------------------------------------ GitHub's view
  j := public.gh_push_plan(ws, 0, 'main', 200);
  out := out || jsonb_build_object(
    'ok_push_plan', (j ->> 'total')::int = (select count(*) from public.commits c where c.workspace_id = ws
                                              and exists (select 1 from public.ws_ancestors(public.ws_resolve_ref(ws, 'main')) x where x.id = c.id)) - 1
                    and exists (select 1 from jsonb_array_elements(j -> 'commits') c, jsonb_array_elements(c -> 'changes') x
                                 where c ->> 'message' = 'Start' and x ->> 'path' = 'bin/run.sh' and (x ->> 'executable')::boolean));
  r := public.gh_import_commit(ws, 'imported', array[public.ws_resolve_ref(ws, 'main')], null,
         jsonb_build_object('tool.sh', s2, 'a/b.txt', s1), 'From GitHub', '{"provider": "github"}', null, null, null, false, '{"tool.sh": "x"}');
  out := out || jsonb_build_object(
    'ok_import_modes', (public.ws_file(ws, b, 'imported', 'tool.sh') ->> 'executable')::boolean
                       and (select count(*) from public.ws_walk(public.ws_root(r ->> 'commit'), '')) = 2,
    'ok_import_root', public.ws_root(r ->> 'commit') = public.ws_tree_from_manifest(jsonb_build_object('tool.sh', s2, 'a/b.txt', s1), '{"tool.sh": "x"}')
                      and public.ws_root(r ->> 'commit') = pg_temp.edit(null, jsonb_build_array(jsonb_build_object('p', 'tool.sh', 's', s2, 'm', 'x'),
                                                                                                 jsonb_build_object('p', 'a/b.txt', 's', s1))),
    'ok_import_bad_path', pg_temp.fails(format('select public.gh_import_commit(%L, %L, null, null, %L, %L, %L)', ws, 'imported',
                                               jsonb_build_object('ok.txt', s1, 'src/.git/config', s1), 'Bad', '{}'), 'PT400'),
    'ok_import_clash', pg_temp.fails(format('select public.gh_import_commit(%L, %L, null, null, %L, %L, %L)', ws, 'imported',
                                            jsonb_build_object('a', s1, 'a/b', s1), 'Bad', '{}'), 'PT400'),
    'ok_bad_manifest_path', public.ws_bad_manifest_path('{"a/../b": "x"}') = 'a/../b' and public.ws_bad_manifest_path('{"a//b": "x"}') = 'a//b'
                            and public.ws_bad_manifest_path(jsonb_build_object(repeat('d', 256) || '/f', 'x')) is not null
                            and public.ws_bad_manifest_path('{"a/b.c/.d/e..f": "x", "x": "y"}') is null);

  -- ------------------------------------------------------------ the web's reads, and grants
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  j := public.web_ws_tree('phase-twelve-yard', 'main', 'bin');
  e := public.web_ws_tree('phase-twelve-yard', 'main', 'bin/run.sh');
  out := out || jsonb_build_object(
    'ok_web_tree', j ->> 'kind' = 'dir' and j -> 'entries' -> 0 ->> 'name' = 'run.sh' and e ->> 'kind' = 'file'
                   and public.web_ws_tree('phase-twelve-yard', 'main', 'nope') ->> 'kind' is null,
    'ok_web_diff', (public.web_ws_diff('phase-twelve-yard', null, 'main') ->> 'total')::int > 5
                   and public.web_ws_diff('phase-twelve-yard', h1, h2) -> 'files' -> 0 ->> 'path' = 'src/lib/one.txt');
  reset role;
  out := out || jsonb_build_object(
    'ok_grants', has_function_privilege('anon', 'public.web_ws_tree(text, text, text)', 'execute')
                 and has_function_privilege('anon', 'public.web_ws_diff(text, text, text, int)', 'execute')
                 and has_function_privilege('anon', 'public.web_ws_log(text, text, text, int, int, text)', 'execute')
                 and not has_function_privilege('anon', 'public.ws_merge_plan(text, text, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.code_claim(int)', 'execute')
                 and not has_function_privilege('authenticated', 'public.ws_tree_edit(text, jsonb, boolean, text)', 'execute')
                 and not has_function_privilege('anon', 'public.code_store_merge(text, text, text, boolean, text, text, int)', 'execute')
                 and not has_function_privilege('authenticated', 'public.ws_bad_manifest_path(jsonb)', 'execute'),
    'ok_backfilled', not exists (select 1 from public.commits where root is null)
                     and not exists (select 1 from public.commits c where c.stats ->> 'files' is not null
                                      and (c.stats ->> 'files')::int <> (select file_count from public.tree_nodes n where n.sha256 = c.root)),
    'ok_rls', (select count(*) from public.tree_nodes) > 0);

  raise exception 'PHASE12_TREES_RESULT %', out::text;
exception when others then
  if sqlerrm like 'PHASE12_TREES_RESULT%' then
    raise;
  end if;
  raise exception 'PHASE12_TREES_FAILED (%): % | so far: %', sqlstate, sqlerrm, out::text;
end $test$;
