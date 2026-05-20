#!/usr/bin/env bun
/**
 * Visual benchmark dashboard for nikcli test suites.
 *
 * Usage:
 *   bun run test:bench:tui                        # run all benchmarks + view
 *   bun run test:bench:tui -- test/util/*.test.ts  # run specific patterns
 *
 * Keys:
 *   r   Run benchmarks
 *   u   Refresh saved runs
 *   h/l Switch between runs
 *   j/k Navigate records
 *   a   Toggle sort (by value / by module / by name)
 *   q   Quit
 */
import fs from "fs/promises"
import { readdirSync, readFileSync } from "fs"
import path from "path"
import { TextAttributes, RGBA, fg, t } from "@opentui/core"
import { render, useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"

import type { BenchmarkComparison, BenchmarkRecord, StoredBenchmarkRun } from "../test/benchmarks/runner"

// ── old bench runner format ──────────────────────────────────────────────────
type LegacyBenchResult = {
  name: string
  module: string
  timestamp: number
  date: string
  iterations: number
  totalMs: number
  perOpMs: number
  opsPerSec: number
}

// ── data types ───────────────────────────────────────────────────────────────
type BenchmarkRunFile = {
  run?: StoredBenchmarkRun
  comparison?: BenchmarkComparison
  exportedAt?: string
}

type LoadedRun = {
  filePath: string
  fileName: string
  exportedAt: string
  run: StoredBenchmarkRun
  comparison?: BenchmarkComparison
}

type StatsRow = {
  label: string
  value: number
  unit: string
  perIter: number
  iterations: number
  suite: string
  module: string
  scenario: string
}

type SortMode = "value" | "module" | "name"

type RunnerState = "idle" | "running" | "success" | "error"

// ── config ───────────────────────────────────────────────────────────────────
const PKG_ROOT = path.resolve(import.meta.dir, "..")
const OUTPUT_DIR = process.env.NIKCLI_BENCHMARK_OUTPUT_DIR ?? path.join(PKG_ROOT, "test", "benchmarks", "runs")
const LEGACY_DIR = path.join(PKG_ROOT, "test", "bench", "results")
// args after -- are treated as paths passed to bun test directly
const USER_ARGS = process.argv.slice(2).filter((a) => a !== "--")
const TEST_PATTERNS = USER_ARGS.length > 0 ? USER_ARGS : ["test/benchmarks/**/*.benchmark.test.ts"]

// ── theme ────────────────────────────────────────────────────────────────────
const c = {
  bg: RGBA.fromHex("#0d1117"),
  panel: RGBA.fromHex("#151b23"),
  panelAlt: RGBA.fromHex("#1c2333"),
  border: RGBA.fromHex("#30363d"),
  text: RGBA.fromHex("#e6edf3"),
  dim: RGBA.fromHex("#7d8590"),
  accent: RGBA.fromHex("#3fb950"),
  blue: RGBA.fromHex("#58a6ff"),
  yellow: RGBA.fromHex("#d29922"),
  red: RGBA.fromHex("#f85149"),
  purple: RGBA.fromHex("#bc8cff"),
  cyan: RGBA.fromHex("#39d2c0"),
  orange: RGBA.fromHex("#f0883e"),
}

// ── helpers ──────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function fmt(v: number, d = 2) {
  if (!Number.isFinite(v)) return "0"
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toFixed(d)
}

function short(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026"
}

function bar(value: number, max: number, width: number, fill = "\u2588", empty = "\u2591") {
  if (max <= 0) return empty.repeat(width)
  const n = Math.round((value / max) * width)
  return fill.repeat(Math.min(n, width)).padEnd(width, empty)
}

// ── data loading (sync — opentui needs sync signal updates on mount) ──────────
function listNewRuns(): LoadedRun[] {
  try {
    const entries = readdirSync(OUTPUT_DIR, { withFileTypes: true })
    const runs: LoadedRun[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      const filePath = path.join(OUTPUT_DIR, entry.name)
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as BenchmarkRunFile
        if (!parsed.run?.runId || !Array.isArray(parsed.run.records)) continue
        runs.push({
          filePath,
          fileName: entry.name,
          exportedAt: parsed.exportedAt ?? parsed.run.createdAt,
          run: parsed.run,
          comparison: parsed.comparison,
        })
      } catch {
        continue
      }
    }
    return runs.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
  } catch {
    return []
  }
}

