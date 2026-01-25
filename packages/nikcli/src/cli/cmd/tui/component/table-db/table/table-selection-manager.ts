import type { TableRow } from "./types"

export class TableSelectionManager {
  private _table: any
  private _selectionMode: "none" | "single" | "multiple"
  private _selectedIndices: Set<number> = new Set()
  private _focusedIndex: number = 0
  private _onSelectionChange?: (indices: number[]) => void

  constructor(table: any, mode: "none" | "single" | "multiple", onSelectionChange?: (indices: number[]) => void) {
    this._table = table
    this._selectionMode = mode
    this._onSelectionChange = onSelectionChange
  }

  get selectionMode(): "none" | "single" | "multiple" {
    return this._selectionMode
  }

  get selectedIndices(): number[] {
    return Array.from(this._selectedIndices).sort((a, b) => a - b)
  }

  get selectedCount(): number {
    return this._selectedIndices.size
  }

  get hasSelection(): boolean {
    return this._selectedIndices.size > 0
  }

  get focusedIndex(): number {
    return this._focusedIndex
  }

  setFocusedIndex(index: number) {
    this._focusedIndex = index
    this._table.requestRender()
  }

  setSelectedIndex(index: number | null) {
    this._selectedIndices.clear()
    if (index !== null) {
      this._selectedIndices.add(index)
      this._focusedIndex = index
    }
    this._onSelectionChange?.(this.selectedIndices)
    this._table.requestRender()
  }

  addSelection(index: number) {
    if (this._selectionMode === "multiple") {
      if (this._selectedIndices.has(index)) {
        this._selectedIndices.delete(index)
      } else {
        this._selectedIndices.add(index)
      }
      this._onSelectionChange?.(this.selectedIndices)
      this._table.requestRender()
    }
  }

  selectRange(endIndex: number) {
    if (this._selectionMode !== "multiple") return

    const start = Math.min(this._focusedIndex, endIndex)
    const end = Math.max(this._focusedIndex, endIndex)

    for (let i = start; i <= end; i++) {
      this._selectedIndices.add(i)
    }
    this._onSelectionChange?.(this.selectedIndices)
    this._table.requestRender()
  }

  clearSelection() {
    this._selectedIndices.clear()
    this._onSelectionChange?.([])
    this._table.requestRender()
  }

  selectAll() {
    if (this._selectionMode !== "multiple") return

    const rowCount = this._table.getVisibleRowCount()
    for (let i = 0; i < rowCount; i++) {
      this._selectedIndices.add(i)
    }
    this._onSelectionChange?.(this.selectedIndices)
    this._table.requestRender()
  }

  moveUp(count: number = 1) {
    this._focusedIndex = Math.max(0, this._focusedIndex - count)
    this._table.requestRender()
  }

  moveDown(count: number = 1) {
    const max = this._table.getVisibleRowCount() - 1
    this._focusedIndex = Math.min(max, this._focusedIndex + count)
    this._table.requestRender()
  }

  moveLeft(count: number = 1) {
    const columnCount = this._table.getColumnCount()
    this._focusedIndex = Math.max(0, this._focusedIndex - count)
    return columnCount
  }

  moveRight(count: number = 1) {
    const columnCount = this._table.getColumnCount()
    this._focusedIndex = Math.min(this._focusedIndex + count, columnCount - 1)
    return columnCount
  }

  getSelectedRow(): TableRow | null {
    if (this._selectedIndices.size === 0) return null
    return this._table.getRowAt(Array.from(this._selectedIndices)[0])
  }

  getSelectedRows(): TableRow[] {
    return this.selectedIndices.map((i) => this._table.getRowAt(i)).filter(Boolean)
  }

  isSelected(index: number): boolean {
    return this._selectedIndices.has(index)
  }

  isFocused(index: number): boolean {
    return this._focusedIndex === index
  }

  isSelectedOrFocused(index: number): boolean {
    return this.isSelected(index) || this.isFocused(index)
  }
}
