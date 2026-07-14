export {
  tool,
  tool as make,
  type ToolAttachment as Attachment,
  type ToolContext as Context,
  type ToolDefinition,
  type ToolProgress as Progress,
  type ToolProgressContent as Content,
  type ToolResult as Result,
} from "../../tool.js"

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
  result: import("../../tool.js").ToolResult
}
