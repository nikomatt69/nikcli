import type { RGBA } from "@opentui/core"

export interface TableColumn {
  id: string
  title: string
  width: number | string
  minWidth?: number
  maxWidth?: number
  align?: "left" | "center" | "right"
  sortable?: boolean
  resizable?: boolean
  visible?: boolean
  formatter?: (value: any) => string
}

export interface TableRow {
  id: string | number
  [key: string]: any
}

export interface TableStyle {
  headerBg?: RGBA | string
  headerFg?: RGBA | string
  rowOddBg?: RGBA | string
  rowEvenBg?: RGBA | string
  selectedBg?: RGBA | string
  selectedFg?: RGBA | string
  borderColor?: RGBA | string
  focusRing?: boolean
}

export interface TableOptions {
  columns: TableColumn[]
  rows: TableRow[]
  rowKey?: string
  selection?: "none" | "single" | "multiple"
  showHeader?: boolean
  showRowNumbers?: boolean
  striped?: boolean
  compact?: boolean
  style?: TableStyle
  onRowSelect?: (row: TableRow, index: number) => void
  onRowActivate?: (row: TableRow, index: number) => void
  onCellEdit?: (row: TableRow, column: TableColumn, value: any) => void
  onSort?: (column: TableColumn, direction: "asc" | "desc") => void
}

export interface TableState {
  data: TableRow[]
  filteredData: TableRow[]
  selectedRow: number | null
  sortColumn: string | null
  sortDirection: "asc" | "desc"
  filterQuery: string
  page: number
  pageSize: number
}

export interface TableActions {
  setData: (columns: TableColumn[], rows: TableRow[]) => void
  selectRow: (index: number | null) => void
  sortBy: (columnId: string) => void
  filter: (query: string) => void
  setPage: (page: number) => void
  nextPage: () => void
  prevPage: () => void
}

export type SortDirection = "asc" | "desc"
