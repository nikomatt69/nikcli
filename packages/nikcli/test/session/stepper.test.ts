import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"
import { SessionEntry } from "@/session/v2/entry"
import { Stepper } from "@/session/v2/stepper"

function sampleUserEntry(sessionID: string): SessionEntry.Entry {
  return SessionEntry.User.parse({
    id: Identifier.ascending("event"),
    sessionID,
    timestamp: 1,
    type: "user",
    text: "hi",
    files: [],
    agents: [],
  })
}

describe("Stepper", () => {
  it("reduce appends and finishes pending", () => {
    const e1 = sampleUserEntry("s1")
    let state: Stepper.MemoryState = { entries: [], pending: [] }
    state = Stepper.reduce(state, { type: "append", entry: e1 })
    expect(state.entries).toHaveLength(1)

    const pending = sampleUserEntry("s1")
    state = Stepper.reduce(state, { type: "appendPending", entry: pending })
    expect(state.pending).toHaveLength(1)
    state = Stepper.reduce(state, { type: "finish", result: {} })
    expect(state.pending).toHaveLength(0)
    expect(state.entries).toHaveLength(2)

    state = Stepper.reduce(state, { type: "reset" })
    expect(state.entries).toHaveLength(0)
  })

  it("reduce replacePending and removeLastPending", () => {
    let state: Stepper.MemoryState = { entries: [], pending: [sampleUserEntry("s")] }
    state = Stepper.reduce(state, { type: "removeLastPending" })
    expect(state.pending).toHaveLength(0)
    const a = sampleUserEntry("s")
    const b = sampleUserEntry("s")
    state = Stepper.reduce(state, { type: "appendPending", entry: a })
    state = Stepper.reduce(state, { type: "appendPending", entry: b })
    state = Stepper.reduce(state, { type: "replacePending", entries: [a] })
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]!.id).toBe(a.id)
  })

  it("memory adapter mirrors reduce semantics", async () => {
    const { adapter, state } = Stepper.memory()
    const sid = "sess-mem"
    const u = sampleUserEntry(sid)
    await adapter.appendEntry(sid, u)
    expect(state.entries).toHaveLength(1)
    await adapter.appendPending(sid, sampleUserEntry(sid))
    expect(state.pending).toHaveLength(1)
    await adapter.finish(sid, {})
    expect(state.pending).toHaveLength(0)
    expect(state.entries).toHaveLength(2)
    expect(adapter.getCurrentAssistant(sid)).toBe(state)
  })
})
