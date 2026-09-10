# Decision: Continue Sessions After A Graceful Server Restart

| Field  | Value                                                                                        |
| ------ | -------------------------------------------------------------------------------------------- |
| Status | **Implemented** 2026-08-14 (was roadmap S2)                                                  |
| Scope  | `src/cli/cmd/serve.ts`, `src/session/prompt-state.ts`, `src/session/repo.ts`, `session_info` |
| Buys   | `nikcli upgrade` and a server redeploy stop silently killing turns                           |
| Tests  | `test/session/restart-continuation.test.ts`                                                  |

## Summary

When a nikcli server shuts down gracefully, the sessions it was actively running should continue automatically the next time a server starts for the same data directory.

The mechanism is one private nullable timestamp on the session row: `time_suspended`. The shutting-down server suspends its active sessions before interrupting them; the next server atomically consumes each suspension and schedules at most one resume.

The field is **not** session status. Live activity stays process-local. Hard-crash recovery and exactly-once provider or tool execution stay out of scope.

## Why This Is Needed

`PromptState` holds ownership in memory (see [session](./session.md)). On shutdown:

- `serve.ts` resolves on the first `SIGINT`/`SIGTERM`, then closes keep-alive connections with a drain timeout.
- Instance disposal aborts every live `AbortController` and rejects every parked waiter with `AbortedError`.
- The admitted user message and every completed tool result stay durable.

So the transcript survives and the turn does not. From the user's side an upgrade or a restart looks like the model stopped mid-sentence, and the only recovery is to type something again — which is not the same thing, because it admits a new user message rather than continuing the existing one.

## Decision

Add one private field and a partial index:

```sql
ALTER TABLE session_info ADD COLUMN time_suspended INTEGER;

CREATE INDEX session_info_time_suspended_idx
  ON session_info(time_suspended)
  WHERE time_suspended IS NOT NULL;
```

A non-null `time_suspended` means exactly:

> A server suspended this session during graceful shutdown, at this time. The next server may make **one** attempt to resume it.

The name records the fact, not one consumer's policy, and the timestamp gives operators suspension age for free — a later policy can ignore suspensions older than some bound without a schema change.

`time_suspended` is a **private** column. It is not projected into `Session.Info`, not part of any public response, and not a status value clients can render. Session status stays `{ type: "idle" | "busy" }` and stays derived from the live process.

### Shutdown

Inside the existing graceful path in `serve.ts`, before instance disposal:

1. Snapshot the session ids this **process** is running (`PromptState.activeSessions()`).
2. Set `time_suspended = Date.now()` for those rows in one statement (`SessionRepo.suspend`).
3. Proceed with the existing abort-and-drain.

**Implementation note.** Step 1 does not iterate instances. `PromptState.State` is instance-scoped — correct for ownership, useless here, because "what is this process running?" has no instance to ask it in. `PromptState` keeps a flat process-level `Set<string>` alongside the per-instance map, maintained in `start`, `finish`, and the instance finalizer. Session ids are globally unique, so the flat set is exact, and its scope matches what a graceful shutdown can actually promise.

Ordering matters: suspend before interrupting. A crash between the two leaves a session marked suspended that was never interrupted, and a spurious resume is a re-entry into a loop that is idle — cheap and correct. The reverse order loses the turn on a crash, which is the failure being fixed.

### Startup

At server start, per data directory:

1. Claim suspended rows with a single `UPDATE session_info SET time_suspended = NULL WHERE time_suspended IS NOT NULL RETURNING id, directory` (`SessionRepo.consumeSuspended`). One statement rather than a transaction around a read and a write: only one racing server can observe a given row as non-null, so a session is resumed at most once by construction.
2. For each claimed row, bind the instance from its `directory` and start one `SessionPrompt.loop(sessionID)`, fire-and-forget. A resumed turn can run for minutes and startup must not wait on it; failures are logged and never fatal.
3. Resume is advisory: `loop` re-reads projected history and exits immediately if the turn is already finished.

The resume sweep is wired into **`ServeCommand` only**, not `Server.listen`. Embedded servers — the TUI's own worker, tests — share the data directory but are not the process that should adopt someone else's abandoned turn.

That last point is what makes this safe with no new execution semantics. `loop` already derives continuation from history rather than from in-memory state, so resuming a completed turn is a no-op and resuming an incomplete one continues from the last durable step.

## What Is Explicitly Not Covered

- **Hard crashes.** A `SIGKILL` or a panic never writes `time_suspended`, so nothing resumes. Fixing that needs provider-dispatch ambiguity, tool idempotency, and retry budgets designed together.
- **In-flight provider requests.** A request dispatched before shutdown may or may not have been billed and may or may not have produced output nikcli never saw. Resume starts a new step from durable history; it does not attempt to recover that request.
- **Non-idempotent tools.** A tool interrupted mid-side-effect is reconciled as `[Tool execution was interrupted]` at request assembly. Resume does not replay it.
- **Clustering.** Ownership stays process-local. Multiple servers on one data directory are guarded only by the atomic consume; real placement and fencing is a separate design.

## Verification

Covered by `test/session/restart-continuation.test.ts`:

- a suspension round-trips and carries the `directory` needed to bind the instance;
- a second claim comes back empty — each suspension is consumed exactly once;
- nothing was suspended ⇒ nothing is claimed (the hard-crash shape);
- the mark survives an unrelated `upsert` and `update`, because neither names `time_suspended` in its `set` clause. This is the one that would rot silently: adding the column to either write path would clear every pending suspension on the next unrelated session touch.
- `Session.Info` read back from the repo has no `timeSuspended` / `time_suspended` property — the column cannot reach the wire, because `Session.Info` is reconstructed from the `data` column alone.

Not covered by a test, and worth stating: end-to-end resume of a real interrupted turn. It needs a live provider loop across two server processes, which the unit suite cannot express — the pieces it rests on (`loop` deriving continuation from history) are covered in [session.md](./session.md).
