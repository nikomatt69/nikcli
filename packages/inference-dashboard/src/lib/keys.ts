import type { RuntimeEnv } from "./env"

const PUBLIC_PREFIX = "nik_live_"

function bytesToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf)
  let out = ""
  for (let i = 0; i < view.length; i++) out += view[i]!.toString(16).padStart(2, "0")
  return out
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return bytesToHex(digest)
}

function randomKeyBody(byteLen = 24): string {
  const buf = new Uint8Array(byteLen)
  crypto.getRandomValues(buf)
  let s = ""
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function randomId(byteLen = 16): string {
  const buf = new Uint8Array(byteLen)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}

export interface ApiKeyRow {
  id: string
  user_id: string
  name: string
  prefix: string
  tier: string
  monthly_cap_usd: number | null
  last_used_at: number | null
  revoked_at: number | null
  created_at: number
}

export interface IssuedKey {
  id: string
  /** Full plaintext. Show ONCE, never stored. */
  plaintext: string
  prefix: string
  tier: string
  name: string
  createdAt: number
}

export async function issueApiKey(
  env: RuntimeEnv,
  input: { userId: string; name?: string; tier?: "free" | "starter" | "pro" | "business" },
): Promise<IssuedKey> {
  const body = randomKeyBody()
  const plaintext = `${PUBLIC_PREFIX}${body}`
  const keyHash = await sha256(plaintext)
  const prefix = plaintext.slice(0, 16)
  const id = randomId()
  const name = input.name?.trim() || "default"
  const tier = input.tier ?? "free"
  const created = Math.floor(Date.now() / 1000)

  await env.DB.prepare(
    "INSERT INTO api_keys (id, user_id, name, prefix, key_hash, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, input.userId, name, prefix, keyHash, tier, created)
    .run()

  return { id, plaintext, prefix, tier, name, createdAt: created }
}

export async function listApiKeys(env: RuntimeEnv, userId: string): Promise<ApiKeyRow[]> {
  const result = await env.DB.prepare(
    "SELECT id, user_id, name, prefix, tier, monthly_cap_usd, last_used_at, revoked_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<ApiKeyRow>()
  return result.results ?? []
}

export async function revokeApiKey(env: RuntimeEnv, keyId: string, userId: string): Promise<boolean> {
  const ts = Math.floor(Date.now() / 1000)
  const result = await env.DB.prepare(
    "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
  )
    .bind(ts, keyId, userId)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

export async function lookupKeyByPlaintext(env: RuntimeEnv, plaintext: string): Promise<ApiKeyRow | null> {
  const keyHash = await sha256(plaintext)
  const row = await env.DB.prepare(
    "SELECT id, user_id, name, prefix, tier, monthly_cap_usd, last_used_at, revoked_at, created_at FROM api_keys WHERE key_hash = ? LIMIT 1",
  )
    .bind(keyHash)
    .first<ApiKeyRow>()
  if (!row || row.revoked_at) return null
  return row
}

export async function touchKey(env: RuntimeEnv, keyId: string): Promise<void> {
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
    .bind(Math.floor(Date.now() / 1000), keyId)
    .run()
}

export { PUBLIC_PREFIX as API_KEY_PREFIX }
