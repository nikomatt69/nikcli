/**
 * Shared execution bound for the interactive search tools.
 *
 * A pathological pattern (or a search root on a slow network mount) can keep ripgrep or the
 * filesystem walker running effectively forever, which stalls the whole turn with no signal to the
 * model. Bounding the search turns that hang into a focused, actionable failure instead.
 */
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000

export class SearchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Search timed out after ${Math.round(timeoutMs / 1_000)} seconds. Consider using a more specific path or pattern.`,
    )
    this.name = "SearchTimeoutError"
  }
}

/**
 * Runs `run` under a deadline, aborting the signal it receives when the deadline expires so the
 * underlying work (ripgrep child processes, directory walks) actually terminates rather than
 * continuing in the background after the caller has given up.
 *
 * The caller's own abort signal is chained in, so a cancelled turn tears the search down too.
 */
export async function withSearchDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { readonly abort?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS

  // Never start work under a signal that is already aborted: it would be handed a signal whose
  // `abort` event has already fired, so anything waiting on that event would wait forever.
  if (options.abort?.aborted) throw options.abort.reason ?? new Error("Search aborted")

  const controller = new AbortController()
  const onCallerAbort = () => controller.abort(options.abort?.reason)
  options.abort?.addEventListener("abort", onCallerAbort, { once: true })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new SearchTimeoutError(timeoutMs))
  }, timeoutMs)

  try {
    const result = await Promise.race([
      run(controller.signal),
      // Fallback for work that ignores the signal entirely and would otherwise hang forever.
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => {
            if (timedOut) reject(new SearchTimeoutError(timeoutMs))
          },
          { once: true },
        )
      }),
    ])
    // Work that honours the signal settles normally — often with an empty result, because its
    // child process was killed. That must not read as "no matches"; the deadline still expired.
    if (timedOut) throw new SearchTimeoutError(timeoutMs)
    return result
  } catch (error) {
    if (timedOut) throw new SearchTimeoutError(timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
    options.abort?.removeEventListener("abort", onCallerAbort)
  }
}
