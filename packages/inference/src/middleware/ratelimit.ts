import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { verifyOauthToken } from "./oauth"
import { MODELS, TIER_LIMITS } from "../types"
import { loadEnv } from "../config/env"
import { getLogger } from "./logger"

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  reset: number
  reason?: string
}

export interface AuthenticatedKey {
  /** Rate-limit identity: the plaintext key, or `acct:<id>` for OAuth tokens. */
  key: string
  keyId: string | null
  userId: string | null
  tier: keyof typeof TIER_LIMITS
  source: "dashboard" | "oauth" | "demo"
}

interface RateLimiter {
  check(key: AuthenticatedKey, model: string, estimatedTokens: number): Promise<RateLimitResult>
}

/** Demo keys — only honored when no dashboard control plane is configured. */
const demoKeys = new Map<string, keyof typeof TIER_LIMITS>([
  ["nik-free", "free"],
  ["nik-starter", "starter"],
  ["nik-pro", "pro"],
  ["nik-biz", "business"],
])

function dashboardConfig(): { url: string; secret: string } | null {
  const env = loadEnv()
  if (!env.INFERENCE_DASHBOARD_URL || !env.GATEWAY_SHARED_SECRET) return null
  return { url: env.INFERENCE_DASHBOARD_URL.replace(/\/$/, ""), secret: env.GATEWAY_SHARED_SECRET }
}

const VALIDATION_CACHE_TTL_MS = 60_000
const validationCache = new Map<string, { value: AuthenticatedKey; expiresAt: number }>()

function cacheGet(token: string): AuthenticatedKey | undefined {
  const hit = validationCache.get(token)
  if (!hit) return undefined
  if (hit.expiresAt <= Date.now()) {
    validationCache.delete(token)
    return undefined
  }
  return hit.value
}

function cacheSet(token: string, value: AuthenticatedKey) {
  if (validationCache.size > 5_000) validationCache.clear()
  validationCache.set(token, { value, expiresAt: Date.now() + VALIDATION_CACHE_TTL_MS })
}

function asTier(value: string | undefined): keyof typeof TIER_LIMITS {
  return value && value in TIER_LIMITS ? (value as keyof typeof TIER_LIMITS) : "free"
}

