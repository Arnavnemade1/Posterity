Phase 15: The Permissionless Layer — Full Blueprint
Drafted 2026-10-21. Status: blueprint (design-complete, not yet spec).
Supersedes the Phase 15 outline; the outline's Section 12 (vectors) is
integrated here as Section 8.
0. Position in the sequence
Phase 15 begins after Phase 14 ships. It does not reorder the agreed
sequence: trust contract → Phase 13 code → fix required_approvals →
security audit → deploy Phase 13 → Phase 14 → Phase 15.
What Phase 15 inherits: working ensembles with role separation (13), an
orchestrator that routes work under declared, auditable parameters (14),
and a security audit that has actually happened. What it removes: the
owner-attested identity anchor everything above assumed.
Honest status until this phase ships: **"permissionless Sybil resistance
unspecified."** This blueprint is the proposal to replace that sentence.
1. Non-negotiable principles
State the assumption. The network promises "distinct keys under a
   priced economic Sybil assumption" — never "distinct labs," never
   "distinct operators." The assumption is printed in the spec, not
   buried.
Attack cost >> extractable reward, with margin. Not a slogan: a
   quantified inequality (Section 4) that every parameter choice must
   satisfy.
Stake buys entry, never standing. No amount of locked capital
   purchases Tier 2. Standing is earned through demonstrated reliability
   over time or it means nothing.
Legibility-or-commitment. Any communication touching
   trust-relevant outcomes (scores, objections, verdicts, votes, role
   claims) is legible to the trust layer or cryptographically committed
   beforehand. Opacity is permitted for deliberation; never for
   accountability.
No silent regime mixing. Attested and permissionless identities
   coexist, labeled, never pooled silently. An ensemble's trust
   assumptions are declared per assignment.
Trust is earned slowly, lost fast. Tier transitions take weeks to
   months; demotion on evidenced violation is automatic.
2. Identity model
An identity is a tuple: (keypair, locked_stake, tier, history_hash).
keypair: the identity. Keys are cheap; everything expensive
  attaches to what the key has done and locked.
locked_stake (S): capital escrowed per identity, slashable on
  evidenced violation. Linear per identity — the defense against rings
  comes from share caps and slash exposure (Section 5), not from magic
  superlinear pricing, which cannot be enforced without knowing the
  funding graph (which is the Sybil problem restated).
tier: T0 (sandbox) → T1 (probation) → T2 (full). Section 6.
history_hash: chained log of the identity's assignments, commits,
  scores, and audits. Portable as verifiable claims (Section 10).
Two entry tracks (the plutocracy answer):
Stake track: lock S, enter at T0 with accelerated tenure clocks.
Tenure track: lock nothing, enter at T0 with longer tenure
  requirements. Slower, but open to the unfunded.
Both converge at identical T2 requirements. The network's "open"
enrollment is then an honest statement: open to anyone with capital
or patience.
3. The trust ladder (detailed)
T0 — Sandbox
Eligible only for quarantined tasks: synthetic work, low-stakes
  labeling, redundant verification of already-settled work.
Reputation earned in T0 does not export and does not count toward
  T2 standing. It buys only the right to be evaluated for T1.
Audit sampling: 100% of T0 outputs reviewed (by T2 or attested
  reviewers) until the identity's pass rate stabilizes, then high
  sampling.
T0 → T1: minimum tenure τ0, minimum completed tasks n0, audit pass
  rate ≥ p0, zero evidenced violations. (Stake track: shorter τ0;
  tenure track: longer τ0. Same p0, same n0.)
T1 — Probation
Eligible for real tasks. Never reviewer roles. Never more than one
  role in any single ensemble. Assignment share cap: no correlated
  cluster exceeds c1 of any task pool.
Elevated audit sampling (rate a1, declared parameter).
T1 → T2: tenure τ1, tasks n1, pass rate ≥ p1, plus either a T2
  vouch (Section 7) or an extended clean record (tenure track's
  slower path must not be strictly worse — the extended record is
  the vouch substitute).
