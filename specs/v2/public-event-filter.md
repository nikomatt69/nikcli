# Public Event Filter

| Field  | Value                                                                                     |
| ------ | ----------------------------------------------------------------------------------------- |
| Status | **Implemented** 2026-08-16 (was roadmap E3, then E3c)                                     |
| Scope  | `src/bus/bus-event.ts`, `src/server/httpapi/event-feed.ts`, `src/server/httpapi/event.ts` |
| Buys   | Internal bus traffic stops crossing the public SSE seam                                   |
| Wire   | **Changed.** Six types left the wire and left the generated `Event` union.                |
| Tests  | `test/server/event-visibility.test.ts`                                                    |

## The Problem

[event-stream-architecture.md](./event-stream-architecture.md) §"Not implemented: public filtering" left one stage unbuilt: the feed forwards **every** event the bus publishes. `Bus.subscribeAll` hands each event to `EventFeed.broadcast`, which encodes and fans it out. Nothing marks an event as internal, so nothing can be withheld.

The cost is not hypothetical. Measured 2026-08-16 against `packages/nikcli/src`, of the 64 declared `BusEvent.schema` types, **six reach every SSE client and no client anywhere reads them**:

| Type                      | Published by                           | Who reads it                                |
| ------------------------- | -------------------------------------- | ------------------------------------------- |
| `lsp.client.diagnostics`  | `lsp/client.ts:63`                     | `lsp/client.ts:215` — **the same module**   |
| `mcp.browser.open.failed` | `mcp/index.ts:849`                     | `cli/cmd/mcp.ts:293` — **the same process** |
| `command.executed`        | `session/prompt-commands.ts:505,579`   | nobody                                      |
| `instance.reload.started` | `project/reload.ts` (`InstanceReload`) | nobody                                      |
| `instance.reloaded`       | `project/reload.ts` (`InstanceReload`) | nobody                                      |
| `loop.aborted`            | `loop/engine.ts:543` and siblings      | nobody                                      |

"Nobody" is repo-wide: zero references in `packages/tui`, `packages/app`, `packages/mobile`, `packages/desktop`, outside the generated `Event` union itself. Reproduce with:

```sh
grep -rn '"command.executed"' packages --include='*.ts' --include='*.tsx' \
  | grep -v node_modules | grep -v sdk/js/src/httpapi/generated | grep -v packages/nikcli/src
```

Two distinct kinds are mixed in that table, and the distinction is the spec:

- **Bus as local RPC.** `lsp.client.diagnostics` and `mcp.browser.open.failed` are a module (or a CLI command) waiting on its own work. They are meaningful only inside the publishing process. Serving them to a remote client is not a feature nobody uses — it is a leak of process-local activity, its timing, and its file paths.
- **Published into the void.** `command.executed`, the two reload events, and `loop.aborted` have no subscriber at all. They are cheap today because volume is low, but every one of them still costs an encode and a frame on every attached connection.

One declaration is dead rather than internal: `project.directories.updated` is declared in `project/project.ts:93` and never published. It should be deleted, not filtered.

## Decision

**Visibility is declared where the event is declared, and a withheld event is absent from the wire.**

### 1. Mark at the declaration

`BusEvent.schema` takes an optional visibility, defaulting to `"public"`:

```
BusEvent.schema(type, properties)                            // public — unchanged
BusEvent.schema(type, properties, { visibility: "internal" }) // never leaves the process
```

The alternative — a list of internal type strings inside `event-feed.ts` — was rejected. That is the same shape as the four hand-copied instance-less prefixes that H2 just deleted: the list lives away from the thing it describes, nothing forces them to agree, and the failure (an internal event silently going public) reports itself nowhere. A field on the declaration cannot drift from the declaration.

`Bus.publish` is unchanged. Internal events still reach in-process subscribers exactly as they do today; `lsp/client.ts` and `cli/cmd/mcp.ts` keep working with no edit.

### 2. Filter once, before encoding

The check belongs in `Feed.broadcast`, ahead of `JSON.stringify`:

```
broadcast(event):
  if no connections: return
  if visibility(typeOf(event)) is internal: return
  encode once; offer to every connection
```

Before encoding, not after, so an internal event costs nothing on a server with attached clients — the same reason `broadcast` already returns early when nothing is attached.

**`typeOf` is per feed, and this was not obvious.** `Feed.broadcast` does **not** apply `Envelope`: that wraps connection-local frames (the greeting, the heartbeat, a failure reason) only. Broadcast values arrive already in each feed's own shape — the instance feed receives the bare `Bus` event (`{type, properties}`), while the global feed receives what `GlobalBus` emits, which is `{directory?, payload}`. A filter that read a top-level `type` would therefore withhold correctly on `/event` and let every internal event straight through on `/global/event`. So the feed takes a `TypeOf` extractor alongside its `Envelope`, defaulting to the top-level read; `HttpApiEvent` passes `globalTypeOf` for the wrapped route. The test asserts both routes, because one of them passing proves nothing about the other.

