-- Phase 9 database test: repeated directive acknowledgements. Applies the migration
-- 20261012020000_phase9_directive_acks.sql inside the transaction, then checks that a repeated ack,
-- done or identical note changes nothing and notifies the owner once.
--
-- Runs entirely inside one transaction and ends by raising PHASE9_ACKS_RESULT, which rolls everything
-- back. Every "ok_*" key in the JSON should be true. Run it with the Supabase SQL editor or MCP
-- `execute_sql`.
do $test$
declare
  owner uuid := gen_random_uuid();
  out jsonb := '{}'::jsonb;
  a uuid; d uuid; r jsonb;
  told int;
begin
  execute $mig$
create or replace function public.agent_update_directive(p_agent uuid, p_directive uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $fn$
declare
  d public.directives;
  v_note text := left(nullif(trim(p_note), ''), 2000);
  v_changed boolean;
  v_handle text;
begin
  select * into d from public.directives where id = p_directive and agent_id = p_agent for update;
  if not found then
    raise exception 'Directive not found' using errcode = 'PT404';
  end if;
  if p_action not in ('ack', 'done', 'note') then
    raise exception 'action must be ack, done or note' using errcode = 'PT400';
  end if;
  if p_action = 'note' and v_note is null then
    raise exception 'A note needs text' using errcode = 'PT400';
  end if;

  -- Agents retry after network errors. A repeat that changes nothing answers the same and does
  -- not notify the owner again.
  v_changed := case p_action
    when 'ack' then d.acknowledged_at is null
    when 'done' then d.status <> 'done'
    else false
  end or (v_note is not null and v_note is distinct from d.agent_note);
  if not v_changed then
    return to_jsonb(d) || jsonb_build_object('changed', false);
  end if;

  update public.directives set
    acknowledged_at = coalesce(acknowledged_at, now()),
    status = case when p_action = 'done' then 'done' else status end,
    agent_note = coalesce(v_note, agent_note),
    updated_at = now()
  where id = d.id
  returning * into d;
  select handle into v_handle from public.agents where id = p_agent;
  perform public.notify_user(d.author_user_id,
    case p_action when 'done' then 'directive_done' else 'directive_acknowledged' end,
    format('@%s %s: %s', v_handle,
           case p_action when 'done' then 'finished your directive' when 'ack' then 'acknowledged your directive' else 'replied to your directive' end,
           d.title),
    d.agent_note, jsonb_build_object('directive_id', d.id, 'agent', v_handle));
  return to_jsonb(d) || jsonb_build_object('changed', true);
end
$fn$;

  $mig$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@acks.invalid', '{"username":"acks_owner"}', now(), now());
  a := (public.register_agent('zz-acks-ada') -> 'agent' ->> 'id')::uuid;
  update public.agents set owner_id = owner, claimed_at = now() where id = a;
  d := (public.create_directive(owner, a, 'goal', 'Say hello', 'Introduce yourself.', 1, null) ->> 'id')::uuid;

  r := public.agent_update_directive(a, d, 'ack', null);
  out := out || jsonb_build_object('ok_first_ack', (r ->> 'changed')::boolean and r ->> 'acknowledged_at' is not null);
  r := public.agent_update_directive(a, d, 'ack', null);
  select count(*) into told from public.notifications where user_id = owner and kind = 'directive_acknowledged';
  out := out || jsonb_build_object('ok_repeat_ack_quiet', not (r ->> 'changed')::boolean and told = 1);

  r := public.agent_update_directive(a, d, 'ack', 'On it.');
  out := out || jsonb_build_object('ok_ack_with_new_note', (r ->> 'changed')::boolean and r ->> 'agent_note' = 'On it.');
  r := public.agent_update_directive(a, d, 'note', 'On it.');
  select count(*) into told from public.notifications where user_id = owner and kind = 'directive_acknowledged';
  out := out || jsonb_build_object('ok_same_note_quiet', not (r ->> 'changed')::boolean and told = 2);

  r := public.agent_update_directive(a, d, 'done', 'Posted my hello.');
  out := out || jsonb_build_object('ok_done', (r ->> 'changed')::boolean and r ->> 'status' = 'done');
  r := public.agent_update_directive(a, d, 'done', null);
  select count(*) into told from public.notifications where user_id = owner and kind = 'directive_done';
  out := out || jsonb_build_object('ok_repeat_done_quiet', not (r ->> 'changed')::boolean and told = 1 and r ->> 'agent_note' = 'Posted my hello.');

  begin
    perform public.agent_update_directive(a, d, 'note', '   ');
    out := out || jsonb_build_object('ok_empty_note_refused', false);
  exception when others then
    out := out || jsonb_build_object('ok_empty_note_refused', sqlstate = 'PT400');
  end;

  raise exception 'PHASE9_ACKS_RESULT %', out::text;
end $test$;
