/**
 * Benchmark runner with save/compare/visual capabilities.
 *
 * Usage:
 *   import { runBench, compareBenchmarks, printBenchReport } from "../bench/runner"
 *
 *   it("my bench", () => {
 *     const r = runBench("my op", "my-module", 100_000, () => doWork())
 *     printBenchResult(r)
 *     compareBenchmarks("my-module")
 *   })
 *
 * Results are saved to test/bench/results/<module>.json and can be compared
 * across runs.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs"
import path from "path"

export interface BenchmarkResult {
  name: string
  module: string
  timestamp: number
  date: string
  iterations: number
  totalMs: number
  perOpMs: number
  opsPerSec: number
}

export interface BenchmarkRun {
  runId: string
  timestamp: number
  results: BenchmarkResult[]
}

const RESULTS_DIR = path.resolve(import.meta.dir, "results")

function ensureDir(): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
}

export function saveBenchmark(result: BenchmarkResult): void {
  ensureDir()
  const file = path.join(RESULTS_DIR, `${result.module}.json`)
  let existing: BenchmarkResult[] = []
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf8")) as BenchmarkResult[]
    } catch {}
  }
  existing.push(result)
  // keep only last 50 runs per benchmark
  const byName = new Map<string, BenchmarkResult[]>()
  for (const r of existing) {
    const arr = byName.get(r.name) ?? []
    arr.push(r)
    byName.set(r.name, arr)
  }
  const trimmed: BenchmarkResult[] = []
  for (const arr of byName.values()) {
    trimmed.push(...arr.slice(-50))
  }
  trimmed.sort((a, b) => a.timestamp - b.timestamp)
  writeFileSync(file, JSON.stringify(trimmed, null, 2))
}

export function loadBenchmarks(module: string): BenchmarkResult[] {
  ensureDir()
  const file = path.join(RESULTS_DIR, `${module}.json`)
  if (!existsSync(file)) return []
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BenchmarkResult[]
  } catch {
    return []
  }
}

/** Runs a benchmark, saves results, returns stats. */
export function runBench(
  name: string,
  module: string,
  iterations: number,
  fn: () => void,
): BenchmarkResult {
  const warmup = Math.min(1000, Math.max(100, Math.floor(iterations / 10)))
  for (let i = 0; i < warmup; i++) fn()

  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const totalMs = performance.now() - start

  const result: BenchmarkResult = {
    name,
    module,
    timestamp: Date.now(),
    date: new Date().toISOString(),
    iterations,
    totalMs,
    perOpMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  }

  saveBenchmark(result)
  return result
}

/** Print a single benchmark result as a visual table row. */
export function printBenchResult(result: BenchmarkResult): void {
  const bar = opsBar(result.opsPerSec)
  console.log(`\n  ┌─ ${result.name}`)
  console.log(`  │  iterations : ${result.iterations.toLocaleString()}`)
  console.log(`  │  total      : ${result.totalMs.toFixed(2)}ms`)
  console.log(`  │  per op     : ${result.perOpMs.toFixed(4)}ms`)
  console.log(`  │  ops/sec    : ${result.opsPerSec.toFixed(0).padStart(12)}  ${bar}`)
  console.log(`  └─`)
}

/** Print comparison of all historical runs for a module. */
export function compareBenchmarks(module: string): void {
  const results = loadBenchmarks(module)
  if (results.length === 0) {
    console.log(`  (no saved benchmarks for ${module})`)
    return
  }

  const byName = new Map<string, BenchmarkResult[]>()
  for (const r of results) {
    const arr = byName.get(r.name) ?? []
    arr.push(r)
    byName.set(r.name, arr)
  }

  console.log(`\n  ┌─────────────────────────────────────────────────────────`)
  console.log(`  │  📈  Benchmark history: ${module}`)
  console.log(`  ├─────────────────────────────────────────────────────────`)

  for (const [name, runs] of byName) {
    if (runs.length === 0) continue
    const latest = runs[runs.length - 1]!
    if (runs.length === 1) {
      console.log(`  │  ${name.padEnd(36)} ${latest.opsPerSec.toFixed(0).padStart(12)} ops/s  (first run)`)
      continue
    }
    const prev = runs[runs.length - 2]!
    const delta = ((latest.opsPerSec - prev.opsPerSec) / prev.opsPerSec) * 100
    const arrow = delta > 1 ? "▲" : delta < -1 ? "▼" : "●"
    const sign = delta > 0 ? "+" : ""
    console.log(
      `  │  ${name.padEnd(36)} ${latest.opsPerSec.toFixed(0).padStart(12)} ops/s  ${arrow} ${sign}${delta.toFixed(1)}%`,
    )
  }
  console.log(`  └─────────────────────────────────────────────────────────`)
}

/** Print a visual report comparing multiple modules side-by-side. */
export function printBenchReport(modules: string[]): void {
  console.log(`\n  ╔═════════════════════════════════════════════════════════╗`)
  console.log(`  ║  Benchmark Report — ${new Date().toLocaleString().padEnd(34)}║`)
  console.log(`  ╠═════════════════════════════════════════════════════════╣`)
  for (const module of modules) {
    const results = loadBenchmarks(module)
    const latest = new Map<string, BenchmarkResult>()
    for (const r of results) latest.set(r.name, r)
    if (latest.size === 0) continue
    console.log(`  ║  ${module}`)
    for (const r of latest.values()) {
      const bar = opsBar(r.opsPerSec, 20)
      console.log(`  ║    ${r.name.padEnd(32)} ${r.opsPerSec.toFixed(0).padStart(10)} ops/s  ${bar}`)
    }
    console.log(`  ╠─────────────────────────────────────────────────────────╣`)
  }
  console.log(`  ╚═════════════════════════════════════════════════════════╝`)
}

function opsBar(opsPerSec: number, width = 15): string {
  const scales = [1e9, 1e8, 1e7, 1e6, 1e5, 1e4, 1e3, 100, 10, 1]
  const scale = scales.find((s) => opsPerSec >= s) ?? 1
  const filled = Math.round((opsPerSec / scale / 10) * width)
  const bar = "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(0, width - filled))
  return `[${bar}]`
}