The envelope question is settled by construction: both routes fan out from `Feed`, so one filter serves both and **neither envelope changes**. The instance stream stays unwrapped and the global stream stays wrapped; §"Behavior Before This Change" item 5 of [event-stream-architecture.md](./event-stream-architecture.md) still holds, and any implementation that alters either shape is wrong.

The `/sync/stream` feed and the mobile session stream are separate paths with their own payloads. They are **out of scope**: this filter governs the bus→SSE seam only.

### 3. Withheld means absent, not typed

A filtered event produces **no frame**. There is no `{ type: "event.withheld" }` placeholder and no counter in the greeting.

A typed placeholder was considered and rejected on the filter's own terms: it would republish the existence, the type, and the exact timing of the internal activity the filter exists to keep inside the process, and it would cost one frame per internal event — turning a saving into a tax. Withholding is also not a delivery failure: unlike `SubscriberOverflowError`, which tells a client why its stream died, the client here never knew the event existed and loses nothing it can act on.

Consequence worth stating: internal events are invisible in production debugging through the public stream. They stay visible in the process log, which is where a process-local event belongs.

### 4. The contract follows

An internal type leaves the generated `Event` union in `packages/sdk/js/src/httpapi/generated/types.ts`. This is the wire change, and it is the point: a client must not be able to type against an event it will never receive.

For the six types above the change is free — no client references them today. That is exactly why this set is the right one to land first, and why the set is chosen from measured consumption rather than from what _looks_ internal.

## Initial Internal Set

Landing this proposal marks these and nothing else:

- `lsp.client.diagnostics`
- `mcp.browser.open.failed`
- `command.executed`
- `instance.reload.started`
- `instance.reloaded`
- `loop.aborted`

Plus one deletion, not a filter: `project.directories.updated` (declared, never published).

Marking anything beyond this set requires re-running the consumption measurement above. `telemetry.record` in particular **stays public**: the TUI reads it in `packages/tui/src/context/telemetry.tsx`, and the observability panel is built on it.

## What Landed Beyond The Proposal

Two things the proposal did not anticipate, both consequences of the registry being process-wide:

**`BusEvent.payloads()` was deleted, not filtered.** It built a second zod copy of the same union and had **zero callers** anywhere in the repo. Filtering it would have meant maintaining the visibility rule in two places, one of which nothing reads. `schemas()` is the only union now, and it is built from public definitions only. (This is one item of roadmap X2, taken because the alternative was worse, not as scope creep.)

**`schemas()` requires an Effect Schema for public events only.** It throws listing any public event still registered through the legacy zod `define`, which is the guard that keeps the contract from silently shipping a partial union. Internal events are exempt: they are not on the contract, so requiring a contract-grade schema for them is coupling with no payoff.

That exemption fixed a documented landmine. `test/bus/effect-service.test.ts` registers a zod-only fixture, `test.bus.effect`, to exercise the legacy path — and because the registry is shared across every test file in a process, that one fixture made `schemas()` throw for every other file, so `bun test test/server/ test/bus/` failed while either directory alone passed. `test/bus/event-encode.test.ts` carried a comment warning contributors not to add a second one. Marking the fixture `internal` retires that: a test fixture has no business on the public contract either way.

## Non-Goals

- **Per-client or per-scope visibility.** One bit on the declaration, not an ACL. A permissioned event stream is a different design and needs an identity model this feed does not have.
- **Filtering `/sync/stream` or the mobile session stream.** Different payloads, different producers.
- **Making the filter configurable at runtime.** Visibility is a property of the event, not of the deployment. An env var here would mean the contract cannot describe the wire.
- **Suppressing internal events on the bus itself.** In-process subscribers are the reason two of these exist.

## Done

All verified 2026-08-16:

- `BusEvent.schema` and `BusEvent.define` take `{ visibility }`; the six types declare `internal` at their declaration, each with the reason in a comment.
- `Feed.broadcast` returns ahead of the encode for an internal event, reading the type through the feed's own `TypeOf`.
- The generated `Event` union no longer contains those six types; `bun run generate:httpapi-clients` output is committed.
- `project.directories.updated` is deleted.
- `test/server/event-visibility.test.ts` asserts the withholding on **both** envelopes, that a public event still arrives on both, that an unregistered type stays public, and that the marked set is exactly the six the spec names.
- `bun run typecheck` passes across all 34 packages — `packages/tui`, `packages/app` and `packages/mobile` needed no edits against the narrowed union.
- `bun test` in `packages/nikcli`: 3990 pass, 2 fail, both the pre-existing baseline (`test/tui/profile-command.test.ts`'s source-reading assertion, and `EditTool`, which passes in isolation).
