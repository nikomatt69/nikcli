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
    api: {
      id: "MiniMax-M2.7",
      url: "https://api.minimax.io",
      npm: "@ai-sdk/anthropic",
    },
    name: "MiniMax-M2.7",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
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

  it("parseAPICallError classifies 413 as payload too large and preserves status", () => {
    const parsed = ProviderError.parseAPICallError({
      providerID: "x",
      error: apiError({ message: "nope", statusCode: 413 }),
    })
    expect(parsed.type).toBe("payload_too_large")
    expect(parsed.statusCode).toBe(413)
  })

  it("parseAPICallError returns api_error with retryable flag", () => {
    const parsed = ProviderError.parseAPICallError({
      providerID: "openai",
      error: apiError({
        message: "Rate limited",
        statusCode: 429,
        isRetryable: true,
      }),
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

  it("parseStreamError classifies generic payload size separately from overflow", () => {
    const r = ProviderError.parseStreamError("Request entity too large")
    expect(r?.type).toBe("payload_too_large")
    expect(ProviderError.parseStreamError("413 status code (no body)")).toBeUndefined()
    expect(ProviderError.parseStreamError("maximum context length is 8000 tokens")?.type).toBe("context_overflow")
  })

  it("isContextOverflowError detects named errors and message patterns", () => {
    const o = new Error("overflow")
    ;(o as { name: string }).name = "ContextOverflowError"
    expect(ProviderError.isContextOverflowError(o)).toBe(true)

    expect(ProviderError.isContextOverflowError("maximum context length is 8000 tokens")).toBe(true)
    expect(
      ProviderError.isContextOverflowError({
        data: { type: "context_overflow" },
      }),
    ).toBe(true)
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
    const m = makeModel({
      providerID: "github-copilot",
      api: { id: "x", url: "u", npm: "@ai-sdk/github-copilot" },
    })
    expect(ProviderTransform.providerOptions(m, { foo: 1 })).toEqual({
      copilot: { foo: 1 },
    })
  })

  it("emits OpenRouter reasoning variants for GPT and Claude families", () => {
    const gpt = makeModel({
      id: "openai/gpt-5.2",
      providerID: "openrouter",
      api: {
        id: "openai/gpt-5.2",
        url: "https://openrouter.ai/api/v1",
        npm: "@openrouter/ai-sdk-provider",
      },
    })
    expect(Object.keys(ProviderTransform.variants(gpt))).toEqual(["none", "low", "medium", "high", "xhigh"])

    const claude = makeModel({
      id: "anthropic/claude-sonnet-4.5",
      providerID: "openrouter",
      api: {
        id: "anthropic/claude-sonnet-4.5",
        url: "https://openrouter.ai/api/v1",
        npm: "@openrouter/ai-sdk-provider",
      },
    })
    expect(ProviderTransform.variants(claude).medium).toEqual({
      reasoning: { effort: "medium" },
    })
  })

  it("MiniMax M2.x stays excluded (no adaptive thinking)", () => {
    const m2 = makeModel({
      id: "minimax-coding-plan/MiniMax-M2.7",
      providerID: "minimax-coding-plan",
      api: {
        id: "MiniMax-M2.7",
        url: "https://api.minimax.io/anthropic",
        npm: "@ai-sdk/anthropic",
      },
    })
    expect(ProviderTransform.variants(m2)).toEqual({})
  })

  it("MiniMax-M3 returns adaptive thinking options", () => {
    const m3 = makeModel({
      id: "minimax-coding-plan/MiniMax-M3",
      providerID: "minimax-coding-plan",
      api: {
        id: "MiniMax-M3",
        url: "https://api.minimax.io/anthropic",
        npm: "@ai-sdk/anthropic",
      },
    })
    const result = ProviderTransform.variants(m3)
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
    expect(result.medium).toEqual({
      thinking: {
        type: "adaptive",
      },
      effort: "medium",
    })
  })

  it("smallOptions relies on the first configured variant", () => {
    const model = makeModel({
      providerID: "openrouter",
      api: {
        id: "openai/gpt-5.2",
        url: "https://openrouter.ai/api/v1",
        npm: "@openrouter/ai-sdk-provider",
      },
      variants: {
        low: { reasoning: { effort: "low" } },
        high: { reasoning: { effort: "high" } },
      },
    })
    expect(ProviderTransform.smallOptions(model)).toEqual({
      reasoning: { effort: "low" },
    })
  })

  it("preserves OpenRouter reasoning details in message content", () => {
    const model = makeModel({
      providerID: "openrouter",
      api: {
        id: "deepseek/deepseek-v4",
        url: "https://openrouter.ai/api/v1",
        npm: "@openrouter/ai-sdk-provider",
      },
      capabilities: {
        ...makeModel().capabilities,
        interleaved: { field: "reasoning_details" },
      },
    })
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking",
            providerOptions: {
              openrouter: {
                reasoning_details: [{ type: "reasoning.text", text: "thinking" }],
              },
            },
          },
          { type: "text", text: "answer" },
        ],
      },
    ]
    expect(ProviderTransform.message(msgs, model, {})).toEqual(msgs)
  })

  it("omits reasoning_content when the turn never produced reasoning parts", () => {
    // Use a non-deepseek id so the DeepSeek empty-reasoning injector does not run.
    const model = makeModel({
      providerID: "moonshot",
      api: {
        id: "kimi-k2",
        url: "https://api.moonshot.cn",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        ...makeModel().capabilities,
        interleaved: { field: "reasoning_content" },
      },
    })
    const withReasoning: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "step-by-step" },
          { type: "text", text: "done" },
        ],
      },
    ]
    const withEmpty: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "done" },
        ],
      },
    ]
    const withNone: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      },
    ]

    const nextReasoning = ProviderTransform.message(withReasoning, model, {})
    expect((nextReasoning[0] as any).providerOptions?.openaiCompatible?.reasoning_content).toBe("step-by-step")
    expect(
      Array.isArray(nextReasoning[0]?.content) && nextReasoning[0].content.every((p: any) => p.type !== "reasoning"),
    ).toBe(true)

    // Empty reasoning text from the provider is still forwarded (field required by some APIs).
    const nextEmpty = ProviderTransform.message(withEmpty, model, {})
    expect((nextEmpty[0] as any).providerOptions?.openaiCompatible?.reasoning_content).toBe("")

    // No reasoning parts at all → field absent so KV-cache prefixes stay stable.
    const nextNone = ProviderTransform.message(withNone, model, {})
    expect((nextNone[0] as any).providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })

  it("error rewrites 403 for github-copilot", () => {
    const msg = ProviderTransform.error("x-github-copilot", apiError({ message: "nope", statusCode: 403 }))
    expect(msg).toContain("reauthenticate")
  })

  it("error appends help link for unsupported model on copilot", () => {
    const msg = ProviderTransform.error("github-copilot", apiError({ message: "The requested model is not supported" }))
    expect(msg).toContain("github.com/settings/copilot")
  })

  it("options sets store false for openai and copilot", () => {
    const o1 = ProviderTransform.options({
      model: makeModel({
        providerID: "openai",
        api: {
          id: "gpt-4",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      }),
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
    const m = makeModel({
      providerID: "google",
      api: { id: "gemini-2.0", url: "u", npm: "@ai-sdk/google" },
    })
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
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
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
    expect(Provider.parseModel("a/b/c")).toEqual({
      providerID: "a",
      modelID: "b/c",
    })
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

  it("sort ranks gpt-6-astra above gpt-5, so it becomes the openai default", () => {
    // `Provider.sort(...)[0].id` is what the HTTP API reports as a provider's
    // default model, so this ordering picks OpenAI's current flagship.
    const astra = makeModel({ id: "gpt-6-astra" })
    const gpt5 = makeModel({ id: "gpt-5.5" })
    expect(Provider.sort([gpt5, astra])[0]!.id).toBe("gpt-6-astra")
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
    expect(ProviderAuth.Method.parse({ type: "api", label: "Key" })).toEqual({
      type: "api",
      label: "Key",
    })
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

describe("Requesty model discovery", () => {
  it("maps the dynamic catalog and authenticates when a key is available", async () => {
    let request: Request | undefined
    const models = await Provider.discoverRequestyModels({
      baseURL: "https://requesty.test/v1/",
      apiKey: "secret",
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({
          data: [
            {
              id: "policy/opus",
              created: 1_750_000_000,
              input_price: 0.000003,
              output_price: 0.000015,
              cached_price: 7.5e-7,
              context_window: 200_000,
              max_output_tokens: 32_000,
              supports_reasoning: true,
              supports_vision: true,
              supports_tool_calling: true,
            },
            {
              id: "policy/fallbacks",
              created: Number.MAX_VALUE,
              context_window: 0,
              max_output_tokens: -1,
            },
            { id: "", input_price: 1 },
            { id: "__proto__", input_price: 1 },
            { id: "policy/negative", input_price: -1 },
            { id: "policy/infinite", output_price: Number.POSITIVE_INFINITY },
          ],
        })
      },
    })

    expect(request?.url).toBe("https://requesty.test/v1/models")
    expect(request?.headers.get("authorization")).toBe("Bearer secret")
    expect(models["policy/opus"]).toEqual(
      expect.objectContaining({
        providerID: "requesty",
        cost: { input: 3, output: 15, cache: { read: 0.75, write: 0 } },
        limit: { context: 200_000, output: 32_000 },
      }),
    )
    expect(models["policy/opus"]?.capabilities.input.image).toBe(true)
    expect(models["policy/opus"]?.capabilities.toolcall).toBe(true)
    expect(models["policy/fallbacks"]?.limit).toEqual({
      context: 128_000,
      output: 4096,
    })
    expect(models["policy/fallbacks"]?.release_date).toBe("")
  })

  it("discovers the public catalog when Requesty has no API key", async () => {
    let called = false
    const models = await Provider.discoverRequestyModels({
      fetch: async () => {
        called = true
        return Response.json({ data: [{ id: "public/model" }] })
      },
    })

    expect(models["public/model"]).toBeDefined()
    expect(called).toBe(true)
  })

  it("falls back without failing provider initialization", async () => {
    const models = await Provider.discoverRequestyModels({
      apiKey: "secret",
      fetch: async () => new Response("unavailable", { status: 503 }),
    })
    expect(models).toEqual({})
  })

  it("deduplicates cached discovery for the same endpoint and credential", async () => {
    let calls = 0
    const cache = Provider.createRequestyDiscoveryCache({
      discover: async () => {
        calls++
        return { "policy/cached": {} as Provider.Model }
      },
      now: () => 1_000,
    })
    const input = {
      baseURL: "https://requesty-cache.test/v1",
      apiKey: "cached-key",
    }

    const [first, second] = await Promise.all([cache(input), cache(input)])

    expect(calls).toBe(1)
    expect(first["policy/cached"]).toBeDefined()
    expect(second).toBe(first)
  })

  it("rejects malformed IDs and sanitizes invalid prices", async () => {
    const models = await Provider.discoverRequestyModels({
      fetch: async () =>
        Response.json({
          data: [
            { id: "", input_price: 1 },
            { id: 42, input_price: 1 },
            {
              id: "safe",
              input_price: -1,
              output_price: "bad",
              cached_price: null,
            },
          ],
        }),
    })

    expect(Object.keys(models)).toEqual(["safe"])
    expect(models.safe?.cost).toEqual({
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    })
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
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
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
