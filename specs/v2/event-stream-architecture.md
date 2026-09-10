# Event Stream Architecture

| Field  | Value                                                                                  |
| ------ | -------------------------------------------------------------------------------------- |
| Status | **Implemented** 2026-08-14 (was roadmap E1)                                            |
| Scope  | `src/server/httpapi/event-feed.ts`, `src/server/httpapi/event.ts`, `src/bus/global.ts` |
| Buys   | O(1) encoding per event instead of O(connections); a real lag budget                   |
| Tests  | `test/server/event-feed.test.ts`                                                       |

## Decision

Serve the public HTTP event stream from **one server-scoped encoded feed** with **one independently bounded queue per connection**.

```text
Bus.publish / GlobalBus
          |
          | one subscription
          v
      EventFeed
   public filter
   JSON encode
   SSE frame once
          |
          | nonblocking offer of one shared immutable string
          v
  Queue A   Queue B   Queue C
     |         |         |
  HTTP A    HTTP B    HTTP C
```

The bus keeps owning event meaning, publication, and instance scoping. The feed owns public selection, wire encoding, bounded delivery, and subscriber lifecycle.

## What Was Built

`EventFeed` in `src/server/httpapi/event-feed.ts`. Two classes:

- **`Feed`** — a fan-out group. `broadcast` returns immediately when nothing is attached, otherwise encodes the event **once** into a `Uint8Array` and offers that same frame to every connection.
- **`Connection`** — one SSE connection, holding its own lag budget.

`GET /event` keeps one feed per instance directory in a module-level map, created with the first connection and released with the last. Per-instance rather than server-scoped because `Bus.subscribeAll` is instance-scoped; a second client on the same directory reuses the subscription instead of adding one. `GET /global/event` uses a single module-level feed behind exactly **one** `GlobalBus` listener, so that route can no longer contribute to a listener-count warning at all.

### The lag budget is the stream's own queuing strategy

The proposal below describes Effect queues. The implementation uses the web stream that was already there: `EventFeed.stream` constructs the `ReadableStream` with `CountQueuingStrategy({ highWaterMark: LAG_BUDGET })`, which makes `controller.desiredSize` equal the budget minus the frames the reader has not consumed. It reaches zero exactly when the connection is `LAG_BUDGET` frames behind.

This was chosen over introducing `Queue`/`Stream` because both handlers are plain functions returning a `Response`, served by the bridge _ahead_ of the HttpApi router precisely because SSE is not a schema-encoded body. Wrapping them in an Effect stream layer would have been a larger change than the win it delivers, and `desiredSize` already measures the exact quantity the delivery law is about.

Consequence worth knowing: the `Connection` cannot read its own budget back, so the overflow message states the condition rather than a frame count.

### Failures are stated, not silent

Both eviction paths write a final frame before closing:

```
{ "type": "server.error", "properties": { "name": "SubscriberOverflowError", "message": "..." } }
```

wrapped in the route's envelope. This frame is written past the budget on purpose — a client being dropped should learn why. It is additive: it appears only where the previous behaviour was a silent close, and clients dispatch by `type`, so an unknown type has no listeners.

### Public filtering: landed separately

The proposal's "public filter" stage had no counterpart here, because nothing marked a bus event as internal. It landed 2026-08-16 as its own decision — [public-event-filter.md](./public-event-filter.md) — which names the six internal types and settles that a withheld event is absent from the wire rather than typed.

Nothing in this document changed: the filter sits in `Feed.broadcast` ahead of the encode, so both envelopes are exactly as described here. One correction it did force — `broadcast` does not apply `Envelope` (that is for connection-local frames), so each feed also supplies a `TypeOf` extractor; the global feed's reads through the `GlobalBus` `{directory, payload}` wrapper.

## Behavior Before This Change

`GET /event` (`HttpApiEvent.handleInstance`) and `GET /global/event` (`HttpApiEvent.handle`) each built a `ReadableStream` and, inside it, defined a private `send`:

```ts
const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
```

The instance handler then called `Bus.subscribeAll(...)` once per connection; the global handler attached one listener per connection to the `GlobalBus` `EventEmitter`. The consequences, which are what the change addresses:

1. **Encoding is per connection.** With `N` attached clients, `JSON.stringify` plus UTF-8 encoding runs `N` times for every event. Upstream measured the equivalent boundary at 8 KiB events: 10 clients went from 96.3 ms to 10.4 ms (−89.3%) and 50 clients from 553.9 ms to 12.4 ms (−97.8%) once the frame was encoded once. That measurement isolates the encoding boundary and does not claim socket throughput.
2. **There is no lag budget.** `controller.enqueue` never refuses. A stalled reader accumulates in the stream's internal queue until the process runs out of memory; nothing evicts it, and nothing reports it.
3. **A write failure is silent and terminal for that client.** A throwing `enqueue` is caught, logged at `debug`, and cleaned up. The client sees a closed stream with no typed reason.
4. **`GlobalBus` was a bare `EventEmitter` with default limits.** No `setMaxListeners` call existed anywhere in the repo, so the eleventh concurrent `/global/event` connection triggered a `MaxListenersExceededWarning` that looked like a leak and was not one. Fixed twice over: `/global/event` now attaches one listener total, and `bus/global.ts` raises the cap to 200 — raised rather than removed, because at 0 the warning is disabled and a real leak becomes invisible. The cap still matters, because `/sync/stream`, the mobile session-lifecycle stream, and the workspace server each attach a listener _per connection_.
5. **Two wire shapes are load-bearing.** The instance stream sends unwrapped `{type, properties}`; the global stream sends `{payload: {...}}`. The TUI reads `data.type` directly, so serving the global envelope on the instance route silently drops every event client-side. Any refactor must preserve both shapes exactly.

