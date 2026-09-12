import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-lazy-cmd-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

/**
 * `cli-main` registers most commands through `lazy()`, which repeats the
 * command string and description at the registration site so `nikcli --help`,
 * command matching and completion never load a handler.
 *
 * A duplicated spec drifts. When it does, the symptom is not a crash: the help
 * text quietly disagrees with the command, or — if the `command` string itself
 * drifts — yargs matches on the spec and dispatches into a module that declares
 * different positionals. This asserts the two stay identical.
 */
const source = await fs.readFile(path.join(import.meta.dir, "../../src/cli-main.ts"), "utf8")

interface Registration {
  readonly command: string
  readonly describe: string
  readonly from: string
  readonly exportName: string
}

function parseRegistrations(text: string): Registration[] {
  const pattern =
    /lazy\(\s*\{\s*command:\s*("(?:[^"\\]|\\.)*"),\s*describe:\s*("(?:[^"\\]|\\.)*")\s*\},\s*exported\(\(\)\s*=>\s*import\(("(?:[^"\\]|\\.)*")\),\s*("(?:[^"\\]|\\.)*")\),?\s*\),?/g
  return [...text.matchAll(pattern)].map((match) => ({
    command: JSON.parse(match[1]!) as string,
    describe: JSON.parse(match[2]!) as string,
    from: JSON.parse(match[3]!) as string,
    exportName: JSON.parse(match[4]!) as string,
  }))
}

const registrations = parseRegistrations(source)

describe("lazy command registration", () => {
  it("finds the lazy registrations in cli-main", () => {
    // A refactor that drops `lazy()` entirely would otherwise make this whole
    // suite pass by asserting nothing.
    expect(registrations.length).toBeGreaterThan(20)
  })

  it("registers each command exactly once", () => {
    const commands = registrations.map((entry) => entry.command)
    expect(new Set(commands).size).toBe(commands.length)
  })

  it.each(registrations.map((entry) => [entry.exportName, entry] as const))(
    "%s: registered spec matches the module",
    async (_name, entry) => {
      const specifier = entry.from.replace(/^\.\//, "@/")
      const module = (await import(specifier)) as Record<string, { command?: unknown; describe?: unknown }>
      const target = module[entry.exportName]
      expect(target, `${entry.exportName} is not exported from ${entry.from}`).toBeDefined()
      expect(target!.command).toBe(entry.command)
      expect(target!.describe).toBe(entry.describe)
    },
  )
})

process.on("beforeExit", () => {
  void removeTestDir(testHome)
})
