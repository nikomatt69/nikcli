import { renderCells, resizeRgba } from "../../native-bridge"
import type {
  BrowserViewport,
  RgbaFrame,
  TerminalCapabilities,
  TerminalLine,
  TerminalRenderOutput,
  TerminalRendererBackend,
  TerminalSegment,
} from "../../types"

const CELL_BYTES = 12

function blankLine(columns: number, bg = "#000000"): TerminalLine {
  return { segments: [{ text: " ".repeat(columns), fg: bg, bg }] }
}

function rgbToHex(rgb: number) {
  return `#${rgb.toString(16).padStart(6, "0")}`
}

function diffRows(previous: TerminalLine[], next: TerminalLine[]) {
  const dirtyRows: number[] = []
  const max = Math.max(previous.length, next.length)
  for (let i = 0; i < max; i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(next[i])) dirtyRows.push(i)
  }
  return dirtyRows
}

export function linesFromNativeCellBuffer(cellData: Uint8Array, columns: number, rows: number): TerminalLine[] {
  const lines: TerminalLine[] = []

  for (let row = 0; row < rows; row++) {
    const segments: TerminalSegment[] = []
    let currentText = ""
    let currentFg = "#ffffff"
    let currentBg = "#000000"

    for (let column = 0; column < columns; column++) {
      const index = (row * columns + column) * CELL_BYTES
      const view = new DataView(cellData.buffer, cellData.byteOffset + index, CELL_BYTES)
      const codePoint = view.getUint32(0, true)
      const fg = rgbToHex(view.getUint32(4, true))
      const bg = rgbToHex(view.getUint32(8, true))
      const char = codePoint === 0 ? " " : String.fromCodePoint(codePoint)

      if (!currentText) {
        currentText = char
        currentFg = fg
        currentBg = bg
        continue
      }

      if (fg === currentFg && bg === currentBg) {
        currentText += char
        continue
      }

      segments.push({ text: currentText, fg: currentFg, bg: currentBg })
      currentText = char
      currentFg = fg
      currentBg = bg
    }

    if (currentText) {
      segments.push({ text: currentText, fg: currentFg, bg: currentBg })
    } else {
      segments.push({ text: " ".repeat(columns), fg: "#ffffff", bg: "#000000" })
    }

    lines.push({ segments })
  }

  return lines
}

function nativeColorMode(capabilities: TerminalCapabilities): 0 | 1 | 2 {
  switch (capabilities.colorMode) {
    case "truecolor":
      return 0
    case "ansi256":
      return 1
    case "mono":
      return 2
  }
}

export class AnsiTerminalRendererBackend implements TerminalRendererBackend {
  private capabilities!: TerminalCapabilities
  private viewport!: BrowserViewport
  private previousLines: TerminalLine[] = []

  init(capabilities: TerminalCapabilities, viewport: BrowserViewport) {
    this.capabilities = capabilities
    this.viewport = viewport
    this.previousLines = Array.from({ length: viewport.rows }, () => blankLine(viewport.columns))
  }

  resize(viewport: BrowserViewport) {
    this.viewport = viewport
    this.previousLines = Array.from({ length: viewport.rows }, () => blankLine(viewport.columns))
  }

  renderFrame(frame: RgbaFrame): TerminalRenderOutput {
    const targetPixelWidth = Math.max(2, this.viewport.columns * 2)
    const targetPixelHeight = Math.max(2, this.viewport.rows * 2)

    const resized = resizeRgba(frame.data, frame.width, frame.height, targetPixelWidth, targetPixelHeight)
    const cells = renderCells(
      resized.data as unknown as Uint8ClampedArray,
      resized.width,
      resized.height,
      nativeColorMode(this.capabilities),
    )

    const nextLines = linesFromNativeCellBuffer(cells.data, cells.width, cells.height)
    const dirtyRows = diffRows(this.previousLines, nextLines)
    this.previousLines = nextLines

    return { lines: nextLines, dirtyRows }
  }

  dispose() {
    this.previousLines = []
  }
}
