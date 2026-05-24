import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type BenchSample = {
  suite: string
  name: string
  iterations?: number
  durationMs: number
  opsPerSec?: number
  metadata?: Record<string, unknown>
}

export type BenchRunFile = {
  runId: string
  timestamp: number
  meta?: Record<string, unknown>
  samples: BenchSample[]
}

const samples: BenchSample[] = []

export function recordBenchSample(sample: BenchSample) {
  samples.push({ ...sample })
}

export function clearBenchSamples() {
  samples.length = 0
}

export function peekBenchSamples(): readonly BenchSample[] {
  return samples
}

export function defaultBenchOutDir() {
  return path.join(__dirname, "../bench-results")
}

export async function flushBenchRunToFile(filePath: string, meta?: Record<string, unknown>) {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const run: BenchRunFile = {
    runId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    meta,
    samples: [...samples],
  }
  await fs.writeFile(filePath, JSON.stringify(run, null, 2), "utf8")
}

export function renderHtmlCompare(baselineJson: string, currentJson: string): string {
  const base = JSON.parse(baselineJson) as BenchRunFile
  const cur = JSON.parse(currentJson) as BenchRunFile
  const keyOf = (s: BenchSample) => `${s.suite}::${s.name}`
  const baseMap = new Map(base.samples.map((s) => [keyOf(s), s]))
  const rows: string[] = []
  for (const s of cur.samples) {
    const k = keyOf(s)
    const b = baseMap.get(k)
    const ratio = b && b.durationMs > 0 ? (s.durationMs / b.durationMs - 1) * 100 : null
    const ratioCell = ratio === null ? "—" : `${ratio >= 0 ? "+" : ""}${ratio.toFixed(1)}% vs baseline`
    rows.push(`<tr>
  <td>${escapeHtml(s.suite)}</td>
  <td>${escapeHtml(s.name)}</td>
  <td class="num">${s.durationMs.toFixed(3)}</td>
  <td class="num">${b ? b.durationMs.toFixed(3) : "—"}</td>
  <td>${ratioCell}</td>
</tr>`)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Bench compare</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #111; }
    h1 { font-size: 1.1rem; }
    table { border-collapse: collapse; width: 100%; max-width: 56rem; }
    th, td { border: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: left; }
    th { background: #f4f4f4; }
    .num { font-variant-numeric: tabular-nums; }
    .meta { color: #555; font-size: 0.85rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>Benchmark comparison</h1>
  <p class="meta">Baseline run <code>${escapeHtml(base.runId)}</code> (${new Date(base.timestamp).toISOString()})
    → Current <code>${escapeHtml(cur.runId)}</code> (${new Date(cur.timestamp).toISOString()})</p>
  <table>
    <thead><tr><th>Suite</th><th>Name</th><th>Current ms</th><th>Baseline ms</th><th>Delta</th></tr></thead>
    <tbody>
${rows.join("\n")}
    </tbody>
  </table>
</body>
</html>`
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
