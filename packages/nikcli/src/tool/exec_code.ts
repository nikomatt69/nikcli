import z from "zod"
import { Tool } from "./tool"
import { NativeExecutor } from "@/session/native-executor"
import { Log } from "@/util/log"
import DESCRIPTION from "./exec_code.txt"

const log = Log.create({ service: "tool.exec_code" })

// Tools excluded from the exec_code runtime to avoid recursion or UI dependencies
const EXCLUDED = new Set([
  "exec_code",
  "invalid",
  "question",
  "plan",
  "plan_enter",
  "plan_exit",
  "advisor",
  "delegator",
  "delegation",
  "opentui",
  "speak",
])

export const ExecCodeTool = Tool.define("exec_code", async (initCtx) => {
  // Use ids() instead of tools() — tools() would call init() on every tool recursively
  const { ToolRegistry } = await import("./registry")
  const { runPromiseWithLayer } = await import("@/effect")
  const { Effect } = await import("effect")
  const allIds = await runPromiseWithLayer(
    ToolRegistry.defaultLayer,
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      return yield* registry.ids()
    }),
  )
  const bridgeableIds = allIds.filter((id) => !EXCLUDED.has(id))
  const availableNames = bridgeableIds.join(", ")

  return {
    description: `${DESCRIPTION}\n\nAvailable tools: ${availableNames}`,
    parameters: z.object({
      code: z.string().describe("JavaScript/TypeScript code to execute. Tools are available as async globals."),
      timeout: z
        .number()
        .int()
        .min(1)
        .max(120)
        .optional()
        .default(30)
        .describe("Execution timeout in seconds (default: 30, max: 120)"),
    }),

    async execute({ code, timeout }, ctx) {
      const timeoutMs = Math.min((timeout ?? 30) * 1000, 120_000)

      // Safe to call tools() here: ExecCodeTool.init now uses ids(), breaking the recursion
      const { ToolRegistry: TR } = await import("./registry")
      const availableTools = await runPromiseWithLayer(
        TR.defaultLayer,
        Effect.gen(function* () {
          const registry = yield* TR.Service
          return yield* registry.tools({ providerID: "", modelID: "" }, initCtx?.agent)
        }),
      )
      const bridgeable = availableTools.filter((t) => !EXCLUDED.has(t.id))

      const bridge: NativeExecutor.ToolBridge = {}
      for (const t of bridgeable) {
        bridge[t.id] = async (args) => {
          try {
            const result = await t.execute(args as any, ctx)
            return result.output
          } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`
          }
        }
      }

      log.info("exec_code start", { codeLength: code.length, toolCount: Object.keys(bridge).length })

      const result = await NativeExecutor.run({ code, toolBridge: bridge, timeoutMs })

      log.info("exec_code done", {
        success: result.success,
        durationMs: result.durationMs,
        outputLength: result.stdout.length,
      })

      const output = result.success
        ? result.stdout || "(no output)"
        : `Error: ${result.stderr}${result.stdout ? `\nOutput so far:\n${result.stdout}` : ""}`

      return {
        title: `exec_code (${result.durationMs}ms)`,
        output,
        metadata: {
          truncated: false,
          success: result.success,
          durationMs: result.durationMs,
        },
      }
    },
  }
})
