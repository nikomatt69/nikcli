import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { MODELS, TIER_LIMITS } from "../types"
import { loadEnv } from "../config/env"

type Tier = keyof typeof TIER_LIMITS

export interface AuthenticatedKey {
  key: string
  keyId: string
  userId: string
  tier: Tier
  source: "dashboard" | "legacy"
}

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  reset: number
  reason?: string
}

interface RateLimiter {
  check(key: AuthenticatedKey | string, model: string, estimatedTokens: number): Promise<RateLimitResult>
}

const apiKeys = new Map([
  ["nik-free", "free"],
  ["nik-starter", "starter"],
  ["nik-pro", "pro"],
  ["nik-biz", "business"],
])

export async function validateKey(auth: string | undefined): Promise<AuthenticatedKey | null> {
  if (!auth?.startsWith("Bearer ")) return null
  const key = auth.slice(7)
  const env = loadEnv()

  if (env.INFERENCE_DASHBOARD_URL && env.GATEWAY_SHARED_SECRET) {
    return validateDashboardKey(env.INFERENCE_DASHBOARD_URL, env.GATEWAY_SHARED_SECRET, key)
  }

  const legacyTier = apiKeys.get(key)
  if (!legacyTier || !isTier(legacyTier)) return null
  return { key, keyId: key, userId: "local-dev", tier: legacyTier, source: "legacy" }
}

export function tierFor(key: AuthenticatedKey | string): Tier | null {
  if (typeof key !== "string") return key.tier
  const t = apiKeys.get(key)
  return isTier(t) ? t : null
}

export interface UsageEvent {
  keyId: string
  userId: string
  model: string
  resolvedModel: string
  provider?: string | null
  upstreamModel?: string | null
  promptTokens: number
  completionTokens: number
  billedUsd: number
  upstreamUsd: number
  savedUsd: number
  cache?: string | null
  rid?: string | null
}

export async function recordUsage(event: UsageEvent): Promise<boolean> {
  const env = loadEnv()
  if (!env.INFERENCE_DASHBOARD_URL || !env.GATEWAY_SHARED_SECRET) return false

  const response = await fetch(endpoint(env.INFERENCE_DASHBOARD_URL, "/api/usage/ingest"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GATEWAY_SHARED_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  })
  return response.ok
}

class MemoryLimiter implements RateLimiter {
  private readonly usage = new Map<string, { req: number; tokens: number; day: number }>()

  async check(key: AuthenticatedKey | string, _model: string, estimatedTokens: number): Promise<RateLimitResult> {
    const tier = tierFor(key)
    if (!tier) return { ok: false, limit: 0, remaining: 0, reset: 0, reason: "invalid api key" }
    const limits = TIER_LIMITS[tier]

    const today = Math.floor(Date.now() / 86_400_000)
    const subject = rateLimitSubject(key)
    let u = this.usage.get(subject)
    if (!u || u.day !== today) {
      u = { req: 0, tokens: 0, day: today }
      this.usage.set(subject, u)
    }

    if (u.req >= limits.reqPerDay) {
      return { ok: false, limit: limits.reqPerDay, remaining: 0, reset: nextDayMs(), reason: "daily request limit exceeded" }
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

class UpstashLimiter implements RateLimiter {
  private readonly redis: Redis
  private readonly perTier: Record<keyof typeof TIER_LIMITS, Ratelimit>

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token })
    this.perTier = {
      free: new Ratelimit({ redis: this.redis, limiter: Ratelimit.fixedWindow(TIER_LIMITS.free.reqPerDay, "86400 s"), prefix: "nikcli:rl:free", analytics: true }),
      starter: new Ratelimit({ redis: this.redis, limiter: Ratelimit.fixedWindow(TIER_LIMITS.starter.reqPerDay, "86400 s"), prefix: "nikcli:rl:starter", analytics: true }),
      pro: new Ratelimit({ redis: this.redis, limiter: Ratelimit.fixedWindow(TIER_LIMITS.pro.reqPerDay, "86400 s"), prefix: "nikcli:rl:pro", analytics: true }),
      business: new Ratelimit({ redis: this.redis, limiter: Ratelimit.fixedWindow(TIER_LIMITS.business.reqPerDay, "86400 s"), prefix: "nikcli:rl:biz", analytics: true }),
    }
  }

  async check(key: AuthenticatedKey | string, _model: string, estimatedTokens: number): Promise<RateLimitResult> {
    const tier = tierFor(key)
    if (!tier) return { ok: false, limit: 0, remaining: 0, reset: 0, reason: "invalid api key" }
    const limiter = this.perTier[tier]
    const subject = rateLimitSubject(key)
    const result = await limiter.limit(subject)
    if (!result.success) {
      return { ok: false, limit: result.limit, remaining: 0, reset: result.reset, reason: "daily request limit exceeded" }
    }

    // Token quota tracked separately with INCRBY + EXPIRE.
    const tokenKey = `nikcli:tokens:${tier}:${subject}:${dayBucket()}`
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
    singleton = new UpstashLimiter(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN)
  } else {
    singleton = new MemoryLimiter()
  }
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

async function validateDashboardKey(
  dashboardUrl: string,
  sharedSecret: string,
  key: string,
): Promise<AuthenticatedKey | null> {
  const response = await fetch(endpoint(dashboardUrl, "/api/validate"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sharedSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key }),
  }).catch(() => null)

  if (!response?.ok) return null

  const body = (await response.json().catch(() => null)) as {
    valid?: boolean
    tier?: string
    userId?: string
    keyId?: string
  } | null
  if (!body?.valid || !isTier(body.tier) || !body.userId || !body.keyId) return null
  return {
    key,
    keyId: body.keyId,
    userId: body.userId,
    tier: body.tier,
    source: "dashboard",
  }
}

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString()
}

function isTier(value: unknown): value is Tier {
  return typeof value === "string" && value in TIER_LIMITS
}

function rateLimitSubject(key: AuthenticatedKey | string): string {
  return typeof key === "string" ? key : key.keyId
}
