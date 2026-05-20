import { describe, expect, it, beforeEach } from "bun:test"
import { CachedProvider } from "../src/providers/cached"
import { Router } from "../src/providers/router"
import { BaseProvider, type ChatOptions } from "../src/providers"
import type { ChatMessage } from "../src/types"
import { hashKey, isDeterministic } from "../src/cache/hash"
import { Coalescer } from "../src/cache/coalesce"
import { getRegistry, resetRegistryForTests } from "../src/providers/registry"

class FakeProvider extends BaseProvider {
  name = "fake"
  apiKey = "x"
  baseUrl = "http://fake"
  calls = 0
  delayMs = 0
  fail = false

  async chatCompletions(model: string, _messages: ChatMessage[], _options?: ChatOptions): Promise<Response> {
    this.calls++
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    if (this.fail) return new Response(JSON.stringify({ error: "boom" }), { status: 500 })
    const body = {
      id: `c-${this.calls}`,
      model,
      choices: [{ message: { role: "assistant", content: `reply ${this.calls}` } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
  }
}

const messages: ChatMessage[] = [
  { role: "system", content: "you are helpful" },
  { role: "user", content: "hi" },
]

describe("hashKey", () => {
  it("is stable across calls", async () => {
    const a = await hashKey({ model: "m", messages, temperature: 0 })
    const b = await hashKey({ model: "m", messages, temperature: 0 })
    expect(a).toBe(b)
  })

  it("changes when content changes", async () => {
    const a = await hashKey({ model: "m", messages, temperature: 0 })
    const b = await hashKey({
      model: "m",
      messages: [...messages, { role: "user", content: "bye" }],
      temperature: 0,
    })
    expect(a).not.toBe(b)
  })
})

describe("isDeterministic", () => {
  it("temperature=0 is deterministic", () => {
    expect(isDeterministic({ temperature: 0 })).toBe(true)
  })
  it("undefined temperature defaults to deterministic", () => {
    expect(isDeterministic({})).toBe(true)
  })
  it("temperature>0 without seed is not deterministic", () => {
    expect(isDeterministic({ temperature: 0.7 })).toBe(false)
  })
  it("seed makes it deterministic regardless of temperature", () => {
    expect(isDeterministic({ temperature: 0.9, seed: 42 })).toBe(true)
  })
})

describe("CachedProvider over Router", () => {
  let upstream: FakeProvider
  let provider: CachedProvider
  let router: Router

  beforeEach(() => {
    resetRegistryForTests()
    upstream = new FakeProvider()
    getRegistry().override("local", upstream)
    router = new Router()
    provider = new CachedProvider(router, makeStore())
  })

  it("caches deterministic requests and returns cache hit", async () => {
    const first = await provider.chatCompletions("kimi-k2.6", messages, { temperature: 0 })
    expect("body" in first).toBe(true)
    if (!("body" in first)) return
    expect(first.cache).toBe("miss")
    expect(first.stored).toBe(true)

    const second = await provider.chatCompletions("kimi-k2.6", messages, { temperature: 0 })
    if (!("body" in second)) throw new Error("expected body")
    expect(second.cache).toBe("hit")
    expect(upstream.calls).toBe(1)
  })

  it("does not cache non-deterministic requests by default", async () => {
    await provider.chatCompletions("kimi-k2.6", messages, { temperature: 0.7 })
    await provider.chatCompletions("kimi-k2.6", messages, { temperature: 0.7 })
    expect(upstream.calls).toBe(2)
  })

  it("respects cacheOverride for non-deterministic requests", async () => {
    await provider.chatCompletions("kimi-k2.6", messages, { temperature: 0.7, cacheOverride: true })
    const second = await provider.chatCompletions("kimi-k2.6", messages, { temperature: 0.7, cacheOverride: true })
    if (!("body" in second)) throw new Error("expected body")
    expect(second.cache).toBe("hit")
    expect(upstream.calls).toBe(1)
  })

  it("coalesces concurrent identical requests into a single upstream call", async () => {
    upstream.delayMs = 30
    const [a, b, c] = await Promise.all([
      provider.chatCompletions("kimi-k2.6", messages, { temperature: 0 }),
      provider.chatCompletions("kimi-k2.6", messages, { temperature: 0 }),
      provider.chatCompletions("kimi-k2.6", messages, { temperature: 0 }),
    ])
    expect(upstream.calls).toBe(1)
    const cacheModes = [a, b, c].map((r) => ("cache" in r ? r.cache : "stream"))
    expect(cacheModes.filter((m) => m === "miss").length).toBe(1)
    expect(cacheModes.filter((m) => m === "coalesced").length).toBe(2)
  })
})

describe("Coalescer", () => {
  it("dedupes concurrent calls", async () => {
    const c = new Coalescer<number>()
    let count = 0
    const fn = () => new Promise<number>((r) => setTimeout(() => r(++count), 10))
    const [a, b] = await Promise.all([c.run("k", fn), c.run("k", fn)])
    expect(a.value).toBe(1)
    expect(b.value).toBe(1)
    expect(a.coalesced || b.coalesced).toBe(true)
  })

  it("does not dedupe across keys", async () => {
    const c = new Coalescer<number>()
    let count = 0
    const fn = () => new Promise<number>((r) => setTimeout(() => r(++count), 5))
    const [a, b] = await Promise.all([c.run("k1", fn), c.run("k2", fn)])
    expect(a.value).not.toBe(b.value)
  })
})

function makeStore() {
  const map = new Map<string, { value: any; expiresAt: number }>()
  let hits = 0
  let misses = 0
  return {
    async get(key: string) {
      const e = map.get(key)
      if (!e || e.expiresAt < Date.now()) {
        misses++
        return null
      }
      hits++
      return e.value
    },
    async set(key: string, value: any, ttlSeconds: number) {
      map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    },
    stats() {
      return { hits, misses, size: map.size }
    },
  }
}
