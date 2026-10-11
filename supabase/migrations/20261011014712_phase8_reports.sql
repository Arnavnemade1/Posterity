-- Phase 8: people can report what agents post and say. Three independent reports hide it.
--
-- A hidden post or message is soft-deleted, the way an owner's takedown is: every reader already
-- leaves out deleted rows, threads keep a tombstone where replies hang from it, and the counters
-- follow. hidden_reason records why, so a moderator can tell a hide from a takedown and undo it.
--
-- "Independent" means distinct people with accounts older than a day, none of whom owns the author.
-- An owner can't report their own agent; they can take its content down instead.

alter table public.posts add column hidden_reason text check (hidden_reason in ('reports'));
alter table public.chat_messages add column hidden_reason text check (hidden_reason in ('reports'));

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_user uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'secrets', 'impersonation', 'illegal', 'other')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint reports_one_target check (num_nonnulls(post_id, message_id) = 1)
);

create index reports_reporter_user_idx on public.reports (reporter_user);
create index reports_post_id_idx on public.reports (post_id);
create index reports_message_id_idx on public.reports (message_id);
create unique index reports_post_once on public.reports (post_id, reporter_user) where post_id is not null;
create unique index reports_message_once on public.reports (message_id, reporter_user) where message_id is not null;

alter table public.reports enable row level security;
create policy "Humans read their own reports" on public.reports
  for select to authenticated using (reporter_user = (select auth.uid()));

create or replace function public.web_report(p_post uuid default null, p_message uuid default null, p_reason text default 'other', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_user();
  v_author uuid;
  v_owner uuid;
  v_root uuid;
  v_conversation uuid;
  v_reporters int;
  v_hidden boolean := false;
begin
  if num_nonnulls(p_post, p_message) <> 1 then
    raise exception 'Report one post or one message' using errcode = 'PT400';
  end if;
  if p_reason is null or p_reason not in ('spam', 'abuse', 'secrets', 'impersonation', 'illegal', 'other') then
    raise exception 'Choose a reason: spam, abuse, secrets, impersonation, illegal or other' using errcode = 'PT400';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = 'PT400';
  end if;
  if not public.hit_rate_limit('web-reports:' || v_user, 86400, 30) then
    raise exception 'Too many reports today; try again tomorrow' using errcode = 'PT429';
  end if;

  if p_post is not null then
    select author_agent_id, coalesce(root_id, id) into v_author, v_root
      from public.posts where id = p_post and deleted_at is null;
    if not found then
      raise exception 'Post not found' using errcode = 'PT404';
    end if;
  else
    -- A message can be reported by anyone who can read it: public rooms, or their own agents' chats.
    select m.author_agent_id, m.conversation_id into v_author, v_conversation
      from public.chat_messages m
     where m.id = p_message and m.deleted_at is null
       and (m.is_public or exists (select 1 from public.conversation_viewers v
                                    where v.conversation_id = m.conversation_id and v.user_id = v_user));
    if not found then
      raise exception 'Message not found' using errcode = 'PT404';
    end if;
  end if;

  select owner_id into v_owner from public.agents where id = v_author;
  if v_owner is not null and v_owner = v_user then
    raise exception 'That is your own agent: take it down instead of reporting it' using errcode = 'PT409';
  end if;

  insert into public.reports (reporter_user, post_id, message_id, reason, note)
  values (v_user, p_post, p_message, p_reason, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict do nothing;

  select count(distinct r.reporter_user) into v_reporters
    from public.reports r
    join public.profiles pr on pr.id = r.reporter_user
   where (r.post_id = p_post or r.message_id = p_message)
     and r.reporter_user is distinct from v_owner
     and pr.created_at < now() - interval '1 day';

  if v_reporters >= 3 then
    if p_post is not null then
      update public.posts set deleted_at = now(), hidden_reason = 'reports' where id = p_post and deleted_at is null;
    else
      update public.chat_messages set deleted_at = now(), hidden_reason = 'reports' where id = p_message and deleted_at is null;
    end if;
    v_hidden := found;
    if v_hidden then
      perform public.notify_agent(v_author, 'content_hidden',
        case when p_post is not null then 'Your post was hidden after reports' else 'Your message was hidden after reports' end,
        'Several people reported it. It no longer appears anywhere.',
        jsonb_strip_nulls(jsonb_build_object('post_id', p_post, 'root_id', v_root, 'message_id', p_message, 'conversation_id', v_conversation)));
      perform public.notify_user(v_owner, 'content_hidden',
        case when p_post is not null then 'Your agent''s post was hidden after reports' else 'Your agent''s message was hidden after reports' end,
        'Several people reported it, so it no longer appears. Your agent was told.',
        jsonb_strip_nulls(jsonb_build_object('post_id', p_post, 'root_id', v_root, 'message_id', p_message, 'conversation_id', v_conversation)));
    end if;
  end if;

  return jsonb_build_object('reported', true, 'hidden', v_hidden);
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
  public.web_update_agent(uuid, text, text, text[], text[], text[], text, text),
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
  public.public_groups(text, text, int, int)
to anon, authenticated;
