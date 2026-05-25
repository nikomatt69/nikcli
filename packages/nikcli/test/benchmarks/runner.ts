import fs from "fs/promises"
import path from "path"

type Primitive = string | number | boolean | null
type MetadataValue = Primitive | Array<Primitive> | { [key: string]: MetadataValue }
type BenchmarkUnit = "ms" | "bytes" | "count" | "ratio" | "score" | "value"

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

interface VisualArtifact {
  suite: string
  module: string
  scenario: string
  extension: string
  filename: string
  content: string
}

interface BenchmarkStore {
  runId: string
  createdAt: string
  records: BenchmarkRecord[]
  visuals: VisualArtifact[]
  flushed: boolean
  flushingPromise: Promise<void> | null
}

const STORE_KEY = "__nikcliBenchmarkStore__"
const OUTPUT_DIR = process.env.NIKCLI_BENCHMARK_OUTPUT_DIR ?? path.join(process.cwd(), "test", "benchmarks", "runs")
const SAVE_BENCHMARKS = process.env.NIKCLI_BENCHMARK_SAVE === "1"
const BASELINE_PATH = process.env.NIKCLI_BENCHMARK_BASELINE_PATH

function getStore(): BenchmarkStore {
  const root = globalThis as Record<string, unknown>
  if (!root[STORE_KEY]) {
    root[STORE_KEY] = {
      runId: process.env.NIKCLI_BENCHMARK_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-"),
      createdAt: new Date().toISOString(),
      records: [],
      visuals: [],
      flushed: false,
      flushingPromise: null,
    } satisfies BenchmarkStore
  }
  return root[STORE_KEY] as BenchmarkStore
}

function normalizeMetadata(value: unknown): Record<string, MetadataValue> {
  if (!value || typeof value !== "object") return {}
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, MetadataValue>
  } catch {
    return {}
  }
}

function sanitizeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

function keyOf(record: BenchmarkRecord) {
  return `${record.suite}::${record.module}::${record.scenario}::${record.unit}`
}

function safeNumber(value: number) {
  return Number.isFinite(value) ? value : 0
}

function callerLocation(): { sourceFile?: string; sourceLine?: number; sourceColumn?: number } {
  const stack = new Error().stack
  if (!stack) return {}
  const runnerPath = "test/benchmarks/runner.ts"
  for (const line of stack.split("\n")) {
    if (line.includes(runnerPath) || !line.includes("/test/")) continue
    const match = line.match(/\((.*):(\d+):(\d+)\)$/) ?? line.match(/at (.*):(\d+):(\d+)$/)
    if (!match) continue
    return {
      sourceFile: path.relative(process.cwd(), match[1] ?? "").replace(/\\/g, "/"),
      sourceLine: Number(match[2]),
      sourceColumn: Number(match[3]),
    }
  }
  return {}
}

export function recordBenchmark(input: Omit<BenchmarkRecord, "runId" | "timestamp">) {
  const store = getStore()
  const iterations = Math.max(1, Math.trunc(input.iterations))
  const value = safeNumber(input.value)
  const valuePerIteration = iterations > 0 ? value / iterations : value
  const source = callerLocation()

  store.records.push({
    runId: store.runId,
    timestamp: new Date().toISOString(),
    suite: input.suite,
    module: input.module,
    scenario: input.scenario,
    iterations,
    value,
    unit: input.unit,
    valuePerIteration,
    metadata: normalizeMetadata({ ...source, ...(input.metadata ?? {}) }),
  })
  store.flushed = false
}

export function recordVisualArtifact(input: {
  suite: string
  module: string
  scenario: string
  content: string
  extension?: "json" | "txt" | "md"
}) {
  const store = getStore()
  const extension = input.extension ?? "txt"
  const count = store.visuals.filter(
    (item) => item.suite === input.suite && item.module === input.module && item.scenario === input.scenario,
  ).length
  const filename =
    `${sanitizeSlug(input.suite)}__${sanitizeSlug(input.module)}__${sanitizeSlug(input.scenario)}__${String(count + 1).padStart(
      4,
      "0",
    )}.${extension}`

  store.visuals.push({
    suite: input.suite,
    module: input.module,
    scenario: input.scenario,
    extension,
    filename,
    content: input.content,
  })
  store.flushed = false
}

function renderCell(value: number | string | null) {
  return `<td style="padding: 4px 8px; border: 1px solid #d4d8e3;">${value ?? ""}</td>`
}

