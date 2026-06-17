import { describe, expect, it } from "bun:test"
import { buildActivityGrid, computeActivityStats, type DayStats } from "../../src/cli/cmd/tui/util/analytics-aggregator"

// Build a minimal DayStats for a given date. Only `date` and `tokens` are
// exercised by the heatmap helpers; the rest default to 0.
function day(date: string, tokens: number): DayStats {
  return {
    date,
    sessions: 0,
    tokens,
    input: tokens,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    messages: 0,
    models: new Map(),
  }
}

/** Build N consecutive days starting from `startDate` with the given per-day values. */
function days(startDate: string, values: number[]): DayStats[] {
  const out: DayStats[] = []
  const start = new Date(`${startDate}T00:00:00.000Z`)
  for (let i = 0; i < values.length; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    out.push(day(d.toISOString().split("T")[0]!, values[i]!))
  }
  return out
}

describe("computeActivityStats", () => {
  it("returns zeros for an empty input", () => {
    const s = computeActivityStats([])
    expect(s.totalDays).toBe(0)
    expect(s.activeDays).toBe(0)
    expect(s.longestStreak).toBe(0)
    expect(s.currentStreak).toBe(0)
    expect(s.avgPerActiveDay).toBe(0)
    expect(s.avgPerWeek).toBe(0)
    expect(s.total).toBe(0)
    expect(s.maxDay).toBe(0)
  })

  it("returns zeros when every day is inactive", () => {
    const s = computeActivityStats(days("2026-01-01", [0, 0, 0, 0, 0]))
    expect(s.activeDays).toBe(0)
    expect(s.longestStreak).toBe(0)
    expect(s.currentStreak).toBe(0)
    expect(s.total).toBe(0)
    expect(s.maxDay).toBe(0)
  })

  it("computes longest streak across a single run", () => {
    // 3 active, 1 inactive, 5 active, 2 inactive, 1 active
    const values = [10, 10, 10, 0, 5, 5, 5, 5, 5, 0, 0, 7]
    const s = computeActivityStats(days("2026-01-01", values))
    // 10,10,10,0,5,5,5,5,5,0,0,7 → active days = 3+5+1 = 9
    expect(s.activeDays).toBe(9)
    expect(s.longestStreak).toBe(5)
    expect(s.currentStreak).toBe(1) // last value is 7
    expect(s.total).toBe(10 * 3 + 5 * 5 + 7) // = 30 + 25 + 7 = 62
    expect(s.maxDay).toBe(10)
  })

  it("currentStreak is the trailing run only", () => {
    // 5 active, 2 inactive, 3 active → current streak = 3
    const s = computeActivityStats(days("2026-01-01", [1, 2, 3, 4, 5, 0, 0, 6, 7, 8]))
    expect(s.longestStreak).toBe(5)
    expect(s.currentStreak).toBe(3)
  })

  it("avgPerActiveDay divides by active days, not by total window", () => {
    // 2 active days at 100 tokens each, plus 5 inactive days
    const s = computeActivityStats(days("2026-01-01", [100, 0, 0, 0, 0, 100, 0]))
    expect(s.activeDays).toBe(2)
    expect(s.total).toBe(200)
    expect(s.avgPerActiveDay).toBe(100)
  })

  it("avgPerWeek divides by total weeks (ceil of days/7)", () => {
    // 7 days, 1 active day with 700 tokens
    const s = computeActivityStats(days("2026-01-01", [700, 0, 0, 0, 0, 0, 0]))
    expect(s.total).toBe(700)
    expect(s.avgPerWeek).toBe(700) // 1 week, 700/1 = 700
  })

  it("supports a custom metric (e.g. cost-based activity)", () => {
    const values = [0, 5, 0, 10, 0, 0, 7]
    const s = computeActivityStats(days("2026-01-01", values), (d) => d.cost)
    // We're passing tokens in `values` but querying cost, so cost is always 0.
    // Re-run with explicit cost: build days with cost field directly.
    const daysWithCost: DayStats[] = values.map((c, i) => ({
      ...day(`2026-01-0${i + 1}`, 0),
      cost: c,
    }))
    const s2 = computeActivityStats(daysWithCost, (d) => d.cost)
    expect(s2.total).toBe(5 + 10 + 7)
    expect(s2.activeDays).toBe(3)
    expect(s2.longestStreak).toBe(1) // all runs are length 1
  })
})

