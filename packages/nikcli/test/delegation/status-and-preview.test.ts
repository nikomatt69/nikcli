import { afterAll, describe, expect, it } from "bun:test"
import { Delegation } from "../../src/delegation/manager"
import { recordBenchmark, flushBenchmarkRun } from "../benchmarks/runner"

describe("Delegation.Status", () => {
  it("parses all terminal and running status values", () => {
    const values = ["running", "complete", "error", "timeout", "cancelled", "orphaned"] as const
    for (const v of values) {
      expect(Delegation.Status.parse(v)).toBe(v)
    }
  })

  it("rejects invalid status", () => {
    expect(() => Delegation.Status.parse("pending")).toThrow()
  })
})

describe("Delegation.Event.Completed", () => {
  it("parses a completed-event payload", () => {
    const payload = {
      delegationID: "del_1",
      parentSessionID: "ses_parent",
      status: "complete" as const,
      title: "Done",
    }
    const parsed = Delegation.Event.Completed.properties.parse(payload)
    expect(parsed).toEqual(payload)
  })
})

describe("Delegation.outputPreview", () => {
  it("returns progressSummary when still running", () => {
    expect(Delegation.outputPreview({ status: "running", progressSummary: "working", resultSummary: "final" })).toBe(
      "working",
    )
  })

  it("prefers resultSummary when not running", () => {
    expect(Delegation.outputPreview({ status: "complete", progressSummary: "p", resultSummary: "r" })).toBe("r")
  })

  it("falls back to progress when result missing", () => {
    expect(Delegation.outputPreview({ status: "error", resultSummary: undefined, progressSummary: "p" })).toBe("p")
  })
})

describe("Delegation.Status parse benchmark", () => {
  it("records Status.parse hot path", () => {
    const values = ["running", "complete", "error", "timeout", "cancelled", "orphaned"] as const
    const iterations = 50_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      Delegation.Status.parse(values[i % values.length]!)
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "delegation",
      module: "status",
      scenario: "Status.parse loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})

afterAll(() => {
  return flushBenchmarkRun()
})
