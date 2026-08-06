import { describe, expect, it } from "bun:test"
import { generateReasoningOptions, patchReasoningOptions } from "@/provider/variants-catalog-patch"
import type { ModelsDev } from "@/provider/models"

/**
 * Each `generateReasoningOptions` test mirrors an entry that used to be
 * covered by the procedural blacklist in `ProviderTransform.variants`.
 * The expected output is the same shape the procedural code produced,
 * but expressed as `reasoning_options` so the data-driven path in
 * `variants.ts` emits it (which then runs through the per-npm settings
 * table there).
 */
function makeModel(input: { id: string; modelID?: string }): ModelsDev.Model {
  return {
    id: input.id,
    modelID: input.modelID as never,
    name: input.id,
    release_date: "2026-01-01",
    attachment: false,
    reasoning: true,
    temperature: true,
    tool_call: true,
    limit: { context: 200_000, output: 8192 },
    options: {},
  } as unknown as ModelsDev.Model
}

describe("generateReasoningOptions — xAI grok", () => {
  it("grok-3-mini gets low/high on @ai-sdk/xai", () => {
    expect(generateReasoningOptions(makeModel({ id: "grok-3-mini" }), "@ai-sdk/xai")).toEqual([
      { type: "effort", values: ["low", "high"] },
    ])
  })

  it("grok-4.5 gets low/medium/high on @ai-sdk/xai", () => {
    expect(generateReasoningOptions(makeModel({ id: "grok-4.5" }), "@ai-sdk/xai")).toEqual([
      { type: "effort", values: ["low", "medium", "high"] },
    ])
  })

  it("grok-4-5 (dash form) also matches", () => {
    expect(generateReasoningOptions(makeModel({ id: "grok-4-5" }), "@ai-sdk/xai")).toEqual([
      { type: "effort", values: ["low", "medium", "high"] },
    ])
  })

  it("grok multi-agent gets 4 tiers on @ai-sdk/xai (xhigh is dropped later by settingsForEffort)", () => {
    expect(generateReasoningOptions(makeModel({ id: "grok-4.20-multi-agent-0309" }), "@ai-sdk/xai")).toEqual([
      { type: "effort", values: ["low", "medium", "high", "xhigh"] },
    ])
  })

  it("fixed-depth grok models (grok-4, grok-code, grok-build) get no patch", () => {
    for (const id of ["grok-4", "grok-4.3", "grok-code-fast-1", "grok-build-0.1", "grok-4.20-0309-reasoning"]) {
      expect(generateReasoningOptions(makeModel({ id }), "@ai-sdk/xai")).toEqual([])
    }
  })
})

describe("generateReasoningOptions — xAI grok via OpenRouter", () => {
  it("grok-3-mini gets low/high on @openrouter/ai-sdk-provider", () => {
    expect(generateReasoningOptions(makeModel({ id: "x-ai/grok-3-mini" }), "@openrouter/ai-sdk-provider")).toEqual([
      { type: "effort", values: ["low", "high"] },
    ])
  })

  it("grok-4.5 gets low/medium/high on OpenRouter", () => {
    expect(generateReasoningOptions(makeModel({ id: "x-ai/grok-4.5" }), "@openrouter/ai-sdk-provider")).toEqual([
      { type: "effort", values: ["low", "medium", "high"] },
    ])
  })

  it("grok multi-agent gets all 4 tiers on OpenRouter (xhigh passes through)", () => {
    expect(
      generateReasoningOptions(makeModel({ id: "x-ai/grok-4.20-multi-agent-0309" }), "@openrouter/ai-sdk-provider"),
    ).toEqual([{ type: "effort", values: ["low", "medium", "high", "xhigh"] }])
  })
})

describe("generateReasoningOptions — deepseek on openai-compatible", () => {
  it("deepseek-v4 gets low/medium/high/max", () => {
    expect(generateReasoningOptions(makeModel({ id: "deepseek-v4" }), "@ai-sdk/openai-compatible")).toEqual([
      { type: "effort", values: ["low", "medium", "high", "max"] },
    ])
  })
})

describe("generateReasoningOptions — kimi / qwen / glm", () => {
  it("kimi-k2-thinking on @ai-sdk/alibaba gets low/medium/high", () => {
    expect(generateReasoningOptions(makeModel({ id: "kimi-k2-thinking" }), "@ai-sdk/alibaba")).toEqual([
      { type: "effort", values: ["low", "medium", "high"] },
    ])
  })

  it("kimi-k2.5 on Anthropic gets low/medium/high/max", () => {
    expect(generateReasoningOptions(makeModel({ id: "kimi-k2.5" }), "@ai-sdk/anthropic")).toEqual([
      { type: "effort", values: ["low", "medium", "high", "max"] },
    ])
  })

  it("qwen on @ai-sdk/alibaba gets low/medium/high", () => {
    expect(generateReasoningOptions(makeModel({ id: "qwen-plus" }), "@ai-sdk/alibaba")).toEqual([
      { type: "effort", values: ["low", "medium", "high"] },
    ])
  })

  it("qwen on @ai-sdk/openai-compatible gets low/medium/high", () => {
    expect(generateReasoningOptions(makeModel({ id: "qwen3" }), "@ai-sdk/openai-compatible")).toEqual([
      { type: "effort", values: ["low", "medium", "high"] },
    ])
  })

  it("glm-4.6 on @ai-sdk/openai-compatible gets low/medium/high/max", () => {
    expect(generateReasoningOptions(makeModel({ id: "glm-4.6" }), "@ai-sdk/openai-compatible")).toEqual([
      { type: "effort", values: ["low", "medium", "high", "max"] },
    ])
  })

  it("glm-5.2 matches the upstream opencode.variant rule (in case a future catalog entries through here)", () => {
    // We don't ship a glm-5.2-specific rule (upstream owns it), but the
    // rule for `glm-5` should already cover it.
    expect(generateReasoningOptions(makeModel({ id: "glm-5.2" }), "@ai-sdk/openai-compatible")).toEqual([
      { type: "effort", values: ["low", "medium", "high", "max"] },
    ])
  })
})

