import { BoxRenderable, type BoxOptions, type RenderContext, OptimizedBuffer, RGBA } from "@opentui/core"
import { TableEvents, type TableEventMap } from "./table-events"
import { TableSelectionManager } from "./table-selection-manager"
import { TableLayoutEngine } from "./table-layout-engine"
import { TableStateManager } from "./table-state"
import type { TableColumn, TableRow, TableStyle } from "./types"

export interface TableRenderableOptions extends BoxOptions {
  columns: TableColumn[]
  rows: TableRow[]
  selection?: "none" | "single" | "multiple"
  showHeader?: boolean
  showRowNumbers?: boolean
  striped?: boolean
  compact?: boolean
  style?: TableStyle
  onRowSelect?: (row: TableRow, index: number) => void
  onRowActivate?: (row: TableRow, index: number) => void
  onSort?: (column: TableColumn, direction: "asc" | "desc") => void
}

export class TableRenderable extends BoxRenderable {
  private _columns: TableColumn[]
  private _rows: TableRow[]
  private _selectionMode: "none" | "single" | "multiple"
  private _showHeader: boolean
  private _showRowNumbers: boolean
  private _striped: boolean
  private _compact: boolean
  private _style: TableStyle

  private _selectionManager: TableSelectionManager
  private _layoutEngine: TableLayoutEngine
  private _state: TableStateManager

  private _scrollY: number = 0
  private _scrollX: number = 0
  private _hasFocus: boolean = false

  private _onRowSelect?: (row: TableRow, index: number) => void
  private _onRowActivate?: (row: TableRow, index: number) => void
  private _onSort?: (column: TableColumn, direction: "asc" | "desc") => void

  private _tableEventListeners: Map<keyof TableEventMap, Set<(...args: any[]) => void>> = new Map()
  private _cachedThemeColors: ReturnType<TableRenderable["_getThemeColors"]> | null = null

  constructor(ctx: RenderContext, options: TableRenderableOptions) {
    super(ctx, {
      border: true,
      overflow: "hidden",
      ...options,
    })

    this._columns = options.columns
    this._rows = options.rows
    this._selectionMode = options.selection || "single"
    this._showHeader = options.showHeader !== false
    this._showRowNumbers = options.showRowNumbers || false
    this._striped = options.striped !== false
    this._compact = options.compact || false
    this._style = options.style || {}

    this._onRowSelect = options.onRowSelect
    this._onRowActivate = options.onRowActivate
    this._onSort = options.onSort

    const rowHeight = this._compact ? 1 : 1
    const headerHeight = this._showHeader ? 1 : 0

    this._selectionManager = new TableSelectionManager(this, this._selectionMode, (indices) => {
      if (indices.length === 1) {
        const row = this.getRowAt(indices[0])
        if (row) {
          this._onRowSelect?.(row, indices[0])
          this._emitTableEvent(TableEvents.ROW_SELECTED, { row, index: indices[0] })
        }
      }
    })

    this._layoutEngine = new TableLayoutEngine(this._columns, rowHeight, headerHeight)
    this._layoutEngine.calculateColumnWidths(this.width)

    this._state = new TableStateManager()
    this._state.setData(this._rows)
  }

  get columns(): TableColumn[] {
    return this._columns
  }

  get rows(): TableRow[] {
    return this._state.getVisibleRows()
  }

  get totalRows(): number {
    return this._rows.length
  }

  get totalColumns(): number {
    return this._columns.length
  }

  get selectedRow(): number | null {
    return this._selectionManager.selectedIndices[0] ?? null
  }

  get selectedRows(): TableRow[] {
    return this._selectionManager.getSelectedRows()
  }

  get sortColumn(): string | null {
    return this._state.sortColumn
  }

  get sortDirection(): "asc" | "desc" {
    return this._state.sortDirection
  }

