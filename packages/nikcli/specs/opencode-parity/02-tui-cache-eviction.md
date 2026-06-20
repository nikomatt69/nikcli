## TUI cache eviction

Bound the in-memory state the TUI sync store accumulates across session/workspace hopping.

> Imported from opencode `specs/02-cache-eviction.md`, re-scoped to nikcli's TUI sync store
> (`packages/nikcli`). opencode targets `packages/app/src/context/{global-sync,file}.tsx`;
> nikcli's equivalent is `src/cli/cmd/tui/context/sync.tsx`.

---

### Summary

The TUI keeps a single Solid store with per-session maps (`message`, `part`, `session_diff`,
`todo`, `session_status`, `session_goal`, `background_job`, `monitor`). Entries are added as the
user opens sessions and never released except when a session is explicitly deleted. During long
runs that touch many sessions (and many workspaces), this store grows without bound. We will add
an explicit, shared LRU + TTL eviction primitive and apply it to the highest-volume maps
(`message`/`part`/`session_diff`), pinning the active session so it is never evicted.

---

### Goals

- Prevent unbounded heap growth from sessions that survive navigation.
- Add one reusable eviction helper rather than ad-hoc caps per map.
- Keep the active session (and its children/background jobs) always resident.

### Non-goals

- Server API changes or background jobs.
- Persisting caches to disk.
- Perfect hit rates or prefetching.

---

### Current state

- `src/cli/cmd/tui/context/sync.tsx`
  - `createStore<{ message: Record<string, Message[]>, part: Record<string, Part[]>,
    session_diff: Record<string, FileDiff[]>, todo, session_status, session_goal,
    background_job, monitor, ... }>`.
  - Per-session entries are written in `session.sync()` and via stream events.
  - Eviction happens **only** in `case "session.deleted"` (`delete draft.message[id]`, etc.) and
    on `bootstrap()` reset.
  - Messages are capped per session (oldest `shift()` past ~100), but the **set of sessions** is
    never bounded.
- `syncedSessions: Map<string, "partial"|"full">` tracks which sessions were hydrated; it also
  only clears on bootstrap.

### Evidence

- `wc -l` shows large per-session payloads; no `LRU`/`maxEntries`/`ttl` symbols exist in
  `sync.tsx` (grep: only `splice`/`delete draft` on delete events).

---

### Proposed approach

#### 1) Shared LRU+TTL helper

New `src/cli/cmd/tui/util/lru-cache.ts` (dependency-free):

```ts
type CacheOpts = { maxEntries: number; ttlMs?: number }
// keys are sessionIDs; values are opaque markers used to drive store cleanup
function createLru(opts: CacheOpts) {
  // touch(key), has(key), set(key), evictExpired() -> string[], evictOverflow() -> string[]
}
```

The helper does not hold the data itself — it tracks **recency/expiry of session keys** and
returns the keys to drop, so the Solid store stays the single source of truth.

#### 2) Apply to the sync store

In `sync.tsx`:

- Maintain `sessionLru = createLru({ maxEntries: 20, ttlMs: 30*60_000 })`.
- `touch(sessionID)` whenever a session is rendered/synced (`session.sync`, route navigation,
  stream events for that session).
- After each touch and on a periodic idle tick, collect `evictExpired()` + `evictOverflow()`
  and, inside one `produce`, delete those sessions' `message`/`part`/`session_diff`/`todo` (and
  drop them from `syncedSessions`) — **excluding** the active session, its parent, and any
  session with live `background_job`/`monitor` entries.
- Keep lightweight maps (`session`, `session_status`, `session_goal`) un-evicted — they are
  small and drive list UIs.

#### 3) Pinning rules

Never evict:

- the route's current `sessionID`,
- its `parentID` (and direct children shown in the bg-agents view),
- any session referenced by an active background job or monitor.

---

### Phased implementation steps

1. Add `lru-cache.ts` + unit tests (TTL expiry, LRU order, overflow).
2. Wire `sessionLru.touch(...)` at every session read/render site behind flag
   `tui.cacheEviction` (default off); add dev counters for evicted sessions + retained map sizes.
3. Enable eviction of `part`/`message`/`session_diff` first (highest bytes, easy to re-fetch via
   `session.sync`).
4. Extend to `todo` and `syncedSessions` bookkeeping.
5. Add a dev-only "cache stats" readout (command palette entry) and a "clear caches" action.

---

### Backward compatibility

- In-memory only; no persisted schema changes.
- Re-opening an evicted session simply re-runs `session.sync()` (already idempotent).

---

### Risk + mitigations

- Evicting a session the user returns to → brief re-fetch/flicker. Mitigation: pin active +
  recent; conservative `maxEntries`; re-hydrate via existing `session.sync`.
- Dropping a session with in-flight stream parts → guard by never evicting sessions with a
  non-idle `session_status` or live background job.
- Mis-sized caps → start generous (20 sessions / 30 min) and tune with dev counters.

---

### Validation plan

- Unit: `createLru` TTL + LRU + overflow behavior; `bun test` exit code.
- Manual: open 40+ sessions in a loop; confirm retained `message`/`part` entry count plateaus
  (dev counter) instead of growing monotonically; confirm the active session is never dropped
  mid-stream.

---

### Rollout plan

- Land helper first (flag off).
- Enable file/diff + message/part eviction; observe dev counters.
- Enable remaining maps last.
- `tui.cacheEviction` is the kill switch.

---

### Open questions

- What caps match real usage (sessions kept hot, idle TTL)?
- Should workspace switches eagerly evict the previous workspace's sessions, or rely on TTL?
- Do any consumers assume a session's `message[]` stays resident after navigation away?
