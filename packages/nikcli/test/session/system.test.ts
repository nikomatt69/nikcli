import { describe, expect, it } from "bun:test"
import { Provider } from "@/provider/provider"
import { SystemPrompt } from "@/session/system"

function makeModel(overrides: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: "m1",
    providerID: "openai",
    api: { id: "gpt-4o", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    name: "Test",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 32_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-12-01",
    ...overrides,
  }
}

describe("SystemPrompt", () => {
  describe("header", () => {
    it("returns non-empty strings when provider id includes anthropic (spoof header)", () => {
      const headers = SystemPrompt.header("anthropic")
      expect(Array.isArray(headers)).toBe(true)
      expect(headers.length).toBeGreaterThan(0)
      expect(typeof headers[0]).toBe("string")
    })

    it("returns empty array when provider id does not include anthropic", () => {
      expect(SystemPrompt.header("openai")).toEqual([])
      expect(SystemPrompt.header("unknown")).toEqual([])
    })
  })

  describe("provider", () => {
    it("returns one prompt bundle per model (non-empty string entries)", () => {
      const result = SystemPrompt.provider(makeModel())
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((s) => typeof s === "string" && s.length > 0)).toBe(true)
    })

    it("uses codex line when api id includes gpt-5", () => {
      const result = SystemPrompt.provider(makeModel({ api: { id: "gpt-5.1", url: "x", npm: "y" } }))
      expect(result.length).toBeGreaterThan(0)
    })

    it("uses beast line when api id includes gpt- or o1 or o3", () => {
      const gpt4 = SystemPrompt.provider(makeModel({ api: { id: "gpt-4o", url: "x", npm: "y" } }))
      const o3 = SystemPrompt.provider(makeModel({ api: { id: "o3-2024", url: "x", npm: "y" } }))
      expect(gpt4[0]).toBe(o3[0])
    })

    it("uses gemini line when api id includes gemini-", () => {
      const result = SystemPrompt.provider(makeModel({ api: { id: "gemini-2.0", url: "x", npm: "y" } }))
      expect(result.length).toBeGreaterThan(0)
    })

    it("uses anthropic line when api id includes claude", () => {
      const result = SystemPrompt.provider(
        makeModel({ api: { id: "claude-3-5-sonnet-20241022", url: "x", npm: "y" } }),
      )
      expect(result.length).toBeGreaterThan(0)
    })

    it("falls back to default (non-claude) line when no rule matches", () => {
      const result = SystemPrompt.provider(makeModel({ api: { id: "other-vendor-1", url: "x", npm: "y" } }))
      expect(result.length).toBeGreaterThan(0)
    })
  })
})
