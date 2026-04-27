import { describe, expect, it } from "bun:test"
import { signal } from "@/util/signal"
import { runBench, printBenchResult, compareBenchmarks } from "../bench/runner"

describe("signal", () => {
  it("returns an object with trigger and wait methods", () => {
    const s = signal()
    expect(typeof s.trigger).toBe("function")
    expect(typeof s.wait).toBe("function")
  })

  it("wait returns a promise", () => {
    const s = signal()
    expect(s.wait()).toBeInstanceOf(Promise)
  })

  it("promise resolves after trigger is called", async () => {
    const s = signal()
    let resolved = false
    const p = s.wait().then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)
    s.trigger()
    await p
    expect(resolved).toBe(true)
  })

  it("multiple waits on the same signal all resolve", async () => {
    const s = signal()
    const results: number[] = []
    const p1 = s.wait().then(() => results.push(1))
    const p2 = s.wait().then(() => results.push(2))
    s.trigger()
    await Promise.all([p1, p2])
    expect(results).toContain(1)
    expect(results).toContain(2)
  })

  it("trigger can be called before wait and wait still resolves", async () => {
    const s = signal()
    s.trigger()
    let resolved = false
    await s.wait().then(() => {
      resolved = true
    })
    expect(resolved).toBe(true)
  })

  it("each signal() call creates independent signals", async () => {
    const s1 = signal()
    const s2 = signal()
    let count = 0
    const p1 = s1.wait().then(() => count++)
    const p2 = s2.wait().then(() => count++)
    s1.trigger()
    await p1
    expect(count).toBe(1)
    s2.trigger()
    await p2
    expect(count).toBe(2)
  })

  it("wait returns undefined (not a value)", async () => {
    const s = signal()
    s.trigger()
    const value = await s.wait()
    expect(value).toBeUndefined()
  })

  describe("benchmark", () => {
    it("signal creation throughput", () => {
      const r = runBench("signal create", "util-signal", 200_000, () => {
        signal()
      })
      printBenchResult(r)
      compareBenchmarks("util-signal")
      expect(r.opsPerSec).toBeGreaterThan(100_000)
    })
  })
})
