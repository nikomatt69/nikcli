import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import path from "path"

/**
 * The registration invariant of the CLI surface
 * ([specs/v2/cli-command-surface.md](../../../../specs/v2/cli-command-surface.md)):
 * a file under `src/cli/cmd/` is not a command until `src/cli/commands.ts`
 * registers it, and the document's table is the list of what is registered.
 *
 * Registration moved out of `cli-main.ts` into that table when the commands
 * became lazily loaded (see `src/cli/cmd/lazy.ts`); the invariant is unchanged,
 * only the file that holds it.
 *
 * Read from source rather than by running `--help`: the help subprocess is
 * already known to time out under parallel load, and a coherence check that
 * flakes is a check people learn to re-run instead of read.
 */

const packageRoot = path.join(import.meta.dir, "../..")
const mainPath = path.join(packageRoot, "src/cli-main.ts")
const tablePath = path.join(packageRoot, "src/cli/commands.ts")
const docPath = path.join(packageRoot, "../../specs/v2/cli-command-surface.md")

/** `command: "mission <id>"` → `mission`; `$0 [project]` keeps its `$0`. */
function nameOf(spec: string): string {
  return spec.trim().split(/\s+/)[0]
}

async function readModule(relative: string): Promise<{ file: string; source: string }> {
  const base = path.join(packageRoot, "src", relative.replace(/^\.\//, ""))
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    const source = await fs.readFile(candidate, "utf8").catch(() => undefined)
    if (source !== undefined) return { file: candidate, source }
  }
  throw new Error(`no module for ${relative}`)
}

/** Every top-level command yargs is given, read out of `src/cli/commands.ts`. */
async function registeredCommands(): Promise<Map<string, string>> {
  const table = await fs.readFile(tablePath, "utf8")
  // Each entry ends in its loader: `async () => (await import("./cmd/x")).XCommand`.
  const entries = [...table.matchAll(/await import\("([^"]+)"\)\)\.(\w+)/g)].map((match) => ({
    relative: match[1]!.replace("./cmd/", "./cli/cmd/"),
    identifier: match[2]!,
  }))
  expect(entries.length).toBeGreaterThan(20)

  const commands = new Map<string, string>()
  for (const { identifier, relative } of entries) {
    const { source } = await readModule(relative)
    const declaration = source.indexOf(`export const ${identifier}`)
    if (declaration < 0) throw new Error(`${relative} does not export ${identifier}`)
    // The first `command:` after the declaration is the command's own spec;
    // anything later belongs to its subcommands.
    const spec = /command:\s*"([^"]+)"/.exec(source.slice(declaration))
    if (!spec) throw new Error(`${identifier} has no command spec`)
    commands.set(nameOf(spec[1]), spec[1])
  }
  return commands
}

/** The command column of the document's table. */
async function documentedCommands(): Promise<Set<string>> {
  const doc = await fs.readFile(docPath, "utf8")
  const names = new Set<string>()
  for (const row of doc.matchAll(/^\|\s*(?:`([^`]+)`|_\(default TUI\)_)\s*\|/gm)) {
    names.add(row[1] ?? "$0")
  }
  return names
}

describe("CLI command surface", () => {
  it("registers the TUI as the default command", async () => {
    const commands = await registeredCommands()
    expect(commands.get("$0")).toBe("$0 [project]")
  })

  it("documents exactly the commands that are registered", async () => {
    const registered = await registeredCommands()
    const documented = await documentedCommands()
    // `completion` is registered by `yargs.completion(...)`, not `.command()`.
    documented.delete("completion")
    expect(new RegExp('\\.completion\\("completion"').test(await fs.readFile(mainPath, "utf8"))).toBe(true)

    const missingFromDoc = [...registered.keys()].filter((name) => !documented.has(name)).sort()
    const staleInDoc = [...documented].filter((name) => !registered.has(name)).sort()
    expect({ missingFromDoc, staleInDoc }).toEqual({ missingFromDoc: [], staleInDoc: [] })
  })

  it("keeps the names the document says are deliberately not commands", async () => {
    const registered = await registeredCommands()
    // The document records these as files or drafts that never became
    // commands; a `nikcli loop` appearing silently is the drift to catch.
    for (const name of ["config", "db", "tool", "loop"]) {
      expect(registered.has(name)).toBe(false)
    }
  })
})
