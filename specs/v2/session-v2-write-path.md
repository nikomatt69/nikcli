# Session V2 Write Path

| Field  | Value                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------- |
| Status | **Slices 1–2 implemented.** Slice 3 remains.                                                   |
| Scope  | `src/session/v2/*`, `src/session/projectors.ts`, `MessageV2` stays the LLM layer               |
| Buys   | One conversation write: entries are first-class; a projection throw rolls back the turn        |

## Principle

The durable log is already `sync_event`. Two row projections sit under it: `session_entry` (the flat client model, written first) and `message_info` / `message_part` (what the LLM layer reads, now derived from the entries just written).

S4 inverts the old relationship without replacing `SessionPrompt`, tool execution, or `MessageV2.toModelMessages`.

## Current Behavior

`SessionV2.create` / `SessionV2.prompt` still delegate to `Session` / `SessionPrompt`. HTTP prompt does the same. The engine authors `MessageV2` values and runs `SessionSync` events.

Each message/part event projector:

1. Writes `session_entry` from the event payload (plus already-committed rows for a user entry's other parts).
2. Persists the v1 row as `SessionEntry.toV1Message` / `toV1WrittenPart` of those entries.
3. Applies `prompt_data` from the event onto `message_info` after the derived info write. It is not stored on the entry.

A throw from projection or `toV1*` aborts the transaction. Live `session.entry.updated` is still a third path: `SessionProjector` translates the v1 bus after commit. Entry ids stay derived, so the two paths agree without coordinating.

## Contract

### What stays

- `sync_event` remains the ordered log. Event payloads stay `MessageV2` shapes so existing rows replay.
- `MessageV2` remains what `toModelMessages`, tools, compaction, pending promotion, and HTTP message routes use.
- `SessionPrompt.loop` stays the step engine. `SessionV2.prompt` stays a pass-through until slice 3.
- Token-level `message.part.updated` stays `log: false`.
- Entry ids stay derived (`idForPart` / `idForMessage`) so live and persisted rows still agree without coordinating.

### Slice 1 (landed)

Projection is a function of the event payload plus already-committed rows, not of the row the same event is about to write.

- A user part event merges the incoming part into the in-memory part list, whether or not `message_part` already holds it.
- A user part removal rebuilds the user entry without that part, whether or not the row is already gone.
- The projector writes `session_entry` **first**, then the v1 row.
- A throw from `SessionEntryProjection` aborts the transaction. The conversation does not commit a message the entry table cannot represent.
- `SessionEntry.toV1Part` is the reverse of `fromV1Part` for the modeled subset. Invariant: `fromV1Part(toV1Part(entry))` equals `entry` for streamed types that convert. `v1 → entry → v1` may fill `time.start` from the part id clock; that is not a drift.

### Slice 2 (landed)

Every field `toModelMessages` and revert need is on an entry, except the remainder below. The v1 projector is `toV1*` of the entries just written.

| Kind | Now on the entry |
| ---- | ---------------- |
| User message | `agent`, `model`, `system`, `format`, `tools`, `variant`, `summary`; `texts` keeps individual text parts (including synthetic / ignored) so ids are not collapsed by the display `text` join. File and agent parts already rode here. |
| Assistant message | `path`, `parentID` on `start`; in-flight `cost` / `tokens` / `finish` / `error` / `structured` on `start` so a finish-step `message.updated` before `time.completed` still derives; `complete` is authoritative once it exists. `time.completed` is `complete.completed`. |
| Parts | `snapshot`, `patch`, `step-start`, `step-finish` as streamed entries. They overlap `start` / `complete` but are not the same row: the part carries a snapshot hash the message-level entry does not, and `toModelMessages` emits `step-start` as its own UI part. |

User-typed text, file, and agent parts still fold into the `user` entry (clients would otherwise draw them twice). Compaction, subtask, snapshot, patch, and step markers on a user message are streamed entries of their own.

The TUI turn model absorbs `snapshot` / `patch` / `step-start` / `step-finish` the same way it absorbs `start` / `complete`: they frame revert and the LLM layer, they are not transcript rows.

### Remainder (by design)

- **`prompt_data`** stays on `message_info`. It is the canonical admission payload for retry identity (S1), not conversation content. The projector copies it from the event after `toV1Message`.
- User messages have no `parentID` on `MessageV2.User`; that gap in the pre-slice-2 table was a misread of the v1 schema.

### Slice 3 (not this change)

`SessionV2.prompt` / `create` become the public write API HTTP uses. `SessionPrompt` still runs the loop, but persistence goes through the entry write. Pending promotion must still batch into messages and parts in one transaction and still reset `step` once (S1).

## Migration

1. Make projection payload-pure. Invert projector order. Stop swallowing throws. Add `toV1Part`. **Landed.**
2. Close the lossless gap. v1 projector becomes `toV1*`. **Landed.** No HTTP change.
3. Point HTTP and `SessionV2.prompt` at one write helper (slice 3).

Slice 2 is revertible: restore writing `data.info` / `data.part` as v1 and drop the new entry fields. Existing `sync_event` payloads are unchanged.

## Invariants (testable)

1. Projecting a user text part before `upsertPart` still stores that text on the user entry.
2. Removing a user part before `removePart` drops it from the user entry.
3. `fromV1Part(toV1Part(fromV1Part(part)))` equals `fromV1Part(part)` for text, reasoning, tool, subtask, retry, compaction, snapshot, patch, step-start, and step-finish.
4. A throw inside `SessionEntryProjection.message` leaves no `message_info` row.
5. Unchanged snapshots still emit no extra `session.entry.updated` identity churn: entry ids stay derived.
6. After a message/part commit, the v1 row equals `toV1*` of the stored entries (JSON round-trip), except `prompt_data` which remains a `message_info` column.

## Non-Goals

- Rewriting `SessionProcessor`, tool execution, or `toModelMessages` to consume entries.
- Changing `SessionV2.prompt` from a pass-through (slice 3).
- A second durable log. `session_v2_event` stays gone.
- Clustered writers or hard-crash replay of in-flight tokens.
