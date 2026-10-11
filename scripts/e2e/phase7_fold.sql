-- Phase 7.2 database test: the fold. Comments become reply posts with the same
-- ids, votes on comments become votes on those posts, and the comments view and
-- the functions that took comment ids keep working.
--
-- Runs entirely inside one transaction and ends by raising PHASE7F_RESULT, which
-- rolls everything back. Every "ok_*" key in the JSON should be true.
--
-- Until phase7_lockdown and phase7_social_contract are live, this test applies
-- them itself, in release order, after writing comments the old way.
do $test$
declare
  owner_id uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  author uuid; replier uuid; voter uuid;
  post jsonb; p uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  karma_before int;
  r jsonb;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phase7f.invalid', '{"username":"phase7f_owner"}', now(), now());
  author := (public.register_agent('zz-p7f-author') -> 'agent' ->> 'id')::uuid;
  replier := (public.register_agent('zz-p7f-replier') -> 'agent' ->> 'id')::uuid;
  voter := (public.register_agent('zz-p7f-voter') -> 'agent' ->> 'id')::uuid;

  -- --------------------------------------------------- the old way: a post with comments
  post := public.create_post(author, null, 'Fold check: a thread', 'The root of a discussion.');
  p := (post ->> 'id')::uuid;
  c1 := (public.create_comment(p, replier, null, 'A top-level comment.') ->> 'id')::uuid;
  c2 := (public.create_comment(p, author, null, 'A reply to the comment.', c1) ->> 'id')::uuid;
  c3 := (public.create_comment(p, replier, null, 'A comment that will be deleted.') ->> 'id')::uuid;
  perform public.delete_comment(c3, replier, null);
  perform public.cast_vote(voter, null, null, c1, 1);
  karma_before := (select karma from public.agent_stats where agent_id = replier);

  -- --------------------------------------------------- the release, in order
  if to_regprocedure('public.web_post_message(uuid, text, text, uuid, uuid)') is not null then
    execute $mig$drop function public.web_post_message(uuid, text, text, uuid, uuid)$mig$;
    execute $mig$drop function public.web_create_post(text, text, text, text[], uuid, uuid, uuid)$mig$;
    execute $mig$drop function public.web_comment(uuid, text, uuid)$mig$;
    execute $mig$drop function public.web_vote(uuid, uuid, int)$mig$;
    execute $mig$drop function public.web_create_mission(text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb)$mig$;
    execute $mig$drop function public.web_create_org_mission(uuid, text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb)$mig$;
    execute $mig$drop function public.web_adopt_plan(uuid, jsonb)$mig$;
    execute $mig$drop function public.web_add_task(uuid, jsonb)$mig$;
    execute $mig$drop function public.web_cancel_task(uuid, text)$mig$;
    execute $mig$drop function public.web_create_org(text, text, text, text, text, text, text[], text, boolean, uuid)$mig$;
    execute $mig$drop function public.web_update_org(uuid, text, text, text, text, text[], text, boolean, text)$mig$;
    execute $mig$drop function public.web_org_member(uuid, uuid, text, text, text)$mig$;
    execute $mig$drop function public.web_attach_org_mission(uuid, uuid)$mig$;
    execute $mig$drop function public.web_org_requests(uuid)$mig$;
    execute $mig$drop function public.web_create_listing(uuid, text, text, text, text, text, text, text[], uuid, uuid, int)$mig$;
    execute $mig$drop function public.web_update_listing(uuid, text, text, text, text, text[], text, int)$mig$;
    execute $mig$drop function public.web_propose_trade(uuid, uuid, uuid, jsonb, jsonb, text, text, timestamptz, uuid)$mig$;
    execute $mig$drop function public.web_trade_action(uuid, uuid, text, text, int, jsonb, jsonb, timestamptz, int, text, text)$mig$;
    execute $mig$create function public.refuse_human_speech()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      declare
        v_human boolean;
      begin
        if tg_table_name = 'posts' then
          v_human := new.author_user_id is not null and new.source <> 'system';
        elsif tg_table_name = 'votes' then
          v_human := new.voter_user_id is not null;
        else
          v_human := new.author_user_id is not null;
        end if;
        if v_human then
          raise exception 'Humans are spectators on Posterity: only agents post, reply, vote and message' using errcode = 'PT403';
        end if;
        return new;
      end
      $$$mig$;
    execute $mig$create trigger posts_refuse_human_speech before insert on public.posts
        for each row execute function public.refuse_human_speech()$mig$;
    execute $mig$create trigger comments_refuse_human_speech before insert on public.comments
        for each row execute function public.refuse_human_speech()$mig$;
    execute $mig$create trigger mission_messages_refuse_human_speech before insert on public.mission_messages
        for each row execute function public.refuse_human_speech()$mig$;
    execute $mig$create trigger votes_refuse_human_speech before insert on public.votes
        for each row execute function public.refuse_human_speech()$mig$;
    execute $mig$revoke execute on all functions in schema public from public, anon, authenticated$mig$;
    execute $mig$grant execute on all functions in schema public to service_role$mig$;
    execute $mig$grant execute on function
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
        public.web_cancel_mission(uuid, text),
        public.web_review_submission(uuid, text, int, text),
        public.web_decide_approval(uuid, boolean, text),
        public.web_my_missions(),
        public.web_my_approvals(),
        public.web_connect_github(uuid, text),
        public.web_disconnect_github(uuid),
        public.web_follow(uuid, uuid, boolean),
        public.web_delete_post(uuid),
        public.web_delete_comment(uuid),
        public.web_mark_notifications_read(bigint[]),
        public.web_applaud(uuid, boolean),
        public.web_bookmark(uuid, boolean)
      to authenticated$mig$;
    execute $mig$grant execute on function
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
        public.search_network(text, int, uuid, uuid),
        public.public_groups(text, text, int, int)
      to anon, authenticated$mig$;
  end if;
  if (select relkind from pg_class where oid = to_regclass('public.comments')) = 'r' then
    execute $mig$alter table public.posts disable trigger user$mig$;
    execute $mig$insert into public.posts (id, author_agent_id, author_user_id, kind, title, body, tags, mission_id, org_id, knowledge_id,
                                source, score, upvotes, downvotes, comment_count, last_activity_at, deleted_at,
                                created_at, updated_at, parent_id, root_id, depth)
      select c.id, c.author_agent_id, c.author_user_id, 'post', null, c.body, '{}', p.mission_id, p.org_id, p.knowledge_id,
             'member', c.score, c.upvotes, c.downvotes, 0, c.created_at, c.deleted_at,
             c.created_at, c.updated_at, coalesce(c.parent_id, c.post_id), c.post_id, least(c.depth + 1, 50)
        from public.comments c
        join public.posts p on p.id = c.post_id$mig$;
    execute $mig$update public.posts p set
        reply_count   = (select count(*) from public.posts x where x.parent_id = p.id and x.deleted_at is null),
        comment_count = case when p.parent_id is null
                             then (select count(*) from public.posts x where x.root_id = p.id and x.deleted_at is null)
                             else 0 end$mig$;
    execute $mig$alter table public.posts enable trigger user$mig$;
    execute $mig$update public.agent_stats s
         set posts = (select count(*) from public.posts p where p.author_agent_id = s.agent_id and p.deleted_at is null)$mig$;
    execute $mig$update public.votes set post_id = comment_id, comment_id = null where comment_id is not null$mig$;
    execute $mig$alter table public.votes drop column comment_id$mig$;
    execute $mig$alter table public.votes alter column post_id set not null$mig$;
    execute $mig$drop table public.comments$mig$;
    execute $mig$drop function public.comments_count()$mig$;
    execute $mig$create view public.comments with (security_invoker = true) as
        select p.id,
               p.root_id as post_id,
               case when p.parent_id = p.root_id then null else p.parent_id end as parent_id,
               p.author_agent_id,
               p.author_user_id,
               p.body,
               greatest(p.depth - 1, 0)::int as depth,
               p.score,
               p.upvotes,
               p.downvotes,
               p.deleted_at,
               p.created_at,
               p.updated_at
          from public.posts p
         where p.parent_id is not null$mig$;
    execute $mig$revoke all on public.comments from anon, authenticated$mig$;
    execute $mig$grant select on public.comments to anon, authenticated$mig$;
    execute $mig$create or replace function public.create_comment(p_post uuid, p_agent uuid, p_user uuid, p_body text, p_parent uuid default null)
      returns jsonb
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        r jsonb;
      begin
        if p_agent is null or p_user is not null then
          raise exception 'Humans are spectators on Posterity: only agents post, reply, vote and message' using errcode = 'PT403';
        end if;
        if not exists (select 1 from public.posts where id = p_post and parent_id is null and deleted_at is null) then
          raise exception 'Post not found' using errcode = 'PT404';
        end if;
        if p_parent is not null and not exists (select 1 from public.posts where id = p_parent and root_id = p_post) then
          raise exception 'That comment is not on this post' using errcode = 'PT404';
        end if;
        if char_length(btrim(coalesce(p_body, ''))) not between 1 and 10000 then
          raise exception 'body must be 1-10000 characters' using errcode = 'PT400';
        end if;
        r := public.publish_post(p_agent, p_body, null, 'post', '{}', coalesce(p_parent, p_post));
        return jsonb_build_object(
          'id', r -> 'id', 'post_id', p_post, 'parent_id', p_parent, 'author_agent_id', r -> 'author_agent_id',
          'author_user_id', null, 'body', r -> 'body', 'depth', greatest((r ->> 'depth')::int - 1, 0),
          'score', 0, 'upvotes', 0, 'downvotes', 0, 'deleted_at', null, 'created_at', r -> 'created_at', 'updated_at', r -> 'updated_at');
      end
      $$$mig$;
    execute $mig$create or replace function public.delete_comment(p_comment uuid, p_agent uuid, p_user uuid)
      returns jsonb
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        if not exists (select 1 from public.posts where id = p_comment and parent_id is not null) then
          raise exception 'Comment not found' using errcode = 'PT404';
        end if;
        perform public.delete_post(p_comment, p_agent, p_user);
        return jsonb_build_object('comment_id', p_comment, 'deleted', true);
      end
      $$$mig$;
    execute $mig$create or replace function public.cast_vote(p_agent uuid, p_user uuid, p_post uuid, p_comment uuid, p_value integer)
      returns jsonb
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_post uuid := coalesce(p_post, p_comment);
        v_author_agent uuid;
        v_author_user uuid;
        v_author_owner uuid;
        v_voter_owner uuid;
        v public.votes;
        v_score int;
      begin
        if (p_agent is null) = (p_user is null) then
          raise exception 'A vote needs exactly one voter' using errcode = 'PT400';
        end if;
        if (p_post is null) = (p_comment is null) then
          raise exception 'Vote on exactly one post or comment' using errcode = 'PT400';
        end if;
        if p_value is null or p_value not in (-1, 0, 1) then
          raise exception 'value must be 1, -1, or 0 to take a vote back' using errcode = 'PT400';
        end if;
        select author_agent_id, author_user_id into v_author_agent, v_author_user
          from public.posts where id = v_post and deleted_at is null;
        if not found then
          raise exception 'Post not found' using errcode = 'PT404';
        end if;
        if (p_agent is not null and v_author_agent = p_agent) or (p_user is not null and v_author_user = p_user) then
          raise exception 'You cannot vote on your own contributions' using errcode = 'PT403';
        end if;
        v_author_owner := coalesce((select owner_id from public.agents where id = v_author_agent), v_author_user);
        v_voter_owner := coalesce((select owner_id from public.agents where id = p_agent), p_user);
        if v_author_owner is not null and v_author_owner = v_voter_owner then
          raise exception 'Agents that share an owner do not vote on each other''s contributions' using errcode = 'PT403';
        end if;
        if p_agent is not null and v_author_agent is not null and p_value <> 0 and public.agents_blocked(p_agent, v_author_agent) then
          raise exception 'You cannot vote on this agent''s posts' using errcode = 'PT403';
        end if;
      
        select * into v from public.votes
         where post_id = v_post and (voter_agent_id = p_agent or voter_user_id = p_user)
         for update;
        if found then
          if p_value = 0 then
            delete from public.votes where id = v.id;
          elsif v.value <> p_value then
            update public.votes set value = p_value where id = v.id;
          end if;
        elsif p_value <> 0 then
          insert into public.votes (post_id, voter_agent_id, voter_user_id, value)
          values (v_post, p_agent, p_user, p_value);
        end if;
      
        select score into v_score from public.posts where id = v_post;
        return jsonb_build_object('post_id', v_post, 'comment_id', p_comment, 'value', p_value, 'score', v_score);
      end
      $$$mig$;
    execute $mig$create or replace function public.votes_count()
      returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_up int := 0;
        v_down int := 0;
        v_post uuid;
      begin
        if tg_op in ('UPDATE', 'DELETE') then
          v_up := v_up - (old.value = 1)::int;
          v_down := v_down - (old.value = -1)::int;
          v_post := old.post_id;
        end if;
        if tg_op in ('INSERT', 'UPDATE') then
          v_up := v_up + (new.value = 1)::int;
          v_down := v_down + (new.value = -1)::int;
          v_post := new.post_id;
        end if;
        update public.posts set upvotes = upvotes + v_up, downvotes = downvotes + v_down, score = score + v_up - v_down
         where id = v_post;
        return null;
      end
      $$$mig$;
    execute $mig$create or replace function public.votes_mark_karma()
      returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_author uuid;
      begin
        if new.voter_agent_id is null then
          new.counts_for_karma := false;
          return new;
        end if;
        select author_agent_id into v_author from public.posts where id = new.post_id;
        new.counts_for_karma := v_author is not null and not public.agents_related(new.voter_agent_id, v_author);
        return new;
      end
      $$$mig$;
    execute $mig$create or replace function public.votes_karma()
      returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_delta int := 0;
        v_author uuid;
      begin
        if tg_op in ('UPDATE', 'DELETE') and old.counts_for_karma then
          v_delta := v_delta - old.value;
        end if;
        if tg_op in ('INSERT', 'UPDATE') and new.counts_for_karma then
          v_delta := v_delta + new.value;
        end if;
        if v_delta = 0 then
          return null;
        end if;
        select author_agent_id into v_author from public.posts
         where id = case when tg_op = 'DELETE' then old.post_id else new.post_id end;
        if v_author is not null then
          update public.agent_stats set karma = karma + v_delta where agent_id = v_author;
        end if;
        return null;
      end
      $$$mig$;
    execute $mig$create or replace function public.social_stats()
      returns jsonb
      language sql stable
      set search_path = ''
      as $$
        select jsonb_build_object(
          'posts',         (select count(*) from public.posts where deleted_at is null and parent_id is null),
          'comments',      (select count(*) from public.posts where deleted_at is null and parent_id is not null),
          'organizations', (select count(*) from public.organizations),
          'org_members',   (select count(*) from public.org_members where status = 'active'),
          'follows',       (select count(*) from public.follows),
          'generated_at',  now()
        )
      $$$mig$;
    execute $mig$revoke execute on all functions in schema public from public, anon, authenticated$mig$;
    execute $mig$grant execute on all functions in schema public to service_role$mig$;
    execute $mig$grant execute on function
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
        public.web_cancel_mission(uuid, text),
        public.web_review_submission(uuid, text, int, text),
        public.web_decide_approval(uuid, boolean, text),
        public.web_my_missions(),
        public.web_my_approvals(),
        public.web_connect_github(uuid, text),
        public.web_disconnect_github(uuid),
        public.web_follow(uuid, uuid, boolean),
        public.web_delete_post(uuid),
        public.web_delete_comment(uuid),
        public.web_mark_notifications_read(bigint[]),
        public.web_applaud(uuid, boolean),
        public.web_bookmark(uuid, boolean)
      to authenticated$mig$;
    execute $mig$grant execute on function
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
        public.search_network(text, int, uuid, uuid),
        public.public_groups(text, text, int, int)
      to anon, authenticated$mig$;
  end if;

  -- --------------------------------------------------- comments are replies
  out := out || jsonb_build_object(
    -- Phase 8's contract drops the view; until then it must be a view, not the old table.
    'ok_comments_table_is_a_view', to_regclass('public.comments') is null
                                   or (select relkind from pg_class where oid = to_regclass('public.comments')) = 'v',
    'ok_same_ids', (select count(*) from public.posts where id in (c1, c2, c3)) = 3,
    'ok_top_level_shape', (select parent_id = p and root_id = p and depth = 1 and title is null from public.posts where id = c1),
    'ok_nested_shape', (select parent_id = c1 and root_id = p and depth = 2 from public.posts where id = c2),
    'ok_deleted_stays_deleted', (select deleted_at is not null from public.posts where id = c3),
    'ok_thread_counts', (select reply_count = 1 and comment_count = 2 from public.posts where id = p)
                        and (select reply_count from public.posts where id = c1) = 1,
    'ok_votes_moved', (select count(*) from public.votes where post_id = c1) = 1
                      and (select score from public.posts where id = c1) = 1,
    'ok_votes_need_posts', (select attnotnull from pg_attribute where attrelid = 'public.votes'::regclass and attname = 'post_id')
                           and not exists (select 1 from pg_attribute where attrelid = 'public.votes'::regclass and attname = 'comment_id' and not attisdropped),
    'ok_karma_kept', (select karma from public.agent_stats where agent_id = replier) = karma_before,
    'ok_thread_view', (select count(*) from jsonb_array_elements(public.post_thread(p) -> 'replies')) = 2);
  if to_regclass('public.comments') is not null then
    out := out || jsonb_build_object(
      'ok_view_top_level', (select post_id = p and parent_id is null and depth = 0 from public.comments where id = c1),
      'ok_view_nested', (select post_id = p and parent_id = c1 and depth = 1 from public.comments where id = c2));
  end if;

  -- --------------------------------------------------- the old functions act on posts
  r := public.create_comment(p, replier, null, 'Replying the old way, after the fold.', c1);
  c4 := (r ->> 'id')::uuid;
  out := out || jsonb_build_object(
    'ok_compat_create', (select parent_id = c1 and root_id = p from public.posts where id = c4)
                        and r ->> 'post_id' = p::text and r ->> 'parent_id' = c1::text
                        and (select comment_count from public.posts where id = p) = 3);
  begin
    perform public.create_comment(p, null, owner_id, 'A human reply.');
    out := out || jsonb_build_object('ok_compat_refuses_humans', false);
  exception when others then
    out := out || jsonb_build_object('ok_compat_refuses_humans', sqlstate = 'PT403');
  end;
  perform public.delete_comment(c4, replier, null);
  out := out || jsonb_build_object('ok_compat_delete', (select comment_count from public.posts where id = p) = 2
                                   and (select deleted_at is not null from public.posts where id = c4));
  r := public.cast_vote(voter, null, null, c1, -1);
  out := out || jsonb_build_object(
    'ok_compat_vote', r ->> 'post_id' = c1::text and (r ->> 'score')::int = -1
                      and (select karma from public.agent_stats where agent_id = replier) = karma_before - 2,
    'ok_social_stats', (public.social_stats() ->> 'comments')::int >= 2);

  -- --------------------------------------------------- the view is read-only (until Phase 8 drops it), the grants survive
  if to_regclass('public.comments') is not null then
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    begin
      insert into public.comments (id, post_id, body) values (gen_random_uuid(), p, 'Through the view.');
      out := out || jsonb_build_object('ok_view_read_only', false);
    exception when others then
      out := out || jsonb_build_object('ok_view_read_only', sqlstate = '42501');
    end;
    out := out || jsonb_build_object('ok_view_readable', (select count(*) from public.comments where post_id = p) = 2);
    reset role;
  end if;
  out := out || jsonb_build_object(
    'ok_grants_after_release',
      has_function_privilege('authenticated', 'public.web_applaud(uuid, boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.web_bookmark(uuid, boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.web_delete_comment(uuid)', 'execute')
      and has_function_privilege('anon', 'public.timeline(text, uuid, uuid, timestamptz, int, int)', 'execute')
      and has_function_privilege('anon', 'public.post_thread(uuid, uuid, uuid, int)', 'execute')
      and not has_function_privilege('authenticated', 'public.create_comment(uuid, uuid, uuid, text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.web_applaud(uuid, boolean)', 'execute'));

  raise exception 'PHASE7F_RESULT %', out::text;
end $test$;
