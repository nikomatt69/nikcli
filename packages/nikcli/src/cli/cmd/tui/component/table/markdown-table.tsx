import { extend } from "@opentui/solid"
import { BoxRenderable, type BoxOptions, type RenderContext, OptimizedBuffer, RGBA } from "@opentui/core"

export interface MarkdownTableOptions extends BoxOptions {
  content?: string[][]
  headers?: string[]
  columnWidthMode?: "content" | "full"
  columnFitter?: "proportional" | "balanced"
  wrapMode?: "none" | "char" | "word"
  showBorders?: boolean
  selectable?: boolean
}

export class MarkdownTableRenderable extends BoxRenderable {
  private _content: string[][]
  private _headers: string[]
  private _columnWidthMode: "content" | "full"
  private _columnFitter: "proportional" | "balanced"
  private _wrapMode: "none" | "char" | "word"
  private _showBorders: boolean

  private _columnWidths: number[] = []
  private _rowHeights: number[] = []

  constructor(ctx: RenderContext, options: MarkdownTableOptions = {}) {
    super(ctx, {
      border: options.showBorders ?? true,
      overflow: "hidden",
      flexShrink: 0,
      ...options,
    })

    this._content = Array.isArray(options.content) ? options.content : []
    this._headers = Array.isArray(options.headers) ? options.headers : []
    this._columnWidthMode = options.columnWidthMode ?? "content"
    this._columnFitter = options.columnFitter ?? "proportional"
    this._wrapMode = options.wrapMode ?? "word"
    this._showBorders = options.showBorders ?? true

    this.calculateLayout()
  }

  set content(value: string[][]) {
    this._content = Array.isArray(value) ? value : []
    this.calculateLayout()
    this.requestRender()
  }

  set headers(value: string[]) {
    this._headers = Array.isArray(value) ? value : []
    this.calculateLayout()
    this.requestRender()
  }

  private calculateLayout(): void {
    const content = Array.isArray(this._content) ? this._content : []
    const headers = Array.isArray(this._headers) ? this._headers : []
    const allRows = headers.length > 0 ? [headers, ...content] : content
    if (allRows.length === 0) {
      this._columnWidths = []
      this._rowHeights = []
      return
    }

    const colCount = Math.max(...allRows.map((row) => row.length))
    this._columnWidths = new Array(colCount).fill(1)
    this._rowHeights = new Array(allRows.length).fill(1)

    for (let colIdx = 0; colIdx < colCount; colIdx++) {
      for (const row of allRows) {
        const cellText = row[colIdx] ?? ""
        this._columnWidths[colIdx] = Math.max(this._columnWidths[colIdx], cellText.length + 2)
      }
    }

    if (this._columnWidthMode === "full" && this.width > 0) {
      const totalContentWidth = this._columnWidths.reduce((a, b) => a + b, 0)
      const borderCount = this._showBorders ? colCount + 1 : 0
      const availableWidth = this.width - borderCount

      if (totalContentWidth < availableWidth && this._columnFitter === "proportional") {
        const extra = availableWidth - totalContentWidth
        const perCol = Math.floor(extra / colCount)
        const remainder = extra % colCount
        this._columnWidths = this._columnWidths.map((w, i) => w + perCol + (i < remainder ? 1 : 0))
      }
    }

    for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
      let maxHeight = 1
      for (let colIdx = 0; colIdx < colCount; colIdx++) {
        const cellText = allRows[rowIdx][colIdx] ?? ""
        const colWidth = this._columnWidths[colIdx] ?? 1
        const wrappedLines = this._wrapMode === "none" ? 1 : Math.ceil(cellText.length / (colWidth - 2))
        maxHeight = Math.max(maxHeight, wrappedLines)
      }
      this._rowHeights[rowIdx] = maxHeight
    }
  }

  protected override onResize(width: number, height: number): void {
    this.calculateLayout()
    super.onResize(width, height)
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return

    const allRows = this._headers.length > 0 ? [this._headers, ...this._content] : this._content
    if (allRows.length === 0) return

    const colCount = this._columnWidths.length
    const hasHeaders = this._headers.length > 0

    let currentY = this.y

    for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
      const row = allRows[rowIdx]
      const isHeader = hasHeaders && rowIdx === 0

      if (this._showBorders) {
        let currentX = this.x
        for (let colIdx = 0; colIdx < colCount; colIdx++) {
          const colWidth = this._columnWidths[colIdx]

          buffer.drawText("│", currentX, currentY, isHeader ? RGBA.fromHex("#7aa2f7")! : RGBA.fromHex("#c0caf5")!)

          const cellText = row[colIdx] ?? ""
          const paddedText = this.padCellText(cellText, colWidth - 2)
          buffer.drawText(
            paddedText,
            currentX + 1,
            currentY,
            isHeader ? RGBA.fromHex("#7aa2f7")! : RGBA.fromHex("#c0caf5")!,
          )

          currentX += colWidth
        }
        buffer.drawText("│", currentX, currentY, isHeader ? RGBA.fromHex("#7aa2f7")! : RGBA.fromHex("#c0caf5")!)

        if (rowIdx === 0 && hasHeaders) {
          currentY++
          currentX = this.x
          for (let colIdx = 0; colIdx < colCount; colIdx++) {
            const colWidth = this._columnWidths[colIdx]
            buffer.drawText("├", currentX, currentY, RGBA.fromHex("#414868")!)
            buffer.drawText("─".repeat(colWidth), currentX + 1, currentY, RGBA.fromHex("#414868")!)
            currentX += colWidth
          }
          buffer.drawText("┤", currentX, currentY, RGBA.fromHex("#414868")!)
        }
      } else {
        let currentX = this.x
        for (let colIdx = 0; colIdx < colCount; colIdx++) {
          const colWidth = this._columnWidths[colIdx]
          const cellText = row[colIdx] ?? ""
          const paddedText = this.padCellText(cellText, colWidth)
          buffer.drawText(
            paddedText,
            currentX,
            currentY,
            isHeader ? RGBA.fromHex("#7aa2f7")! : RGBA.fromHex("#c0caf5")!,
          )
          currentX += colWidth
        }
      }

      currentY++
    }
  }

  private padCellText(text: string, width: number): string {
    if (text.length >= width) {
      return text.slice(0, width - 1) + "…"
    }
    return text + " ".repeat(width - text.length)
  }
}

