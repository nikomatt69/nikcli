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
  currentFile: string
}

const STORE_KEY = "__nikcliBenchmarkStore__"
const OUTPUT_DIR = process.env.NIKCLI_BENCHMARK_OUTPUT_DIR ?? path.join(process.cwd(), "test", "benchmarks", "runs")

// Use getter functions to check env vars at call time (not module load time)
// This allows preload.ts to set env vars before flushBenchmarkRun is called
function shouldSaveBenchmarks() {
  return process.env.NIKCLI_BENCHMARK_SAVE === "1"
}
function getBaselinePath() {
  return process.env.NIKCLI_BENCHMARK_BASELINE_PATH
}
function shouldPerFileRuns() {
  return process.env.NIKCLI_BENCHMARK_PER_FILE === "1"
}

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
      currentFile: "unknown",
    } satisfies BenchmarkStore
  }
  return root[STORE_KEY] as BenchmarkStore
}

/**
 * Creates a new benchmark run for the current test file.
 * Call this at the start of each test file to generate separate runs per file.
 * @param fileName Optional file name (will be auto-detected if not provided)
 */
export function beginBenchmarkRun(fileName?: string): string {
  const store = getStore()
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

  let currentFile = fileName ?? "unknown"

  // If no file name provided, try to detect from stack trace
  if (!fileName) {
    const stack = new Error().stack ?? ""
    // Match test file patterns
    const testFileMatch = stack.match(/\/test\/[^\s()]+\.test\.ts/) ?? stack.match(/[\\/]test[\\/][^\s()]+\.test\.ts/)
    if (testFileMatch) {
      currentFile = testFileMatch[0].replace(/^\//, "").replace(/\\/g, "/")
    }
  }

  // Use only the filename (basename) for the slug to keep names clean
  const fileBasename = path.basename(currentFile, ".ts")
  const fileSlug = fileBasename

  store.runId = `${timestamp}__${fileSlug}`
  store.createdAt = new Date().toISOString()
  store.records = []
  store.visuals = []
  store.flushed = false
  store.flushingPromise = null
  store.currentFile = currentFile

  return store.runId
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
  const preloadPath = "test/preload.ts"
  for (const line of stack.split("\n")) {
    if (line.includes(runnerPath) || line.includes(preloadPath) || !line.includes("/test/")) continue
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
  const caller = callerLocation()

  // Use store's currentFile as sourceFile if caller didn't find one
  const sourceFile = caller.sourceFile ?? store.currentFile

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
    metadata: normalizeMetadata({ sourceFile, ...caller, ...input.metadata }),
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
  const filename = `${sanitizeSlug(input.suite)}__${sanitizeSlug(input.module)}__${sanitizeSlug(input.scenario)}__${String(
    count + 1,
  ).padStart(4, "0")}.${extension}`

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
    const perIteration = record.valuePerIteration ? `${record.valuePerIteration.toFixed(4)} ${record.unit}/iter` : "n/a"
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
  const SAVE_BENCHMARKS = shouldSaveBenchmarks()
  const BASELINE_PATH = getBaselinePath()
  const PER_FILE_RUNS = shouldPerFileRuns()

  if (store.records.length === 0 && store.visuals.length === 0) return
  if (store.flushed) return
  if (!SAVE_BENCHMARKS && !BASELINE_PATH && process.env.NIKCLI_BENCHMARK_COMPARE !== "1") return
  if (store.flushingPromise) await store.flushingPromise

  if (store.flushingPromise) return
  const promise = (async () => {
    try {
      await fs.mkdir(OUTPUT_DIR, { recursive: true })

      // Group records by test file when PER_FILE_RUNS is enabled
      if (PER_FILE_RUNS) {
        const recordsByFile = new Map<string, BenchmarkRecord[]>()
        const visualsByFile = new Map<string, VisualArtifact[]>()

        for (const record of store.records) {
          const sourceFile = record.metadata?.["sourceFile"] as string | undefined
          const fileKey = sourceFile ?? "unknown"
          if (!recordsByFile.has(fileKey)) recordsByFile.set(fileKey, [])
          recordsByFile.get(fileKey)!.push(record)
        }

        for (const visual of store.visuals) {
          const fileKey = `${visual.suite}/${visual.module}`
          if (!visualsByFile.has(fileKey)) visualsByFile.set(fileKey, [])
          visualsByFile.get(fileKey)!.push(visual)
        }

        // Write separate run file for each test file
        for (const [fileKey, records] of recordsByFile) {
          // Use store's currentFile basename to keep naming consistent
          const fileSlug = path.basename(store.currentFile, ".ts")
          // Extract timestamp from store.runId (format: timestamp__fileSlug)
          const timestamp = store.runId.split("__")[0] ?? new Date().toISOString().replace(/[:.]/g, "-")
          const runId = `${timestamp}__${fileSlug}`
          await fs.mkdir(path.join(OUTPUT_DIR, "visual", runId), { recursive: true })

          const visuals = visualsByFile.get(fileKey) ?? []
          for (const visual of visuals) {
            const visualPath = path.join(OUTPUT_DIR, "visual", runId, visual.filename)
            await fs.writeFile(visualPath, visual.content, "utf8")
          }

          const runData: StoredBenchmarkRun = {
            runId,
            createdAt: store.createdAt,
            records,
          }

          let comparison: BenchmarkComparison | undefined
          if (BASELINE_PATH) {
            const baseline = await readBenchmarkRun(BASELINE_PATH)
            if (baseline) {
              // Filter baseline records to matching file
              const filteredBaseline = {
                ...baseline,
                records: baseline.records.filter((r) => {
                  const src = r.metadata?.["sourceFile"] as string | undefined
                  return src === fileKey
                }),
              }
              if (filteredBaseline.records.length > 0) {
                comparison = compareBenchmarkRuns(runData, filteredBaseline)
              }
            }
          }

          const output = { run: runData, comparison, exportedAt: new Date().toISOString() }
          await fs.writeFile(path.join(OUTPUT_DIR, `${runId}.json`), JSON.stringify(output, null, 2), "utf8")
          await fs.writeFile(path.join(OUTPUT_DIR, `${runId}.html`), renderHtml(runData, comparison), "utf8")
        }
      } else {
        // Original behavior: single run file
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
            if (
              record.suite === visual.suite &&
              record.module === visual.module &&
              record.scenario === visual.scenario
            ) {
              record.metadata = {
                ...record.metadata,
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
      }
      store.flushed = true
    } finally {
      store.flushingPromise = null
    }
  })()
  store.flushingPromise = promise
  await promise
}
