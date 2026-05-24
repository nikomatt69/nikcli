import { describe, expect, it } from "bun:test"

interface TableRow {
  [key: string]: any
}

interface ColumnLayout {
  index: number
  id: string
  x: number
  width: number
  visibleWidth: number
}

function buildRowIndexMapOld(rows: TableRow[]): Map<TableRow, number> {
  const map = new Map()
  for (let i = 0; i < rows.length; i++) {
    map.set(rows[i], i)
  }
  return map
}

function getRowIndexOld(rows: TableRow[], row: TableRow): number {
  return rows.indexOf(row)
}

function getRowIndexNew(map: Map<TableRow, number>, row: TableRow): number {
  return map.get(row) ?? -1
}

function buildColumnLayoutsOld(columns: string[]): ColumnLayout[] {
  const layouts: ColumnLayout[] = []
  let currentX = 0
  for (let i = 0; i < columns.length; i++) {
    layouts.push({
      index: i,
      id: columns[i],
      x: currentX,
      width: 10,
      visibleWidth: 10,
    })
    currentX += 10
  }
  return layouts
}

function getColumnByIdOld(layouts: ColumnLayout[], id: string): ColumnLayout | null {
  return layouts.find((c) => c.id === id) || null
}

function buildColumnIdMap(columns: string[]): Map<string, ColumnLayout> {
  const map = new Map()
  const layouts: ColumnLayout[] = []
  let currentX = 0
  for (let i = 0; i < columns.length; i++) {
    const layout = {
      index: i,
      id: columns[i],
      x: currentX,
      width: 10,
      visibleWidth: 10,
    }
    layouts.push(layout)
    map.set(columns[i], layout)
    currentX += 10
  }
  return map
}

function getColumnByIdNew(map: Map<string, ColumnLayout>, id: string): ColumnLayout | null {
  return map.get(id) ?? null
}

