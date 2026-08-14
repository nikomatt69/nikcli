import { Cause, Effect } from "effect"
import z from "zod"
import { Tool } from "./tool"
import { CodeMode, Tool as ConfinedTool, toolError } from "@/codemode"
import { Log } from "@/util/log"
import DESCRIPTION from "./code_mode.txt"

const Parameters = z.object({
  code: z.string().describe("Program body executed by the confined interpreter. Tools live under `tools.*`."),
  timeout: z.number().int().min(1).max(120).optional().describe("Execution timeout in seconds (default: 30, max: 120)"),
  maxToolCalls: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .optional()
    .describe("Maximum admitted nested tool calls (default: unlimited, max: 1000)"),
  maxOutputBytes: z
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .optional()
    .describe("Maximum UTF-8 bytes retained from the result and logs (default: unlimited, max: 10000000)"),
})

const log = Log.create({ service: "tool.code_mode" })

// Tools excluded from the confined runtime to avoid recursion or UI dependencies
const EXCLUDED = new Set([
  "code_mode",
  "exec_code",
  "batch",
  "invalid",
  "question",
  "plan",
  "plan_enter",
  "plan_exit",
  "advisor",
  "delegator",
  "delegation",
  "opentui",
  "tui_app",
  "speak",
])

const PINNED = new Set(["glob", "grep", "read"])

/**
 * How much of the bridged catalog to inline as full call signatures.
 *
 * Every tool CodeMode bridges is also advertised to the model as a native tool
 * in the same request, so a full signature here is the second copy of a schema
 * the model already has — measured at 11.4 KB of the tool surface, all of it
 * duplicate. Below the budget the catalog degrades to one line per tool: the
 * ids are flat, so each becomes its own namespace and the model still sees
 * every name, which is what tells it the tool exists. Exact arguments come
 * from the native advertisement, or from CodeMode's own `search`.
 *
 * Pinned tools are charged before the budget applies, so `glob`, `grep` and
 * `read` keep their signatures inline: they are the ones a program reaches for
 * first, and three lines is a cheap hedge against a wasted turn.
 */
const CATALOG_BUDGET = 0

type CallEntry = {
  tool: string
  status: "running" | "completed" | "error" | "interrupted"
  input?: Record<string, unknown>
}

function renderSchema(schema: z.ZodType, io: "input" | "output" = "input"): ConfinedTool.JsonSchema {
  // Render-only signature for the program; real validation stays in the tool's own zod parse.
  try {
    return z.toJSONSchema(schema, { io }) as ConfinedTool.JsonSchema
  } catch {
    return { type: "object" }
  }
}

