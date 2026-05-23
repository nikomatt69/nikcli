import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { MODELS, TIER_LIMITS } from "../types"
import { loadEnv } from "../config/env"

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  reset: number
  reason?: string
}

interface RateLimiter {
  check(key: string, model: string, estimatedTokens: number): Promise<RateLimitResult>
}

const apiKeys = new Map([
  ["nik-free", "free"],
  ["nik-starter", "starter"],
  ["nik-pro", "pro"],
  ["nik-biz", "business"],
])

export function validateKey(auth: string | undefined): string | null {
  if (!auth?.startsWith("Bearer ")) return null
  const key = auth.slice(7)
  return apiKeys.has(key) ? key : null
}

export function tierFor(key: string): keyof typeof TIER_LIMITS | null {
  const t = apiKeys.get(key)
  return (t as keyof typeof TIER_LIMITS | undefined) ?? null
}

class MemoryLimiter implements RateLimiter {
  private readonly usage = new Map<string, { req: number; tokens: number; day: number }>()

  async check(key: string, _model: string, estimatedTokens: number): Promise<RateLimitResult> {
    const tier = tierFor(key)
    if (!tier) return { ok: false, limit: 0, remaining: 0, reset: 0, reason: "invalid api key" }
    const limits = TIER_LIMITS[tier]

    const today = Math.floor(Date.now() / 86_400_000)
    let u = this.usage.get(key)
    if (!u || u.day !== today) {
      u = { req: 0, tokens: 0, day: today }
      this.usage.set(key, u)
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

class UpstashLimiter implements RateLimiter {
  private readonly redis: Redis
  private readonly perTier: Record<keyof typeof TIER_LIMITS, Ratelimit>

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

  async check(key: string, _model: string, estimatedTokens: number): Promise<RateLimitResult> {
    const tier = tierFor(key)
    if (!tier) return { ok: false, limit: 0, remaining: 0, reset: 0, reason: "invalid api key" }
    const limiter = this.perTier[tier]
    const result = await limiter.limit(key)
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
    const tokenKey = `nikcli:tokens:${tier}:${key}:${dayBucket()}`
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
