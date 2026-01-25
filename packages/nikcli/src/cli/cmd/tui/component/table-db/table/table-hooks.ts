import { createSignal, createMemo, onMount, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { TableColumn, TableRow, TableStyle, TableActions, TableState } from "./types"
import { TableStateManager } from "./table-state"

export interface UseTableOptions {
  columns: TableColumn[]
  rows: TableRow[]
  rowKey?: string
  selection?: "none" | "single" | "multiple"
  showHeader?: boolean
  showRowNumbers?: boolean
  striped?: boolean
  compact?: boolean
  style?: TableStyle
  pageSize?: number
}

export function useTable(options: UseTableOptions) {
  const [state, setState] = createStore<TableState>({
    data: options.rows,
    filteredData: options.rows,
    selectedRow: null,
    sortColumn: null,
    sortDirection: "asc",
    filterQuery: "",
    page: 1,
    pageSize: options.pageSize ?? 50,
  })

  const stateManager = new TableStateManager()
  stateManager.setData(options.rows)
  if (options.pageSize) {
    stateManager.setPageSize(options.pageSize)
  }

  const columns = createMemo(() => options.columns)
  const rows = createMemo(() => stateManager.getVisibleRows())

  const actions: TableActions = {
    setData: (cols: TableColumn[], newRows: TableRow[]) => {
      stateManager.setData(newRows)
      setState({ data: newRows, filteredData: newRows, page: 1 })
    },
    selectRow: (index: number | null) => {
      setState({ selectedRow: index })
    },
    sortBy: (columnId: string) => {
      stateManager.setSort(columnId)
      setState({
        sortColumn: stateManager.sortColumn,
        sortDirection: stateManager.sortDirection,
      })
    },
    filter: (query: string) => {
      stateManager.setFilter(query)
      setState({ filterQuery: query })
    },
    setPage: (page: number) => {
      stateManager.setPage(page)
      setState({ page })
    },
    nextPage: () => {
      if (stateManager.nextPage()) {
        setState({ page: stateManager.page })
      }
    },
    prevPage: () => {
      if (stateManager.prevPage()) {
        setState({ page: stateManager.page })
      }
    },
  }

  const selection = createMemo(() => ({
    selected: state.selectedRow,
    total: rows().length,
    hasSelection: state.selectedRow !== null,
  }))

  const pagination = createMemo(() => ({
    page: stateManager.page,
    pageSize: stateManager.pageSize,
    totalPages: stateManager.getTotalPages(),
    totalRows: stateManager.getTotalRows(),
    hasNext: stateManager.nextPage() !== false,
    hasPrev: stateManager.page > 1,
  }))

  const sort = createMemo(() => ({
    column: stateManager.sortColumn,
    direction: stateManager.sortDirection,
  }))

  return {
    columns,
    rows,
    state,
    actions,
    selection,
    pagination,
    sort,
    stateManager,
  }
}
