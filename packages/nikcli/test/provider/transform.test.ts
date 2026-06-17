import { describe, expect, it } from "bun:test"
import * as ProviderTransform from "@/provider/transform"
import type { Provider } from "@/provider/provider"

// `variants()` only reads model.id, model.api.{npm,id} and capabilities.reasoning,
// so a minimal cast-based mock is sufficient for these cases.
function mockModel(input: { id: string; npm: string; apiId: string; reasoning: boolean }): Provider.Model {
  return {
    id: input.id,
    api: {
      id: input.apiId,
      url: "https://openrouter.ai/api/v1",
      npm: input.npm,
    },
    capabilities: { reasoning: input.reasoning },
  } as unknown as Provider.Model
}

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
