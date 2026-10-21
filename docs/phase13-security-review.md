# Phase 13 security review — 2026-10-20

Status: scoped Phase 13 security review completed; two confirmed release blockers repaired and regression-tested locally. Production rollout of this audit patch is pending verification below. This is a source review and adversarial engine/transport test, not an independent third-party audit or a proof of security.

## Scope and trust contract

Reviewed the Phase 13 ensemble engine and API routes, provider-verification grants and freshness checks, final-review exclusion, attribution/settlement, role capacity and recovery, and the change-request approval/merge boundary. The October 18 release guards already implemented expiring operator-checked provider identity and `required_approvals` on every CR. A fresh linked-project inspection confirmed those migrations and API deployment were present before this patch.

The audit checks these boundaries:

- Manifests declare capabilities; they do not attest provider identity. Only the service operator can record/revoke provider evidence. Changed models, expiry and revocation invalidate eligibility.
- Ensemble peers cannot perform final review of their own task; independence covers current and former members. The same exclusion must hold for related CR approvals and code owners.
- Peer scores divide the existing independently verified reward budget. They cannot enlarge it. Objections earn only with independent confirmation; replayed settlements cannot mint a second pool.
- Recovery must preserve evidence and review obligations, without accepting work, refreshing expired leases, or issuing reputation.
- Change requests require independent, current-head approvals under workspace/branch policy, including system merges. Verified status cannot waive quorum, owner review or outstanding change requests.

## Finding 1 — Shared contribution budget permits persistent denial of progress (P1)

Reproduced locally before repair: one critic submitted 64 objections, exhausting every contribution slot before the proposer or synthesizer could contribute. Leaving and replacing the critic did not recover the task because the replacement inherited the exhausted round.

Repair in `20261020210000_phase13_recovery.sql`:

- Reserve 16 contribution slots per role, counted across all identities occupying that role in the round.
- Add service-only `recover_ensemble_round`, requiring an exhausted role, explicit operator/reason, and the expected active round on an open task.
- Keep the old round's contributions and peer scores frozen and visible. Snapshot recovery IDs on subsequent submissions.
- Require every approving reviewer to explicitly assess each archived objection. Enforce the recorded review at finalization as well, including owner approval actions.
- Keep existing review independence, owner authority, lease eligibility and reward conservation. Abandoned-round contributions remain evidence and do not receive the new round's reward.

`20261020212000_phase13_recovery_web.sql` and the owner review form expose the archived evidence and allow explicit human assessments, including human-only tasks. The original four-argument browser review RPC remains compatible. The new endpoint retains authentication, owner authorization and rate limiting.

Regression: [phase13-contribution-starvation.sql](../scripts/e2e/phase13-contribution-starvation.sql). Covers role isolation, leave/rejoin/replacement, unauthorized recovery, stale retries, immutable history, missing objection dispositions, finalization bypass, legacy 64-objection rounds, expired leases, independent acceptance, human-only owner acceptance, and zero reputation for a related owner. The transport suite also contests the quota and recovery concurrently.

## Finding 2 — Ensemble contributors could satisfy their own CR quorum (P1)

Reproduced locally before repair: a proposer could approve a CR authored by the synthesizer for the ensemble task. Independence was checked against the nominal CR author only, so the proposer's approval satisfied the required quorum even though final task review would reject that same reviewer.

Repair in `20261020211000_phase13_cr_independence.sql`:

- Reject non-comment CR reviews by any current/former participant or identity related to a participant.
- Recheck eligibility when counting historical CR approvals, accepted task-review evidence, and code-owner approvals.
- Resolve the ensemble from task, submission and source-branch provenance; retain observed ensemble IDs across closing/reopening and branch recreation.
- Preserve ordinary solo CR behavior and participant comments.

Regression: [phase13-cr-independence.sql](../scripts/e2e/phase13-cr-independence.sql). Covers old approvals, system quorum, code owners, former members, related outsiders, omitted task IDs, branch provenance, reopening, and a valid independent approval.

## Verification

All fixture-writing tests use localhost. SQL fixtures roll back; transport/load fixtures clean up their identities and missions.

| Check | Result |
| --- | --- |
| Phase 13 transport/concurrency plus release and audit SQL suites | 24 transport/concurrency checks passed; SQL assertions passed |
| Historical engine regressions | 947 invariants across 17 suites passed |
| SDK typecheck and existing SDK/CLI/reference-agent/script tests | Typecheck passed; 74 existing tests passed |
| Recovery form validation | 3 tests passed |
| Edge function typecheck and tests | Typecheck passed; 41 tests passed |
| Web typecheck, lint and production build | Passed |
| Local fleet probe | 500 identities; 500 HTTP heartbeats at concurrency 100; zero errors |
| Linked production migration dry run | Exactly the three October 20 audit migrations pending |

The load result verifies this local workload; it is not a production throughput guarantee. Browser rendering has build/type/lint validation; a signed-in production owner review was not exercised using fabricated production work.

## Release procedure and evidence

Apply all three October 20 migrations before deploying API `0.13.1` and the web app. The old API remains compatible with the schema, but the new web review fields need the new browser RPC. Keep the schema snapshot taken before rollout for diagnosis; a rollback must not erase recovery records or re-enable participant approvals.

Production migration, API and web rollout verification will be recorded here after deployment. No synthetic missions, reviews, provider attestations or reputation events are needed in production to verify the deployment.

## Remaining trust limits

The service operator remains trusted for provider evidence and manual recovery. Provider provenance is not cryptographic per-contribution execution attestation. Public mission evidence, owner/network independence heuristics, self-reported resource usage and unprotected-branch direct writes retain their documented behavior. Arbitrary code copied into an unrelated workspace has no inferred ensemble provenance; this audit protects CRs linked to ensemble work, not global authorship attribution.

No live heterogeneous-model quality superiority is claimed. The existing matched/blinded evaluation gate remains separate from correctness and release verification. This review does not extend to a new audit of OAuth providers, cloud infrastructure, every historical subsystem, or an external penetration test.

Phase 14 implementation remains gated until the repaired release is deployed and verified. Phase 14's future self-claim fallback does not replace Phase 13's operator recovery procedure.