The cross-instance stream is intentional: `/global/event` sits outside the instance middleware because clients track several directories at once. The feed must not add request-instance filtering.

## Delivery Law

> A connection has an independent finite lag budget. Exceeding it terminates only that connection while publication and healthy connections continue in order.

Each connection gets a dropping queue of **4,096 accepted frames**. When an offer returns `false`:

1. The queue leaves the active registry immediately.
2. It fails with `SubscriberOverflowError` — a typed reason the client can log, unlike today's silent close.
3. The same frame is still offered to every other active queue.
4. Publication never suspends on that connection.

Previously accepted frames drain before the failure surfaces. The overflow-causing frame is not accepted by that connection. `server.connected` and heartbeats stay connection-local and do not consume capacity.

4,096 is chosen for continuity with upstream, not because it is optimal, and it is an event count rather than a memory bound: frame sizes vary and kernel plus client buffers are outside server accounting. Tune it from observed burst sizes, healthy high-water marks, frame-size distribution, and overflow frequency — not from the fact that frames are now encoded once. A larger threshold retains stale clients longer.

## Why Independent Queues, Not One Shared PubSub

A shared PubSub stores each frame once and gives every subscriber a cursor, so retained storage is proportional to maximum lag instead of the sum of all lags. It was still rejected, because none of Effect's bounded strategies expresses independent subscriber failure:

- `bounded` suspends the publisher behind the slowest subscriber.
- `dropping` rejects one publication for **every** subscriber when shared capacity fills.
- `sliding` silently skips events and leaves the stale subscriber connected.
- `unbounded` removes the structural memory bound.

Independent eviction can be built on a dropping PubSub, but it requires retaining every subscription's child scope, a separate typed overflow signal (scope closure looks like interruption), serialization of registration/removal/eviction/publication, lag scans at capacity, and terminal handling for a "impossible" failed shared publish. That is a custom multicast protocol layered over PubSub.

The benefit it would actually buy is queue-slot _references_, not frame copies — every independent queue holds the same immutable string. At 50 clients × 4,096 slots that is roughly 1.6 MiB of references before array overhead, likely dominated by HTTP, TLS, kernel, and client buffers.

Independent queues capture the dominant win — encode once — with queue-local overflow semantics and a smaller failure domain. Revisit shared storage only if measurements after shared encoding show reference retention is material.

## Feed Lifecycle

**Feed scope.** A feed registers its subscription when its first connection attaches and releases it when its last one leaves — one per instance directory for `/event`, one module-level for `/global/event`. Encoding and offers happen inline, once per event, so ordering is identical for every healthy connection. With nothing attached, `broadcast` returns before encoding, so a headless server pays nothing.

**Connection scope.** `Feed.attach` registers the connection synchronously inside the stream's `start`, which is also what keeps the instance ALS valid. The greeting is written **after** registration, so live frames queue behind it. Events before registration are missed; the stream is volatile by contract. The connection is removed on client cancel (`abandon`), on eviction, and on instance disposal.

**Encoding failure.** If an accepted event cannot be encoded: log its type and cause, fail every currently connected queue with `EncodingError`, skip the malformed event, and keep the feed available for later connections. Keeping current clients attached would create a silent gap; permanently poisoning the feed would break every future connection.

## What Does Not Change

Method, path, payload shape, greeting, and the 30s heartbeat all stay as they are. The heartbeat interval exists because WKWebView drops an idle connection at 60s — do not raise it past that without re-testing the mobile client. Because the wire representation is unchanged, OpenAPI, the generated clients, and TUI reconnect behavior need no regeneration.

`Bus.subscribeAll` must still be called synchronously inside the instance ALS: it reads the current instance at subscription time. Any feed refactor that moves subscription into a fiber breaks instance binding.

## Verification

Covered by `test/server/event-feed.test.ts` (9 tests). The encode count is asserted without mocks: the broadcast payload carries a `toJSON()` that increments a counter, so N connections must still produce exactly one call.

- one encoding operation for multiple subscribers;
- identical frames delivered to healthy subscribers;
- a slow subscriber overflowing without affecting others;
- delivery continuing after another subscriber overflows;
- nothing encoded when no connection is attached;
- greeting and heartbeat outside the budget, so they cannot evict a stalled connection;
- current subscribers failed on malformed encoding, later subscribers still served;
- an abandoned connection removed from the feed;
- both wire shapes (`{type,...}` on `/event`, `{payload}` on `/global/event`) preserved byte for byte.

Not covered by a test: filtering internal events, which is not implemented — see "Not implemented: public filtering" above.