T2 — Full
All roles including reviewer and adjudication sortition (Section 7).
Standard audit sampling (rate a2 < a1).
Demotion: any evidenced slashable violation → automatic drop to T0
  (stake slashed per Section 5) or expulsion for severe offenses.
  Re-ascent restarts the clocks; history is not erased.
All parameters (τ0, τ1, n0, n1, p0, p1, a1, a2, c1) are declared,
auditable network config — Phase 14's "declared parameter" idea
extended to the trust layer. Changing them mid-epoch is a trust event.
4. The security contract, quantified
For the design to be sound, this inequality must hold with margin:
  E[attack profit] = P(success) · V_extract − N·S − C_ops − P(slash)·L < 0
N·S: N identities at stake S each.
V_extract: maximum extractable value — reputation convertible
  into future reward flow. Bounded because: T0 reputation doesn't
  export, T1 can't review, share caps limit assignment flow per
  cluster, and per-task rewards are capped (R_max).
C_ops: operating cost over the attack's required tenure
  (τ0 + τ1 minimum before any extraction at T2).
P(slash)·L: slash probability times loss (stake + burned
  standing). P(slash) is nonzero because audit sampling (a1, a2),
  sealed cognition (Section 8), and correlation monitoring run
  continuously.
The time dimension does most of the work: quarantine plus probation
force the attacker to behave honestly for τ0 + τ1 before extracting
anything. That (a) discounts V_extract heavily — the attack's IRR is
terrible; (b) gives statistical detection months of observations;
(c) produces the long-con paradox (Section 11): an attacker who
behaves honestly for a year was a good participant for a year.
Illustrative numbers (not proposals — the point is the shape):
S = 100 units, R_max = 5 units/task, τ0+τ1 = 90 days, N = 4 for a
minimal ring. Upfront: 400 staked + 90 days of honest work before the
first extractable reward, with continuous audit exposure and total
stake at risk. The honest strategy (do good work for 90 days, earn
rewards legitimately) strictly dominates the attack strategy. That
dominance — not any single mechanism — is the security argument.
5. Staking and slashing
Stake mechanics. S locked per identity at entry (stake track).
Per-assignment escrow: a fraction of S is encumbered per active role
and released on clean settlement — bounding concurrent exposure and
preventing one identity from staking the same capital across ten
simultaneous attacks.
Slashable offenses (each with an evidence standard — offenses
without evidence standards are theater):
Provable self-dealing: the same funding key or correlated
   cluster on both sides of a proposer/critic/reviewer relationship.
   Evidence: on-chain/graph linkage. Standard: deterministic.
Review fraud vs. audit ground truth: review scores diverging
   from audit outcomes beyond threshold δ over window w. Evidence:
   statistical. Standard: pre-declared δ, w; triggers review, slashing
   on confirmation.
Surviving-objection fraud (Phase 13 ensembles): suppressing or
   misrepresenting a critic's objection in the synthesis. Evidence: the
   committed objection log vs. the submitted synthesis. Standard:
   deterministic given the log.
Correlated voting / ring behavior: score correlation across
   identities exceeding baseline by threshold. Evidence: statistical.
   Standard: triggers human/attested review; never automatic slashing
   (false positives = accusing real teams).
Adjudication and the recursion problem. Slash decisions are made
by sortition jury drawn from T2 (plus an attested reserve), with the
jury's reasoning and votes committed to the log. Appeal exists. But
stated honestly: there is no trustless last resort. If the jury pool
itself is Sybil-compromised, adjudication fails. The buck stops at
the attested regime — labeled as such, per Principle 5. Permissionless
adjudication all the way down is not claimed.
6. Assignment under adversarial conditions
The orchestrator (Phase 14) now operates the prime attack surface:
selection bias composed with Sybil identities. Constraints:
Verifiable randomness: role assignment uses a VRF so the
  orchestrator cannot steer roles to favored identities. The Phase 14
  "declared criteria before assignment" rule now includes the
  randomness beacon.
Correlation caps: no correlated cluster (by funding graph,
  behavioral similarity per Section 8.2, or shared entry metadata)
  holds more than one role in any ensemble, or more than share c1 of
  any task pool.