describe("buildActivityGrid", () => {
  it("returns an empty grid for empty input", () => {
    const g = buildActivityGrid([])
    expect(g.weeks).toBe(0)
    expect(g.maxValue).toBe(0)
    expect(g.cells.every((row) => row.length === 0)).toBe(true)
    expect(g.monthLabels).toEqual([])
  })

  it("anchors the first day to its weekday row (Mon=0, Sun=6)", () => {
    // 2026-01-05 is a Monday (verified: 2026-01-01 is Thursday → 2026-01-05 is Mon)
    const g = buildActivityGrid(days("2026-01-05", [10, 20, 30, 40, 50, 60, 70]))
    // First day is Mon, so cellIndex 0 → row 0. 7 days → 1 week.
    expect(g.weeks).toBe(1)
    expect(g.cells[0]?.[0]).toBe(10)
    expect(g.cells[6]?.[0]).toBe(70)
    expect(g.maxValue).toBe(70)
    expect(g.startDate).toBe("2026-01-05")
    expect(g.endDate).toBe("2026-01-11")
  })

  it("pads the first week when starting mid-week", () => {
    // 2026-01-07 is a Wednesday → firstDow = 2 (row offset)
    const g = buildActivityGrid(days("2026-01-07", [100, 200, 300, 400, 500]))
    // 5 days + 2 day offset = 7 total → 1 week
    expect(g.weeks).toBe(1)
    // Days land at rows 2..6 (Wed..Sun)
    expect(g.cells[0]?.[0]).toBe(0) // Mon (empty)
    expect(g.cells[1]?.[0]).toBe(0) // Tue (empty)
    expect(g.cells[2]?.[0]).toBe(100) // Wed
    expect(g.cells[3]?.[0]).toBe(200) // Thu
    expect(g.cells[4]?.[0]).toBe(300) // Fri
    expect(g.cells[5]?.[0]).toBe(400) // Sat
    expect(g.cells[6]?.[0]).toBe(500) // Sun
  })

  it("spans multiple weeks when the window exceeds 7 days", () => {
    // 14 days starting Mon 2026-01-05 → 2 full weeks
    const values = Array.from({ length: 14 }, (_, i) => i + 1)
    const g = buildActivityGrid(days("2026-01-05", values))
    expect(g.weeks).toBe(2)
    expect(g.cells[0]?.[0]).toBe(1)
    expect(g.cells[6]?.[0]).toBe(7)
    expect(g.cells[0]?.[1]).toBe(8)
    expect(g.cells[6]?.[1]).toBe(14)
    expect(g.maxValue).toBe(14)
  })

  it("emits month labels with a 2-week minimum gap", () => {
    // 60 days starting 2026-01-05 — should produce Jan + Feb + Mar (with gaps).
    const values = Array.from({ length: 60 }, () => 1)
    const g = buildActivityGrid(days("2026-01-05", values))
    const labels = g.monthLabels.map((m) => m.label)
    // First month is always Jan (col 0). Subsequent months appear every 4-5 weeks.
    expect(labels[0]).toBe("Jan")
    // Each subsequent label must be at least 2 weeks after the previous one.
    for (let i = 1; i < g.monthLabels.length; i++) {
      const prev = g.monthLabels[i - 1]!
      const cur = g.monthLabels[i]!
      expect(cur.col - prev.col).toBeGreaterThanOrEqual(2)
    }
  })

  it("respects the lookbackDays limit by trimming the oldest entries", () => {
    // 10 days, but ask for lookback=5 → only the last 5 should drive the grid.
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const g = buildActivityGrid(days("2026-01-05", values), 5)
    expect(g.startDate).toBe("2026-01-10")
    expect(g.endDate).toBe("2026-01-14")
    // maxValue comes from the trimmed window: 10
    expect(g.maxValue).toBe(10)
  })

  it("supports a custom metric (cost-based grid)", () => {
    const costs = [5, 0, 0, 10, 0, 0, 7]
    const daysWithCost: DayStats[] = costs.map((c, i) => {
      const start = new Date("2026-01-05T00:00:00.000Z")
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + i)
      return { ...day(d.toISOString().split("T")[0]!, 0), cost: c }
    })
    const g = buildActivityGrid(daysWithCost, 7, (d) => d.cost)
    // Week starting Mon 2026-01-05: Mon:5, Tue:0, Wed:0, Thu:10, Fri:0, Sat:0, Sun:7
    expect(g.cells[0]?.[0]).toBe(5)
    expect(g.cells[3]?.[0]).toBe(10)
    expect(g.cells[6]?.[0]).toBe(7)
    expect(g.maxValue).toBe(10)
  })

  it("yields a 7-row grid for any non-empty input", () => {
    const g = buildActivityGrid(days("2026-01-05", [1, 2, 3]))
    expect(g.cells).toHaveLength(7)
    for (const row of g.cells) {
      expect(Array.isArray(row)).toBe(true)
    }
  })
})
