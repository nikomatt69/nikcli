/**
 * Dependency-free LRU + TTL key tracker.
 *
 * Implements the eviction primitive from `specs/opencode-parity/02-tui-cache-eviction.md`.
 * It deliberately does NOT own the cached values — it tracks recency/expiry of keys and
 * reports which keys should be dropped, so the caller (the Solid sync store) stays the
 * single source of truth for the data itself.
 */

export type LruOptions = {
  /** Hard cap on tracked keys. Overflow evicts least-recently-used first. */
  maxEntries: number
  /** Optional time-to-live in ms; expired keys are reported by `evictExpired`. */
  ttlMs?: number
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number
}

export function createLru(options: LruOptions) {
  const { maxEntries, ttlMs } = options
  const now = options.now ?? Date.now
  // Map preserves insertion order; we re-insert on touch to keep MRU at the end.
  const lastSeen = new Map<string, number>()

  function touch(key: string): void {
    if (lastSeen.has(key)) lastSeen.delete(key)
    lastSeen.set(key, now())
  }

  function has(key: string): boolean {
    return lastSeen.has(key)
  }

  function forget(key: string): void {
    lastSeen.delete(key)
  }

  /** Remove and return keys whose TTL has elapsed. No-op when `ttlMs` is unset. */
  function evictExpired(): string[] {
    if (ttlMs === undefined) return []
    const cutoff = now() - ttlMs
    const expired: string[] = []
    for (const [key, seen] of lastSeen) {
      if (seen <= cutoff) expired.push(key)
    }
    for (const key of expired) lastSeen.delete(key)
    return expired
  }

  /**
   * Remove and return least-recently-used keys beyond `maxEntries`.
   * `pinned` keys are never evicted and are skipped when choosing victims.
   */
  function evictOverflow(pinned?: Iterable<string>): string[] {
    const pinnedSet = pinned ? new Set(pinned) : undefined
    const overflow = lastSeen.size - maxEntries
    if (overflow <= 0) return []
    const evictable = [...lastSeen.keys()].filter((k) => !pinnedSet?.has(k))
    const dropped = evictable.slice(0, Math.min(overflow, evictable.length))
    for (const key of dropped) lastSeen.delete(key)
    return dropped
  }

  function clear(): void {
    lastSeen.clear()
  }

  function keys(): string[] {
    return [...lastSeen.keys()]
  }

  return {
    touch,
    has,
    forget,
    evictExpired,
    evictOverflow,
    clear,
    keys,
    get size() {
      return lastSeen.size
    },
  }
}

export type Lru = ReturnType<typeof createLru>
