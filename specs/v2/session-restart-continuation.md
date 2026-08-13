# Decision: Continue Sessions After A Graceful Server Restart

| Field  | Value                                                              |
| ------ | ------------------------------------------------------------------ |
| Status | **Proposed and unimplemented**                                     |
| Scope  | `src/cli/cmd/serve.ts`, `src/session/prompt.ts`, `session_info`    |
| Buys   | `nikcli upgrade` and a server redeploy stop silently killing turns |

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

1. Snapshot the session ids currently owned by `PromptState` for every live instance.
2. Set `time_suspended = Date.now()` for those rows in one statement.
3. Proceed with the existing abort-and-drain.

Ordering matters: suspend before interrupting. A crash between the two leaves a session marked suspended that was never interrupted, and a spurious resume is a re-entry into a loop that is idle — cheap and correct. The reverse order loses the turn on a crash, which is the failure being fixed.

### Startup

At server start, per data directory:

1. Read suspended rows.
2. For each, **atomically** clear `time_suspended` and schedule one `SessionPrompt.loop(sessionID)`. The clear-and-schedule must be one transaction so two servers racing on the same directory cannot both resume the same session.
3. Resume is advisory: `loop` re-reads projected history and exits immediately if the turn is already finished.

That last point is what makes this safe with no new execution semantics. `loop` already derives continuation from history rather than from in-memory state, so resuming a completed turn is a no-op and resuming an incomplete one continues from the last durable step.

## What Is Explicitly Not Covered

- **Hard crashes.** A `SIGKILL` or a panic never writes `time_suspended`, so nothing resumes. Fixing that needs provider-dispatch ambiguity, tool idempotency, and retry budgets designed together.
- **In-flight provider requests.** A request dispatched before shutdown may or may not have been billed and may or may not have produced output nikcli never saw. Resume starts a new step from durable history; it does not attempt to recover that request.
- **Non-idempotent tools.** A tool interrupted mid-side-effect is reconciled as `[Tool execution was interrupted]` at request assembly. Resume does not replay it.
- **Clustering.** Ownership stays process-local. Multiple servers on one data directory are guarded only by the atomic consume; real placement and fencing is a separate design.

## Verification

- A session suspended and resumed on the same durable history reaches the same terminal state as an uninterrupted one.
- A session whose turn had already finished resumes as a no-op and clears its flag.
- Two servers started concurrently on one directory resume each session exactly once.
- A `SIGKILL` leaves no `time_suspended` rows and no resume attempts.
- `time_suspended` never appears in an HTTP response body or in the generated clients.
