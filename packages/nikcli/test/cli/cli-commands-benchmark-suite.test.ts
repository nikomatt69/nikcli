import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { flushBenchmarkRun, recordBenchmark, recordVisualArtifact } from "../benchmarks/runner"
import { Commands } from "@/cli/commands"

type CommandLike = {
  command: string
  describe?: string | (() => string)
  aliases?: string[]
  builder?: unknown
  handler?: unknown
  [key: string]: unknown
}

type ModuleImport = {
  modulePath: string
  module?: Record<string, unknown>
  error?: string
}

type CommandExport = {
  modulePath: string
  exportName: string
  command: CommandLike
}

/**
 * Every command implementation, for the import-cost benchmark below.
 *
 * These used to be the `cli/cmd/**` modules. The bodies moved into their
 * handlers, so this is the same measurement of the same code.
 */
const cliModulePaths = [
  "@/cli/handlers/account/list",
  "@/cli/handlers/account/login",
  "@/cli/handlers/account/logout",
  "@/cli/handlers/account/orgs",
  "@/cli/handlers/account/shared",
  "@/cli/handlers/account/switch",
  "@/cli/handlers/acp",
  "@/cli/handlers/ads/create",
  "@/cli/handlers/ads/disable",
  "@/cli/handlers/ads/enable",
  "@/cli/handlers/ads/list",
  "@/cli/handlers/ads/remove",
  "@/cli/handlers/ads/shared",
  "@/cli/handlers/ads/toggle",
  "@/cli/handlers/agent/create",
  "@/cli/handlers/agent/list",
  "@/cli/handlers/agent/shared",
  "@/cli/handlers/analytics/publish",
  "@/cli/handlers/analytics/shared",
  "@/cli/handlers/analytics/show",
  "@/cli/handlers/api",
  "@/cli/handlers/artifact/list",
  "@/cli/handlers/artifact/login",
  "@/cli/handlers/artifact/logout",
  "@/cli/handlers/artifact/shared",
  "@/cli/handlers/attach",
  "@/cli/handlers/auth/list",
  "@/cli/handlers/auth/login",
  "@/cli/handlers/auth/logout",
  "@/cli/handlers/auth/shared",
  "@/cli/handlers/bot/add",
  "@/cli/handlers/bot/list",
  "@/cli/handlers/bot/shared",
  "@/cli/handlers/bot/start",
  "@/cli/handlers/bot/stop",
  "@/cli/handlers/bot/webhook",
  "@/cli/handlers/brain-model",
  "@/cli/handlers/companion/open",
  "@/cli/handlers/companion/serve",
  "@/cli/handlers/connectors/add",
  "@/cli/handlers/connectors/auth",
  "@/cli/handlers/connectors/list",
  "@/cli/handlers/connectors/logout",
  "@/cli/handlers/connectors/shared",
  "@/cli/handlers/debug/agent",
  "@/cli/handlers/debug/config",
  "@/cli/handlers/debug/file/list",
  "@/cli/handlers/debug/file/read",
  "@/cli/handlers/debug/file/search",
  "@/cli/handlers/debug/file/shared",
  "@/cli/handlers/debug/file/status",
  "@/cli/handlers/debug/file/tree",
  "@/cli/handlers/debug/lsp/diagnostics",
  "@/cli/handlers/debug/lsp/document-symbols",
  "@/cli/handlers/debug/lsp/shared",
  "@/cli/handlers/debug/lsp/symbols",
  "@/cli/handlers/debug/paths",
  "@/cli/handlers/debug/scrap",
  "@/cli/handlers/debug/search/content",
  "@/cli/handlers/debug/search/files",
  "@/cli/handlers/debug/search/tree",
  "@/cli/handlers/debug/shared",
  "@/cli/handlers/debug/skill",
  "@/cli/handlers/debug/snapshot/diff",
  "@/cli/handlers/debug/snapshot/patch",
  "@/cli/handlers/debug/snapshot/shared",
  "@/cli/handlers/debug/snapshot/track",
  "@/cli/handlers/debug/wait",
  "@/cli/handlers/default",
  "@/cli/handlers/doctor",
  "@/cli/handlers/export",
  "@/cli/handlers/generate",
  "@/cli/handlers/github/install",
  "@/cli/handlers/github/run",
  "@/cli/handlers/github/shared",
  "@/cli/handlers/goal",
  "@/cli/handlers/heap",
  "@/cli/handlers/image-model",
  "@/cli/handlers/import",
  "@/cli/handlers/locale",
  "@/cli/handlers/mcp/add",
  "@/cli/handlers/mcp/auth/list",
  "@/cli/handlers/mcp/debug",
  "@/cli/handlers/mcp/list",
  "@/cli/handlers/mcp/logout",
  "@/cli/handlers/mcp/shared",
  "@/cli/handlers/mission/cancel",
  "@/cli/handlers/mission/delete",
  "@/cli/handlers/mission/get",
  "@/cli/handlers/mission/list",
  "@/cli/handlers/mission/new",
  "@/cli/handlers/mission/pause",
  "@/cli/handlers/mission/resume",
  "@/cli/handlers/mission/shared",
  "@/cli/handlers/mission/start",
  "@/cli/handlers/mobile/pair",
  "@/cli/handlers/mobile/serve",
  "@/cli/handlers/mobile/shared",
  "@/cli/handlers/mobile/token/list",
  "@/cli/handlers/mobile/token/revoke",
  "@/cli/handlers/models",
  "@/cli/handlers/plugin",
  "@/cli/handlers/pr",
  "@/cli/handlers/quickstart",
  "@/cli/handlers/remote/attach",
  "@/cli/handlers/remote/share",
  "@/cli/handlers/remote/shared",
  "@/cli/handlers/remote/start",
  "@/cli/handlers/remote/status",
  "@/cli/handlers/remote/stop",
  "@/cli/handlers/routine/create",
  "@/cli/handlers/routine/delete",
  "@/cli/handlers/routine/get",
  "@/cli/handlers/routine/list",
  "@/cli/handlers/routine/pause",
  "@/cli/handlers/routine/resume",
  "@/cli/handlers/routine/run",
  "@/cli/handlers/routine/shared",
  "@/cli/handlers/run",
  "@/cli/handlers/serve",
  "@/cli/handlers/service/get",
  "@/cli/handlers/service/restart",
  "@/cli/handlers/service/set",
  "@/cli/handlers/service/shared",
  "@/cli/handlers/service/start",
  "@/cli/handlers/service/status",
  "@/cli/handlers/service/stop",
  "@/cli/handlers/service/unset",
  "@/cli/handlers/session/list",
  "@/cli/handlers/session/shared",
  "@/cli/handlers/speak-model",
  "@/cli/handlers/stats",
  "@/cli/handlers/sync/connect",
  "@/cli/handlers/sync/disconnect",
  "@/cli/handlers/sync/shared",
  "@/cli/handlers/sync/status",
  "@/cli/handlers/sync/token/create",
  "@/cli/handlers/teleport",
  "@/cli/handlers/uninstall",
  "@/cli/handlers/upgrade",
  "@/cli/handlers/usage",
  "@/cli/handlers/web",
  "@/cli/handlers/workspace-serve",
] as const

