// Read-only quality gate over real accepted work. Protocol fixtures do not prove model quality.
import { Posterity } from '../../packages/sdk/src/index.ts';
const client = new Posterity();
const { cohorts } = await client.ensembles.metrics();
type Cohort = { kind: string; complexity: string; required_capabilities: string[]; acceptance_criteria: string; ensemble: boolean; surviving_objections: boolean; accepted_submissions: number; review_score: number | null; best_review_score: number | null; post_acceptance_revisions: number };
const rows = cohorts as unknown as Cohort[];
const key = (c: Cohort) => JSON.stringify([c.kind,c.complexity,[...c.required_capabilities].sort(),c.acceptance_criteria]);
const matched = rows.filter((c) => c.ensemble && rows.some((s) => !s.ensemble && key(s) === key(c)));
const minSamples = Number(process.env.POSTERITY_EVAL_MIN_SAMPLES ?? 20);
if (!Number.isInteger(minSamples) || minSamples < 1) throw new Error('POSTERITY_EVAL_MIN_SAMPLES must be a positive integer');
let established = 0;
for (const c of matched) {
  const solo = rows.filter((s) => !s.ensemble && key(s) === key(c));
  const count = solo.reduce((n,s) => n + s.accepted_submissions, 0);
  const bestSolo = Math.max(...solo.map((s) => s.best_review_score ?? -Infinity));
  const enough = c.accepted_submissions >= minSamples && count >= minSamples;
  const better = enough && c.review_score !== null && c.review_score > bestSolo;
  if (better) established++;
  console.log(JSON.stringify({ cohort: key(c), ensemble_samples: c.accepted_submissions, solo_samples: count, ensemble_score: c.review_score, best_solo_score: bestSolo, enough_samples: enough, higher_than_every_solo: better }));
}
const withObjections = rows.filter((c) => c.ensemble && c.surviving_objections);
const withoutObjections = rows.filter((c) => c.ensemble && !c.surviving_objections);
const rate = (rs: Cohort[]) => {
  const n = rs.reduce((sum,c) => sum+c.accepted_submissions,0);
  return { n, rate: n ? rs.reduce((sum,c) => sum+c.post_acceptance_revisions,0)/n : null };
};
console.log(JSON.stringify({ surviving_objections: rate(withObjections), no_surviving_objections: rate(withoutObjections), causal_claim: false }));
if (!established) { console.error('Quality advantage not yet established: collect matched, blinded real-model evaluations.'); process.exitCode = 2; }
