import { afterEach, describe, expect, it } from "bun:test"
import { SessionCompaction } from "@/session/compaction"

describe("SessionCompaction circuit breaker (opencode #38102)", () => {
  afterEach(() => {
    SessionCompaction.clearAllCompactionFailures()
  })

  it("starts with the circuit closed", () => {
    expect(SessionCompaction.isCompactionCircuitOpen("s1")).toBe(false)
  })

  it("stays closed below the threshold", () => {
    SessionCompaction.recordCompactionFailure("s1")
    SessionCompaction.recordCompactionFailure("s1")
    expect(SessionCompaction.isCompactionCircuitOpen("s1")).toBe(false)
  })

  it("opens the circuit after MAX_CONSECUTIVE_COMPACTION_FAILURES (3) hits", () => {
    SessionCompaction.recordCompactionFailure("s1")
    SessionCompaction.recordCompactionFailure("s1")
    SessionCompaction.recordCompactionFailure("s1")
    expect(SessionCompaction.isCompactionCircuitOpen("s1")).toBe(true)
  })

  it("the third recordCompactionFailure returns 3 and fourth returns 4", () => {
    expect(SessionCompaction.recordCompactionFailure("s2")).toBe(1)
    expect(SessionCompaction.recordCompactionFailure("s2")).toBe(2)
    expect(SessionCompaction.recordCompactionFailure("s2")).toBe(3)
    expect(SessionCompaction.recordCompactionFailure("s2")).toBe(4)
  })

  it("resetCompactionFailures closes the circuit again", () => {
    SessionCompaction.recordCompactionFailure("s3")
    SessionCompaction.recordCompactionFailure("s3")
    SessionCompaction.recordCompactionFailure("s3")
    expect(SessionCompaction.isCompactionCircuitOpen("s3")).toBe(true)
    SessionCompaction.resetCompactionFailures("s3")
    expect(SessionCompaction.isCompactionCircuitOpen("s3")).toBe(false)
  })

  it("tracks failures per session independently", () => {
    SessionCompaction.recordCompactionFailure("alpha")
    SessionCompaction.recordCompactionFailure("alpha")
    SessionCompaction.recordCompactionFailure("beta")
    expect(SessionCompaction.isCompactionCircuitOpen("alpha")).toBe(false)
    expect(SessionCompaction.isCompactionCircuitOpen("beta")).toBe(false)
  })

  it("resetCompactionFailures for one session does not affect another", () => {
    SessionCompaction.recordCompactionFailure("x")
    SessionCompaction.recordCompactionFailure("y")
    SessionCompaction.recordCompactionFailure("y")
    SessionCompaction.recordCompactionFailure("y")
    SessionCompaction.resetCompactionFailures("x")
    expect(SessionCompaction.isCompactionCircuitOpen("y")).toBe(true)
  })

  it("CircuitOpenError carries sessionID, failures, and message", () => {
    const err = new SessionCompaction.CircuitOpenError({
      sessionID: "s4",
      failures: 3,
      message: "circuit open",
    })
    expect(err.name).toBe("SessionCompactionCircuitOpenError")
    expect(err.sessionID).toBe("s4")
    expect(err.failures).toBe(3)
    expect(err.message).toBe("circuit open")
  })
})

describe("SessionCompaction.MAX_CONSECUTIVE_COMPACTION_FAILURES", () => {
  it("equals 3 (matches upstream opencode #38102)", () => {
    expect(SessionCompaction.MAX_CONSECUTIVE_COMPACTION_FAILURES).toBe(3)
  })
})
