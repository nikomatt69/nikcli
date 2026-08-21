# Brain Consolidation Pass

| Field  | Value                                                                         |
| ------ | ----------------------------------------------------------------------------- |
| Status | **Proposed**                                                                  |
| Scope  | `src/brain/index.ts`, `src/brain/scheduler.ts`, `src/server/httpapi/brain.ts` |

The question this records: what the scheduled Brain pass reads, writes, and when it counts as done.

The answer is **a bounded session that rewrites two files**: project memory and user habits. The pass is not metadata-only. A timestamp (the lock file’s mtime) is written only when at least one of those files changed.

## The Surface

`Brain.trigger` / `Brain.shouldTrigger` in `src/brain/index.ts`. Scheduler in `src/brain/scheduler.ts`. HTTP in `src/server/httpapi/brain.ts`.

Defaults (`DEFAULTS`): `minHours: 24`, `minSessions: 5`, `enabled: true`, `memoryEnabled: true`. Config keys: `experimental.brain`, `experimental.memory`, `experimental.brainMinHours`, `experimental.brainMinSessions`, `experimental.brainModel`.

## Trigger

`shouldTrigger` is false unless **both** `isBrainEnabled()` and `isMemoryEnabled()`. Then:

1. Hours since `readLastBrainAt()` ≥ `minHours`. Last-run is `fs.stat` mtime of `Global.Path.state/.brain-lock` (missing → `0`).
2. Session scan is throttled to once per 10 minutes (`SCAN_THROTTLE_MS`).
3. Sessions in this project with `time.updated` after last-run ≥ `minSessions`.

That is AND of those gates, not “hours OR sessions”. `trigger({ force })` still requires both flags; `force` only fills an empty session list from recent sessions.

A Flock lease (`Flock.acquire("brain", { staleMs: 1h, timeoutMs: 100 })`) serializes runs. Lock held → `{ success: false, error: "lock held" }`.

## What it reads

`buildSessionReviews` takes up to 10 session ids (`SESSION_REVIEW_LIMIT`), loads each session plus **40 messages**, formats user/assistant text, truncates each review to 12_000 chars (`SESSION_REVIEW_MAX_CHARS`). It reads message bodies. Scope is `SessionRepo.getByProject(Instance.project.id)` — this project, not every worktree on disk.

It also reads the current memory file and habits file into the prompt.

## What it writes

Two files, via an agent session (not a direct write of the summary):

- Project memory: `{Instance.directory}/.github/instructions/memory.instruction.md`
- User habits: `Profile.habitsFile(...)` (`.nikcli/habits.md` under the project root)

The Brain session is created with a tight ruleset: deny `*`, then allow `read` / `edit` / `glob` / `grep` / `list` / `tree`; deny `todowrite` / `todoread` / `task`. Timeout 5 minutes, then `sessionPrompt.cancel`.

`recordBrain()` writes the lock file with the pid. It runs **only if** memory or habits content changed after the session. Unchanged files → `{ success: false, error: "memory file unchanged" }` and no timestamp update.

## Model chain

`getBrainProviderModel(sessionID)`:

1. `experimental.brainModel` if that model resolves
2. Else `sessionModelOwn(sessionID)` (the triggering session)
3. Else the global default

A configured model that fails lookup falls through rather than aborting the pass.

## Idempotency

A crash mid-session leaves files as the agent left them and does not update the lock mtime, so the next tick can run again. The pass is **not** side-effect-free on a partial run: the agent may have already edited memory or habits. Empty / failed LLM is “do not stamp last-run”.

## Alternatives Rejected

**Metadata-only marker.** The pass exists to maintain memory and habits. A timestamp with no file write would not feed the next session’s prompt.

**Auto-inject a hidden summary.** The files are user-visible and editable (`/profile` turns habits off). That is the review surface.

**Cross-worktree rollup.** Same project-id scoping as the rest of the instance.

## Invariants

- Both `experimental.brain` and `experimental.memory` must be on (default on).
- Last-run is the lock-file mtime, stamped only when a file changed.
- Reviews include message text, capped.
- The agent may edit only the two named files under the listed tools.
- Model: `brainModel` → triggering session → default.

## What Is Explicitly Not Covered

- An “active Brain planner” (ROADMAP §later). This pass is consolidation, not a planner.
- Cost / token budget for the Brain session.
- HTTP request/response bodies (read `httpapi/brain.ts`).
