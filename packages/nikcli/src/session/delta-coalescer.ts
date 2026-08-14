import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "delta-coalescer" })

/**
 * Coalesces rapid-fire Storage.write calls for streaming deltas.
 *
 * Instead of writing every text-delta/reasoning-delta to disk immediately
 * (which can be ~500 writes per response), this batches writes and only
 * flushes to Storage at a configurable interval or on explicit demand.
 *
 * The Bus event (for UI streaming) is still published immediately on every
 * delta so the TUI stays responsive — only the disk write is coalesced.
 */
export namespace DeltaCoalescer {
  interface PendingWrite {
    key: string[]
    content: unknown
    /** Timer id for the scheduled flush */
    timer: ReturnType<typeof setTimeout> | null
    /** Whether this write has an outstanding flush scheduled */
    dirty: boolean
  }

  const pending = new Map<string, PendingWrite>()
  const DEFAULT_FLUSH_MS = 150

  /** Expose flush counter for diagnostics */
  export function flushCount(): number {
    return _flushCount
  }
  let _flushCount = 0
  const _flushCallback: Map<string, (key: string[], content: unknown) => Promise<void>> = new Map()

  function cacheKey(key: string[]): string {
    return key.join("/")
  }

  /**
   * Register a write to be coalesced. The content will be flushed to disk
   * after `flushMs` milliseconds, or immediately if `flushNow` is true.
   *
   * Each call overwrites the previous content for the same key — this is
   * correct because streaming deltas accumulate into the same part object,
   * so the latest content is always the complete state.
   */
  export function schedule(
    key: string[],
    content: unknown,
    onFlush: (key: string[], content: unknown) => Promise<void>,
    flushMs: number = DEFAULT_FLUSH_MS,
  ): void {
    const id = cacheKey(key)
    const existing = pending.get(id)

    if (existing) {
      // Overwrite content and reset the timer
      existing.content = content
      existing.dirty = true
      _flushCallback.set(id, onFlush)

      if (existing.timer !== null) {
        clearTimeout(existing.timer)
      }
      existing.timer = setTimeout(() => {
        flush(id)
      }, flushMs)
      log.debug("schedule (coalesced)", { id, pendingCount: pending.size })
    } else {
      const entry: PendingWrite = {
        key,
        content,
        timer: setTimeout(() => {
          flush(id)
        }, flushMs),
        dirty: true,
      }
      pending.set(id, entry)
      _flushCallback.set(id, onFlush)
      log.debug("schedule (new)", { id, pendingCount: pending.size, flushMs })
    }
  }

  /**
   * Force-flush a specific key immediately.
   * Used for terminal events (text-end, reasoning-end, tool-result, etc.)
   * where we need the data persisted right away.
   */
  export async function flushNow(key: string[]): Promise<void> {
    const id = cacheKey(key)
    await flush(id)
  }

  /** Discard a pending write without persisting it. */
  export function discard(key: string[]): void {
    const id = cacheKey(key)
    const entry = pending.get(id)
    if (entry && entry.timer !== null) clearTimeout(entry.timer)
    pending.delete(id)
    _flushCallback.delete(id)
  }

  /**
   * Flush all pending writes. Call this when the session ends or
   * before critical operations that need all data on disk.
   */
  export async function flushAll(): Promise<void> {
    _flushCount++
    const ids = [...pending.keys()]
    await Promise.all(ids.map((id) => flush(id)))
  }

  async function flush(id: string): Promise<void> {
    const entry = pending.get(id)
    if (!entry || !entry.dirty) return

    const callback = _flushCallback.get(id)
    if (!callback) return

    // Mark clean before async to prevent re-entrant flushes
    entry.dirty = false
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }

    log.debug("flush start", { id, pendingCount: pending.size })
    const start = Date.now()
    try {
      await callback(entry.key, entry.content)
      log.debug("flush complete", { id, pendingCount: pending.size, duration: Date.now() - start })
    } catch (e) {
      log.error("flush failed", { key: entry.key.join("/"), error: e })
      // Re-mark dirty so it retries on next flush
      entry.dirty = true
    }

    // Remove from pending if no new write came in during flush
    if (!entry.dirty) {
      pending.delete(id)
      _flushCallback.delete(id)
    }
  }

  /** Number of currently pending writes. For testing/diagnostics. */
  export function pendingCount(): number {
    return pending.size
  }

  /** Diagnostic info about the current state. */
  export function stats(): {
    pendingCount: number
    flushCount: number
    pendingKeys: string[]
  } {
    return {
      pendingCount: pending.size,
      flushCount: _flushCount,
      pendingKeys: [...pending.keys()],
    }
  }

  /** Check if a key has a pending flush scheduled. */
  export function isPending(key: string[]): boolean {
    const id = cacheKey(key)
    const entry = pending.get(id)
    return entry !== undefined && entry.dirty
  }

  /**
   * Clear all pending writes without flushing. For tests/cleanup only.
   */
  export function clear(): void {
    for (const entry of pending.values()) {
      if (entry.timer !== null) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
    }
    pending.clear()
    _flushCallback.clear()
  }
}
