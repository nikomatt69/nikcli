/**
 * Tests for the double-ESC interrupt state machine that backs the prompt's
 * "press ESC twice to abort the active session" gesture.
 *
 * The tests use an in-memory virtual timer so they are fully deterministic
 * across macOS, Linux, and Windows runners — no real `setTimeout` involved.
 */
import { describe, expect, it } from "bun:test"
import { createDoubleEsc, type DoubleEscContext, type TimerHandle, type TimerLike } from "@tui/util/double-esc"

interface FakeTimer extends TimerLike {
  advance(ms: number): void
  pendingCount(): number
}

function fakeTimer(): FakeTimer {
  type Entry = { at: number; fn: () => void; cancelled: boolean }
  let now = 0
  const queue: Entry[] = []

  return {
    schedule(ms, fn): TimerHandle {
      const entry: Entry = { at: now + ms, fn, cancelled: false }
      queue.push(entry)
      return {
        cancel: () => {
          entry.cancelled = true
        },
      }
    },
    advance(ms) {
      now += ms
      // Snapshot then run; callbacks may schedule new entries.
      const due = queue.filter((e) => !e.cancelled && e.at <= now)
      for (const e of due) {
        e.cancelled = true
        e.fn()
      }
    },
    pendingCount() {
      return queue.filter((e) => !e.cancelled).length
    },
  }
}

const baseCtx = (): DoubleEscContext => ({
  autocompleteVisible: false,
  inputFocused: true,
  shellMode: false,
  sessionID: "ses_test",
})

describe("Prompt double-ESC interrupt", () => {
  describe("happy path", () => {
    it("first ESC arms; second within window fires abort with the session id", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })

      const first = m.press(baseCtx())
      expect(first).toEqual({ type: "armed", count: 1 })
      expect(m.count).toBe(1)
      expect(timer.pendingCount()).toBe(1)

      const second = m.press(baseCtx())
      expect(second).toEqual({ type: "abort", sessionID: "ses_test" })
      // Counter is reset and the reset timer is cancelled.
      expect(m.count).toBe(0)
      expect(timer.pendingCount()).toBe(0)
    })

    it("after firing once, the next ESC re-arms cleanly", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })

      m.press(baseCtx())
      m.press(baseCtx()) // fires
      expect(m.count).toBe(0)

      const rearm = m.press(baseCtx())
      expect(rearm).toEqual({ type: "armed", count: 1 })

      const fireAgain = m.press(baseCtx())
      expect(fireAgain).toEqual({ type: "abort", sessionID: "ses_test" })
    })
  })

  describe("reset window", () => {
    it("resets after the default 5s window so a stale press no longer fires", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })

      m.press(baseCtx())
      expect(m.count).toBe(1)

      timer.advance(5000)
      expect(m.count).toBe(0)
      expect(timer.pendingCount()).toBe(0)

      const next = m.press(baseCtx())
      expect(next).toEqual({ type: "armed", count: 1 })
    })

    it("honors a custom reset window", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer, resetMs: 1500 })

      m.press(baseCtx())
      timer.advance(1499)
      // Still armed.
      const inside = m.press(baseCtx())
      expect(inside).toEqual({ type: "abort", sessionID: "ses_test" })

      // Re-arm and let the timer elapse this time.
      m.press(baseCtx())
      timer.advance(1500)
      expect(m.count).toBe(0)
    })

    it("each new arm replaces the previous reset timer", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })

      m.press(baseCtx())
      expect(timer.pendingCount()).toBe(1)
      // Forcing reset() clears it…
      m.reset()
      expect(timer.pendingCount()).toBe(0)
      // …and a fresh press schedules a single new one.
      m.press(baseCtx())
      expect(timer.pendingCount()).toBe(1)
    })
  })

  describe("guards (press ignored)", () => {
    it("does nothing when the autocomplete popup is visible", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })
      const out = m.press({ ...baseCtx(), autocompleteVisible: true })
      expect(out).toEqual({ type: "ignored", reason: "autocomplete" })
      expect(m.count).toBe(0)
      expect(timer.pendingCount()).toBe(0)
    })

    it("does nothing when the prompt input is not focused", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })
      const out = m.press({ ...baseCtx(), inputFocused: false })
      expect(out).toEqual({ type: "ignored", reason: "blurred" })
      expect(m.count).toBe(0)
    })

    it("does nothing when there is no active session", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })
      const out = m.press({ ...baseCtx(), sessionID: undefined })
      expect(out).toEqual({ type: "ignored", reason: "no-session" })
      expect(m.count).toBe(0)
    })

    it("a first ESC armed against a real session is NOT discharged by a later ESC without a session", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })

      const armed = m.press(baseCtx())
      expect(armed).toEqual({ type: "armed", count: 1 })

      const ignored = m.press({ ...baseCtx(), sessionID: undefined })
      expect(ignored).toEqual({ type: "ignored", reason: "no-session" })
      // The arm must survive so a follow-up ESC against the original session
      // (e.g. once the session reattaches) still completes the gesture.
      expect(m.count).toBe(1)
    })
  })

  describe("shell mode", () => {
    it("returns exit-shell-mode without touching the counter", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })
      const out = m.press({ ...baseCtx(), shellMode: true })
      expect(out).toEqual({ type: "exit-shell-mode" })
      expect(m.count).toBe(0)
      expect(timer.pendingCount()).toBe(0)
    })

    it("shell-mode ESC does not consume an in-flight first arm", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })

      m.press(baseCtx()) // armed
      const inShell = m.press({ ...baseCtx(), shellMode: true })
      expect(inShell).toEqual({ type: "exit-shell-mode" })
      // The arm must still be valid.
      expect(m.count).toBe(1)

      const fire = m.press(baseCtx())
      expect(fire).toEqual({ type: "abort", sessionID: "ses_test" })
    })
  })

  describe("session swap mid-gesture", () => {
    it("aborts the session bound to the second press, not the first", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })

      m.press({ ...baseCtx(), sessionID: "ses_first" })
      const fire = m.press({ ...baseCtx(), sessionID: "ses_second" })
      expect(fire).toEqual({ type: "abort", sessionID: "ses_second" })
    })
  })

  describe("lifecycle", () => {
    it("dispose() cancels any pending reset timer", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })
      m.press(baseCtx())
      expect(timer.pendingCount()).toBe(1)
      m.dispose()
      expect(timer.pendingCount()).toBe(0)
    })

    it("reset() called when there is no pending state is a no-op", () => {
      const timer = fakeTimer()
      const m = createDoubleEsc({ timer })
      expect(() => m.reset()).not.toThrow()
      expect(m.count).toBe(0)
      expect(timer.pendingCount()).toBe(0)
    })
  })
})
