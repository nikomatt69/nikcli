import { describe, expect, it } from "bun:test"
import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

/** Registered via Effect Schema, so `encode` has a codec to project through. */
const SchemaEvent = BusEvent.schema(
  "test.encode.schema",
  Schema.Struct({
    count: Schema.FiniteFromString,
    label: Schema.String,
  }),
)

describe("BusEvent.encode", () => {
  it("projects a payload onto its declared wire shape", () => {
    const result = BusEvent.encode({ type: SchemaEvent.type, properties: { count: 5, label: "hi" } })

    // The wire value is what the schema declares, not what the publisher held.
    expect(result.properties).toEqual({ count: "5", label: "hi" })
    expect(result.type).toBe("test.encode.schema")
  })

  it("drops keys the payload schema does not declare", () => {
    const result = BusEvent.encode({
      type: SchemaEvent.type,
      properties: { count: 1, label: "hi", stowaway: "should not ship" },
    })
    // Otherwise the wire contract is whatever the publisher happened to attach.
    expect(result.properties).toEqual({ count: "1", label: "hi" })
  })

  it("returns the same encoded object for repeated calls on one event", () => {
    const event = { type: SchemaEvent.type, properties: { count: 0, label: "x" } }
    // One encode is shared across every SSE subscriber that sees this event.
    expect(BusEvent.encode(event)).toBe(BusEvent.encode(event))
  })

  // Legacy zod-only events take the same branch as an unregistered type
  // (`encoderFor` finds no codec), so an unregistered type covers it without a
  // fixture. A real `BusEvent.define` fixture is fine now too, as long as it is
  // marked `internal` — `schemas()` requires an Effect Schema only for public
  // events, which is what `test.bus.effect` in `effect-service.test.ts` relies
  // on. Left as-is because the branch under test does not need the registration.
  it("passes an event with no registered codec through untouched", () => {
    const event = { type: "test.encode.unknown", properties: { anything: true } }
    expect(BusEvent.encode(event)).toBe(event)
  })

  it("never drops an event whose payload its own schema rejects", () => {
    const event = { type: SchemaEvent.type, properties: { count: "not-a-number", label: 42 } }
    // Degrading to the raw payload beats the client never hearing about it.
    expect(BusEvent.encode(event)).toBe(event)
  })
})
