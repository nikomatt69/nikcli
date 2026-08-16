#!/usr/bin/env bun
/**
 * Boots the standalone terminal against a running server and asserts it paints.
 *
 * This is section 6 of `specs/tui-package.md` as an executable check: the host
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
import { spawn } from "bun-pty"

const url = process.argv[2]
if (!url) throw new Error("usage: standalone-smoke.ts <server-url>")

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.resolve(here, "../bin/nikcli-tui.ts")
const home = mkdtempSync(path.join(os.tmpdir(), "nikcli-tui-standalone-"))

/** Substrings that only ever appear when the terminal failed to boot. */
const FAILURES = ["Cannot find module", "ResolveMessage", "is not a function", "is not an object"]

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
const pty = spawn(process.execPath, ["--conditions=browser", entry, url], {
  name: "xterm-256color",
  cols: 100,
  rows: 30,
  cwd: path.resolve(here, ".."),
  env: { ...process.env, NIKCLI_TEST_HOME: home, TERM: "xterm-256color" } as Record<string, string>,
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
pty.kill()
await rm(home, { recursive: true, force: true }).catch(() => {})

const failure = FAILURES.find((marker) => raw.includes(marker))
if (failure) {
  console.error(plain(raw).slice(0, 3000))
  throw new Error(`standalone terminal reported: ${failure}`)
}
if (painted <= 400) {
  console.error(plain(raw).slice(0, 3000))
  throw new Error(`standalone terminal painted only ${painted} characters`)
}
console.log(`[standalone-smoke] PASS — painted ${painted} printable characters against ${url}`)
