export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "delegate" | "dontAsk"

export interface ContentBlockText {
  type: "text"
  text: string
}

export interface ContentBlockToolUse {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ContentBlockToolResult {
  type: "tool_result"
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

export interface ContentBlockThinking {
  type: "thinking"
  thinking: string
  budget_tokens?: number
}

export type ContentBlock = ContentBlockText | ContentBlockToolUse | ContentBlockToolResult | ContentBlockThinking

export interface SDKUserMessage {
  type: "user"
  message: {
    role: "user"
    content: string | ContentBlock[]
  }
  parent_tool_use_id: string | null
  session_id: string
  uuid?: string
  isSynthetic?: boolean
}

export interface SDKSystemInitMessage {
  type: "system"
  subtype: "init"
  cwd: string
  session_id: string
  tools: string[]
  mcp_servers: { name: string; status: string }[]
  model: string
  permissionMode: PermissionMode
  apiKeySource: string
  claude_code_version: string
  slash_commands: string[]
  agents?: string[]
  skills?: string[]
  plugins?: { name: string; path: string }[]
  output_style: string
  uuid: string
}

export interface SDKSystemStatusMessage {
  type: "system"
  subtype: "status"
  status: "compacting" | null
  permissionMode?: PermissionMode
  uuid: string
  session_id: string
}

export interface SDKAssistantMessage {
  type: "assistant"
  message: {
    id: string
    type: "message"
    role: "assistant"
    model: string
    content: ContentBlock[]
    stop_reason: string | null
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
    }
  }
  parent_tool_use_id: string | null
  error?: "authentication_failed" | "billing_error" | "rate_limit" | "invalid_request" | "server_error" | "unknown"
  uuid: string
  session_id: string
}

export interface SDKStreamEventMessage {
  type: "stream_event"
  event: unknown
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

export interface SDKResultSuccessMessage {
  type: "result"
  subtype: "success"
  is_error: false
  result: string
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  total_cost_usd: number
  stop_reason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  modelUsage: Record<
    string,
    {
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
      cacheCreationInputTokens: number
      webSearchRequests: number
      costUSD: number
      contextWindow: number
      maxOutputTokens: number
    }
  >
  permission_denials: {
    tool_name: string
    tool_use_id: string
    tool_input: Record<string, unknown>
  }[]
  uuid: string
  session_id: string
}

export interface SDKResultErrorMessage {
  type: "result"
  subtype: "error_during_execution" | "error_max_turns" | "error_max_budget_usd" | "error_max_structured_output_retries"
  is_error: true
  errors: string[]
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  total_cost_usd: number
  stop_reason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  modelUsage: Record<string, unknown>
  permission_denials: {
    tool_name: string
    tool_use_id: string
    tool_input: Record<string, unknown>
  }[]
  uuid: string
  session_id: string
}

export type SDKResultMessage = SDKResultSuccessMessage | SDKResultErrorMessage

export interface SDKControlRequest {
  type: "control_request"
  request_id: string
  request: ControlRequestPayload
}

export type ControlRequestPayload =
  | CanUseToolRequest
  | HookCallbackRequest
  | InitializeRequest
  | InterruptRequest
  | SetPermissionModeRequest
  | SetModelRequest
  | SetMaxThinkingTokensRequest
  | McpStatusRequest
  | McpMessageRequest
  | McpReconnectRequest
  | McpToggleRequest
  | McpSetServersRequest
  | RewindFilesRequest

export interface CanUseToolRequest {
  subtype: "can_use_tool"
  tool_name: string
  input: Record<string, unknown>
  permission_suggestions?: PermissionUpdate[]
  blocked_path?: string
  decision_reason?: string
  tool_use_id: string
  agent_id?: string
  description?: string
}

export interface HookCallbackRequest {
  subtype: "hook_callback"
  callback_id: string
  input: unknown
  tool_use_id?: string
}

export interface InitializeRequest {
  subtype: "initialize"
  hooks?: Record<string, unknown>[]
  sdkMcpServers?: string[]
  jsonSchema?: Record<string, unknown>
  systemPrompt?: string
  appendSystemPrompt?: string
  agents?: Record<string, unknown>
}

export interface InterruptRequest {
  subtype: "interrupt"
}

export interface SetPermissionModeRequest {
  subtype: "set_permission_mode"
  mode: PermissionMode
}

export interface SetModelRequest {
  subtype: "set_model"
  model?: string
}

export interface SetMaxThinkingTokensRequest {
  subtype: "set_max_thinking_tokens"
  max_thinking_tokens: number | null
}

export interface McpStatusRequest {
  subtype: "mcp_status"
}

export interface McpMessageRequest {
  subtype: "mcp_message"
  server_name: string
  message: unknown
}

export interface McpReconnectRequest {
  subtype: "mcp_reconnect"
  serverName: string
}

export interface McpToggleRequest {
  subtype: "mcp_toggle"
  serverName: string
  enabled: boolean
}

export interface McpSetServersRequest {
  subtype: "mcp_set_servers"
  servers: Record<string, unknown>
}

export interface RewindFilesRequest {
  subtype: "rewind_files"
  user_message_id: string
  dry_run?: boolean
}

export interface PermissionUpdate {
  type: "addRules" | "replaceRules" | "removeRules" | "setMode" | "addDirectories" | "removeDirectories"
  rules?: { toolName: string; ruleContent?: string }[]
  behavior?: "allow" | "deny" | "ask"
  destination?: string
  mode?: PermissionMode
  directories?: string[]
}

export interface SDKControlResponse {
  type: "control_response"
  response: {
    subtype: "success" | "error"
    request_id: string
    response?: Record<string, unknown>
    error?: string
    pending_permission_requests?: SDKControlRequest[]
  }
}

export interface SDKToolProgressMessage {
  type: "tool_progress"
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string | null
  elapsed_time_seconds: number
  uuid: string
  session_id: string
}

export interface SDKToolUseSummaryMessage {
  type: "tool_use_summary"
  summary: string
  preceding_tool_use_ids: string[]
  uuid: string
  session_id: string
}

export interface SDKKeepAliveMessage {
  type: "keep_alive"
}

export type SDKMessage =
  | SDKUserMessage
  | SDKSystemInitMessage
  | SDKSystemStatusMessage
  | SDKAssistantMessage
  | SDKStreamEventMessage
  | SDKResultMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKToolProgressMessage
  | SDKToolUseSummaryMessage
  | SDKKeepAliveMessage

export interface BrowserMessage {
  type: string
  sessionId: string
  data: unknown
}

export interface Session {
  id: string
  cliSessionId: string
  cwd: string
  createdAt: number
  updatedAt: number
  status: "starting" | "running" | "paused" | "stopped" | "error"
  model?: string
  tools?: string[]
  messages: SDKMessage[]
  pendingPermissions: SDKControlRequest[]
}

export interface PendingPermission {
  sessionId: string
  request: SDKControlRequest
  timestamp: number
}
