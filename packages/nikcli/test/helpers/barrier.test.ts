import { describe, expect, it } from "bun:test"
import { barrier, deferred, waitFor, withTimeout } from "./barrier"

describe("deferred", () => {
  it("resolves from the outside", async () => {
    const gate = deferred<number>()
    queueMicrotask(() => gate.resolve(7))
    expect(await gate.promise).toBe(7)
  })

  it("rejects from the outside", async () => {
    const gate = deferred()
    gate.reject(new Error("nope"))
    await expect(gate.promise).rejects.toThrow("nope")
  })
})

describe("barrier", () => {
  it("opens only after every arrival", async () => {
    const gate = barrier(3)
    let opened = false
    void gate.wait().then(() => (opened = true))
    gate.arrive()
    gate.arrive()
    await Promise.resolve()
    expect(opened).toBe(false)
    expect(gate.pending).toBe(1)
    gate.arrive()
    await gate.wait()
    expect(gate.pending).toBe(0)
  })

  it("ignores arrivals past the count", () => {
    const gate = barrier(1)
    gate.arrive()
    gate.arrive()
    expect(gate.pending).toBe(0)
  })

  it("fails with the label instead of hanging", async () => {
    const gate = barrier(2)
    gate.arrive()
    await expect(gate.wait({ timeoutMs: 20, label: "second worker" })).rejects.toThrow("second worker")
  })

  it("rejects a non-positive count", () => {
    expect(() => barrier(0)).toThrow(RangeError)
  })
})

describe("withTimeout", () => {
  it("passes a value through", async () => {
    expect(await withTimeout(Promise.resolve("ok"), 50, "x")).toBe("ok")
  })

  it("names what it was waiting for", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "the flush")).rejects.toThrow("the flush")
  })

  it("does not leave a timer that outlives the test", async () => {
    // Resolving early must clear the timer; an uncleared one keeps the loop
    // alive and shows up as a leaked handle.
    await withTimeout(Promise.resolve(1), 30_000, "fast")
  })
})

describe("waitFor", () => {
  it("returns as soon as the condition holds", async () => {
    let ready = false
    setTimeout(() => (ready = true), 10)
    await waitFor(() => ready, { timeoutMs: 500, label: "ready flag" })
    expect(ready).toBe(true)
  })

  it("supports an async condition", async () => {
    let count = 0
    await waitFor(async () => ++count > 2, { timeoutMs: 500 })
    expect(count).toBeGreaterThan(2)
  })

  it("fails with the label", async () => {
    await expect(waitFor(() => false, { timeoutMs: 20, label: "never" })).rejects.toThrow("never")
  })
})
