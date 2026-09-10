import { describe, expect, test } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import {
  eraseOverlayRect,
  eraseTerminal,
  fitOverlayCells,
  overlayFullyVisible,
  overlayRectsEqual,
  paintOverlay,
  registerNativeOverlay,
} from "@tui/util/native-overlay"

function fakeRenderer(width = 80, height = 24) {
  const writes: string[] = []
  let gridPaints = 0
  const host = {
    terminalWidth: width,
    terminalHeight: height,
    renderOffset: 0,
    forceFullRepaintRequested: undefined as boolean | undefined,
    requestRender() {
      host.renderNative()
    },
    renderNative() {
      gridPaints++
    },
    writeOut(chunk: string) {
      writes.push(chunk)
    },
  }
  return { renderer: host as unknown as CliRenderer, host, writes, grid: () => gridPaints }
}

describe("fitOverlayCells", () => {
  test("fills the cell box exactly so xterm.js has no checkerboard slack", () => {
    const fitted = fitOverlayCells(1920, 1080, { columns: 80, rows: 40 }, { width: 10, height: 20 })
    expect(fitted.columns).toBe(80)
    expect(fitted.rows).toBe(23)
    expect(fitted.pixelWidth).toBe(800)
    expect(fitted.pixelHeight % 6).toBe(0)
    expect(fitted.pixelHeight).toBeLessThanOrEqual(23 * 20)
    expect(fitted.pixelWidth / fitted.pixelHeight).toBeCloseTo(1920 / 1080, 1)
  })

  test("does not upscale a small image's cell box", () => {
    const fitted = fitOverlayCells(20, 10, { columns: 80, rows: 40 }, { width: 10, height: 20 })
    expect(fitted.columns).toBe(2)
    expect(fitted.rows).toBe(1)
    expect(fitted.pixelWidth).toBe(20)
  })
})

describe("overlayFullyVisible", () => {
  test("rejects rectangles whose origin is off the terminal", () => {
    expect(overlayFullyVisible({ x: 0, y: 0, columns: 10, rows: 5 }, 80, 24)).toBe(true)
    expect(overlayFullyVisible({ x: -1, y: 0, columns: 10, rows: 5 }, 80, 24)).toBe(false)
    expect(overlayFullyVisible({ x: 0, y: 24, columns: 10, rows: 5 }, 80, 24)).toBe(false)
    // A live WebView is often a couple of rows taller than the panel. That
    // overflow must still paint, or the page appears and then vanishes.
    expect(overlayFullyVisible({ x: 0, y: 20, columns: 10, rows: 5 }, 80, 24)).toBe(true)
  })

  test("keeps the prompt chrome clear", () => {
    expect(overlayFullyVisible({ x: 0, y: 18, columns: 10, rows: 5 }, 80, 24, 3)).toBe(false)
    expect(overlayFullyVisible({ x: 0, y: 16, columns: 10, rows: 5 }, 80, 24, 3)).toBe(true)
  })
})

describe("eraseOverlayRect", () => {
  test("emits ECH then spaces so the image addon cannot leave a checkerboard", () => {
    const sequence = eraseOverlayRect({ x: 2, y: 3, columns: 10, rows: 2 }, 80, 24)
    expect(sequence).toContain("\x1b[4;3H\x1b[10X" + " ".repeat(10))
    expect(sequence).toContain("\x1b[5;3H\x1b[10X" + " ".repeat(10))
    expect(sequence.startsWith("\x1b7")).toBe(true)
    expect(sequence.endsWith("\x1b8")).toBe(true)
  })

  test("clips erase to the terminal instead of writing off-screen CUP", () => {
    const sequence = eraseOverlayRect({ x: 78, y: -1, columns: 10, rows: 4 }, 80, 24)
    expect(sequence).toContain("\x1b[1;79H\x1b[2X  ")
    expect(sequence).not.toContain("\x1b[0;")
  })

  test("wipes every row so a Sixel that overflowed its box cannot survive Esc", () => {
    const sequence = eraseTerminal(80, 24)
    expect(sequence).toContain("\x1b[1;1H\x1b[80X")
    expect(sequence).toContain("\x1b[24;1H\x1b[80X")
    expect(sequence).toContain(" ".repeat(80))
  })

  test("does not CSI-erase the prompt chrome", () => {
    const sequence = eraseOverlayRect({ x: 0, y: 20, columns: 10, rows: 5 }, 80, 24, 3)
    expect(sequence).toContain("\x1b[21;1H")
    expect(sequence).not.toContain("\x1b[23;1H")
    expect(sequence).not.toContain("\x1b[24;1H")
    expect(sequence).not.toContain("\x1b[25;1H")
  })
})