function listLegacyRuns(): LoadedRun[] {
  try {
    const entries = readdirSync(LEGACY_DIR, { withFileTypes: true })
    const mapped: LoadedRun[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      try {
        const results: LegacyBenchResult[] = JSON.parse(readFileSync(path.join(LEGACY_DIR, entry.name), "utf8"))
        if (!Array.isArray(results) || results.length === 0) continue
        const latest = results[results.length - 1]!
        const records: BenchmarkRecord[] = results.map((r) => ({
          runId: latest.date,
          timestamp: r.date,
          suite: "bench",
          module: r.module,
          scenario: r.name,
          iterations: r.iterations,
          value: r.totalMs,
          unit: "ms" as const,
          valuePerIteration: r.perOpMs,
        }))
        mapped.push({
          filePath: path.join(LEGACY_DIR, entry.name),
          fileName: entry.name,
          exportedAt: latest.date,
          run: { runId: latest.date, createdAt: latest.date, records },
        })
      } catch {
        continue
      }
    }
    return mapped.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
  } catch {
    return []
  }
}

function toStatsRows(records: BenchmarkRecord[]): StatsRow[] {
  return records.map((r) => ({
    label: `${r.module} / ${r.scenario}`,
    value: r.value,
    unit: r.unit,
    perIter: r.valuePerIteration ?? r.value / Math.max(1, r.iterations),
    iterations: r.iterations,
    suite: r.suite,
    module: r.module,
    scenario: r.scenario,
  }))
}

function sortRows(rows: StatsRow[], mode: SortMode): StatsRow[] {
  const copy = [...rows]
  if (mode === "value") return copy.sort((a, b) => b.value - a.value)
  if (mode === "module") return copy.sort((a, b) => a.module.localeCompare(b.module) || b.value - a.value)
  return copy.sort((a, b) => a.label.localeCompare(b.label))
}

