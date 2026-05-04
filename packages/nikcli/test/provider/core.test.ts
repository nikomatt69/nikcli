import { describe, expect, it } from "bun:test"
import { APICallError } from "ai"
import type { ModelMessage } from "ai"
import { Provider } from "@/provider/provider"
import { ProviderError } from "@/provider/error"
import { ProviderTransform } from "@/provider/transform"
import { ModelsDev } from "@/provider/models"
import { ProviderAuth } from "@/provider/auth"
import { openaiCompatibleErrorDataSchema } from "@/provider/sdk/copilot/openai-compatible-error"
import { openaiErrorDataSchema } from "@/provider/sdk/copilot/responses/openai-error"

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

function apiError(partial: {
  message: string
  statusCode?: number
  isRetryable?: boolean
  responseBody?: string
}): APICallError {
  return new APICallError({
    message: partial.message,
    url: "https://example.com/v1",
    requestBodyValues: {},
    statusCode: partial.statusCode,
    responseHeaders: {},
    responseBody: partial.responseBody,
    isRetryable: partial.isRetryable ?? false,
  })
}

describe("ProviderError", () => {
  it("parseAPICallError classifies context overflow from message pattern", () => {
    const parsed = ProviderError.parseAPICallError({
      providerID: "openai",
      error: apiError({ message: "The prompt is too long for this model" }),
    })
    expect(parsed.type).toBe("context_overflow")
    if (parsed.type === "context_overflow") {
      expect(parsed.message).toContain("too long")
    }
  })

  it("parseAPICallError classifies 413 as overflow regardless of message", () => {
    const parsed = ProviderError.parseAPICallError({
      providerID: "x",
      error: apiError({ message: "nope", statusCode: 413 }),
    })
    expect(parsed.type).toBe("context_overflow")
  })

  it("parseAPICallError returns api_error with retryable flag", () => {
    const parsed = ProviderError.parseAPICallError({
      providerID: "openai",
      error: apiError({ message: "Rate limited", statusCode: 429, isRetryable: true }),
    })
    expect(parsed.type).toBe("api_error")
    if (parsed.type === "api_error") {
      expect(parsed.statusCode).toBe(429)
      expect(parsed.isRetryable).toBe(true)
    }
  })

  it("parseStreamError returns overflow for known error codes", () => {
    const json = JSON.stringify({
      type: "error",
      error: { code: "context_length_exceeded", message: "too big" },
    })
    const r = ProviderError.parseStreamError(json)
    expect(r?.type).toBe("context_overflow")
    expect(r?.message).toBe("too big")
  })

  it("parseStreamError returns undefined for rate_limit_exceeded", () => {
    const json = JSON.stringify({
      type: "error",
      error: { code: "rate_limit_exceeded", message: "slow down" },
    })
    expect(ProviderError.parseStreamError(json)).toBeUndefined()
  })

  it("parseStreamError uses isOverflow on non-JSON body", () => {
    const r = ProviderError.parseStreamError("Request entity too large")
    expect(r?.type).toBe("context_overflow")
  })

  it("isContextOverflowError detects named errors and message patterns", () => {
    const o = new Error("overflow")
    ;(o as { name: string }).name = "ContextOverflowError"
    expect(ProviderError.isContextOverflowError(o)).toBe(true)

    expect(ProviderError.isContextOverflowError("maximum context length is 8000 tokens")).toBe(true)
    expect(ProviderError.isContextOverflowError({ data: { type: "context_overflow" } })).toBe(true)
    expect(ProviderError.isContextOverflowError(new Error("unrelated"))).toBe(false)
  })

  it("formatOverflowMessage includes provider, model, and guidance", () => {
    const text = ProviderError.formatOverflowMessage("openai", "gpt-4o")
    expect(text).toContain("Provider: openai")
    expect(text).toContain("Model: gpt-4o")
    expect(text).toContain("/compact")
  })
})

