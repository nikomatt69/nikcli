export type SessionStatus = "starting" | "waiting" | "connected" | "stopped" | "error"

export interface DeviceInfo {
  id: string
  userAgent?: string
  connectedAt: Date
  lastActivity: Date
}

export interface RemoteSession {
  id: string
  name: string
  qrCode: string
  qrUrl: string
  localUrl?: string
  tunnelUrl?: string
  tunnelPassword?: string
  status: SessionStatus
  connectedDevices: DeviceInfo[]
  startedAt: Date
  lastActivity: Date
  error?: string
  port?: number
}

export interface SessionOptions {
  name?: string
  timeout?: number
  maxDevices?: number
}

export interface RemoteServiceConfig {
  notificationsEnabled: boolean
  sessionExpiry: number
  maxDevices: number
  autoRecoverSession: boolean
}

export interface BroadcastMessage {
  type: string
  payload: unknown
  timestamp?: number
}

export interface RemoteNotification {
  type: "task_complete" | "error" | "action_required" | "info"
  title: string
  body: string
  data?: unknown
}

export interface TaskInfo {
  name: string
  summary: string
  success?: boolean
  duration?: number
  agentName?: string
}

export interface SubagentResult {
  success: boolean
  summary: string
  duration: number
  output?: string
  error?: string
}

export interface InputPrompt {
  message: string
  type: "text" | "confirm" | "select"
  options?: string[]
  required?: boolean
}

export interface RemoteSessionPersistence {
  sessionId: string
  name: string
  qrUrl: string
  tunnelPassword?: string
  port?: number
  startedAt: string
  lastActivity: string
  status: SessionStatus
}

export interface SubagentRemoteEvent {
  type:
    | "subagent:start"
    | "subagent:progress"
    | "subagent:complete"
    | "subagent:error"
    | "subagent:input_required"
  payload: {
    agentName: string
    task?: string
    progress?: number
    message?: string
    result?: SubagentResult
    error?: string
    prompt?: InputPrompt
    timestamp: number
  }
}

export const DEFAULT_REMOTE_CONFIG: RemoteServiceConfig = {
  notificationsEnabled: true,
  sessionExpiry: 86400,
  maxDevices: 5,
  autoRecoverSession: true,
}
