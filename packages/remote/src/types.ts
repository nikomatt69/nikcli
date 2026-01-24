export type SessionStatus = "starting" | "waiting" | "connected" | "stopped" | "error"
export type TunnelProvider = "localtunnel" | "cloudflared" | "ngrok" | "remotosh" | "none"

export interface DeviceInfo {
  id: string
  userAgent?: string
  connectedAt: Date
  lastActivity: Date
  ip?: string
}

export interface RemoteSession {
  id: string
  name: string
  qrCode: string
  qrUrl: string
  localUrl: string
  tunnelUrl?: string
  status: SessionStatus
  connectedDevices: DeviceInfo[]
  startedAt: Date
  lastActivity: Date
  error?: string
  port: number
}

export interface ServerConfig {
  port: number
  host: string
  enableTunnel: boolean
  tunnelProvider: TunnelProvider
  sessionSecret?: string
  maxConnections: number
  heartbeatInterval: number
  shell: string
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string>
  enableTerminal: boolean
  sessionTimeout: number
  outputMode: "raw" | "clean"
}

export interface BroadcastMessage {
  type: string
  payload: unknown
  timestamp?: number
}

export interface RemoteNotification {
  type: "success" | "error" | "warning" | "info"
  title: string
  body: string
  data?: unknown
}

export interface ClientMessage {
  type: string
  [key: string]: unknown
}

export interface ServerMessage {
  type: string
  payload?: unknown
  timestamp: number
}

export interface TerminalData {
  data: string
}

export interface TerminalResize {
  cols: number
  rows: number
}

export interface CommandMessage {
  command: string
  args?: string[]
}

export interface ClientConnection {
  id: string
  authenticated: boolean
  device: DeviceInfo
  lastPing: number
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 0,
  host: "0.0.0.0",
  enableTunnel: true,
  tunnelProvider: "localtunnel",
  maxConnections: 5,
  heartbeatInterval: 30000,
  shell: process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash",
  cols: 80,
  rows: 24,
  enableTerminal: true,
  sessionTimeout: 0,
  outputMode: "raw",
}

export const MessageTypes = {
  AUTH_REQUIRED: "auth:required",
  AUTH: "auth",
  AUTH_SUCCESS: "auth:success",
  AUTH_FAILED: "auth:failed",
  TERMINAL_OUTPUT: "terminal:output",
  TERMINAL_INPUT: "terminal:input",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_EXIT: "terminal:exit",
  TERMINAL_CLEAR: "terminal:clear",
  NOTIFICATION: "notification",
  PING: "ping",
  PONG: "pong",
  SESSION_INFO: "session:info",
  SESSION_END: "session:end",
  COMMAND: "command",
  COMMAND_RESULT: "command:result",
  AGENT_START: "agent:start",
  AGENT_PROGRESS: "agent:progress",
  AGENT_COMPLETE: "agent:complete",
  AGENT_ERROR: "agent:error",
} as const

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes]
