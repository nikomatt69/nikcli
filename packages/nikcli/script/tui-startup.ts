#!/usr/bin/env bun
/**
 * Warm time-to-first-paint for the compiled TUI, best of N.
 *
 * `--version` and `--help` never import `@opentui/core`, so they cannot measure
 * a startup regression in the terminal. This spawns the real binary in a PTY and
 * stops the clock at the first frame that carries actual printable text, which
 * is the number `specs/tui-package.md` §4 asks to compare across a packaging
 * change: a new `package.json` that re-imports a backend chain shows up here and
 * nowhere else.
 *
 * All runs share one NIKCLI_TEST_HOME and the first is discarded, because a
 * fresh home pays for database migrations and config bootstrap — real costs, but
 * not the ones a packaging change moves. "Warm" here means: state already on
 * disk, binary already in the page cache.
 */
import { mkdtempSync, existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "bun-pty"

const BIN = process.argv[2] ?? ""
if (!BIN || !existsSync(BIN)) throw new Error(`usage: tui-startup.ts <binary>  (got ${BIN || "nothing"})`)
const RUNS = Number(process.env.RUNS ?? 3)

function plain(raw: string) {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1bP[^\x1b]*\x1b\\/g, "")
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
}

const home = mkdtempSync(path.join(os.tmpdir(), "nikcli-startup-"))

async function once(): Promise<number> {
  const started = performance.now()
  let painted = 0
  let raw = ""

  const pty = spawn(BIN, [], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: home,
    env: {
      ...process.env,
      NIKCLI_TEST_HOME: home,
      NIKCLI_DISABLE_AUTOUPDATE: "1",
      TERM: "xterm-256color",
    } as Record<string, string>,
  })

  pty.onData((data) => {
    raw += data
    // 200 printable characters is past the alt-screen setup and into content.
    if (!painted && plain(raw).replace(/\s/g, "").length > 200) painted = performance.now() - started
  })

  const deadline = Date.now() + 60_000
  while (!painted && Date.now() < deadline) await Bun.sleep(10)
  pty.kill()
  if (!painted) throw new Error("never painted")
  return painted
}

console.log(`warmup: ${(await once()).toFixed(0)}ms (discarded — fresh home pays for migrations)`)
await Bun.sleep(500)

const times: number[] = []
for (let i = 0; i < RUNS; i++) {
  const ms = await once()
  times.push(ms)
  console.log(`run ${i + 1}: ${ms.toFixed(0)}ms`)
  await Bun.sleep(500)
}
console.log(`best of ${RUNS} (warm): ${Math.min(...times).toFixed(0)}ms`)
await rm(home, { recursive: true, force: true }).catch(() => {})
process.exit(0)
