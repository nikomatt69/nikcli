import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"

const DISALLOWED = new Set(["batch"])
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])

export const BatchTool = Tool.define("batch", async () => {
  return {
    description: DESCRIPTION,
    parameters: zod(
      Schema.Struct({
        tool_calls: Schema.Array(
          Schema.Struct({
            tool: Schema.String.annotate({ description: "The name of the tool to execute" }),
            parameters: Schema.Record(Schema.String, Schema.Unknown).annotate({
              description: "Parameters for the tool",
            }),
          }),
        )
          .pipe(Schema.check(Schema.isMinLength(1)))
          .annotate({ description: "Array of tool calls to execute in parallel" }),
      }),
    ),
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")

      return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
    },
    async execute(params, ctx) {
      const { Session } = await import("../session")
      const { Identifier } = await import("../id/id")

      const toolCalls = params.tool_calls.slice(0, 25)
      const discardedCalls = params.tool_calls.slice(25)

      const { ToolRegistry } = await import("./registry")
      const { runPromiseWithLayer, withCurrentInstance } = await import("@/effect")
      const { Effect } = await import("effect")
      const availableTools = await runPromiseWithLayer(
        ToolRegistry.defaultLayer,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.tools({ modelID: "", providerID: "" })
        }),
      )
      const toolMap = new Map(availableTools.map((t) => [t.id, t]))
      const updatePart = (part: import("../session/message-v2").MessageV2.Part) =>
        runPromiseWithLayer(
          Session.defaultLayer,
          withCurrentInstance(
            Effect.gen(function* () {
              const session = yield* Session.Service
              return yield* session.updatePart(part)
            }),
          ),
        )

      const executeCall = async (call: (typeof toolCalls)[0]) => {
        const callStartTime = Date.now()
        const partID = Identifier.ascending("part")

        try {
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          const tool = toolMap.get(call.tool)
          if (!tool) {
            const availableToolsList = Array.from(toolMap.keys()).filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name))
            throw new Error(
              `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${availableToolsList.join(", ")}`,
            )
          }
          const validatedParams = tool.parameters.parse(call.parameters)

          await updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "running",
              input: call.parameters,
              time: {
                start: callStartTime,
              },
            },
          })

          const result = await tool.executeAsync(validatedParams, { ...ctx, callID: partID })

          await updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "completed",
              input: call.parameters,
              output: result.output,
              title: result.title,
              metadata: result.metadata,
              attachments: result.attachments,
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: true as const, tool: call.tool, result }
        } catch (error) {
          await updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "error",
              input: call.parameters,
              error: error instanceof Error ? error.message : String(error),
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: false as const, tool: call.tool, error }
        }
      }

      const results = await Promise.all(toolCalls.map((call) => executeCall(call)))

      // Add discarded calls as errors
      const now = Date.now()
      for (const call of discardedCalls) {
        const partID = Identifier.ascending("part")
        await updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: call.tool,
          callID: partID,
          state: {
            status: "error",
            input: call.parameters,
            error: "Maximum of 25 tools allowed in batch",
            time: { start: now, end: now },
          },
        })
        results.push({
          success: false as const,
          tool: call.tool,
          error: new Error("Maximum of 25 tools allowed in batch"),
        })
      }

      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = results.length - successfulCalls

      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
          : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successfulCalls}/${results.length} successful)`,
        output: outputMessage,
        attachments: results.filter((result) => result.success).flatMap((r) => r.result.attachments ?? []),
        metadata: {
          totalCalls: results.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: params.tool_calls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
  }
})
