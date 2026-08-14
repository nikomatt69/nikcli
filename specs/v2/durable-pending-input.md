# Decision: Durable Pending Input

| Field  | Value                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| Status | **Proposed** (roadmap S1). Do not implement until this record is accepted.                                       |
| Scope  | `src/session/prompt.ts`, `src/session/prompt-state.ts`, a new `session_pending` table, prompt HTTP admission     |
| Buys   | Steer a running turn, queue a follow-up that waits for idle, and a compaction barrier that actually blocks input |
| Blocks | S4 (the v2 write path has nothing to swap to without this), and any credible hard-crash recovery of _input_      |

## Summary

Admission today writes the user message straight into visible Session History. There is no pending row, no promotion transaction, and no delivery mode. A second caller joins the active loop and receives the owner's result. Compaction cannot keep new input off the next model request.

The change is one durable queue in front of history: `session_pending`. Admission inserts a pending row. A single promotion transaction moves a batch into visible history at a **safe step boundary**. Delivery mode chooses _when_ that transaction runs.

Live execution stays process-local (`PromptState`). Pending input does not.

## Why This Is Needed

Verified against `packages/nikcli/src/session` on 2026-08-14:

- `SessionPrompt.admit` (`prompt.ts`) cleans up an uncommitted revert, calls `createUserMessage`, touches the session, and optionally writes per-prompt tool permissions. The message is in history before `loop` starts. `POST /session/:id/prompt_async` relies on that: it admits, returns `204`, then schedules `loop`.
- `loop` that loses `PromptState.start` parks `{ resolve, reject }` on the owner's entry (`prompt.ts` + `prompt-state.ts`). That is join-on-active, not a queue. The second prompt's text is already in history (because `prompt` always `admit`s first), so the running turn sees it on the next history re-read. The parked waiter only receives the owner's final assistant message.
- Loop exit (`prompt.ts`) re-reads history and, if a user message arrived with `id > lastAssistant.id`, resets `step` to 0 and continues. That is how a mid-turn admit becomes the next user turn — there is no other delivery path.
- `PromptInput.messageID` is optional. Reusing a message id overwrites the projected row (`createUserMessage`). There is no retry-vs-conflict reconciliation.
- Cancellation (`PromptState.cancel` / instance dispose) aborts the owner and rejects every parked waiter with `MessageV2.AbortedError`. Admitted messages stay. There is nothing "pending" to preserve, because pending does not exist.
- Compaction (`session/compaction.ts`) decides `"continue" | "stop"` for the running loop. It has no handle that means "do not promote input until this compaction finishes".

Graceful restart (S2) already continues an interrupted _turn_ from history. It cannot continue input that was never distinguished from history, and it cannot restore a join-on-active waiter.

## Decision

### Durable fact

Add `session_pending`, keyed so a session can hold several rows and promotion can take a prefix in one statement:

```sql
CREATE TABLE session_pending (
  id          TEXT    NOT NULL PRIMARY KEY,
  session_id  TEXT    NOT NULL,
  delivery    TEXT    NOT NULL,  -- 'steer' | 'queue'
  message_id  TEXT    NOT NULL,  -- client-supplied or assigned at admit
  data        TEXT    NOT NULL,  -- the whole PromptInput payload (parts, model, agent, …)
  created_at  INTEGER NOT NULL
);

CREATE INDEX session_pending_session_created
  ON session_pending(session_id, created_at);
```

`data` holds the whole admission payload, matching the domain-repo pattern (`data` is the record; columns beside it exist only to query or order). Sanitization on read. No foreign key to `session_info`: a pending row must survive a session row that is being rewritten, and explicit delete on `Session.remove` is the cascade.

A pending row is **not** a user message. It is not in `message_info`, not in `session_entry`, not on `GET /session/:id/message`, and not in `MessageV2.stream`. Clients that need to show "typed, not yet sent to the model" read the pending list, not history.

### Delivery modes

| Mode    | When the promotion transaction runs                                          | What the model sees                               |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| `steer` | At the next **safe step boundary** of an active loop, or immediately if idle | The next LLM call, after the current step commits |
| `queue` | When `PromptState` has no owner for the session (loop idle)                  | A new turn, after the current one has exited      |

Default for today's `prompt` / `prompt_async` is **`queue` when a loop owns the session, otherwise promote immediately** — that preserves "my message is in history before 204" for the idle case that `prompt_async` was built for, and stops the idle-path from growing a pending row the user never asked to inspect.

An explicit `delivery` field on the prompt body opts into `steer`. The HTTP default stays queue-or-immediate so existing clients do not start steering by accident.

### Safe step boundary

A boundary is the moment `loop` has finished one logical LLM call (including tool results written) and is about to either exit or start the next `step++`. Concretely: after the current assistant `finish` is durable, before the next `SessionProcessor` request.

- **Not** mid-stream, mid-tool, or mid-retry. Those reuse the assistant message (`session.md` §Retry).
- **Not** during `SessionCompaction.process`. Compaction is the barrier: pending rows stay pending until `process` returns `"continue"` or `"stop"` and the compaction parts are durable. Then `steer` may promote; `queue` still waits for idle.
- Instruction sync (S3) names the same boundary. S1 lands the boundary; S3 emits its delta there. Do not invent a second one.

### Promotion transaction

One `Database.transaction`:

1. Select pending rows for the session in `created_at` order, restricted by mode (`steer` at a boundary; `queue` only when idle).
2. Insert the corresponding user messages through the existing `createUserMessage` path (so parts, format, and permissions stay one code path).
3. Delete the promoted pending rows.
4. Reset `step` to 0 **once per batch**, not once per row. That is the ROADMAP "step allowance resets once per batch" rule — a burst of steered lines is one new user turn, not N nested turns.

If the session is gone, the transaction deletes the pending rows and does not create messages.

### Identity

`message_id` on the pending row is unique per session.

- An admit that reuses a pending `message_id` with byte-identical `data` is a retry: no-op, return the existing pending id.
- An admit that reuses a pending `message_id` with different `data` is a conflict: reject, do not overwrite.
- An admit that reuses a `message_id` already in `message_info` is a conflict unless the stored user message is byte-identical (then it is an already-promoted retry).

This is what today's overwrite cannot say.

### Interrupt and restart

- `PromptState.cancel` still aborts the owner and rejects in-memory waiters. It does **not** delete `session_pending`.
- Instance dispose and graceful shutdown (S2) likewise leave pending rows. S2 already resumes the loop from history; on resume, `queue` rows wait for idle and `steer` rows promote at the first boundary of that resumed loop.
- A hard crash never writes S2's `time_suspended`, but pending rows are ordinary SQL, so they survive. They are not auto-promoted until a process admits a loop for that session. That is input durability without claiming turn recovery.

Callers that today park on `PromptState` callbacks for a second `prompt()` must instead: admit as pending (`queue`), and wait on "this pending id was promoted and its turn finished" — not on the owner's assistant message. Join-on-active remains for callers that did **not** admit new input (status subscribers, the original `prompt()` owner).

### Wire

- `admit` / `prompt` / `prompt_async` gain optional `delivery: "steer" | "queue"`. Omitted keeps the default above.
- A pending list endpoint is required so a client can render unpromoted input. Shape follows `PromptInput` plus `id`, `delivery`, `created_at`. Not a `MessageV2` user message.
- Promotion publishes a bus event (`session.pending.promoted`) so SSE clients can stop drawing the pending row and start drawing history. No new SSE route.

## Rejected Alternatives

- **Keep writing to history and call the exit-window re-read "steering".** That is today's behavior. The running turn sees the text on the next step with no way to hold it back, and compaction cannot refuse it. Rejected because it cannot express queue or a barrier.
- **In-memory queue on `PromptState.Entry`.** Dies with the process. S2 already showed that process-local ownership is the wrong place for anything the next server must see. Pending input is in that class.
- **A `hidden` / `pending` flag on `message_info`.** Every list, compact, export, and `toModelMessage` path would have to filter it. A missed filter leaks input to the model — the exact bug this item exists to make unrepresentable. A separate table makes "not in history" structural.
- **Treat join-on-active as the second-prompt API.** The waiter receives the owner's result, not a turn for its own text. Steering and queueing are different products; collapsing them keeps the current confusion.
- **Promote one row per boundary, never a batch.** A user who steers three lines during one tool call would get three step-allowance resets and three user turns. The ROADMAP rule is one reset per batch.
- **Promote inside the compaction transaction.** Compaction's job is to rewrite _existing_ history. Mixing in new user text makes the summary and the new input race. Barrier first, promote after.

## What Is Explicitly Not Covered

- **Hard-crash turn recovery.** Pending input surviving a crash is not the same as resuming a dispatched provider call. That still needs provider-dispatch ambiguity, tool idempotency, and retry budgets (ROADMAP non-goal).
- **Clustering / fencing.** Ownership stays process-local. Two servers promoting the same pending row is prevented by the SQL transaction, not by a lock service.
- **Changing `prompt_async`'s 204-before-loop for the idle case.** Idle admit still lands in history before 204, so existing clients keep observing their message immediately.
- **S3 instruction deltas.** They share the safe boundary; they are not pending input.
- **S4 v2 writes.** This item makes pending input real so S4 does not reimplement join-on-active.

## Order Of Work

1. Migration: `session_pending` + index. Journal assertion in `test/database/database.test.ts`. No behavior change.
2. `SessionPending` repo (synchronous, `Database.syncDb()`, `data` holds the payload). Admit idle path unchanged.
3. `admit` writes pending when a loop owns the session, or when `delivery: "steer"` is set on an idle session that should wait for an explicit loop (rare; default still immediate).
4. Promotion at the loop boundary and on idle entry. `step = 0` once per batch.
5. Compaction barrier: `process` does not observe pending rows; promotion waits until it returns.
6. Identity (retry vs conflict) and the pending list + `session.pending.promoted` event.
7. Callers that currently join-on-active _after admitting_ move to wait-on-promotion. Status-only join-on-active stays.

Steps 1–2 are inert. Step 3 is the first behavior change (a busy-session `prompt_async` stops appearing in history before the current step finishes). Existing tests that admit during a live loop and assert the user message is already in `MessageV2.stream` will break, and should — they are coupled to the layout this item ends.

## Verification

A later implementation must cover:

- idle `prompt_async` still 204s with the user message already in history;
- `steer` during a live loop is absent from `MessageV2.stream` until the next boundary, then present, and `step` reset happens once for a two-row batch;
- `queue` during a live loop stays pending until `loop` exits, then promotes and starts a new turn;
- compaction in flight: pending rows are not in the compacted request;
- cancel / dispose / S2 resume: pending rows remain and promote on the rules above;
- identical `message_id` + `data` is a retry; different `data` is a conflict;
- `Session.remove` deletes pending rows for that session.

Do not verify with the simulation harness.