describe("ProviderTransform", () => {
  it("temperature returns undefined for claude and numeric preset for qwen", () => {
    expect(ProviderTransform.temperature(makeModel({ id: "x/claude-3-5-sonnet" }))).toBeUndefined()
    expect(ProviderTransform.temperature(makeModel({ id: "qwen-2.5" }))).toBe(0.55)
    expect(ProviderTransform.temperature(makeModel({ id: "gemini-2.5-flash" }))).toBe(1.0)
  })

  it("topP and topK return provider-specific values", () => {
    expect(ProviderTransform.topP(makeModel({ id: "qwen" }))).toBe(1)
    expect(ProviderTransform.topP(makeModel({ id: "minimax-m2" }))).toBe(0.95)
    expect(ProviderTransform.topK(makeModel({ id: "minimax-m2.1" }))).toBe(40)
    expect(ProviderTransform.topK(makeModel({ id: "gemini-3" }))).toBe(64)
  })

  it("maxOutputTokens caps at OUTPUT_TOKEN_MAX", () => {
    const capped = ProviderTransform.maxOutputTokens(makeModel({ limit: { context: 100_000, output: 1_000_000 } }))
    expect(capped).toBe(ProviderTransform.OUTPUT_TOKEN_MAX)
    expect(ProviderTransform.maxOutputTokens(makeModel({ limit: { context: 1, output: 100 } }))).toBe(100)
  })

  it("providerOptions nests under sdk key for copilot", () => {
    const m = makeModel({ providerID: "github-copilot", api: { id: "x", url: "u", npm: "@ai-sdk/github-copilot" } })
    expect(ProviderTransform.providerOptions(m, { foo: 1 })).toEqual({ copilot: { foo: 1 } })
  })

  it("error rewrites 403 for github-copilot", () => {
    const msg = ProviderTransform.error(
      "x-github-copilot",
      apiError({ message: "nope", statusCode: 403 }),
    )
    expect(msg).toContain("reauthenticate")
  })

  it("error appends help link for unsupported model on copilot", () => {
    const msg = ProviderTransform.error(
      "github-copilot",
      apiError({ message: "The requested model is not supported" }),
    )
    expect(msg).toContain("github.com/settings/copilot")
  })

  it("options sets store false for openai and copilot", () => {
    const o1 = ProviderTransform.options({
      model: makeModel(),
      sessionID: "s1",
    })
    expect(o1["store"]).toBe(false)

    const o2 = ProviderTransform.options({
      model: makeModel({
        providerID: "github-copilot",
        api: { id: "gpt-4.1", url: "u", npm: "@ai-sdk/github-copilot" },
      }),
      sessionID: "s1",
    })
    expect(o2["store"]).toBe(false)
  })

  it("options sets promptCacheKey for openai and session id", () => {
    const o = ProviderTransform.options({
      model: makeModel({ providerID: "openai" }),
      sessionID: "sess-abc",
    })
    expect(o["promptCacheKey"]).toBe("sess-abc")
  })

  it("schema converts integer enums to strings for google models", () => {
    const m = makeModel({ providerID: "google", api: { id: "gemini-2.0", url: "u", npm: "@ai-sdk/google" } })
    const jsonSchema: Record<string, unknown> = {
      type: "object",
      properties: {
        n: { type: "integer", enum: [1, 2, 3] },
      },
    }
    const out = ProviderTransform.schema(m, jsonSchema as never)
    const n = (out as { properties?: { n?: { type?: string; enum?: string[] } } }).properties?.n
    expect(n?.type).toBe("string")
    expect(n?.enum).toEqual(["1", "2", "3"])
  })

  it("message strips disallowed file parts to error text for text-only model", () => {
    const model = makeModel({
      id: "text-only",
      api: { id: "text-only", url: "u", npm: "@ai-sdk/openai" },
      capabilities: {
        ...makeModel().capabilities,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
      },
    })
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          {
            type: "file",
            data: new Uint8Array([1, 2]),
            mediaType: "application/pdf",
            filename: "a.pdf",
          },
        ],
      },
    ]
    const next = ProviderTransform.message(msgs, model, {})
    const parts = next[0]?.content
    expect(Array.isArray(parts)).toBe(true)
    if (Array.isArray(parts)) {
      const last = parts[parts.length - 1] as { type: string; text?: string }
      expect(last.type).toBe("text")
      expect(last.text).toContain("ERROR:")
      expect(last.text).toContain("pdf")
    }
  })
})

