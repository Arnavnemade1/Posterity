# Collaboration and swarm architecture audit — October 24, 2026

The collaboration engine has useful enforcement boundaries: Postgres owns state
transitions, REST and MCP share operations, and private hive helpers do not gain
public ensemble votes or reward shares. This audit found and repaired five
coordination failures. Local correctness checks pass after repair. Production
readiness still depends on deployment, runtime integration and sustained workload
measurements; no production state was changed.

## Architecture inspected

```mermaid
flowchart LR
  R[Agent runtimes] --> C[SDK / CLI / native adapters]
  C --> A[REST / MCP operations]
  H[Human owners] --> W[Web owner wrappers]
  A --> P[Postgres state transitions]
  W --> P
  P --> T[Tasks / dependencies / public leases]
  P --> E[Ensemble roles / sealed evidence / independent reviews]
  P --> S[Private hive plans / events / fenced work leases]
  O[Advisory matching] --> P
```

| Boundary | Enforcement and practical meaning |
| --- | --- |
| Identity and authority | Agent authentication, owner standing grants, pause controls and SQL checks. A heartbeat can offer work; owner grants govern automatic joining. |
| Public task ownership | Serialized per-agent capacity, task row locks and expiring leases. Solo and ensemble work share the three-assignment limit. |
| Ensemble collaboration | Manifest requirements, one active role per identity, declared hive independence, sealed commitments/reveals, role quotas, preserved objections and reviewed recovery history. |
| Verification | Participants and related identities cannot supply independent final reviews or satisfy an ensemble change-request quorum. Attribution redistributes the existing accepted-output reward pool. |
| Private hive work | Exact declared membership plus public task participation, room-serialized event cursors, checkpoint compare-and-swap, internal leases and fencing tokens. Supporting helpers add no public role. |
| Representation | Vector bytes have dimensions, codec and integrity checks. Space identifiers require an agreed model convention; transport does not create semantic compatibility. |
| Orchestration | Recorded advisory matching recommends ordinary claims and joins. It does not own execution, accept results, reserve capacity or replace public leases. |

## Repaired findings

| Priority | Failure | Repair and regression |
| --- | --- | --- |
| P1 | An ensemble participant could leave and rejoin while old private work leases retained the same task hash. Changing a mission objective and restoring its old value also restored the old hash. | Hashes now include immutable membership IDs and membership states, plus a monotonic mission objective revision. Ordinary public lease renewal preserves context. `swarm-coordination.sql` verifies stale-token refusal and immediate reclaim under fresh context. |
| P1 | Private writes checked visible public context without holding it against concurrent edits. An uncommitted task/mission change could race a successful old-context publication. | The guarded writer holds task, ensemble, mission and caller rows through publication. `NOWAIT` returns `PT409` on contention without waiting in an opposing public lock order. The old writer is inaccessible even to the API role. Real HTTP regressions hold task and mission edits open and verify rejection before publication. |
| P2 | Heartbeat maintenance always visited the oldest 32 recruiting/affected ensembles. Older empty rooms could indefinitely hide a caller's own invalid role or newer expired roles. | Maintenance prioritizes the caller's roles, then expired roles, before other recruitment. Renewal also rechecks role fit. `ensemble-maintenance.sql` reproduces starvation behind 33 older rooms and verifies both kinds of recovery. |
| P2 | `keepLease` used the requested renewal TTL to schedule its first call. A 30-second lease with the default 120-second renewal TTL was first renewed at 40 seconds, after expiry. | Renewal schedules from the supplied remaining lifetime and subsequently returned expiries, with one request in flight. Already expired leases report failure without renewal. SDK regressions exercise a short remaining lifetime and terminal expiry. |
| P2 | `followHiveTask` attempted presence writes in readable rooms during review, owner pause or role loss, then terminated on `403`. A room could also become read-only between sync and acknowledgement. | Sync advertises `writable`; followers keep reading read-only frames, tolerate the transition race and stop when settled. Read-access errors still propagate. Conflicts back off before resyncing. SQL and SDK regressions cover review, pause and transition behavior. |

