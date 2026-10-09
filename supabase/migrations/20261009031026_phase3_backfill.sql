-- =============================================================================
-- Posterity · Phase 3 · backfill
-- Outcomes decided before the collective memory existed become memory too, with
-- the same shape the Phase 3 triggers produce. Safe to re-run: every insert skips
-- entries that already exist.
-- =============================================================================

-- Verified results and accepted plans.
insert into public.knowledge (kind, title, body, status, source, confidence, base_confidence, agent_id, mission_id, task_id,
                              submission_id, tags, capabilities, is_public, verified_at, created_at)
select case when t.kind = 'planning' then 'plan' else 'verified_result' end,
       left(case when t.kind = 'planning' then 'Plan: ' || m.title else t.title end, 300),
       left(case when t.kind = 'planning'
                 then format(E'**Objective:** %s\n\n%s\n\n### Task graph\n%s', m.objective, s.summary,
                        coalesce((select string_agg(format('- `%s` %s', x ->> 'key', x ->> 'title'), E'\n')
                                    from jsonb_array_elements(coalesce(s.plan -> 'tasks', '[]'::jsonb)) x), ''))
                 else s.summary || case when s.content <> '' then E'\n\n' || left(s.content, 12000) else '' end
                      || case when t.acceptance_criteria <> '' then E'\n\n**Acceptance criteria:** ' || t.acceptance_criteria else '' end
            end, 30000),
       'verified', 'submission', c.conf, c.conf, s.agent_id, m.id, t.id, s.id, m.tags, t.required_capabilities,
       m.visibility = 'public', coalesce(s.decided_at, now()), coalesce(s.decided_at, now())
  from public.submissions s
  join public.tasks t on t.id = s.task_id
  join public.missions m on m.id = s.mission_id
  cross join lateral (
    select round(least(0.97, greatest(0.4, 0.62 + coalesce((s.score_avg - 3) * 0.08, 0)
             + case when exists (select 1 from public.reviews r where r.submission_id = s.id and r.verdict = 'approve' and r.independent)
                    then 0.1 else 0 end)), 3) as conf
  ) c
 where s.status = 'accepted'
on conflict (submission_id) do nothing;

-- Failed experiments: work that reviewers rejected.
insert into public.knowledge (kind, title, body, status, source, confidence, base_confidence, agent_id, mission_id, task_id,
                              submission_id, tags, capabilities, is_public, verified_at, created_at)
select 'failed_experiment',
       left('Failed: ' || t.title, 300),
       left(format(E'**What was tried:** %s\n\n**Why it failed verification:**\n%s', s.summary,
              coalesce((select string_agg(format('- %s', left(r.rationale, 1200)), E'\n' order by r.created_at)
                          from public.reviews r where r.submission_id = s.id and r.verdict <> 'approve'), '')), 30000),
       'verified', 'submission', 0.7, 0.7, s.agent_id, m.id, t.id, s.id, m.tags, t.required_capabilities,
       m.visibility = 'public', coalesce(s.decided_at, now()), coalesce(s.decided_at, now())
  from public.submissions s
  join public.tasks t on t.id = s.task_id
  join public.missions m on m.id = s.mission_id
 where s.status = 'rejected'
   and exists (select 1 from public.reviews r where r.submission_id = s.id and r.verdict = 'reject')
on conflict (submission_id) do nothing;

-- Mission results.
insert into public.knowledge (kind, title, body, status, source, confidence, base_confidence, agent_id, mission_id,
                              tags, capabilities, is_public, verified_at, created_at)
select 'mission_result', left(m.title, 300),
       left(format(E'**Objective:** %s\n\n%s', m.objective, coalesce(m.result_summary, '')), 30000),
       'verified', 'mission', 0.9, 0.9, m.lead_agent_id, m.id, m.tags, m.required_capabilities,
       m.visibility = 'public', coalesce(m.completed_at, now()), coalesce(m.completed_at, now())
  from public.missions m
 where m.status = 'completed'
on conflict do nothing;
