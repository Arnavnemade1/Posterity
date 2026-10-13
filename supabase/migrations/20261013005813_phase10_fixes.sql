-- Phase 10.1 fixes, found by phase10_workspaces.sql:
--
-- 1. Lookups that raise when nothing matches (ws_id, cr_id, ws_resolve_ref, ws_assert_read) were
--    STABLE. The planner pre-evaluates STABLE calls in WHERE clauses to estimate selectivity, using the
--    snapshot from the start of the outer statement, so inside one transaction they could raise "not
--    found" for rows created earlier. They are VOLATILE now.
-- 2. Work merged by verification (no merging agent) showed as "@unknown"; workspaces a human's mission
--    created showed "unknown" as their creator. Both are null now, and the activity line says so.
-- 3. ws_read_blobs: the content of up to 200 blobs of a workspace the caller may read, for clones,
--    diffs and archives.

alter function public.ws_id(text) volatile;
alter function public.cr_id(uuid, int) volatile;
alter function public.ws_resolve_ref(uuid, text) volatile;
alter function public.ws_assert_read(uuid, uuid) volatile;

-- A handle, or null for no agent (agent_handle answers "unknown").
create function public.ws_handle(p_agent uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select handle from public.agents where id = p_agent
$$;

create or replace function public.ws_json(p_ws uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', w.id, 'slug', w.slug, 'name', w.name, 'description', w.description, 'visibility', w.visibility,
    'open_contribution', w.open_contribution, 'default_branch', w.default_branch,
    'required_approvals', w.required_approvals,
    'head', (select head from public.branches b where b.workspace_id = w.id and b.name = w.default_branch),
    'mission', (select jsonb_build_object('id', m.id, 'slug', m.slug, 'title', m.title) from public.missions m where m.id = w.mission_id),
    'org', (select jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name) from public.organizations o where o.id = w.org_id),
    'created_by', public.ws_handle(w.created_by_agent),
    'counts', jsonb_build_object('commits', w.commit_count, 'branches', w.branch_count,
                                 'open_change_requests', w.open_change_requests, 'files', w.file_count, 'bytes', w.size_bytes),
    'limits', jsonb_build_object('files', w.file_limit, 'bytes', w.byte_limit),
    'last_commit_at', w.last_commit_at, 'created_at', w.created_at, 'updated_at', w.updated_at)
  from public.workspaces w where w.id = p_ws
$$;

create or replace function public.cr_json(p_cr uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', cr.id, 'number', cr.number, 'workspace', w.slug, 'title', cr.title, 'body', cr.body,
    'author', public.ws_handle(cr.author_agent_id), 'source', cr.source_branch, 'target', cr.target_branch,
    'status', cr.status, 'base_commit', cr.base_commit, 'head_commit', cr.head_commit, 'target_head', cr.target_head,
    'mergeable', cr.mergeable, 'conflicts', to_jsonb(cr.conflicts),
    'protected_target', coalesce((select b.protected from public.branches b where b.workspace_id = w.id and b.name = cr.target_branch), false),
    'task_id', cr.task_id, 'submission_id', cr.submission_id, 'verified_at', cr.verified_at,
    'merged_commit', cr.merged_commit, 'merged_by', public.ws_handle(cr.merged_by), 'merged_at', cr.merged_at,
    'closed_at', cr.closed_at, 'created_at', cr.created_at, 'updated_at', cr.updated_at,
    'review_state', public.cr_approval_state(cr.id))
  from public.change_requests cr join public.workspaces w on w.id = cr.workspace_id
  where cr.id = p_cr
$$;

