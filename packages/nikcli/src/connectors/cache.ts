import type { JsonValue } from "@/util/json"
export interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const STATUS_CACHE_TTL = 5 * 60 * 1000
const TOOLS_CACHE_TTL = 2 * 60 * 1000
const MAX_CACHE_SIZE = 100

class Cache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map()

  private evictIfNeeded(): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt < oldestTime) {
          oldestTime = entry.expiresAt
          oldestKey = key
        }
      }
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }
  }

  set(key: string, value: T, ttl: number): void {
    this.evictIfNeeded()
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    })
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.value
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

const statusCache = new Cache<Record<string, any>>()
const toolsCache = new Cache<Record<string, any>>()
const configHashCache = new Cache<string>()

function normalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item))
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    return Object.fromEntries(entries.map(([key, entry]) => [key, normalize(entry)]))
  }

  return value
}

function getConfigHash(config: any): string {
  return JSON.stringify(normalize(config?.connectors ?? {}))
}

async function getCachedOrCompute<T>(
  cache: Cache<T>,
  key: string,
  compute: () => Promise<T>,
  ttl: number,
  config?: any,
): Promise<T> {
  const currentHash = config ? getConfigHash(config) : null

  if (currentHash) {
    const cachedHash = configHashCache.get(key)

    if (cachedHash && cachedHash !== currentHash) {
      cache.invalidate(key)
      configHashCache.invalidate(key)
    }
  }

  const cached = cache.get(key)
  if (cached !== null) return cached

  const result = await compute()
  cache.set(key, result, ttl)

  if (currentHash) {
    configHashCache.set(key, currentHash, ttl)
  }

  return result
}

export function invalidateStatusCache(): void {
  statusCache.clear()
}

export function invalidateToolsCache(): void {
  toolsCache.clear()
}

export function invalidateConnectorCache(_connectorName: string): void {
  statusCache.invalidate("connectors_status")
  toolsCache.invalidate("connectors_tools")
}

export function getCachedStatus(
  key: string,
  compute: () => Promise<Record<string, any>>,
  config?: any,
): Promise<Record<string, any>> {
  return getCachedOrCompute(statusCache, key, compute, STATUS_CACHE_TTL, config)
}

export function getCachedTools(
  key: string,
  compute: () => Promise<Record<string, any>>,
  config?: any,
): Promise<Record<string, any>> {
  return getCachedOrCompute(toolsCache, key, compute, TOOLS_CACHE_TTL, config)
}
