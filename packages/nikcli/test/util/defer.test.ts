import { describe, expect, it } from "bun:test"
import { defer } from "@nikcli-ai/util/defer"

describe("defer", () => {
  it("returns an object with Symbol.dispose", () => {
    const d = defer(() => {})
    expect(typeof (d as any)[Symbol.dispose]).toBe("function")
  })

  it("returns an object with Symbol.asyncDispose", () => {
    const d = defer(() => {})
    expect(typeof (d as any)[Symbol.asyncDispose]).toBe("function")
  })

  it("calls fn when Symbol.dispose is triggered", () => {
    let called = false
    const d = defer(() => {
      called = true
    })
    ;(d as any)[Symbol.dispose]()
    expect(called).toBe(true)
  })

  it("calls fn when Symbol.asyncDispose is triggered", async () => {
    let called = false
    const d = defer(() => {
      called = true
    })
    await (d as any)[Symbol.asyncDispose]()
    expect(called).toBe(true)
  })

  it("works with using statement pattern (sync)", () => {
    let cleanupRan = false
    function doWork() {
      using _d = defer(() => {
        cleanupRan = true
      })
      // work done here
    }
    doWork()
    expect(cleanupRan).toBe(true)
  })

  it("cleanup runs even if body throws", () => {
    let cleanupRan = false
    function doWork() {
      using _d = defer(() => {
        cleanupRan = true
      })
      throw new Error("boom")
    }
    try {
      doWork()
    } catch {}
    expect(cleanupRan).toBe(true)
  })
})
