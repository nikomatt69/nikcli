import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import { stripComments } from "../tui/tui-source"

/**
 * No test file may set a `NIKCLI_*` or `XDG_*` variable at module scope without
 * also declaring it through `preserveTestEnv`.
 *
 * `preload.ts` installs a `beforeEach` that deletes every such variable outside
 * its captured baseline. A module-scope assignment therefore lasts exactly
 * until the first `it` and then vanishes — silently, because the code under
 * test falls back to its production default rather than failing.
 *
 * That is not hypothetical. A suite redirecting `NIKCLI_DB` to a temp file lost
 * the variable this way, `Database.path()` resolved the developer's real
 * `~/.local/share/nikcli/nikcli.db`, and the test wrote rows into it.
 *
 * Assignments *inside* a function or hook body are fine — they run after the
 * wipe — so this only inspects column-zero assignments.
 */

const TEST_ROOT = fileURLToPath(new URL("../", import.meta.url))

if (!existsSync(TEST_ROOT)) {
  throw new Error(`Test root not found at ${TEST_ROOT}; this gate would pass vacuously.`)
}

/**
 * `preload.ts` is the baseline itself: its assignments run before
 * `setTestEnvBaseline()` captures them, so they survive by construction.
 */
const EXEMPT = new Set(["preload.ts"])

/** A `process.env.X =` or `??=` starting at column zero. */
const MODULE_SCOPE_ASSIGNMENT = /^process\.env\.(NIKCLI_[A-Z_0-9]+|XDG_[A-Z_0-9]+)\s*(=|\?\?=)/gm

async function offenders() {
  const found: string[] = []
  let scanned = 0

  for await (const relative of new Bun.Glob("**/*.ts").scan({ cwd: TEST_ROOT })) {
    scanned++
    if (EXEMPT.has(relative)) continue

    const text = stripComments(await Bun.file(TEST_ROOT + relative).text())
    const matches = text.match(MODULE_SCOPE_ASSIGNMENT)
    if (!matches) continue
    if (text.includes("preserveTestEnv")) continue

    const names = matches.map((match) => match.split(".")[2]!.split(/[\s=]/)[0])
    found.push(`${relative}: ${names.join(", ")}`)
  }

  return { found, scanned }
}

describe("test environment discipline", () => {
  it("scanned a plausible test tree", async () => {
    const { scanned } = await offenders()
    expect(scanned).toBeGreaterThan(100)
  })

  it("declares every module-scope NIKCLI_/XDG_ assignment through preserveTestEnv", async () => {
    const { found } = await offenders()

    expect(
      found,
      found.length === 0
        ? ""
        : `These files set an environment variable at module scope that preload.ts deletes before the first test.\n` +
            `Add preserveTestEnv([...]) from test/helpers/env.ts naming each one:\n  ${found.join("\n  ")}`,
    ).toEqual([])
  })
})
