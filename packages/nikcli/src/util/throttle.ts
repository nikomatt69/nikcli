/**
 * Trailing-edge throttle: coalesces rapid calls so `fn` runs at most once per
 * `intervalMs`, always with the most recent arguments, and guarantees a final
 * trailing invocation. Use it to keep streaming-driven side effects (disk
 * writes, network syncs, metadata updates) from firing on every single token.
 *
 * - `call(...args)` records the latest args and schedules a run.
 * - `flush()` runs any pending call immediately (e.g. on teardown).
 * - `cancel()` drops any pending call without running it.
 */
export function throttleTrailing<A extends unknown[]>(fn: (...args: A) => void, intervalMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastRun = 0
  let pending: A | undefined

  const fire = () => {
    timer = undefined
    if (!pending) return
    lastRun = Date.now()
    const args = pending
    pending = undefined
    fn(...args)
  }

  return {
    call(...args: A) {
      pending = args
      if (timer) return
      timer = setTimeout(fire, Math.max(0, intervalMs - (Date.now() - lastRun)))
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      fire()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
  }
}
