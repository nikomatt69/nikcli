import { describe, expect, it } from "bun:test"
import { INPUT_LAYERS, ownerOf, owns, superseded } from "@tui/util/input-precedence"

/**
 * The input precedence EOT-07 requirement 2 names, pinned as an order.
 *
 * The rule this enforces is requirement 3's: an input event cannot both close a
 * dialog and cancel a session. That happens when two layers each believe they
 * are entitled to the same event, which is exactly what an implicit precedence
 * expressed as scattered conditions produces.
 */
describe("input precedence", () => {
  it("orders modal over editable over route over application", () => {
    expect([...INPUT_LAYERS]).toEqual(["modal", "editable", "route", "application"])
  })

  it("gives an open modal the event even while a prompt has focus", () => {
    // The case behind requirement 3: Escape while typing in a dialog closes the
    // dialog. It must not also reach the prompt underneath.
    expect(ownerOf({ modal: true, editable: true, application: true })).toBe("modal")
    expect(owns("editable", { modal: true, editable: true })).toBe(false)
  })

  it("gives a focused editable surface the event over a route handler", () => {
    expect(ownerOf({ editable: true, route: true, application: true })).toBe("editable")
  })

  it("falls through to the application when nothing else is active", () => {
    expect(ownerOf({ application: true })).toBe("application")
  })

  it("drops the event when even the fallback is withheld", () => {
    // A caller may deliberately withhold the fallback — during startup, say —
    // and that is the one case where dropping an event is correct.
    expect(ownerOf({})).toBeUndefined()
    expect(superseded({})).toEqual([])
  })

  it("names the layers that lost, for when two handlers both fire", () => {
    expect(superseded({ modal: true, editable: true, application: true })).toEqual(["editable", "application"])
  })
})
