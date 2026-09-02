# Loop Engine Contract

| Field  | Value                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                                                   |
| Scope  | `src/loop/engine.ts`, `src/loop/schema.ts`, `src/loop/manager.ts`, `src/loop/pr.ts`, `src/worktree/sandbox.ts` |

The question this records: how the headless loop engine schedules runs, enforces single-flight and capacity, and handles failures.

The answer is **a single-session runner driven through the Goal command**, isolated in a git worktree by default, with synchronous single-flight claiming and a strict concurrency ceiling.

## The Surface

`src/loop/engine.ts` owns execution; `src/loop/schema.ts` owns schemas; `src/loop/manager.ts` handles persistence; `src/worktree/sandbox.ts` manages git worktrees.

- **Trigger kinds**: `manual` | `interval` (`everyMs: number`). There is **no cron** syntax in the schema.
- **Capacity**: `MAX_CONCURRENT_RUNS = 3`. When `inFlight.size > MAX_CONCURRENT_RUNS`, the incoming run is aborted immediately with reason `"capacity"` (no queue).
- **Single-flight**: Claim is **synchronous** in `runOnce(id)` before any `await`. A concurrent second trigger while a run is in-flight returns immediately.
- **Run lease & orphan recovery**: `LOOP_RUN_LEASE_MS = 15_000`. On server startup, `restore()` re-arms interval timers and reconciles stale `running` runs whose lease expired to status `"orphaned"`.
- **Run execution**: A run executes stages sequentially in a dedicated session. Each stage is driven via `SessionPrompt.command({ command: "goal" })` using the stage's prompt.
- **Sandboxing**: Runs in an isolated git worktree via `RunSandbox.ensure(def)` by default. Can be opted out with `sandbox: false`.
- **Permissions**: Sandboxed unattended runs use `PermissionRuleset.fullAccess()` (`* / * allow`, deny `question`, `plan_enter`, `plan_exit`).
- **PR creation**: Optional auto-PR hook (`src/loop/pr.ts`) creates a branch and opens a PR on successful run completion if configured.

## Alternatives Rejected

**Cron syntax.** `interval` with `everyMs` is deterministic and simple to schedule via core `Scheduler`.

**Run queueing on capacity.** Reject-and-abort avoids unbounded backlog growth during server saturation.

## Invariants

- Synchronous claim in `inFlight` map prevents race conditions on duplicate triggers.
- Global concurrency is strictly capped at `MAX_CONCURRENT_RUNS` (3).
- Stale running runs recover to `orphaned` after `LOOP_RUN_LEASE_MS`.
- Stages run sequentially in a single session under full-access permissions in a sandbox worktree.
