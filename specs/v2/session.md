# Session Contract

Status: **Current semantic overview** (verified 2026-08-14 against `packages/nikcli/src/session`).

`MessageV2` owns the durable message and part shapes. `SessionPrompt` owns admission and the step loop. `SessionV2` owns the flat entry read model. The HttpApi groups own the public operations. Where this document and those modules disagree, the modules are right.

## Admission Precedes Execution, But Is Not Durable Pending Input

`SessionPrompt` exposes admission and execution as two operations:

| Operation         | Effect                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `admit(input)`    | Cleans up an uncommitted revert, writes the user message, touches the session, applies per-prompt tool permissions. No model call. |
| `loop(sessionID)` | Runs the step loop until the projected history says the turn is finished.                                                          |
| `prompt(input)`   | `admit` then `loop`. With `noReply: true` it stops after `admit`.                                                                  |

`POST /session/:id/prompt_async` calls `admit` and returns `204` before scheduling `loop`, so a client observes its own message immediately instead of waiting for the first token. `POST /session/:id/message` is the synchronous form.

The admitted message is written straight into visible Session History. There is **no pending row and no promotion transaction**: nikcli has no `steer` / `queue` delivery mode, no coalesced compaction barrier, and no way to record input that the model must not see yet. A prompt admitted during an active turn is visible to the next step of that turn simply because the step loop re-reads history.

Reusing a session ID adopts the existing session. Reusing a message ID overwrites the projected row; there is no retry reconciliation that distinguishes an exact retry from a conflicting reuse.

> **Gap.** Durable pending input is the precondition for steering, queued prompts, and a compaction barrier that actually blocks input. The decision is recorded in [durable pending input](./durable-pending-input.md). Graceful restart already continues an interrupted turn from history ([restart continuation](./session-restart-continuation.md)). See [../ROADMAP.md](../ROADMAP.md) item S1. Do not implement until that record is accepted.

## Execution Is Process-Local And Single-Flight Per Session

`PromptState` is an `InstanceState` map keyed by session ID, so ownership is per process **and** per instance directory. `PromptState.start(sessionID)` either reserves the session and returns an `AbortController`, or returns `undefined` because a loop already owns it.

A caller that loses the race does not start a second loop and does not fail. It parks a `{ resolve, reject }` pair on the owner's entry and receives the owner's final assistant message. This is join-on-active, not a queue:

- Explicit second prompts join the active execution for the same session.
- Different sessions run concurrently.
- Interruption aborts the owner and rejects every parked waiter with `MessageV2.AbortedError`.
- Disposing the instance aborts every live entry and rejects its waiters.

Ownership lives only in memory. `sessions.active()`-style liveness is a snapshot of this process, never a durable fact. A graceful shutdown writes `session_info.time_suspended` and the next server resumes each claimed row once; a hard crash never writes the mark, so the durable rows remain and the loop does not. See [restart continuation](./session-restart-continuation.md).

`SessionRunner` (`src/session/runner.ts`) is a separate single-flight state machine — `Idle | Running | Shell | ShellThenRun` — used where a shell command (`!cmd`) and a model run compete for one session. It guarantees at most one shell plus at most one run, and forks into a caller-supplied `Scope`. It does not replace `PromptState`.

## One Step Owns One Logical LLM Call

Each iteration of `loop`:

1. Sets status `busy` and exits early if the abort signal fired.
2. Reloads the session and `MessageV2.filterCompacted(MessageV2.stream(sessionID))` — history after the compaction boundary.
3. Scans backwards for the last user message, last assistant, last _finished_ assistant, and any pending `compaction` / `subtask` parts.
4. Terminates when the last assistant finished for a reason other than `tool-calls` / `unknown` **and** its `parentID` is the last user message id. Ordering uses `parentID`, not id comparison, because independently generated timestamp ids can skew.
5. Before terminating, re-reads history once. A user message that arrived during the exit window resets `step` to 0 and continues the loop instead of dropping the prompt.
6. Otherwise resolves the model, drains one queued `subtask` part through the `task` tool, or performs one provider request through `SessionProcessor`.

The first step also fires title generation (`PromptTitle.ensure`) without blocking.

Continuation is derived from projected history rather than from an in-memory tool loop: after a tool result is written, the next iteration re-reads history and starts a new step. That is what makes a resumed loop able to continue a turn another process started.

## Retry Is Narrow And Bounded

`SessionProcessor` retries a provider failure only when `SessionRetry.retryable(error)` classifies it as retryable, and only while the attempt count is at or below `RETRY_MAX_ATTEMPTS` (5).

Backoff is `2000ms * 2^(attempt-1)`, clamped to 30s when the provider sends no timing headers. `retry-after-ms`, numeric `retry-after`, and HTTP-date `retry-after` all override the computed delay. Sleeping is abort-aware and rejects with `AbortError` the moment the session is cancelled.

