import { describe, expect, it } from "bun:test"
import { Event } from "../../src/server/event"

describe("server/event", () => {
  it("Event.Connected accepts empty object payload", () => {
    const parsed = Event.Connected.properties.parse({})
    expect(parsed).toEqual({})
  })

  it("Event.Disposed accepts empty object payload", () => {
    const parsed = Event.Disposed.properties.parse({})
    expect(parsed).toEqual({})
  })
})
