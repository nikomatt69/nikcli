import z from "zod"

export type SessionStatus = "starting" | "waiting" | "connected" | "stopped" | "error"

export const SessionStatusSchema = z.enum(["starting", "waiting", "connected", "stopped", "error"])

export interface DeviceInfo {
  id: string
  userAgent?: string
  connectedAt: Date
  lastActivity: Date
}

export const DeviceInfoSchema: z.ZodType<DeviceInfo> = z.object({
  id: z.string(),
  userAgent: z.string().optional(),
  connectedAt: z.date(),
  lastActivity: z.date(),
})

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

export const RemoteSessionSchema: z.ZodType<RemoteSession> = z.object({
  id: z.string(),
  name: z.string(),
  qrCode: z.string(),
  qrUrl: z.string(),
  localUrl: z.string().optional(),
  tunnelUrl: z.string().optional(),
  tunnelPassword: z.string().optional(),
  status: SessionStatusSchema,
  connectedDevices: z.array(DeviceInfoSchema),
  startedAt: z.date(),
  lastActivity: z.date(),
  error: z.string().optional(),
  port: z.number().optional(),
})

export interface SessionOptions {
  name?: string
  timeout?: number
  maxDevices?: number
  cloud?: {
    enabled: boolean
    url: string
    token: string
    deviceID: string
    sessionID?: string
    publicKey?: string
  }
}

export const SessionOptionsSchema: z.ZodType<SessionOptions> = z.object({
  name: z.string().optional(),
  timeout: z.number().optional(),
  maxDevices: z.number().optional(),
  cloud: z
    .object({
      enabled: z.boolean(),
      url: z.string(),
      token: z.string(),
      deviceID: z.string(),
      sessionID: z.string().optional(),
      publicKey: z.string().optional(),
    })
    .optional(),
})

export interface RemoteServiceConfig {
  notificationsEnabled: boolean
  sessionExpiry: number
  maxDevices: number
  autoRecoverSession: boolean
}

export const RemoteServiceConfigSchema: z.ZodType<RemoteServiceConfig> = z.object({
  notificationsEnabled: z.boolean(),
  sessionExpiry: z.number().positive(),
  maxDevices: z.number().int().positive(),
  autoRecoverSession: z.boolean(),
})

export interface BroadcastMessage {
  type: string
  payload: unknown
  timestamp?: number
}

export const BroadcastMessageSchema: z.ZodType<BroadcastMessage> = z.object({
  type: z.string(),
  payload: z.unknown(),
  timestamp: z.number().optional(),
})

export interface RemoteNotification {
  type: "task_complete" | "error" | "action_required" | "info"
  title: string
  body: string
  data?: unknown
}

export const RemoteNotificationSchema: z.ZodType<RemoteNotification> = z.object({
  type: z.enum(["task_complete", "error", "action_required", "info"]),
  title: z.string(),
  body: z.string(),
  data: z.unknown().optional(),
})

export interface TaskInfo {
  name: string
  summary: string
  success?: boolean
  duration?: number
  agentName?: string
}

export const TaskInfoSchema: z.ZodType<TaskInfo> = z.object({
  name: z.string(),
  summary: z.string(),
  success: z.boolean().optional(),
  duration: z.number().optional(),
  agentName: z.string().optional(),
})

export interface SubagentResult {
  success: boolean
  summary: string
  duration: number
  output?: string
  error?: string
}

export const SubagentResultSchema: z.ZodType<SubagentResult> = z.object({
  success: z.boolean(),
  summary: z.string(),
  duration: z.number(),
  output: z.string().optional(),
  error: z.string().optional(),
})

export interface InputPrompt {
  message: string
  type: "text" | "confirm" | "select"
  options?: string[]
  required?: boolean
}

export const InputPromptSchema: z.ZodType<InputPrompt> = z.object({
  message: z.string(),
  type: z.enum(["text", "confirm", "select"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
})

export interface RemoteSessionPersistence {
  sessionId: string
  name: string
  qrUrl: string
  localUrl?: string
  tunnelUrl?: string
  tunnelPassword?: string
  port?: number
  startedAt: string
  lastActivity: string
  status: SessionStatus
}

export const RemoteSessionPersistenceSchema: z.ZodType<RemoteSessionPersistence> = z.object({
  sessionId: z.string(),
  name: z.string(),
  qrUrl: z.string(),
  localUrl: z.string().optional(),
  tunnelUrl: z.string().optional(),
  tunnelPassword: z.string().optional(),
  port: z.number().optional(),
  startedAt: z.string(),
  lastActivity: z.string(),
  status: SessionStatusSchema,
})

export interface ResolvedRemoteSession {
  source: "memory" | "persisted"
  session: RemoteSession
  persisted?: RemoteSessionPersistence
}

export const ResolvedRemoteSessionSchema: z.ZodType<ResolvedRemoteSession> = z.object({
  source: z.enum(["memory", "persisted"]),
  session: RemoteSessionSchema,
  persisted: RemoteSessionPersistenceSchema.optional(),
})

export interface SubagentRemoteEvent {
  type: "subagent:start" | "subagent:progress" | "subagent:complete" | "subagent:error" | "subagent:input_required"
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

export const SubagentRemoteEventSchema: z.ZodType<SubagentRemoteEvent> = z.object({
  type: z.enum([
    "subagent:start",
    "subagent:progress",
    "subagent:complete",
    "subagent:error",
    "subagent:input_required",
  ]),
  payload: z.object({
    agentName: z.string(),
    task: z.string().optional(),
    progress: z.number().optional(),
    message: z.string().optional(),
    result: SubagentResultSchema.optional(),
    error: z.string().optional(),
    prompt: InputPromptSchema.optional(),
    timestamp: z.number(),
  }),
})

export const DEFAULT_REMOTE_CONFIG: RemoteServiceConfig = {
  notificationsEnabled: true,
  sessionExpiry: 86400,
  maxDevices: 5,
  autoRecoverSession: true,
}
