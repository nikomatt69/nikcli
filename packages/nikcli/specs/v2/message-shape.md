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

## Flat entries (2026-08-05) — phase 1

`SessionEntry` is now a **flat** union discriminated on `type`, aligned with
opencode's `src/v2/session-entry.ts`. The previous shape nested streamed
parts inside `AssistantText.parts[]`, which meant a token delta rewrote the
whole array and forced the durable log to coalesce rows by part id to
survive it.

Entries: `user`, `synthetic`, `start` (was: the model fields on
`AssistantText`), `text`, `reasoning`, `tool`, `subtask`, `complete`,
`retry`, `compaction`.

What changed and why:

- **One entry per part.** A live delta is now a single-row upsert keyed on
  `ref` (the originating v1 part id) instead of an array rewrite.
- **`tool` reuses `MessageV2.ToolState` verbatim.** pending → running →
  completed | error collapses onto one entry per `callID`; the old shape
  emitted a `tool-call` part that a later `tool-result` part replaced.
- **`start` / `complete` are first-class.** Model, provider and agent live
  on `start`; cost, tokens, finish reason and any terminal message error
  live on `complete`. Both were previously squeezed onto `AssistantText`
  (and the error was hidden in `metadata.error`).
- **`compaction` and `subtask` are modelled.** Both v1 part kinds were
  silently dropped by the old conversion.