function renderRows(records: BenchmarkRecord[]) {
  const sorted = [...records].sort((a, b) => {
    if (a.suite !== b.suite) return a.suite.localeCompare(b.suite)
    if (a.module !== b.module) return a.module.localeCompare(b.module)
    return a.scenario.localeCompare(b.scenario)
  })

  const maxMs = Math.max(...sorted.filter((record) => record.unit === "ms").map((record) => record.value), 1)
  const rows = sorted.map((record) => {
    const normalizedMs = record.unit === "ms" ? Math.round((record.value / maxMs) * 180) : 20
    const value = `${record.value.toFixed(2)} ${record.unit}`
    const perIteration = record.valuePerIteration
      ? `${record.valuePerIteration.toFixed(4)} ${record.unit}/iter`
      : "n/a"
    return `<tr>
      ${renderCell(record.timestamp)}
      ${renderCell(record.suite)}
      ${renderCell(record.module)}
      ${renderCell(record.scenario)}
      ${renderCell(String(record.iterations))}
      ${renderCell(value)}
      ${renderCell(perIteration)}
      <td style="padding: 4px 8px; border: 1px solid #d4d8e3;">
        <div style="width:${normalizedMs}px; height: 10px; background: #8b5cf6; border-radius: 6px;"></div>
      </td>
    </tr>`
  })

  return rows.join("\n")
}

function renderComparisonRows(comparison: BenchmarkComparison) {
  const sorted = [...comparison.rows].sort((a, b) => {
    if (a.suite !== b.suite) return a.suite.localeCompare(b.suite)
    if (a.module !== b.module) return a.module.localeCompare(b.module)
    return a.scenario.localeCompare(b.scenario)
  })

  const rows = sorted.map((item) => {
    const trend =
      item.delta > 0
        ? `<span style="color:#ef4444;">+${item.delta.toFixed(2)}</span>`
        : `<span style="color:#22c55e;">${item.delta.toFixed(2)}</span>`
    const deltaPercent = `${item.deltaPercent.toFixed(2)}%`
    return `<tr>
      ${renderCell(item.suite)}
      ${renderCell(item.module)}
      ${renderCell(item.scenario)}
      ${renderCell(item.unit)}
      ${renderCell(String(item.iterations))}
      ${renderCell(item.baseline.toFixed(2))}
      ${renderCell(item.current.toFixed(2))}
      ${renderCell(trend)}
      ${renderCell(deltaPercent)}
    </tr>`
  })

  return rows.join("\n")
}

export async function readBenchmarkRun(filePath: string): Promise<StoredBenchmarkRun | null> {
  try {
    const content = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(content) as {
      runId?: string
      createdAt?: string
      records?: BenchmarkRecord[]
      run?: { runId?: string; createdAt?: string; records?: BenchmarkRecord[] }
    }
    // support both the wrapped format { run: {...} } and the legacy flat format
    const data = parsed.run ?? parsed
    if (!data.runId || !Array.isArray(data.records)) return null
    return {
      runId: data.runId,
      createdAt: data.createdAt ?? new Date().toISOString(),
      records: data.records,
    }
  } catch {
    return null
  }
}

export function compareBenchmarkRuns(current: StoredBenchmarkRun, baseline: StoredBenchmarkRun): BenchmarkComparison {
  const baselineMap = new Map<string, BenchmarkRecord>()
  for (const record of baseline.records) {
    baselineMap.set(keyOf(record), record)
  }

  const rows: BenchmarkComparison["rows"] = []
  for (const record of current.records) {
    const base = baselineMap.get(keyOf(record))
    if (!base) continue

    const delta = record.value - base.value
    const deltaPercent = base.value === 0 ? 0 : (delta / base.value) * 100
    rows.push({
      suite: record.suite,
      module: record.module,
      scenario: record.scenario,
      unit: record.unit,
      iterations: record.iterations,
      baseline: base.value,
      current: record.value,
      delta,
      deltaPercent,
    })
  }

  return {
    baseRunId: baseline.runId,
    currentRunId: current.runId,
    rows,
  }
}