export function createMarkdownTableParser() {
  function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
    const lines = text
      .trim()
      .split("\n")
      .filter((line) => line.trim())

    if (lines.length < 2) return null

    const tableLines = lines.filter((line) => line.trim().startsWith("|") && line.includes("|"))
    if (tableLines.length < 2) return null

    const dataLines = tableLines.filter((line) => !line.match(/^\|\s*[-:]+\s*\|/))
    if (dataLines.length < 1) return null

    const parseRow = (line: string): string[] => {
      return line
        .split("|")
        .map((cell) => cell.trim())
        .filter((_, i, arr) => i > 0 && i < arr.length - 1)
    }

    const headers = parseRow(dataLines[0])
    const rows = dataLines.slice(1).map(parseRow)

    return { headers, rows }
  }

  function isMarkdownTable(text: string): boolean {
    return parseMarkdownTable(text) !== null
  }

  function extractTableFromText(text: string): { table: string; before: string; after: string } | null {
    const lines = text.split("\n")
    let tableStart = -1
    let tableEnd = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim().startsWith("|") && line.includes("|")) {
        if (tableStart === -1) tableStart = i
        tableEnd = i
      } else if (tableStart !== -1 && tableEnd !== -1) {
        break
      }
    }

    if (tableStart === -1 || tableEnd === -1) return null

    const table = lines.slice(tableStart, tableEnd + 1).join("\n")
    const before = lines.slice(0, tableStart).join("\n")
    const after = lines.slice(tableEnd + 1).join("\n")

    return { table, before, after }
  }

  return {
    parseMarkdownTable,
    isMarkdownTable,
    extractTableFromText,
  }
}

export const MarkdownTable = (props: {
  content?: string[][]
  headers?: string[]
  options?: {
    columnWidthMode?: "content" | "full"
    columnFitter?: "proportional" | "balanced"
    wrapMode?: "none" | "char" | "word"
    showBorders?: boolean
  }
}) => {
  return (
    <markdowntable
      content={props.content ?? []}
      headers={props.headers ?? []}
      columnWidthMode={props.options?.columnWidthMode ?? "content"}
      columnFitter={props.options?.columnFitter ?? "proportional"}
      wrapMode={props.options?.wrapMode ?? "word"}
      showBorders={props.options?.showBorders ?? true}
    />
  )
}

extend({ markdowntable: MarkdownTableRenderable })

export { MarkdownTableRenderable as TextTable }
