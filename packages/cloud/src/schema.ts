import z from "zod"

export const DeviceRegistrationSchema = z.object({
  deviceID: z.string().min(3).max(128),
  name: z.string().min(1).max(128),
  platform: z.enum(["ios", "android", "web", "desktop"]),
  publicKey: z.string().min(16).max(8192),
  pushToken: z.string().min(16).max(8192).optional(),
})

export const SessionUpsertSchema = z.object({
  title: z.string().min(1).max(256),
  directoryHash: z.string().max(1024).optional(),
  encryptedState: z.string().min(1),
  syncVersion: z.number().int().positive().optional(),
})

export const MessageCreateSchema = z.object({
  messageID: z.string().min(1).max(128),
  deviceID: z.string().min(1).max(128).optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  encryptedContent: z.string().min(1),
  createdAt: z.number().int().positive().optional(),
  syncVersion: z.number().int().positive().optional(),
})

export const SyncOperationSchema = z.object({
  sessionID: z.string().min(1).max(128),
  entityType: z.enum(["session", "message"]),
  operation: z.enum(["upsert", "delete"]),
  entityID: z.string().min(1).max(128),
  payload: z.string().optional(),
  hash: z.string().min(16).max(256),
  timestamp: z.number().int().positive(),
})

export const SyncPushSchema = z.object({
  deviceID: z.string().min(1).max(128),
  operations: z.array(SyncOperationSchema).min(1).max(500),
})

export const SyncPullSchema = z.object({
  since: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(1000).default(200),
})

export type DeviceRegistrationInput = z.infer<typeof DeviceRegistrationSchema>
export type SessionUpsertInput = z.infer<typeof SessionUpsertSchema>
export type MessageCreateInput = z.infer<typeof MessageCreateSchema>
export type SyncOperationInput = z.infer<typeof SyncOperationSchema>
export type SyncPushInput = z.infer<typeof SyncPushSchema>
export type SyncPullInput = z.infer<typeof SyncPullSchema>
