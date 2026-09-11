#!/usr/bin/env bun
/**
 * Boots the standalone terminal against a running server and asserts it paints.
 *
 * This is an executable check for `specs/effect-tui/08-host-plugins-startup.md`: the host
 * under test imports `@nikcli-ai/tui` and nothing from `packages/nikcli`, so if
 * a backend chain creeps back into the terminal's graph, this fails while the
 * CLI's own entry points keep working — they carry the backend regardless.
 *
 * Usage:
 *   bun run script/standalone-smoke.ts <server-url>
 */
import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnPty } from "@nikcli-ai/util/pty"

const url = process.argv[2]
if (!url) throw new Error("usage: standalone-smoke.ts <server-url>")

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.resolve(here, "../bin/nikcli-tui.ts")
const home = mkdtempSync(path.join(os.tmpdir(), "nikcli-tui-standalone-"))

/**
 * Substrings that only ever appear when the terminal failed to boot.
 *
 * The first four catch a module that would not resolve. The last two catch the
 * case they miss: the host resolved everything, started, threw, and painted the
 * error console. A rendered stack trace is well over the character floor below,
 * so without these the check reports PASS against a terminal showing nothing
 * but an exception.
 *
 * The last two are matched against the *painted* screen rather than the raw
 * stream: a renderer writes a cell at a time with escape sequences between
 * them, so a phrase it painted is generally not contiguous in `raw`. They also
 * avoid the message line itself, which at 30 rows is scrolled out of the
 * viewport — what stays on screen is the console panel and the stack.
 */
const FAILURES = ["Cannot find module", "ResolveMessage", "is not a function", "is not an object"]
// A healthy terminal never paints a framework stack frame. The console panel
// title is deliberately not used: it may be legitimately focusable in normal
// operation, and a gate should not rest on a marker whose healthy case cannot
// currently be observed.
const PAINTED_FAILURES = ["solid-js/dist/solid.js", "node_modules/solid-js"]

/** Everything the check can match against: the raw stream and the painted screen. */
function haystack(stream: string) {
  return `${stream}\n${plain(stream)}`
}

function firstFailure(stream: string) {
  const text = haystack(stream)
  return [...FAILURES, ...PAINTED_FAILURES].find((marker) => text.includes(marker))
}

function plain(raw: string) {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1bP[^\x1b]*\x1b\\/g, "")
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
}

let raw = ""
// `bun <file>`, not `bun run <file>`: `run` resolves the argument as a script
// name first and prints the script list instead of executing the entry.
// Run from the package root, not the scratch home: Bun reads `jsxImportSource`
// from the nearest tsconfig to the *cwd*, and without it JSX falls back to
// `react/jsx-dev-runtime` and the app cannot load. A consumer runs from its own
// root with its own tsconfig — the CLI does the same thing explicitly, by
// passing `tsconfig` and the Solid plugin to `Bun.build`.
const pty = spawnPty({
  command: process.execPath,
  args: ["--conditions=browser", entry, url],
  cols: 100,
  rows: 30,
  cwd: path.resolve(here, ".."),
  env: { ...process.env, NIKCLI_TEST_HOME: home, TERM: "xterm-256color" },
})
pty.onData((data) => {
  raw += data
})

const deadline = Date.now() + 45_000
let painted = 0
while (Date.now() < deadline) {
  painted = plain(raw).replace(/\s/g, "").length
  if (painted > 400) break
  await Bun.sleep(100)
}

/**
 * Keep watching after the first paint.
 *
 * Breaking out at the character floor and killing the pty means this check can
 * only ever see the first second or two of the terminal's life. Anything that
 * throws after the initial render — a context that resolves to a second module
 * instance, a provider that is not there by the time a later component asks for
 * it — happens off-camera, and the run is reported as a pass.
 *
 * The window is short because the failure it is looking for is a startup
 * failure, not a soak test.
 */
const WATCH_AFTER_PAINT_MS = Number(process.env.WATCH_AFTER_PAINT_MS ?? 8000)
const watchUntil = Date.now() + WATCH_AFTER_PAINT_MS
while (Date.now() < watchUntil && !firstFailure(raw)) {
  await Bun.sleep(100)
}
painted = plain(raw).replace(/\s/g, "").length
pty.kill()
await rm(home, { recursive: true, force: true }).catch(() => {})

const failure = firstFailure(raw)
if (failure) {
  console.error(plain(raw).slice(0, 3000))
  throw new Error(`standalone terminal reported: ${failure}`)
}
if (painted <= 400) {
  console.error(plain(raw).slice(0, 3000))
  throw new Error(`standalone terminal painted only ${painted} characters`)
}
console.log(`[standalone-smoke] PASS — painted ${painted} printable characters against ${url}`)
