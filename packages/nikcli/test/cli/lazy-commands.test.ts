import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import type { CommandModule } from "yargs"
import { Commands } from "../../src/cli/commands"

/**
 * `src/cli/commands.ts` restates each command's `command`/`describe`/`aliases`
 * so yargs can route argv and render `--help` without evaluating 45 module
 * graphs (see `src/cli/cmd/lazy.ts` for why that matters — it is the difference
 * between a ~400MB and a ~90MB `nikcli --version`).
 *
 * Restating it means it can drift from the implementation, and drift is silent:
 * help text goes stale, or a renamed positional stops parsing, with nothing to
 * catch it. These tests make the duplication safe by loading every real module
 * and comparing.
 */

const COMMANDS_SRC = resolve(__dirname, "../../src/cli/commands.ts")

/** Load each table entry's implementation the way `lazyCmd` does. */
async function loadImplementations(): Promise<Map<string, CommandModule<any, any>>> {
  const source = readFileSync(COMMANDS_SRC, "utf8")
  const specs = [...source.matchAll(/await import\("(\.\/cmd\/[^"]+)"\)\)\.(\w+)/g)]
  const loaded = new Map<string, CommandModule<any, any>>()
  for (const [, spec, exportName] of specs) {
    const mod: Record<string, any> = await import(spec!.replace("./cmd/", "../../src/cli/cmd/"))
    const command = mod[exportName!]
    expect(command, `${spec} does not export ${exportName}`).toBeDefined()
    loaded.set(command.command, command)
  }
  return loaded
}

describe("lazy command table", () => {
  it("declares every command exactly once", () => {
    const names = Commands.map((c) => c.command)
    expect(names).toEqual([...new Set(names)])
    expect(names.length).toBeGreaterThan(0)
  })

  it("registers exactly one default command", () => {
    // yargs silently lets the last `$0` win, so a second one would quietly
    // change what bare `nikcli` starts.
    const defaults = Commands.filter((c) => String(c.command).startsWith("$0"))
    expect(defaults.length).toBe(1)
  })

  it("keeps metadata in sync with each implementation", async () => {
    const implementations = await loadImplementations()

    // Every implementation the table points at must be reachable by its own
    // `command` string — that is what proves the strings agree.
    expect(implementations.size).toBe(Commands.length)

    for (const entry of Commands) {
      const real = implementations.get(entry.command as string)
      expect(real, `no implementation whose command is ${JSON.stringify(entry.command)}`).toBeDefined()
      expect(real!.describe, `describe drifted for ${entry.command}`).toEqual(entry.describe)
      expect(real!.aliases, `aliases drifted for ${entry.command}`).toEqual(entry.aliases as any)
    }
  })

  it("routes argv to the implementation's handler", async () => {
    // Guards the `lazyCmd` indirection itself: metadata matching is worthless
    // if `builder`/`handler` do not actually reach the loaded module.
    const entry = Commands.find((c) => c.command === "heap")
    expect(entry).toBeDefined()

    const yargsModule = await import("yargs")
    let ran = false
    const original = console.log
    console.log = () => {}
    try {
      await yargsModule
        .default([])
        .command({
          ...entry!,
          handler: async (args: any) => {
            ran = true
            return entry!.handler(args)
          },
        })
        .parse(["heap"])
    } finally {
      console.log = original
    }
    expect(ran).toBe(true)
  })

  it("keeps cli-main free of static command imports", () => {
    // The whole saving is that no `./cli/cmd/*` module is in the entry's static
    // graph. A single re-added import puts its subgraph back on every run.
    const cliMain = readFileSync(resolve(__dirname, "../../src/cli-main.ts"), "utf8")
    const staticImports = [...cliMain.matchAll(/^import .* from "\.\/cli\/cmd\/.*"$/gm)].map((m) => m[0])
    expect(staticImports).toEqual([])
  })
})
