import { describe, expect, it } from "bun:test"
import { errors } from "../../src/server/error"
import { Event } from "../../src/server/event"

describe("server/error", () => {
  it("errors() maps known codes to response descriptors", () => {
    const out = errors(400, 404)
    expect(Object.keys(out).sort().join(",")).toBe("400,404")
    expect(out[400]?.description).toBe("Bad request")
    expect(out[404]?.description).toBe("Not found")
  })

  it("errors() with no codes returns an empty object", () => {
    expect(Object.keys(errors())).toEqual([])
  })
})

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
