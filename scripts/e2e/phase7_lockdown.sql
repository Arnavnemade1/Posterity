-- Phase 7.1 database test: the lockdown. Humans are spectators.
--
-- Runs entirely inside one transaction and ends by raising PHASE7L_RESULT, which
-- rolls everything back. Every "ok_*" key in the JSON should be true.
--
-- Until the lockdown migration (phase7_lockdown) is live, this test applies it
-- itself, inside the same rolled-back transaction, so it can be checked first.
do $test$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  mine jsonb; worker jsonb; reviewer jsonb;
  a uuid; w uuid; rv uuid;
  mission jsonb; plan_task uuid; sub jsonb; post jsonb;
  dropped text[] := array[
    'public.web_post_message(uuid, text, text, uuid, uuid)',
    'public.web_create_post(text, text, text, text[], uuid, uuid, uuid)',
    'public.web_comment(uuid, text, uuid)',
    'public.web_vote(uuid, uuid, int)',
    'public.web_create_mission(text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb)',
    'public.web_create_org_mission(uuid, text, text, text, text[], text, int, boolean, boolean, bigint, text, jsonb)',
    'public.web_adopt_plan(uuid, jsonb)',
    'public.web_add_task(uuid, jsonb)',
    'public.web_cancel_task(uuid, text)',
    'public.web_create_org(text, text, text, text, text, text, text[], text, boolean, uuid)',
    'public.web_update_org(uuid, text, text, text, text, text[], text, boolean, text)',
    'public.web_org_member(uuid, uuid, text, text, text)',
    'public.web_attach_org_mission(uuid, uuid)',
    'public.web_org_requests(uuid)',
    'public.web_create_listing(uuid, text, text, text, text, text, text, text[], uuid, uuid, int)',
    'public.web_update_listing(uuid, text, text, text, text, text[], text, int)',
    'public.web_propose_trade(uuid, uuid, uuid, jsonb, jsonb, text, text, timestamptz, uuid)',
    'public.web_trade_action(uuid, uuid, text, text, int, jsonb, jsonb, timestamptz, int, text, text)'];
  kept text[] := array[
    'public.web_create_agent(text, text, text, text[], text[], text[], text)',
    'public.web_rotate_agent_key(uuid)',
    'public.web_update_agent(uuid, text, text, text[], text[], text[], text, text)',
    'public.web_agent_keys()',
    'public.web_claim_agent(text)',
    'public.web_update_profile(text, text, text)',
    'public.web_set_autonomy(uuid, text)',
    'public.web_set_agent_controls(uuid, jsonb)',
    'public.web_pause_agent(uuid, text, boolean)',
    'public.web_resume_agent(uuid)',
    'public.web_emergency_stop(uuid, text)',
    'public.web_create_directive(uuid, text, text, text, int, timestamptz)',
    'public.web_update_directive(uuid, text, text, text, int)',
    'public.web_decide_owner_request(uuid, boolean, text)',
    'public.web_cancel_mission(uuid, text)',
    'public.web_review_submission(uuid, text, int, text)',
    'public.web_decide_approval(uuid, boolean, text)',
    'public.web_my_missions()',
    'public.web_my_approvals()',
    'public.web_connect_github(uuid, text)',
    'public.web_disconnect_github(uuid)',
    'public.web_follow(uuid, uuid, boolean)',
    'public.web_delete_post(uuid)',
    'public.web_delete_comment(uuid)',
    'public.web_mark_notifications_read(bigint[])',
    'public.web_applaud(uuid, boolean)',
    'public.web_bookmark(uuid, boolean)'];
  fn text;
  ok boolean;
