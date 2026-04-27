import { describe, expect, it } from "bun:test"
import { CustomSpeedScroll, getScrollAcceleration } from "@/cli/cmd/tui/util/scroll"
import { runBench, printBenchResult, compareBenchmarks } from "../../bench/runner"

describe("CustomSpeedScroll", () => {
  it("tick returns the configured speed", () => {
    const scroll = new CustomSpeedScroll(3)
    expect(scroll.tick()).toBe(3)
  })

  it("tick always returns the same speed regardless of timing", () => {
    const scroll = new CustomSpeedScroll(5)
    expect(scroll.tick(0)).toBe(5)
    expect(scroll.tick(100)).toBe(5)
    expect(scroll.tick(10000)).toBe(5)
  })

  it("reset does not change speed", () => {
    const scroll = new CustomSpeedScroll(7)
    scroll.reset()
    expect(scroll.tick()).toBe(7)
  })

  it("works with speed 1", () => {
    const scroll = new CustomSpeedScroll(1)
    expect(scroll.tick()).toBe(1)
  })

  it("works with fractional speed", () => {
    const scroll = new CustomSpeedScroll(2.5)
    expect(scroll.tick()).toBe(2.5)
  })
})

describe("getScrollAcceleration", () => {
  it("returns CustomSpeedScroll(3) when no config", () => {
    const s = getScrollAcceleration(undefined)
    expect(s.tick()).toBe(3)
  })

  it("returns CustomSpeedScroll(3) when config is empty object", () => {
    const s = getScrollAcceleration({} as any)
    expect(s.tick()).toBe(3)
  })

  it("returns CustomSpeedScroll with configured speed when scroll_speed is set", () => {
    const s = getScrollAcceleration({ scroll_speed: 8 } as any)
    expect(s.tick()).toBe(8)
  })

  it("returns MacOS-like acceleration when scroll_acceleration.enabled is true", () => {
    const s = getScrollAcceleration({ scroll_acceleration: { enabled: true } } as any)
    // MacOS accel starts at momentum 1 (cold)
    const first = s.tick(performance.now())
    expect(first).toBeGreaterThanOrEqual(1)
  })

  it("acceleration builds up with rapid ticks", () => {
    const s = getScrollAcceleration({ scroll_acceleration: { enabled: true } } as any)
    const now = performance.now()
    s.tick(now)
    const second = s.tick(now + 10) // < 50ms gap → momentum increases
    expect(second).toBeGreaterThan(1)
  })

  it("acceleration resets to 1 after slow ticks", () => {
    const s = getScrollAcceleration({ scroll_acceleration: { enabled: true } } as any)
    const now = performance.now()
    // Build up momentum
    s.tick(now)
    s.tick(now + 10)
    s.tick(now + 20)
    // Then a slow tick (> 120ms) resets momentum
    const slow = s.tick(now + 500)
    expect(slow).toBe(1)
  })

  it("reset restores initial state for acceleration", () => {
    const s = getScrollAcceleration({ scroll_acceleration: { enabled: true } } as any)
    const now = performance.now()
    s.tick(now)
    s.tick(now + 10)
    s.reset()
    const afterReset = s.tick(now + 20)
    // After reset, last=0 so delta is large → momentum resets to 1
    expect(afterReset).toBe(1)
  })

  describe("benchmark", () => {
    it("CustomSpeedScroll tick throughput", () => {
      const scroll = new CustomSpeedScroll(3)
      const r = runBench("CustomSpeedScroll.tick", "tui-scroll", 1_000_000, () => {
        scroll.tick()
      })
      printBenchResult(r)
      compareBenchmarks("tui-scroll")
      expect(r.opsPerSec).toBeGreaterThan(5_000_000)
    })

    it("getScrollAcceleration throughput", () => {
      const r = runBench("getScrollAcceleration(undefined)", "tui-scroll", 200_000, () => {
        getScrollAcceleration(undefined)
      })
      printBenchResult(r)
      expect(r.opsPerSec).toBeGreaterThan(100_000)
    })
  })
})
