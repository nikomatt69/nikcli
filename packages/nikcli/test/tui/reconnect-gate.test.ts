import { describe, expect, it } from "bun:test"
import { createReconnectGate } from "@tui/util/reconnect"

describe("createReconnectGate", () => {
  it("does not refetch on the initial connection", () => {
    // `onMount` already loaded state; refetching here would double startup.
    const gate = createReconnectGate()
    expect(gate.observe("connecting")).toBe(false)
    expect(gate.observe("connected")).toBe(false)
  })

  it("refetches after the stream dropped and came back", () => {
    // Anything published while the stream was down is gone: the feed is a live
    // fan-out with no cursor to resume from.
    const gate = createReconnectGate()
    gate.observe("connecting")
    gate.observe("connected")
    expect(gate.observe("reconnecting")).toBe(false)
    expect(gate.observe("connected")).toBe(true)
  })

  it("refetches once per outage, not once per attempt", () => {
    const gate = createReconnectGate()
    gate.observe("connected")
    for (let i = 0; i < 5; i++) gate.observe("reconnecting")
    expect(gate.observe("connected")).toBe(true)
    expect(gate.observe("connected")).toBe(false)
  })

  it("recovers from every subsequent outage", () => {
    const gate = createReconnectGate()
    gate.observe("connected")
    gate.observe("reconnecting")
    expect(gate.observe("connected")).toBe(true)
    gate.observe("reconnecting")
    expect(gate.observe("connected")).toBe(true)
  })

  it("stays pending while the outage lasts", () => {
    const gate = createReconnectGate()
    expect(gate.pending).toBe(false)
    gate.observe("reconnecting")
    expect(gate.pending).toBe(true)
    gate.observe("connected")
    expect(gate.pending).toBe(false)
  })

  it("does not treat connecting as an outage", () => {
    // Only `markReconnecting` reports a dropped stream; `connecting` is the
    // state the signal starts in.
    const gate = createReconnectGate()
    gate.observe("connected")
    gate.observe("connecting")
    expect(gate.observe("connected")).toBe(false)
  })

  it("never reports a refetch while still disconnected", () => {
    const gate = createReconnectGate()
    gate.observe("connected")
    expect(gate.observe("reconnecting")).toBe(false)
    expect(gate.observe("reconnecting")).toBe(false)
  })
})