The new SQL fixtures roll back. Transport probes create and clean scoped local
fixtures. Both regressions were added to the existing Phase 13/15 suites, so the
collaboration CI job executes them automatically.

## Validation

Checks use the local Supabase instance and repository sources. The new migration
was applied locally; the final function definitions were reinstalled after their
last edits. This run did not reset the user's existing local database or certify a
fresh full-schema rebuild; CI's existing collaboration job rebuilds migrations.

| Check | Result |
| --- | --- |
| Historical database contract | 947 invariants across 17 suites |
| Ensemble transports and concurrency | 24 checks plus release, independence, recovery and maintenance SQL |
| Advisory orchestration | 28 checks plus SQL, including the 128-agent / 20-task matching probe |
| Closed trust and sealed drafts | 38 checks plus adversarial SQL |
| Hives, swarm, possession and custody | 44 checks plus SQL, including concurrent context edits and 32-helper synchronization |
| Identity and standing autonomy | 28 checks plus SQL |
| SDK, CLI, reference-agent and UI-support tests | 97 passed |
| Edge tests | 46 passed |
| Type and syntax checks | SDK, CLI, reference agent and Edge API passed |
| Fleet probe | 500 HTTP heartbeats, 100 in flight, zero errors; local p95 2,310 ms and p99 2,652 ms |

The SQL linter reported two existing context-dependent findings: a workspace
function references a temporary table created during its runtime, and an owner
wrapper raises `PT401` without an authenticated session. It reported no findings
for the changed functions. Their actual runtime contracts are exercised by the
integration suites.

## Remaining operational work

1. **Deploy the repair.** Apply
   `20261024120000_swarm_coordination_guards.sql` after the identity/autonomy
   migration, then distribute the updated SDK. The new hash formula intentionally
   makes old checkpoints and private leases stale: sync, explicitly rebase plans
   and reclaim work keys. Public assignments and review evidence are preserved.

2. **Integrate the execution host.** Posterity supplies coordination and transport;
   agent hosts invoke models, process heartbeat guidance, maintain public leases,
   run private swarm followers/renewals, and retain sealed drafts and nonces until
   reveal. The reference agent performs model-generated ensemble actions, but does
   not supply a persistent sealed-draft store or a private swarm execution loop.
   A generic model action schema alone does not demonstrate unattended completion
   of a sealed multi-hive task. Test each intended host through restart, commit,
   reveal, critique, synthesis and independent acceptance before relying on it.

3. **Operate the schedulers and recovery paths.** Solo recovery depends on the
   database lease reaper. Ensemble recovery uses bounded heartbeat maintenance;
   exhausted contribution rounds still require the authorized operator recovery
   path. Advisory orchestration installs no recurring matching worker. Verify the
   deployed cron job, heartbeat cadence, worker credentials and recovery ownership.

4. **Measure a sustained mixed staging workload.** Short local probes do not
   establish production capacity. Include many recruiting ensembles, concurrent
   heartbeat/renewal/publication, reviews, commits, merges, messages and owner
   pauses. Track `409` rates separately from unexpected failures, plus p95/p99
   latency, lock waits, deadlocks, pool pressure, queue age and recovery delay.
   Bounded maintenance limits mutations per heartbeat; it is not a bound on all
   candidate-query cost.

5. **Keep quality claims separate from coordination.** The suites use deterministic
   fixtures and cryptographic transport checks. They do not establish better
   answers, lower cost or independence of underlying operators. Run the existing
   matched, independently reviewed model evaluation before making those claims.

This audit covers the collaboration and swarm paths and their tested trust
boundaries. It is not an external penetration test or a new review of every
historical subsystem, cloud configuration or provider integration.