describe("generateReasoningOptions — MiniMax M3", () => {
  it("minimax-m3 on Anthropic gets low/medium/high/max", () => {
    expect(generateReasoningOptions(makeModel({ id: "minimax-m3" }), "@ai-sdk/anthropic")).toEqual([
      { type: "effort", values: ["low", "medium", "high", "max"] },
    ])
  })

  it("minimax-m2.5 gets no patch (excluded by design)", () => {
    expect(generateReasoningOptions(makeModel({ id: "minimax-m2.5" }), "@ai-sdk/anthropic")).toEqual([])
  })

  it("minimax-m2 (no m3) gets no patch", () => {
    expect(generateReasoningOptions(makeModel({ id: "minimax-m2" }), "@ai-sdk/anthropic")).toEqual([])
  })
})

describe("generateReasoningOptions — negative cases", () => {
  it("returns [] for unknown npm", () => {
    expect(generateReasoningOptions(makeModel({ id: "grok-4.5" }), "@ai-sdk/some-unknown")).toEqual([])
  })

  it("returns [] for unknown id on a known npm", () => {
    expect(generateReasoningOptions(makeModel({ id: "composer-2.5" }), "@ai-sdk/xai")).toEqual([])
  })

  it("returns [] for grok-4.5 on @ai-sdk/openai-compatible (not the documented npm)", () => {
    expect(generateReasoningOptions(makeModel({ id: "grok-4.5" }), "@ai-sdk/openai-compatible")).toEqual([])
  })

  it("returns [] when no npm is given", () => {
    expect(generateReasoningOptions(makeModel({ id: "grok-4.5" }), undefined)).toEqual([])
  })
})

describe("patchReasoningOptions — catalog-wide merge", () => {
  function makeProvider(npm: string | undefined, models: ModelsDev.Model[]): ModelsDev.Provider {
    const out: Record<string, ModelsDev.Model> = {}
    for (const m of models) out[m.id] = m
    return {
      id: "test",
      name: "Test",
      env: [],
      ...(npm ? { npm } : {}),
      models: out,
    } as unknown as ModelsDev.Provider
  }

  it("fills reasoning_options for matching models and leaves others alone", () => {
    const grok = makeModel({ id: "grok-4.5" })
    const qwen = makeModel({ id: "qwen-plus" })
    const deepseek = makeModel({ id: "deepseek-v4" })
    const unrelated = makeModel({ id: "some-image-model" })

    const xai = makeProvider("@ai-sdk/xai", [grok, unrelated])
    const alibaba = makeProvider("@ai-sdk/alibaba", [qwen])
    const openaiCompatible = makeProvider("@ai-sdk/openai-compatible", [deepseek])

    const db = {
      xai,
      alibaba,
      "openai-compatible": openaiCompatible,
    } as Record<string, ModelsDev.Provider>
    patchReasoningOptions(db)

    expect(grok.reasoning_options).toEqual([{ type: "effort", values: ["low", "medium", "high"] }])
    expect(qwen.reasoning_options).toEqual([{ type: "effort", values: ["low", "medium", "high"] }])
    expect(deepseek.reasoning_options).toEqual([{ type: "effort", values: ["low", "medium", "high", "max"] }])
    expect(unrelated.reasoning_options).toBeUndefined()
  })

  it("does not overwrite a model that already declares reasoning_options", () => {
    const grok = makeModel({ id: "grok-4.5" })
    grok.reasoning_options = [{ type: "effort", values: ["low", "high"] }] // already-declared custom set
    const xai = makeProvider("@ai-sdk/xai", [grok])
    patchReasoningOptions({ xai } as Record<string, ModelsDev.Provider>)

    expect(grok.reasoning_options).toEqual([{ type: "effort", values: ["low", "high"] }])
  })

  it("does nothing when no model matches", () => {
    const grok = makeModel({ id: "grok-4.5" })
    const xai = makeProvider("@ai-sdk/some-other-npm", [grok])
    patchReasoningOptions({ xai } as Record<string, ModelsDev.Provider>)

    expect(grok.reasoning_options).toBeUndefined()
  })
})
