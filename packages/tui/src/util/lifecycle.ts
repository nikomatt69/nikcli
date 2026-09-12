import { onCleanup } from "solid-js"

/**
 * The disposed flag every awaiting dialog was re-inventing.
 *
 * This is the primitive `specs/effect-tui/03-tui-lifecycle.md` builds on:
 * extend it rather than adding a second cancellation helper.
 *
 * A terminal dialog can be dismissed with `esc` while it is parked on an await
 * — an OAuth callback that blocks until the browser approves, a device-code
 * poll, a browser session that is still starting. Solid tears the owner down
 * immediately; the promise resolves afterwards, into a component that no longer
 * exists. Acting on that result is what pushes a new dialog over whatever the
 * user opened next, or disposes the SDK instance under a live session.
 *
 * Two halves, and both are needed:
 *
 * - `signal` cancels the in-flight request. Pass it to the SDK call so the
 *   long poll actually ends instead of running to its own timeout.
 * - `disposed()` is checked *after every await*. Aborting is not synchronous
 *   with the continuation — a request that already resolved still resumes here
 *   — and only the flag catches that race.
 */
export function useAbortOnCleanup() {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  return {
    /** Aborted when the owner is cleaned up. */
    get signal() {
      return controller.signal
    },
    /** True once the owner is gone. Check after every `await`, not just the first. */
    disposed() {
      return controller.signal.aborted
    },
  }
}

export type AbortOnCleanup = ReturnType<typeof useAbortOnCleanup>

/**
 * The same guard for an operation the user can restart.
 *
 * `useAbortOnCleanup` answers "is the owner gone". A retryable flow needs a
 * second question — "has a newer attempt replaced mine" — because disposal is
 * not what makes the first attempt's result wrong. Press `r` while a device
 * code is still being polled and two runs are live at once: the older one
 * resolves into a component that is very much still mounted, and writes its
 * stale start code, status line and session over the newer one's.
 *
 * Each `start()` aborts the previous attempt and takes its own signal and
 * generation. Check `stale()` after every await, exactly as with `disposed()`,
 * and pass the returned `signal` — not a field read off a shared controller,
 * which by then belongs to the attempt that superseded you.
 */
export function useAttempts() {
  let generation = 0
  let current: AbortController | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
    current?.abort()
  })

  return {
    /** Supersede any running attempt and begin a new one. */
    start() {
      current?.abort()
      const own = new AbortController()
      current = own
      const generationAtStart = ++generation
      const stale = () => disposed || generationAtStart !== generation
      return {
        /** Aborted when the owner is cleaned up, or when a newer attempt starts. */
        signal: own.signal,
        /** True once the owner is gone or a newer attempt has superseded this one. */
        stale,
        /**
         * Take ownership of a resource this attempt acquired, or release it if
         * the attempt no longer owns anything.
         *
         * `stale()` answers whether a *result* still matters. A resource is the
         * harder half: an abort signal does not un-open a pty, un-subscribe a
         * watcher, or un-spawn a process that was already in flight when the
         * newer attempt started. Checking `stale()` and returning leaks it —
         * the caller has dropped the only reference and nothing will close it.
         *
         * Returns the resource when this attempt is still current, `undefined`
         * when it has been released, so the call site reads as one statement:
         *
         *     const pty = attempt.adopt(await open(), (p) => p.kill())
         *     if (!pty) return
         *
         * `specs/effect-tui/03-tui-lifecycle.md` — late resource acquisition.
         */
        adopt<R>(resource: R, release: (resource: R) => void): R | undefined {
          if (!stale()) return resource
          try {
            release(resource)
          } catch {
            // A release that throws is already the unhappy path; swallowing it
            // here keeps one stale resource from taking down the flow that
            // superseded it.
          }
          return undefined
        },
      }
    },
    /** True once the owner is gone, regardless of attempts. */
    get disposed() {
      return disposed
    },
  }
}

export type Attempts = ReturnType<typeof useAttempts>
export type Attempt = ReturnType<Attempts["start"]>
