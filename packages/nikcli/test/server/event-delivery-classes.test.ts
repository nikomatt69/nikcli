import { describe, expect, it } from "bun:test"
import { BusEvent } from "@/bus/bus-event"

/**
 * The event-class registry EOT-04 requires **before** admission caps.
 *
 * A cap that does not know which events may be coalesced and which may not is
 * a cap that drops a permission prompt to save a progress bar. So the
 * classification lands first, and the caps are written against it.
 *
 * The class lives on the declaration, next to `visibility`, for the reason
 * `bus-event.ts` already gives about that bit: a list kept away from the thing
 * it describes is the shape that drifts, and nothing would force the two to
 * agree.
 */

// Importing the domains registers their events; the registry is module-level.
await import("@/permission/next")
await import("@/question")
await import("@/lsp")

describe("event delivery classes", () => {
  it("defaults to the conservative class", () => {
    // An unclassified event is one nobody has thought about, and the cost of
    // being wrong is asymmetric: treating a delta as replaceable loses
    // user-visible content, while treating a snapshot as ordered costs
    // bandwidth.
    expect(BusEvent.deliveryOf("some.event.nobody.declared")).toBe("ordered")
    expect(BusEvent.deliveryOf(undefined)).toBe("ordered")
  })

  it("classifies prompts as decisions", () => {
    // Never coalesced with a different request and never silently dropped: the
    // alternative is an operation waiting forever on an answer nobody was
    // asked for.
    expect(BusEvent.deliveryOf("permission.asked")).toBe("decision")
    expect(BusEvent.deliveryOf("question.asked")).toBe("decision")
  })

  it("classifies a payloadless change ping as a snapshot", () => {
    // The newest `lsp.updated` says everything the older ones did.
    expect(BusEvent.deliveryOf("lsp.updated")).toBe("snapshot")
  })

  it("lists every public event with a class", () => {
    const classes = BusEvent.deliveryClasses()
    expect(classes.length).toBeGreaterThan(3)

    const valid = new Set(["ordered", "decision", "terminal", "snapshot"])
    for (const entry of classes) {
      expect(valid.has(entry.delivery)).toBe(true)
    }
  })

  it("excludes internal events from the class inventory", () => {
    // Internal events never reach a subscriber, so they have no delivery
    // policy to enforce and no business in the inventory that drives caps.
    const listed = new Set(BusEvent.deliveryClasses().map((entry) => entry.type))
    for (const type of BusEvent.internalTypes()) {
      expect(listed.has(type)).toBe(false)
    }
  })
})
