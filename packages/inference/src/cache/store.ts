export interface CachedEntry {
  body: unknown
  promptTokens: number
  completionTokens: number
  model: string
  storedAt: number
}

export interface CacheStore {
  get(key: string): Promise<CachedEntry | null>
  set(key: string, value: CachedEntry, ttlSeconds: number): Promise<void>
  stats(): { hits: number; misses: number; size: number }
}

class MemoryStore implements CacheStore {
  private readonly map = new Map<string, { value: CachedEntry; expiresAt: number }>()
  private readonly maxEntries: number
  private hits = 0
  private misses = 0

  constructor(maxEntries = 5_000) {
    this.maxEntries = maxEntries
  }

  async get(key: string): Promise<CachedEntry | null> {
    const entry = this.map.get(key)
    if (!entry) {
      this.misses++
      return null
    }
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key)
      this.misses++
      return null
    }
    this.map.delete(key)
    this.map.set(key, entry)
    this.hits++
    return entry.value
  }

  async set(key: string, value: CachedEntry, ttlSeconds: number): Promise<void> {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  }

  stats() {
    return { hits: this.hits, misses: this.misses, size: this.map.size }
  }
}

class UpstashStore implements CacheStore {
  private hits = 0
  private misses = 0
  private size = 0

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fallback: MemoryStore,
  ) {}

  async get(key: string): Promise<CachedEntry | null> {
    const local = await this.fallback.get(key)
    if (local) {
      this.hits++
      return local
    }
    try {
      const res = await fetch(`${this.url}/get/${encodeURIComponent(`nikcli:inf:${key}`)}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!res.ok) {
        this.misses++
        return null
      }
      const data = (await res.json()) as { result: string | null }
      if (!data.result) {
        this.misses++
        return null
      }
      const entry = JSON.parse(data.result) as CachedEntry
      await this.fallback.set(key, entry, 300)
      this.hits++
      return entry
    } catch {
      this.misses++
      return null
    }
  }

  async set(key: string, value: CachedEntry, ttlSeconds: number): Promise<void> {
    await this.fallback.set(key, value, ttlSeconds)
    try {
      await fetch(`${this.url}/set/${encodeURIComponent(`nikcli:inf:${key}`)}?EX=${ttlSeconds}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(value),
      })
      this.size++
    } catch {
      // L2 best-effort; L1 already populated
    }
  }

  stats() {
    const local = this.fallback.stats()
    return { hits: this.hits + local.hits, misses: this.misses + local.misses, size: local.size }
  }
}

let singleton: CacheStore | null = null

export function getCacheStore(): CacheStore {
  if (singleton) return singleton
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  const memory = new MemoryStore(Number(process.env.INFERENCE_CACHE_MAX ?? 5000))
  singleton = url && token ? new UpstashStore(url, token, memory) : memory
  return singleton
}

export function resetCacheStoreForTests() {
  singleton = null
}
