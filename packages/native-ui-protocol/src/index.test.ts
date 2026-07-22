import { describe, expect, test } from "bun:test"
import {
  ActionSchema,
  CapabilitiesSchema,
  NotificationSurfaceSchema,
  SurfaceSchema,
  TransportEnvelopeSchema,
} from "./index"

describe("native UI protocol", () => {
  test("parses every versioned surface kind", () => {
    const base = { id: "surface-1", title: "Example", controls: [] }
    expect(SurfaceSchema.parse({ ...base, kind: "dialog" }).kind).toBe("dialog")
    expect(
      SurfaceSchema.parse({
        ...base,
        kind: "popover",
        anchor: { x: 0, y: 0, width: 10, height: 10 },
      }).kind,
    ).toBe("popover")
    expect(NotificationSurfaceSchema.parse({ ...base, kind: "notification" }).severity).toBe("info")
    expect(
      SurfaceSchema.parse({
        ...base,
        kind: "menu",
        items: [{ id: "item-1", label: "Open" }],
      }).kind,
    ).toBe("menu")
  })

  test("rejects malformed discriminated values", () => {
    expect(() => ActionSchema.parse({ type: "invoke", action: "" })).toThrow()
    expect(() =>
      SurfaceSchema.parse({
        kind: "dialog",
        id: "x",
        title: "x",
        controls: [{ type: "unknown" }],
      }),
    ).toThrow()
  })

  test("validates capabilities and transport envelopes", () => {
    expect(
      CapabilitiesSchema.parse({
        version: 1,
        surfaces: ["dialog"],
        controls: ["button"],
        actions: ["invoke"],
      }).maxSurfaces,
    ).toBe(100)
    expect(
      TransportEnvelopeSchema.parse({
        version: 1,
        id: "message-1",
        kind: "event",
        payload: { ok: true },
      }).version,
    ).toBe(1)
  })
})
