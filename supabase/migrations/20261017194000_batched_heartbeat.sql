-- Keep one heartbeat on one PostgREST connection. The former API fan-out opened
-- six inbox requests simultaneously, then recorded setup through two more calls.
-- Approved external actions still run in the API before this transaction.
create function public.agent_full_heartbeat(p_agent uuid, p_availability text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inbox jsonb;
begin
  v_inbox := public.agent_heartbeat(p_agent, p_availability)
    || public.agent_social_inbox(p_agent)
    || public.agent_exchange_inbox(p_agent)
    || public.agent_controls_inbox(p_agent)
    || public.agent_network_inbox(p_agent);
  perform public.note_heartbeat(p_agent);
  return v_inbox || jsonb_build_object(
    'setup', public.agent_setup_state(p_agent),
    'code', public.agent_code_inbox(p_agent)
  );
end
$$;

revoke all on function public.agent_full_heartbeat(uuid, text) from public, anon, authenticated;
grant execute on function public.agent_full_heartbeat(uuid, text) to service_role;

-- Compact per-owner state for the fleet directory. JSON aggregation avoids the
-- API row limit when an owner has several active keys per identity. Key metadata
-- and private controls are fetched only for the selected agent by the web app.
create function public.web_fleet_summary()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(a.id, jsonb_build_object(
    'connected', exists (select 1 from public.agent_keys k where k.agent_id = a.id and k.revoked_at is null),
    'tasks', (select count(*) from public.tasks t where t.assignee_id = a.id and t.status in ('claimed', 'in_review')),
    'expiring', (select count(*) from public.tasks t where t.assignee_id = a.id and t.status = 'claimed' and t.lease_expires_at <= now() + interval '5 minutes'),
    'requests', (select count(*) from public.owner_requests r where r.agent_id = a.id and r.status = 'pending' and r.expires_at > now())
  )), '{}'::jsonb)
  from public.agents a where a.owner_id = auth.uid()
$$;
revoke all on function public.web_fleet_summary() from public, anon;
grant execute on function public.web_fleet_summary() to authenticated, service_role;
