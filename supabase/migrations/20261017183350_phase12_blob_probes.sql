-- Phase 12: blob checks that stay fast right after a bulk upload.
--
-- A GitHub import uploads its files and then commits them at once. Until the table's statistics catch
-- up, the planner thinks the workspace has a handful of blobs and checks each file against all of
-- them (100,000 x 100,000 comparisons: minutes). The checks now probe the index once per file, which
-- the planner cannot rearrange.

create or replace function public.gh_import_commit(p_ws uuid, p_branch text, p_parents text[], p_expected text, p_manifest jsonb,
                                                   p_message text, p_origin jsonb, p_repo bigint default null, p_sha text default null,
                                                   p_tree text default null, p_force boolean default false, p_modes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  b public.branches;
  v_bad text;
  v_existing text;
  v_expected text := p_expected;
  v_root text;
  v_res jsonb;
begin
  select * into w from public.workspaces where id = p_ws;
  if not found then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  if not public.ws_valid_branch(p_branch) then
    raise exception 'Invalid branch name "%"', p_branch using errcode = 'PT400';
  end if;
  if jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'manifest must be an object' using errcode = 'PT400';
  end if;
  v_bad := public.ws_bad_manifest_path(p_manifest);
  if v_bad is not null then
    raise exception 'Invalid path "%"', v_bad using errcode = 'PT400';
  end if;
  -- One index probe per file: a lateral subquery with a limit is never turned into a join.
  select e.key into v_bad
    from jsonb_each_text(p_manifest) e
    left join lateral (select 1 as hit from public.workspace_blobs wb
                        where wb.workspace_id = p_ws and wb.sha256 = e.value limit 1) h on true
   where h.hit is null
   limit 1;
  if v_bad is not null then
    raise exception 'Blob % (for "%") is not in this workspace', left(p_manifest ->> v_bad, 12), v_bad using errcode = 'PT400';
  end if;
  if p_sha is not null then
    select commit_id into v_existing from public.commit_mirrors where repo_id = p_repo and git_sha = p_sha;
    if v_existing is not null then
      return jsonb_build_object('commit', v_existing, 'branch', p_branch, 'existed', true);
    end if;
  end if;

  select * into b from public.branches where workspace_id = p_ws and name = p_branch for update;
  if not found then
    if cardinality(p_parents) = 0 then
      raise exception 'A new branch needs a parent commit' using errcode = 'PT400';
    end if;
    insert into public.branches (workspace_id, name, head, created_by) values (p_ws, p_branch, p_parents[1], null);
    update public.workspaces set branch_count = branch_count + 1 where id = p_ws;
    v_expected := p_parents[1];
  elsif p_force then
    v_expected := b.head;
  elsif v_expected is null then
    v_expected := b.head;
  end if;

  v_root := public.ws_tree_from_manifest(p_manifest, p_modes);
  v_res := public.ws_write_root_commit(p_ws, p_branch, coalesce(p_parents, '{}'), v_root, null,
                                       left(coalesce(nullif(btrim(p_message), ''), 'Sync from GitHub'), 4000), v_expected);
  update public.commits set origin = p_origin where id = v_res ->> 'commit';
  if p_sha is not null then
    insert into public.commit_mirrors (repo_id, commit_id, git_sha, git_tree, direction)
    values (p_repo, v_res ->> 'commit', p_sha, p_tree, 'in');
  end if;
  perform public.log_activity('code_synced',
    format('GitHub changes reached %s/%s: %s', w.slug, p_branch, left(split_part(coalesce(p_message, ''), E'\n', 1), 140)),
    null, null, w.mission_id, null,
    jsonb_build_object('workspace', w.slug, 'branch', p_branch, 'commit', v_res ->> 'commit', 'stats', v_res -> 'stats'));
  return v_res || jsonb_build_object('workspace', w.slug, 'existed', false);
end
$$;

-- Which of these sha256 hashes this workspace does not have yet (so a push uploads only those).
create or replace function public.ws_missing_blobs(p_ws uuid, p_agent uuid, p_shas text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  return coalesce((select array_agg(distinct x.s order by x.s)
                     from unnest(coalesce(p_shas, '{}')) as x(s)
                     left join lateral (select 1 as hit from public.workspace_blobs wb
                                         where wb.workspace_id = p_ws and wb.sha256 = x.s limit 1) h on true
                    where h.hit is null), '{}');
end
$$;
