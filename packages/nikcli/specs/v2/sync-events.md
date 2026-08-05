# Sync events — event sourcing on the write path

Phases 2 and 3 of the session v2 migration. Ported from opencode 2.0's
`packages/opencode/src/sync/`, adapted to nikcli's project-scoped storage.

## What changed

    before   mutate the row, then publish a bus event describing it
    after    run the event, whose projector performs the mutation inside
             the same transaction that allocated its sequence number

The event is the source of truth; the row is a projection of it. An ordered
replay reconstructs state by construction, which is what makes a
one-writer/many-readers sync possible without distributed clocks — a single
`seq` per aggregate is total ordering enough.

## Where it lives

| File                        | Role                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `src/sync/sync-event.ts`    | `SyncEvent`: define / project / init / run / replay / remove        |
| `src/sync/projectors.ts`    | installs every projector, freezes the registry                      |
| `src/session/projectors.ts` | `SessionSync`: the session/message/part events and their projectors |
| `src/database/database.ts`  | `transaction()`, `effect()`, `use()`, `TxOrDb`                      |

## Deliberate divergences from opencode

**One event log, not two.** opencode's port adds `event` / `event_sequence`
tables. nikcli already had `sync_event` / `sync_sequence` for remote
multi-device sync, so `SyncEvent` writes into those. The domain write path
and the remote sync log are now the same log: every session mutation is
pushable through the existing outbox (`Sync.notify`) with no new wiring, and
the repo does not end up with two systems both called "sync".

**Bus definitions are reused, not re-registered.** opencode calls
`BusEvent.define(def.type, def.properties)` in `init`. nikcli registers its
events with `BusEvent.schema` (Effect Schema) and `BusEvent.schemas()`
_throws_ if any registered event lacks one — re-defining would replace an
Effect Schema entry with a zod-only one and break the Effect PublicApi
contract. So a sync event points at its existing registration via
`bus: () => Session.Event.Updated`.

The thunk is load-bearing: `session/projectors.ts` imports `session/index.ts`
for the bus definitions and `session/index.ts` imports it back for the event
definitions. Resolving `bus` at define time would read the not-yet-evaluated
half of that cycle.

**Full payloads, not partials.** opencode's `session.updated` sync event
carries only changed fields and needs `busSchema` + `convertEvent` to
reconstitute the full object for the bus. nikcli's `updateImpl` already
computes the whole session, so the event carries it whole. `convertEvent`
here does the smaller job of stripping the `sessionID` aggregate key back out
so bus subscribers see byte-identical payloads to before.

**Per-definition `log` flag.** `message.part.updated` fires once per streamed
token. Logging it would be one durable row per delta — the per-token disk
write problem. It is defined `log: false`: projected and published, but not
logged and not consuming a sequence number. Its projection is an upsert that
already carries the latest state, so nothing is lost.

opencode solves the same problem by gating _all_ log writes behind
`OPENCODE_EXPERIMENTAL_WORKSPACES`. Per-definition is finer: nikcli keeps a
real log for everything that is not a token delta.

## The streaming delta hole

`SessionProcessor.updatePartCoalesced` publishes on the bus per token and
coalesces the disk write on a 150ms timer. It is the one path that publishes
ahead of the write — a `SyncEvent.run` per token would be a transaction per
token.

The coalesced flush still goes through the projector, with `publish: false`
because the bus already heard every delta. So the row is still written in
exactly one place; only the announcement is early.

## Ordering guarantees

- `run` opens `BEGIN IMMEDIATE`: the sequence read and the append are atomic
  even across processes sharing `nikcli.db`.
- The projector runs inside that transaction, so a projector that throws
  leaves no event behind claiming the mutation happened
  (`test/sync/sync-event.test.ts` asserts this).
- Bus publication is deferred to `Database.effect`, which drains after the
  outermost commit. Subscribers never observe state a rollback could undo,
  and never run while the write lock is held.
- Nested `Database.transaction` calls join the outer one and their effects
  drain with the outermost commit.
- `replay` ignores an already-applied sequence (redelivery is safe) and
  throws on a gap (out-of-order delivery is a bug under a single writer, not
  something to buffer).

## The legacy session bridge

`SessionSyncBridge` used to journal `session.created` / `updated` / `deleted`
into `sync_event` by subscribing to the bus. Those are sync events now, so
they land in the log transactionally with the write and the bridge no longer
journals them — running both wrote every row twice and inflated the sequence
(caught end-to-end against the compiled binary, not by the test suite).

The bridge still covers `session.status`, `session.idle`, `permission.*` and
`question.*`, which are bus events with no projector.

Two knock-on changes in `SyncProjector`:

- Types are matched on their **bare** form. `SyncEvent` writes
  `session.updated.1` so old versions stay replayable; the legacy bridges
  write the bare type. `baseType()` strips a trailing numeric segment.
- The session reducer reads `data.info ?? data.properties ?? data`, because
  three payload shapes now reach it: the flat legacy one, the bridge's
  `{ type, properties }` envelope, and `SyncEvent`'s `{ sessionID, info }`.

One behavior change worth knowing: the bridge skipped workspace-bound
sessions, because the workspace loop journals them under the workspace
aggregate. `SyncEvent` does not skip them — they now also have rows under
their own session aggregate. That is an addition, not a duplication (the
workspace loop writes `workspace.*` types under a different aggregate), and
it means a workspace session can be resumed from the session log like any
other.

## Not converted

Message rows deleted as part of a session delete still go through
`MessageRepo.removeMessage` directly. Emitting N `message.removed` events
there would change bus behavior — today a session delete publishes
`session.deleted` alone — and the rows are cascade cleanup, not independent
mutations.