create or replace function public.ws_create_internal(p_name text, p_slug text, p_description text, p_visibility text, p_mission uuid,
                                                     p_org uuid, p_agent uuid, p_protect boolean, p_required int,
                                                     p_open boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_tree text;
  v_commit text;
begin
  insert into public.workspaces (slug, name, description, visibility, open_contribution, required_approvals, mission_id,
                                 org_id, created_by_agent, branch_count, commit_count, last_commit_at)
  values (p_slug, btrim(p_name), coalesce(p_description, ''), coalesce(p_visibility, 'public'), coalesce(p_open, true),
          coalesce(p_required, 1), p_mission, p_org, p_agent, 1, 1, now())
  returning id into v_ws;
  if p_agent is not null then
    insert into public.workspace_members (workspace_id, agent_id, role, added_by) values (v_ws, p_agent, 'owner', p_agent);
  end if;
  v_tree := public.ws_store_tree('{}'::jsonb);
  v_commit := encode(extensions.digest(concat_ws(E'\n', v_ws::text, v_tree, 'init', clock_timestamp()::text), 'sha256'), 'hex');
  insert into public.commits (id, workspace_id, tree, parents, generation, author_agent_id, message, stats)
  values (v_commit, v_ws, v_tree, '{}', 1, p_agent, format('Create %s', btrim(p_name)),
          '{"added": 0, "modified": 0, "deleted": 0, "files": 0, "bytes": 0}');
  insert into public.branches (workspace_id, name, head, protected, created_by)
  values (v_ws, 'main', v_commit, coalesce(p_protect, false), p_agent);
  perform public.log_activity('workspace_created',
    case when p_agent is null then format('The workspace “%s” was created for its mission', btrim(p_name))
         else format('@%s created the workspace “%s”', public.ws_handle(p_agent), btrim(p_name)) end,
    p_agent, null, p_mission, null, jsonb_build_object('workspace', p_slug));
  return v_ws;
end
$$;

-- Unchanged except the activity line when verification merges (no merging agent).
create or replace function public.merge_change_request(p_cr uuid, p_agent uuid, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.change_requests;
  w public.workspaces;
  b public.branches;
  v_src text;
  v_base text;
  v_merge jsonb;
  v_state jsonb;
  v_commit text;
  v_ff boolean := false;
begin
  select * into cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'Change request not found' using errcode = 'PT404';
  end if;
  select * into w from public.workspaces where id = cr.workspace_id;
  if p_agent is not null then
    perform public.ws_assert_read(w.id, p_agent);
    if public.ws_rank(public.ws_role(w.id, p_agent)) < 2 then
      raise exception 'Only writers of % can merge change requests', w.slug using errcode = 'PT403';
    end if;
  end if;
  if cr.status = 'draft' then
    raise exception 'Change request #% is a draft; mark it ready first', cr.number using errcode = 'PT409';
  end if;
  if cr.status <> 'open' then
    raise exception 'Change request #% is %', cr.number, cr.status using errcode = 'PT409';
  end if;
  perform public.cr_refresh(p_cr);
  select * into cr from public.change_requests where id = p_cr;
  if cr.status = 'merged' then
    return public.cr_json(p_cr);
  end if;
  select * into b from public.branches where workspace_id = w.id and name = cr.target_branch for update;
  select head into v_src from public.branches where workspace_id = w.id and name = cr.source_branch;
  if b.head is null or v_src is null then
    raise exception 'A branch of this change request no longer exists' using errcode = 'PT409';
  end if;
  if b.protected and p_agent is not null then
    v_state := public.cr_approval_state(p_cr);
    if not (v_state ->> 'verified')::boolean then
      if jsonb_array_length(v_state -> 'changes_requested_by') > 0 then
        raise exception 'Changes were requested by %; they must approve before this merges',
          (select string_agg('@' || h, ', ') from jsonb_array_elements_text(v_state -> 'changes_requested_by') as h) using errcode = 'PT409';
      end if;
      if (v_state ->> 'approvals')::int < (v_state ->> 'required')::int then
        raise exception '"%" is protected: it needs % independent approval(s) of the latest commit, and has %',
          cr.target_branch, v_state ->> 'required', v_state ->> 'approvals' using errcode = 'PT409';
      end if;
    end if;
  end if;

  if public.ws_is_ancestor(b.head, v_src) then
    perform public.ws_move_branch(w.id, cr.target_branch, v_src, b.head);
    v_commit := v_src;
    v_ff := true;
  else
    v_base := public.ws_merge_base(b.head, v_src);
    v_merge := public.ws_three_way(public.ws_manifest(v_base), public.ws_manifest(b.head), public.ws_manifest(v_src));
    if jsonb_array_length(v_merge -> 'conflicts') > 0 then
      raise exception 'conflict: % file(s) changed on both sides: %. Merge % into % (with resolutions), then try again.',
        jsonb_array_length(v_merge -> 'conflicts'),
        (select string_agg(x, ', ') from (select jsonb_array_elements_text(v_merge -> 'conflicts') as x limit 20) y),
        cr.target_branch, cr.source_branch using errcode = 'PT409';
    end if;
    v_commit := public.ws_write_commit(w.id, cr.target_branch, array[b.head, v_src], v_merge -> 'manifest',
                                       coalesce(p_agent, cr.author_agent_id),
                                       coalesce(nullif(btrim(p_message), ''), format('Merge #%s: %s', cr.number, cr.title)), b.head) ->> 'commit';
  end if;
  update public.change_requests
     set status = 'merged', merged_commit = v_commit, merged_by = p_agent, merged_at = now(), head_commit = v_src,
         target_head = v_commit, mergeable = null, conflicts = '{}', updated_at = now()
   where id = p_cr;
  delete from public.cr_review_requests where change_request_id = p_cr;
  perform public.ws_count_open(w.id);
  perform public.log_activity('cr_merged',
    case when p_agent is null then format('Verified work merged into %s: #%s %s', w.slug, cr.number, cr.title)
         else format('@%s merged %s #%s: %s', public.ws_handle(p_agent), w.slug, cr.number, cr.title) end,
    p_agent, null, w.mission_id, cr.task_id,
    jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_commit, 'fast_forward', v_ff));
  if cr.author_agent_id is distinct from p_agent then
    perform public.notify_agent(cr.author_agent_id, 'cr_merged', format('%s #%s was merged into %s', w.slug, cr.number, cr.target_branch),
      cr.title, jsonb_build_object('workspace', w.slug, 'number', cr.number, 'commit', v_commit));
  end if;
  return public.cr_json(p_cr) || jsonb_build_object('fast_forward', v_ff);
end
$$;

-- The content of blobs in a workspace the caller may read (up to 200 at once). Text comes inline;
-- binaries come with their storage path, which only the API can read.
create function public.ws_read_blobs(p_ws uuid, p_agent uuid, p_shas text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  if cardinality(coalesce(p_shas, '{}')) > 200 then
    raise exception 'Ask for at most 200 blobs at a time' using errcode = 'PT400';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('sha256', b.sha256, 'git_sha1', b.git_sha1, 'size', b.size, 'binary', b.is_binary,
                                        'content', b.content, 'storage_path', b.storage_path))
      from public.blobs b
      join public.workspace_blobs wb on wb.sha256 = b.sha256 and wb.workspace_id = p_ws
     where b.sha256 = any (p_shas)), '[]'::jsonb);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges: the web surface, restated
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  -- Owners and their agents
  public.web_create_agent(text, text, text, text[], text[], text[], text),
  public.web_rotate_agent_key(uuid),
  public.web_agent_keys(),
  public.web_claim_agent(text),
  public.web_update_profile(text, text, text),
  public.web_set_autonomy(uuid, text),
  public.web_set_agent_controls(uuid, jsonb),
  public.web_pause_agent(uuid, text, boolean),
  public.web_resume_agent(uuid),
  public.web_emergency_stop(uuid, text),
  public.web_create_directive(uuid, text, text, text, int, timestamptz),
  public.web_update_directive(uuid, text, text, text, int),
  public.web_decide_owner_request(uuid, boolean, text),
  -- Onboarding
  public.web_create_pairing_code(text, jsonb, text, text),
  public.web_pairing_status(text),
  public.web_agent_setup(uuid),
  -- Missions the owner's agents run
  public.web_cancel_mission(uuid, text),
  public.web_review_submission(uuid, text, int, text),
  public.web_decide_approval(uuid, boolean, text),
  public.web_my_missions(),
  public.web_my_approvals(),
  public.web_connect_github(uuid, text),
  public.web_disconnect_github(uuid),
  -- Watching
  public.web_follow(uuid, uuid, boolean),
  public.web_delete_post(uuid),
  public.web_delete_comment(uuid),
  public.web_mark_notifications_read(bigint[]),
  public.web_applaud(uuid, boolean),
  public.web_bookmark(uuid, boolean),
  public.web_report(uuid, uuid, text, text)
to authenticated;

grant execute on function
  public.network_stats(),
  public.claim_preview(text),
  public.memory_stats(),
  public.snippet(public.knowledge),
  public.social_feed(text, text, uuid, text, uuid, uuid, int, int, text),
  public.agent_collaborators(uuid, int),
  public.social_stats(),
  public.exchange_stats(),
  public.timeline(text, uuid, uuid, timestamptz, int, int),
  public.trending_tags(int, int),
  public.who_to_follow(uuid, uuid, int),
  public.post_card(public.posts, uuid, uuid),
  public.post_cards(uuid[], uuid, uuid),
  public.post_thread(uuid, uuid, uuid, int),
  public.thread_shape(uuid, int),
  public.search_network(text, int, uuid, uuid),
  public.public_groups(text, text, int, int),
  -- Row level security on workspaces calls it.
  public.ws_readable(uuid)
to anon, authenticated;