describe("overlayRectsEqual", () => {
  test("compares origin and size", () => {
    const rect = { x: 1, y: 2, columns: 3, rows: 4 }
    expect(overlayRectsEqual(rect, { ...rect })).toBe(true)
    expect(overlayRectsEqual(rect, { ...rect, y: 3 })).toBe(false)
  })
})

describe("registerNativeOverlay", () => {
  test("paints after the grid and erases on unregister", () => {
    const { renderer, host, writes, grid } = fakeRenderer()
    const overlay = { box: { x: 2, y: 3 }, bytes: "SIXEL", columns: 10, rows: 5 }
    const unregister = registerNativeOverlay(renderer, overlay)

    expect(grid()).toBe(1)
    expect(writes.at(-1)).toBe(paintOverlay({ x: 2, y: 3, columns: 10, rows: 5 }, "SIXEL"))

    writes.length = 0
    unregister()
    expect(writes[0]).toBe(eraseTerminal(80, 24))
    expect(writes[0]).toContain(" ".repeat(80))
    expect(host.forceFullRepaintRequested).toBe(true)
  })

  test("does not erase on a same-place redraw", () => {
    const { renderer, writes } = fakeRenderer()
    const overlay = { box: { x: 2, y: 3 }, bytes: "SIXEL", columns: 10, rows: 5 }
    registerNativeOverlay(renderer, overlay)

    writes.length = 0
    overlay.bytes = "SIXEL2"
    renderer.requestRender()

    expect(writes.some((chunk) => chunk.includes("\x1b[10X"))).toBe(false)
    expect(writes.at(-1)).toBe(paintOverlay({ x: 2, y: 3, columns: 10, rows: 5 }, "SIXEL2"))
  })

  test("erases the last rectangle instead of painting when the box leaves the screen", () => {
    const { renderer, writes } = fakeRenderer()
    const overlay = { box: { x: 2, y: 3 }, bytes: "SIXEL", columns: 10, rows: 5 }
    registerNativeOverlay(renderer, overlay)

    overlay.box.y = 24
    writes.length = 0
    renderer.requestRender()

    expect(writes[0]).toBe(eraseOverlayRect({ x: 2, y: 3, columns: 10, rows: 5 }, 80, 24))
    expect(writes.some((chunk) => chunk.includes("SIXEL"))).toBe(false)
  })

  test("still paints a live view that overflows the terminal by a couple of rows", () => {
    const { renderer, writes } = fakeRenderer(80, 24)
    const overlay = { box: { x: 2, y: 20 }, bytes: "SIXEL", columns: 10, rows: 5 }
    registerNativeOverlay(renderer, overlay)
    expect(writes.at(-1)).toBe(paintOverlay({ x: 2, y: 20, columns: 10, rows: 5 }, "SIXEL"))
  })

  test("does not paint over the prompt chrome", () => {
    const { renderer, writes } = fakeRenderer(80, 24)
    const overlay = { box: { x: 2, y: 18 }, bytes: "SIXEL", columns: 10, rows: 5, chromeBottom: 3 }
    registerNativeOverlay(renderer, overlay)
    expect(writes.some((chunk) => chunk.includes("SIXEL"))).toBe(false)
  })

  test("erases the box on unregister even if it never painted", () => {
    const { renderer, host, writes } = fakeRenderer(80, 24)
    const overlay = { box: { x: 2, y: 24 }, bytes: "SIXEL", columns: 10, rows: 5 }
    const unregister = registerNativeOverlay(renderer, overlay)
    expect(writes.some((chunk) => chunk.includes("SIXEL"))).toBe(false)

    writes.length = 0
    unregister()
    expect(writes[0]).toBe(eraseTerminal(80, 24))
    expect(host.forceFullRepaintRequested).toBe(true)
  })
})
