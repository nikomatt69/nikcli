import { readFileSync, existsSync } from "fs"
import path from "path"

export type Primitive = string | number | boolean | null
export type MetadataValue = Primitive | Array<Primitive> | { [key: string]: MetadataValue }
export type BenchmarkUnit = "ms" | "bytes" | "count" | "ratio" | "score" | "value"

export interface BenchmarkRecord {
  runId: string
  timestamp: string
  suite: string
  module: string
  scenario: string
  iterations: number
  value: number
  unit: BenchmarkUnit
  valuePerIteration?: number
  metadata?: Record<string, MetadataValue>
}

export interface StoredBenchmarkRun {
  runId: string
  createdAt: string
  records: BenchmarkRecord[]
}

export interface BenchmarkComparison {
  baseRunId: string
  currentRunId: string
  rows: {
    suite: string
    module: string
    scenario: string
    unit: string
    iterations: number
    baseline: number
    current: number
    delta: number
    deltaPercent: number
  }[]
}

export type LegacyBenchResult = {
  name: string
  module: string
  timestamp: number
  date: string
  iterations: number
  totalMs: number
  perOpMs: number
  opsPerSec: number
}

export type BenchmarkRunFile = {
  run?: StoredBenchmarkRun
  comparison?: BenchmarkComparison
  exportedAt?: string
}

export interface LoadedRun {
  filePath: string
  fileName: string
  exportedAt: string
  run: StoredBenchmarkRun
  comparison?: BenchmarkComparison
  deltaVsBaseline?: number
}

export type ViewMode = "suite" | "compare" | "leaderboard" | "detail" | "files"
export type SortMode = "value" | "module" | "name" | "delta" | "trend"
export type RunnerState = "idle" | "running" | "success" | "error"
export type FocusPane = "runs" | "main" | "detail" | "logs" | "filter" | "tree"
export type AlertSeverity = "info" | "warning" | "error" | "critical"
export type TrendDirection = "up" | "down" | "stable"
export type CompareMode = "active" | "explicit"
export type ThemeMode = "dark" | "light" | "auto"
export type TestKey = string

export interface TestIndex {
  key: TestKey
  suite: string
  module: string
  scenario: string
  unit: string
  runValues: Map<
    string,
    {
      value: number
      iterations: number
      timestamp?: string
      metadata?: Record<string, MetadataValue>
    }
  >
  runs: string[]
  bestRun: string | null
  bestValue: number
  worstValue: number
  avgValue: number
  medianValue: number
  p95Value: number
  stdDev: number
  count: number
  trend: TrendDirection
  trendConfidence: number
  regressionWarnings: string[]
}

export type RunIndex = Map<TestKey, TestIndex>

export interface CompareResult {
  key: TestKey
  suite: string
  module: string
  scenario: string
  unit: string
  leftValue: number
  rightValue: number
  delta: number
  deltaPercent: number
  leftIsBetter: boolean
  severity: "critical" | "regression" | "improvement" | "neutral"
}

export interface TestCaseEntry {
  name: string
  kind: "describe" | "test" | "benchmark"
  line: number
  mode: "normal" | "only" | "skip" | "todo" | "concurrent" | "failing" | "each"
  caseCount?: number
}

export interface TestFileEntry {
  filePath: string
  fileName: string
  relativePath: string
  lastModified: number
  size: number
  hasBenchmarks: boolean
  benchmarkCount: number
  testCount: number
  declarationCount: number
  unresolvedEachCount: number
  tests: TestCaseEntry[]
}

export interface Alert {
  id: string
  severity: AlertSeverity
  message: string
  detail?: string
  timestamp: number
  source: string
  dismissed?: boolean
}

export interface BenchConfig {
  refreshInterval: number
  autoBaseline: boolean
  showTrendLines: boolean
  compactMode: boolean
  colorScheme: ThemeMode
  telemetryEnabled: boolean
  telemetryEndpoint: string
  pageSize: number
  maxLogLines: number
  logPanelHeight: number
  sidebarWidth: number
  detailPanelWidth: number
  deltaThreshold: number
  regressionThreshold: number
}

export interface RunStatistics {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
  p5: number
  p25: number
  p75: number
  p95: number
  count: number
  sum: number
}

export interface TrendAnalysis {
  direction: TrendDirection
  slope: number
  intercept: number
  rSquared: number
  confidence: number
  warnings: string[]
}

export const TARGET_PACKAGE_ROOT = path.resolve(
  process.env.BENCH_TUI_TARGET_PACKAGE ?? path.resolve(import.meta.dir, "../../nikcli"),
)
export const TARGET_TEST_DIR = path.join(TARGET_PACKAGE_ROOT, "test")
export const TARGET_PACKAGE_NAME = (() => {
  try {
    const parsed = JSON.parse(readFileSync(path.join(TARGET_PACKAGE_ROOT, "package.json"), "utf8")) as { name?: string }
    return parsed.name ?? path.basename(TARGET_PACKAGE_ROOT)
  } catch {
    return path.basename(TARGET_PACKAGE_ROOT)
  }
})()
export const TARGET_PACKAGE_READY =
  existsSync(path.join(TARGET_PACKAGE_ROOT, "package.json")) && existsSync(TARGET_TEST_DIR)
export const OUTPUT_DIR =
  process.env.NIKCLI_BENCHMARK_OUTPUT_DIR ?? path.join(TARGET_PACKAGE_ROOT, "test", "benchmarks", "runs")
export const LEGACY_DIR = path.join(TARGET_PACKAGE_ROOT, "test", "bench", "results")
export const USER_ARGS = process.argv.slice(2).filter((a) => a !== "--")
export const TEST_PATTERNS = USER_ARGS.length > 0 ? USER_ARGS : ["test/benchmarks/**/*.benchmark.test.ts"]

