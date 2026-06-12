# Message Shape

Problem:

- stored messages need enough data to replay and resume a session later
- prompt hooks often just want to append a synthetic user/assistant message
- today that means faking ids, timestamps, and request metadata

## Option 1: Two Message Shapes

Keep `User` / `Assistant` for stored history, but clean them up.

```ts
type User = {
  role: "user"
  time: { created: number }
  request: {
    agent: string
    model: ModelRef
    variant?: string
    format?: OutputFormat
    system?: string
    tools?: Record<string, boolean>
  }
}

type Assistant = {
  role: "assistant"
  run: { agent: string; model: ModelRef; path: { cwd: string; root: string } }
  usage: { cost: number; tokens: Tokens }
  result: { finish?: string; error?: Error; structured?: unknown; kind: "reply" | "summary" }
}
```

Add a separate transient `PromptMessage` for prompt surgery.

```ts
type PromptMessage = {
  role: "user" | "assistant"
  parts: PromptPart[]
}
```

Plugin hook example:

```ts
prompt.push({
  role: "user",
  parts: [{ type: "text", text: "Summarize the tool output above and continue." }],
})
```

Tradeoff: prompt hooks get easy lightweight messages, but there are now two message shapes.

## Option 2: Prompt Mutators

Keep `User` / `Assistant` as the stored history model.

Prompt hooks do not build messages directly. The runtime gives them prompt mutators.

```ts
type PromptEditor = {
  append(input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  prepend(input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  appendTo(target: "last-user" | "last-assistant", parts: PromptPart[]): void
  insertAfter(messageID: string, input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  insertBefore(messageID: string, input: { role: "user" | "assistant"; parts: PromptPart[] }): void
}
```

Plugin hook examples:

```ts
prompt.append({
  role: "user",
  parts: [{ type: "text", text: "Summarize the tool output above and continue." }],
})
```

```ts
prompt.appendTo("last-user", [{ type: "text", text: BUILD_SWITCH }])
```

Tradeoff: avoids a second full message type and avoids fake ids/timestamps, but moves more magic into the hook API.

## Option 3: Separate Turn State

Move execution settings out of `User` and into a separate turn/request object.

```ts
type Turn = {
  id: string
  request: {
    agent: string
    model: ModelRef
    variant?: string
    format?: OutputFormat
    system?: string
    tools?: Record<string, boolean>
  }
}

type User = {
  role: "user"
  turnID: string
  time: { created: number }
}

type Assistant = {
  role: "assistant"
  turnID: string
  usage: { cost: number; tokens: Tokens }
  result: { finish?: string; error?: Error; structured?: unknown; kind: "reply" | "summary" }
}
```

Examples:

```ts
const turn = {
  request: {
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
  },
}
```

```ts
const msg = {
  role: "user",
  turnID: turn.id,
  parts: [{ type: "text", text: "Summarize the tool output above and continue." }],
}
```

Tradeoff: stored messages get much smaller and cleaner, but replay now has to join messages with turn state and prompt hooks still need a way to pick which turn they belong to.

## Implementation status (2026-06-10)

The entry/event/stepper shape is implemented in `src/session/v2/` and live,
migrated by strangler over the v1 engine:

- `SessionEntry` (entry.ts) — entries plus AI-SDK-aligned parts. Every part
  carries an optional `ref` (the originating v1 part id) so live reductions
  upsert instead of appending duplicates.
- `SessionEvent` (event.ts) — the event vocabulary (`prompt`, `synthetic`,
  `step.started`, `step.ended`, `part.updated`, `part.removed`,
  `retry.error`). `Draft` distributes over the union (`z.input`-based) so
  `create()` accepts each member's own keys.
- `Stepper` (stepper.ts) — the immer reducer. `stepWith` is idempotent for
  live streams: `upsertPart` replaces by `ref` (and a tool-result replaces
  its tool-call by `toolCallId`); the open step is found with `findLast`
  because retry entries may sit after it.
- `SessionProjector` (projector.ts) — translates the v1 bus events
  (`message.updated`, `message.part.updated`, `message.part.removed`) into
  `SessionEvent`s and reduces them through `Stepper.stepWith`, so the live
  tail is produced by the same reducer a future native v2 engine will use.
  Publishes `session.v2.updated` only on entry-grade changes. State is
  per-instance (`Instance.state`) and dropped on completion/removal/delete.
- `SessionV2` (index.ts) — public API. Reads: `entries()` = lossless
  conversion of storage + live pending tail; `state()`/`pending()` =
  projector snapshot. Writes (`create`, `prompt`) still delegate to the v1
  Session/SessionPrompt services (v1 stays the only writer).
- Server: `GET /session/:id/v2/entries`, `GET /session/:id/v2/state` and
  `GET /session/:id/v2/events` (server/routes/session.ts);
  `session.v2.updated` reaches clients through the existing bus → SSE
  forwarding.

## Event persistence (2026-06-12)

The v2 event stream is durable: `SessionV2EventRepo` (event-repo.ts) writes
the projector's translated events into the `session_v2_event` table
(event.sql.ts, migration `20260612000000_session_v2_event`).

- Lifecycle events (`step.started`, `retry.error`) persist immediately;
  completion seals the step with a synthesized `step.ended` carrying
  cost/tokens/finish from the v1 assistant info.
- `part.updated` rows coalesce per originating v1 part id (live streams
  re-emit a part once per token — an append-only log would be one row per
  delta, the per-token disk write problem again). Rows flush on
  entry-grade changes and at completion; `sortKey` keeps the first-seen
  position so replay order is stable.
- `SessionV2.events(id)` returns the log; `SessionV2.replay(id)` rebuilds
  the Stepper reduction from it — a step without a sealing `step.ended`
  (crash, in flight) replays as `pending`, which is the crash-recovery
  shape for the future native engine.
- Removed parts/messages delete their rows; session delete clears the log.
- Persistence failures are logged and never break the live reduction.

Not done yet: native v2 write path (engine swap) — v1 stays the only writer.
Tests: `test/session/v2-conversion.test.ts`,
`test/session/v2-projector.test.ts`, `test/session/v2-persistence.test.ts`.
