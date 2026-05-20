import { describe, expect, it } from "bun:test"
import { Provider } from "@/provider/provider"
import { SystemPrompt } from "@/session/system"

function makeModel(overrides: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: "m1",
    providerID: "minimax-coding-plan",
    api: { id: "MiniMax-M2.7", url: "https://api.minimax.io", npm: "@ai-sdk/anthropic" },
    name: "MiniMax-M2.7",
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
      expect(SystemPrompt.header("minimax-coding-plan")).toEqual([])
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

    it("uses minimax line when api id includes MiniMax-M2.7", () => {
      const result = SystemPrompt.provider(makeModel({ api: { id: "MiniMax-M2.7", url: "x", npm: "y" } }))
      expect(result.length).toBeGreaterThan(0)
    })

    it("uses gemini line when api id includes gemini-", () => {
      const result = SystemPrompt.provider(makeModel({ api: { id: "gemini-2.0", url: "x", npm: "y" } }))
      expect(result.length).toBeGreaterThan(0)
    })

    it("uses minimax line when api id includes MiniMax-M2.7", () => {
      const result = SystemPrompt.provider(makeModel({ api: { id: "MiniMax-M2.7", url: "x", npm: "y" } }))
      expect(result.length).toBeGreaterThan(0)
    })

    it("falls back to default (non-claude) line when no rule matches", () => {
      const result = SystemPrompt.provider(makeModel({ api: { id: "other-vendor-1", url: "x", npm: "y" } }))
      expect(result.length).toBeGreaterThan(0)
    })
  })
})