const DEFAULT_CONFIG: BenchConfig = {
  refreshInterval: 5000,
  autoBaseline: false,
  showTrendLines: true,
  compactMode: false,
  colorScheme: "dark",
  telemetryEnabled: false,
  telemetryEndpoint: "http://localhost:4317",
  pageSize: 12,
  maxLogLines: 100,
  logPanelHeight: 6,
  sidebarWidth: 20,
  detailPanelWidth: 36,
  deltaThreshold: 1,
  regressionThreshold: 5,
}

export function loadConfig(): BenchConfig {
  try {
    const envPath = process.env.BENCH_TUI_CONFIG
    if (envPath && existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8")
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) }
    }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function fmt(v: number, d = 2): string {
  if (!Number.isFinite(v)) return "0"
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toFixed(d)
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m${s.toString().padStart(2, "0")}s`
}

export function pct(part: number, total: number): number {
  return total > 0 ? part / total : 0
}

export function fmtDelta(v: number): string {
  const prefix = v >= 0 ? "+" : ""
  if (Math.abs(v) >= 100) return `${prefix}${v.toFixed(0)}%`
  if (Math.abs(v) >= 10) return `${prefix}${v.toFixed(1)}%`
  return `${prefix}${v.toFixed(2)}%`
}

export function short(s: string, max: number): string {
  if (max <= 0) return ""
  if (max === 1) return s.length <= 1 ? s : "\u2026"
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026"
}

export function testKey(r: BenchmarkRecord): TestKey {
  return `${r.suite}::${r.module}::${r.scenario}::${r.unit}`
}

export function relativeTime(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime()
    const s = Math.floor(diff / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d}d`
    const mo = Math.floor(d / 30)
    return `${mo}mo`
  } catch {
    return "?"
  }
}

export function trendIcon(t: TrendDirection): string {
  return t === "up" ? "\u2191" : t === "down" ? "\u2193" : "\u2192"
}

export function lowerIsBetter(unit: string): boolean {
  return unit === "ms" || unit === "bytes" || unit === "value"
}

export function compareSeverity(deltaPercent: number, unit = "ms"): CompareResult["severity"] {
  const worsePercent = lowerIsBetter(unit) ? deltaPercent : -deltaPercent
  if (worsePercent >= 10) return "critical"
  if (worsePercent >= 5) return "regression"
  if (worsePercent <= -1) return "improvement"
  return "neutral"
}

// ============================================================
// Test Suite Management (covers ALL test/**/*.test.ts files)
// ============================================================

export type SuiteExecStatus = "pass" | "fail" | "skip" | "running" | "notrun" | "mixed" | "todo"

export interface SuiteCaseResult {
  name: string
  status: "pass" | "fail" | "skip" | "todo"
  durationMs?: number
  errorMessage?: string
}

export interface SuiteRunResult {
  filePath: string
  relativePath: string
  runId: string
  startedAt: number
  durationMs: number
  status: SuiteExecStatus
  exitCode: number
  totalTests: number
  passed: number
  failed: number
  skipped: number
  todo: number
  cases: SuiteCaseResult[]
  errorOutput?: string
}

export interface SuiteFileState {
  filePath: string
  relativePath: string
  fileName: string
  group: string
  lastRun?: SuiteRunResult
  history: SuiteRunResult[]
}

export interface SuiteGroupState {
  name: string
  files: SuiteFileState[]
  expanded: boolean
  totalFiles: number
  passingFiles: number
  failingFiles: number
  notRunFiles: number
  runningFiles: number
}

export type SuiteSortMode = "name" | "status" | "duration" | "lastRun" | "group"

const TARGET_HISTORY_KEY = TARGET_PACKAGE_ROOT.replace(/[^a-zA-Z0-9._-]+/g, "_")
export const SUITE_HISTORY_DIR = path.join(process.env.HOME ?? "/tmp", ".bench-tui", TARGET_HISTORY_KEY, "suite-history")
export const SUITE_HISTORY_MAX_PER_FILE = 25

export function groupForRelative(rel: string): string {
  const seg = rel.split("/")[0] ?? "root"
  if (seg.endsWith(".test.ts")) return "_root"
  return seg
}

export function suiteStatusIcon(status: SuiteExecStatus): string {
  switch (status) {
    case "pass":
      return "✓"
    case "fail":
      return "✗"
    case "running":
      return "●"
    case "skip":
      return "○"
    case "todo":
      return "◇"
    case "mixed":
      return "◔"
    case "notrun":
    default:
      return "·"
  }
}

export function suiteStatusLabel(status: SuiteExecStatus): string {
  switch (status) {
    case "pass":
      return "PASS"
    case "fail":
      return "FAIL"
    case "running":
      return "RUN "
    case "skip":
      return "SKIP"
    case "todo":
      return "TODO"
    case "mixed":
      return "MIX "
    case "notrun":
    default:
      return "----"
  }
}

export function computeRunStatistics(values: number[]): RunStatistics {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const sum = sorted.reduce((s, v) => s + v, 0)
  const mean = sum / n
  const stdDev = n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n) : 0
  return {
    mean,
    median: n % 2 === 0 ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2 : sorted[Math.floor(n / 2)]!,
    stdDev,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    p5: sorted[Math.max(0, Math.round(n * 0.05))]!,
    p25: sorted[Math.max(0, Math.round(n * 0.25))]!,
    p75: sorted[Math.min(n - 1, Math.round(n * 0.75))]!,
    p95: sorted[Math.min(n - 1, Math.round(n * 0.95))]!,
    count: n,
    sum,
  }
}