  setData(columns: TableColumn[], rows: TableRow[]): void {
    this._columns = columns
    this._rows = rows
    this._layoutEngine = new TableLayoutEngine(this._columns, this._compact ? 1 : 1, this._showHeader ? 1 : 0)
    this._layoutEngine.calculateColumnWidths(this.width)
    this._state.setData(rows)
    this.requestRender()
  }

  setSelectedRow(index: number | null): void {
    this._selectionManager.setSelectedIndex(index)
    this.requestRender()
  }

  sortBy(columnId: string, direction?: "asc" | "desc"): void {
    this._state.setSort(columnId, direction)
    const column = this._columns.find((c) => c.id === columnId)
    if (column) {
      this._onSort?.(column, this._state.sortDirection)
      this._emitTableEvent(TableEvents.COLUMN_SORTED, { column, direction: this._state.sortDirection })
    }
    this.requestRender()
  }

  filter(query: string): void {
    this._state.setFilter(query)
    this._emitTableEvent(TableEvents.FILTER_CHANGED, {
      query,
      filteredCount: this._state.getFilteredRows(),
      totalCount: this._state.getTotalRows(),
    })
    this.requestRender()
  }

  setPage(page: number): void {
    this._state.setPage(page)
    this._emitTableEvent(TableEvents.PAGINATION_CHANGED, this._state.getPaginationState())
    this.requestRender()
  }

  nextPage(): boolean {
    const result = this._state.nextPage()
    if (result) {
      this._emitTableEvent(TableEvents.PAGINATION_CHANGED, this._state.getPaginationState())
      this.requestRender()
    }
    return result
  }

  prevPage(): boolean {
    const result = this._state.prevPage()
    if (result) {
      this._emitTableEvent(TableEvents.PAGINATION_CHANGED, this._state.getPaginationState())
      this.requestRender()
    }
    return result
  }

  scrollToRow(rowIndex: number): void {
    const targetY = this._layoutEngine.getRowY(rowIndex)
    const viewportHeight = this.height - this._layoutEngine.headerHeight

    if (targetY < this._scrollY) {
      this._scrollY = targetY
    } else if (targetY + this._layoutEngine.rowHeight > this._scrollY + viewportHeight) {
      this._scrollY = targetY - viewportHeight + this._layoutEngine.rowHeight
    }

    this.requestRender()
  }

  scrollToColumn(columnIndex: number): void {
    const column = this._layoutEngine.getColumnPosition(columnIndex)
    if (!column) return

    const viewportWidth = this.width

    if (column.x < this._scrollX) {
      this._scrollX = column.x
    } else if (column.x + column.width > this._scrollX + viewportWidth) {
      this._scrollX = column.x - viewportWidth + column.width
    }

    this.requestRender()
  }

  getRowAt(index: number): TableRow | null {
    const visibleRows = this._state.getVisibleRows()
    if (index < 0 || index >= visibleRows.length) return null
    return visibleRows[index]
  }

  getColumnAt(index: number): TableColumn | null {
    if (index < 0 || index >= this._columns.length) return null
    return this._columns[index]
  }

  getVisibleRowCount(): number {
    return this._state.getVisibleRows().length
  }

  getColumnCount(): number {
    return this._columns.length
  }

  hasFocus(): boolean {
    return this._hasFocus
  }

  private _emitTableEvent<EventType extends keyof TableEventMap>(
    event: EventType,
    data: TableEventMap[EventType],
  ): void {
    this._tableEventListeners.get(event)?.forEach((handler) => handler(data))
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    const theme = this._getThemeColors()
    const visibleRows = this._state.getVisibleRows()
    const visibleRange = this._layoutEngine.getVisibleRowRange(this.height, this._scrollY)
    const visibleColumnRange = this._layoutEngine.getVisibleColumnRange(this.width, this._scrollX)

    const startRow = Math.max(0, visibleRange[0])
    const endRow = Math.min(visibleRows.length, visibleRange[1])
    const startCol = visibleColumnRange[0]
    const endCol = visibleColumnRange[1]

    if (this._showHeader) {
      this._renderHeader(buffer, theme, startCol, endCol)
    }

    for (let rowIdx = startRow; rowIdx < endRow; rowIdx++) {
      const row = visibleRows[rowIdx]
      if (!row) continue

      const globalRowIndex = this._rows.indexOf(row)
      const isSelected = this._selectionManager.isSelected(globalRowIndex)
      const isFocused = this._selectionManager.isFocused(globalRowIndex)
      const isEven = globalRowIndex % 2 === 0

      this._renderRow(
        buffer,
        row,
        globalRowIndex,
        rowIdx - startRow,
        isSelected,
        isFocused,
        isEven,
        theme,
        startCol,
        endCol,
      )
    }

    if (this._hasFocus) {
      this._renderFocusIndicator(buffer, theme)
    }

    this._renderScrollbar(buffer, theme, visibleRows.length, startRow, endRow)
  }

