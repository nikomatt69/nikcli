import { describe, expect, it } from "bun:test"
import { reasoningVariants, type ReasoningOption } from "@/provider/variants"
import type { ModelsDev } from "@/provider/models"

/**
 * Build a minimal `ModelsDev.Model` carrying only the fields the data-driven
 * `reasoningVariants` actually reads (`id`, `limit`, `provider`, and
 * `reasoning_options`). Mirrors the upstream opencode v2 input shape so
 * tests can describe catalog entries directly instead of going through the
 * full loader.
 */
function makeSource(input: {
  id: string
  output: number
  npm?: string
  reasoning_options?: ReasoningOption[]
}): ModelsDev.Model {
  return {
    id: input.id,
    name: input.id,
    release_date: "2025-01-01",
    attachment: false,
    reasoning: true,
    temperature: true,
    tool_call: true,
    limit: { context: 200_000, output: input.output },
    options: {},
    ...(input.npm ? { provider: { npm: input.npm, api: "https://example.com" } } : {}),
    ...(input.reasoning_options ? { reasoning_options: input.reasoning_options } : {}),
  } as unknown as ModelsDev.Model
}

describe("reasoningVariants — empty / absent catalog data", () => {
  it("returns {} when reasoning_options is missing", () => {
    const result = reasoningVariants(makeSource({ id: "gpt-5", output: 8192 }), "@ai-sdk/openai")
    expect(result).toEqual({})
  })

  it("returns {} when reasoning_options is an empty array", () => {
    const result = reasoningVariants(makeSource({ id: "gpt-5", output: 8192, reasoning_options: [] }), "@ai-sdk/openai")
    expect(result).toEqual({})
  })
})

describe("reasoningVariants — openrouter / openrouter-fusion", () => {
  it("returns FUSION_BUILTIN_VARIANTS for the openrouter/fusion meta-model regardless of reasoning_options", () => {
    const result = reasoningVariants(
      makeSource({ id: "openrouter/fusion", output: 8192 }),
      "@openrouter/ai-sdk-provider",
    ) as Record<string, { plugins?: Array<{ id: string }> }>
    expect(Object.keys(result).sort()).toEqual(["budget", "quality"])
    expect(result.quality?.plugins?.[0]?.id).toBe("fusion")
    expect(result.budget?.plugins?.[0]?.id).toBe("fusion")
  })

  it("uses the generic { reasoning: { effort } } passthrough for non-fusion models", () => {
    const result = reasoningVariants(
      makeSource({
        id: "x-ai/grok-4.20-multi-agent-0309",
        output: 8192,
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
      }),
      "@openrouter/ai-sdk-provider",
    )
    expect(result).toEqual({
      low: { reasoning: { effort: "low" } },
      medium: { reasoning: { effort: "medium" } },
      high: { reasoning: { effort: "high" } },
      xhigh: { reasoning: { effort: "xhigh" } },
    })
  })
})

describe("reasoningVariants — openai", () => {
  it("emits reasoningEffort + reasoningSummary=auto + include for each tier", () => {
    const result = reasoningVariants(
      makeSource({
        id: "gpt-5",
        output: 8192,
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
      }),
      "@ai-sdk/openai",
    )
    expect(result).toEqual({
      low: {
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
      medium: {
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
      high: {
        reasoningEffort: "high",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    })
  })
})

describe("reasoningVariants — anthropic", () => {
  it("uses adaptive thinking with summarized display for opus-4.6+", () => {
    const result = reasoningVariants(
      makeSource({
        id: "claude-opus-4-7",
        output: 8192,
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
      }),
      "@ai-sdk/anthropic",
    )
    expect(result).toEqual({
      low: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "low",
      },
      medium: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "medium",
      },
      high: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "high",
      },
      xhigh: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "xhigh",
      },
      max: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "max",
      },
    })
  })

  it("falls back to plain { effort } for pre-4.6 models that don't take adaptive thinking", () => {
    const result = reasoningVariants(
      makeSource({
        id: "claude-3-7-sonnet",
        output: 8192,
        reasoning_options: [{ type: "effort", values: ["low", "high"] }],
      }),
      "@ai-sdk/anthropic",
    )
    expect(result).toEqual({
      low: { effort: "low" },
      high: { effort: "high" },
    })
  })
})

