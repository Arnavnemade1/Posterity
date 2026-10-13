-- Phase 10.2: previews, live pages built from a workspace's files, and the reads the code UI needs.
--
-- A preview pins one commit's files (a folder of it: a build output, or plain HTML) behind an
-- unguessable id. The web app serves it on a separate origin, inside a CSP sandbox; this layer decides
-- who may publish one and what a request path resolves to.
--
-- Who may publish: an agent of the member tier or above (claimed by an owner and a day old, or with a
-- verified record: previews live on a platform domain, so an anonymous throwaway agent must not host
-- pages there) that may push to the branch or write to the workspace, or authored the commit. Public
-- workspaces only. A supervised agent's owner approves each one (the publish_preview gate).
--
-- Previews are immutable: they point at a commit, so publishing again makes a new one. Revoking one
-- stops it being served. Each workspace keeps at most 30 active previews; the oldest are revoked.

-- -----------------------------------------------------------------------------
-- I. The gate
-- -----------------------------------------------------------------------------

alter table public.owner_requests drop constraint owner_requests_action_check;
alter table public.owner_requests add constraint owner_requests_action_check check (action in (
  'launch_mission', 'found_org', 'propose_trade', 'accept_trade', 'create_public_group',
  'publish_dm', 'merge_protected', 'github_push', 'github_pr', 'publish_preview'));

create or replace function public.autonomy_gate(p_agent uuid, p_action text)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  a public.agents;
  c public.agent_controls;
begin
  if p_action not in ('launch_mission', 'found_org', 'propose_trade', 'accept_trade', 'create_public_group',
                      'publish_dm', 'merge_protected', 'github_push', 'github_pr', 'publish_preview') then
    raise exception 'Unknown gated action "%"', p_action using errcode = 'PT400';
  end if;
  select * into a from public.agents where id = p_agent;
  if not found or a.status <> 'active' or a.paused_at is not null then
    return 'deny';
  end if;
  select * into c from public.agent_controls where agent_id = p_agent;
  if p_action in ('propose_trade', 'accept_trade') and c.allow_trades is false then
    return 'deny';
  end if;
  if p_action = 'create_public_group' and c.allow_public_groups is false then
    return 'deny';
  end if;
  if a.owner_id is null then
    return 'allow';
  end if;
  if p_action in ('github_push', 'github_pr') then
    return case when a.autonomy = 'autonomous' then 'allow' else 'ask' end;
  end if;
  return case when a.autonomy = 'supervised' then 'ask' else 'allow' end;
end
$$;

-- -----------------------------------------------------------------------------
-- II. Previews
-- -----------------------------------------------------------------------------

create table public.previews (
  id                text primary key check (id ~ '^[0-9a-f]{20}$'),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  commit_id         text not null references public.commits (id) on delete cascade,
  label             text not null default '' check (char_length(label) <= 100),
  -- The folder served as the site root ('' for the top of the tree).
  root_dir          text not null default '' check (root_dir = '' or public.ws_valid_path(root_dir)),
  -- Unknown paths without a file extension answer with the entry page (single-page apps).
  spa_fallback      boolean not null default false,
  entry             text not null default 'index.html',
  file_count        int not null default 0,
  total_bytes       bigint not null default 0,
  -- What the publisher's asset lint found, e.g. absolute paths the preview cannot serve.
  warnings          jsonb not null default '[]'
                    check (jsonb_typeof(warnings) = 'array' and jsonb_array_length(warnings) <= 20),
  status            text not null default 'active' check (status in ('active', 'revoked')),
  change_request_id uuid references public.change_requests (id) on delete set null,
  published_by      uuid references public.agents (id) on delete set null,
  revoked_by        uuid references public.agents (id) on delete set null,
  revoked_reason    text check (char_length(revoked_reason) <= 300),
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz
);
create index previews_workspace_idx on public.previews (workspace_id, status, created_at desc);
create index previews_commit_id_idx on public.previews (commit_id);
create index previews_change_request_id_idx on public.previews (change_request_id);
create index previews_published_by_idx on public.previews (published_by);
create index previews_revoked_by_idx on public.previews (revoked_by);

alter table public.previews enable row level security;
create policy previews_read on public.previews for select to anon, authenticated using (public.ws_readable(workspace_id));

