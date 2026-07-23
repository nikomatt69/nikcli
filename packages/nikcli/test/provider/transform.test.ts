import { describe, expect, it } from "bun:test"
import * as ProviderTransform from "@/provider/transform"
import type { Provider } from "@/provider/provider"

// These transforms only read providerID, model.id, model.api.{npm,id}, and capabilities.reasoning.
function mockModel(input: { id: string; npm: string; apiId: string; reasoning: boolean }): Provider.Model {
  return {
    providerID: "openrouter",
    id: input.id,
    api: {
      id: input.apiId,
      url: "https://openrouter.ai/api/v1",
      npm: input.npm,
    },
    capabilities: { reasoning: input.reasoning },
  } as unknown as Provider.Model
}

describe("ProviderTransform.message — cache breakpoints", () => {
  it("adds OpenRouter cache breakpoints", () => {
    const model = mockModel({
      id: "openrouter/fusion",
      apiId: "openrouter/fusion",
      npm: "@openrouter/ai-sdk-provider",
      reasoning: false,
    })
    const messages = ProviderTransform.message([{ role: "system", content: "stable instructions" }], model, {})

    expect(messages[0]?.providerOptions?.openrouter).toEqual({
      cacheControl: { type: "ephemeral" },
    })
  })
})

describe("ProviderTransform.variants — openrouter fusion", () => {
  it("returns quality and budget presets even without reasoning capabilities", () => {
    const result = ProviderTransform.variants(
      mockModel({
        id: "openrouter/fusion",
        apiId: "openrouter/fusion",
        npm: "@openrouter/ai-sdk-provider",
        reasoning: false,
      }),
    )

    expect(result).toEqual({
      quality: {
        plugins: [
          {
            id: "fusion",
            analysis_models: ["~anthropic/claude-opus-latest", "~openai/gpt-latest", "~google/gemini-pro-latest"],
            model: "~anthropic/claude-opus-latest",
          },
        ],
      },
      budget: {
        plugins: [
          {
            id: "fusion",
            analysis_models: ["~google/gemini-flash-latest", "~moonshotai/kimi-latest", "deepseek/deepseek-v4-pro"],
            model: "~google/gemini-flash-latest",
          },
        ],
      },
    })
  })

  it("does not apply fusion presets to other openrouter models", () => {
    const result = ProviderTransform.variants(
      mockModel({
        id: "openrouter/some-model",
        apiId: "openrouter/some-model",
        npm: "@openrouter/ai-sdk-provider",
        reasoning: false,
      }),
    )
    expect(result).toEqual({})
  })

  it("exposes xhigh for grok multi-agent through OpenRouter's generic passthrough", () => {
    const result = ProviderTransform.variants(
      mockModel({
        id: "x-ai/grok-4.20-multi-agent-0309",
        apiId: "x-ai/grok-4.20-multi-agent-0309",
        npm: "@openrouter/ai-sdk-provider",
        reasoning: true,
      }),
    )
    expect(result).toEqual({
      low: { reasoning: { effort: "low" } },
      medium: { reasoning: { effort: "medium" } },
      high: { reasoning: { effort: "high" } },
      xhigh: { reasoning: { effort: "xhigh" } },
    })
  })

  it("maps fusion variant options to the OpenRouter request body namespace", () => {
    const model = mockModel({
      id: "openrouter/fusion",
      apiId: "openrouter/fusion",
      npm: "@openrouter/ai-sdk-provider",
      reasoning: false,
    })
    const budget = ProviderTransform.variants(model).budget

    expect(ProviderTransform.providerOptions(model, budget)).toEqual({
      openrouter: budget,
    })
  })
})

describe("ProviderTransform.variants — xai reasoning efforts", () => {
  const xaiModel = (id: string, reasoning = true) => mockModel({ id, apiId: id, npm: "@ai-sdk/xai", reasoning })

  it("gives grok-4.5 low/medium/high", () => {
    expect(ProviderTransform.variants(xaiModel("grok-4.5"))).toEqual({
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
    })
  })

  it("gives grok multi-agent low/medium/high, dropping xhigh the SDK schema rejects", () => {
    expect(ProviderTransform.variants(xaiModel("grok-4.20-multi-agent-0309"))).toEqual({
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
    })
  })

  it("keeps grok-3-mini at low/high", () => {
    expect(ProviderTransform.variants(xaiModel("grok-3-mini"))).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    })
  })

  it("gives fixed-depth grok reasoning models no variants", () => {
    for (const id of ["grok-4.3", "grok-4.20-0309-reasoning", "grok-code-fast-1", "grok-build-0.1", "grok-4"]) {
      expect(ProviderTransform.variants(xaiModel(id))).toEqual({})
    }
  })

  it("gives non-grok models served under the xai provider no variants", () => {
    expect(ProviderTransform.variants(xaiModel("composer-2.5"))).toEqual({})
  })

  it("does not treat non-reasoning grok models as effort-capable", () => {
    expect(ProviderTransform.variants(xaiModel("grok-4.5", false))).toEqual({})
  })
})
