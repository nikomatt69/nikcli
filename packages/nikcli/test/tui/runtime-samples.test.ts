import { describe, expect, it } from "bun:test"
import {
  brailleGraph,
  cpuPercent,
  formatBytes,
  retain,
  runtimeStatus,
  statusIcon,
  STATUS_WINDOW_MS,
} from "@tui/util/runtime-samples"

/**
 * The readings behind the devtools bar.
 *
 * Worth pinning because the bar exists to be trusted at a glance while the TUI
 * is in use: a status that lags a stall, or a graph that flattens the spike
 * that caused it, is worse than no bar at all.
 */

const at = (time: number, delay: number) => ({ time, delay })

describe("runtimeStatus", () => {
  it("no samples yet is not a problem", () => {
    expect(runtimeStatus([])).toBe("normal")
  })

  it("a loop keeping up reads normal", () => {
    expect(runtimeStatus([at(0, 2), at(2000, 5), at(4000, 3)])).toBe("normal")
  })

  it("crosses to medium at 20ms and to high at 100ms", () => {
    expect(runtimeStatus([at(0, 19.9)])).toBe("normal")
    expect(runtimeStatus([at(0, 20)])).toBe("medium")
    expect(runtimeStatus([at(0, 99.9)])).toBe("medium")
    expect(runtimeStatus([at(0, 100)])).toBe("high")
  })

  /**
   * The reason it takes the maximum. A stream that stalls for 300ms once a
   * second is not smooth, and a mean would report it as calm.
   */
  it("one stall among quiet samples still reads high", () => {
    expect(runtimeStatus([at(0, 1), at(1000, 1), at(2000, 300), at(3000, 1)])).toBe("high")
  })

  it("forgets a stall once it leaves the window", () => {
    const old = at(0, 500)
    const recent = at(STATUS_WINDOW_MS + 1000, 1)
    expect(runtimeStatus([old, recent])).toBe("normal")
  })

  it("has a distinct icon per level", () => {
    const icons = (["normal", "medium", "high"] as const).map(statusIcon)
    expect(new Set(icons).size).toBe(3)
  })
})

describe("cpuPercent", () => {
  it("a core fully busy for the whole interval is 100%", () => {
    expect(cpuPercent(1_000_000, 1_000)).toBe(100)
  })

  it("half a core is 50%", () => {
    expect(cpuPercent(500_000, 1_000)).toBe(50)
  })

  it("no elapsed time cannot divide, and reports nothing rather than Infinity", () => {
    expect(cpuPercent(1_000, 0)).toBe(0)
    expect(cpuPercent(1_000, -5)).toBe(0)
  })
})

describe("retain", () => {
  it("drops samples older than the retention window", () => {
    const samples = [{ time: 0 }, { time: 25_000 }, { time: 40_000 }]
    expect(retain(samples, 40_000).map((sample) => sample.time)).toEqual([25_000, 40_000])
  })
})

describe("brailleGraph", () => {
  it("produces exactly one character per column", () => {
    expect(brailleGraph([1, 2, 3, 4, 5, 6], 3)).toHaveLength(3)
    expect(brailleGraph([1, 2, 3], 10)).toHaveLength(10)
  })

  it("every character is a braille cell", () => {
    for (const ch of brailleGraph([5, 1, 9, 3, 7, 2], 3)) {
      expect(ch.codePointAt(0)!).toBeGreaterThanOrEqual(0x2800)
      expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0x28ff)
    }
  })

  it("a flat series does not pretend to have shape", () => {
    const flat = brailleGraph([4, 4, 4, 4, 4, 4], 3)
    expect(new Set(flat).size).toBe(1)
  })

  /** The graph grows from the right, so the newest sample is always at the end. */
  it("pads short input on the left", () => {
    const graph = brailleGraph([0, 10], 5)
    expect(graph).toHaveLength(5)
    expect(graph.at(-1)).not.toBe(graph.at(0))
  })

  it("degenerate widths return nothing rather than throwing", () => {
    expect(brailleGraph([1, 2, 3], 0)).toBe("")
    expect(brailleGraph([], 10)).toBe("")
  })
})

describe("formatBytes", () => {
  it("reads the way a person would say it", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2_048)).toBe("2.0 kB")
    expect(formatBytes(50 * 1_024 * 1_024)).toBe("50 MB")
    expect(formatBytes(1_536 * 1_024 * 1_024)).toBe("1.5 GB")
  })
})