async function dashboardValidate(
  dashboard: { url: string; secret: string },
  body: { key?: string; accountId?: string; email?: string },
): Promise<{ valid: boolean; tier?: string; userId?: string; keyId?: string | null } | null> {
  try {
    const res = await fetch(`${dashboard.url}/api/validate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashboard.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as { valid: boolean; tier?: string; userId?: string; keyId?: string | null }
  } catch (err) {
    getLogger().warn("auth.dashboard_unreachable", {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function validateOauthToken(token: string): Promise<AuthenticatedKey | null> {
  const env = loadEnv()
  const issuer = env.AUTH_ISSUER.replace(/\/$/, "")
  let accountID: string
  let email: string | undefined
  try {
    const auth = await verifyOauthToken(token, {
      issuer,
      audience: env.AUTH_AUDIENCE,
      jwksUrl: env.AUTH_JWKS_URL ?? `${issuer}/.well-known/jwks.json`,
    })
    accountID = auth.accountID
    email = auth.email
  } catch {
    return null
  }
  const dashboard = dashboardConfig()
  if (!dashboard) {
    return { key: `acct:${accountID}`, keyId: null, userId: accountID, tier: "free", source: "oauth" }
  }
  const result = await dashboardValidate(dashboard, { accountId: accountID, email })
  if (!result?.valid) return null
  return {
    key: `acct:${accountID}`,
    keyId: null,
    userId: result.userId ?? accountID,
    tier: asTier(result.tier),
    source: "oauth",
  }
}

/**
 * Resolve an Authorization header to an authenticated identity.
 * - OAuth bearer JWTs (issuer sign-in, same login as the rest of nikcli) are
 *   verified offline against the issuer JWKS.
 * - Everything else is validated against the dashboard (`nik_live_…` keys).
 * - The static demo keys only work when no dashboard is configured (dev).
 */
export async function validateKey(auth: string | undefined): Promise<AuthenticatedKey | null> {
  if (!auth?.startsWith("Bearer ")) return null
  const token = auth.slice(7)
  if (!token) return null

  const cached = cacheGet(token)
  if (cached) return cached

  // Three dot-separated segments → treat as an issuer JWT.
  if (token.split(".").length === 3) {
    const result = await validateOauthToken(token)
    if (result) cacheSet(token, result)
    return result
  }

  const dashboard = dashboardConfig()
  if (dashboard) {
    const result = await dashboardValidate(dashboard, { key: token })
    if (!result?.valid || !result.userId || !result.keyId) return null
    const authenticated: AuthenticatedKey = {
      key: token,
      keyId: result.keyId,
      userId: result.userId,
      tier: asTier(result.tier),
      source: "dashboard",
    }
    cacheSet(token, authenticated)
    return authenticated
  }

  const demoTier = demoKeys.get(token)
  if (!demoTier) return null
  return { key: token, keyId: null, userId: null, tier: demoTier, source: "demo" }
}

export interface UsageEvent {
  keyId: string | null
  userId: string
  model: string
  resolvedModel: string
  provider: string | null
  upstreamModel: string | null
  promptTokens: number
  completionTokens: number
  billedUsd: number
  upstreamUsd: number
  savedUsd: number
  cache: string | null
  rid: string | null
}

/** Best-effort usage recording to the dashboard. Returns false when skipped or failed. */
export async function recordUsage(event: UsageEvent): Promise<boolean> {
  const dashboard = dashboardConfig()
  if (!dashboard) return false
  try {
    const res = await fetch(`${dashboard.url}/api/usage/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashboard.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    })
    if (!res.ok) {
      getLogger().warn("usage.ingest_failed", { status: res.status, rid: event.rid })
      return false
    }
    return true
  } catch (err) {
    getLogger().warn("usage.ingest_failed", {
      error: err instanceof Error ? err.message : String(err),
      rid: event.rid,
    })
    return false
  }
}

export function resetAuthCacheForTests() {
  validationCache.clear()
}

/**
 * In-process daily quota tracker. Counters live only in this container, so
 * limits are per-instance — fine for the single-container gateway, and it has
 * no external dependency to go down.
 */
class MemoryLimiter implements RateLimiter {
  private readonly usage = new Map<string, { req: number; tokens: number; day: number }>()

  /** Entries are only touched on use; drop yesterday's so the map can't grow forever. */
  private prune(today: number) {
    for (const [id, entry] of this.usage) {
      if (entry.day !== today) this.usage.delete(id)
    }
  }

  async check(key: AuthenticatedKey, _model: string, estimatedTokens: number): Promise<RateLimitResult> {
    const limits = TIER_LIMITS[key.tier]
    const identity = key.key

    const today = Math.floor(Date.now() / 86_400_000)
    let u = this.usage.get(identity)
    if (!u || u.day !== today) {
      if (this.usage.size > 1_000) this.prune(today)
      u = { req: 0, tokens: 0, day: today }
      this.usage.set(identity, u)
    }

    if (u.req >= limits.reqPerDay) {
      return {
        ok: false,
        limit: limits.reqPerDay,
        remaining: 0,
        reset: nextDayMs(),
        reason: "daily request limit exceeded",
      }
    }
    if (u.tokens + estimatedTokens > limits.tokensPerDay) {
      return {
        ok: false,
        limit: limits.tokensPerDay,
        remaining: Math.max(0, limits.tokensPerDay - u.tokens),
        reset: nextDayMs(),
        reason: "daily token limit exceeded",
      }
    }

    u.req++
    u.tokens += estimatedTokens
    return { ok: true, limit: limits.reqPerDay, remaining: limits.reqPerDay - u.req, reset: nextDayMs() }
  }
}

