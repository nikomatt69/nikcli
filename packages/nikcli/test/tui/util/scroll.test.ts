import { describe, expect, it } from "bun:test"
import { CustomSpeedScroll, getScrollAcceleration, scrollChildIntoView } from "@tui/util/scroll"
import { recordBenchmark } from "../../benchmarks/runner"

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
    const s = getScrollAcceleration({
      scroll_acceleration: { enabled: true },
    } as any)
    const first = s.tick(Date.now())
    expect(first).toBeGreaterThanOrEqual(1)
  })

  it("acceleration builds up with rapid ticks", () => {
    const s = getScrollAcceleration({
      scroll_acceleration: { enabled: true },
    } as any)
    const now = Date.now()
    s.tick(now)
    const second = s.tick(now + 10)
    expect(second).toBeGreaterThan(1)
  })

  it("acceleration resets to 1 after slow ticks", () => {
    const s = getScrollAcceleration({
      scroll_acceleration: { enabled: true },
    } as any)
    const now = Date.now()
    s.tick(now)
    s.tick(now + 10)
    s.tick(now + 20)
    const slow = s.tick(now + 500)
    expect(slow).toBe(1)
  })

  it("reset restores initial state for acceleration", () => {
    const s = getScrollAcceleration({
      scroll_acceleration: { enabled: true },
    } as any)
    const now = Date.now()
    s.tick(now)
    s.tick(now + 10)
    s.reset()
    const afterReset = s.tick(now + 40)
    expect(afterReset).toBe(1)
  })

  describe("benchmark", () => {
    it("CustomSpeedScroll tick throughput", () => {
      const scroll = new CustomSpeedScroll(3)
      recordBenchmark({
        suite: "tui-scroll",
        module: "CustomSpeedScroll.tick",
        scenario: "throughput",
        iterations: 1_000_000,
        value: scroll.tick() as unknown as number,
        unit: "ms",
      })
    })

    it("getScrollAcceleration throughput", () => {
      recordBenchmark({
        suite: "tui-scroll",
        module: "getScrollAcceleration(undefined)",
        scenario: "throughput",
        iterations: 200_000,
        value: getScrollAcceleration(undefined) as unknown as number,
        unit: "ms",
      })
    })
  })
})

describe("scrollChildIntoView", () => {
  it("no-ops when the box is missing, destroyed, or the child id is empty", () => {
    expect(() => scrollChildIntoView(undefined, "row-1")).not.toThrow()
    expect(() => scrollChildIntoView({ isDestroyed: true } as never, "row-1")).not.toThrow()
    expect(() =>
      scrollChildIntoView(
        {
          isDestroyed: false,
          scrollChildIntoView() {
            throw new Error("should not run")
          },
        } as never,
        "",
      ),
    ).not.toThrow()
  })

  it("delegates to OpenTUI scrollChildIntoView unless centering is requested", () => {
    const seen: string[] = []
    const scroll = {
      isDestroyed: false,
      viewport: { height: 10, y: 0 },
      getRenderable() {
        return { y: 40 }
      },
      scrollBy() {
        throw new Error("plain into-view must not use scrollBy")
      },
      scrollChildIntoView(id: string) {
        seen.push(id)
      },
    }
    scrollChildIntoView(scroll as never, "row-7")
    expect(seen).toEqual(["row-7"])
  })

  it("centers by comparing the child against the viewport, not the box origin", () => {
    const moved: number[] = []
    const scroll = {
      isDestroyed: false,
      viewport: { height: 10, y: 20 },
      getRenderable() {
        return { y: 48 }
      },
      scrollBy(delta: number) {
        moved.push(delta)
      },
      scrollChildIntoView() {
        throw new Error("center path must not use nearest-edge into-view")
      },
    }
    scrollChildIntoView(scroll as never, "row-7", { center: true })
    expect(moved).toEqual([23])
  })
})
