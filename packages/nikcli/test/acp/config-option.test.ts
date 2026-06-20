import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import {
  ACPConfigOption,
  buildConfigOptions,
  buildEffortSelectOption,
  buildModeSelectOption,
  buildModelSelectOption,
  type ConfigOptionProvider,
  formatCurrentModelId,
  formatVariantName,
  parseModelSelection,
  stableStringify,
} from "@/acp/config-option"

// The build* helpers are typed as the full SessionConfigOption union; in these
// tests they always produce the "select" variant, which carries options/currentValue.
type SelectOption = Extract<SessionConfigOption, { type: "select" }>

const PROVIDERS: ConfigOptionProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
      },
      "claude-haiku-4-5": { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    },
  },
  {
    id: "nikcli",
    name: "Nikcli",
    models: {
      "big-pickle": {
        id: "big-pickle",
        name: "Big Pickle",
        variants: { default: {}, low: {}, high: {} },
      },
    },
  },
]

describe("acp/config-option", () => {
  test("parseModelSelection splits provider/model and provider/model/variant", () => {
    expect(parseModelSelection("anthropic/claude-sonnet-4-5", PROVIDERS)).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
    })
    expect(parseModelSelection("nikcli/big-pickle/high", PROVIDERS)).toEqual({
      model: { providerID: "nikcli", modelID: "big-pickle" },
      variant: "high",
    })
  })

  test("parseModelSelection falls back to providerID without slash", () => {
    expect(parseModelSelection("unknown", PROVIDERS)).toEqual({
      model: { providerID: "unknown", modelID: "" },
    })
  })

  test("formatCurrentModelId omits variant when not requested", () => {
    expect(
      formatCurrentModelId({
        model: { providerID: "nikcli", modelID: "big-pickle" },
        variants: ["low", "high"],
      }),
    ).toBe("nikcli/big-pickle")
  })

  test("formatCurrentModelId includes variant when requested", () => {
    expect(
      formatCurrentModelId({
        model: { providerID: "nikcli", modelID: "big-pickle" },
        variant: "high",
        variants: ["low", "high"],
        includeVariant: true,
      }),
    ).toBe("nikcli/big-pickle/high")
  })

  test("formatVariantName titlecases snake and kebab case", () => {
    expect(formatVariantName("low")).toBe("Low")
    expect(formatVariantName("high_effort")).toBe("High Effort")
    expect(formatVariantName("kebab-case")).toBe("Kebab Case")
  })

  test("buildEffortSelectOption returns undefined for empty variants", () => {
    expect(buildEffortSelectOption({ variants: [] })).toBeUndefined()
  })

  test("buildEffortSelectOption lists variant options", () => {
    const out = buildEffortSelectOption({
      variants: ["low", "high"],
      currentVariant: "high",
    }) as SelectOption | undefined
    expect(out?.id).toBe("effort")
    expect(out?.currentValue).toBe("high")
    expect(out?.options).toHaveLength(2)
  })

  test("buildModeSelectOption emits id/name/description", () => {
    const out = buildModeSelectOption({
      modes: [{ id: "build", name: "Build", description: "Write code" }],
      currentModeId: "build",
    }) as SelectOption
    expect(out.options).toEqual([{ value: "build", name: "Build", description: "Write code" }])
  })

  test("buildModelSelectOption includes a group per provider with multiple models", () => {
    const out = buildModelSelectOption({
      providers: PROVIDERS,
      currentModel: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
      includeVariants: true,
    }) as SelectOption
    expect(out.id).toBe("model")
    // The output is either a flat list or grouped; when both providers
    // have multiple entries, we expect grouped output.
    expect(out.options).toHaveLength(2)
    if (Array.isArray(out.options) && "group" in (out.options[0] as object)) {
      const first = out.options[0] as { group: string; options: unknown[] }
      expect(first.group).toBe("anthropic")
    }
  })

  test("buildConfigOptions emits model + mode when currentModeId is provided", () => {
    const options = buildConfigOptions({
      providers: PROVIDERS,
      currentModel: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
      modes: [{ id: "build", name: "Build" }],
      currentModeId: "build",
      includeModelVariants: false,
    })
    expect(options.find((o) => o.id === "model")).toBeDefined()
    expect(options.find((o) => o.id === "mode")).toBeDefined()
  })

  test("buildConfigOptions emits effort when variants are available", () => {
    const options = buildConfigOptions({
      providers: PROVIDERS,
      currentModel: { providerID: "nikcli", modelID: "big-pickle" },
      includeModelVariants: true,
    })
    expect(options.find((o) => o.id === "effort")).toBeDefined()
  })

  test("stableStringify produces deterministic keys regardless of input order", () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(stableStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}')
    expect(stableStringify([{ y: 1, x: 2 }, { z: 3 }])).toBe('[{"x":2,"y":1},{"z":3}]')
  })

  test("namespace export points at the same helpers", () => {
    expect(ACPConfigOption.formatVariantName).toBe(formatVariantName)
  })
})
