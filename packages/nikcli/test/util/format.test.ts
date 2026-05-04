import { describe, expect, it } from "bun:test"
import { formatDuration } from "@/util/format"
import { recordBenchmark, compareBenchmarkRuns } from "../benchmarks/runner"    

describe("formatDuration", () => {
  describe("zero and negative", () => {
    it("returns empty string for 0", () => {
      expect(formatDuration(0)).toBe("")
    })

    it("returns empty string for negative", () => {
      expect(formatDuration(-1)).toBe("")
      expect(formatDuration(-100)).toBe("")
    })
  })

  describe("seconds range (< 60s)", () => {
    it("formats 1 second", () => {
      expect(formatDuration(1)).toBe("1s")
    })

    it("formats 30 seconds", () => {
      expect(formatDuration(30)).toBe("30s")
    })

    it("formats 59 seconds", () => {
      expect(formatDuration(59)).toBe("59s")
    })
  })

  describe("minutes range (60s – 3599s)", () => {
    it("formats exact 1 minute", () => {
      expect(formatDuration(60)).toBe("1m")
    })

    it("formats 1 minute 30 seconds", () => {
      expect(formatDuration(90)).toBe("1m 30s")
    })

    it("formats 2 minutes no remainder", () => {
      expect(formatDuration(120)).toBe("2m")
    })

    it("formats 59 minutes 59 seconds", () => {
      expect(formatDuration(3599)).toBe("59m 59s")
    })

    it("does not show 0s remainder", () => {
      expect(formatDuration(180)).toBe("3m")
      expect(formatDuration(300)).toBe("5m")
    })
  })

  describe("hours range (3600s – 86399s)", () => {
    it("formats exact 1 hour", () => {
      expect(formatDuration(3600)).toBe("1h")
    })

    it("formats 1 hour 30 minutes", () => {
      expect(formatDuration(5400)).toBe("1h 30m")
    })

    it("formats 2 hours no remainder", () => {
      expect(formatDuration(7200)).toBe("2h")
    })

    it("formats 23 hours 59 minutes", () => {
      expect(formatDuration(86399)).toBe("23h 59m")
    })
  })

  describe("days range (86400s – 604799s)", () => {
    it("formats ~1 day", () => {
      expect(formatDuration(86400)).toBe("~1 day")
    })

    it("formats ~2 days", () => {
      expect(formatDuration(172800)).toBe("~2 days")
    })

    it("formats ~6 days", () => {
      expect(formatDuration(604799)).toBe("~6 days")
    })
  })

  describe("weeks range (>= 604800s)", () => {
    it("formats ~1 week", () => {
      expect(formatDuration(604800)).toBe("~1 week")
    })

    it("formats ~2 weeks", () => {
      expect(formatDuration(1209600)).toBe("~2 weeks")
    })

    it("formats ~4 weeks", () => {
      expect(formatDuration(2419200)).toBe("~4 weeks")
    })
  })

  describe("benchmark", () => {
    it("formatDuration throughput", () => {
      const inputs = [0, 1, 59, 60, 90, 3600, 5400, 86400, 604800]
      let i = 0
      recordBenchmark({
        suite: "util-format",
        module: "formatDuration",
        scenario: "throughput",
        iterations: 200_000,
        value: formatDuration(inputs[i++ % inputs.length]!) as unknown as number,
        unit: "ms",
      })
        formatDuration(inputs[i++ % inputs.length]!)
      })
  })
})