describe("reasoningVariants — google", () => {
  it("maps effort tiers onto thinkingLevel for non-2.5 Gemini", () => {
    const result = reasoningVariants(
      makeSource({
        id: "gemini-3-pro",
        output: 8192,
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
      }),
      "@ai-sdk/google",
    )
    expect(result).toEqual({
      low: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } },
      medium: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" },
      },
      high: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
      },
    })
  })
})

describe("reasoningVariants — toggle", () => {
  it("emits { none, thinking } for an anthropic toggle", () => {
    const result = reasoningVariants(
      makeSource({
        id: "claude-opus-4-7",
        output: 8192,
        reasoning_options: [{ type: "toggle" }],
      }),
      "@ai-sdk/anthropic",
    )
    expect(result).toEqual({
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive", display: "summarized" } },
    })
  })

  it("combines toggle and effort: effort tiers + the toggle's `none` variant", () => {
    const result = reasoningVariants(
      makeSource({
        id: "claude-opus-4-7",
        output: 8192,
        reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "medium", "high"] }],
      }),
      "@ai-sdk/anthropic",
    )
    expect(result.none).toEqual({ thinking: { type: "disabled" } })
    expect(result.low).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      effort: "low",
    })
    expect(result.medium).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      effort: "medium",
    })
    expect(result.high).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      effort: "high",
    })
  })
})

describe("reasoningVariants — budget_tokens", () => {
  it("emits high (half) and max (full) budgets for an anthropic budget option", () => {
    const result = reasoningVariants(
      makeSource({
        id: "claude-opus-4-5",
        output: 8192,
        reasoning_options: [{ type: "budget_tokens", min: 1024, max: 8000 }],
      }),
      "@ai-sdk/anthropic",
    )
    expect(result.high).toEqual({
      thinking: { type: "enabled", budgetTokens: 4000 },
    })
    expect(result.max).toEqual({
      thinking: { type: "enabled", budgetTokens: 8000 },
    })
  })

  it("caps the budget at the model's output limit and clamps high to the same value when min > max", () => {
    // output=1024 → max budget capped to 1023. min=1024 > max(1023) is
    // clamped down to max, so high and max collapse to the same value.
    const result = reasoningVariants(
      makeSource({
        id: "claude-opus-4-5",
        output: 1024,
        reasoning_options: [{ type: "budget_tokens", min: 1024, max: 8000 }],
      }),
      "@ai-sdk/anthropic",
    )
    expect(result.max).toEqual({
      thinking: { type: "enabled", budgetTokens: 1023 },
    })
    expect(result.high).toEqual({
      thinking: { type: "enabled", budgetTokens: 1023 },
    })
  })
})

describe("reasoningVariants — gateway passthrough", () => {
  it("recurses into the upstream npm for an anthropic/* gateway id", () => {
    const result = reasoningVariants(
      makeSource({
        id: "anthropic/claude-opus-4-7",
        output: 8192,
        reasoning_options: [{ type: "effort", values: ["low", "high"] }],
      }),
      "@ai-sdk/gateway",
    )
    expect(result).toEqual({
      low: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "low",
      },
      high: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "high",
      },
    })
  })

  it("falls back to { reasoningEffort } for unknown gateway prefixes", () => {
    const result = reasoningVariants(
      makeSource({
        id: "some-other/claude-opus-4-7",
        output: 8192,
        reasoning_options: [{ type: "effort", values: ["low", "high"] }],
      }),
      "@ai-sdk/gateway",
    )
    expect(result).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    })
  })
})
