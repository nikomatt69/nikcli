#!/usr/bin/env bun
/**
 * Time-to-first-paint and time-to-usable-prompt for the compiled TUI.
 *
 * `--version` and `--help` never import `@opentui/core`, so they cannot measure
 * a startup regression in the terminal. This spawns the real binary in a PTY
 * and records first printable content plus the interactive prompt, which is
 * the comparison `specs/effect-tui/08-host-plugins-startup.md` asks across a
 * packaging change: a new `package.json` that re-imports a backend chain shows
 * up here and nowhere else.
 *
 * Warm runs share one NIKCLI_TEST_HOME after a separately reported bootstrap
 * (migrations and config). Cold runs each get an isolated home. Defaults follow
 * EOT-01: 30 warm samples and 10 descriptive cold samples. Override with
 * WARM_RUNS / COLD_RUNS (`RUNS` is an alias for WARM_RUNS).
 */
import { mkdtempSync, existsSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnPty, type NativePty } from "@nikcli-ai/util/pty"
import { formatBytes, summarizeSamples, type SampleSummary } from "@tui/util/runtime-samples"
import { probeEnvironment } from "@nikcli-ai/util/probe-env"

const BIN = process.argv[2] ?? ""
if (!BIN || !existsSync(BIN)) throw new Error(`usage: tui-startup.ts <binary>  (got ${BIN || "nothing"})`)

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, "..")
const repoRoot = findRepoRoot(packageRoot)
const WARM_RUNS = envInt("WARM_RUNS", envInt("RUNS", 30))
const COLD_RUNS = envInt("COLD_RUNS", 10)
const COLS = envInt("COLS", 100)
const ROWS = envInt("ROWS", 30)
const TIMEOUT_MS = envInt("TIMEOUT_MS", 60_000)
const HOST_MODE = process.env.HOST_MODE || "embedded"
const PROMPT_MARKERS = (process.env.PROMPT_MARKERS || "Ask anything,Run a command")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

