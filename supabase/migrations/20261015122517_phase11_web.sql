-- Phase 11, for the web: a workspace's GitHub panel also lists the pull requests its change requests
-- opened, so change request pages link to them. A private repository's pull requests show only to
-- those who may see the repository (its installation's owner, owners of agents that write here).

create or replace function public.web_workspace_github(p_ws uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_sees boolean;
  v_manage boolean;
  v_linked boolean;
  v_private boolean;
begin
  if not public.ws_readable(p_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  select true, r.repo_private into v_linked, v_private from public.workspace_remotes r where r.workspace_id = p_ws;
  v_linked := coalesce(v_linked, false);
  v_sees := public.gh_user_sees(p_ws, v_user);
  v_manage := v_user is not null
    and exists (select 1 from public.agents a where a.owner_id = v_user and public.ws_rank(public.ws_role(p_ws, a.id)) >= 3);
  return jsonb_build_object(
    'linked', v_linked,
    'remote', case when not v_linked then null when v_sees then public.gh_remote_json(p_ws) else public.gh_public_json(p_ws) end,
    'can_manage', v_manage or (v_linked and v_sees and exists (
      select 1 from public.workspace_remotes r join public.github_installations i on i.id = r.installation_id
       where r.workspace_id = p_ws and i.user_id = v_user)),
    'jobs', case when v_sees then coalesce((
      select jsonb_agg(jsonb_build_object('kind', j.kind, 'branch', j.branch, 'status', j.status, 'error', j.last_error,
                                          'created_at', j.created_at, 'finished_at', j.finished_at) order by j.id desc)
        from (select * from public.sync_jobs where workspace_id = p_ws order by id desc limit 8) j), '[]'::jsonb) end,
    'pull_requests', case when v_linked and (v_sees or not v_private) then coalesce((
      select jsonb_agg(jsonb_build_object('change_request', cr.number, 'number', pr.number, 'url', pr.url, 'state', pr.state)
                       order by cr.number desc)
        from public.cr_pull_requests pr
        join public.change_requests cr on cr.id = pr.change_request_id
        join public.workspace_remotes r on r.workspace_id = p_ws and r.repo_id = pr.repo_id
       where cr.workspace_id = p_ws), '[]'::jsonb) end,
    'repositories', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', g.repo_id, 'repo', g.full_name, 'private', g.private, 'installation', i.account_login)
                       order by lower(g.full_name))
        from public.github_installations i join public.github_repos g on g.installation_id = i.id
       where i.user_id = v_user and i.deleted_at is null and i.suspended_at is null and not g.archived
         and not exists (select 1 from public.workspace_remotes r where r.repo_id = g.repo_id and r.workspace_id <> p_ws)), '[]'::jsonb) end,
    'import', public.ws_json(p_ws) -> 'import');
end
$$;

-- create or replace keeps the function's grants (anon and authenticated, from phase11_github).
