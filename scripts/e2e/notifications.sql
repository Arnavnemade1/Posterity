-- Local rollback suite: decisions acknowledge their notice, and reads stay scoped to the viewer.
do $$
declare
  u uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  agent uuid;
  request uuid;
  notice bigint;
  unrelated bigint;
  out jsonb := '{}'::jsonb;
  choice boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@notices.invalid', '{}', now(), now()),
         (other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', other::text || '@notices.invalid', '{}', now(), now());
  agent := (public.register_agent('zz-notice-' || left(u::text, 8)) -> 'agent' ->> 'id')::uuid;
  update public.agents set owner_id = u where id = agent;

  foreach choice in array array[true, false] loop
    request := (public.request_owner(agent, 'launch_mission', jsonb_build_object('approve', choice), 'Test notice acknowledgement') ->> 'id')::uuid;
    select id into notice from public.notifications where user_id = u and data ->> 'owner_request_id' = request::text;
    insert into public.notifications (user_id, kind, title, data)
    values (other, 'owner_request', 'Other viewer', jsonb_build_object('owner_request_id', request)) returning id into unrelated;
    perform public.decide_owner_request(request, u, choice);
    out := out || jsonb_build_object(
      case when choice then 'ok_approval_clears_notice' else 'ok_decline_clears_notice' end,
      (select read_at is not null from public.notifications where id = notice));
    out := out || jsonb_build_object('ok_other_viewer_untouched', (select read_at is null from public.notifications where id = unrelated));
  end loop;

  request := (public.request_owner(agent, 'launch_mission', '{"expired":true}', 'Expired request') ->> 'id')::uuid;
  update public.owner_requests set status = 'expired' where id = request;
  out := out || jsonb_build_object('ok_expiration_clears_notice',
    (select bool_and(read_at is not null) from public.notifications where user_id = u and data ->> 'owner_request_id' = request::text));

  insert into public.notifications (user_id, kind, title) values (u, 'mission_completed', 'Read on click') returning id into notice;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform public.web_mark_notifications_read(array[notice, unrelated]);
  out := out || jsonb_build_object(
    'ok_clicked_notice_read', (select read_at is not null from public.notifications where id = notice),
    'ok_read_cannot_cross_viewers', (select read_at is null from public.notifications where id = unrelated),
    'ok_trigger_not_callable', not has_function_privilege('authenticated', 'public.read_resolved_owner_request_notifications()', 'execute'));

  raise exception 'PHASENOTICES_RESULT %', out::text;
end
$$;
