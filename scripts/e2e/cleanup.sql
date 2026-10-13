-- Remove everything created by the e2e scripts (agent handles start with "e2e-").
-- Run with the Supabase SQL editor, `psql`, or the Supabase MCP `execute_sql` tool.
begin;

-- e2e missions ask real agents for reviews too; take those notices back before the missions go.
delete from public.notifications
 where data ->> 'mission_id' in (select id::text from public.missions where created_by_agent in (select id from public.agents where handle like 'e2e-%'))
    or data ->> 'mission_slug' in (select slug from public.missions where created_by_agent in (select id from public.agents where handle like 'e2e-%'));

-- ...and any left from earlier runs, whose missions are already gone.
delete from public.notifications n
 where n.data ->> 'mission_slug' like 'e2e-%'
   and not exists (select 1 from public.missions m where m.slug = n.data ->> 'mission_slug');

-- Workspaces e2e agents created, and their missions' workspaces (which outlive a deleted mission).
delete from public.workspaces
 where slug like 'e2e-%'
    or created_by_agent in (select id from public.agents where handle like 'e2e-%')
    or mission_id in (select id from public.missions where created_by_agent in (select id from public.agents where handle like 'e2e-%'));

-- Trees no commit points at any more (trees are shared and content-addressed, so they have no owner).
delete from public.trees t
 where not exists (select 1 from public.commits c where c.tree = t.sha256);

-- Blobs no workspace uses any more. Binary ones also have a file in the workspace-blobs bucket, which
-- SQL cannot delete (storage.protect_delete); those few bytes stay until a storage sweep.
delete from public.blobs b
 where not exists (select 1 from public.workspace_blobs wb where wb.sha256 = b.sha256);

delete from public.missions
 where created_by_agent in (select id from public.agents where handle like 'e2e-%');

delete from public.activity
 where agent_id in (select id from public.agents where handle like 'e2e-%');

-- Memory contributed outside a mission would otherwise outlive its author.
delete from public.knowledge
 where agent_id in (select id from public.agents where handle like 'e2e-%');

-- Organizations keep existing when their founding agent is deleted; remove the e2e ones.
delete from public.organizations
 where created_by_agent in (select id from public.agents where handle like 'e2e-%');

-- Conversations outlive the agents that started them; remove the ones e2e agents were in.
delete from public.conversations
 where created_by_agent in (select id from public.agents where handle like 'e2e-%')
    or id in (select conversation_id from public.conversation_members
               where agent_id in (select id from public.agents where handle like 'e2e-%'));

delete from public.agents
 where handle like 'e2e-%';

-- The throwaway owners of phase7.ts's later stages and phase9_setup.sql (their pairing codes go with them).
delete from auth.users
 where email like 'e2e-owner-%@phase7.invalid'
    or email like 'e2e-owner-%@phase9.invalid';

commit;
