import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"
import { SessionEntry } from "@/session/v2/entry"
import { Stepper } from "@/session/v2/stepper"
import { recordBenchmark } from "../benchmarks/runner"

function user(sessionID: string, n: number): SessionEntry.Entry {
  return SessionEntry.User.parse({
    id: Identifier.ascending("event"),
    sessionID,
    timestamp: n,
    type: "user",
    text: `t-${n}`,
    files: [],
    agents: [],
  })
}

describe("Stepper benchmark", () => {
  it("records reduce chain", () => {
    const iterations = 4_000
    let state: Stepper.MemoryState = { entries: [], pending: [] }
    const sid = "bench-stepper"
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      state = Stepper.reduce(state, { type: "append", entry: user(sid, i) })
      if (i % 8 === 0) {
        state = Stepper.reduce(state, { type: "reset" })
      }
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "session",
      module: "stepper",
      scenario: "reduce append with periodic reset",
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: { entries: state.entries.length },
    })
    expect(state.entries.length).toBeGreaterThanOrEqual(0)
  })

  it("records memory adapter appends", async () => {
    const iterations = 2_000
    const { adapter, state } = Stepper.memory()
    const sid = "bench-adapter"
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      await adapter.appendEntry(sid, user(sid, i))
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "session",
      module: "stepper",
      scenario: "memory adapter appendEntry",
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: { totalEntries: state.entries.length },
    })
    expect(state.entries.length).toBe(iterations)
  })
})