// ── app ───────────────────────────────────────────────────────────────────────
function App() {
  const dim = useTerminalDimensions()
  const [runs, setRuns] = createSignal<LoadedRun[]>([])
  const [runIdx, setRunIdx] = createSignal(0)
  const [rowIdx, setRowIdx] = createSignal(0)
  const [scrollOff, setScrollOff] = createSignal(0)
  const [state, setState] = createSignal<RunnerState>("idle")
  const [exitCode, setExitCode] = createSignal<number | undefined>()
  const [logLines, setLogLines] = createSignal<string[]>([])
  const [sortMode, setSortMode] = createSignal<SortMode>("value")

  const activeRun = createMemo(() => runs()[runIdx()])
  const allRecords = createMemo(() => activeRun()?.run.records ?? [])
  const rows = createMemo(() => sortRows(toStatsRows(allRecords()), sortMode()))
  const modules = createMemo(() => {
    const map = new Map<string, BenchmarkRecord[]>()
    for (const r of allRecords()) {
      const k = `${r.suite}/${r.module}`
      const arr = map.get(k) ?? []
      arr.push(r)
      map.set(k, arr)
    }
    return [...map.entries()]
      .map(([name, items]) => ({
        name,
        count: items.length,
        totalMs: items.filter((i) => i.unit === "ms").reduce((s, i) => s + i.value, 0),
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
  })
  const maxVal = createMemo(() => Math.max(1, ...rows().map((r) => r.value)))
  const slowMs = createMemo(() =>
    allRecords()
      .filter((r) => r.unit === "ms")
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
  )
  const maxSlow = createMemo(() => Math.max(1, ...slowMs().map((r) => r.value)))
  const compRows = createMemo(() => {
    const comp = activeRun()?.comparison
    if (!comp) return []
    return comp.rows.sort((a, b) => b.deltaPercent - a.deltaPercent).slice(0, 10)
  })
  const maxDelta = createMemo(() => Math.max(1, ...compRows().map((r) => Math.abs(r.deltaPercent))))
  const selected = createMemo(() => rows()[rowIdx()])
  const pageHeight = createMemo(() => Math.max(1, dim().height - 18))
  const visibleRows = createMemo(() => {
    const start = scrollOff()
    return rows().slice(start, start + pageHeight())
  })

  function refresh(): LoadedRun[] {
    const all = [...listNewRuns(), ...listLegacyRuns()]
    setRuns(all)
    setRunIdx((i) => clamp(i, 0, Math.max(0, all.length - 1)))
    setRowIdx(0)
    setScrollOff(0)
    return all
  }

  function appendLog(chunk: string) {
    const lines = chunk.replace(/\r/g, "").split("\n").filter(Boolean)
    if (!lines.length) return
    setLogLines((cur) => [...cur, ...lines].slice(-30))
  }

  async function pipeOutput(stream: ReadableStream<Uint8Array> | null) {
    if (!stream) return
    const reader = stream.getReader()
    const dec = new TextDecoder()
    while (true) {
      const r = await reader.read()
      if (r.done) break
      appendLog(dec.decode(r.value, { stream: true }))
    }
  }

  async function runBenchmarks() {
    if (state() === "running") return
    const runId = new Date().toISOString().replace(/[:.]/g, "-")
    setState("running")
    setExitCode(undefined)
    const cmd =
      USER_ARGS.length > 0 ? [process.execPath, "test", ...TEST_PATTERNS] : [process.execPath, "run", "test:bench:run"]
    setLogLines([cmd.slice(1).join(" ") + " ..."])
    await fs.mkdir(OUTPUT_DIR, { recursive: true })

    // use the most recent saved run as baseline so every new run shows a delta
    const baselinePath = process.env.NIKCLI_BENCHMARK_BASELINE_PATH ?? runs()[0]?.filePath

    const proc = Bun.spawn(cmd, {
      cwd: PKG_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        NIKCLI_BENCHMARK_SAVE: "1",
        NIKCLI_BENCHMARK_RUN_ID: runId,
        NIKCLI_BENCHMARK_OUTPUT_DIR: OUTPUT_DIR,
        ...(baselinePath ? { NIKCLI_BENCHMARK_BASELINE_PATH: baselinePath } : {}),
      },
    })

    await Promise.all([pipeOutput(proc.stdout), pipeOutput(proc.stderr), proc.exited])
    const code = await proc.exited
    setExitCode(code)
    setState(code === 0 ? "success" : "error")
    setRunIdx(0)
    appendLog(`\nDone. Exit code: ${code}`)
    refresh()
  }

  onMount(() => {
    const allRuns = refresh()
    if (allRuns.length === 0) void runBenchmarks()
  })

  useKeyboard((evt) => {
    if (evt.name === "q" || evt.name === "escape") {
      evt.preventDefault()
      process.exit(0)
    }
    if (evt.name === "r") {
      evt.preventDefault()
      void runBenchmarks()
    }
    if (evt.name === "u") {
      evt.preventDefault()
      void refresh()
    }
    if (evt.name === "a") {
      evt.preventDefault()
      setSortMode((m) => (m === "value" ? "module" : m === "module" ? "name" : "value"))
      setRowIdx(0)
      setScrollOff(0)
    }
    if (evt.name === "j" || evt.name === "down") {
      evt.preventDefault()
      setRowIdx((i) => clamp(i + 1, 0, Math.max(0, rows().length - 1)))
      if (rows().length > 0 && rowIdx() >= scrollOff() + pageHeight()) {
        setScrollOff((o) => o + 1)
      }
    }
    if (evt.name === "k" || evt.name === "up") {
      evt.preventDefault()
      setRowIdx((i) => clamp(i - 1, 0, Math.max(0, rows().length - 1)))
      if (rowIdx() < scrollOff()) setScrollOff((o) => Math.max(0, o - 1))
    }
    if (evt.name === "l" || evt.name === "right") {
      evt.preventDefault()
      setRunIdx((i) => clamp(i - 1, 0, Math.max(0, runs().length - 1)))
      setRowIdx(0)
      setScrollOff(0)
    }
    if (evt.name === "h" || evt.name === "left") {
      evt.preventDefault()
      setRunIdx((i) => clamp(i + 1, 0, Math.max(0, runs().length - 1)))
      setRowIdx(0)
      setScrollOff(0)
    }
    if (evt.name === "g") {
      evt.preventDefault()
      setRowIdx(0)
      setScrollOff(0)
    }
    if (evt.name === "G") {
      evt.preventDefault()
      const last = Math.max(0, rows().length - 1)
      setRowIdx(last)
      setScrollOff(Math.max(0, last - pageHeight() + 1))
    }
  })

  // @ts-nocheck - OpenTUI uses @opentui/solid JSX, not React
  const w = dim

  return (
    <box width={w().width} height={w().height} backgroundColor={c.bg} flexDirection="column">
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        border={["bottom"]}
        borderColor={c.border}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={c.text} attributes={TextAttributes.BOLD}>
          Nikcli Benchmark Dashboard
        </text>
        <text
          fg={state() === "running" ? c.yellow : state() === "success" ? c.accent : state() === "error" ? c.red : c.dim}
        >
          {state() === "running"
            ? "\u25cf RUNNING"
            : state() === "success"
              ? "\u2713 OK"
              : state() === "error"
                ? "\u2717 ERR"
                : "\u25cb idle"}
          {exitCode() !== undefined ? ` (${exitCode()})` : ""}
        </text>
      </box>

      {/* ── summary bar ────────────────────────────────────────────────────── */}
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={c.dim}>
          r run | u refresh | h/l switch run | j/k scroll | a sort ({sortMode()}) | g/G top/bot | q quit
        </text>
        <Show when={activeRun()}>
          {(run) => (
            <text fg={c.dim}>
              {`${run().run.records.length} records | ${modules().length} modules | ${short(run().run.runId, 28)}`}
            </text>
          )}
        </Show>
      </box>

      {/* ── main content: sidebar + chart + detail ─────────────────────────── */}
      <box paddingLeft={2} paddingRight={2} gap={1} flexDirection="row" flexGrow={1}>
        {/* ── left: run list (22w) ─────────────────────────────────────────── */}
        <box
          width={22}
          border
          borderColor={c.border}
          backgroundColor={c.panel}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          flexDirection="column"
        >
          <text fg={c.blue} attributes={TextAttributes.BOLD}>
            Runs
          </text>
          <Show when={runs().length > 0} fallback={<text fg={c.dim}>No runs yet.</text>}>
            <For each={runs().slice(0, 20)}>
              {(run, i) => (
                <text fg={i() === runIdx() ? c.accent : c.text} wrapMode="none">
                  {i() === runIdx() ? "\u25b8 " : "  "}
                  {short(run.run.runId.slice(0, 16), 16)}
                </text>
              )}
            </For>
          </Show>
        </box>

        {/* ── center: charts ───────────────────────────────────────────────── */}

        <box flexGrow={1} flexDirection="column" gap={1}>
          {/* ── slowest ms ─────────────────────────────────────────────────────── */}
          <box
            border
            borderColor={c.border}
            backgroundColor={c.panel}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            flexDirection="column"
            flexGrow={1}
          >
            <text fg={c.yellow} attributes={TextAttributes.BOLD}>
              Slowest (ms)
            </text>
            <For each={slowMs()}>
              {(record) => {
                const b = bar(record.value, maxSlow(), 22)
                const pct = maxSlow() > 0 ? ((record.value / maxSlow()) * 100).toFixed(0) : "0"
                return (
                  <text fg={c.text} wrapMode="none">
                    {t`${short(record.module, 10).padEnd(10)} ${short(record.scenario, 16).padEnd(16)} ${fg(c.cyan)(b)} ${fmt(record.value)}ms ${pct}%`}
                  </text>
                )
              }}
            </For>
            <Show when={slowMs().length === 0}>
              <text fg={c.dim}>No ms-timed records.</text>
            </Show>
          </box>

          {/* ── baseline deltas (if comparison) ────────────────────────────────── */}
          <box
            border
            borderColor={c.border}
            backgroundColor={c.panel}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            flexDirection="column"
            flexGrow={1}
          >
            <text fg={c.yellow} attributes={TextAttributes.BOLD}>
              Baseline \u0394
            </text>
            <Show
              when={compRows().length > 0}
              fallback={<text fg={c.dim}>Set NIKCLI_BENCHMARK_BASELINE_PATH to see regression deltas.</text>}
            >
              <For each={compRows()}>
                {(row) => {
                  const b = bar(Math.abs(row.deltaPercent), maxDelta(), 18, row.deltaPercent > 0 ? "+" : "-")
                  const fg = row.deltaPercent > 5 ? c.red : row.deltaPercent < -5 ? c.accent : c.yellow
                  return (
                    <text fg={fg} wrapMode="none">
                      {short(row.module, 10).padEnd(10)} {short(row.scenario, 16).padEnd(16)} {b}{" "}
                      {row.deltaPercent >= 0 ? "+" : ""}
                      {row.deltaPercent.toFixed(1)}%
                    </text>
                  )
                }}
              </For>
            </Show>
          </box>
        </box>

        {/* ── right: detail + modules ──────────────────────────────────────── */}
        <box
          width={30}
          border
          borderColor={c.border}
          backgroundColor={c.panel}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          flexDirection="column"
        >
          <text fg={c.blue} attributes={TextAttributes.BOLD}>
            Detail
          </text>
          <Show when={selected()} fallback={<text fg={c.dim}>Select a record.</text>}>
            {(rec) => (
              <box flexDirection="column" gap={0}>
                <text fg={c.text} wrapMode="none">
                  suite: {rec().suite}
                </text>
                <text fg={c.text} wrapMode="none">
                  module: {rec().module}
                </text>
                <text fg={c.text} wrapMode="none">
                  scenario: {short(rec().scenario, 26)}
                </text>
                <text fg={c.text} wrapMode="none">
                  iters: {rec().iterations.toLocaleString()}
                </text>
                <text fg={c.accent} wrapMode="none">
                  value: {fmt(rec().value)} {rec().unit}
                </text>
                <text fg={c.dim} wrapMode="none">
                  per iter: {fmt(rec().perIter, 4)} {rec().unit}
                </text>
                <text fg={c.dim} wrapMode="none">
                  ops/s: {rec().unit === "ms" && rec().value > 0 ? fmt(1000 / rec().value) : "\u2014"}
                </text>
              </box>
            )}
          </Show>

          <box paddingTop={1} flexDirection="column">
            <text fg={c.blue} attributes={TextAttributes.BOLD}>
              Modules
            </text>
            <For each={modules().slice(0, 8)}>
              {(mod) => (
                <text fg={c.text} wrapMode="none">
                  {`${short(mod.name, 20).padEnd(20)} ${mod.count}rec ${fmt(mod.totalMs)}ms`}
                </text>
              )}
            </For>
          </box>
        </box>
      </box>

      {/* ── bottom: records table ───────────────────────────────────────────── */}
      <box
        paddingLeft={2}
        paddingRight={2}
        border={["top"]}
        borderColor={c.border}
        backgroundColor={c.panel}
        flexDirection="column"
        flexGrow={1}
      >
        <box paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
          <text fg={c.blue} attributes={TextAttributes.BOLD}>
            {`Records (${rows().length})`}
          </text>
          <text fg={c.dim}>
            sorted by {sortMode()} | {short(TEST_PATTERNS.join(" "), 50)}
          </text>
        </box>
        <box paddingLeft={1} paddingRight={1} flexDirection="row">
          <text fg={c.dim} wrapMode="none">
            {"  ".padEnd(2)}
            {"suite".padEnd(8)} {"module".padEnd(12)} {"scenario".padEnd(28)} {"value".padStart(10)}{" "}
            {"per/iter".padStart(10)} {"iters".padStart(10)} {"ops/s".padStart(10)}
          </text>
        </box>
        <box paddingLeft={1} paddingRight={1} flexDirection="column" flexGrow={1}>
          <For each={visibleRows()}>
            {(row) => {
              const idx = rows().indexOf(row)
              const isSel = idx === rowIdx()
              const opsPerSec = row.unit === "ms" && row.value > 0 ? fmt(1000 / row.value) : "\u2014"
              return (
                <text fg={isSel ? c.accent : c.text} wrapMode="none">
                  {isSel ? "\u25b8 " : "  "}
                  {short(row.suite, 8).padEnd(8)} {short(row.module, 12).padEnd(12)}{" "}
                  {short(row.scenario, 28).padEnd(28)} {fmt(row.value).padStart(10)} {fmt(row.perIter, 4).padStart(10)}{" "}
                  {row.iterations.toLocaleString().padStart(10)} {opsPerSec.padStart(10)}
                </text>
              )
            }}
          </For>
        </box>
      </box>

      {/* ── footer: live output ────────────────────────────────────────────── */}
      <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column" maxHeight={6}>
        <For each={logLines().slice(-5)}>
          {(line) => (
            <text fg={c.dim} wrapMode="none">
              {short(line, Math.max(60, w().width - 4))}
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

render(() => <App />, {
  targetFps: 30,
  gatherStats: false,
  exitOnCtrlC: true,
  useKittyKeyboard: {},
})
