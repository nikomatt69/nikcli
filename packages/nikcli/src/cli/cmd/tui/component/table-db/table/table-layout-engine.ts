import type { TableColumn } from "./types"

export interface ColumnLayout {
  index: number
  id: string
  x: number
  width: number
  visibleWidth: number
}

export interface RowLayout {
  index: number
  y: number
  height: number
}

export class TableLayoutEngine {
  private _columns: TableColumn[]
  private _columnLayouts: ColumnLayout[] = []
  private _totalWidth: number = 0
  private _contentWidth: number = 0
  private _rowHeight: number = 1
  private _headerHeight: number = 1

  constructor(columns: TableColumn[], rowHeight: number = 1, headerHeight: number = 1) {
    this._columns = columns
    this._rowHeight = rowHeight
    this._headerHeight = headerHeight
  }

  get columns(): TableColumn[] {
    return this._columns
  }

  get columnLayouts(): ColumnLayout[] {
    return this._columnLayouts
  }

  get totalWidth(): number {
    return this._totalWidth
  }

  get contentWidth(): number {
    return this._contentWidth
  }

  get rowHeight(): number {
    return this._rowHeight
  }

  get headerHeight(): number {
    return this._headerHeight
  }

  calculateColumnWidths(availableWidth: number): void {
    this._columnLayouts = []
    this._totalWidth = 0
    this._contentWidth = 0

    let fixedWidth = 0
    let percentColumns: { column: TableColumn; weight: number }[] = []

    for (const column of this._columns) {
      if (typeof column.width === "number") {
        const width = Math.max(column.minWidth || 3, column.width)
        fixedWidth += width
      } else if (typeof column.width === "string" && column.width.endsWith("%")) {
        const weight = parseFloat(column.width) / 100
        percentColumns.push({ column, weight })
      }
    }

    const remainingWidth = Math.max(0, availableWidth - fixedWidth)

    let usedPercent = 0
    for (const { column, weight } of percentColumns) {
      const maxWidth = column.maxWidth || Infinity
      const targetWidth = Math.floor(remainingWidth * weight)
      const actualWidth = Math.min(targetWidth, maxWidth)
      usedPercent += weight
    }

    if (percentColumns.length > 0 && remainingWidth > 0) {
      const availableForPercent = remainingWidth
      let currentX = 0

      for (let i = 0; i < this._columns.length; i++) {
        const column = this._columns[i]
        let width: number

        if (typeof column.width === "number") {
          width = Math.max(column.minWidth || 3, column.width)
        } else if (typeof column.width === "string" && column.width.endsWith("%")) {
          const weight = parseFloat(column.width) / 100
          width = Math.floor(availableForPercent * weight)
          width = Math.max(column.minWidth || 3, Math.min(width, column.maxWidth || Infinity))
        } else {
          width = 3
        }

        this._columnLayouts.push({
          index: i,
          id: column.id,
          x: currentX,
          width: width,
          visibleWidth: width,
        })

        currentX += width
        this._contentWidth += width
      }
    } else {
      let currentX = 0
      for (let i = 0; i < this._columns.length; i++) {
        const column = this._columns[i]
        const width = typeof column.width === "number" ? Math.max(column.minWidth || 3, column.width) : 10

        this._columnLayouts.push({
          index: i,
          id: column.id,
          x: currentX,
          width: width,
          visibleWidth: width,
        })

        currentX += width
        this._contentWidth += width
      }
    }

    this._totalWidth = this._contentWidth
  }

  getColumnPosition(columnIndex: number): ColumnLayout | null {
    if (columnIndex < 0 || columnIndex >= this._columnLayouts.length) return null
    return this._columnLayouts[columnIndex]
  }

  getColumnById(columnId: string): ColumnLayout | null {
    return this._columnLayouts.find((c) => c.id === columnId) || null
  }

  getCellPosition(
    rowIndex: number,
    columnIndex: number,
  ): { x: number; y: number; width: number; height: number } | null {
    const column = this.getColumnPosition(columnIndex)
    if (!column) return null

    return {
      x: column.x,
      y: this._headerHeight + rowIndex * this._rowHeight,
      width: column.width,
      height: this._rowHeight,
    }
  }

  getVisibleRowRange(viewportHeight: number, scrollY: number): [start: number, end: number] {
    const availableHeight = viewportHeight - this._headerHeight

    const startRow = Math.floor(scrollY / this._rowHeight)
    const visibleRows = Math.ceil(availableHeight / this._rowHeight) + 1
    const endRow = startRow + visibleRows

    return [startRow, endRow]
  }

  getVisibleColumnRange(viewportWidth: number, scrollX: number): [start: number, end: number] {
    let accumulatedWidth = 0
    let startCol = 0
    let endCol = this._columnLayouts.length

    for (let i = 0; i < this._columnLayouts.length; i++) {
      const col = this._columnLayouts[i]
      const colEnd = col.x + col.width

      if (colEnd <= scrollX) {
        startCol = i + 1
      }
      if (col.x < scrollX + viewportWidth) {
        endCol = i + 1
      }
    }

    return [startCol, endCol]
  }

  getRowY(rowIndex: number): number {
    return this._headerHeight + rowIndex * this._rowHeight
  }

  getTotalHeight(rowCount: number): number {
    return this._headerHeight + rowCount * this._rowHeight
  }

  calculateContentHeight(rowCount: number): number {
    return rowCount * this._rowHeight
  }

  getColumnCount(): number {
    return this._columns.length
  }
}