export const CodeModeTool = Tool.define<typeof Parameters, Tool.Metadata>("code_mode", async (initCtx) => {
  const { ToolRegistry } = await import("./registry")
  const { runPromiseWithLayer, AppRuntime } = await import("@/effect")
  // Exclude recursive/UI-only tools before init so the model-visible catalog can use
  // CodeMode's exact, token-budgeted call signatures rather than a flat name list.
  const bridgeable = await runPromiseWithLayer(
    ToolRegistry.defaultLayer,
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      return yield* registry.tools({ providerID: "", modelID: "" }, initCtx?.agent, { exclude: EXCLUDED })
    }),
  )

  const catalogTree: Record<string, ConfinedTool.Definition> = {}
  for (const tool of bridgeable) {
    catalogTree[tool.id] = ConfinedTool.make({
      description: tool.description.split("\n", 1)[0] ?? "",
      input: renderSchema(tool.parameters),
      output: tool.output ? renderSchema(tool.output, "output") : undefined,
      pinned: PINNED.has(tool.id),
      run: () => Effect.die("Catalog-only Code Mode tool cannot execute"),
    })
  }
  const catalog = CodeMode.make({ tools: catalogTree, discovery: { catalogBudget: CATALOG_BUDGET } }).instructions()

  return {
    description: `${DESCRIPTION}\n\n${catalog}`,
    parameters: Parameters,

    async execute({ code, timeout, maxToolCalls, maxOutputBytes }, ctx) {
      const timeoutMs = Math.min((timeout ?? 30) * 1000, 120_000)

      const calls: CallEntry[] = []
      const publish = () =>
        ctx.metadata({
          title: "code_mode",
          metadata: { toolCalls: calls.map((c) => ({ ...c })) },
        })

      const tree: Record<string, ConfinedTool.Definition> = {}
      for (const t of bridgeable) {
        tree[t.id] = ConfinedTool.make({
          description: t.description.split("\n", 1)[0] ?? "",
          input: renderSchema(t.parameters),
          output: t.output ? renderSchema(t.output, "output") : undefined,
          run: (input) =>
            t.execute((input ?? {}) as z.infer<typeof t.parameters>, ctx).pipe(
              Effect.map((result) => Tool.encoded(result, t.output)),
              Effect.catchCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
                const error = Cause.squash(cause)
                return Effect.fail(toolError(error instanceof Error ? error.message : String(error), error))
              }),
            ),
        })
      }

      const runtime = CodeMode.make({
        tools: tree,
        limits: { timeoutMs, maxToolCalls, maxOutputBytes },
        onToolCallStart: ({ index, name, input }) =>
          Effect.sync(() => {
            const shown =
              input !== null && typeof input === "object" && !Array.isArray(input)
                ? (input as Record<string, unknown>)
                : undefined
            calls[index] = {
              tool: name,
              status: "running",
              ...(shown && Object.keys(shown).length > 0 ? { input: shown } : {}),
            }
            publish()
          }),
        onToolCallEnd: ({ index, outcome }) =>
          Effect.sync(() => {
            const current = calls[index]
            // An aborted run is not a tool failure — reporting it as one blames the
            // tool for the user's cancellation. Before interruption was observable
            // these calls simply stayed "running" forever.
            if (current)
              calls[index] = {
                ...current,
                status: outcome === "success" ? "completed" : outcome === "interrupted" ? "interrupted" : "error",
              }
            publish()
          }),
      })

      const abort = Effect.callback<void>((resume) => {
        if (ctx.abort.aborted) return resume(Effect.void)
        const handler = () => resume(Effect.void)
        ctx.abort.addEventListener("abort", handler, { once: true })
        return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
      })
      const cancelled = (): CodeMode.Result => ({
        ok: false,
        error: { kind: "ExecutionFailure", message: "Execution cancelled." },
        toolCalls: calls.map((call) => ({ name: call.tool })),
      })

      log.info("code_mode start", {
        codeLength: code.length,
        toolCount: Object.keys(tree).length,
      })
      const started = Date.now()
      const result = await AppRuntime.runPromise(
        Effect.raceFirst(runtime.execute(code), abort.pipe(Effect.map(cancelled))),
      )
      const durationMs = Date.now() - started
      log.info("code_mode done", {
        ok: result.ok,
        durationMs,
        toolCalls: result.toolCalls.length,
      })

      const logs = result.logs ?? []
      const withLogs = (text: string) => {
        if (logs.length === 0) return text
        return text.length > 0 ? `${text}\n\nLogs:\n${logs.join("\n")}` : `Logs:\n${logs.join("\n")}`
      }

      if (!result.ok) {
        ctx.metadata({
          title: `code_mode (${durationMs}ms)`,
          metadata: {
            success: false,
            truncated: result.truncated ?? false,
            toolCalls: calls,
            durationMs,
          },
        })
        const hints = (result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))
        throw new Error(withLogs([result.error.message, ...hints].join("\n")))
      }

      const output =
        typeof result.value === "string"
          ? result.value
          : (JSON.stringify(result.value, null, 2) ?? String(result.value))

      return {
        title: `code_mode (${durationMs}ms)`,
        output: withLogs(output) || "(no output)",
        metadata: {
          success: true,
          truncated: result.truncated ?? false,
          toolCalls: calls,
          durationMs,
          ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings.map((w) => w.message) } : {}),
        },
      }
    },
  }
})
