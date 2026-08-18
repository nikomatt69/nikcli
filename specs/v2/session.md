# Session contract

Tracks admission, execution, recovery, and client behavior.

Status: **Current semantic overview** (verified 2026-08-14 against `packages/nikcli/src/session`).

`MessageV2` owns the durable message and part shapes. `SessionPrompt` owns admission and the step loop.

`SessionV2` owns the flat entry read model, while HttpApi groups own public operations. Where this document and those modules disagree, the modules are right.

---

## Admit before execution

`SessionPrompt` exposes admission and execution as two operations:

| Operation         | Effect                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `admit(input)`    | Cleans up an uncommitted revert, durably admits input, and either promotes it immediately or leaves it pending. No model call. |
| `loop(sessionID)` | Runs the step loop until the projected history says the turn is finished.                                                      |
| `prompt(input)`   | `admit` then `loop`. With `noReply: true`, it returns the immediate message or waits only for pending promotion.               |

`POST /session/:id/prompt_async` calls `admit` and returns `204` before scheduling `loop`. Idle input is already in history at that point; busy input may remain in `session_pending` according to its delivery mode.

Both `queue` and omitted delivery promote immediately while the session is idle, and at the next safe step boundary while a turn is active. `steer` aborts the active turn, then persists and runs the new message immediately.

The TUI renders busy input as pending message cards after the transcript, not as transcript history. Queue cards show `sends at the next safe step`. Steer cards show `interrupts and sends now`.

Enter submits composer text as queue. Ctrl+Enter, or Cmd+Enter where supported, submits new text as steer (interrupt and send now); with an empty composer it interrupts and sends the oldest queued card.

Busy input is stored outside history in `session_pending`. Promotion batches ordered rows into messages and parts in one transaction, removes the pending rows, and resets the loop's step allowance once for the batch.

`session_pending.data` and nullable `message_info.prompt_data` store the canonical prompt payload. Reusing a message id with identical input is a retry; different input raises `SessionPendingConflictError` rather than overwriting history.

`GET /session/:id/pending` exposes staged input, and `POST /session/:id/pending/:pendingID/steer` changes an existing queued row to steer. The TUI refreshes pending state during session sync and after admission or explicit steering.

Promotion publishes `session.pending.promoted` with pending and message ids; see [pending input](./durable-pending-input.md).

---

## Keep execution process-local

`PromptState` is an `InstanceState` map keyed by session ID, so ownership is per process **and** per instance directory. `PromptState.start(sessionID)` either reserves the session and returns an `AbortController`, or returns `undefined` because a loop already owns it.

A caller that loses the race does not start a second loop. New input is admitted to the durable queue, while `PromptState` parks a targeted waiter for its `messageID`:

- Promotion waiters resolve only when their message is promoted.
- Reply waiters resolve against the final message in their promoted batch.
- Different sessions run concurrently.
- Interruption aborts the owner and rejects every parked waiter with `MessageV2.AbortedError`, without deleting durable pending rows.
- Disposing the instance aborts every live entry and rejects its waiters.

Ownership lives only in memory. `sessions.active()`-style liveness is a snapshot of this process, never a durable fact. A graceful shutdown writes `session_info.time_suspended` and the next server resumes each claimed row once; a hard crash never writes the mark, so the durable rows remain and the loop does not. See [restart continuation](./session-restart-continuation.md).

---

## Own one logical call

Each iteration of `loop`:

1. Sets status `busy` and exits early if the abort signal fired.
2. Reloads the session and `MessageV2.filterCompacted(MessageV2.stream(sessionID))` — history after the compaction boundary.
3. Scans backwards for the last user message, last assistant, last _finished_ assistant, and any pending `compaction` / `subtask` parts.
4. Terminates when the last assistant finished for a reason other than `tool-calls` / `unknown` **and** its `parentID` is the last user message id. Ordering uses `parentID`, not id comparison, because independently generated timestamp ids can skew.
5. At safe boundaries, promotes a steer batch and resets `step` once. An active compaction part blocks this promotion.
6. Before terminating, resolves the completed batch, promotes queued input, resets `step` once, and continues when that batch is non-empty.
7. Otherwise resolves the model, drains one queued `subtask` part through the `task` tool, or performs one provider request through `SessionProcessor`.

The first step also fires title generation (`PromptTitle.ensure`) without blocking.

Continuation is derived from projected history rather than from an in-memory tool loop: after a tool result is written, the next iteration re-reads history and starts a new step. That is what makes a resumed loop able to continue a turn another process started.

---

## Bound retries

`SessionProcessor` retries a provider failure only when `SessionRetry.retryable(error)` classifies it as retryable, and only while the attempt count is at or below `RETRY_MAX_ATTEMPTS` (5).

Backoff is `2000ms * 2^(attempt-1)`, clamped to 30s when the provider sends no timing headers. `retry-after-ms`, numeric `retry-after`, and HTTP-date `retry-after` all override the computed delay. Sleeping is abort-aware and rejects with `AbortError` the moment the session is cancelled.

