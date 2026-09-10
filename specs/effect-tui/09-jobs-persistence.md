# EOT-09: Jobs, Persistence, and Resource Budgets

Status: proposed. Tier: 3. Phase: P3. Dependencies: EOT-02, EOT-04, EOT-10.
Owner: nikcli execution/domain repository maintainers. [Roadmap](../ROADMAP.md).

## Problem and Evidence

Evidence B03, B14, B18, B19: durable background records, ownership leases, monitor output limits, throttled persistence,
and sync journals already exist. The next step is predictable admission, durable terminal-state publication, and bounded
repository work. A new generic scheduler or SQL migration is not justified by the existence of Effect APIs.

## Scope and Non-Goals

Strengthen existing session/tool/delegation/monitor ownership and repository seams, starting with one job type. Preserve
`Database.syncDb()` repositories, schemas, logs, job IDs, and status wire compatibility. No live database operations,
dependency installation, distributed workflow platform, global worker-pool replacement, or default concurrency change
without characterization and review.

## Design and Requirements

1. Describe each execution path's admission class and owner: foreground session, local child process, background agent,
   provider request, and read-only index/cache task. Set per-instance and process-wide caps from EOT-01 measurements.
   Provide cancellation while queued, observable queue position/pressure, and fair scheduling so one session cannot starve
   another. Queued is not running; add wire state only through EOT-10 if the current contract cannot represent it.
2. Acquire capacity and resources in scoped Effect operations at the existing service boundary. Release permits on every
   Exit, including cancellation before launch. Do not hold database transactions or shared locks while waiting on network,
   child process exit, or user permission.
3. Preserve durable-job ownership beyond the submitting request's lifetime. Cancel explicitly by job identity; propagate
   cancellation to owned children/provider requests while preserving the durable record. Process restart recovery checks
   leases and ownership before adopting or orphaning work; do not infer liveness from PID existence alone.
4. Use a terminal-state transition guard in the repository transaction: a running job may settle complete/error/timeout/
   cancelled/orphaned according to its domain, but a late result cannot overwrite an already committed terminal state.
   Use actual process exit and persisted outcome, not upload accepted, stream EOF, or UI closure, as completion evidence.
5. Persist the terminal record and any required result/log reference before publishing completion. If notification fails,
   authoritative reads/recovery can discover the result. If the durable write fails, report a persistence failure; never
   publish a successful terminal event for a state that was not committed. Exactly-once external effects are not promised.
6. Preserve monitor's existing 32 KiB event and 64 KiB tail bounds and 1-second persistence coalescing unless evidence
   supports a change. Drain stdout/stderr without unbounded memory, retain the existing full log behavior, and flush final
   output before terminal publication. Separate log write failure from child execution success.
7. Profile repository queries and synchronous transaction duration before changing storage technology. Add stable-cursor
   pagination, projections, or indexes only for demonstrated hot paths; derive cache keys from instance/config revision.
   Keep transactions short and perform heavy transforms outside them. Schema/index migrations need explicit approval,
   additive rollout, and existing isolated-database tests; no destructive data cleanup in an optimization PR.
8. Reuse existing sync journal and snapshot machinery for recoverable state where appropriate. Event coalescing may reduce
   intermediate progress persistence but must never omit a terminal transition or required user decision. A process crash
   between commit and notification must still recover the final record without rerunning its external side effects.

## State and Race Policy

| Race                                     | Required resolution                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Cancel while waiting for capacity        | Remove queued work; no child starts; permit accounting unchanged                    |
| Cancel versus successful exit            | Repository transition wins once; late callback cannot rewrite terminal state        |
| Timeout versus output flush              | Final status records timeout; flush bounded final output or record its failure      |
| Restart versus stale worker heartbeat    | Validate owner/lease generation before accepting updates                            |
| Commit succeeds, event publication fails | Durable outcome remains queryable; recovery informs UI                              |
| Write fails after child succeeds         | Execution outcome and persistence failure are distinguished; no false success event |

## Failure and Cancellation

Use domain `Schema.TaggedError` for admission, process launch, persistence, and timeout failures where introduced; preserve
full Cause internally. Tool permission denial must occur before launch/admission side effects that need permission. A
cancelled Promise is not evidence of a killed process: verify process-tree termination, pipe closure, and log finalization
using supported platform helpers. Do not alter permission coupling (`monitor` to `bash`) during refactoring.

## Acceptance and Verification

- Queue more jobs than capacity, cancel queued/running jobs, and assert concurrent work never exceeds limits and all permits
  return. Verify fairness and submitter-disconnect survival for durable jobs.
- Race complete/cancel/timeout/restart with controlled barriers; exactly one terminal record remains and UI state agrees
  after reconnect. Inject failure between commit and event publication without rerunning the external operation.
- Flood output and slow the log sink; assert memory bounds, full-log behavior, final tail, real exit code, and visible disk
  write failure. A successful spawn or accepted upload cannot satisfy completion assertions.
- Exercise isolated repository restart/readback and lease-expiry cases. No tests use the user's database or real provider
  credentials. DB operations require the user's approval before execution, even when local fixtures are intended.
- Extend existing `packages/nikcli/test/background/`, `packages/nikcli/test/delegation/`, `packages/nikcli/test/tool/`,
  `packages/nikcli/test/database/`, and `packages/nikcli/test/sync/` cases for each migrated path.
- From `packages/nikcli`, select the changed path's individual test files; for the whole suite use `bun run test:ci`, not a
  single unsharded `bun test`. Use one final root `bun run typecheck` after the complete slice.
- Meet EOT-01 resource and latency budgets. Candidate repository target: p95 synchronous transaction under 10 ms for the
  reference session workload; any longer query gets a measured mitigation plan before admission limits are increased.

## Migration and Rollback

Start with monitor or one background job family, characterize current limits and transitions, add guards/metrics, then
introduce bounded admission and measured query improvements. Do not combine this with a storage-engine replacement.
Rollback scheduler/adapter changes while preserving durable records, terminal-state guards, and logs. Additive schema
changes require a tested compatibility/downgrade plan; never roll back by deleting user data or replaying side effects.
