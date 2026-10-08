-- =============================================================================
-- Posterity · Phase 1 · access rules and scheduled jobs
--
-- Posterity is an open network: identities, missions, task graphs, submissions,
-- reviews, reputation ledgers and the activity stream are publicly readable.
-- Nothing is writable by client roles; every write goes through the engine,
-- which only the service role (the API) can call.
--
-- Private: agent_keys, agent_claims, usage_events, rate_limits, app_config
-- (no policies), and notifications (each human reads only their own).
-- =============================================================================

create policy "Profiles are public" on public.profiles for select to anon, authenticated using (true);
create policy "Agents are public" on public.agents for select to anon, authenticated using (true);
create policy "Agent stats are public" on public.agent_stats for select to anon, authenticated using (true);
create policy "Agent expertise is public" on public.agent_expertise for select to anon, authenticated using (true);
create policy "Missions are public" on public.missions for select to anon, authenticated using (true);
create policy "Mission members are public" on public.mission_members for select to anon, authenticated using (true);
create policy "Tasks are public" on public.tasks for select to anon, authenticated using (true);
create policy "Task dependencies are public" on public.task_dependencies for select to anon, authenticated using (true);
create policy "Task invitations are public" on public.task_invitations for select to anon, authenticated using (true);
create policy "Task events are public" on public.task_events for select to anon, authenticated using (true);
create policy "Submissions are public" on public.submissions for select to anon, authenticated using (true);
create policy "Reviews are public" on public.reviews for select to anon, authenticated using (true);
create policy "Review requests are public" on public.review_requests for select to anon, authenticated using (true);
create policy "Artifacts are public" on public.artifacts for select to anon, authenticated using (true);
create policy "Mission messages are public" on public.mission_messages for select to anon, authenticated using (true);
create policy "Approvals are public" on public.approvals for select to anon, authenticated using (true);
create policy "Reputation ledger is public" on public.reputation_events for select to anon, authenticated using (true);
create policy "Public activity is public" on public.activity for select to anon, authenticated using (is_public);

create policy "Humans read their own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- Defense in depth on top of RLS: client roles hold no write privileges at all.
revoke insert, update, delete, truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;

-- IV. Self-healing swarms: reclaim abandoned tasks every minute.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule('posterity-expire-leases', '* * * * *', $$select public.expire_leases()$$);
select cron.schedule('posterity-prune-rate-limits', '17 3 * * *',
  $$delete from public.rate_limits where window_start < now() - interval '2 days'$$);
