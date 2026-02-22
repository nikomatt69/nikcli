import type { Plugin, PluginInput } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"
import { readFile } from "fs/promises"
import { join } from "path"

interface TestConfig {
  framework: "vitest" | "jest" | "pytest" | "go" | "bun" | "unknown"
  testPattern: string
  configFile: string | null
}

async function detectTestFramework(cwd: string): Promise<TestConfig> {
  try {
    const proc = Bun.spawn(["ls", "-la"], { cwd })
    const output = await new Response(proc.stdout).text()
    const fileList = output
      .split("\n")
      .map((f) => f.split(/\s+/).pop())
      .filter(Boolean)

    if (
      fileList.includes("vitest.config.ts") ||
      fileList.includes("vitest.config.js") ||
      fileList.includes("vite.config.ts")
    ) {
      return { framework: "vitest", testPattern: "**/*.test.{ts,tsx,js,jsx}", configFile: "vitest.config.ts" }
    }

    if (fileList.includes("jest.config.js") || fileList.includes("jest.config.ts")) {
      return { framework: "jest", testPattern: "**/*.test.{js,ts,jsx,tsx}", configFile: "jest.config.js" }
    }

    if (fileList.includes("pytest.ini") || fileList.includes("pyproject.toml") || fileList.includes("setup.cfg")) {
      return { framework: "pytest", testPattern: "test_*.py", configFile: "pytest.ini" }
    }

    if (fileList.includes("go.mod")) {
      return { framework: "go", testPattern: "*_test.go", configFile: null }
    }

    if (fileList.includes("bun.lockb")) {
      return { framework: "bun", testPattern: "**/*.test.{ts,js}", configFile: null }
    }
  } catch {}

  return { framework: "unknown", testPattern: "**/*.test.{ts,js}", configFile: null }
}

async function runCommand(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited

  return { stdout, stderr, exitCode }
}

