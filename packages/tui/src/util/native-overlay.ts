/**
 * Cursor-addressed graphics (Sixel / iTerm2) inside an OpenTUI frame.
 *
 * Kitty Unicode placeholders are grid-native. Sixel and iTerm2 are not: they
 * are written after OpenTUI flushes, and xterm.js (VS Code / Cursor
 * `enableImages`) keeps a texture until those cells are overwritten with real
 * characters. CSI ECH alone turns the slot into the grey checkerboard — it
 * does not restore the TUI, and OpenTUI's diff will not rewrite cells it
 * thinks are unchanged.
 *
 * Rules:
 *   - erase only when the rectangle *moves* or the owner unmounts, never on
 *     a same-place redraw (that is what painted the checkerboard around the
 *     bitmap and over the prompt),
 *   - erase with ECH *and* spaces so the image addon drops the texture and
 *     the cells become character cells OpenTUI will overwrite,
 *   - never paint into the footer chrome.
 */
import type { CliRenderer } from "@opentui/core"

export type OverlayRect = {
  x: number
  y: number
  columns: number
  rows: number
}

export type NativeOverlay = {
  box: { x: number; y: number }
  bytes: Uint8Array | string
  columns: number
  rows: number
  /** Rows at the bottom of the terminal the overlay must not cover (prompt + hints). */
  chromeBottom?: number
}

export type CellMetrics = {
  width: number
  height: number
}

type OverlayHost = {
  requestRender: () => void
  terminalWidth: number
  terminalHeight: number
  renderNative: () => void
  writeOut: (chunk: string) => void
  renderOffset: number
  /**
   * OpenTUI private: skip the cell-diff and rewrite every cell. xterm.js
   * keeps a Sixel texture until those cells are overwritten; a normal frame
   * will not, because the empty overlay box looks unchanged.
   */
  forceFullRepaintRequested?: boolean
}

type OverlayManager = {
  overlays: Set<NativeOverlay>
  lastRect: WeakMap<NativeOverlay, OverlayRect>
  originalRenderNative: () => void
}

const managers = new WeakMap<CliRenderer, OverlayManager>()

export function nativePayload(bytes: Uint8Array | string) {
  return typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("ascii")
}

export function overlayRectsEqual(a: OverlayRect, b: OverlayRect) {
  return a.x === b.x && a.y === b.y && a.columns === b.columns && a.rows === b.rows
}

export function overlayFullyVisible(
  rect: OverlayRect,
  terminalWidth: number,
  terminalHeight: number,
  chromeBottom = 0,
) {
  const bottomLimit = Math.max(0, terminalHeight - chromeBottom)
  if (rect.columns <= 0 || rect.rows <= 0) return false
  if (rect.x < 0 || rect.y < 0) return false
  if (rect.x >= terminalWidth || rect.y >= bottomLimit) return false
  // A live WebView is often one or two rows taller than the panel. Skipping
  // the whole paint made the page appear and then vanish. Overflow past the
  // terminal edge is clipped by the emulator; overflow into the prompt is not.
  if (chromeBottom > 0 && (rect.y + rect.rows > bottomLimit || rect.x + rect.columns > terminalWidth)) {
    return false
  }
  return true
}

/**
 * Drop the image texture and turn the cells back into characters.
 * ECH without spaces is what leaves xterm.js's checkerboard behind.
 */
export function eraseOverlayRect(rect: OverlayRect, terminalWidth: number, terminalHeight: number, chromeBottom = 0) {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const right = Math.min(terminalWidth, Math.ceil(rect.x + rect.columns))
  const bottom = Math.min(terminalHeight - chromeBottom, Math.ceil(rect.y + rect.rows))
  const width = right - x
  const height = bottom - y
  if (width <= 0 || height <= 0) return ""
  const spaces = " ".repeat(width)
  let out = "\x1b7"
  for (let row = 0; row < height; row++) {
    out += `\x1b[${y + 1 + row};${x + 1}H\x1b[${width}X${spaces}`
  }
  out += "\x1b8"
  return out
}

/** Wipe every cell. A Sixel often overflows its box; Esc must clear that too. */
export function eraseTerminal(terminalWidth: number, terminalHeight: number) {
  return eraseOverlayRect(
    { x: 0, y: 0, columns: terminalWidth, rows: terminalHeight },
    terminalWidth,
    terminalHeight,
    0,
  )
}

export function paintOverlay(rect: OverlayRect, bytes: Uint8Array | string) {
  return `\x1b7\x1b[${rect.y + 1};${rect.x + 1}H${nativePayload(bytes)}\x1b8`
}