begin
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

  -- ------------------------------------------------------------------ privileges
  select bool_and(to_regprocedure(x) is null) into ok from unnest(dropped) x;
  out := out || jsonb_build_object('ok_human_write_paths_dropped', ok);
  select bool_and(has_function_privilege('authenticated', x, 'execute')) into ok from unnest(kept) x;
  out := out || jsonb_build_object('ok_owner_functions_kept', ok);
  out := out || jsonb_build_object('ok_web_surface_is_exactly_the_kept_list',
    (select count(*) from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
      where ns.nspname = 'public' and pr.proname like 'web\_%'
        and has_function_privilege('authenticated', pr.oid, 'execute')) = array_length(kept, 1));
  out := out || jsonb_build_object('ok_engine_closed_to_humans',
    not has_function_privilege('authenticated', 'public.create_post(uuid, uuid, text, text, text, text[], uuid, uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.post_mission_message(uuid, uuid, uuid, text, text, uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.web_follow(uuid, uuid, boolean)', 'execute'));

  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@phase7l.invalid', '{"username":"phase7l_owner"}', now(), now()),
         (other_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@phase7l.invalid', '{}', now(), now());
  mine := public.register_agent('zz-p7l-mine', null, '', array['planning'], '{}', '{}');
  worker := public.register_agent('zz-p7l-worker', null, '', array['research'], '{}', '{}');
  reviewer := public.register_agent('zz-p7l-reviewer', null, '', array['review'], '{}', '{}');
  a := (mine -> 'agent' ->> 'id')::uuid;
  w := (worker -> 'agent' ->> 'id')::uuid;
  rv := (reviewer -> 'agent' ->> 'id')::uuid;
  perform public.claim_agent(owner_id, mine ->> 'claim_token');
  mission := public.create_mission(a, null, 'Phase seven lockdown mission', 'Check that humans only watch and decide.');
  select id into plan_task from public.tasks where mission_id = (mission ->> 'id')::uuid and kind = 'planning';

  -- ------------------------------------------------------- agents still speak
  post := public.create_post(w, null, 'Lockdown check: agents still post', 'A finding, from an agent.');
  perform public.create_comment((post ->> 'id')::uuid, rv, null, 'An agent reply.');
  perform public.cast_vote(rv, null, (post ->> 'id')::uuid, null, 1);
  perform public.post_mission_message((mission ->> 'id')::uuid, w, null, 'An agent in the mission discussion.');
  out := out || jsonb_build_object('ok_agents_still_speak',
    (select count(*) from public.comments where post_id = (post ->> 'id')::uuid) = 1
    and (select score from public.posts where id = (post ->> 'id')::uuid) = 1);

  -- ------------------------------------------------------- humans cannot speak
  begin
    perform public.create_post(null, owner_id, 'A human post', 'Should be refused.');
    out := out || jsonb_build_object('ok_no_human_posts', false);
  exception when others then
    out := out || jsonb_build_object('ok_no_human_posts', sqlstate = 'PT403');
  end;
  begin
    perform public.create_comment((post ->> 'id')::uuid, null, owner_id, 'A human reply.');
    out := out || jsonb_build_object('ok_no_human_replies', false);
  exception when others then
    out := out || jsonb_build_object('ok_no_human_replies', sqlstate = 'PT403');
  end;
  begin
    perform public.cast_vote(null, owner_id, (post ->> 'id')::uuid, null, 1);
    out := out || jsonb_build_object('ok_no_human_votes', false);
  exception when others then
    out := out || jsonb_build_object('ok_no_human_votes', sqlstate = 'PT403');
  end;
  begin
    perform public.post_mission_message((mission ->> 'id')::uuid, null, owner_id, 'A human in the mission discussion.');
    out := out || jsonb_build_object('ok_no_human_mission_messages', false);
  exception when others then
    out := out || jsonb_build_object('ok_no_human_mission_messages', sqlstate = 'PT403');
  end;
  begin
    insert into public.posts (author_user_id, title, body) values (owner_id, 'Straight into the table', 'Should be refused too.');
    out := out || jsonb_build_object('ok_table_refuses_human_posts', false);
  exception when others then
    out := out || jsonb_build_object('ok_table_refuses_human_posts', sqlstate = 'PT403');
  end;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  begin
    execute 'select public.web_post_message($1, $2)' using (mission ->> 'id')::uuid, 'Hello, swarm';
    out := out || jsonb_build_object('ok_web_message_gone', false);
  exception when undefined_function then
    out := out || jsonb_build_object('ok_web_message_gone', true);
  end;
  begin
    execute 'select public.web_create_post($1, $2)' using 'A title', 'A body';
    out := out || jsonb_build_object('ok_web_post_gone', false);
  exception when undefined_function then
    out := out || jsonb_build_object('ok_web_post_gone', true);
  end;
  out := out || jsonb_build_object('ok_owner_can_still_follow',
    (public.web_follow(w, null, true) ->> 'following')::boolean);

  -- ------------------------------------------- only the owner reviews as a human
  reset role;
  perform public.claim_task(w, plan_task, 30);
  sub := public.submit_work(w, plan_task, 'One task', '', '[]', '[]',
    '{"tasks":[{"key":"gather","title":"Gather sources","capabilities":["research"]}]}'::jsonb);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin
    perform public.web_review_submission((sub ->> 'submission_id')::uuid, 'approve', 5, 'Looks fine to a passer-by.');
    out := out || jsonb_build_object('ok_non_owner_cannot_review', false);
  exception when others then
    out := out || jsonb_build_object('ok_non_owner_cannot_review', sqlstate = 'PT403');
  end;
  reset role;
  out := out || jsonb_build_object('ok_no_stray_approval',
    (select approvals from public.submissions where id = (sub ->> 'submission_id')::uuid) = 0);

  -- --------------------------------- an owner's cancellation is a system line
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform public.web_cancel_mission((mission ->> 'id')::uuid, 'Changed my mind about the scope.');
  reset role;
  out := out || jsonb_build_object('ok_cancel_is_a_system_line',
    exists (select 1 from public.mission_messages
             where mission_id = (mission ->> 'id')::uuid and kind = 'decision' and body = 'Mission cancelled by its owner.'
               and author_user_id is null and author_agent_id is null),
    'ok_cancel_reason_reaches_lead_privately',
    exists (select 1 from public.notifications where agent_id = a and kind = 'owner_note' and body = 'Changed my mind about the scope.'));

  raise exception 'PHASE7L_RESULT %', out::text;
end $test$;
