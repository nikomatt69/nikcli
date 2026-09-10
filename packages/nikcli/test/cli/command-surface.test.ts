import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import path from "path"

/**
 * The registration invariant of the CLI surface
 * ([specs/v2/cli-command-surface.md](../../../../specs/v2/cli-command-surface.md)):
 * a file under `src/cli/cmd/` is not a command until `cli-main.ts` registers
 * it, and the document's table is the list of what is registered.
 *
 * Read from source rather than by running `--help`: the help subprocess is
 * already known to time out under parallel load, and a coherence check that
 * flakes is a check people learn to re-run instead of read.
 */

const packageRoot = path.join(import.meta.dir, "../..")
const mainPath = path.join(packageRoot, "src/cli-main.ts")
const docPath = path.join(packageRoot, "../../specs/cli-command-surface.md")

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

/** Every top-level command yargs is given, read out of `cli-main.ts`. */
async function registeredCommands(): Promise<Map<string, string>> {
  const main = await fs.readFile(mainPath, "utf8")
  const identifiers = [...main.matchAll(/\.command\((\w+)\)/g)].map((match) => match[1])
  expect(identifiers.length).toBeGreaterThan(20)

  const modulePaths = new Map<string, string>()
  for (const statement of main.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    for (const clause of statement[1].split(",")) {
      const local = clause
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (local) modulePaths.set(local, statement[2])
    }
  }

  const commands = new Map<string, string>()
  for (const identifier of identifiers) {
    const relative = modulePaths.get(identifier)
    if (!relative) throw new Error(`${identifier} is registered but never imported`)
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