- Two fields opencode's shape does not carry are kept: `ref` (the upsert
  key — opencode has no live-projection path yet) and `sessionID` /
  `messageID` (nikcli's routes and event log are session-scoped).

Consequences downstream:

- `Stepper.Action` gained `upsertPending` / `removePending` and lost
  `upsertPart` / `removePart`. `indexOf` matches on `ref`, and additionally
  on `callID` for tools.
- `SessionEvent.StepEnded` gained `error`; a `compaction` event was added.
- `MessageV2.AssistantError` is now exported as a zod schema (it was
  Effect-only) so `Complete.error` can be typed.
- The generated SDK types changed shape: `SessionEntryAssistantText` and
  friends are gone, replaced by the flat `SessionEntry` union. Consumers
  (`plugin/v2/tui/context.ts`, `tui/plugin/data.ts`) now use `SessionEntry`
  directly.

Schemas stay **zod**, not Effect Schema: the `/v2/*` routes feed the Hono
`resolver()` and nikcli's OpenAPI → SDK pipeline is zod-driven, so
converting would break codegen for no gain.

## Persisted entries (2026-08-05) — phases 4 and 5

Entries are now a **first-class persisted projection**, not a conversion
performed on every read. This is what opencode 2.0 sketched with
`SessionEntryTable` and left commented out in `session/projectors.ts`.

- `session_entry` (entry.sql.ts, migration `20260805000000_session_entry`)
  holds one row per entry. `ref` is the identity — the originating v1 part
  id, or a synthesized `<messageID>#start` / `#complete` / `#user` /
  `#compaction` key — and it is the upsert target, so a streaming delta is a
  single-row write. Ordering is the entry id itself — see the coherence pass
  below.
- `SessionEntryProjection` (projection.ts) derives entries from v1
  messages/parts. It runs inside the **same transaction** as the v1 write
  (session/projectors.ts), so the projection cannot drift from storage.
  Message-level entries are projected by `message`, parts by `part` —
  rewriting the parts on every message update would make a long step
  quadratic.
- Entry ids are derived from the v1 id they come from, so re-projecting the
  same part always produces the same id and nothing has to be read before
  it is written. Consumers key renders on the id, and a churning id would
  remount every row on every delta.
- A projection failure is logged, never fatal: the message and part rows are
  the contract, the entries are derived data. `SessionEntry.Request` also
  defaults `providerID` / `modelID` / `agent`, because an assistant message
  can reach the projection before the model has been resolved onto it.

`SessionV2.entries()` reads the rows. A session written before the table
existed backfills on first read (`SessionEntryProjection.backfill`), and
`SessionV2.reproject()` forces a rebuild. The live projector tail is no
longer appended to `entries()` — it would duplicate rows the projection
already holds; `state()` / `pending()` remain the sub-flush-interval
streaming view.

Clients: `SessionEntryInfo` and `session.entry.{list,refresh}` on the plugin
TUI context (`plugin/v2/tui/context.ts`, `tui/plugin/data.ts`), backed by
`GET /session/:id/v2/entries`.

## One projection, two latencies (2026-08-05) — coherence pass

The migration briefly had **two parallel v2 persistence paths**: the
transactional projector writing `session_entry`, and `SessionProjector`
writing a second stream into `session_v2_event` off the bus. Two writers, two
representations, two answers to the same question. That is now one:

|             | who                                                | what                                 | when                            |
| ----------- | -------------------------------------------------- | ------------------------------------ | ------------------------------- |
| persistence | `SessionEntryProjection`, from the sync projectors | `session_entry`                      | inside the v1 write transaction |
| live        | `SessionProjector`, from the v1 bus                | `session.entry.updated` / `.removed` | immediately, per change         |
| durable log | `SyncEvent`                                        | `sync_event`                         | inside the v1 write transaction |

`session_v2_event` is dropped (migration `20260805120000`), along with
`SessionV2EventRepo` and `SessionV2.replay()` — entries _are_ the replayed
state, so reconstructing them from a second log was work with no consumer.
`SessionV2.events()` now serves `sync_event` for the session aggregate: the
real log, with real sequence numbers. Token-level part updates are absent
from it by construction (`log: false`), which is correct — the state they
would rebuild is `entries()`.

**Entry ids are derived, and they are also the sort key.**

`idForPart(messageID, partID)` → `evt_<messageBody>_1_<partBody>`;
`idForMessage(messageID, kind)` → `evt_<messageBody>_<rank>` with rank
`user`/`start` = 0, parts = 1, `complete` = 2, `compaction` = 3.

_Derived_ is what lets the two projections agree without coordinating: a
client applying a live `session.entry.updated` and a client re-reading
`/v2/entries` converge on the same entries. It also removed the
read-before-write in `SessionEntryRepo.upsert` (which existed only to keep
the id stable) and guarantees an id never churns mid-stream.

_Also the sort key_ because otherwise the server would order by one
convention (a `sort_key` column) and clients by another (the id), and the two
would drift — `evt_X_complete` sorts before `evt_X_start` if you order the
naive way. Identifier bodies are fixed-length and ascending, so lexicographic
id order is conversation order. `session_entry` therefore has no `sort_key`
column (migration `20260805130000` rebuilds the table without it; a
projection is disposable, so it is dropped and backfilled rather than
altered).

opencode's commented-out projector sketches the deriving half as
`data.part.id.replace("prt", "ent")`.

**A user message's parts fold into its `user` entry** — in both projections.
The live one has to look the message up to know that; publishing part entries
for them would hand a streaming client entries the projection does not have.
`test/session/v2-entry-projection.test.ts` asserts the two agree
entry-for-entry over a conversation with streamed deltas, tool transitions
and a removed part; it is the test that protects the whole design.

**Why two latencies and not one.** Streaming text is coalesced before it hits
disk (150ms, `SessionProcessor.updatePartCoalesced`), so `session_entry` lags
the stream. Publishing entries from the bus instead gives consumers a
per-token v2 stream without a transaction per token — the same split v1
already uses for messages and parts. A consumer seeds from `/v2/entries` and
stays live on `session.entry.updated`.

`entry` is `Schema.Unknown` on the bus payload: `SessionEntry` is defined in
zod and `BusEvent.schemas()` needs an Effect Schema there. Same choice
`SessionV2EntryList` and `SessionV2State` already make. The typed shape is
what the HTTP route returns, so clients type the read and cast the delta.

TUI: `store.entry` in `context/sync.tsx`, kept live off those two events.

## Implementation status (2026-06-10) — partly superseded

> The entry/event/stepper split below still stands, but two claims no longer
> hold: `SessionProjector` no longer persists an event log (it publishes
> `session.entry.updated` instead), and `entries()` no longer converts v1
> messages on every read (it reads `session_entry`). See the 2026-08-05
> sections above.

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

## Event persistence (2026-06-12) — SUPERSEDED, kept for the history

> Everything below describes `session_v2_event`, `SessionV2EventRepo` and
> `SessionV2.replay()`, all of which were **deleted** on 2026-08-05
> (migration `20260805120000_drop_session_v2_event`). Entries are persisted
> transactionally now and the durable log is `sync_event`; see "One
> projection, two latencies" above. Read this section only to understand why
> the earlier design existed, never as a description of the code.

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

## The renderer seam (2026-08-05) — foundation for the TUI move

> **Closed the same day.** The seam carried both sources while the entry
> source soaked; `fromMessages`, the `tui.entryRenderer` flag and the v1 →
> entry conversion are now deleted. `routes/session/view.ts` is
> `fromEntries(entries) ─► Turn[] ─► renderer`, full stop, and the TUI keeps
> one shape in memory instead of two. The rest of this section is why the
> seam existed and what it proved; see "One list, and it stays mounted"
> below for the shape that survived.

The TUI renders from v1 messages and parts; every other client (mobile,
desktop, plugins, SDK) is on entries. Converting the renderer means changing
the data shape _and_ 3971 lines of components at once, which is neither
reviewable nor testable — so the seam goes in first.

`routes/session/view.ts` defines the `Turn` model with both sources behind
it:

    fromMessages(messages, parts, …) ─┐
                                       ├─► Turn[] ─► renderer
    fromEntries(entries)             ─┘

**The unit is the turn, and a turn is a message.** Deliberate: the renderer
virtualizes over messages (`MESSAGE_HEIGHT_ESTIMATE`), so keying turns on
`messageID` keeps the number of windowed units — and therefore the scroll
maths, the fork/revert dialogs and `TurnUsage` — exactly where they are.
Entries carry `messageID` precisely so this grouping costs nothing.

`test/tui/session-view.test.ts` proves the two sources produce identical
turns. That is what makes the eventual swap a one-line provider change with
a known outcome instead of an exploration.

Two things were needed to close the model gap, both verified:

- **`mode` on `SessionEntry.Request`.** The step label renders it, and
  `start` is by definition "what the request was made with".
- **`rows.ts` accepts `name` as well as `tool`** (`toolOf`), so the
  exploration-grouping logic — already dependency-free and separately tested
  — works unchanged on either source.

**There is no remaining model gap.** The renderer draws `file` parts (which
ride on the `user` entry), text, reasoning and tools (whose full v1
`ToolState` the `tool` entry carries verbatim). `patch`, `snapshot`,
`step-start` and `step-finish` are never drawn, which is exactly why entries
drop them.

Not done: converting `UserMessage` / `AssistantMessage` to take a `Turn`.
That is now mechanical — twelve fields, all mapped and pinned by the test —
but a paint regression is user-visible and invisible to the suite, so it
wants a golden-frame corpus captured with `packages/simulation` (which
records terminal frames) before and after.

### A determinism bug the seam's test caught

`SessionEntry.fromV1Part` fell back to `Date.now()` for parts with no time of
their own, so the live and persisted projections — which convert the same
part independently — disagreed by a millisecond. A client that seeded from
`/v2/entries` and then applied a live update would have seen the timestamp
jump. Identifier ids encode their creation time, so the part is now its own
deterministic source (`createdAt`).

The failure was intermittent: it only showed when the two conversions landed
in different milliseconds.

### The golden-screen corpus

`packages/simulation/test/session-render.test.ts` captures what the real TUI
paints, as **text**, for a corpus of scripted conversations. It is the
instrument the renderer conversion needs: the unit suite cannot see a paint
regression, and the TUI smoke test only asserts that _something_ was painted.

Text rather than PNG deliberately — the failure of a render refactor should
be a readable diff, not "the hashes differ". Regenerate with
`UPDATE_GOLDENS=1`, and read the diff before committing it; that is the
entire value.

`test/helpers/harness.ts` boots the real CLI headless against the
simulation's deterministic OpenAI backend and exposes `send` / `respond` /
`screen`. Two details it had to get right:

- **Which exchange to script.** A prompt fans out into title generation,
  summarising, and the chat turn. Only the chat turn carries tool
  definitions, so `respond` matches on that. Answering by arrival order put
  the scripted reply on the thread title and a fallback in the message.
- **What to normalize.** Ids, durations, token rates, costs, temp paths and
  clock times are stripped. The status bar goes whole: it ends with the file
  the developer's editor has open, right-aligned, so its _length_ shifts the
  entire line. That one made the corpus fail on roughly one run in three
  until it was normalized — a flaky golden is worse than no golden, because
  it teaches you to ignore the diff.

Cost: one CLI process per scenario. Scenarios keep separate processes rather
than sharing one and resetting between them — a scenario bleeding into the
next would produce a _wrong_ golden, which is worse than a slow suite. The
simulation package's own suite is correspondingly heavier now, and
`plugin-hot-reload` (300s budget) has been seen to time out under
contention.

## One list, and it stays mounted (2026-08-05) — the seam closes

`fromMessages`, the `tui.entryRenderer` flag and the v1 → entry conversion
are gone. `fromEntries` is the only source, and `context/sync.tsx` seeds
`store.entry` on the one path every session open goes through, so there is no
longer a branch that can render an empty transcript.

What the removal is worth: the TUI held the conversation twice — v1 messages
and parts for the renderer, v2 entries for everything else — and had to keep
the two agreeing. It now holds one. (`store.message` / `store.part` stay:
`TurnUsage`, the pending/last-assistant lookups and the fork/revert dialogs
still read message-level v1 state. The _renderer_ is what moved.)

### The flicker, and why it was never about paint

Turning the source over exposed a defect that had been there all along.
`<For>` reconciles by **reference**, and `fromEntries` allocates a fresh
`Turn` for every message on every run. So every entry that arrived — a tool
call, a new text part, the `complete` sealing a turn — handed `<For>` an
entirely new list, and Solid disposed and recreated _every message in the
conversation_. Several full teardowns per assistant turn, worse the longer
the session.

`stabilize(previous, next)` returns the previous object for a turn that did
not change, so only the turn that actually changed is rebuilt.

Comparing `body` **by reference** is what makes it work and what keeps
streamed text live at the same time:

| what changes            | how the store changes it            | what the renderer does                                               |
| ----------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| a token lands in a part | entry updated in place, `reconcile` | nothing above the leaf moves; the leaf repaints reading `entry.text` |
| a new part starts       | entry spliced into the array        | that one turn is rebuilt                                             |
| the turn is sealed      | `complete` entry appended           | that one turn is rebuilt                                             |

That table is the design. The persisted projection updating entries in place
(see "One projection, two latencies") is precisely what lets identity above
the leaf hold still while the text underneath it moves — the two decisions
are the same decision, seen from the two ends.

`fromEntries` also stopped spreading the turn per entry
(`{ ...turn, body: [...turn.body, entry] }`), which was O(k²) in a turn's
entry count and was paid again on every rebuild.

`test/tui/session-view.test.ts` asserts object identity rather than values —
the unit suite cannot see a repaint, so identity is the only observable the
fix has.
