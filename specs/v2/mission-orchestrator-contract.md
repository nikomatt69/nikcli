# Mission Orchestrator Contract

| Field  | Value                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                                                      |
| Scope  | `src/mission/orchestrator.ts`, `src/mission/manager.ts`, `src/mission/schema.ts`, `src/server/httpapi/mission.ts` |

The question this records: how long-running multi-feature missions are structured, transitioned across states, and executed in isolated environments.

The answer is **a milestone- and feature-driven orchestrator** that executes features in dependency order within an isolated git worktree under full-access unattended permissions.

## The Surface

- **State Model**: `MissionStatus` (`"planning" | "ready" | "running" | "paused" | "frozen" | "complete" | "error"`).
- **Exec Status**: `ExecStatus` (`"running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"`).
- **Sandboxing**: Runs in a dedicated git worktree (`MissionWorktreeSchema`) unless explicitly opted out with `sandbox: false`. The worktree is created at mission initialization and reused across resumes.
- **Permissions**: Execution uses `PermissionRuleset.fullAccess()` so that unattended multi-hour runs do not hang on interactive permission prompts.
- **Dependency Graph**: Milestones contain features that can declare `dependsOn` lists. The orchestrator enforces that prerequisite features complete before downstream features are executed.
- **Validation**: Features and milestones support automated validation passes (`validation` model) before being marked complete.
- **HTTP Contract**: `src/server/httpapi/mission.ts` exposes CRUD and lifecycle control. `mission.start` accepts an optional/bodyless payload (`HttpApiSchema.NoContent`), and mutations use typed schemas without unvalidated fields.

## Lifecycle Invariants

- State transitions follow `planning -> ready -> running -> (paused | complete | error)`.
- Re-running or resuming an existing mission re-attaches to the established sandbox worktree.
- Execution records maintain heartbeats and lease recovery similar to loop runs.