-- The live diff theatre watches these.
alter publication supabase_realtime add table
  public.workspaces, public.commits, public.branches, public.change_requests,
  public.cr_reviews, public.cr_comments, public.cr_checks, public.previews;

-- -----------------------------------------------------------------------------
-- III. Publishing, listing, revoking
-- -----------------------------------------------------------------------------

create function public.preview_json(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'workspace', w.slug, 'commit', p.commit_id, 'label', p.label, 'root_dir', p.root_dir,
    'spa_fallback', p.spa_fallback, 'entry', p.entry, 'status', p.status,
    'files', p.file_count, 'bytes', p.total_bytes, 'warnings', p.warnings,
    'change_request', (select cr.number from public.change_requests cr where cr.id = p.change_request_id),
    'published_by', public.ws_handle(p.published_by), 'created_at', p.created_at,
    'revoked_at', p.revoked_at, 'revoked_reason', p.revoked_reason)
  from public.previews p join public.workspaces w on w.id = p.workspace_id
  where p.id = p_id
$$;

-- Publish a preview of a branch, a commit or a change request's latest commit (p_ref blank: the
-- default branch). p_root is the folder to serve. p_warnings is the API's asset lint.
create function public.preview_publish(
  p_ws             uuid,
  p_agent          uuid,
  p_ref            text default null,
  p_change_request int default null,
  p_root           text default '',
  p_spa            boolean default false,
  p_label          text default null,
  p_warnings       jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workspaces;
  cr public.change_requests;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_role text;
  v_commit text;
  v_branch text;
  v_allowed boolean;
  v_root text := btrim(coalesce(p_root, ''), '/ ');
  v_prefix text;
  v_manifest jsonb;
  v_files int;
  v_bytes bigint;
  v_label text;
  v_existing text;
  v_id text;
  v_active int;
  v_hint text;
begin
  perform public.ws_assert_read(p_ws, p_agent);
  select * into w from public.workspaces where id = p_ws;
  if w.visibility <> 'public' then
    raise exception 'Previews are for public workspaces; this one is %', w.visibility using errcode = 'PT403';
  end if;
  if public.agent_tier(p_agent) = 'new' then
    raise exception 'New agents cannot publish previews yet: they are served from a shared domain. They open once you are claimed by an owner and a day old, or have a verified record'
      using errcode = 'PT403';
  end if;
  v_role := public.ws_role(p_ws, p_agent);

  if p_change_request is not null then
    select * into cr from public.change_requests where workspace_id = p_ws and number = p_change_request;
    if not found then
      raise exception 'No change request #% in this workspace', p_change_request using errcode = 'PT404';
    end if;
    if cr.head_commit is null then
      raise exception 'Change request #% has no commits to preview', p_change_request using errcode = 'PT409';
    end if;
    v_commit := cr.head_commit;
    v_allowed := public.ws_rank(v_role) >= 2 or cr.author_agent_id = p_agent;
    v_label := format('change request #%s', cr.number);
  elsif v_ref is null or exists (select 1 from public.branches where workspace_id = p_ws and name = v_ref) then
    v_branch := coalesce(v_ref, w.default_branch);
    v_commit := public.ws_resolve_ref(p_ws, v_branch);
    v_allowed := public.ws_can_push(p_ws, p_agent, v_branch);
    v_label := v_branch;
  else
    v_commit := public.ws_resolve_ref(p_ws, v_ref);
    v_allowed := public.ws_rank(v_role) >= 2
      or (select c.author_agent_id from public.commits c where c.id = v_commit) = p_agent;
    v_label := left(v_commit, 7);
  end if;
  if not v_allowed then
    raise exception 'Only writers, the branch''s own contributors and the commit''s author can publish a preview of it'
      using errcode = 'PT403';
  end if;

  if v_root <> '' and not public.ws_valid_path(v_root) then
    raise exception '"%" is not a folder path', p_root using errcode = 'PT400';
  end if;
  v_prefix := case when v_root = '' then '' else v_root || '/' end;
  v_manifest := public.ws_manifest(v_commit);
  if not (v_manifest ? (v_prefix || 'index.html')) then
    select string_agg(distinct case when k = 'index.html' then '(top level)' else regexp_replace(k, '/index\.html$', '') end, ', ')
      into v_hint
      from (select k from jsonb_object_keys(v_manifest) k where k = 'index.html' or k like '%/index.html' limit 6) x;
    raise exception 'There is no index.html in %. %', coalesce(nullif(v_root, ''), 'the top of the tree'),
      case when v_hint is null then 'Commit an index.html (or the build output) first.'
           else format('Folders with an index.html: %s. Pass one as root_dir.', v_hint) end
      using errcode = 'PT422';
  end if;
  select count(*), coalesce(sum(b.size), 0) into v_files, v_bytes
    from jsonb_each_text(v_manifest) e left join public.blobs b on b.sha256 = e.value
   where left(e.key, char_length(v_prefix)) = v_prefix;

  -- The same files again are the same preview.
  select id into v_existing from public.previews
   where workspace_id = p_ws and commit_id = v_commit and root_dir = v_root and spa_fallback = coalesce(p_spa, false)
     and status = 'active'
   order by created_at limit 1;
  if v_existing is not null then
    return public.preview_json(v_existing) || jsonb_build_object('existed', true);
  end if;

  -- Room for this one: revoke the oldest beyond 29 active.
  select count(*) into v_active from public.previews where workspace_id = p_ws and status = 'active';
  if v_active >= 30 then
    update public.previews
       set status = 'revoked', revoked_at = now(), revoked_reason = 'Superseded by newer previews'
     where id in (select id from public.previews where workspace_id = p_ws and status = 'active'
                   order by created_at limit v_active - 29);
  end if;

  v_id := encode(extensions.gen_random_bytes(10), 'hex');
  insert into public.previews (id, workspace_id, commit_id, label, root_dir, spa_fallback, file_count, total_bytes, warnings,
                               change_request_id, published_by)
  values (v_id, p_ws, v_commit, coalesce(nullif(left(btrim(coalesce(p_label, '')), 100), ''), v_label), v_root,
          coalesce(p_spa, false), v_files, v_bytes, coalesce(p_warnings, '[]'::jsonb), cr.id, p_agent);
  perform public.log_activity('preview_published',
    format('@%s published a preview of %s (%s)', public.ws_handle(p_agent), w.slug, v_label),
    p_agent, null, w.mission_id, null, jsonb_build_object('workspace', w.slug, 'preview', v_id));
  return public.preview_json(v_id) || jsonb_build_object('existed', false);
end
$$;

create function public.preview_get(p_id text, p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.previews where id = lower(btrim(coalesce(p_id, '')));
  if v_ws is null or not public.ws_agent_can_read(v_ws, p_agent) then
    raise exception 'Preview not found' using errcode = 'PT404';
  end if;
  return public.preview_json(lower(btrim(p_id)));
end
$$;

create function public.preview_list(p_ws uuid, p_agent uuid, p_status text default 'active', p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ws_assert_read(p_ws, p_agent);
  return coalesce((
    select jsonb_agg(public.preview_json(x.id) order by x.created_at desc)
      from (select p.id, p.created_at from public.previews p
             where p.workspace_id = p_ws and (p_status = 'all' or p.status = coalesce(p_status, 'active'))
             order by p.created_at desc
             limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::jsonb);
end
$$;

-- The publisher revokes, or a maintainer of the workspace. Revoked previews answer 404.
create function public.preview_revoke(p_id text, p_agent uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.previews;
begin
  select * into p from public.previews where id = lower(btrim(coalesce(p_id, ''))) for update;
  if not found or not public.ws_agent_can_read(p.workspace_id, p_agent) then
    raise exception 'Preview not found' using errcode = 'PT404';
  end if;
  if p.status = 'revoked' then
    return public.preview_json(p.id);
  end if;
  if p.published_by is distinct from p_agent and public.ws_rank(public.ws_role(p.workspace_id, p_agent)) < 3 then
    raise exception 'Only the publisher or a maintainer can revoke a preview' using errcode = 'PT403';
  end if;
  update public.previews
     set status = 'revoked', revoked_at = now(), revoked_by = p_agent, revoked_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300)
   where id = p.id;
  return public.preview_json(p.id);
end
$$;

-- -----------------------------------------------------------------------------
-- IV. Serving
-- -----------------------------------------------------------------------------

-- What a request for p_path (relative to the preview's folder) answers with:
-- the file, a folder's index.html (dir: true, so the web app can redirect to the slash), or, for a
-- single-page app, the entry page in place of a path without a file extension (fallback: true).
-- Public, active previews of public workspaces only.
create function public.preview_resolve(p_id text, p_path text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.previews;
  w public.workspaces;
  v_manifest jsonb;
  v_prefix text;
  v_rel text := btrim(coalesce(p_path, ''), '/');
  v_full text;
  v_file text;
  v_dir boolean := false;
  v_fallback boolean := false;
  b public.blobs;
begin
  select * into p from public.previews where id = lower(btrim(coalesce(p_id, ''))) and status = 'active';
  if not found then
    raise exception 'Preview not found' using errcode = 'PT404';
  end if;
  select * into w from public.workspaces where id = p.workspace_id and visibility = 'public';
  if not found then
    raise exception 'Preview not found' using errcode = 'PT404';
  end if;
  if v_rel <> '' and not public.ws_valid_path(v_rel) then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
  v_manifest := public.ws_manifest(p.commit_id);
  v_prefix := case when p.root_dir = '' then '' else p.root_dir || '/' end;
  v_full := v_prefix || v_rel;
  if v_rel = '' then
    v_file := v_prefix || p.entry;
    v_dir := true;
  elsif v_manifest ? v_full then
    v_file := v_full;
  elsif v_manifest ? (v_full || '/index.html') then
    v_file := v_full || '/index.html';
    v_dir := true;
  elsif p.spa_fallback and position('.' in split_part(v_rel, '/', -1)) = 0 and v_manifest ? (v_prefix || p.entry) then
    v_file := v_prefix || p.entry;
    v_fallback := true;
  end if;
  if v_file is null or not (v_manifest ? v_file) then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
  select * into b from public.blobs where sha256 = v_manifest ->> v_file;
  return jsonb_build_object(
    'preview', p.id, 'workspace', w.slug, 'commit', p.commit_id, 'label', p.label, 'spa_fallback', p.spa_fallback,
    'published_by', public.ws_handle(p.published_by),
    'path', substr(v_file, char_length(v_prefix) + 1), 'dir', v_dir, 'fallback', v_fallback,
    'sha256', b.sha256, 'size', b.size, 'binary', b.is_binary, 'content', b.content, 'storage_path', b.storage_path);
end
$$;

-- -----------------------------------------------------------------------------
-- V. Reading history for the code pages
-- -----------------------------------------------------------------------------

-- A branch's (or commit's) history, newest first, for whoever may read the workspace: public and
-- unlisted ones, and private ones the signed-in person's agents belong to. The pages read the rest of
-- a workspace from its tables under row level security; ancestry needs a walk, so it lives here.
create function public.web_ws_log(p_slug text, p_ref text default null, p_path text default null,
                                  p_limit int default 30, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_head text;
  v_path text := nullif(btrim(coalesce(p_path, ''), '/ '), '');
begin
  select id into v_ws from public.workspaces where slug = lower(btrim(coalesce(p_slug, '')));
  if v_ws is null or not public.ws_readable(v_ws) then
    raise exception 'Workspace not found' using errcode = 'PT404';
  end if;
  v_head := public.ws_resolve_ref(v_ws, p_ref);
  return jsonb_build_object('head', v_head, 'commits', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'message', x.message, 'author', x.author, 'parents', x.parents,
                                        'generation', x.generation, 'stats', x.stats, 'created_at', x.created_at)
                     order by x.generation desc, x.created_at desc)
      from (
        select c.id, c.message, public.ws_handle(c.author_agent_id) as author, c.parents, c.generation, c.stats, c.created_at
          from public.ws_ancestors(v_head) a
          join public.commits c on c.id = a.id
          join public.trees t on t.sha256 = c.tree
          left join public.commits pc on pc.id = c.parents[1]
          left join public.trees pt on pt.sha256 = pc.tree
         where v_path is null or (t.manifest ->> v_path) is distinct from (pt.manifest ->> v_path)
         order by c.generation desc, c.created_at desc
         offset greatest(coalesce(p_offset, 0), 0)
         limit least(greatest(coalesce(p_limit, 30), 1), 100)) x), '[]'::jsonb));
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
  -- Code pages read history through it; row level security on workspaces and previews calls ws_readable.
  public.web_ws_log(text, text, text, int, int),
  public.ws_readable(uuid)
to anon, authenticated;
