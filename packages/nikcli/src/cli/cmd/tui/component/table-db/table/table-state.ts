import type { TableRow, SortDirection } from "./types"

export class TableStateManager {
  private _sortColumn: string | null = null
  private _sortDirection: SortDirection = "asc"
  private _filterQuery: string = ""
  private _page: number = 1
  private _pageSize: number = 50
  private _originalData: TableRow[] = []

  get sortColumn(): string | null {
    return this._sortColumn
  }

  get sortDirection(): SortDirection {
    return this._sortDirection
  }

  get filterQuery(): string {
    return this._filterQuery
  }

  get page(): number {
    return this._page
  }

  get pageSize(): number {
    return this._pageSize
  }

  get isSorted(): boolean {
    return this._sortColumn !== null
  }

  get isFiltered(): boolean {
    return this._filterQuery.length > 0
  }

  get isPaginated(): boolean {
    return this._pageSize > 0
  }

  setData(data: TableRow[]): void {
    this._originalData = data
  }

  setSort(columnId: string, direction?: SortDirection): void {
    if (this._sortColumn === columnId) {
      this._sortDirection = this._sortDirection === "asc" ? "desc" : "asc"
    } else {
      this._sortColumn = columnId
      this._sortDirection = direction || "asc"
    }
  }

  clearSort(): void {
    this._sortColumn = null
    this._sortDirection = "asc"
  }

  setFilter(query: string): void {
    this._filterQuery = query
    this._page = 1
  }

  clearFilter(): void {
    this._filterQuery = ""
    this._page = 1
  }

  setPage(page: number): void {
    this._page = Math.max(1, page)
  }

  setPageSize(size: number): void {
    this._pageSize = Math.max(1, size)
    this._page = 1
  }

  nextPage(): boolean {
    const maxPage = this.getTotalPages()
    if (this._page < maxPage) {
      this._page++
      return true
    }
    return false
  }

  prevPage(): boolean {
    if (this._page > 1) {
      this._page--
      return true
    }
    return false
  }

  firstPage(): void {
    this._page = 1
  }

  lastPage(): void {
    this._page = this.getTotalPages()
  }

  getTotalPages(): number {
    const filtered = this._applyFilter(this._originalData)
    if (!this.isPaginated) return 1
    return Math.ceil(filtered.length / this._pageSize)
  }

  getTotalRows(): number {
    return this._originalData.length
  }

  getFilteredRows(): number {
    return this._applyFilter(this._originalData).length
  }

  getVisibleRows(): TableRow[] {
    let result = this._originalData

    result = this._applyFilter(result)
    result = this._applySort(result)

    if (this.isPaginated) {
      const start = (this._page - 1) * this._pageSize
      const end = start + this._pageSize
      result = result.slice(start, end)
    }

    return result
  }

  getAllRows(): TableRow[] {
    let result = this._originalData
    result = this._applyFilter(result)
    result = this._applySort(result)
    return result
  }

  private _applyFilter(rows: TableRow[]): TableRow[] {
    if (!this._filterQuery) return rows

    const query = this._filterQuery.toLowerCase()
    return rows.filter((row) => {
      const values = Object.values(row).map((v) => String(v).toLowerCase())
      return values.some((v) => v.includes(query))
    })
  }

  private _applySort(rows: TableRow[]): TableRow[] {
    if (!this._sortColumn) return rows

    return [...rows].sort((a, b) => {
      const aVal = a[this._sortColumn!]
      const bVal = b[this._sortColumn!]

      let comparison = 0

      if (aVal === null || aVal === undefined) {
        comparison = -1
      } else if (bVal === null || bVal === undefined) {
        comparison = 1
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal
      } else {
        const aStr = String(aVal).toLowerCase()
        const bStr = String(bVal).toLowerCase()
        comparison = aStr.localeCompare(bStr)
      }

      return this._sortDirection === "asc" ? comparison : -comparison
    })
  }

  getSortState(): { column: string | null; direction: SortDirection } {
    return {
      column: this._sortColumn,
      direction: this._sortDirection,
    }
  }

  getPaginationState(): { page: number; pageSize: number; totalPages: number; totalRows: number } {
    return {
      page: this._page,
      pageSize: this._pageSize,
      totalPages: this.getTotalPages(),
      totalRows: this._originalData.length,
    }
  }

  reset(): void {
    this._sortColumn = null
    this._sortDirection = "asc"
    this._filterQuery = ""
    this._page = 1
  }
}
