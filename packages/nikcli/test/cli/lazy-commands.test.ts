import { describe, expect, it } from "bun:test"
import type { CommandModule } from "yargs"
import { LAZY_COMMANDS, lazyCommand, type LazyCommandSpec } from "@/cli/cmd/lazy"

// These tests keep the lazily-registered command table (src/cli/cmd/lazy.ts) in
// lockstep with the real command modules. The table hardcodes each command's
// static yargs metadata (command/describe/aliases) so the entrypoint can build
// help and route commands without importing the modules up front; if a module's
// metadata drifts from the table, the lazy registration would silently expose
// stale help or mis-route — these tests fail loudly instead.

function normalizeAliases(aliases: unknown): string[] {
  if (!aliases) return []
  return (Array.isArray(aliases) ? aliases : [aliases]) as string[]
}

describe("lazy command table", () => {
  it("has no duplicate command names or export names", () => {
    const names = LAZY_COMMANDS.map((s) => s.command.split(" ")[0])
    const exports = LAZY_COMMANDS.map((s) => s.export)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(exports).size).toBe(exports.length)
  })

  it("does not lazily register the default $0 TUI command (it stays eager)", () => {
    for (const spec of LAZY_COMMANDS) {
      expect(spec.command.startsWith("$0")).toBe(false)
      expect(spec.export).not.toBe("TuiThreadCommand")
    }
  })

  it("every spec resolves to a real command module via its loader", async () => {
    for (const spec of LAZY_COMMANDS) {
      const mod = (await spec.load()) as Record<string, unknown>
      const command = mod[spec.export]
      expect(command, `missing export ${spec.export} for "${spec.command}"`).toBeDefined()
    }
  }, 60_000)

  it("static metadata matches the real command modules exactly", async () => {
    const mismatches: string[] = []
    for (const spec of LAZY_COMMANDS) {
      const mod = (await spec.load()) as Record<string, CommandModule<any, any>>
      const real = mod[spec.export]
      if (!real) {
        mismatches.push(`${spec.export}: export missing`)
        continue
      }
      if (real.command !== spec.command) {
        mismatches.push(`${spec.export}: command "${String(real.command)}" !== table "${spec.command}"`)
      }
      // describe may legitimately be undefined (visible but undescribed command).
      if ((real.describe ?? undefined) !== (spec.describe ?? undefined)) {
        mismatches.push(`${spec.export}: describe ${JSON.stringify(real.describe)} !== table ${JSON.stringify(spec.describe)}`)
      }
      const realAliases = normalizeAliases(real.aliases).sort()
      const tableAliases = normalizeAliases(spec.aliases).sort()
      if (JSON.stringify(realAliases) !== JSON.stringify(tableAliases)) {
        mismatches.push(`${spec.export}: aliases ${JSON.stringify(realAliases)} !== table ${JSON.stringify(tableAliases)}`)
      }
    }
    expect(mismatches).toEqual([])
  }, 60_000)

  it("lazyCommand() produces a valid yargs CommandModule with deferred builder/handler", () => {
    const spec: LazyCommandSpec = LAZY_COMMANDS[0]
    const module = lazyCommand(spec)
    expect(module.command).toBe(spec.command)
    expect(typeof module.builder).toBe("function")
    expect(typeof module.handler).toBe("function")
  })

  it("lazyCommand() throws a clear error when the export is missing", async () => {
    const bad = lazyCommand({
      command: "ghost",
      export: "DoesNotExistCommand",
      load: async () => ({}),
    })
    // builder triggers the lazy resolve
    await expect((bad.builder as any)({ option: () => ({}), options: () => ({}) })).rejects.toThrow(
      /missing export "DoesNotExistCommand"/,
    )
  })
})
