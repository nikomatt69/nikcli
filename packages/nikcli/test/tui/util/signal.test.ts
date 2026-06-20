import { describe, expect, it } from "bun:test"
import { createLatestOnlyAsync, isAbortError } from "../../../src/cli/cmd/tui/util/signal"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("createLatestOnlyAsync", () => {
  it("drops a slow earlier result when a newer call resolves", async () => {
    const run = createLatestOnlyAsync<[number, number], number>(async ({ input: [value, ms] }) => {
      await delay(ms)
      return value
    })

    const first = run(1, 40) // slow
    const second = run(2, 5) // fast, supersedes

    expect(await second).toBe(2)
    expect(await first).toBeUndefined() // stale -> dropped
  })

  it("aborts the superseded call's signal", async () => {
    const signals: AbortSignal[] = []
    const run = createLatestOnlyAsync<[number], number>(async ({ input: [v], signal }) => {
      signals.push(signal)
      await delay(20)
      return v
    })
    const a = run(1)
    const b = run(2)
    await Promise.all([a, b])
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it("swallows AbortError as undefined", async () => {
    const run = createLatestOnlyAsync<[], number>(async ({ signal }) => {
      await delay(20)
      if (signal.aborted) {
        const err = new Error("aborted")
        err.name = "AbortError"
        throw err
      }
      return 1
    })
    const first = run()
    const second = run()
    expect(await first).toBeUndefined()
    expect(await second).toBe(1)
  })

  it("propagates non-abort errors from the latest call", async () => {
    const run = createLatestOnlyAsync<[], number>(async () => {
      throw new Error("boom")
    })
    await expect(run()).rejects.toThrow("boom")
  })
})

describe("isAbortError", () => {
  it("recognizes AbortError by name", () => {
    const err = new Error("x")
    err.name = "AbortError"
    expect(isAbortError(err)).toBe(true)
    expect(isAbortError(new Error("x"))).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})
