/**
 * Barriers for tests that coordinate with concurrent work.
 *
 * A `sleep` in a racing test encodes a guess about how long the other side
 * takes. Under CI load the guess is wrong, and the usual repair — a longer
 * sleep — makes the suite slower without making it correct. These helpers wait
 * for the event itself, and fail with what they were waiting for rather than
 * hanging until the runner's timeout.
 */

export type Deferred<T> = {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res as (value: T) => void
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A latch that opens after `count` arrivals. Use it to wait for N concurrent
 * operations to reach a point, instead of sleeping long enough that they
 * probably have.
 */
export function barrier(count = 1) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be a positive integer")
  let remaining = count
  const gate = deferred<void>()
  return {
    /** Signal one arrival. Extra arrivals past `count` are ignored. */
    arrive() {
      if (remaining === 0) return
      remaining--
      if (remaining === 0) gate.resolve()
    },
    get pending() {
      return remaining
    },
    /** Resolves once `count` arrivals have happened. */
    wait: (options?: { timeoutMs?: number; label?: string }) =>
      withTimeout(gate.promise, options?.timeoutMs ?? 5000, options?.label ?? `barrier(${count})`),
  }
}

/**
 * Reject instead of hanging. A test that waits forever reports as a runner
 * timeout with no indication of which wait failed.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Poll a condition that has no event to subscribe to. Still not a sleep: it
 * returns as soon as the condition holds and fails with the label otherwise.
 * Prefer `barrier`/`deferred` when the producer can signal directly.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options?: { timeoutMs?: number; intervalMs?: number; label?: string },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 5000
  const intervalMs = options?.intervalMs ?? 5
  const label = options?.label ?? "condition"
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