/** Cooldown before retrying Redis after a failure — each attempt costs a connect timeout. */
const UPSTASH_FALLBACK_COOLDOWN_MS = 60_000

class UpstashLimiter implements RateLimiter {
  private readonly redis: Redis
  private readonly perTier: Record<keyof typeof TIER_LIMITS, Ratelimit>
  /** Degraded-mode limiter used while Redis is unreachable. */
  private readonly fallback = new MemoryLimiter()
  private fallbackUntil = 0

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token })
    this.perTier = {
      free: new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.fixedWindow(TIER_LIMITS.free.reqPerDay, "86400 s"),
        prefix: "nikcli:rl:free",
        analytics: true,
      }),
      starter: new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.fixedWindow(TIER_LIMITS.starter.reqPerDay, "86400 s"),
        prefix: "nikcli:rl:starter",
        analytics: true,
      }),
      pro: new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.fixedWindow(TIER_LIMITS.pro.reqPerDay, "86400 s"),
        prefix: "nikcli:rl:pro",
        analytics: true,
      }),
      business: new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.fixedWindow(TIER_LIMITS.business.reqPerDay, "86400 s"),
        prefix: "nikcli:rl:biz",
        analytics: true,
      }),
    }
  }

  async check(key: AuthenticatedKey, model: string, estimatedTokens: number): Promise<RateLimitResult> {
    // A Redis outage must never take the gateway down with it: degrade to the
    // in-process limiter (still enforcing per-tier quotas) instead of throwing.
    if (Date.now() < this.fallbackUntil) return this.fallback.check(key, model, estimatedTokens)
    try {
      return await this.checkRemote(key, estimatedTokens)
    } catch (err) {
      this.fallbackUntil = Date.now() + UPSTASH_FALLBACK_COOLDOWN_MS
      getLogger().error("ratelimit.redis_unavailable", {
        error: err instanceof Error ? err.message : String(err),
        degradedForMs: UPSTASH_FALLBACK_COOLDOWN_MS,
      })
      return this.fallback.check(key, model, estimatedTokens)
    }
  }

  private async checkRemote(key: AuthenticatedKey, estimatedTokens: number): Promise<RateLimitResult> {
    const tier = key.tier
    const limiter = this.perTier[tier]
    const result = await limiter.limit(key.key)
    if (!result.success) {
      return {
        ok: false,
        limit: result.limit,
        remaining: 0,
        reset: result.reset,
        reason: "daily request limit exceeded",
      }
    }

    // Token quota tracked separately with INCRBY + EXPIRE.
    const tokenKey = `nikcli:tokens:${tier}:${key.key}:${dayBucket()}`
    const limits = TIER_LIMITS[tier]
    const after = (await this.redis.incrby(tokenKey, estimatedTokens)) as number
    if (after === estimatedTokens) {
      // First write in window — set TTL.
      await this.redis.expire(tokenKey, 86_400)
    }
    if (after > limits.tokensPerDay) {
      return {
        ok: false,
        limit: limits.tokensPerDay,
        remaining: 0,
        reset: nextDayMs(),
        reason: "daily token limit exceeded",
      }
    }
    return { ok: true, limit: result.limit, remaining: result.remaining, reset: result.reset }
  }
}

let singleton: RateLimiter | null = null

export function getRateLimiter(): RateLimiter {
  if (singleton) return singleton
  const env = loadEnv()
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      singleton = new UpstashLimiter(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN)
      return singleton
    } catch (err) {
      getLogger().error("ratelimit.redis_init_failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  singleton = new MemoryLimiter()
  return singleton
}

export function resetRateLimiterForTests() {
  singleton = null
}

function nextDayMs(): number {
  const now = new Date()
  now.setUTCHours(24, 0, 0, 0)
  return now.getTime()
}

function dayBucket(): string {
  return new Date().toISOString().slice(0, 10)
}

export function modelInfoFor(modelId: string) {
  return MODELS[modelId as keyof typeof MODELS]
}
