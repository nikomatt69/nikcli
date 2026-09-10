# EOT-05: Reactive State and Query Coordination

Status: proposed. Tier: 2. Phase: P2. Dependencies: EOT-03, EOT-04.
Owner: TUI sync/session maintainers. [Roadmap](../ROADMAP.md).

## Problem and Evidence

Evidence B07, B08, B18: `context/sync.tsx` combines query coordination, event reducers, readiness, and caches. It already
has generation guards and an LRU. Session rendering already consumes v2 entries with stable turn identity; proposing that
migration again would duplicate shipped work. Large catalogs and optional endpoint failures need separate load/error state.

## Scope and Non-Goals

Deepen existing state seams without replacing Solid stores, duplicating domain schemas, or moving synchronous derivation
into Effect. Keep all existing SDK consumer contracts and the view model needed by plugins. Do not remove v1 data solely
because the main transcript uses v2; inventory remaining usage first.

## Design and Requirements

1. Separate three responsibilities, extracting modules only when a coherent interface emerges: transport/query lifecycle,
   pure event reduction, and fine-grained view selectors. Keep `SyncProvider` the composition point during migration.
2. Key query coordination by server identity, directory/workspace, session, operation, and arguments. Deduplicate identical
   in-flight reads; cancel superseded generations; cap concurrency at a measured value (candidate 4 per active bootstrap).
   Prioritize essential data and active-session work over inactive refreshes; never deduplicate mutations as reads.
   The coordinator owns the request; each caller owns only its waiter. Cancelling one waiter cannot abort another caller's
   shared read. Abort when the last waiter leaves or the whole scope is superseded. Give each request a unique generation
   so late settlement cannot commit data or delete a newer in-flight entry under the same key.
3. Model each resource as idle/loading/ready/stale/error with data retention and typed error details. Aggregate readiness
   from essential resources; optional provider catalog, analytics, or connector failure cannot become a fabricated empty
   success. Show useful partial UI without claiming all resources are complete.
4. Consume SDK `{ data, error }` explicitly or use `throwOnError` at the adapter and map failures. Preserve previous data
   as visibly stale where safe; required auth/config failures cannot use that fallback. A session list error is not a
   legitimate zero-session result.
5. Update store paths by entity ID, preserve unchanged object identity, and use `batch` only for related commits. Keep
   memo inputs narrow; avoid mapping the entire transcript on every token. Extend existing `stabilize`/`fromEntries`
   rather than creating a second canonical conversation model. Treat source comments describing v1 as stale documentation.
6. Make event handling incremental and idempotent under EOT-04 recovery. Track entity versions where present; delete must
   invalidate dependent maps and pending refreshes. Derived indexes are rebuilt from authoritative state, never persisted
   as an alternate source of truth.
7. Keep the existing 25-session/30-minute LRU as the starting policy. Add byte/weight accounting and pinning for the active
   session, required parent/child views, pending user decisions, and in-flight mutations. Eviction must release every
   dependent map and timer. If pinned data alone exceeds budget, page old transcript segments and show pressure; do not
   evict a permission prompt or discard a draft to meet a memory target.
   Reserve count/byte capacity atomically before admitting decoded payloads, including in-flight reservations. Account for
   retained payloads conservatively; the bound describes coordinator-owned data, not total process RSS. Keep only bounded
   pending-decision metadata and fetch large bodies on demand. If no data can be paged/evicted, reject new cache admission
   with a visible pressure state and preserve the authoritative server record and existing draft; do not keep growing a
   pinned map. The transport must bound response size before decoding. Release reservations on every failure/cancellation
   and allow retry after space is freed. Any temporary overshoot needs a stated, tested bound, not an unlimited exception.
8. Separate retained data from mounted rows. Page history using stable cursors and preserve the active range; a virtualized
   renderer by itself does not bound the store. Query keys and cache invalidation must include server/workspace identity.

## Bootstrap Contract

Essential config/agents/provider selection establish a usable prompt only after their own successful validation. Continue
mode additionally requires the requested session to be resolved. Optional resources report individual failure and offer a
bounded retry without restarting the full app. Workspace change increments one generation, cancels old requests, clears
only incompatible scoped state, and starts one coordinated bootstrap. A late old response cannot reset readiness.

## Failure and Cancellation

Query cancellation and supersession are not errors visible to the user. Active failures remain observable. A failed
coalesced request must release its in-flight key so a retry is possible; all waiters receive a consistent outcome.
Stop debounces, timers, subscriptions, and retries at cleanup. On stream desynchronization, mark affected resources stale
and use EOT-04's restoration barrier; never merge an unversioned stale snapshot over newer entries.

## Acceptance and Verification

- Fifty callers for the same read produce one transport request; different workspaces/arguments produce independent reads.
  Concurrent transport count never exceeds the configured cap; priority work cannot starve indefinitely.
- Cancel one of two waiters, then the last waiter; only last-waiter cancellation aborts the request. Race that abort with
  a same-key retry and old completion; the new request survives and only its generation may commit.
- Resolve bootstrap responses out of order across workspace changes; assert only the active generation commits.
- Optional failure renders partial data plus failure state; required config/auth failure never reports ready. Retry after
  failure works because the in-flight key is cleared.
- Append a token to one turn in a 10,000-turn fixture; unrelated turn identities and mounted subtrees remain stable. Measure
  selector/reducer cost, not merely equality of the final text.
- Session eviction removes all dependent data and pending refreshes while preserving pinned sessions and drafts. Delete
  followed by a late response cannot resurrect the deleted session.
- Exhaust capacity using only non-evictable metadata, then race two admissions for the last reservation. Assert bounded
  memory accounting, visible rejection with server-side pending decisions still discoverable, and successful retry after
  a reservation is released. No missing-data success may replace pressure/error state.
- Extend `packages/nikcli/test/tui/streaming-store.test.ts`, `packages/nikcli/test/tui/session-view.test.ts`,
  `packages/nikcli/test/tui/session-tabs.test.ts`, and tests under `packages/nikcli/test/tui/util/`.
- From `packages/nikcli`: `bun test test/tui/streaming-store.test.ts test/tui/session-view.test.ts test/tui/session-tabs.test.ts`.
  Add coordination/capacity assertions to these seams; existing tests alone do not prove the proposed query layer.
- Meet EOT-01 input/flush/memory budgets; target at least 30% fewer redundant reads in the repeated-session fixture while
  preserving the exact authoritative end state. A reduced request count caused by stale UI is a failure.

## Migration and Rollback

Extract pure reducers first with replay-equivalence tests, then coordinate one resource family, then replace bootstrap
coordination and cache accounting. Compare pure projections in tests, never double-issue live mutations. Remove v1 store
fields only after all view/plugin/export consumers migrate. Roll back selectors or coordination behind `useSync` while
preserving truthful resource states and cancellation; do not reintroduce empty-success fallbacks.