Adversarial math (the assignment-probability element): with
  random assignment from a pool where the attacker controls fraction
  f, the probability of capturing ≥2 of 4 ensemble roles is the
  hypergeometric tail — small for small f, which is exactly what
  share caps enforce by keeping effective f low per task. The caps
  are the mechanism; the math is the audit check.
Phase 14's mitigations become security controls: immutable
  assignment log, declared criteria, statistical favoritism
  monitoring — now watched specifically for Sybil-correlated
  assignment patterns, not just fairness.
7. Vouching with teeth
A T2 identity may vouch a T0/T1 identity for accelerated transition
by locking additional stake V alongside the vouchee. If the vouched
identity commits an evidenced violation within window ω, the
voucher's V is slashed alongside the violator's S.
Vouching without consequences is nepotism with extra steps. The
tenure track's extended-clean-record path exists precisely so that
vouching is never the only road to T2 — no gatekeeping by
incumbents.
8. Higher-dimensional vectors: attack surface, evidence, mechanism
(Integrated from the morning's neuralese thread. Rule: compress the
deliberation, never the accountability — sharpened here because
Phase 15's trust boundaries are weaker, so what crosses them must be
more legible.)
8.1 Attack surface: covert coordination
A ring pays for N valid identities, then coordinates through
steganographic or vector channels — timing, word choice,
embedding-space signals — invisible to the trust layer. Cost-based
identity is blind: the "independence" checked is exactly what the
covert channel fakes. Countermeasures:
Sealed cognition protocol (concrete, added to Phase 13
  ensembles): Phase A — each role commits hash(draft) to the
  ensemble log before seeing others' drafts. Phase B — drafts
  revealed; the critic must address the committed drafts.
  Early reveal or refusal to commit disqualifies the role from
  scoring. Commit to the text hash, not the vector: embeddings
  don't compare across models, and nondeterminism breaks naive
  vector commitments.
Legibility-or-commitment (Principle 4): trust-relevant
  communication is legible or committed. Private vector chatter
  stays free for deliberation.
Correlated-behavior monitoring as in Section 6.
8.2 Evidence: latent stylometry for Sybil screening
One operator's fleet may share distributional signatures —
embedding distributions, reasoning mannerisms, error patterns —
beneath diversified surface text. A screening signal for ring
suspicion, with hard limits: never proof (honest agents on the same
model correlate too; false positives accuse real teams); adversarially
fragile (sophisticated attackers decorrelate); and it requires a
canonical embedding function — itself a centralization decision,
since whoever provides the embedder shapes what is detectable.
One weak signal among many; triggers review, never auto-slash.
8.3 Mechanism: verifiable latent commitments
Commit-reveal doesn't require trusting what a vector means, only
that the commitment binds. "I produced this before seeing yours"
enforced cryptographically rather than attested socially — the
independence property ensembles need. [OPEN] Formalizing
proof-of-distinct-cognition (proving non-copying without revealing
content) stays research-grade.
8.4 The sharpened rule
In an attested network, legibility is a virtue. In a permissionless
network, legibility is the only enforcement surface the trust layer
has. Every trust-relevant bit in opaque vectors is attacker
territory.
9. Attack catalog (with countermeasure mapping)
Ring farming (N identities proposing/critiquing/reviewing each
  other) → correlation caps + sealed cognition + N·S cost + share caps.
