import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-cmd-surface-home-"))
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
 * The registration invariant of the CLI surface
 * ([specs/v2/cli-command-surface.md](../../../../specs/v2/cli-command-surface.md)):
 * a file under `src/cli/cmd/` is not a command until it is registered, and the
 * document's table is the list of what is registered.
 *
 * This used to read `cli-main.ts` with regexes, because the list was implicit in
 * a chain of `.command(...)` calls. There is no such file any more — the tree is
 * `src/cli/commands.ts`, generated from `src/cli/registry.ts` — so the check
 * reads the tree directly. Same invariant, no parsing.
 */
const { Commands } = await import("@/cli/commands")
const docPath = path.join(import.meta.dir, "../../../../specs/v2/cli-command-surface.md")

/** Top-level command names, with `$0` standing for the default (the TUI). */
function registeredCommands(): Set<string> {
  return new Set(["$0", ...Object.keys(Commands.commands as Record<string, unknown>)])
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
  it("keeps the TUI as the default command", () => {
    // The default command is the root itself, which is why it carries the TUI's
    // description and parameters rather than being a subcommand.
    expect(registeredCommands().has("$0")).toBe(true)
    expect(Commands.spec.description).toBe("start nikcli tui")
  })

  it("documents exactly the commands that are registered", async () => {
    const registered = registeredCommands()
    const documented = await documentedCommands()
    // `completion` was a yargs built-in; effect ships shell completion as the
    // `--completions` global flag, so there is no command by that name.
    documented.delete("completion")

    const missingFromDoc = [...registered].filter((name) => !documented.has(name)).sort()
    const staleInDoc = [...documented].filter((name) => !registered.has(name)).sort()
    expect({ missingFromDoc, staleInDoc }).toEqual({ missingFromDoc: [], staleInDoc: [] })
  })

  it("keeps the names the document says are deliberately not commands", () => {
    const registered = registeredCommands()
    // The document records these as files or drafts that never became commands;
    // a `nikcli loop` appearing silently is the drift to catch.
    for (const name of ["config", "db", "tool", "loop"]) {
      expect(registered.has(name)).toBe(false)
    }
  })
})

process.on("beforeExit", () => {
  void removeTestDir(testHome)
})