  private _renderHeader(buffer: OptimizedBuffer, theme: any, startCol: number, endCol: number): void {
    const headerY = this.y
    const headerBg = this._parseColor(this._style.headerBg, theme.backgroundElement)
    const headerFg = this._parseColor(this._style.headerFg, theme.text)

    for (let colIdx = startCol; colIdx < endCol; colIdx++) {
      const column = this._columns[colIdx]
      const layout = this._layoutEngine.getColumnPosition(colIdx)
      if (!layout) continue

      const cellX = this.x + layout.x - this._scrollX
      const cellWidth = Math.min(layout.width, this.width - layout.x + this._scrollX)

      const isSorted = this._state.sortColumn === column.id
      const sortIndicator = isSorted ? (this._state.sortDirection === "asc" ? " ▲" : " ▼") : ""

      const title = column.title + sortIndicator
      const truncatedTitle = title.length > cellWidth - 1 ? title.slice(0, cellWidth - 2) + "…" : title

      if (headerBg) {
        buffer.fillRect(cellX, headerY, cellWidth, 1, headerBg)
      }

      const align = column.align || "left"
      const textX = this._calculateTextX(truncatedTitle, cellX, cellWidth, align)

      if (headerFg) {
        buffer.drawText(truncatedTitle, textX, headerY, headerFg)
      }
    }
  }

  private _renderRow(
    buffer: OptimizedBuffer,
    row: TableRow,
    globalIndex: number,
    displayIndex: number,
    isSelected: boolean,
    isFocused: boolean,
    isEven: boolean,
    theme: any,
    startCol: number,
    endCol: number,
  ): void {
    const rowY = this.y + this._layoutEngine.headerHeight + displayIndex * this._layoutEngine.rowHeight

    let rowBg: RGBA | undefined
    let rowFg: RGBA | undefined

    if (isSelected) {
      rowBg = this._parseColor(this._style.selectedBg, theme.primary)
      rowFg = this._parseColor(this._style.selectedFg, "#ffffff")
    } else if (isFocused) {
      rowBg = this._parseColor(this._style.selectedBg, theme.backgroundElement)
      rowFg = this._parseColor(this._style.selectedFg, theme.text)
    } else {
      rowBg = this._parseColor(
        this._striped && !isEven ? this._style.rowOddBg : this._style.rowEvenBg,
        isEven ? undefined : theme.backgroundElement,
      )
      rowFg = this._parseColor(undefined, theme.text)
    }

    if (rowBg) {
      for (let colIdx = startCol; colIdx < endCol; colIdx++) {
        const layout = this._layoutEngine.getColumnPosition(colIdx)
        if (!layout) continue

        const cellX = this.x + layout.x - this._scrollX
        const cellWidth = Math.min(layout.width, this.width - layout.x + this._scrollX)

        buffer.fillRect(cellX, rowY, cellWidth, this._layoutEngine.rowHeight, rowBg)
      }
    }

    for (let colIdx = startCol; colIdx < endCol; colIdx++) {
      const column = this._columns[colIdx]
      const layout = this._layoutEngine.getColumnPosition(colIdx)
      if (!layout) continue

      const cellX = this.x + layout.x - this._scrollX
      const cellWidth = Math.min(layout.width, this.width - layout.x + this._scrollX)

      let value = row[column.id]
      if (column.formatter) {
        value = column.formatter(value)
      }
      const cellText = String(value ?? "")
      const truncatedText = cellText.length > cellWidth - 1 ? cellText.slice(0, cellWidth - 2) + "…" : cellText

      const align = column.align || "left"
      const textX = this._calculateTextX(truncatedText, cellX, cellWidth, align)

      if (rowFg) {
        buffer.drawText(truncatedText, textX, rowY, rowFg)
      }
    }

    if (this._showRowNumbers) {
      const numX = this.x + 1 - this._scrollX
      const numFg = this._parseColor(undefined, theme.textMuted)
      if (numFg) {
        buffer.drawText(String(globalIndex + 1).padStart(3), numX, rowY, numFg)
      }
    }
  }

