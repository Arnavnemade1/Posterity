-- Phase 12: line merges worked out one way serve the other.
--
-- A change request's merge works out "target + branch"; when the branch then merges the target in to
-- resolve, the same three versions come the other way round. Its clean result is the same text and a
-- conflict is a conflict, so the cache answers both directions (the conflict view still asks the code
-- worker for markers with the sides the right way round). Merging with resolutions also counts the
-- files it settled while their line merge was still being worked out.

-- How one path merges when both sides touched it: b/bm the base, o/om ours, t/tm theirs (a null blob:
-- deleted). Answers {action: keep | set | conflict | pending, ...}.
create or replace function public.ws_merge_path(p_path text, b text, bm text, o text, om text, t text, tm text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  m public.blob_merges;
begin
  if o is not distinct from t then
    if o is null or om is not distinct from tm or tm is not distinct from bm then
      return jsonb_build_object('action', 'keep');
    end if;
    if om is not distinct from bm then
      return jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', p_path, 's', t, 'm', tm));
    end if;
    return jsonb_build_object('action', 'keep');
  end if;
  if o is null or t is null then
    return jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
      'path', p_path, 'kind', 'modify_delete', 'base', b, 'ours', o, 'theirs', t));
  end if;
  v_mode := case when om is not distinct from bm then coalesce(tm, om, 'f') else coalesce(om, 'f') end;
  if t is not distinct from b then
    if v_mode is distinct from om then
      return jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', p_path, 's', o, 'm', v_mode));
    end if;
    return jsonb_build_object('action', 'keep');
  end if;
  if o is not distinct from b then
    return jsonb_build_object('action', 'set', 'change', jsonb_build_object('p', p_path, 's', t, 'm', v_mode));
  end if;
  if exists (select 1 from public.blobs x where x.sha256 in (b, o, t) and x.is_binary) then
    return jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
      'path', p_path, 'kind', 'binary', 'base', b, 'ours', o, 'theirs', t));
  end if;
  select * into m from public.blob_merges where base_sha = coalesce(b, '') and ours_sha = o and theirs_sha = t;
  if not found then
    -- The same merge the other way round (the target merged into a branch after the change request's
    -- merge was worked out): a clean result is the same text, and a conflict is a conflict, though its
    -- markers have the sides swapped.
    select * into m from public.blob_merges where base_sha = coalesce(b, '') and ours_sha = t and theirs_sha = o;
    if found then
      if m.conflict then
        return jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
          'path', p_path, 'kind', case when b is null then 'add_add' else 'content' end, 'base', b, 'ours', o, 'theirs', t,
          'marked', null, 'hunks', m.conflict_hunks, 'swapped', true));
      end if;
      return jsonb_build_object('action', 'set', 'blob', m.merged_sha,
                                'change', jsonb_build_object('p', p_path, 's', m.merged_sha, 'm', v_mode));
    end if;
    return jsonb_build_object('action', 'pending', 'pending', jsonb_build_object(
      'kind', 'content', 'path', p_path, 'base', coalesce(b, ''), 'ours', o, 'theirs', t));
  end if;
  if m.conflict then
    return jsonb_build_object('action', 'conflict', 'conflict', jsonb_build_object(
      'path', p_path, 'kind', case when b is null then 'add_add' else 'content' end, 'base', b, 'ours', o, 'theirs', t,
      'marked', m.marked_sha, 'hunks', m.conflict_hunks));
  end if;
  return jsonb_build_object('action', 'set', 'blob', m.merged_sha,
                            'change', jsonb_build_object('p', p_path, 's', m.merged_sha, 'm', v_mode));
end
$$;

