import type { CompareResult, LoadedRun, RunIndex, TestIndex } from "../types"
import { testKey, computeRunStatistics, compareSeverity, lowerIsBetter } from "../types"

export function buildRunIndex(allRuns: LoadedRun[]): RunIndex {
  const index = new Map<string, TestIndex>()

  for (const run of allRuns) {
    for (const record of run.run.records) {
      const key = testKey(record)
      let ti = index.get(key)
      if (!ti) {
        ti = {
          key,
          suite: record.suite,
          module: record.module,
          scenario: record.scenario,
          unit: record.unit,
          runValues: new Map(),
          runs: [],
          bestRun: null,
          bestValue: Infinity,
          worstValue: -Infinity,
          avgValue: 0,
          medianValue: 0,
          p95Value: 0,
          stdDev: 0,
          count: 0,
          trend: "stable",
          trendConfidence: 0,
          regressionWarnings: [],
        }
        index.set(key, ti)
      }
      ti.runValues.set(run.run.runId, {
        value: record.value,
        iterations: record.iterations,
        timestamp: record.timestamp,
        metadata: record.metadata,
      })
    }
  }

  for (const [, ti] of index) {
    ti.runs = [...ti.runValues.keys()].sort((a, b) => a.localeCompare(b))
    const values = [...ti.runValues.values()]
    ti.count = values.length
    if (ti.count === 0) continue

    const rawValues = values.map((v) => v.value)
    const stats = computeRunStatistics(rawValues)
    ti.avgValue = stats.mean
    ti.medianValue = stats.median
    ti.p95Value = stats.p95
    ti.stdDev = stats.stdDev
    const betterLow = lowerIsBetter(ti.unit)
    ti.bestValue = betterLow ? stats.min : stats.max
    ti.worstValue = betterLow ? stats.max : stats.min

    for (const [runId, v] of ti.runValues) {
      if (v.value === ti.bestValue) {
        ti.bestRun = runId
        break
      }
    }

    if (ti.count >= 3) {
      const sortedByRun = [...ti.runValues.entries()].sort(([a], [b]) => a.localeCompare(b))
      const runValues = sortedByRun.map(([, v]) => v.value)
      const n = runValues.length
      const indices = runValues.map((_, i) => i)
      const sumX = indices.reduce((s, x) => s + x, 0)
      const sumY = runValues.reduce((s, y) => s + y, 0)
      const sumXY = indices.reduce((s, x, i) => s + x * runValues[i]!, 0)
      const sumX2 = indices.reduce((s, x) => s + x * x, 0)
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
      const intercept = (sumY - slope * sumX) / n
      const ssRes = indices.reduce((s, i) => s + (runValues[i]! - (slope * i + intercept)) ** 2, 0)
      const ssTot = runValues.reduce((s, y) => s + (y - ti.avgValue) ** 2, 0)
      const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot

      const stdErr = Math.sqrt(ssRes / (n - 2)) / Math.sqrt(sumX2 - (sumX * sumX) / n) || 0
      const tStat = stdErr === 0 ? 0 : slope / stdErr
      const confidence = Math.min(1, Math.abs(tStat) / 3)

      const direction: "up" | "down" | "stable" = betterLow
        ? slope < -stats.stdDev * 0.3
          ? "up"
          : slope > stats.stdDev * 0.3
            ? "down"
            : "stable"
        : slope > stats.stdDev * 0.3
          ? "up"
          : slope < -stats.stdDev * 0.3
            ? "down"
            : "stable"

      ti.trend = direction
      ti.trendConfidence = confidence

      if (direction === "down" && rSquared > 0.5 && confidence > 0.7) {
        ti.regressionWarnings.push(`Performance degrading (slope: ${slope.toFixed(2)}/run, R²=${rSquared.toFixed(2)})`)
      }
      if (ti.count >= 5 && stats.p95 > stats.median * 1.5) {
        ti.regressionWarnings.push(
          `High variance detected (P95=${stats.p95.toFixed(1)} vs median=${stats.median.toFixed(1)})`,
        )
      }
    }
  }

  return index
}

export function buildCompareResults(allRuns: LoadedRun[], leftRunId: string, rightRunId: string): CompareResult[] {
  const allValues = new Map<string, Map<string, { value: number; iterations: number }>>()
  for (const run of allRuns) {
    for (const record of run.run.records) {
      const key = testKey(record)
      let runMap = allValues.get(key)
      if (!runMap) {
        runMap = new Map()
        allValues.set(key, runMap)
      }
      runMap.set(run.run.runId, { value: record.value, iterations: record.iterations })
    }
  }

  const results: CompareResult[] = []
  for (const [key, runMap] of allValues) {
    const leftVal = runMap.get(leftRunId)
    const rightVal = runMap.get(rightRunId)
    if (!leftVal || !rightVal) continue

    const parts = key.split("::")
    const delta = leftVal.value - rightVal.value
    const deltaPercent = rightVal.value === 0 ? 0 : (delta / rightVal.value) * 100

    results.push({
      key,
      suite: parts[0] ?? "",
      module: parts[1] ?? "",
      scenario: parts[2] ?? "",
      unit: parts[3] ?? "ms",
      leftValue: leftVal.value,
      rightValue: rightVal.value,
      delta,
      deltaPercent,
      leftIsBetter: lowerIsBetter(parts[3] ?? "ms") ? leftVal.value < rightVal.value : leftVal.value > rightVal.value,
      severity: compareSeverity(deltaPercent, parts[3] ?? "ms"),
    })
  }

  return results.sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
}
