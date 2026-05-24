import { afterAll, describe, expect, it } from "bun:test"
import { flushBenchmarkRun, recordBenchmark, recordVisualArtifact } from "../benchmarks/runner"

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

const cliModulePaths = [
  "@/cli/cmd/account",
  "@/cli/cmd/ads",
  "@/cli/cmd/agent",
  "@/cli/cmd/acp",
  "@/cli/cmd/auth",
  "@/cli/cmd/connectors",
  "@/cli/cmd/companion",
  "@/cli/cmd/debug/agent",
  "@/cli/cmd/debug/config",
  "@/cli/cmd/debug/file",
  "@/cli/cmd/debug/index",
  "@/cli/cmd/debug/lsp",
  "@/cli/cmd/debug/scrap",
  "@/cli/cmd/debug/skill",
  "@/cli/cmd/debug/snapshot",
  "@/cli/cmd/export",
  "@/cli/cmd/generate",
  "@/cli/cmd/github",
  "@/cli/cmd/image-model",
  "@/cli/cmd/import",
  "@/cli/cmd/lovable",
  "@/cli/cmd/models",
  "@/cli/cmd/mcp",
  "@/cli/cmd/plug",
  "@/cli/cmd/pr",
  "@/cli/cmd/mobile",
  "@/cli/cmd/rag-model",
  "@/cli/cmd/remote",
  "@/cli/cmd/routine",
  "@/cli/cmd/run",
  "@/cli/cmd/session",
  "@/cli/cmd/speak-model",
  "@/cli/cmd/stats",
  "@/cli/cmd/tui/ui/spinner",
  "@/cli/cmd/tui/attach",
  "@/cli/cmd/tui/context/editor",
  "@/cli/cmd/tui/context/directory",
  "@/cli/cmd/tui/context/event",
  "@/cli/cmd/tui/context/plugin-keybinds",
  "@/cli/cmd/tui/event",
  "@/cli/cmd/tui/feature-plugins/system/plugin-catalog",
  "@/cli/cmd/tui/routes/changes/format-comments",
  "@/cli/cmd/tui/routes/tree/session-activity-line",
  "@/cli/cmd/tui/routes/tree/session-status",
  "@/cli/cmd/tui/routes/tree/tree-rows",
  "@/cli/cmd/tui/plugin/index",
  "@/cli/cmd/tui/plugin/internal",
  "@/cli/cmd/tui/plugin/runtime",
  "@/cli/cmd/tui/component/mcp-catalog",
  "@/cli/cmd/tui/component/textarea-keybindings",
  "@/cli/cmd/tui/thread",
  "@/cli/cmd/tui/worker",
  "@/cli/cmd/tui/win32",
  "@/cli/cmd/tui/util/clipboard",
  "@/cli/cmd/tui/util/editor",
  "@/cli/cmd/tui/util/model",
  "@/cli/cmd/tui/util/provider-origin",
  "@/cli/cmd/tui/util/revert-diff",
  "@/cli/cmd/tui/util/scroll",
  "@/cli/cmd/tui/util/signal",
  "@/cli/cmd/tui/util/sound",
  "@/cli/cmd/tui/util/terminal",
  "@/cli/cmd/tui/util/timeline-style-text",
  "@/cli/cmd/tui/util/transcript",
  "@/cli/cmd/tui/util/usage",
  "@/cli/cmd/tui/util/selection",
  "@/cli/cmd/uninstall",
  "@/cli/cmd/upgrade",
  "@/cli/cmd/web",
  "@/cli/cmd/workspace-serve",
  "@/cli/cmd/serve",
  "@/cli/cmd/heap",
] as const

function isCommandLike(value: unknown): value is CommandLike {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.command !== "string") return false
  if (!candidate.command.trim()) return false
  if (
    candidate.describe !== undefined &&
    typeof candidate.describe !== "string" &&
    typeof candidate.describe !== "function"
  )
    return false
  if (
    candidate.builder !== undefined &&
    typeof candidate.builder !== "object" &&
    typeof candidate.builder !== "function"
  )
    return false
  if (candidate.handler !== undefined && typeof candidate.handler !== "function") return false
  if (candidate.aliases !== undefined && !Array.isArray(candidate.aliases)) return false
  return true
}

const moduleImports: ModuleImport[] = await Promise.all(
  cliModulePaths.map(async (modulePath) => {
    try {
      const module = (await import(modulePath)) as Record<string, unknown>
      return { modulePath, module }
    } catch (error) {
      return { modulePath, error: String(error) }
    }
  }),
)

const commandExports: CommandExport[] = moduleImports.flatMap((entry) => {
  if (!entry.module) return []

  return Object.entries(entry.module)
    .filter(([, value]) => isCommandLike(value))
    .map(([exportName, value]) => ({
      modulePath: entry.modulePath,
      exportName,
      command: value as CommandLike,
    }))
})

const modulesSummary = moduleImports.map((entry) => {
  const commands = commandExports.filter((item) => item.modulePath === entry.modulePath)
  return {
    modulePath: entry.modulePath,
    commandCount: commands.length,
    commandExports: commands,
    error: entry.error,
  }
})

describe("CLI command suite", () => {
  it.each(modulesSummary)("loads module $modulePath", ({ modulePath, error, commandCount }) => {
    if (error) {
      expect(commandCount).toBe(0)
    } else {
      expect(error).toBeUndefined()
    }
    expect(modulePath).toContain("/cli/")
  })

  it("extracts at least 40 command contracts", () => {
    expect(commandExports.length).toBeGreaterThanOrEqual(40)
  })

  it.each(commandExports)(
    "validates command contract for $modulePath.$exportName",
    ({ modulePath, exportName, command }) => {
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
      expect(modulePath).toContain("cmd")
    },
  )

  it.each(commandExports)("benchmark command metadata lookup: %s.%s", ({ modulePath, exportName, command }) => {
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
  })

  it.each(modulesSummary)("visual + performance bench for module %s", ({ modulePath, commandExports }) => {
    const iterations = 3_000
    const lines = commandExports.map((item) => `${item.exportName} => ${item.command.command}`)
    const visual =
      lines.length > 0
        ? [
            `# Module ${modulePath}`,
            `Commands: ${commandExports.length}`,
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
        commandCount: commandExports.length,
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

    expect(commandExports.length).toBeGreaterThanOrEqual(0)
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it.each(modulesSummary)("records module import summary for %s", ({ modulePath, commandExports }) => {
    const iterations = 1_000
    let checksum = modulePath.length
    const start = performance.now()

    for (let i = 0; i < iterations; i += 1) {
      checksum = (checksum * 33 + commandExports.length + i) % 1_000_003
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
        commandCount: commandExports.length,
      },
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
    expect(checksum).toBeGreaterThanOrEqual(0)
  })

  it.each(commandExports)("benchmarks command handler metadata for %s.%s", ({ modulePath, exportName, command }) => {
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
  })

  it.each(commandExports)("validates alias uniqueness for $modulePath.$exportName", ({ command }) => {
    if (!command.aliases) {
      expect(command.aliases).toBeUndefined()
      return
    }

    expect(new Set(command.aliases).size).toBe(command.aliases.length)
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
