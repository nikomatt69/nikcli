import { describe, expect, it } from "bun:test"
import { DEFAULT_SEARCH_TIMEOUT_MS, SearchTimeoutError, withSearchDeadline } from "@/tool/search-deadline"

const never = (signal: AbortSignal) =>
  new Promise<string>((resolve) => {
    signal.addEventListener("abort", () => resolve("observed-abort"), { once: true })
  })

describe("withSearchDeadline", () => {
  it("returns the result when the work finishes in time", async () => {
    await expect(withSearchDeadline(async () => "done", { timeoutMs: 1_000 })).resolves.toBe("done")
  })

  it("defaults to a 30 second bound", () => {
    expect(DEFAULT_SEARCH_TIMEOUT_MS).toBe(30_000)
  })

  it("fails with an actionable message when the deadline expires", async () => {
    const promise = withSearchDeadline(never, { timeoutMs: 10 })
    await expect(promise).rejects.toThrow(SearchTimeoutError)
    await expect(promise).rejects.toThrow(/Search timed out after 0 seconds\. Consider using a more specific path/)
  })

  it("aborts the signal handed to the work so the search terminates", async () => {
    let observed: AbortSignal | undefined
    await withSearchDeadline(
      (signal) => {
        observed = signal
        return never(signal)
      },
      { timeoutMs: 10 },
    ).catch(() => undefined)

    expect(observed?.aborted).toBe(true)
    expect((observed?.reason as Error)?.name).toBe("SearchTimeoutError")
  })

  it("reports the deadline even when the work resolves by observing the abort", async () => {
    // ripgrep resolves (empty) once its child is killed rather than rejecting; the caller must
    // still see a timeout instead of a silent "no matches".
    await expect(withSearchDeadline(never, { timeoutMs: 10 })).rejects.toThrow(SearchTimeoutError)
  })

  it("propagates a caller abort to the work without reporting a timeout", async () => {
    const caller = new AbortController()
    let observed: AbortSignal | undefined
    const promise = withSearchDeadline(
      (signal) => {
        observed = signal
        return never(signal)
      },
      { abort: caller.signal, timeoutMs: 10_000 },
    )
    caller.abort(new Error("user cancelled"))

    await expect(promise).resolves.toBe("observed-abort")
    expect(observed?.aborted).toBe(true)
  })

  it("refuses to start when the caller signal is already aborted", async () => {
    // Starting anyway would hand the work a signal whose `abort` event has already fired, so work
    // that waits on that event would never settle and the tool would hang.
    const caller = new AbortController()
    caller.abort(new Error("already gone"))

    let started = false
    await expect(
      withSearchDeadline(
        (signal) => {
          started = true
          return never(signal)
        },
        { abort: caller.signal, timeoutMs: 10_000 },
      ),
    ).rejects.toThrow("already gone")
    expect(started).toBe(false)
  })

  it("surfaces the underlying failure when the work rejects before the deadline", async () => {
    await expect(
      withSearchDeadline(
        async () => {
          throw new Error("rg exploded")
        },
        { timeoutMs: 10_000 },
      ),
    ).rejects.toThrow("rg exploded")
  })
})