export const TestingPlugin: Plugin = async (input: PluginInput) => {
  return {
    tool: {
      test_run: tool({
        description: "Run tests using the detected test framework",
        args: {
          pattern: tool.schema.string().optional().describe("Test file pattern to run"),
          watch: tool.schema.boolean().optional().describe("Run in watch mode"),
          coverage: tool.schema.boolean().optional().describe("Generate coverage report"),
          update: tool.schema.boolean().optional().describe("Update snapshots"),
          grep: tool.schema.string().optional().describe("Run only tests matching this pattern"),
        },
        async execute(args, _ctx) {
          const cwd = input.directory
          const config = await detectTestFramework(cwd)

          if (config.framework === "unknown") {
            return "Could not detect test framework. No vitest, jest, pytest, or go test config found."
          }

          let cmd: string[] = []

          switch (config.framework) {
            case "vitest": {
              cmd = ["npx", "vitest", "run"]
              if (args.pattern) cmd.push(args.pattern)
              if (args.watch) cmd.push("--watch")
              if (args.coverage) cmd.push("--coverage")
              if (args.update) cmd.push("--update")
              if (args.grep) cmd.push("--testNamePattern", args.grep)
              break
            }
            case "jest": {
              cmd = ["npx", "jest"]
              if (args.pattern) cmd.push(args.pattern)
              if (args.watch) cmd.push("--watch")
              if (args.coverage) cmd.push("--coverage")
              if (args.update) cmd.push("--updateSnapshots")
              if (args.grep) cmd.push("--testNamePattern", args.grep)
              break
            }
            case "pytest": {
              cmd = ["python", "-m", "pytest"]
              if (args.pattern) cmd.push(args.pattern.replace("test_", "").replace(".py", ""))
              if (args.coverage) cmd.push("--cov")
              if (args.update) cmd.push("--snapshot-update")
              if (args.grep) cmd.push("-k", args.grep)
              break
            }
            case "go": {
              cmd = ["go", "test", "-v"]
              if (args.pattern) cmd.push(`./.../${args.pattern}`)
              if (args.coverage) cmd.push("-cover")
              if (args.grep) cmd.push("-run", args.grep)
              break
            }
            case "bun": {
              cmd = ["bun", "test"]
              if (args.pattern) cmd.push(args.pattern)
              if (args.watch) cmd.push("--watch")
              break
            }
          }

          const { stdout, stderr, exitCode } = await runCommand(cmd, cwd)

          const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "")
          const summary = exitCode === 0 ? "✅ Tests passed" : `❌ Tests failed (exit code: ${exitCode})`

          return `${summary}\n\nCommand: ${cmd.join(" ")}\n\n${output.slice(-5000)}`
        },
      }),

      test_coverage: tool({
        description: "Run tests with coverage and display the report",
        args: {
          format: tool.schema
            .enum(["text", "html", "lcov", "json"])
            .optional()
            .describe("Coverage format (default: text)"),
          threshold: tool.schema.number().optional().describe("Fail if coverage below this percentage"),
        },
        async execute(args, _ctx) {
          const cwd = input.directory
          const config = await detectTestFramework(cwd)

          if (config.framework === "unknown") {
            return "Could not detect test framework"
          }

          let cmd: string[] = []

          switch (config.framework) {
            case "vitest": {
              cmd = ["npx", "vitest", "run", "--coverage"]
              if (args.threshold) cmd.push(`--coverage.threshold.${args.threshold}`)
              break
            }
            case "jest": {
              cmd = ["npx", "jest", "--coverage"]
              if (args.threshold) cmd.push(`--coverageThreshold.global.branches`, String(args.threshold))
              break
            }
            case "pytest": {
              cmd = ["python", "-m", "pytest", "--cov", "--cov-report", args.format ?? "term"]
              break
            }
            case "go": {
              cmd = ["go", "test", "-coverprofile=coverage.out", "-covermode=atomic"]
              await runCommand(cmd, cwd)
              cmd = ["go", "tool", "cover", "-func=coverage.out"]
              break
            }
            default:
              return `Coverage not supported for ${config.framework}`
          }

          const { stdout, stderr, exitCode } = await runCommand(cmd, cwd)

          const output = stdout + (stderr ? `\n${stderr}` : "")
          return `Coverage Report:\n\n${output.slice(-3000)}`
        },
      }),

      test_watch: tool({
        description: "Run tests in watch mode for automatic rerun on file changes",
        args: {
          pattern: tool.schema.string().optional().describe("Test file pattern"),
          grep: tool.schema.string().optional().describe("Filter tests by name"),
        },
        async execute(args, _ctx) {
          const cwd = input.directory
          const config = await detectTestFramework(cwd)

          if (config.framework === "unknown") {
            return "Could not detect test framework"
          }

          let cmd: string[] = []

          switch (config.framework) {
            case "vitest": {
              cmd = ["npx", "vitest"]
              if (args.grep) cmd.push("--testNamePattern", args.grep)
              cmd.push("watch")
              break
            }
            case "jest": {
              cmd = ["npx", "jest", "--watch"]
              if (args.grep) cmd.push("--testNamePattern", args.grep)
              break
            }
            case "pytest": {
              cmd = ["python", "-m", "pytest", "-k", args.grep ?? "", "-x", "--watch"]
              break
            }
            case "bun": {
              cmd = ["bun", "test", "--watch"]
              break
            }
            default:
              return `Watch mode not supported for ${config.framework}`
          }

          if (args.pattern) cmd.push(args.pattern)

          const { stdout, exitCode } = await runCommand(cmd, cwd)

          return `Watch mode started:\n\nCommand: ${cmd.join(" ")}\n\n${stdout.slice(-2000)}`
        },
      }),

      test_debug: tool({
        description: "Debug a single test file with verbose output",
        args: {
          file: tool.schema.string().describe("Test file to debug"),
          grep: tool.schema.string().optional().describe("Test name to focus"),
        },
        async execute(args, _ctx) {
          const cwd = input.directory
          const config = await detectTestFramework(cwd)

          let cmd: string[] = []

          switch (config.framework) {
            case "vitest": {
              cmd = ["npx", "vitest", "run", args.file, "-v"]
              if (args.grep) cmd.push("--testNamePattern", args.grep)
              break
            }
            case "jest": {
              cmd = ["npx", "jest", args.file, "--verbose"]
              if (args.grep) cmd.push("--testNamePattern", args.grep)
              break
            }
            case "pytest": {
              cmd = ["python", "-m", "pytest", args.file, "-v", "-s"]
              if (args.grep) cmd.push("-k", args.grep)
              break
            }
            case "go": {
              cmd = ["go", "test", "-v", "-run", args.grep ?? ".", args.file.replace("_test.go", "")]
              break
            }
            case "bun": {
              cmd = ["bun", "test", args.file, "-v"]
              break
            }
            default:
              return "Unknown test framework"
          }

          const { stdout, stderr, exitCode } = await runCommand(cmd, cwd)

          return `Debug output for ${args.file}:\n\n${stdout}\n${stderr}\n\nExit code: ${exitCode}`
        },
      }),

      test_list: tool({
        description: "List all available tests in the project",
        args: {
          pattern: tool.schema.string().optional().describe("Filter by pattern"),
        },
        async execute(args, _ctx) {
          const cwd = input.directory
          const config = await detectTestFramework(cwd)

          let cmd: string[] = []

          switch (config.framework) {
            case "vitest": {
              cmd = ["npx", "vitest", "list"]
              break
            }
            case "jest": {
              cmd = ["npx", "jest", "--listTests"]
              break
            }
            case "pytest": {
              cmd = ["python", "-m", "pytest", "--collect-only", "-q"]
              break
            }
            case "go": {
              cmd = ["go", "test", "-list", "."]
              break
            }
            case "bun": {
              cmd = ["bun", "test", "--print"]
              break
            }
            default:
              return "Unknown test framework"
          }

          const { stdout, exitCode } = await runCommand(cmd, cwd)

          if (args.pattern) {
            const filtered = stdout
              .split("\n")
              .filter((line) => line.toLowerCase().includes(args.pattern!.toLowerCase()))
              .join("\n")
            return filtered || "No tests match the pattern"
          }

          return `Available tests:\n\n${stdout}`
        },
      }),
    },
  }
}

export default TestingPlugin
