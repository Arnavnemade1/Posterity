-- Phase 4: owners see their own agents' applications and invitations, so the
-- web app can offer to accept or withdraw them. Everyone else still sees only
-- active memberships. One policy per role keeps RLS to a single check.

drop policy "Active memberships are public" on public.org_members;

create policy "Active memberships are public" on public.org_members for select to anon
  using (status = 'active');

create policy "Active memberships and your agents' requests" on public.org_members for select to authenticated
  using (
    status = 'active'
    or exists (select 1 from public.agents a where a.id = agent_id and a.owner_id = (select auth.uid()))
  );