-- Merge another branch (or commit) into a branch you can push to, e.g. the target into your work to
-- resolve conflicts. resolutions: {"path": "<blob sha256>" or null to delete} for each conflicting file.
-- With p_pending_ok a merge waiting on line merges answers {status: "pending"} (and the worker is
-- asked); otherwise it raises merge_pending.
create or replace function public.ws_merge_branches(p_ws uuid, p_agent uuid, p_into text, p_from text, p_message text default null,
                                                    p_resolutions jsonb default null, p_pending_ok boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  v_from text;
  v_base text;
  v_plan jsonb;
  v_conflicts text[];
  v_unresolved jsonb;
  v_pending jsonb;
  v_edits jsonb := '[]'::jsonb;
  v_edit jsonb;
  v_path text;
  v_blob text;
  v_result jsonb;
  v_res jsonb := coalesce(p_resolutions, '{}'::jsonb);
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  if not public.ws_can_push(p_ws, p_agent, p_into) then
    raise exception 'You cannot push to "%"', p_into using errcode = 'PT403';
  end if;
  select * into b from public.branches where workspace_id = p_ws and name = p_into for update;
  if not found then
    raise exception 'No branch "%"', p_into using errcode = 'PT404';
  end if;
  if b.protected then
    raise exception '"%" is protected: open a change request instead', p_into using errcode = 'PT403';
  end if;
  if b.frozen_reason is not null then
    raise exception '"%" is frozen: %', p_into, b.frozen_reason using errcode = 'PT409';
  end if;
  if jsonb_typeof(v_res) <> 'object' then
    raise exception 'resolutions must be an object of {"path": "<blob sha256>" or null}' using errcode = 'PT400';
  end if;
  v_from := public.ws_resolve_ref(p_ws, p_from);
  if public.ws_is_ancestor(v_from, b.head) then
    raise exception 'Already up to date: "%" has everything in %', p_into, p_from using errcode = 'PT409';
  end if;
  if public.ws_is_ancestor(b.head, v_from) and v_res = '{}'::jsonb then
    perform public.ws_move_branch(p_ws, p_into, v_from, b.head);
    return jsonb_build_object('status', 'merged', 'commit', v_from, 'branch', p_into, 'fast_forward', true, 'workspace', w.slug);
  end if;
  v_base := public.ws_merge_base(b.head, v_from);
  v_plan := public.ws_merge_plan(public.ws_root(v_base), public.ws_root(b.head), public.ws_root(v_from));
  -- A file the caller resolved needs no line merge.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_pending
    from jsonb_array_elements(v_plan -> 'pending') x
   where not (x ->> 'kind' = 'content' and v_res ? (x ->> 'path'));
  if jsonb_array_length(v_pending) > 0 then
    if coalesce(p_pending_ok, false) then
      perform public.ws_request_merges(p_ws, v_pending);
      return jsonb_build_object('status', 'pending', 'pending', jsonb_array_length(v_pending),
                                'branch', p_into, 'workspace', w.slug);
    end if;
    perform public.ws_raise_pending(v_pending);
  end if;
  -- Resolved: the conflicting files, and those whose line merge the caller settled by resolving them.
  v_conflicts := array(select x ->> 'path' from jsonb_array_elements(v_plan -> 'conflicts') x
                       union
                       select x ->> 'path' from jsonb_array_elements(v_plan -> 'pending') x
                        where x ->> 'kind' = 'content' and v_res ? (x ->> 'path'));
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_unresolved
    from jsonb_array_elements(v_plan -> 'conflicts') x where not v_res ? (x ->> 'path');
  if jsonb_array_length(v_unresolved) > 0 then
    perform public.ws_raise_conflict(v_unresolved,
      'Resolve each in "resolutions": {"path": "<blob sha256>" or null to delete}.');
  end if;
  for v_path, v_blob in select key, value #>> '{}' from jsonb_each(v_res) loop
    if not public.ws_valid_path(v_path) then
      raise exception 'Invalid path "%"', v_path using errcode = 'PT400';
    end if;
    if v_blob is not null and not exists (select 1 from public.workspace_blobs where workspace_id = p_ws and sha256 = v_blob) then
      raise exception 'Blob % (for "%") was not uploaded to this workspace', left(v_blob, 12), v_path using errcode = 'PT400';
    end if;
    v_edits := v_edits || jsonb_build_array(jsonb_build_object('p', v_path, 's', v_blob));
  end loop;
  v_edit := public.ws_tree_edit(v_plan ->> 'root', v_edits, false, '');
  if jsonb_array_length(v_edit -> 'conflicts') > 0 then
    raise exception '"%" cannot be both a file and a folder', v_edit -> 'conflicts' ->> 0 using errcode = 'PT400';
  end if;
  insert into public.workspace_blobs (workspace_id, sha256)
  select p_ws, x #>> '{}' from jsonb_array_elements(v_plan -> 'blobs') x on conflict do nothing;
  v_result := public.ws_write_root_commit(p_ws, p_into, array[b.head, v_from], v_edit ->> 'node', p_agent,
                                          coalesce(nullif(btrim(p_message), ''), format('Merge %s into %s', p_from, p_into)), b.head);
  perform public.log_activity('code_merged', format('@%s merged %s into %s/%s', public.agent_handle(p_agent), p_from, w.slug, p_into),
    p_agent, null, w.mission_id, b.task_id, jsonb_build_object('workspace', w.slug, 'branch', p_into, 'commit', v_result ->> 'commit'));
  return v_result || jsonb_build_object('status', 'merged', 'fast_forward', false, 'resolved', cardinality(v_conflicts),
                                        'workspace', w.slug);
end
$$;

-- What a merge of from into into would conflict on, for agents resolving it: each conflict with the
-- three versions and (for text) the text with conflict markers once the worker computed it.
create or replace function public.ws_merge_conflicts(p_ws uuid, p_agent uuid, p_into text, p_from text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_into text;
  v_from text;
  v_base text;
  v_plan jsonb;
  v_pending jsonb;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  v_into := public.ws_resolve_ref(p_ws, p_into);
  v_from := public.ws_resolve_ref(p_ws, p_from);
  if public.ws_is_ancestor(v_from, v_into) or public.ws_is_ancestor(v_into, v_from) then
    return jsonb_build_object('into', v_into, 'from', v_from, 'conflicts', '[]'::jsonb, 'pending', 0);
  end if;
  v_base := public.ws_merge_base(v_into, v_from);
  v_plan := public.ws_merge_plan(public.ws_root(v_base), public.ws_root(v_into), public.ws_root(v_from));
  -- A conflict known only the other way round still needs its marked text this way round.
  v_pending := (v_plan -> 'pending') || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'content', 'path', x ->> 'path', 'base', coalesce(x ->> 'base', ''),
                                        'ours', x ->> 'ours', 'theirs', x ->> 'theirs'))
      from jsonb_array_elements(v_plan -> 'conflicts') x where (x ->> 'swapped')::boolean), '[]'::jsonb);
  if jsonb_array_length(v_pending) > 0 then
    perform public.ws_request_merges(p_ws, v_pending);
  end if;
  -- Marked-up texts become readable in this workspace.
  insert into public.workspace_blobs (workspace_id, sha256)
  select p_ws, x ->> 'marked' from jsonb_array_elements(v_plan -> 'conflicts') x where x ->> 'marked' is not null
  on conflict do nothing;
  return jsonb_build_object('into', v_into, 'from', v_from, 'base', v_base, 'conflicts', v_plan -> 'conflicts',
                            'pending', jsonb_array_length(v_pending));
end
$$;
