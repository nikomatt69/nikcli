#!/usr/bin/env bun

/**
 * What the TUI's eager imports cost at startup.
 *
 * `app.tsx` is on the critical path and imports most dialogs eagerly, so every
 * one of their dependency chains is evaluated before the first frame — whether
 * or not the user opens that dialog. EOT-08 asks for this to be characterised
 * before anything is moved, and EOT-01 asks for the numbers to be reproducible
 * rather than a single sample.
 *
 * Each module is measured in a **fresh process**: within one process the
 * module registry and Bun's transpile cache make every import after the first
 * nearly free, which reads as "these are cheap" when they are not. A baseline
 * process that imports nothing is measured the same way and reported, so the
 * runtime's own startup can be subtracted rather than silently attributed to
 * the module.
 *
 * Usage: bun run script/import-cost.ts [--runs=5] [--json]
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { formatProbeEnvironment, probeEnvironment } from "@nikcli-ai/util/probe-env"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const repoRoot = path.resolve(root, "../..")
// Same block the startup probe emits: a timing without the machine, runtime
// and revision behind it cannot be compared with another one.
const environment = probeEnvironment({ spec: "EOT-01", repoRoot })

const args = process.argv.slice(2)
const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 5)
const asJson = args.includes("--json")
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`✗ --runs must be a positive integer, got ${runs}`)
  process.exit(1)
}

/** The eager `@tui/component/...` imports in app.tsx, in source order. */
async function eagerComponents(): Promise<string[]> {
  const src = await Bun.file(path.join(root, "src/app.tsx")).text()
  const found = new Set<string>()
  for (const match of src.matchAll(/^import\s+[^"']*from\s+"(@tui\/component\/[^"]+)"/gm)) {
    found.add(match[1])
  }
  return [...found].sort()
}

function specifierToPath(specifier: string): string {
  return path.join(root, "src", specifier.replace("@tui/", ""))
}

async function timeOnce(target: string | undefined): Promise<number> {
  const body = target === undefined ? "" : `await import(${JSON.stringify(target)});`
  const source = `const t = performance.now(); ${body} console.log(performance.now() - t);`
  const proc = Bun.spawn(["bun", "-e", source], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0)
    throw new Error(`import failed for ${target ?? "baseline"}: ${await new Response(proc.stderr).text()}`)
  const value = Number(out.trim())
  if (!Number.isFinite(value)) throw new Error(`unparseable timing for ${target ?? "baseline"}: ${out.trim()}`)
  return value
}

/**
 * What the eager set costs *together*, on top of the shared renderer chain.
 *
 * This is the number that describes startup. The per-module figures above are
 * an upper bound: these modules share most of their dependency graph, so
 * whichever is imported first pays for the chain and the rest look cheap. Sum
 * them and you overstate by an order of magnitude; measure them together and
 * you get what removing them could actually return.
 */
async function timeAggregate(specifiers: string[]): Promise<number> {
  const imports = specifiers.map((s) => `await import(${JSON.stringify(specifierToPath(s))});`).join("")
  const source = [
    `await import("@opentui/solid");`,
    `const t = performance.now();`,
    imports,
    `console.log(performance.now() - t);`,
  ].join("")
  const proc = Bun.spawn(["bun", "-e", source], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0) throw new Error(`aggregate import failed: ${await new Response(proc.stderr).text()}`)
  const value = Number(out.trim())
  if (!Number.isFinite(value)) throw new Error(`unparseable aggregate timing: ${out.trim()}`)
  return value
}

/** Nearest-rank percentile, matching `script/tui-startup.ts`. */
function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
  return { min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] }
}

async function measure(target: string | undefined) {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) samples.push(await timeOnce(target))
  return summarize(samples)
}

const components = await eagerComponents()
if (components.length === 0) {
  console.error("✗ no eager @tui/component imports found in app.tsx — refusing to report a vacuous result")
  process.exit(1)
}

const baseline = await measure(undefined)
const aggregateSamples: number[] = []
for (let i = 0; i < runs; i++) aggregateSamples.push(await timeAggregate(components))
const aggregate = summarize(aggregateSamples)
const rows: { specifier: string; median: number; overBaseline: number }[] = []
for (const specifier of components) {
  const stats = await measure(specifierToPath(specifier))
  rows.push({ specifier, median: stats.median, overBaseline: stats.median - baseline.median })
}
rows.sort((a, b) => b.overBaseline - a.overBaseline)

if (asJson) {
  console.log(JSON.stringify({ environment, runs, baseline, aggregate, rows }, null, 2))
} else {
  const ms = (value: number) => `${value.toFixed(1)}ms`
  console.log(formatProbeEnvironment(environment))
  console.log(`runs=${runs} per module, fresh process each`)
  console.log(`baseline (import nothing): median=${ms(baseline.median)} p95=${ms(baseline.p95)}`)
  console.log(`\n${"module".padEnd(46)} ${"median".padStart(9)} ${"over baseline".padStart(14)}`)
  for (const row of rows) {
    console.log(`${row.specifier.padEnd(46)} ${ms(row.median).padStart(9)} ${ms(row.overBaseline).padStart(14)}`)
  }
  const total = rows.reduce((sum, row) => sum + row.overBaseline, 0)
  console.log(`\n${components.length} eagerly imported modules; sum of the column above ${ms(total)}.`)
  console.log("That sum is an upper bound, not a saving: these modules share most of their graph.")
  console.log(`Measured together on top of the renderer chain: ${ms(aggregate.median)} (p95 ${ms(aggregate.p95)}).`)
  console.log("That last figure is the one to compare before and after moving a module off the critical path.")
}
