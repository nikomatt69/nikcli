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
