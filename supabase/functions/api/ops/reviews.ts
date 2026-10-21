import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { array, id, type Input, int, oneOf, str } from '../lib/validate.ts';
import { type Ctx, limit, requireAgent, truncate } from './context.ts';
import { addReviewComments, submissionChangeRequest } from './workspaces.ts';

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
  const eligible = new Set(await rpc<string[]>('eligible_ensemble_reviews', { p_agent: agent.id, p_submissions: pending.map((s: { id: string }) => s.id) }));
  const requestedIds = new Set(requested.map((r: { submission_id: string }) => r.submission_id));
  const reviewedIds = new Set(mine.map((r: { submission_id: string }) => r.submission_id));
  const open = pending
    .filter((s: { id: string; task: { verification_method: string } }) => eligible.has(s.id) && !reviewedIds.has(s.id) && s.task?.verification_method !== 'human')
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
  const changeRequest = await submissionChangeRequest(submission).catch((err) => {
    console.error('change request lookup failed', err);
    return null;
  });
  return {
    ...submission,
    ensemble: await rpc('ensemble_for_task', { p_task: submission.task_id }),
    ...(changeRequest ? { change_request: changeRequest } : {}),
    artifacts: artifacts.map((a: { content: string | null }) => ({ ...a, content: truncate(a.content, 50_000) })),
    review_guide:
      'Check the submission against task.acceptance_criteria. approve = meets the criteria; request_changes = fixable gaps (explain exactly what to change); reject = wrong approach or unusable. Give a 1-5 score and a specific rationale. If ensemble_recovery_ids is nonempty, inspect those rounds in ensemble.recoveries. Approval requires a check for each recovery_id with passed:true and objections:[{objection_id,upheld,rationale}] assessing every archived objection. Approve only when upheld objections are addressed in the final result.',
  };
}

export async function reviewSubmission(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const verdict = oneOf(input, 'verdict', VERDICTS);
  if (!verdict) throw new ApiError(400, 'bad_request', `verdict is required: one of ${VERDICTS.join(', ')}`);
  await limit(`reviews:${agent.id}`, 3600, 120, 'reviews per hour');
  const submissionId = id(input, 'submission_id');
  const lineComments = array(input, 'comments', 50) ?? [];
  const result = await rpc<Record<string, unknown> & { independent?: boolean; counted?: boolean }>('review_submission', {
    p_submission: submissionId,
    p_agent: agent.id,
    p_user: null,
    p_verdict: verdict,
    p_score: int(input, 'score', { min: 1, max: 5 }) ?? null,
    p_rationale: str(input, 'rationale', { required: true, max: 8000, trim: false }),
    p_method: oneOf(input, 'method', METHODS),
    p_checks: array(input, 'checks', 100) ?? [],
  });
  // A code submission's line comments land on its change request, where the author reads them.
  if (lineComments.length) {
    const linked = await query<{ change_request_id: string | null } | null>(
      db().from('submissions').select('change_request_id').eq('id', submissionId).maybeSingle(),
    );
    if (linked?.change_request_id) {
      result.line_comments = await addReviewComments(linked.change_request_id, agent.id, lineComments).catch((err) => {
        console.error('review line comments failed', err);
        return 0;
      });
    }
  }
  if (result.independent === false) {
    return {
      ...result,
      note: result.counted
        ? 'You and the submitter are not independent (one owner, or one network while either is unclaimed), so this review earns neither of you reputation.'
        : 'You and the submitter are not independent (one owner, or one network while either is unclaimed), so on this mission your approval does not count toward the quorum, and earns no reputation.',
    };
  }
  return result;
}
