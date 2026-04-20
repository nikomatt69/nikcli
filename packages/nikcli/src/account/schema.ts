import z from "zod"
import { Identifier } from "@/id/id"

// ============================================================================
// Identifiers (using existing Identifier types)
// ============================================================================

export const AccountID = Identifier.schema("account")
export type AccountID = z.infer<typeof AccountID>

export const OrgID = Identifier.schema("org")
export type OrgID = z.infer<typeof OrgID>

// ============================================================================
// Token types
// ============================================================================

export const AccessToken = z.string().meta({ ref: "AccessToken" })
export type AccessToken = z.infer<typeof AccessToken>

export const RefreshToken = z.string().meta({ ref: "RefreshToken" })
export type RefreshToken = z.infer<typeof RefreshToken>

export const DeviceCode = z.string().meta({ ref: "DeviceCode" })
export type DeviceCode = z.infer<typeof DeviceCode>

export const UserCode = z.string().meta({ ref: "UserCode" })
export type UserCode = z.infer<typeof UserCode>

// ============================================================================
// Device code flow types
// ============================================================================

export const DeviceCodeRequest = z.object({
  client_id: z.string().default("nikcli"),
  scope: z.string().default("openid profile email"),
})
export type DeviceCodeRequest = z.infer<typeof DeviceCodeRequest>

export const DeviceCodeResponse = z.object({
  device_code: DeviceCode,
  user_code: UserCode,
  verification_url: z.string().url(),
  interval: z.number().int().positive(),
  expires_in: z.number().int().positive(),
})
export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponse>

export const PollPending = z.object({
  status: z.literal("pending"),
  interval: z.number().int().positive().optional(),
})
export type PollPending = z.infer<typeof PollPending>

export const PollSlowDown = z.object({
  status: z.literal("slow_down"),
  interval: z.number().int().positive(),
})
export type PollSlowDown = z.infer<typeof PollSlowDown>

export const PollExpired = z.object({
  status: z.literal("expired"),
})
export type PollExpired = z.infer<typeof PollExpired>

export const PollDenied = z.object({
  status: z.literal("denied"),
})
export type PollDenied = z.infer<typeof PollDenied>

export const PollSuccess = z.object({
  status: z.literal("success"),
  access_token: AccessToken,
  refresh_token: RefreshToken,
  expires_in: z.number().int().positive(),
  token_type: z.string().default("Bearer"),
})
export type PollSuccess = z.infer<typeof PollSuccess>

export const PollResult = z.discriminatedUnion("status", [
  PollPending,
  PollSlowDown,
  PollExpired,
  PollDenied,
  PollSuccess,
])
export type PollResult = z.infer<typeof PollResult>

// ============================================================================
// User info
// ============================================================================

export const Info = z.object({
  id: AccountID,
  email: z.string().email(),
  url: z.string().url(),
  active_org_id: OrgID.nullable().optional(),
  created_at: z.number(),
  updated_at: z.number(),
})
export type Info = z.infer<typeof Info>

// ============================================================================
// Organization
// ============================================================================

export const Org = z.object({
  id: OrgID,
  name: z.string(),
  slug: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  account_id: AccountID,
  created_at: z.number(),
  updated_at: z.number(),
})
export type Org = z.infer<typeof Org>

// ============================================================================
// Account row (database)
// ============================================================================

export type AccountRow = {
  id: string
  email: string
  url: string
  access_token: string
  refresh_token: string
  token_expiry: number
  created_at: number
  updated_at: number
}

export type ConfigRow = {
  id: number
  active_account_id: string | null
  active_org_id: string | null
}
