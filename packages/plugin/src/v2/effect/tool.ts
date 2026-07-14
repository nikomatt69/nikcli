import { Effect } from "effect"
import z from "zod"
import {
  tool as promiseTool,
  type ToolAttachment,
  type ToolContext,
  type ToolProgress,
  type ToolProgressContent,
  type ToolResult,
} from "../../tool.js"

export type Context = Omit<ToolContext, "progress"> & {
  readonly progress: (update: ToolProgress) => Effect.Effect<void>
}

export type Progress = ToolProgress
export type Content = ToolProgressContent
export type Attachment = ToolAttachment
export type Result = ToolResult

export interface ToolExecuteBeforeEvent {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly callID: string
  input: unknown
}

export interface ToolExecuteAfterEvent {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly callID: string
  readonly input: unknown
  result: ToolResult
}

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: Context): Effect.Effect<ToolResult, Error>
}) {
  return promiseTool({
    description: input.description,
    args: input.args,
    execute: (args, context) =>
      Effect.runPromise(
        input.execute(args, {
          ...context,
          progress: (update) => Effect.promise(() => context.progress(update)),
        }),
      ),
  })
}

tool.schema = z
export const make = tool
export type ToolDefinition = ReturnType<typeof tool>
