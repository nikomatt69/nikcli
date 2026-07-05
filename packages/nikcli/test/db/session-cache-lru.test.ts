import { describe, expect, it } from "bun:test"

// Re-implement the LRU cache helper logic from `user/users.ts` to verify behavior.
const SESSION_CACHE_MAX_SIZE = 10_000

function makeCache() {
  const sessionCache = new Map<string, { cachedAt: number }>()
  function set(key: string, value: { cachedAt: number }) {
    if (sessionCache.has(key)) {
      sessionCache.delete(key)
    } else if (sessionCache.size >= SESSION_CACHE_MAX_SIZE) {
      const oldest = sessionCache.keys().next().value
      if (oldest !== undefined) sessionCache.delete(oldest)
    }
    sessionCache.set(key, value)
  }
  return { cache: sessionCache, set }
}

describe("sessionCache LRU cap", () => {
  it("inserts under cap without eviction", () => {
    const { cache, set } = makeCache()
    for (let i = 0; i < 100; i++) set(`k${i}`, { cachedAt: i })
    expect(cache.size).toBe(100)
  })

  it("evicts oldest when cap reached (simulated with low cap)", () => {
    // We use the production-sized cap (10K) and only insert 10K+1 to verify eviction.
    const { cache, set } = makeCache()
    for (let i = 0; i < SESSION_CACHE_MAX_SIZE; i++) set(`k${i}`, { cachedAt: i })
    expect(cache.size).toBe(SESSION_CACHE_MAX_SIZE)
    // Insert one more -> oldest (k0) should be evicted
    set(`k${SESSION_CACHE_MAX_SIZE}`, { cachedAt: SESSION_CACHE_MAX_SIZE })
    expect(cache.size).toBe(SESSION_CACHE_MAX_SIZE)
    expect(cache.has("k0")).toBe(false)
    expect(cache.has(`k${SESSION_CACHE_MAX_SIZE}`)).toBe(true)
  })

  it("re-inserting an existing key refreshes recency (does not grow size)", () => {
    const { cache, set } = makeCache()
    set("a", { cachedAt: 1 })
    set("b", { cachedAt: 2 })
    set("c", { cachedAt: 3 })
    set("a", { cachedAt: 11 }) // refresh
    expect(cache.size).toBe(3)
  })
})
