import type { TableColumn, TableRow } from "./types"

export interface TableEventData {
  row: TableRow
  index: number
}

export interface TableSortEventData {
  column: TableColumn
  direction: "asc" | "desc"
}

export interface TableCellEditEventData {
  row: TableRow
  column: TableColumn
  oldValue: any
  newValue: any
}

export interface TableScrollEventData {
  scrollTop: number
  scrollLeft: number
  visibleStart: number
  visibleEnd: number
}

export const TableEvents = {
  ROW_SELECTED: "table.row.selected" as const,
  ROW_ACTIVATED: "table.row.activated" as const,
  COLUMN_SORTED: "table.column.sorted" as const,
  CELL_EDITED: "table.cell.edited" as const,
  SCROLLED: "table.scrolled" as const,
  FILTER_CHANGED: "table.filter.changed" as const,
  PAGINATION_CHANGED: "table.pagination.changed" as const,
}

export type TableEventType =
  | typeof TableEvents.ROW_SELECTED
  | typeof TableEvents.ROW_ACTIVATED
  | typeof TableEvents.COLUMN_SORTED
  | typeof TableEvents.CELL_EDITED
  | typeof TableEvents.SCROLLED
  | typeof TableEvents.FILTER_CHANGED
  | typeof TableEvents.PAGINATION_CHANGED

export interface TableEventMap {
  [TableEvents.ROW_SELECTED]: TableEventData
  [TableEvents.ROW_ACTIVATED]: TableEventData
  [TableEvents.COLUMN_SORTED]: TableSortEventData
  [TableEvents.CELL_EDITED]: TableCellEditEventData
  [TableEvents.SCROLLED]: TableScrollEventData
  [TableEvents.FILTER_CHANGED]: { query: string; filteredCount: number; totalCount: number }
  [TableEvents.PAGINATION_CHANGED]: { page: number; pageSize: number; totalPages: number }
}
