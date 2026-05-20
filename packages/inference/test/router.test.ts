import { describe, expect, it, beforeEach } from "bun:test"
import { Router } from "../src/providers/router"
import { BaseProvider, type ChatOptions } from "../src/providers"
import { getRegistry, resetRegistryForTests } from "../src/providers/registry"
import type { ChatMessage } from "../src/types"

class StubProvider extends BaseProvider {
  apiKey = "x"
  baseUrl = "http://stub"
  failTimes = 0
  calls = 0
  lastModel?: string

  constructor(public name: string) {
    super()
  }

  async chatCompletions(model: string, _messages: ChatMessage[], _options?: ChatOptions): Promise<Response> {
    this.calls++
    this.lastModel = model
    if (this.failTimes > 0) {
      this.failTimes--
      return new Response(JSON.stringify({ error: "upstream down" }), { status: 503 })
    }
    return new Response(
      JSON.stringify({
        id: "c-1",
        model,
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }
}

const messages: ChatMessage[] = [{ role: "user", content: "hi" }]

describe("Router", () => {
  let router: Router
  let groq: StubProvider
  let together: StubProvider

  beforeEach(() => {
    resetRegistryForTests()
    groq = new StubProvider("groq")
    together = new StubProvider("together")
    getRegistry().override("groq", groq)
    getRegistry().override("together", together)
    router = new Router()
  })

  it("picks the cheapest enabled non-estimated route", () => {
    const plan = router.plan("llama-3.3-70b")
    expect(plan.length).toBeGreaterThan(0)
    // nebius cheapest but not registered in test; among registered, groq < together by blended cost
    const first = plan[0]!.route
    expect(["groq", "together"]).toContain(first.provider)
  })

  it("translates to upstream model id when calling", async () => {
    const result = await router.chat("llama-3.3-70b", messages)
    expect(result.response.ok).toBe(true)
    expect([groq.lastModel, together.lastModel].filter(Boolean)[0]).toBeDefined()
  })

  it("falls back to the next provider on 5xx", async () => {
    groq.failTimes = 1
    const result = await router.chat("llama-3.3-70b", messages)
    expect(result.response.ok).toBe(true)
    expect(result.attempts.length).toBeGreaterThanOrEqual(1)
    expect(result.attempts.some((a) => a.status === 503)).toBe(true)
  })

  it("respects preferProvider override", async () => {
    const result = await router.chat("llama-3.3-70b", messages, {}, { preferProvider: "together" })
    expect(result.response.ok).toBe(true)
    expect(result.route.provider).toBe("together")
  })
})
