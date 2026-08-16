import { describe, expect, it } from "bun:test"
import { cumulativeOffsets, indexAtOffset, visibleRange, spacerHeights } from "@tui/routes/session/message-window"

describe("message-window", () => {
  it("cumulativeOffsets builds a running sum with a leading 0", () => {
    expect(cumulativeOffsets([10, 5, 20])).toEqual([0, 10, 15, 35])
    expect(cumulativeOffsets([])).toEqual([0])
  })

  it("indexAtOffset finds the message containing a y via binary search", () => {
    const offsets = cumulativeOffsets([10, 10, 10, 10]) // [0,10,20,30,40]
    expect(indexAtOffset(offsets, 0)).toBe(0)
    expect(indexAtOffset(offsets, 9)).toBe(0)
    expect(indexAtOffset(offsets, 10)).toBe(1)
    expect(indexAtOffset(offsets, 25)).toBe(2)
    expect(indexAtOffset(offsets, 999)).toBe(3) // clamped to last
  })

  it("visibleRange returns only the messages intersecting the viewport", () => {
    const heights = new Array(100).fill(10) // total 1000
    const range = visibleRange({ heights, scrollTop: 200, viewportHeight: 50 })
    // viewport covers y [200,250): messages 20..24
    expect(range.start).toBe(20)
    expect(range.end).toBe(25)
  })

  it("visibleRange applies overscan and clamps at the edges", () => {
    const heights = new Array(100).fill(10)
    const range = visibleRange({ heights, scrollTop: 0, viewportHeight: 50, overscan: 5 })
    expect(range.start).toBe(0) // clamped, not negative
    expect(range.end).toBe(10) // 5 visible + 5 overscan
  })

  it("visibleRange handles empty and single-window lists", () => {
    expect(visibleRange({ heights: [], scrollTop: 0, viewportHeight: 100 })).toEqual({ start: 0, end: 0 })
    const small = visibleRange({ heights: [10, 10], scrollTop: 0, viewportHeight: 100 })
    expect(small).toEqual({ start: 0, end: 2 })
  })

  it("spacerHeights reserves the off-window space above and below", () => {
    const heights = new Array(10).fill(10) // total 100
    const spacers = spacerHeights(heights, { start: 3, end: 7 })
    expect(spacers.top).toBe(30)
    expect(spacers.bottom).toBe(30)
  })
})
