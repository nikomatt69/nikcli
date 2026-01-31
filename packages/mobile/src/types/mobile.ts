export interface ServerConfig {
  url: string
  secret: string
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error" | "closed"

export interface SSEConfig {
  url: string
  secret: string
  retryDelay?: number
  maxRetryDelay?: number
  maxRetries?: number
  heartbeatInterval?: number
  onEvent?: (event: SSEEvent) => void
  onStatusChange?: (status: ConnectionStatus) => void
  onError?: (error: Error) => void
}

export interface SSEEvent {
  id?: string
  event?: string
  data: unknown
  timestamp: number
}

export interface StreamEvent<TData = unknown> {
  data: TData
  event?: string
  id?: string
  retry?: number
}

export interface QueuedOperation {
  id: string
  type: "command" | "input" | "resize"
  payload: Record<string, unknown>
  timestamp: number
  retryCount: number
}

export interface EventFilter {
  types?: string[]
  search?: string
  dateRange?: {
    start: Date
    end: Date
  }
}

export interface Session {
  id: string
  name: string
  status: "active" | "idle" | "error" | "stopped"
  createdAt: Date
  lastActivity: Date
  messageCount: number
  metadata?: Record<string, unknown>
}

export interface Message {
  id: string
  sessionId: string
  role: "user" | "assistant" | "system"
  content: string
  parts?: MessagePart[]
  createdAt: Date
  metadata?: Record<string, unknown>
}

export interface MessagePart {
  id: string
  type: "text" | "code" | "tool_call" | "tool_result" | "error"
  content: string
  language?: string
  toolName?: string
  isError?: boolean
}

export interface Notification {
  id: string
  title: string
  body: string
  type: "info" | "success" | "warning" | "error"
  timestamp: Date
  read: boolean
}

export interface DeviceInfo {
  id: string
  name: string
  platform: "ios" | "android" | "web"
  lastActive: Date
}
