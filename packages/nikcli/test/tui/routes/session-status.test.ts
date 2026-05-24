import { describe, expect, it } from "bun:test"
import { sessionStatusDisplay, formatTreeChangeSummary } from "@/cli/cmd/tui/routes/tree/session-status"
import { RGBA } from "@opentui/core"
import { recordBenchmark } from "../../benchmarks/runner"

const theme = {
  textMuted: RGBA.fromInts(128, 128, 128),
  info: RGBA.fromInts(0, 120, 215),
  warning: RGBA.fromInts(255, 165, 0),
}

describe("sessionStatusDisplay", () => {
  describe("null / undefined status", () => {
    it("returns idle label for undefined", () => {
      const result = sessionStatusDisplay(undefined, theme)
      expect(result.label).toBe("idle")
    })

    it("returns textMuted fg for undefined", () => {
      const result = sessionStatusDisplay(undefined, theme)
      expect(result.fg).toBe(theme.textMuted)
    })

    it("includes DIM attributes for undefined", () => {
      const result = sessionStatusDisplay(undefined, theme)
      expect(typeof result.attributes).toBe("number")
    })
  })

  describe("idle status", () => {
    it("returns idle label", () => {
      const result = sessionStatusDisplay({ type: "idle" }, theme)
      expect(result.label).toBe("idle")
    })

    it("returns textMuted color", () => {
      const result = sessionStatusDisplay({ type: "idle" }, theme)
      expect(result.fg).toBe(theme.textMuted)
    })
  })

  describe("busy status", () => {
    it("returns busy label", () => {
      const result = sessionStatusDisplay({ type: "busy" }, theme)
      expect(result.label).toBe("busy")
    })

    it("returns info color", () => {
      const result = sessionStatusDisplay({ type: "busy" }, theme)
      expect(result.fg).toBe(theme.info)
    })

    it("includes BOLD attributes", () => {
      const result = sessionStatusDisplay({ type: "busy" }, theme)
      expect(typeof result.attributes).toBe("number")
      expect(result.attributes).toBeGreaterThan(0)
    })
  })

  describe("retry status", () => {
    it("returns the retry message as label", () => {
      const result = sessionStatusDisplay({ type: "retry", attempt: 1, message: "rate limited", next: 0 }, theme)
      expect(result.label).toContain("rate limited")
    })

    it("includes attempt number for attempt > 1", () => {
      const result = sessionStatusDisplay({ type: "retry", attempt: 3, message: "overload", next: 0 }, theme)
      expect(result.label).toContain("(3)")
    })

    it("does not include attempt number for attempt 1", () => {
      const result = sessionStatusDisplay({ type: "retry", attempt: 1, message: "error", next: 0 }, theme)
      expect(result.label).not.toContain("(1)")
      expect(result.label).toBe("error")
    })

    it("uses retry fallback label when message is empty", () => {
      const result = sessionStatusDisplay({ type: "retry", attempt: 1, message: "", next: 0 }, theme)
      expect(result.label).toBe("retry")
    })

    it("uses retry #N fallback for attempt > 1 with empty message", () => {
      const result = sessionStatusDisplay({ type: "retry", attempt: 2, message: "", next: 0 }, theme)
      expect(result.label).toBe("retry #2")
    })

    it("returns warning color", () => {
      const result = sessionStatusDisplay({ type: "retry", attempt: 1, message: "err", next: 0 }, theme)
      expect(result.fg).toBe(theme.warning)
    })

    it("truncates long message to default 64 chars", () => {
      const longMsg = "x".repeat(100)
      const result = sessionStatusDisplay({ type: "retry", attempt: 1, message: longMsg, next: 0 }, theme)
      expect(result.label.length).toBeLessThanOrEqual(64)
    })

    it("respects maxMessageChars option", () => {
      const result = sessionStatusDisplay(
        { type: "retry", attempt: 1, message: "a very long message here", next: 0 },
        theme,
        { maxMessageChars: 10 },
      )
      expect(result.label.length).toBeLessThanOrEqual(10)
    })

    it("normalizes newlines in message", () => {
      const result = sessionStatusDisplay({ type: "retry", attempt: 1, message: "line1\nline2", next: 0 }, theme)
      expect(result.label).not.toContain("\n")
    })
  })

  describe("benchmark", () => {
    it("sessionStatusDisplay throughput", () => {
      const statuses: any[] = [
        undefined,
        { type: "idle" },
        { type: "busy" },
        { type: "retry", attempt: 1, message: "rate limited", next: 0 },
        { type: "retry", attempt: 3, message: "overload", next: 0 },
      ]
      let i = 0
      recordBenchmark({
        suite: "tui-session-status",
        module: "sessionStatusDisplay",
        scenario: "throughput",
        iterations: 300_000,
        value: sessionStatusDisplay(statuses[i++ % statuses.length], theme) as unknown as number,
        unit: "ms",
      })
    })
  })
})

describe("formatTreeChangeSummary", () => {
  it("formats files, additions, deletions", () => {
    expect(formatTreeChangeSummary({ files: 3, additions: 10, deletions: 5 })).toBe("3f +10/-5")
  })

  it("handles zero values", () => {
    expect(formatTreeChangeSummary({ files: 0, additions: 0, deletions: 0 })).toBe("0f +0/-0")
  })

  it("handles large numbers", () => {
    const result = formatTreeChangeSummary({ files: 100, additions: 5000, deletions: 3000 })
    expect(result).toBe("100f +5000/-3000")
  })

  it("benchmark", () => {
    recordBenchmark({
      suite: "tui-session-status",
      module: "formatTreeChangeSummary",
      scenario: "throughput",
      iterations: 500_000,
      value: formatTreeChangeSummary({ files: 3, additions: 10, deletions: 5 }) as unknown as number,
      unit: "ms",
    })
  })
})
