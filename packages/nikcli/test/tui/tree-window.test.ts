import { describe, expect, it } from "bun:test"
import { clampSelectionToWindow, scrollWindowStart, windowStartFor } from "@tui/routes/tree/tree-window"

describe("windowStartFor", () => {
  it("keeps the window when the selection is already inside it", () => {
    expect(windowStartFor({ previous: 10, selected: 15, count: 900, height: 20 })).toBe(10)
  })

  it("follows the selection past either edge by the minimum amount", () => {
    expect(windowStartFor({ previous: 10, selected: 4, count: 900, height: 20 })).toBe(4)
    expect(windowStartFor({ previous: 10, selected: 30, count: 900, height: 20 })).toBe(11)
  })

  it("never leaves a gap at the end when rows disappear", () => {
    // 900 rows collapsed down to 25 while the window sat deep in the list.
    expect(windowStartFor({ previous: 400, selected: 0, count: 25, height: 20 })).toBe(0)
    expect(windowStartFor({ previous: 400, selected: 24, count: 25, height: 20 })).toBe(5)
  })

  it("pins to zero when everything fits", () => {
    expect(windowStartFor({ previous: 3, selected: 2, count: 8, height: 20 })).toBe(0)
    expect(windowStartFor({ previous: 0, selected: 0, count: 0, height: 20 })).toBe(0)
  })

  it("survives a viewport that has not been measured yet", () => {
    expect(windowStartFor({ previous: 0, selected: 5, count: 900, height: 0 })).toBe(5)
  })
})

describe("scrollWindowStart", () => {
  it("scrolls within bounds and stops at both ends", () => {
    expect(scrollWindowStart({ start: 10, delta: 3, count: 900, height: 20 })).toBe(13)
    expect(scrollWindowStart({ start: 2, delta: -10, count: 900, height: 20 })).toBe(0)
    expect(scrollWindowStart({ start: 875, delta: 50, count: 900, height: 20 })).toBe(880)
  })
})

describe("clampSelectionToWindow", () => {
  it("drags the selection onto the mounted slice", () => {
    expect(clampSelectionToWindow({ selected: 4, start: 10, height: 20 })).toBe(10)
    expect(clampSelectionToWindow({ selected: 40, start: 10, height: 20 })).toBe(29)
    expect(clampSelectionToWindow({ selected: 15, start: 10, height: 20 })).toBe(15)
  })
})
