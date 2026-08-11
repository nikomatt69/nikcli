/**
 * Activity heatmap geometry — the GitHub-style contribution grid.
 *
 * This lives here rather than in the TUI because two very different surfaces
 * draw the same picture from the same shape: the CLI's analytics view over a
 * local session database, and the public /data page over gateway aggregates.
 * Both feed it a list of days and a metric; neither needs the other's storage.
 *
 * The functions are deliberately generic over the row type — anything with a
 * `date` in `YYYY-MM-DD` works — so a caller can chart tokens, cost, or
 * sessions without this module knowing what those are.
 */

export interface ActivityStats {
  totalDays: number
  activeDays: number
  longestStreak: number
  currentStreak: number
  avgPerActiveDay: number
  avgPerWeek: number
  total: number
  maxDay: number
}

export interface ActivityGrid {
  /** 7 rows (0=Mon .. 6=Sun) × N weeks. Each cell holds the metric value, or 0 if empty. */
  cells: number[][]
  /** First column where each month label should appear, plus the abbreviated month name. */
  monthLabels: { col: number; label: string }[]
  maxValue: number
  weeks: number
  /** ISO date (YYYY-MM-DD) of the first day in the rendered window. */
  startDate: string
  /** ISO date of the last day in the rendered window. */
  endDate: string
}

export interface ActivityDay {
  /** `YYYY-MM-DD`. */
  date: string
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

function parseDateKey(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/**
 * Summary statistics for the heatmap: active days, longest consecutive run,
 * current trailing run, and averages.
 */
export function computeActivityStats<T extends ActivityDay>(days: T[], metric: (day: T) => number): ActivityStats {
  if (days.length === 0) {
    return {
      totalDays: 0,
      activeDays: 0,
      longestStreak: 0,
      currentStreak: 0,
      avgPerActiveDay: 0,
      avgPerWeek: 0,
      total: 0,
      maxDay: 0,
    }
  }

  let activeDays = 0
  let longestStreak = 0
  let runStreak = 0
  let total = 0
  let maxDay = 0

  for (const d of days) {
    const v = metric(d)
    if (v > 0) {
      activeDays++
      runStreak++
      total += v
      if (v > maxDay) maxDay = v
      if (runStreak > longestStreak) longestStreak = runStreak
    } else {
      runStreak = 0
    }
  }

  const totalWeeks = Math.max(1, Math.ceil(days.length / 7))
  return {
    totalDays: days.length,
    activeDays,
    longestStreak,
    currentStreak: runStreak,
    avgPerActiveDay: activeDays > 0 ? total / activeDays : 0,
    avgPerWeek: total / totalWeeks,
    total,
    maxDay,
  }
}

/**
 * Build a 7×N matrix for a GitHub-style contribution graph.
 *
 * Rows: 0=Mon .. 6=Sun. Columns: oldest week (left) → most recent week (right).
 * The grid is anchored to a Monday — leading days from the first partial week
 * and trailing days from the last partial week are left as 0 (empty cell).
 *
 * Months are emitted only when there is at least a 2-week gap from the previous
 * label so they never visually overlap.
 */
export function buildActivityGrid<T extends ActivityDay>(
  days: T[],
  lookbackDays: number,
  metric: (day: T) => number,
): ActivityGrid {
  if (days.length === 0) {
    return {
      cells: [[], [], [], [], [], [], []],
      monthLabels: [],
      maxValue: 0,
      weeks: 0,
      startDate: "",
      endDate: "",
    }
  }

  // Use only the most recent `lookbackDays` entries.
  const slice = days.length > lookbackDays ? days.slice(-lookbackDays) : days

  const first = parseDateKey(slice[0]!.date)
  const firstDow = (first.getUTCDay() + 6) % 7 // 0=Mon .. 6=Sun
  const totalDays = slice.length + firstDow
  const weeks = Math.max(1, Math.ceil(totalDays / 7))

  const cells: number[][] = Array.from({ length: 7 }, () => new Array(weeks).fill(0))
  let maxValue = 0

  for (let i = 0; i < slice.length; i++) {
    const d = slice[i]!
    const v = metric(d)
    if (v > maxValue) maxValue = v
    const cellIndex = i + firstDow
    const row = cellIndex % 7
    const col = Math.floor(cellIndex / 7)
    cells[row]![col] = v
  }

  // Month labels: emit the first column of each month, but skip if too close
  // to the previous label (avoid overlap with truncated 2-char-wide labels).
  const monthLabels: { col: number; label: string }[] = []
  let prevMonth = -1
  for (let i = 0; i < slice.length; i++) {
    const d = slice[i]!
    const month = parseDateKey(d.date).getUTCMonth()
    if (month === prevMonth) continue
    prevMonth = month
    const cellIndex = i + firstDow
    const col = Math.floor(cellIndex / 7)
    const last = monthLabels[monthLabels.length - 1]
    if (!last || col - last.col >= 2) {
      monthLabels.push({ col, label: MONTH_NAMES[month]! })
    }
  }

  return {
    cells,
    monthLabels,
    maxValue,
    weeks,
    startDate: slice[0]!.date,
    endDate: slice[slice.length - 1]!.date,
  }
}
