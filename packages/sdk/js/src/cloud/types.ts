export type CloudPlatform = "ios" | "android" | "web" | "desktop"

export interface CloudUser {
  userID: string
  email?: string
  claims: Record<string, unknown>
}

export interface CloudDevice {
  id: string
  userID: string
  name: string
  platform: CloudPlatform
  publicKey: string
  pushToken?: string
  createdAt: number
  lastSeen: number
}

export interface CloudSession {
  id: string
  userID: string
  title: string
  directoryHash?: string
  encryptedState: string
  syncVersion: number
  createdAt: number
  updatedAt: number
}

export interface CloudMessage {
  id: string
  sessionID: string
  userID: string
  deviceID?: string
  role: "user" | "assistant" | "system" | "tool"
  encryptedContent: string
  createdAt: number
  syncVersion: number
}

export interface CloudSyncOperation {
  id: number
  userID: string
  sessionID: string
  deviceID?: string
  operation: "upsert" | "delete"
  entityType: "session" | "message"
  entityID: string
  payload?: string
  hash: string
  createdAt: number
}

export interface CloudSyncPushOperation {
  sessionID: string
  entityType: "session" | "message"
  operation: "upsert" | "delete"
  entityID: string
  payload?: string
  hash: string
  timestamp: number
}

export interface CloudClientConfig {
  baseUrl: string
  token?: string
  getToken?: () => Promise<string> | string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

export interface RegisterDeviceInput {
  deviceID: string
  name: string
  platform: CloudPlatform
  publicKey: string
  pushToken?: string
}

export interface UpsertSessionInput {
  title: string
  directoryHash?: string
  encryptedState: string
  syncVersion?: number
}

export interface AppendMessageInput {
  messageID: string
  deviceID?: string
  role: CloudMessage["role"]
  encryptedContent: string
  createdAt?: number
  syncVersion?: number
}

export interface PullSyncInput {
  since: number
  limit?: number
}

export interface PushSyncInput {
  deviceID: string
  operations: CloudSyncPushOperation[]
}

export interface CloudErrorPayload {
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
