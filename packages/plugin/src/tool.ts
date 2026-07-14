import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  callID: string
  agent: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  progress(input: ToolProgress): Promise<void>
  ask(input: AskInput): Promise<void>
}

export type ToolProgressContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly data: string; readonly mime: string; readonly name?: string }

export type ToolProgress = {
  readonly structured: Readonly<Record<string, unknown>>
  readonly content?: ReadonlyArray<ToolProgressContent>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}

export type ToolAttachment = {
  type: "file"
  mime: string
  url: string
  filename?: string
}

export type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: Record<string, any>
      attachments?: ToolAttachment[]
    }

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