describe("TUI Table Performance Optimizations", () => {
  describe("Row Index Lookup (indexOf → Map)", () => {
    it("correctness: returns same indices", () => {
      const rows = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
      ]
      const map = buildRowIndexMapOld(rows)

      for (let i = 0; i < rows.length; i++) {
        expect(getRowIndexNew(map, rows[i])).toBe(i)
      }
    })

    it("benchmark: indexOf vs Map lookup", () => {
      const rowCount = 10000
      const rows: TableRow[] = []
      for (let i = 0; i < rowCount; i++) {
        rows.push({ id: i, name: `row_${i}` })
      }

      const map = buildRowIndexMapOld(rows)
      const visibleRows = rows.slice(100, 200)
      const iterations = 1000

      const startOld = performance.now()
      let sinkOld = 0
      for (let iter = 0; iter < iterations; iter++) {
        for (const row of visibleRows) {
          sinkOld += getRowIndexOld(rows, row)
        }
      }
      const oldTime = performance.now() - startOld
      expect(sinkOld).toBeGreaterThan(0)

      const startNew = performance.now()
      let sinkNew = 0
      for (let iter = 0; iter < iterations; iter++) {
        for (const row of visibleRows) {
          sinkNew += getRowIndexNew(map, row)
        }
      }
      const newTime = performance.now() - startNew
      expect(sinkNew).toBeGreaterThan(0)

      const improvement = oldTime / newTime
      const percentReduction = ((oldTime - newTime) / oldTime) * 100

      console.log(`\n📊 Row index lookup (${iterations} iterations x ${visibleRows.length} visible rows):`)
      console.log(`   Old (indexOf): ${oldTime.toFixed(2)}ms`)
      console.log(`   New (Map): ${newTime.toFixed(2)}ms`)
      console.log(`   ⚡ Improvement: ${improvement.toFixed(2)}x faster (${percentReduction.toFixed(1)}% reduction)`)

      // Correctness — both lookup strategies must return the same indices.
      // Timing comparisons are noisy on shared CI / Windows runners, so we keep
      // the log for visibility but do not gate the test on absolute wall time.
      expect(sinkNew).toBe(sinkOld)
    })

    it("benchmark: full render simulation (worst case O(n²))", () => {
      const rowCount = 5000
      const rows: TableRow[] = []
      for (let i = 0; i < rowCount; i++) {
        rows.push({ id: i, name: `row_${i}` })
      }

      const map = buildRowIndexMapOld(rows)
      const visibleRowCount = 100
      const iterations = 100

      // "Worst case" for indexOf is when rows are near the end of the array (late match).
      const visibleRows = rows.slice(rowCount - visibleRowCount)

      const startOld = performance.now()
      let sinkOld = 0
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < visibleRows.length; i++) {
          sinkOld += rows.indexOf(visibleRows[i])
        }
      }
      const oldTime = performance.now() - startOld
      expect(sinkOld).toBeGreaterThan(0)

      const startNew = performance.now()
      let sinkNew = 0
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < visibleRows.length; i++) {
          sinkNew += map.get(visibleRows[i]) ?? -1
        }
      }
      const newTime = performance.now() - startNew
      expect(sinkNew).toBeGreaterThan(0)

      const improvement = oldTime / newTime
      const percentReduction = ((oldTime - newTime) / oldTime) * 100

      console.log(`\n📊 Full render simulation (${iterations} renders x ${visibleRowCount} rows):`)
      console.log(`   Old (indexOf per row): ${oldTime.toFixed(2)}ms`)
      console.log(`   New (Map lookup): ${newTime.toFixed(2)}ms`)
      console.log(`   ⚡ Improvement: ${improvement.toFixed(2)}x faster (${percentReduction.toFixed(1)}% reduction)`)

      // Correctness only — see note above; timing is for visibility, not gating.
      expect(sinkNew).toBe(sinkOld)
    })
  })

  describe("Column ID Lookup (find → Map)", () => {
    it("correctness: returns same results", () => {
      const columnIds = ["id", "name", "email", "status", "created"]
      const layouts = buildColumnLayoutsOld(columnIds)
      const map = buildColumnIdMap(columnIds)

      for (const id of columnIds) {
        const oldResult = getColumnByIdOld(layouts, id)
        const newResult = getColumnByIdNew(map, id)
        expect(newResult?.id).toBe(oldResult?.id)
        expect(newResult?.index).toBe(oldResult?.index)
      }
    })

    it("benchmark: find vs Map.get", () => {
      const columnCount = 50
      const columnIds: string[] = []
      for (let i = 0; i < columnCount; i++) {
        columnIds.push(`col_${i}`)
      }

      const layouts = buildColumnLayoutsOld(columnIds)
      const map = buildColumnIdMap(columnIds)

      const iterations = 10000

      const startOld = performance.now()
      let oldHits = 0
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < columnIds.length; i++) {
          if (getColumnByIdOld(layouts, columnIds[i])) oldHits++
        }
      }
      const oldTime = performance.now() - startOld

      const startNew = performance.now()
      let newHits = 0
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < columnIds.length; i++) {
          if (getColumnByIdNew(map, columnIds[i])) newHits++
        }
      }
      const newTime = performance.now() - startNew

      const improvement = oldTime / newTime
      const percentReduction = ((oldTime - newTime) / oldTime) * 100

      console.log(`\n📊 Column ID lookup (${iterations} iterations x ${columnCount} columns):`)
      console.log(`   Old (.find): ${oldTime.toFixed(2)}ms`)
      console.log(`   New (Map.get): ${newTime.toFixed(2)}ms`)
      console.log(`   ⚡ Improvement: ${improvement.toFixed(2)}x faster (${percentReduction.toFixed(1)}% reduction)`)

      // Correctness only — see note above; timing is for visibility, not gating.
      expect(newHits).toBe(oldHits)
    })
  })
})