Retries reuse the assistant message. A content-filter finish is terminal, and any streamed partial content stays visible.

## Compaction Rebuilds Active History

`session/overflow.ts` computes the usable budget for a model:

```
reserved = config.compaction.reserved ?? min(20_000, maxOutputTokens(model))
usable   = model.limit.input ? max(0, model.limit.input - reserved)
                             : max(0, model.limit.context - maxOutputTokens(model))
```

`isOverflow` compares `tokens.total` (or the sum of input, output, and both cache counters) against `usable`. It returns `false` when `compaction.auto === false` or the model declares no context limit.

`SessionCompaction` then owns four operations: `isOverflow`, `create` (write a summary and a compaction boundary), `process` (decide `"continue" | "stop"` for the running loop), `prune`, and `editContext`. Pruning keeps `PRUNE_PROTECT` (40k) of recent context and only engages above `PRUNE_MINIMUM` (20k).

Consecutive compaction failures are capped at `MAX_CONSECUTIVE_COMPACTION_FAILURES` (3) per session, so a context window too small to hold its own summary fails loudly instead of looping.

The full transcript stays durable. `MessageV2.filterCompacted` is what makes the model see only the post-boundary window.

## Instructions Are Rebuilt Per Request

`collectSystemPaths` walks up from the instance directory to the worktree root collecting `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and `.github/instructions/memory.instruction.md`, plus global `~/.config/nikcli/AGENTS.md` and (unless disabled) `~/.claude/CLAUDE.md`. Config-declared instructions and URLs are resolved the same way; `NIKCLI_DISABLE_PROJECT_CONFIG` and `NIKCLI_CONFIG_DIR` narrow the search.

The result is assembled into the system prompt on every request. Nothing about instruction _state_ is durable: there is no content hash, no delta event, and no epoch. A file edited mid-session silently changes the next request's prefix, which also invalidates the provider prompt cache.

> **Gap.** See [instruction sync](./instruction-sync-proposal.md) and ROADMAP item S3.

## The Entry Model Is A Read Model

`SessionV2` (`src/session/v2/*`) is the flat entry redesign, landed by strangler:

- **Reads are native v2.** Completed messages come from SQL and convert losslessly through `SessionEntry.fromV1Part`; the in-flight tail comes from `SessionProjector`, which translates live v1 bus events into `SessionEvent`s reduced by `Stepper.stepWith`.
- **Writes are v1.** `SessionV2.create` and `SessionV2.prompt` delegate to `Session` and `SessionPrompt`, so retries, aborts, the tool state machine, snapshots, and permissions are exactly the production engine's.

Entries persist in `session_entry`. Since `20260805130000_session_entry_id_order`, entry ids are derived so lexicographic id order **is** conversation order (`SessionEntry.idForPart`) — the `sort_key` column is gone and neither server nor clients re-sort. The parallel `session_v2_event` table was dropped in `20260805120000`; the durable log is `sync_event`.

Adopting the v2 API today changes no behavior. Swapping the engine underneath is the isolated later step.

## Durable Events Are Bus Events Plus The Sync Log

Live events go through `Bus.publish`, which fans out to instance subscribers and mirrors onto `GlobalBus`. `GET /event` serves instance-scoped SSE (unwrapped `{type, properties}`); `GET /global/event` serves the cross-instance envelope (`{payload}`). Both send a `server.connected` greeting and a 30s heartbeat, and the instance stream closes on `server.instance.disposed`.

The durable, replayable log is `sync_event` (per project and workspace, with `origin` and `origin_seq`). SSE is volatile: it has no replay, no cursor, and no synchronization marker.

Both routes fan out through `EventFeed`: one encode per event, one lag budget per connection. A stalled reader is evicted with `SubscriberOverflowError`. See [event stream architecture](./event-stream-architecture.md).

## Recovery Boundaries Stay Explicit

- A hard crash or `SIGKILL` ends every loop. A graceful shutdown (`SIGINT`/`SIGTERM`) suspends the sessions this process is running and the next server resumes each one exactly once. See [restart continuation](./session-restart-continuation.md).
- Orphan tool calls are reconciled **at request assembly, not in storage**: `MessageV2.toModelMessage` turns any part still `pending` or `running` into an `output-error` with `[Tool execution was interrupted]`, because Anthropic-shaped APIs reject a `tool_use` without a matching `tool_result`. The projected row keeps its `running` status, so a client can render a spinner for a call that ended with the process that started it.
- Cancellation is process-local and immediate: abort the controller, reject waiters, set status idle. It never deletes the admitted user message.
- Automatic hard-crash continuation is out of scope until provider-dispatch ambiguity, tool idempotency, and retry budgets are designed together. Graceful restart is the tractable subset — see [restart continuation](./session-restart-continuation.md).
