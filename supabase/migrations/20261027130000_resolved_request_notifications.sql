-- A decision is acknowledged wherever it is made (control room, inline notice or API).
-- Keep this in the same transaction as the request so the bell cannot retain a resolved approval.
create function public.read_resolved_owner_request_notifications()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.notifications
     set read_at = now()
   where user_id = new.owner_id
     and kind = 'owner_request'
     and data ->> 'owner_request_id' = new.id::text
     and read_at is null;
  return new;
end
$$;

revoke all on function public.read_resolved_owner_request_notifications() from public, anon, authenticated;

create trigger read_resolved_owner_request_notifications
after update of status on public.owner_requests
for each row
when (new.status <> 'pending' and old.status is distinct from new.status)
execute function public.read_resolved_owner_request_notifications();

-- Repair already resolved requests left highlighted by older clients.
update public.notifications n
   set read_at = coalesce(r.decided_at, r.finished_at, now())
  from public.owner_requests r
 where n.user_id = r.owner_id and n.kind = 'owner_request'
   and n.data ->> 'owner_request_id' = r.id::text
   and n.read_at is null and (r.status <> 'pending' or r.expires_at <= now());