if (WARM_RUNS === 0 && COLD_RUNS === 0) {
  throw new Error("WARM_RUNS and COLD_RUNS cannot both be 0")
}

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const ANSI_OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g")
const ANSI_DCS = new RegExp(`${ESC}P[^${ESC}]*${ESC}\\\\`, "g")
const ANSI_CSI = new RegExp(`${ESC}\\[[0-9;?<>=]*[ -/]*[@-~]`, "g")
const ANSI_OTHER = new RegExp(`${ESC}[@-Z\\\\-_]`, "g")
function plain(raw: string) {
  return raw.replace(ANSI_OSC, "").replace(ANSI_DCS, "").replace(ANSI_CSI, "").replace(ANSI_OTHER, "")
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`)
  return Math.floor(value)
}

function findRepoRoot(start: string) {
  let dir = start
  while (true) {
    if (existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

/** Child RSS in bytes. Absent on this host/OS, not a zero-cost success. */
function rssBytes(pid: number): number | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    if (process.platform === "linux") {
      const status = readFileSync(`/proc/${pid}/status`, "utf8")
      const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m)
      if (!match) return undefined
      return Number(match[1]) * 1024
    }
    const result = Bun.spawnSync({
      cmd: ["ps", "-o", "rss=", "-p", String(pid)],
      stdout: "pipe",
      stderr: "pipe",
    })
    if (result.exitCode !== 0) return undefined
    const kb = Number(new TextDecoder().decode(result.stdout).trim())
    if (!Number.isFinite(kb) || kb <= 0) return undefined
    return Math.round(kb * 1024)
  } catch {
    return undefined
  }
}

type Marks = {
  spawnMs: number
  firstPaintMs: number
  usablePromptMs: number
  /** Child RSS at usable prompt, when the host can read it. Missing is omitted, never 0. */
  rssBytes?: number
}

const live = new Set<NativePty>()
const homes = new Set<string>()

function scratch() {
  const home = mkdtempSync(path.join(os.tmpdir(), "nikcli-startup-"))
  homes.add(home)
  return home
}

async function reap() {
  for (const pty of live) {
    pty.kill()
  }
  live.clear()
  for (const home of homes) {
    await rm(home, { recursive: true, force: true }).catch(() => {})
  }
  homes.clear()
}

async function once(home: string): Promise<Marks> {
  const started = performance.now()
  let firstPaintMs = 0
  let usablePromptMs = 0
  let raw = ""

  const pty = spawnPty({
    command: BIN,
    cols: COLS,
    rows: ROWS,
    cwd: home,
    env: {
      ...process.env,
      NIKCLI_TEST_HOME: home,
      NIKCLI_DISABLE_AUTOUPDATE: "1",
      NIKCLI_TERMINAL: "1",
      TERM: process.env.TERM || "xterm-256color",
    },
  })
  live.add(pty)
  const spawnMs = performance.now() - started

  pty.onData((data) => {
    raw += data
    const text = plain(raw)
    if (!firstPaintMs && text.replace(/\s/g, "").length > 200) firstPaintMs = performance.now() - started
    if (!usablePromptMs && PROMPT_MARKERS.some((marker) => text.includes(marker))) {
      usablePromptMs = performance.now() - started
    }
  })

  const deadline = Date.now() + TIMEOUT_MS
  while ((!firstPaintMs || !usablePromptMs) && Date.now() < deadline) await Bun.sleep(10)
  const rss = rssBytes(pty.pid)
  pty.kill()
  live.delete(pty)
  if (!firstPaintMs) throw new Error("never painted")
  if (!usablePromptMs) throw new Error("never reached a usable prompt")
  return { spawnMs, firstPaintMs, usablePromptMs, rssBytes: rss }
}

function definedNumbers(values: readonly (number | undefined)[]) {
  return values.filter((value): value is number => value !== undefined)
}

function series(samples: Marks[]) {
  return {
    spawnMs: samples.map((sample) => sample.spawnMs),
    firstPaintMs: samples.map((sample) => sample.firstPaintMs),
    usablePromptMs: samples.map((sample) => sample.usablePromptMs),
    rssBytes: definedNumbers(samples.map((sample) => sample.rssBytes)),
  }
}

function line(label: string, stats: SampleSummary, note?: string, format: (value: number) => string = ms) {
  const suffix = note ? ` ${note}` : ""
  console.log(
    `${label}: n=${stats.count} min=${format(stats.min)} median=${format(stats.median)} p95=${format(stats.p95)} max=${format(stats.max)}${suffix}`,
  )
}

function ms(value: number) {
  return `${value.toFixed(0)}ms`
}

function samplesLine(label: string, values: number[], format: (value: number) => string = (value) => value.toFixed(0)) {
  console.log(`${label}: ${values.map(format).join(",")}`)
}

// Shared with `packages/tui/script/import-cost.ts` so two probes emit one
// comparison format instead of two that drift apart.
const environment = {
  ...probeEnvironment({ spec: "EOT-01", repoRoot }),
  terminal: {
    term: process.env.TERM || "xterm-256color",
    cols: COLS,
    rows: ROWS,
  },
  hostMode: HOST_MODE,
  instrumentation: process.env.INSTRUMENTATION || "off",
}

let shuttingDown = false
async function fail(error: unknown, code = 1): Promise<never> {
  if (!shuttingDown) {
    shuttingDown = true
    await reap()
  }
  console.error(error instanceof Error ? error.message : error)
  process.exit(code)
}

process.on("SIGINT", () => {
  void fail("interrupted", 130)
})
process.on("SIGTERM", () => {
  void fail("terminated", 143)
})

try {
  const warm: Marks[] = []
  const cold: Marks[] = []
  let bootstrap: Marks | undefined

  if (WARM_RUNS > 0) {
    const home = scratch()
    bootstrap = await once(home)
    const bootstrapRss = bootstrap.rssBytes !== undefined ? ` rss=${formatBytes(bootstrap.rssBytes)}` : ""
    console.log(
      `bootstrap: spawn=${bootstrap.spawnMs.toFixed(0)}ms firstPaint=${bootstrap.firstPaintMs.toFixed(0)}ms usablePrompt=${bootstrap.usablePromptMs.toFixed(0)}ms${bootstrapRss} (fresh home, not a warm sample)`,
    )
    await Bun.sleep(500)
    for (let i = 0; i < WARM_RUNS; i++) {
      const sample = await once(home)
      warm.push(sample)
      const rss = sample.rssBytes !== undefined ? ` rss=${formatBytes(sample.rssBytes)}` : ""
      console.log(
        `warm ${i + 1}/${WARM_RUNS}: firstPaint=${sample.firstPaintMs.toFixed(0)}ms usablePrompt=${sample.usablePromptMs.toFixed(0)}ms${rss}`,
      )
      await Bun.sleep(500)
    }
  }

  for (let i = 0; i < COLD_RUNS; i++) {
    const home = scratch()
    const sample = await once(home)
    cold.push(sample)
    const rss = sample.rssBytes !== undefined ? ` rss=${formatBytes(sample.rssBytes)}` : ""
    console.log(
      `cold ${i + 1}/${COLD_RUNS}: firstPaint=${sample.firstPaintMs.toFixed(0)}ms usablePrompt=${sample.usablePromptMs.toFixed(0)}ms${rss}`,
    )
    await rm(home, { recursive: true, force: true }).catch(() => {})
    homes.delete(home)
    await Bun.sleep(500)
  }

  const warmSeries = series(warm)
  const coldSeries = series(cold)
  if (warm.length > 0) {
    line("warm firstPaint", summarizeSamples(warmSeries.firstPaintMs))
    line("warm usablePrompt", summarizeSamples(warmSeries.usablePromptMs))
    if (warmSeries.rssBytes.length > 0) line("warm rss", summarizeSamples(warmSeries.rssBytes), undefined, formatBytes)
    samplesLine("warm firstPaint samples", warmSeries.firstPaintMs)
    samplesLine("warm usablePrompt samples", warmSeries.usablePromptMs)
    if (warmSeries.rssBytes.length > 0) samplesLine("warm rss samples", warmSeries.rssBytes, formatBytes)
  }
  if (cold.length > 0) {
    line("cold firstPaint", summarizeSamples(coldSeries.firstPaintMs), "(descriptive only)")
    line("cold usablePrompt", summarizeSamples(coldSeries.usablePromptMs), "(descriptive only)")
    if (coldSeries.rssBytes.length > 0) {
      line("cold rss", summarizeSamples(coldSeries.rssBytes), "(descriptive only)", formatBytes)
    }
    samplesLine("cold firstPaint samples", coldSeries.firstPaintMs)
    samplesLine("cold usablePrompt samples", coldSeries.usablePromptMs)
    if (coldSeries.rssBytes.length > 0) samplesLine("cold rss samples", coldSeries.rssBytes, formatBytes)
  }

  const report = {
    environment,
    bootstrap: bootstrap ?? null,
    samples: {
      warm: warmSeries,
      cold: coldSeries,
    },
    summary: {
      warm: warm.length
        ? {
            firstPaint: summarizeSamples(warmSeries.firstPaintMs),
            usablePrompt: summarizeSamples(warmSeries.usablePromptMs),
            rssBytes: warmSeries.rssBytes.length > 0 ? summarizeSamples(warmSeries.rssBytes) : null,
          }
        : null,
      cold: cold.length
        ? {
            firstPaint: summarizeSamples(coldSeries.firstPaintMs),
            usablePrompt: summarizeSamples(coldSeries.usablePromptMs),
            rssBytes: coldSeries.rssBytes.length > 0 ? summarizeSamples(coldSeries.rssBytes) : null,
            note: "descriptive only",
          }
        : null,
    },
  }
  console.log(JSON.stringify(report))
  await reap()
  process.exit(0)
} catch (error) {
  await fail(error)
}
