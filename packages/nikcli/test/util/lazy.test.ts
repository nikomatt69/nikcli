import { describe, expect, it } from "bun:test"
import { lazy } from "@/util/lazy"
import { runBench, printBenchResult, compareBenchmarks } from "../bench/runner"

describe("lazy", () => {
  it("calls factory only once", () => {
    let calls = 0
    const getValue = lazy(() => {
      calls++
      return 42
    })
    getValue()
    getValue()
    getValue()
    expect(calls).toBe(1)
  })

  it("returns the factory result on every call", () => {
    const getValue = lazy(() => ({ x: 10 }))
    const a = getValue()
    const b = getValue()
    expect(a).toBe(b) // same reference
    expect(a.x).toBe(10)
  })

  it("reset causes re-evaluation on next call", () => {
    let n = 0
    const getValue = lazy(() => ++n)
    expect(getValue()).toBe(1)
    getValue.reset()
    expect(getValue()).toBe(2)
    expect(getValue()).toBe(2) // cached after second call
  })

  it("reset makes factory callable again", () => {
    let calls = 0
    const getValue = lazy(() => {
      calls++
      return "value"
    })
    getValue()
    expect(calls).toBe(1)
    getValue.reset()
    getValue()
    expect(calls).toBe(2)
  })

  it("works with factory returning undefined", () => {
    const getValue = lazy(() => undefined)
    expect(getValue()).toBeUndefined()
    expect(getValue()).toBeUndefined()
  })

  it("works with factory returning false/0/empty string", () => {
    const getFalse = lazy(() => false)
    const getZero = lazy(() => 0)
    const getEmpty = lazy(() => "")
    expect(getFalse()).toBe(false)
    expect(getZero()).toBe(0)
    expect(getEmpty()).toBe("")
    // Should still be cached
    expect(getFalse()).toBe(false)
  })

  it("exposes reset method", () => {
    const getValue = lazy(() => 1)
    expect(typeof getValue.reset).toBe("function")
  })

  describe("benchmark", () => {
    it("lazy cached access throughput", () => {
      const getValue = lazy(() => ({ result: 42 }))
      getValue() // prime cache
      const r = runBench("lazy cached access", "util-lazy", 1_000_000, () => {
        getValue()
      })
      printBenchResult(r)
      compareBenchmarks("util-lazy")
      expect(r.opsPerSec).toBeGreaterThan(5_000_000)
    })

    it("lazy with reset overhead", () => {
      let n = 0
      const getValue = lazy(() => n++)
      const r = runBench("lazy create+call+reset", "util-lazy", 200_000, () => {
        const fn = lazy(() => n++)
        fn()
        fn.reset()
        fn()
      })
      printBenchResult(r)
      expect(r.opsPerSec).toBeGreaterThan(50_000)
    })
  })
})