/**
 * Cell rectangle that holds `image` inside `bounds`.
 *
 * Pixel size is *exactly* `columns × cell.width` by `rows × cell.height`
 * (sixel height snapped to a 6-pixel band). Slack cells become xterm.js
 * checkerboard, so the bitmap has to fill the box.
 */
export function fitOverlayCells(
  imageWidth: number,
  imageHeight: number,
  bounds: { columns: number; rows: number },
  cell: CellMetrics,
) {
  const maxPxW = Math.max(1, bounds.columns * cell.width)
  const maxPxH = Math.max(1, bounds.rows * cell.height)
  const scale = Math.min(maxPxW / Math.max(1, imageWidth), maxPxH / Math.max(1, imageHeight), 1)
  const fittedWidth = Math.max(1, Math.round(imageWidth * scale))
  const fittedHeight = Math.max(1, Math.round(imageHeight * scale))
  const columns = Math.max(1, Math.min(bounds.columns, Math.max(1, Math.round(fittedWidth / cell.width))))
  const rows = Math.max(1, Math.min(bounds.rows, Math.max(1, Math.round(fittedHeight / cell.height))))
  const pixelWidth = Math.max(1, Math.round(columns * cell.width))
  const banded = Math.max(6, Math.ceil((rows * cell.height) / 6) * 6)
  const pixelHeight =
    Math.ceil(banded / cell.height) > rows ? Math.max(6, Math.floor((rows * cell.height) / 6) * 6) : banded
  return { columns, rows, pixelWidth, pixelHeight }
}

function currentRect(overlay: NativeOverlay, offset: number): OverlayRect {
  return {
    x: overlay.box.x,
    y: overlay.box.y + offset,
    columns: overlay.columns,
    rows: overlay.rows,
  }
}

/**
 * Draw a cursor-positioned native image after OpenTUI flushes.
 * Mutate `overlay.bytes` and `requestRender()` to replace the picture in place.
 */
export function registerNativeOverlay(renderer: CliRenderer, overlay: NativeOverlay) {
  const host = renderer as unknown as OverlayHost
  let manager = managers.get(renderer)
  if (!manager) {
    const originalRenderNative = host.renderNative.bind(renderer)
    manager = { overlays: new Set(), lastRect: new WeakMap(), originalRenderNative }
    managers.set(renderer, manager)
    host.renderNative = () => {
      const termW = renderer.terminalWidth
      const termH = renderer.terminalHeight
      const offset = host.renderOffset ?? 0
      for (const item of manager!.overlays) {
        const last = manager!.lastRect.get(item)
        const next = currentRect(item, offset)
        const chrome = item.chromeBottom ?? 0
        const visible = Boolean(item.bytes) && overlayFullyVisible(next, termW, termH, chrome)
        if (last && (!visible || !overlayRectsEqual(last, next))) {
          host.writeOut(eraseOverlayRect(last, termW, termH, chrome))
          if (!visible) manager!.lastRect.delete(item)
        }
      }
      originalRenderNative()
      for (const item of manager!.overlays) {
        const rect = currentRect(item, offset)
        const chrome = item.chromeBottom ?? 0
        if (!item.bytes || !overlayFullyVisible(rect, termW, termH, chrome)) continue
        host.writeOut(paintOverlay(rect, item.bytes))
        manager!.lastRect.set(item, rect)
      }
    }
  }
  manager.overlays.add(overlay)
  renderer.requestRender()
  let released = false
  const forceRepaint = () => {
    host.forceFullRepaintRequested = true
    renderer.requestRender()
  }
  return () => {
    if (released) return
    released = true
    const current = managers.get(renderer)
    if (!current) return
    const last = current.lastRect.get(overlay) ?? currentRect(overlay, host.renderOffset ?? 0)
    current.lastRect.delete(overlay)
    current.overlays.delete(overlay)
    const termW = renderer.terminalWidth
    const termH = renderer.terminalHeight
    const lastOne = current.overlays.size === 0
    // A live WebView Sixel is routinely larger than its cell box (retina
    // metrics, sixel bands). Esc closed the dialog and erased the box —
    // Google stayed on screen around it. The last overlay wipes the terminal.
    const wipe = lastOne
      ? eraseTerminal(termW, termH)
      : last
        ? eraseOverlayRect(last, termW, termH, overlay.chromeBottom ?? 0)
        : ""
    if (wipe) host.writeOut(wipe)
    if (lastOne) {
      host.renderNative = current.originalRenderNative
      managers.delete(renderer)
    }
    forceRepaint()
    queueMicrotask(forceRepaint)
  }
}
