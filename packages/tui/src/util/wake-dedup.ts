/**
 * Consumer-side envelope dedup for the TUI.
 *
 * The "parent ↔ child wake ordering race" can cause the same envelope
 * (delegation.completed, loop.run.finished, mission.finished, ...) to be
 * delivered twice through the bus. The TUI handles every envelope at
 * least once, so the second arrival triggers duplicate work: a second
 * `refreshBackgroundJobs`, a second `Woke parent session` log line, and
 * (in the worst case) a second scheduler wake.
 *
 * `createWakeDedup` is a thin policy layer on top of the existing
 * `createLru` primitive (`./lru-cache.ts`). It tracks the recency of
 * wake-shaped keys (e.g. `delegation:<id>:<status>`) and lets the caller
 * ask "have I already processed this envelope?" via `shouldProcess`.
 *
 * Design choices:
 *
 * 1. **Default-allow**: when the extractor returns `undefined`, the
 *    envelope is passed through. The TUI's functional dedup (binary
 *    search, reconcile, etc.) remains the safety net for events we
 *    don't explicitly cover.
 *
 * 2. **TTL + cap**: defaults of 60 s and 256 entries cover any
 *    plausible reconnect window without unbounded growth
 *    (256 × ~32 B ≈ 8 KB).
 *
 * 3. **Reuses `createLru`**: the policy ("non-extractable key is
 *    non-blocking") lives here; the data structure (`Map`-backed
 *    ordered tracker) lives in `lru-cache.ts`. The two are kept apart
 *    so the LRU primitive stays a pure data structure with no TUI
 *    assumptions.
 *
 * TODO(livello 2): when the server adds `id:` to the SSE payload and
 * `Last-Event-ID` reconnect support, pass `envelope.id` directly to
 * `shouldProcess` and reconnect from `last-id` instead of zero.
 */
import { createLru, type Lru } from "./lru-cache"

export type WakeDedupOptions = {
  /** Cap on tracked keys. Default 256 — covers retry bursts + reconnect storms. */
  maxEntries?: number
  /** TTL of an entry. Default 60 000 ms — covers any plausible reconnect gap. */
  ttlMs?: number
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number
}

/**
 * Extracts a stable key from an envelope. Return `undefined` to
 * disable dedup for that envelope (non-blocking default-allow).
 */
export type WakeKeyExtractor = (envelope: { type?: string; properties?: unknown }) => string | undefined

export type WakeDedup = {
  /**
   * Returns `true` the first time a given key is seen, `false` on
   * subsequent arrivals. Returns `true` when the extractor returns
   * `undefined`.
   */
  shouldProcess(envelope: { type?: string; properties?: unknown }): boolean
  /** Drop a key from the tracker (e.g. on session.deleted). */
  forget(key: string): void
  /** Number of tracked keys. Useful for tests and observability. */
  size(): number
  /** Clear all tracked keys. */
  clear(): void
}

export function createWakeDedup(extract: WakeKeyExtractor, options: WakeDedupOptions = {}): WakeDedup {
  const lru: Lru = createLru({
    maxEntries: options.maxEntries ?? 256,
    ttlMs: options.ttlMs ?? 60_000,
    now: options.now,
  })

  return {
    shouldProcess(envelope) {
      const key = extract(envelope)
      if (key === undefined) return true
      // Evict expired entries on every check so a long-idle TUI doesn't
      // re-process old envelopes on reconnect.
      lru.evictExpired()
      if (lru.has(key)) return false
      lru.touch(key)
      // Safety net: cap memory growth if the extractor returns a
      // high-cardinality space.
      lru.evictOverflow()
      return true
    },
    forget(key) {
      lru.forget(key)
    },
    size() {
      return lru.size
    },
    clear() {
      lru.clear()
    },
  }
}