function renderHtml(run: StoredBenchmarkRun, comparison?: BenchmarkComparison) {
  const visualRows = run.records.flatMap((record) =>
    record.metadata?.["visualPath"] && typeof record.metadata.visualPath === "string"
      ? [
          `<tr>
             <td style="padding: 4px 8px; border: 1px solid #d4d8e3;">${record.suite}</td>
             <td style="padding: 4px 8px; border: 1px solid #d4d8e3;">${record.module}</td>
             <td style="padding: 4px 8px; border: 1px solid #d4d8e3;">${record.scenario}</td>
             <td style="padding: 4px 8px; border: 1px solid #d4d8e3;"><a href="${record.metadata.visualPath}" target="_blank">open</a></td>
           </tr>`,
        ]
      : [],
  )

  const comparisonBlock = comparison
    ? `<h2>Comparison with baseline ${comparison.baseRunId}</h2>
       <table style="border-collapse:collapse; width:100%; margin-top: 20px;">
         <thead>
           <tr>
             ${renderCell("suite")}
             ${renderCell("module")}
             ${renderCell("scenario")}
             ${renderCell("unit")}
             ${renderCell("iterations")}
             ${renderCell("baseline")}
             ${renderCell("current")}
             ${renderCell("delta")}
             ${renderCell("delta %")}
           </tr>
         </thead>
         <tbody>
           ${renderComparisonRows(comparison)}
         </tbody>
       </table>`
    : ""

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Benchmark Run ${run.runId}</title>
  </head>
  <body style="font-family: Inter, Arial, sans-serif; padding: 24px; color:#0f172a;">
    <h1>Benchmark Run ${run.runId}</h1>
    <p>Created: ${run.createdAt}</p>
    <p>Records: ${run.records.length}</p>
    <p>Visual artifacts: ${visualRows.length}</p>
    <table style="border-collapse:collapse; width:100%; font-size:13px;">
      <thead>
        <tr>
          ${renderCell("timestamp")}
          ${renderCell("suite")}
          ${renderCell("module")}
          ${renderCell("scenario")}
          ${renderCell("iterations")}
          ${renderCell("value")}
          ${renderCell("value / iter")}
          ${renderCell("trend")}
        </tr>
      </thead>
      <tbody>
        ${renderRows(run.records)}
      </tbody>
    </table>
    ${comparisonBlock}
    ${
      visualRows.length > 0
        ? `<h2>Linked Visual Artifacts</h2>
            <table style="border-collapse:collapse; width:100%; font-size:13px;">
              <thead>
                <tr>
                  ${renderCell("suite")}
                  ${renderCell("module")}
                  ${renderCell("scenario")}
                  ${renderCell("artifact")}
                </tr>
              </thead>
              <tbody>${visualRows.join("\n")}</tbody>
            </table>`
        : ""
    }
  </body>
</html>`
}

export async function flushBenchmarkRun() {
  const store = getStore()
  if (store.records.length === 0 && store.visuals.length === 0) return
  if (store.flushed) return
  if (!SAVE_BENCHMARKS && !BASELINE_PATH && process.env.NIKCLI_BENCHMARK_COMPARE !== "1") return
  if (store.flushingPromise) await store.flushingPromise

  if (store.flushingPromise) return
  const promise = (async () => {
    try {
      await fs.mkdir(OUTPUT_DIR, { recursive: true })
      await fs.mkdir(path.join(OUTPUT_DIR, "visual", store.runId), { recursive: true })

      let comparison: BenchmarkComparison | undefined
      if (BASELINE_PATH) {
        const baseline = await readBenchmarkRun(BASELINE_PATH)
        if (baseline) {
          comparison = compareBenchmarkRuns({ ...store }, baseline)
        }
      }

      const runData: StoredBenchmarkRun = {
        runId: store.runId,
        createdAt: store.createdAt,
        records: store.records,
      }

      for (const visual of store.visuals) {
        const visualPath = path.join(OUTPUT_DIR, "visual", store.runId, visual.filename)
        await fs.writeFile(visualPath, visual.content, "utf8")
        for (const record of store.records) {
          if (record.suite === visual.suite && record.module === visual.module && record.scenario === visual.scenario) {
            record.metadata = {
              ...(record.metadata ?? {}),
              visualPath: `visual/${store.runId}/${visual.filename}`,
            }
          }
        }
      }

      const output = {
        run: runData,
        comparison,
        exportedAt: new Date().toISOString(),
      }

      await fs.writeFile(path.join(OUTPUT_DIR, `${store.runId}.json`), JSON.stringify(output, null, 2), "utf8")
      await fs.writeFile(path.join(OUTPUT_DIR, `${store.runId}.html`), renderHtml(runData, comparison), "utf8")
      store.flushed = true
    } finally {
      store.flushingPromise = null
    }
  })()
  store.flushingPromise = promise
  await promise
}