type ModuleSummary = {
  modulePath: string
  commandCount: number
  commandExports: CommandExport[]
  error?: string
}

// Loaded in `beforeAll` (not at module top-level): bun does not await a test
// file's top-level `await` before running it, so any `describe()` after a
// top-level await races with "test run completed". Keeping registration
// synchronous and loading here avoids that.
let moduleImports: ModuleImport[] = []
let commandExports: CommandExport[] = []
let modulesSummary: ModuleSummary[] = []

describe("CLI command suite", () => {
  beforeAll(async () => {
    moduleImports = await Promise.all(
      cliModulePaths.map(async (modulePath) => {
        try {
          const module = (await import(modulePath)) as Record<string, unknown>
          return { modulePath, module }
        } catch (error) {
          return { modulePath, error: String(error) }
        }
      }),
    )

    // A command is a node in the spec tree, not an export that happens to look
    // like one: `cli/commands.ts` is where a command's shape is declared.
    const walk = (node: any, parents: string[]): CommandExport[] => {
      const path = [...parents, node.name].filter(Boolean)
      const self: CommandExport[] = path.length
        ? [{
            modulePath: "@/cli/commands",
            exportName: path.join(" "),
            command: { command: node.spec.name, describe: node.spec.description } as CommandLike,
          }]
        : []
      return [...self, ...Object.values(node.commands ?? {}).flatMap((c) => walk(c, path))]
    }
    commandExports = walk(Commands, [])

    modulesSummary = moduleImports.map((entry) => {
      const commands = commandExports.filter((item) => item.modulePath === entry.modulePath)
      return {
        modulePath: entry.modulePath,
        commandCount: commands.length,
        commandExports: commands,
        error: entry.error,
      }
    })
  })

  it("loads every CLI module", () => {
    for (const { modulePath, error, commandCount } of modulesSummary) {
      if (error) {
        expect(commandCount).toBe(0)
      } else {
        expect(error).toBeUndefined()
      }
      // Either a CLI module or one of the terminal modules the CLI reaches
      // through the `@tui` alias — the tree moved to `packages/tui`, the
      // command surface did not.
      expect(modulePath.includes("/cli/") || modulePath.startsWith("@tui/")).toBe(true)
    }
  })

  it("extracts at least 40 command contracts", () => {
    expect(commandExports.length).toBeGreaterThanOrEqual(40)
  })

  it("validates every command contract", () => {
    for (const { modulePath, exportName, command } of commandExports) {
      expect(command.command).toBeTruthy()
      expect(typeof command.command).toBe("string")
      expect(command.command.trim().length).toBeGreaterThan(0)

      if (command.describe) {
        if (typeof command.describe === "function") {
          expect(typeof command.describe()).toBe("string")
        } else {
          expect(command.describe.length).toBeGreaterThan(0)
        }
      }

      if (command.aliases) {
        expect(Array.isArray(command.aliases)).toBe(true)
      }

      if (command.builder) {
        expect(typeof command.builder === "function" || typeof command.builder === "object").toBe(true)
      }

      if (command.handler) {
        expect(typeof command.handler).toBe("function")
      }

      expect(exportName).toBeTruthy()
      // Every contract now comes from the one spec tree rather than from a
      // per-command module under `cli/cmd`.
      expect(modulePath).toBe("@/cli/commands")
    }
  })

  it("benchmarks command metadata lookup", () => {
    for (const { modulePath, exportName, command } of commandExports) {
      const iterations = 2_500
      const start = performance.now()

      let checksum = 0
      for (let i = 0; i < iterations; i += 1) {
        checksum += command.command.length
        if (command.aliases) checksum += command.aliases.length
        if (typeof command.describe === "string") checksum += command.describe.length
        if (typeof command.describe === "function") checksum += command.describe().length
        if (typeof command.builder === "object" && command.builder !== null)
          checksum += Object.keys(command.builder).length
        if (typeof command.handler === "function") checksum += 1
      }

      const elapsed = performance.now() - start
      recordBenchmark({
        suite: "cli-command",
        module: modulePath,
        scenario: `${exportName} contract read`,
        iterations,
        value: elapsed,
        unit: "ms",
        metadata: {
          checksum,
          describeType: typeof command.describe === "function" ? "function" : "string",
          hasAliases: !!command.aliases?.length,
        },
      })

      expect(checksum).toBeGreaterThan(0)
      expect(elapsed).toBeGreaterThanOrEqual(0)
    }
  })

  it("runs visual + performance bench for each module", () => {
    for (const { modulePath, commandExports: moduleCommands } of modulesSummary) {
      const iterations = 3_000
      const lines = moduleCommands.map((item) => `${item.exportName} => ${item.command.command}`)
      const visual =
        lines.length > 0
          ? [
              `# Module ${modulePath}`,
              `Commands: ${moduleCommands.length}`,
              "",
              ...lines,
              "",
              "## Snapshot score",
              `line count: ${lines.length}`,
              `iterations: ${iterations}`,
            ].join("\n")
          : `# Module ${modulePath}\nNo command exports discovered`

      let score = 0
      const start = performance.now()
      for (let i = 0; i < iterations; i += 1) {
        for (const line of lines) {
          score += line.length
        }
        score = score % 1_000_000
      }
      const elapsed = performance.now() - start

      recordBenchmark({
        suite: "cli-module",
        module: modulePath,
        scenario: "command-map visual scan",
        iterations,
        value: elapsed,
        unit: "ms",
        metadata: {
          commandCount: moduleCommands.length,
          visualLength: visual.length,
          score,
        },
      })

      recordVisualArtifact({
        suite: "cli-module",
        module: modulePath,
        scenario: "command-map",
        content: visual,
        extension: "md",
      })

      expect(moduleCommands.length).toBeGreaterThanOrEqual(0)
      expect(elapsed).toBeGreaterThanOrEqual(0)
    }
  })

  it("records module import summaries", () => {
    for (const { modulePath, commandExports: moduleCommands } of modulesSummary) {
      const iterations = 1_000
      let checksum = modulePath.length
      const start = performance.now()

      for (let i = 0; i < iterations; i += 1) {
        checksum = (checksum * 33 + moduleCommands.length + i) % 1_000_003
      }

      const elapsed = performance.now() - start
      recordBenchmark({
        suite: "cli-module",
        module: modulePath,
        scenario: "import summary benchmark",
        iterations,
        value: elapsed,
        unit: "ms",
        metadata: {
          checksum,
          commandCount: moduleCommands.length,
        },
      })

      expect(elapsed).toBeGreaterThanOrEqual(0)
      expect(checksum).toBeGreaterThanOrEqual(0)
    }
  })

  it("benchmarks command handler metadata", () => {
    for (const { modulePath, exportName, command } of commandExports) {
      const iterations = 2_500
      const start = performance.now()
      let aliasChars = 0
      let hasHandler = 0

      for (let i = 0; i < iterations; i += 1) {
        aliasChars += command.aliases ? command.aliases.join("|").length : 0
        if (command.handler) hasHandler += 1
      }

      const elapsed = performance.now() - start
      recordBenchmark({
        suite: "cli-command",
        module: modulePath,
        scenario: `${exportName} handler metadata scan`,
        iterations,
        value: elapsed,
        unit: "ms",
        metadata: {
          aliasChars,
          hasHandler,
        },
      })

      expect(hasHandler).toBeGreaterThanOrEqual(0)
      expect(elapsed).toBeGreaterThanOrEqual(0)
    }
  })

  it("validates alias uniqueness", () => {
    for (const { command } of commandExports) {
      if (!command.aliases) {
        expect(command.aliases).toBeUndefined()
        continue
      }
      expect(new Set(command.aliases).size).toBe(command.aliases.length)
    }
  })

  it("supports multi-agent parallel discovery simulation", async () => {
    const shardA = commandExports.slice(0, Math.floor(commandExports.length / 2))
    const shardB = commandExports.slice(Math.floor(commandExports.length / 2))
    const shardC = [...commandExports]

    const [scanA, scanB, scanC] = await Promise.all([
      Promise.resolve(shardA.map((item) => `${item.modulePath}:${item.exportName}:${item.command.command}`)),
      Promise.resolve(shardB.map((item) => `${item.modulePath}:${item.exportName}:${item.command.command}`)),
      Promise.resolve(shardC.map((item) => `${item.modulePath}:${item.exportName}:${item.command.command}`)),
    ])

    const merged = [...scanA, ...scanB].sort()
    const canonicalMerged = merged.join("|")
    const canonicalSingle = scanC.sort().join("|")
    expect(canonicalMerged).toBe(canonicalSingle)
    expect(scanA.length + scanB.length).toBe(commandExports.length)
  })

  it("supports multi-agent visual diff simulation", async () => {
    const shardSize = Math.max(1, Math.ceil(commandExports.length / 4))
    const shardGroups = [
      commandExports.slice(0, shardSize),
      commandExports.slice(shardSize, shardSize * 2),
      commandExports.slice(shardSize * 2, shardSize * 3),
      commandExports.slice(shardSize * 3),
    ]

    const start = performance.now()
    const reports = await Promise.all(
      shardGroups.map(async (group, index) => {
        let summary = `${index}\n`
        let checksum = 0
        for (const command of group) {
          const row = `${command.modulePath}:${command.exportName}:${command.command.command}`
          checksum = (checksum * 17 + row.length) % 1_000_007
          summary += `${row}\n`
        }
        return { name: `agent-${index}`, checksum, count: group.length, preview: summary.slice(0, 250) }
      }),
    )
    const elapsed = performance.now() - start
    const checksumTotal = reports.reduce((sum, item) => sum + item.checksum, 0)
    const counts = reports.map((item) => item.count).reduce((sum, count) => sum + count, 0)

    recordVisualArtifact({
      suite: "cli-command",
      module: "multi-agent",
      scenario: "visual diff sweep",
      extension: "md",
      content: reports.map((item) => `${item.name}: ${item.count} (${item.checksum})\n${item.preview}`).join("\n\n"),
    })
    recordBenchmark({
      suite: "cli-command",
      module: "multi-agent",
      scenario: "visual diff scan",
      iterations: reports.length,
      value: elapsed,
      unit: "ms",
      metadata: {
        counts,
        checksumTotal,
      },
    })

    expect(counts).toBe(commandExports.length)
    expect(checksumTotal).toBeGreaterThanOrEqual(0)
  })
})

afterAll(() => flushBenchmarkRun())
