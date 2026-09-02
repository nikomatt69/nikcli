import { describe, expect, it } from "bun:test"
import { withTimeout } from "@/util/timeout"

describe("withTimeout", () => {
  it("resolves with the promise value if it completes in time", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000)
    expect(result).toBe(42)
  })

  it("resolves with string value", async () => {
    const result = await withTimeout(Promise.resolve("hello"), 1000)
    expect(result).toBe("hello")
  })

  it("propagates rejection from the original promise", async () => {
    const rejected = Promise.reject(new Error("original error"))
    await expect(withTimeout(rejected, 1000)).rejects.toThrow("original error")
  })

  it("rejects with timeout error when promise is too slow", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200))
    await expect(withTimeout(slow, 50)).rejects.toThrow("timed out")
  })

  it("timeout error message includes the ms value", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 500))
    let msg = ""
    try {
      await withTimeout(slow, 50)
    } catch (e) {
      // SAFETY: `withTimeout` rejects with an `Error`; this catch wraps only
      // that call.
      msg = (e as Error).message
    }
    expect(msg).toContain("50ms")
  })

  it("resolves if promise completes just before timeout", async () => {
    const fast = new Promise<number>((resolve) => setTimeout(() => resolve(7), 10))
    const result = await withTimeout(fast, 500)
    expect(result).toBe(7)
  })

  it("handles async function returning object", async () => {
    const fn = async () => ({ a: 1, b: 2 })
    const result = await withTimeout(fn(), 1000)
    expect(result).toEqual({ a: 1, b: 2 })
  })

  it("handles nested withTimeout calls", async () => {
    const inner = withTimeout(Promise.resolve(99), 1000)
    const outer = withTimeout(inner, 2000)
    expect(await outer).toBe(99)
  })
})
