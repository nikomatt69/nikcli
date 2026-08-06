import { describe, expect, it } from "bun:test"
import { moveSelection, reconcileSelection } from "@tui/ui/select-controller"

/**
 * The cursor arithmetic behind every list dialog.
 *
 * `DialogSelect` backs the command palette, the model picker, the session and
 * theme lists — around forty dialogs — and until this was pulled out of the
 * component, none of it was reachable from a test: you needed a mounted dialog,
 * a laid-out scrollbox and a key event to observe an off-by-one.
 *
 * The cases below are the ones that actually bite: a filter that shrinks the
 * list under the cursor, and page-up on the first row.
 */

describe("reconcileSelection", () => {
  it("keeps a valid index where it is", () => {
    expect(reconcileSelection(3, 10)).toBe(3)
    expect(reconcileSelection(0, 10)).toBe(0)
    expect(reconcileSelection(9, 10)).toBe(9)
  })

  /** Typing in the filter box shrinks the list while the cursor sits below it. */
  it("pulls a cursor left behind by a shrinking list back onto the last option", () => {
    expect(reconcileSelection(9, 3)).toBe(2)
    expect(reconcileSelection(1, 1)).toBe(0)
  })

  it("an empty list selects 0, because there is nothing to point at", () => {
    expect(reconcileSelection(5, 0)).toBe(0)
    expect(reconcileSelection(0, 0)).toBe(0)
    expect(reconcileSelection(-3, 0)).toBe(0)
  })

  it("never returns a negative index", () => {
    expect(reconcileSelection(-1, 10)).toBe(0)
    expect(reconcileSelection(-100, 10)).toBe(0)
  })
})

describe("moveSelection", () => {
  const wrap = (selected: number, delta: number, count = 5) => moveSelection(selected, { count, delta, policy: "wrap" })
  const clamp = (selected: number, delta: number, count = 5) =>
    moveSelection(selected, { count, delta, policy: "clamp" })

  it("steps by delta in the middle of the list", () => {
    expect(wrap(2, 1)).toBe(3)
    expect(wrap(2, -1)).toBe(1)
  })

  /** Arrow keys: running off one end returns at the other. */
  it("wrap carries the cursor around both ends", () => {
    expect(wrap(4, 1)).toBe(0)
    expect(wrap(0, -1)).toBe(4)
  })

  /**
   * Page-up on the first row. `wrap` would send the cursor to the bottom of the
   * list, which is why paging asks for `clamp` instead.
   */
  it("clamp stops at the ends instead of jumping across", () => {
    expect(clamp(0, -10)).toBe(0)
    expect(clamp(4, 10)).toBe(4)
    expect(clamp(2, 10)).toBe(4)
  })

  /** A jump larger than the list lands on the far end, not part-way back. */
  it("wrap treats an overshoot as reaching the end, not as modulo", () => {
    expect(wrap(0, -10)).toBe(4)
    expect(wrap(4, 10)).toBe(0)
  })

  it("an empty list stays at 0 whatever it is asked to do", () => {
    expect(wrap(0, 1, 0)).toBe(0)
    expect(clamp(3, -1, 0)).toBe(0)
  })

  it("a single option cannot move", () => {
    expect(wrap(0, 1, 1)).toBe(0)
    expect(wrap(0, -1, 1)).toBe(0)
    expect(clamp(0, 5, 1)).toBe(0)
  })
})
