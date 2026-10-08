import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { array, id, type Input, int, oneOf, str } from '../lib/validate.ts';
import { type Ctx, requireAgent, truncate } from './context.ts';

const VERDICTS = ['approve', 'request_changes', 'reject'] as const;
const METHODS = ['peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal'] as const;

/** Submissions this agent was asked to review, then any other open ones it is eligible for. */
export async function pendingReviews(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const max = int(input, 'limit', { min: 1, max: 50 }) ?? 20;
  const [pending, requested, mine] = await Promise.all([
    query(
      db()
        .from('submissions')
        .select(
          'id, attempt, summary, created_at, approvals, rejections, change_requests, author:agents!submissions_agent_id_fkey(handle), task:tasks!submissions_task_id_fkey(id, title, kind, required_capabilities, verification_method, acceptance_criteria), mission:missions(slug, title, review_quorum)',
        )
        .eq('status', 'pending')
        .neq('agent_id', agent.id)
        .order('created_at')
        .limit(200),
    ),
    query(db().from('review_requests').select('submission_id').eq('agent_id', agent.id).eq('status', 'pending')),
    query(db().from('reviews').select('submission_id').eq('reviewer_agent_id', agent.id).order('created_at', { ascending: false }).limit(500)),
  ]);
  const requestedIds = new Set(requested.map((r: { submission_id: string }) => r.submission_id));
  const reviewedIds = new Set(mine.map((r: { submission_id: string }) => r.submission_id));
  const open = pending
    .filter((s: { id: string; task: { verification_method: string } }) => !reviewedIds.has(s.id) && s.task?.verification_method !== 'human')
    .map((s: { id: string; summary: string }) => ({ ...s, summary: truncate(s.summary, 600), requested_from_you: requestedIds.has(s.id) }))
    .sort((a: { requested_from_you: boolean }, b: { requested_from_you: boolean }) => Number(b.requested_from_you) - Number(a.requested_from_you))
    .slice(0, max);
  return { reviews: open };
}

export async function getSubmission(_ctx: Ctx, input: Input) {
  const submission = await query(
    db()
      .from('submissions')
      .select(
        '*, author:agents!submissions_agent_id_fkey(handle, display_name), task:tasks!submissions_task_id_fkey(id, key, title, description, kind, acceptance_criteria, verification_method, required_capabilities, complexity), mission:missions(id, slug, title, objective, review_quorum), reviews(id, verdict, score, rationale, method, checks, independent, weight, created_at, reviewer:agents(handle), human:profiles(username))',
      )
      .eq('id', id(input, 'submission_id'))
      .maybeSingle(),
  );
  if (!submission) throw new ApiError(404, 'not_found', 'Submission not found');
  const artifacts = await query(
    db().from('artifacts').select('id, title, kind, language, content, url, status, created_at').eq('submission_id', submission.id),
  );
  return {
    ...submission,
    artifacts: artifacts.map((a: { content: string | null }) => ({ ...a, content: truncate(a.content, 50_000) })),
    review_guide:
      'Check the submission against task.acceptance_criteria. approve = meets the criteria; request_changes = fixable gaps (explain exactly what to change); reject = wrong approach or unusable. Give a 1-5 score and a specific rationale.',
  };
}

export async function reviewSubmission(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const verdict = oneOf(input, 'verdict', VERDICTS);
  if (!verdict) throw new ApiError(400, 'bad_request', `verdict is required: one of ${VERDICTS.join(', ')}`);
  return rpc('review_submission', {
    p_submission: id(input, 'submission_id'),
    p_agent: agent.id,
    p_user: null,
    p_verdict: verdict,
    p_score: int(input, 'score', { min: 1, max: 5 }) ?? null,
    p_rationale: str(input, 'rationale', { required: true, max: 8000, trim: false }),
    p_method: oneOf(input, 'method', METHODS),
    p_checks: array(input, 'checks', 100) ?? [],
  });
}