  private _renderFocusIndicator(buffer: OptimizedBuffer, theme: any): void {
    const focusedIndex = this._selectionManager.focusedIndex
    if (focusedIndex < 0) return

    const visibleRows = this._state.getVisibleRows()
    if (focusedIndex >= visibleRows.length) return

    const rowY = this.y + this._layoutEngine.headerHeight + focusedIndex * this._layoutEngine.rowHeight
    const focusBg = this._parseColor(undefined, theme.borderActive)

    if (focusBg) {
      for (let colIdx = 0; colIdx < this._columns.length; colIdx++) {
        const layout = this._layoutEngine.getColumnPosition(colIdx)
        if (!layout) continue

        const cellX = this.x + layout.x - this._scrollX
        const cellWidth = Math.min(layout.width, this.width - layout.x + this._scrollX)

        buffer.fillRect(cellX, rowY, cellWidth, this._layoutEngine.rowHeight, focusBg)
      }
    }
  }

  private _renderScrollbar(
    buffer: OptimizedBuffer,
    theme: any,
    totalRows: number,
    startRow: number,
    endRow: number,
  ): void {
    if (totalRows <= 0) return

    const scrollbarX = this.x + this.width - 1
    const scrollbarHeight = this.height - 2
    const trackBg = this._parseColor(undefined, theme.backgroundElement)
    const thumbBg = this._parseColor(undefined, theme.textMuted)

    const thumbHeight = Math.max(1, Math.floor(((endRow - startRow) / totalRows) * scrollbarHeight))
    const thumbY = this.y + 1 + Math.floor((startRow / totalRows) * scrollbarHeight)

    if (trackBg) {
      buffer.fillRect(scrollbarX, this.y + 1, 1, scrollbarHeight, trackBg)
    }

    if (thumbBg) {
      buffer.fillRect(scrollbarX, thumbY, 1, thumbHeight, thumbBg)
    }
  }

  private _calculateTextX(text: string, cellX: number, cellWidth: number, align: string): number {
    const textLength = text.length
    const padding = 1

    switch (align) {
      case "right":
        return cellX + cellWidth - textLength - padding
      case "center":
        return cellX + Math.floor((cellWidth - textLength) / 2)
      default:
        return cellX + padding
    }
  }

  private _parseColor(color: string | RGBA | undefined, fallback: string): RGBA | undefined {
    if (!color) {
      return RGBA.fromHex(fallback) || undefined
    }
    if (color instanceof RGBA) {
      return color
    }
    return RGBA.fromHex(color) || RGBA.fromHex(fallback) || undefined
  }

  private _getThemeColors() {
    if (this._cachedThemeColors) return this._cachedThemeColors
    this._cachedThemeColors = {
      background: "#1a1b26",
      backgroundElement: "#1f2335",
      backgroundPanel: "#24283b",
      text: "#c0caf5",
      textMuted: "#565f89",
      primary: "#7aa2f7",
      success: "#9ece6a",
      warning: "#e0af68",
      error: "#f7768e",
      border: "#414868",
      borderActive: "#7aa2f7",
    }
    return this._cachedThemeColors
  }
}
