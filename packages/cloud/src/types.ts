import type { JWTPayload } from "jose"

export type Platform = "ios" | "android" | "web" | "desktop"

export interface AuthContext {
  userID: string
  email?: string
  token: string
  claims: JWTPayload
}

export interface CloudBindings {
  DB: D1Database
  RELAY_ROOM: DurableObjectNamespace
  AUTH_JWKS_URL?: string
  AUTH_JWT_SECRET?: string
  AUTH_ISSUER?: string
  AUTH_AUDIENCE?: string
  ALLOWED_ORIGINS?: string
}

export interface CloudVariables {
  auth: AuthContext
}

export interface CloudEnv {
  Bindings: CloudBindings
  Variables: CloudVariables
}

export interface SyncOperationRecord {
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

export interface SessionRecord {
  id: string
  userID: string
  title: string
  directoryHash?: string
  encryptedState: string
  syncVersion: number
  createdAt: number
  updatedAt: number
}

export interface MessageRecord {
  id: string
  sessionID: string
  userID: string
  deviceID?: string
  role: string
  encryptedContent: string
  createdAt: number
  syncVersion: number
}

export interface DeviceRecord {
  id: string
  userID: string
  name: string
  platform: Platform
  publicKey: string
  pushToken?: string
  createdAt: number
  lastSeen: number
}
