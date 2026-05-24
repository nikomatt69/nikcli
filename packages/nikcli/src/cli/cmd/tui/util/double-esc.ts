/**
 * Pure state machine for the "double-ESC to interrupt the active session" gesture.
 *
 * Behavior contract (mirrored by the in-component handler in
 * `src/cli/cmd/tui/component/prompt/index.tsx`):
 *
 * - The first ESC press while a session is busy arms the interrupt and starts a
 *   reset timer (default 5 s). The press is consumed but no abort is fired.
 * - A second ESC press within the reset window fires the abort and resets the
 *   counter back to 0.
 * - Any press while the reset window is closed (no in-flight arm) re-arms.
 * - Several conditions short-circuit the press without changing state:
 *     - the autocomplete popup is visible
 *     - the prompt input is not focused
 *     - the prompt is in shell mode (handler-only side effect: clears shell mode)
 *     - no session is currently attached
 * - Successive aborts always start cleanly: after firing, the next ESC re-arms.
 *
 * The actual session abort is delegated to the host via the `onAbort` callback;
 * this module is pure and side-effect free aside from `setTimeout`/`clearTimeout`,
 * which can be swapped out for tests via the `timer` option.
 */

export interface DoubleEscContext {
  /** Autocomplete popup is open; the gesture should be a no-op. */
  autocompleteVisible: boolean
  /** Prompt input has focus; required for the gesture to register. */
  inputFocused: boolean
  /** Prompt is in shell mode. The handler clears shell mode and consumes the press. */
  shellMode: boolean
  /** Active session ID; `undefined` means there is nothing to abort. */
  sessionID: string | undefined
}

export type DoubleEscOutcome =
  /** Press ignored entirely; no state changes. */
  | { type: "ignored"; reason: "autocomplete" | "blurred" | "no-session" }
  /** Press consumed only to leave shell mode. */
  | { type: "exit-shell-mode" }
  /** Press counted as the first ESC; armed. */
  | { type: "armed"; count: 1 }
  /** Press counted as the second ESC; abort fired for `sessionID`. */
  | { type: "abort"; sessionID: string }

export interface TimerHandle {
  /** Cancel a previously scheduled callback. Idempotent. */
  cancel(): void
}

export interface TimerLike {
  /**
   * Schedule a callback to run after `ms` milliseconds. Returns a handle that
   * the caller can use to cancel it. Implementations should match the semantics
   * of `setTimeout` but can be deterministic in tests.
   */
  schedule(ms: number, fn: () => void): TimerHandle
}

const defaultTimer: TimerLike = {
  schedule(ms, fn) {
    const id = setTimeout(fn, ms)
    return { cancel: () => clearTimeout(id) }
  },
}

export interface DoubleEscOptions {
  /** Milliseconds to keep the first press armed. Default 5000. */
  resetMs?: number
  /** Timer implementation. Defaults to wall-clock setTimeout. */
  timer?: TimerLike
}

export interface DoubleEscMachine {
  /** Current arm count, exposed for the host to render hints. */
  readonly count: number
  /** Process a single ESC press and return what the host should do. */
  press(ctx: DoubleEscContext): DoubleEscOutcome
  /** Force-reset the machine (e.g. when the session goes idle). */
  reset(): void
  /** Release scheduled timers; call from cleanup hooks. */
  dispose(): void
}

export function createDoubleEsc(options: DoubleEscOptions = {}): DoubleEscMachine {
  const resetMs = options.resetMs ?? 5000
  const timer = options.timer ?? defaultTimer

  let count = 0
  let pending: TimerHandle | undefined

  const clearTimer = () => {
    if (!pending) return
    pending.cancel()
    pending = undefined
  }

  return {
    get count() {
      return count
    },
    press(ctx) {
      if (ctx.autocompleteVisible) return { type: "ignored", reason: "autocomplete" }
      if (!ctx.inputFocused) return { type: "ignored", reason: "blurred" }
      if (ctx.shellMode) {
        // Handler exits shell mode without touching the interrupt counter.
        return { type: "exit-shell-mode" }
      }
      if (!ctx.sessionID) return { type: "ignored", reason: "no-session" }

      count += 1
      clearTimer()

      if (count >= 2) {
        const sessionID = ctx.sessionID
        count = 0
        return { type: "abort", sessionID }
      }

      pending = timer.schedule(resetMs, () => {
        pending = undefined
        count = 0
      })
      return { type: "armed", count: 1 }
    },
    reset() {
      count = 0
      clearTimer()
    },
    dispose() {
      clearTimer()
    },
  }
}