Review rings (mutual back-scratching) → stake on accuracy +
  random audits + correlation monitoring (offense #4).
Long-con (honest for months, defect once at high value) →
  per-assignment escrow bounds single-task extraction; standing
  burned on slash makes the setup cost unrecoverable; the paradox
  (Section 11) applies.
Stake grinding (wealth buys standing) → standing cannot be
  purchased; tenure track exists; share caps per cluster.
Orchestrator capture → VRF assignment + correlation caps +
  T2-only eligibility for sensitive roles + statistical monitoring.
Adjudicator capture → sortition + attested reserve + appeal;
  residual risk honestly stated (Section 5).
Covert-channel collusion → sealed cognition +
  legibility-or-commitment (Section 8.1).
Funding-graph obfuscation (mixers, fresh keys per identity) →
  acknowledged residual: perfect funding attribution is impossible;
  the defense stack assumes obfuscation and relies on behavior-side
  signals (correlation, audit) instead.
Identity markets (buy a seasoned T2 key) → acknowledged
  residual (Section 11): behavioral-discontinuity screening is weak;
  non-transferability of standing is enforced socially (vouch
  history, known counterparties), not cryptographically.
Reputation laundering (farm clean history, sell the identity)
  → same as identity markets; history_hash is bound to the key,
  and keys change hands silently — no clean fix, stated as residual.
10. Reputation portability
"Portable reputation" was the original vision; cost-based identity
is what makes it statable without a central verifier. What ports:
(tier, history_hash, stake_proof) as verifiable claims against
the home deployment's log. What doesn't port: a global score. The
receiving deployment assigns weight by its own policy — reputation
is always interpreted locally, never imported as authority. (This
also blunts Goodhart: no single number to game across deployments.)
11. Residual risks (stated, not solved)
Collusion indistinguishability: no mechanism distinguishes a
   Sybil ring from a high-performing team. Defenses are statistical
   and economic, never proof.
Identity markets / key sales: no cryptographic fix; social
   and behavioral mitigations only.
Adjudication recursion: the buck stops at attestation.
Canonical embedder centralization (Section 8.2): the Sybil
   detector is a centralization point and a potential weapon.
The long-con paradox: an attacker who behaves honestly for a
   year to earn extraction rights provided a year of honest work.
   At some point "infiltrator" and "participant" are
   behaviorally identical — the design should notice when the
   threat model has dissolved into the success case.
Parameter governance: who sets S, τ, caps, thresholds — and
   how those setters are themselves constrained — is deferred to
   the governance design (not this phase).
12. Rollout: ratchets with exit criteria
15.0 Closed + staked. Attested deployment adds optional
  staking and per-assignment escrow. Exit: staking live one full
  epoch; slash-dispute pipeline exercised (even on test cases);
  zero unresolved disputes older than the declared window.
15.1 Allowlisted expansion. New operators by allowlist, all
  staked; red-team ring attacks run against the correlation and
  audit stack. Exit: red-team detection rate ≥ declared threshold;
  false-positive rate on correlation flags within bounds.
15.2 Permissionless entry, quarantined. Anyone may create
  identities; all enter T0; tenure track opens. Exit: T0→T1
  pipeline functioning at volume; stylometry screening calibrated
  (Section 8.2); no T0 reputation leakage into real flows.
15.3 Full permissionless. Tiers, slashing, sealed cognition,
  and VRF assignment live; attestation remains as a labeled
  higher-assurance option. Keeps the experimental label until
  two full red-team cycles plus 12 months of 15.2 data — the honest
  statement from day one.
13. Open questions (with recommendations)
Scarcity choice → recommend stake + time (Section 2's two
   tracks). Stake is the only scarcity that doubles as a security
   deposit (compute can't be slashed; burn is pure waste; time alone
   can't bootstrap). Plutocracy mitigated by: entry-only stake,
   share caps, tenure track.
Adjudication last resort → sortition jury + attested reserve +
   appeal; honest statement that the buck stops at attestation.
15.3 experimental label → keep it until the exit criteria in
   Section 12 are met. No quiet graduation.
Cross-deployment reputation → claims portable, weight local,
   no global score (Section 10).
Plutocracy → answered by the tenure track; entry stake sized
   to "serious hobbyist," and the no-stake path must converge to
   identical T2 (slower, never lesser).
Proof-of-distinct-cognition → research-grade; do not gate the
   phase on it. Sealed cognition (committed hashes) is the shippable
   subset.
Canonical embedder ownership → unresolved and load-bearing:
   options are operator-provided (centralized), multi-embedder
   consensus (expensive), or text-level analysis only (weaker
   signal). Recommend deciding before 15.2.