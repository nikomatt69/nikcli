import { createSignal, type Accessor } from "solid-js"
import { debounce, type Scheduled } from "@solid-primitives/scheduled"

export function createDebouncedSignal<T>(value: T, ms: number): [Accessor<T>, Scheduled<[value: T]>] {
  const [get, set] = createSignal(value)
  return [get, debounce((v: T) => set(() => v), ms)]
}

export type LatestOnlyContext<TArgs extends unknown[]> = {
  input: TArgs
  /** Aborted when a newer invocation supersedes this one. */
  signal: AbortSignal
}

/**
 * Wrap an async function so only the most recent invocation's result is returned;
 * superseded calls resolve to `undefined` and have their `signal` aborted.
 *
 * Implements the "latest-only" half of request throttling
 * (debounce is already provided by `createDebouncedSignal` / `@solid-primitives/scheduled`).
 * Correctness does not require the wrapped fn to honor `signal` — the monotonic id guard
 * alone drops stale results — but honoring it avoids wasted in-flight work.
 */
export function createLatestOnlyAsync<TArgs extends unknown[], R>(
  fn: (ctx: LatestOnlyContext<TArgs>) => Promise<R>,
): (...input: TArgs) => Promise<R | undefined> {
  let id = 0
  let controller: AbortController | undefined

  return async (...input: TArgs) => {
    id += 1
    const current = id
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal

    try {
      const result = await fn({ input, signal })
      if (current !== id) return undefined
      return result
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return undefined
      throw error
    }
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  )
}
