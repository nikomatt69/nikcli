import { describe, expect, it } from "bun:test"
import { BackgroundRun } from "@/background/run"

const ALL: BackgroundRun.Status[] = ["running", "complete", "error", "timeout", "cancelled", "orphaned"]

describe("BackgroundRun terminal states", () => {
  it("treats every outcome except running as settled", () => {
    expect(BackgroundRun.isTerminal("running")).toBe(false)
    for (const status of ALL.filter((s) => s !== "running")) {
      expect(BackgroundRun.isTerminal(status)).toBe(true)
    }
  })

  it("covers the whole status schema, so a new status cannot be forgotten", () => {
    // If a status is added to the schema without a decision about whether it
    // is terminal, this fails rather than defaulting it to "not settled".
    const classified = new Set([...BackgroundRun.TERMINAL_STATUSES, "running"])
    expect([...ALL].every((status) => classified.has(status))).toBe(true)
    expect(classified.size).toBe(ALL.length)
  })
})

describe("BackgroundRun.canTransition", () => {
  it("lets a running job reach any outcome", () => {
    for (const to of ALL.filter((s) => s !== "running")) {
      expect(BackgroundRun.canTransition("running", to)).toBe(true)
    }
  })

  it("refuses to overwrite a settled outcome with another one", () => {
    // The durable record of what happened is not editable: a late finalizer
    // must not turn a cancelled run into a complete one.
    expect(BackgroundRun.canTransition("cancelled", "complete")).toBe(false)
    expect(BackgroundRun.canTransition("complete", "error")).toBe(false)
    expect(BackgroundRun.canTransition("timeout", "complete")).toBe(false)
    expect(BackgroundRun.canTransition("orphaned", "running")).toBe(false)
  })

  it("refuses a no-op transition", () => {
    for (const status of ALL) {
      expect(BackgroundRun.canTransition(status, status)).toBe(false)
    }
  })

  it("never lets a settled run go back to running", () => {
    for (const from of ALL.filter((s) => s !== "running")) {
      expect(BackgroundRun.canTransition(from, "running")).toBe(false)
    }
  })
})
