import { describe, expect, it } from "bun:test"
import { createLru } from "@tui/util/lru-cache"

describe("createLru", () => {
  it("evicts least-recently-used keys beyond maxEntries", () => {
    const lru = createLru({ maxEntries: 2 })
    lru.touch("a")
    lru.touch("b")
    lru.touch("a") // a is now MRU
    lru.touch("c") // overflow -> b (LRU) should be evicted
    const dropped = lru.evictOverflow()
    expect(dropped).toEqual(["b"])
    expect(lru.keys().sort()).toEqual(["a", "c"])
  })

  it("never evicts pinned keys", () => {
    const lru = createLru({ maxEntries: 1 })
    lru.touch("a")
    lru.touch("b")
    lru.touch("c")
    const dropped = lru.evictOverflow(["a"])
    expect(dropped).not.toContain("a")
    expect(lru.has("a")).toBe(true)
  })

  it("the most-recently-touched key is never evicted on overflow", () => {
    const lru = createLru({ maxEntries: 3 })
    for (const k of ["a", "b", "c", "d"]) lru.touch(k)
    lru.touch("active") // just opened -> MRU
    const dropped = lru.evictOverflow()
    expect(dropped).not.toContain("active")
    expect(lru.has("active")).toBe(true)
  })

  it("reports expired keys based on ttl with an injected clock", () => {
    let t = 1000
    const lru = createLru({ maxEntries: 10, ttlMs: 100, now: () => t })
    lru.touch("a")
    t = 1050
    lru.touch("b")
    t = 1150 // a is 150ms old (expired), b is 100ms old (== ttl, expired by <=)
    const expired = lru.evictExpired()
    expect(expired.sort()).toEqual(["a", "b"])
    expect(lru.size).toBe(0)
  })

  it("forget removes a key without eviction", () => {
    const lru = createLru({ maxEntries: 10 })
    lru.touch("a")
    lru.forget("a")
    expect(lru.has("a")).toBe(false)
  })
})
