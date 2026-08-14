# Pending input

Durably stage input before it reaches history.

| Field  | Value                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------- |
| Status | **Implemented** (roadmap S1, landed 2026-08-14)                                                         |
| Scope  | `src/session/pending.ts`, `src/session/prompt.ts`, `src/session/prompt-state.ts`, prompt HTTP admission |
| Buys   | Steering, queued follow-ups, durable retry identity, and a compaction barrier                           |

---

## Understand the flow

Admission now has a durable queue in front of Session History. Busy-session input is written to `session_pending`, then promoted into `message_info` and `message_part` at a safe boundary.

Live ownership and waiters remain process-local in `PromptState`. Pending input remains in SQL across cancellation, disposal, and restart.

An idle admission does not linger in the queue. Both `steer` and `queue`/default promote immediately when no loop owns the session; their behavior differs only while a turn is active.

---

## Store the durable fact

Migration `20260814100000_session_pending` adds `session_pending` with durable payload, delivery mode, message identity, creation order, and a per-session unique message index:

```sql
CREATE TABLE session_pending (
  id          TEXT    NOT NULL PRIMARY KEY,
  session_id  TEXT    NOT NULL,
  delivery    TEXT    NOT NULL,
  message_id  TEXT    NOT NULL,
  data        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
)
```

`data` contains the canonical complete `PromptInput`. A pending row is not a user message, so it is absent from message history and model input until promotion.

The same migration adds nullable `message_info.prompt_data`. Promoted messages retain the canonical admission payload, allowing a retry to distinguish identical reuse from a conflicting reuse after the pending row is gone.

---

## Choose delivery

| Mode    | While a turn is active                           | While idle          |
| ------- | ------------------------------------------------ | ------------------- |
| `steer` | Promote at the next safe step boundary           | Promote immediately |
| `queue` | Wait for the active turn to finish, then promote | Promote immediately |
| omitted | Behave as `queue` while active                   | Promote immediately |

`prompt` and `prompt_async` therefore keep their immediate idle behavior. An explicit `steer` changes only active-turn delivery.

The main TUI prompt path uses `delivery: "queue"` for Enter. Ctrl+Enter, or Cmd+Enter where supported, submits composer text with `delivery: "steer"`; slash commands preserve the selected delivery.

---

## Follow the cards

The TUI renders durable pending input after the transcript as queued message cards, without adding it to transcript history. Each queued card shows `press ctrl-enter to send`.

With an empty composer, Ctrl+Enter or Cmd+Enter steers the oldest queued card. Its badge changes from `QUEUED` to `STEERING` until promotion; Enter continues to queue new input.

---

## Promote atomically

Promotion prepares the ordered rows, then uses one `Database.transaction` to recheck availability, persist every message and part, update the session once, and delete the promoted rows. Concurrent promotion sees only rows still present.

The loop resets `step` to `0` once after a non-empty batch. Several inputs promoted together share one step-allowance reset and one reply target: the final user message in that batch.

If the session no longer exists, promotion deletes the selected pending rows without creating history. `Session.remove` also deletes all pending rows for that session.

---

## Respect the barrier

A safe boundary is after the current logical provider step and its tool results are durable, before the next request is assembled. Promotion never occurs mid-stream, mid-tool, or mid-retry.

When a compaction part is active, steer promotion is skipped. Input stays pending until `SessionCompaction.process` finishes and the compaction result is durable; queue/default still waits for idle.

---

## Reconcile retries

`message_id` identifies an admission within a session. Reusing it with the same canonical payload returns the existing pending row or promoted message without duplicating history.

Reusing it with different input raises `SessionPendingConflictError`. `session_pending.data` handles pre-promotion retries, while `message_info.prompt_data` preserves the same identity after promotion.

---

## Notify callers

`GET /session/:sessionID/pending` returns unpromoted `SessionPending.Info` records. Clients can render staged input without treating it as message history.

`POST /session/:sessionID/pending/:pendingID/steer` explicitly changes an existing queued row to `steer`. The TUI uses it for empty-composer steering, then refreshes pending state; it also refreshes after session sync and new admission.

Promotion publishes `session.pending.promoted` with `sessionID`, `pendingIDs`, and `messageIDs`. Existing instance and global event feeds carry it without a new SSE route.

`PromptState` waiters are targeted by `messageID`. Promotion waiters resolve only for their promoted message, while reply waiters for a promoted batch resolve when the assistant finishes against that batch's final user message.

---

## Handle interruption

Cancellation aborts the active owner, rejects its in-memory waiters, and leaves `session_pending` untouched. Instance disposal behaves the same way.

Graceful restart can resume a suspended loop from durable history. Steer rows promote at its first safe boundary, while queue/default rows wait for the resumed turn to finish; idle admission after restart still promotes immediately.

A hard crash also leaves committed pending rows in SQL, but does not recover an in-flight provider call or automatically resume the turn. Execution ownership remains process-local, and this design does not provide clustered placement or fencing.

---

## Verify behavior

`test/session/pending-input.test.ts` covers busy input staying out of history, identical retry reuse, conflicting reuse, idle immediate promotion, durable `prompt_data`, targeted promotion and reply waiters, cancellation rejection, and session removal cleanup.

`test/database/database.test.ts` asserts migration `20260814100000_session_pending`, the table, and the current journal. Source and generated-contract checks show the pending endpoint and promoted event; the focused unit test does not simulate provider execution, compaction, restart, or SSE delivery.

Verification does not claim automatic hard-crash turn recovery or clustered ownership, and does not use the simulation harness.