describe("Provider pure helpers", () => {
  it("parseModel splits first segment as provider and remainder as model id", () => {
    expect(Provider.parseModel("a/b/c")).toEqual({ providerID: "a", modelID: "b/c" })
    expect(Provider.parseModel("openrouter/anthropic/claude-3.5-sonnet")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-3.5-sonnet",
    })
  })

  it("sort orders models by priority then id", () => {
    const a = makeModel({ id: "a-gpt-5" })
    const b = makeModel({ id: "b-claude" })
    const c = makeModel({ id: "c-other" })
    const ordered = Provider.sort([c, a, b])
    expect(ordered[0]!.id).toContain("gpt-5")
  })
})

describe("ModelsDev schemas", () => {
  it("Model.parse accepts a minimal valid model", () => {
    const m = ModelsDev.Model.parse({
      id: "x",
      name: "X",
      release_date: "2025-01-01",
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: { context: 100, output: 100 },
      options: {},
    })
    expect(m.id).toBe("x")
  })

  it("Provider.parse accepts env and models map", () => {
    const p = ModelsDev.Provider.parse({
      name: "P",
      env: ["KEY"],
      id: "p1",
      models: {},
    })
    expect(p.id).toBe("p1")
  })
})

describe("ProviderAuth contracts", () => {
  it("Method and Authorization parse", () => {
    expect(ProviderAuth.Method.parse({ type: "api", label: "Key" })).toEqual({ type: "api", label: "Key" })
    expect(
      ProviderAuth.Authorization.parse({
        url: "https://x",
        method: "code",
        instructions: "open",
      }).method,
    ).toBe("code")
  })
})

describe("fromModelsDevProvider", () => {
  it("builds Info with capabilities from modalities", () => {
    const dev: ModelsDev.Provider = {
      id: "p",
      name: "Prov",
      env: ["P_KEY"],
      api: "https://api",
      npm: "@ai-sdk/openai",
      models: {
        m1: {
          id: "m1",
          name: "M1",
          release_date: "2025-01-01",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          limit: { context: 10_000, output: 4096 },
          modalities: { input: ["text", "image"], output: ["text"] },
          options: {},
        },
      },
    }
    const info = Provider.fromModelsDevProvider(dev)
    expect(info.id).toBe("p")
    expect(info.models.m1?.capabilities.input.image).toBe(true)
    expect(info.models.m1?.variants).toBeDefined()
  })
})

describe("OpenAI error schemas (copilot)", () => {
  it("openaiErrorDataSchema and compatible schema parse error payloads", () => {
    const body = { error: { message: "bad", code: "invalid" } }
    expect(openaiErrorDataSchema.parse(body).error.message).toBe("bad")
    expect(openaiCompatibleErrorDataSchema.parse(body).error.message).toBe("bad")
  })

  it("rejects non-object at root", () => {
    expect(() => openaiErrorDataSchema.parse("x")).toThrow()
  })
})

describe("Provider.Model and Provider.Info", () => {
  it("Model.parse enforces required capability flags", () => {
    const raw = {
      id: "m",
      providerID: "p",
      api: { id: "m", url: "u", npm: "@ai-sdk/openai" },
      name: "M",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 1, output: 1 },
      status: "active" as const,
      options: {},
      headers: {},
      release_date: "2025-01-01",
    }
    expect(Provider.Model.parse(raw).id).toBe("m")
  })
})