Retries reuse the assistant message. A content-filter finish is terminal, and any streamed partial content stays visible.

---

## Rebuild active history

`session/overflow.ts` computes the usable budget for a model:

```
reserved = config.compaction.reserved ?? min(20_000, maxOutputTokens(model))
usable   = model.limit.input ? max(0, model.limit.input - reserved)
                             : max(0, model.limit.context - maxOutputTokens(model))
```

`isOverflow` compares `tokens.total` (or the sum of input, output, and both cache counters) against `usable`. It returns `false` when `compaction.auto === false` or the model declares no context limit.

`SessionCompaction` then owns four operations: `isOverflow`, `create` (write a summary and a compaction boundary), `process` (decide `"continue" | "stop"` for the running loop), `prune`, and `editContext`. Pruning keeps `PRUNE_PROTECT` (40k) of recent context and only engages above `PRUNE_MINIMUM` (20k).

An active compaction part is a pending-input barrier. Steer rows remain outside history until `process` completes and its parts are durable; queue/default rows continue waiting for idle.

Consecutive compaction failures are capped at `MAX_CONSECUTIVE_COMPACTION_FAILURES` (3) per session, so a context window too small to hold its own summary fails loudly instead of looping.

The full transcript stays durable. `MessageV2.filterCompacted` is what makes the model see only the post-boundary window.

---

## Rebuild instructions per request

`collectSystemPaths` walks up from the instance directory to the worktree root collecting `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and `.github/instructions/memory.instruction.md`, plus global `~/.config/nikcli/AGENTS.md` and (unless disabled) `~/.claude/CLAUDE.md`. Config-declared instructions and URLs are resolved the same way; `NIKCLI_DISABLE_PROJECT_CONFIG` and `NIKCLI_CONFIG_DIR` narrow the search.

The result is assembled from the instruction fold (see [instruction sync](./instruction-sync-proposal.md)). Clients display changed keys from `session.instructions.updated`; they do not re-render the prose.

---

## Treat entries as a read model

`SessionV2` (`src/session/v2/*`) is the flat entry redesign, landed by strangler:

- **Reads are native v2.** Completed messages come from SQL and convert losslessly through `SessionEntry.fromV1Part`; the in-flight tail comes from `SessionProjector`, which translates live v1 bus events into `SessionEvent`s reduced by `Stepper.stepWith`.
- **Writes.** HTTP create/prompt go through `SessionV2`. Message/part events persist `session_entry` from the payload before the v1 row; v1 is `toV1*` of those entries. `prompt_data` stays on `message_info`. `SessionPrompt.loop` still runs the step engine. See [session v2 write path](./session-v2-write-path.md).

Entries persist in `session_entry`. Since `20260805130000_session_entry_id_order`, entry ids are derived so lexicographic id order **is** conversation order (`SessionEntry.idForPart`) — the `sort_key` column is gone and neither server nor clients re-sort. The parallel `session_v2_event` table was dropped in `20260805120000`; the durable log is `sync_event`.

`MessageV2` remains the LLM layer. Rewriting `SessionProcessor` or `toModelMessages` to consume entries is out of scope.

---

## Persist bus events and sync logs

Live events go through `Bus.publish`, which fans out to instance subscribers and mirrors onto `GlobalBus`. `GET /event` serves instance-scoped SSE (unwrapped `{type, properties}`); `GET /global/event` serves the cross-instance envelope (`{payload}`). Both send a `server.connected` greeting and a 30s heartbeat, and the instance stream closes on `server.instance.disposed`.

The durable, replayable log is `sync_event` (per project and workspace, with `origin` and `origin_seq`). SSE is volatile: it has no replay, no cursor, and no synchronization marker.

Both routes fan out through `EventFeed`: one encode per event, one lag budget per connection. A stalled reader is evicted with `SubscriberOverflowError`. See [event stream architecture](./event-stream-architecture.md).

---

## Keep recovery explicit

- A hard crash or `SIGKILL` ends every loop. A graceful shutdown (`SIGINT`/`SIGTERM`) suspends the sessions this process is running and the next server resumes each one exactly once. See [restart continuation](./session-restart-continuation.md).
- Orphan tool calls are reconciled **at request assembly, not in storage**: `MessageV2.toModelMessage` turns any part still `pending` or `running` into an `output-error` with `[Tool execution was interrupted]`, because Anthropic-shaped APIs reject a `tool_use` without a matching `tool_result`. The projected row keeps its `running` status, so a client can render a spinner for a call that ended with the process that started it.
- Cancellation is process-local and immediate: abort the controller, reject targeted waiters, and set status idle. It never deletes committed `session_pending` rows or promoted user messages.
- Graceful restart resumes claimed turns from history; pending steer rows wait for the first safe boundary and queue/default rows wait for turn completion. A hard crash preserves committed pending rows but does not itself resume execution.
- Automatic hard-crash continuation is out of scope until provider-dispatch ambiguity, tool idempotency, and retry budgets are designed together. Graceful restart is the tractable subset — see [restart continuation](./session-restart-continuation.md).
