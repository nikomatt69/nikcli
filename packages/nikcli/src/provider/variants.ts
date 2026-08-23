/**
 * Data-driven reasoning variant derivation.
 *
 * Ported from upstream opencode v2 (`packages/core/src/models-dev.ts`,
 * `reasoningVariants` + helpers). Upstream reads the variants straight from
 * the `models.dev` catalog's per-model `reasoning_options` field, then maps
 * them onto the right `providerOptions` shape for the model's npm package.
 * This file does the same thing in nikcli: given a `ModelsDev.Model` and its
 * resolved npm, return a `Record<variantName, providerOptions>` map.
 *
 * The shape matches nikcli's existing `Model.variants` (a `Record`, not an
 * array of `{id, settings}` like upstream) so every existing call site —
 * `session/llm.ts`, `acp/*`, the TUI variant picker — keeps working
 * unchanged. Lookups are by variant name (`input.model.variants[name]`).
 *
 * When `reasoning_options` is missing, callers should fall back to the
 * procedural `ProviderTransform.variants(model)` derivation so models whose
 * catalog entries haven't been migrated upstream still get variants. This
 * mirrors how upstream itself treats an absent `reasoning_options`: an empty
 * array yields no variants.
 */

import type { ModelsDev } from "./models"
import { FUSION_BUILTIN_VARIANTS, FUSION_MODEL_ID, FUSION_NPM } from "@nikcli-ai/util/fusion"

const OPENAI_INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"]
const OUTPUT_TOKEN_MAX = 32_000

export type ReasoningOption =
  | { readonly type: "effort"; readonly values: readonly (string | null)[] }
  | { readonly type: "toggle" }
  | {
      readonly type: "budget_tokens"
      readonly min?: number
      readonly max?: number
    }

/**
 * Build the model's `variants` map from its `reasoning_options`. Returns
 * `{}` when the model has no `reasoning_options` (callers fall back to
 * `ProviderTransform.variants` in that case).
 *
 * The OpenRouter "Fusion" meta-model is special-cased: it has no
 * `reasoning_options` but still exposes the `quality` / `budget` presets
 * managed by the TUI Fusion manager.
 */
/**
 * Build the model's `variants` map from its `reasoning_options`. Returns
 * `{}` when the model has no `reasoning_options` (callers fall back to
 * `ProviderTransform.variants` in that case).
 *
 * `source.id` is treated as optional because user-defined entries in
 * `nikcli.json` (typed as `ModelsDev.Model.partial()`) often leave it
 * implicit; callers resolve the real id before passing it in. A missing id
 * just falls through to the empty-result path.
 */
export function reasoningVariants(
  source: Partial<Pick<ModelsDev.Model, "id" | "limit" | "provider" | "reasoning_options">>,
  npm: string,
): Record<string, Record<string, unknown>> {
  if (!source.id) return {}
  if (npm === FUSION_NPM && source.id === FUSION_MODEL_ID) {
    return { ...FUSION_BUILTIN_VARIANTS }
  }

  const options = source.reasoning_options
  if (!options || options.length === 0) return {}

  const toggle = options.some((option) => option.type === "toggle")
  const effort = options.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    const off = toggle
      ? Object.fromEntries(Object.entries(toggleVariants(npm, source.id)).filter(([id]) => id === "none"))
      : {}
    const variants: Record<string, Record<string, unknown>> = { ...off }
    for (const value of effort.values) {
      if (value === null) continue
      if (value === "none" && Object.keys(off).length > 0) continue
      // Direct @ai-sdk/xai rejects `xhigh` (its zod schema only allows
      // low|medium|high); the OpenRouter passthrough DOES accept it, so
      // we only filter when the npm is the direct xAI SDK. Mirrors the
      // blacklist in the previous procedural derivation.
      if (value === "xhigh" && npm === "@ai-sdk/xai") continue
      const settings = settingsForEffort(npm, source.id, value)
      if (settings) variants[value] = settings
    }
    return variants
  }

  const budget = options.find((option) => option.type === "budget_tokens")
  if (budget?.type === "budget_tokens") {
    const off = toggle
      ? Object.fromEntries(Object.entries(toggleVariants(npm, source.id)).filter(([id]) => id === "none"))
      : {}
    return { ...off, ...budgetVariants(npm, source, budget) }
  }

  if (toggle) return toggleVariants(npm, source.id ?? "")

  return {}
}

/**
 * Provider-options shape for a single effort tier on a given npm package.
 * Returns `undefined` for npm packages we know nothing about (callers drop
 * the variant). This is the per-npm "settings table" upstream keeps at the
 * bottom of `models-dev.ts`; nikcli's ports stay structurally identical.
 */
function settingsForEffort(npm: string, modelID: string, effort: string): Record<string, unknown> | undefined {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { effort } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    if (anthropicManualThinking(modelID)) return { effort }
    return { thinking: { type: "adaptive", display: "summarized" }, effort }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
  }
  if (npm === "@ai-sdk/amazon-bedrock") {
    if (modelID.includes("anthropic")) {
      return {
        reasoningConfig: {
          ...(anthropicManualThinking(modelID) ? undefined : { type: "adaptive", display: "summarized" }),
          maxReasoningEffort: effort,
        },
      }
    }
    return { reasoningConfig: { type: "enabled", maxReasoningEffort: effort } }
  }
  if (npm === "@ai-sdk/gateway") {
    const upstream = gatewayPackage(modelID)
    if (upstream) return settingsForEffort(upstream, modelID, effort)
    return { reasoningEffort: effort }
  }
  if (npm === "@ai-sdk/github-copilot") {
    if (modelID.includes("gemini")) return
    if (modelID.includes("claude")) return { reasoningEffort: effort }
    return {
      reasoningEffort: effort,
      reasoningSummary: "auto",
      include: OPENAI_INCLUDE_ENCRYPTED_REASONING,
    }
  }
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/amazon-bedrock/mantle" || npm === "@ai-sdk/azure") {
    return {
      reasoningEffort: effort,
      reasoningSummary: "auto",
      include: OPENAI_INCLUDE_ENCRYPTED_REASONING,
    }
  }
  if (npm === "@jerome-benoit/sap-ai-provider-v2") {
    if (modelID.includes("anthropic")) {
      return {
        modelParams: {
          additionalModelRequestFields: {
            ...(anthropicManualThinking(modelID)
              ? undefined
              : { thinking: { type: "adaptive", display: "summarized" } }),
            output_config: { effort },
          },
        },
      }
    }
    if (modelID.includes("gemini")) {
      return {
        modelParams: {
          thinkingConfig: { includeThoughts: true, thinkingLevel: effort },
        },
      }
    }
    if (modelID.includes("amazon--nova")) {
      return {
        modelParams: {
          additionalModelRequestFields: { output_config: { effort } },
        },
      }
    }
    return { modelParams: { reasoning_effort: effort } }
  }
  if (
    [
      "@ai-sdk/openai-compatible",
      "@ai-sdk/xai",
      "@ai-sdk/mistral",
      "@ai-sdk/groq",
      "@ai-sdk/cerebras",
      "@ai-sdk/deepinfra",
      "@ai-sdk/togetherai",
      "venice-ai-sdk-provider",
      "ai-gateway-provider",
    ].includes(npm)
  ) {
    return { reasoningEffort: effort }
  }
}

/**
 * Provider-options shape for a token budget. Mirrors upstream
 * `settingsForBudget`; one branch per npm package that takes `budgetTokens`
 * or the equivalent (Gemini's `thinkingBudget`, Cohere's `tokenBudget`,
 * OpenRouter's `reasoning.max_tokens`, etc.).
 */
function settingsForBudget(npm: string, modelID: string, budget: number): Record<string, unknown> | undefined {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { max_tokens: budget } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    return { thinking: { type: "enabled", budgetTokens: budget } }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    return {
      thinkingConfig: { includeThoughts: true, thinkingBudget: budget },
    }
  }
  if (npm === "@ai-sdk/amazon-bedrock") {
    return { reasoningConfig: { type: "enabled", budgetTokens: budget } }
  }
  if (npm === "@ai-sdk/gateway") {
    const upstream = gatewayPackage(modelID)
    return upstream ? settingsForBudget(upstream, modelID, budget) : { reasoning: { max_tokens: budget } }
  }
  if (npm === "@ai-sdk/cohere") return { thinking: { type: "enabled", tokenBudget: budget } }
  if (npm === "@ai-sdk/alibaba") return { enableThinking: true, thinkingBudget: budget }
  if (npm === "@jerome-benoit/sap-ai-provider-v2") {
    if (modelID.includes("anthropic")) {
      return {
        modelParams: {
          additionalModelRequestFields: {
            thinking: { type: "enabled", budget_tokens: budget },
          },
        },
      }
    }
    if (modelID.includes("gemini")) {
      return {
        modelParams: {
          thinkingConfig: { includeThoughts: true, thinkingBudget: budget },
        },
      }
    }
    if (modelID.includes("cohere")) {
      return {
        modelParams: { thinking: { type: "enabled", token_budget: budget } },
      }
    }
  }
}

/**
 * `{ none, thinking }` toggle variants. The `none` variant disables thinking
 * entirely; `thinking` enables it at the model's default depth. Both are
 * always emitted together (when the toggle option is declared) so the user
 * has a binary on/off choice plus any effort/budget variants the catalog
 * also declares.
 */
function toggleVariants(npm: string, modelID: string): Record<string, Record<string, unknown>> {
  if (npm === "@ai-sdk/gateway") {
    const upstream = gatewayPackage(modelID)
    if (upstream) return toggleVariants(upstream, modelID)
    return {
      none: { reasoning: { enabled: false } },
      thinking: { reasoning: { enabled: true } },
    }
  }
  if (npm === "@openrouter/ai-sdk-provider") {
    return {
      none: { reasoning: { enabled: false } },
      thinking: { reasoning: { enabled: true } },
    }
  }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    return {
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive", display: "summarized" } },
    }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    return {
      none: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } },
      thinking: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
      },
    }
  }
  if (npm === "@ai-sdk/amazon-bedrock") {
    const anthropic = modelID.includes("anthropic")
    return {
      none: {
        additionalModelRequestFields: anthropic
          ? { thinking: { type: "disabled" } }
          : { reasoningConfig: { type: "disabled" } },
      },
      thinking: {
        additionalModelRequestFields: anthropic
          ? { thinking: { type: "adaptive", display: "summarized" } }
          : { reasoningConfig: { type: "enabled" } },
      },
    }
  }
  if (npm === "@ai-sdk/alibaba") {
    return {
      none: { enableThinking: false },
      thinking: { enableThinking: true },
    }
  }
  if (npm === "@ai-sdk/cohere") {
    return {
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "enabled" } },
    }
  }
  if (npm === "@jerome-benoit/sap-ai-provider-v2") {
    if (modelID.includes("gemini")) {
      return {
        none: {
          modelParams: {
            thinkingConfig: { includeThoughts: false, thinkingBudget: 0 },
          },
        },
        thinking: {
          modelParams: {
            thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
          },
        },
      }
    }
    if (modelID.includes("cohere")) {
      return {
        none: { modelParams: { thinking: { type: "disabled" } } },
        thinking: { modelParams: { thinking: { type: "enabled" } } },
      }
    }
    if (modelID.includes("amazon--nova")) {
      return {
        none: {
          modelParams: {
            additionalModelRequestFields: { thinking: { type: "disabled" } },
          },
        },
        thinking: {
          modelParams: {
            additionalModelRequestFields: { thinking: { type: "enabled" } },
          },
        },
      }
    }
    if (modelID.includes("anthropic")) {
      return {
        none: {
          modelParams: {
            additionalModelRequestFields: { thinking: { type: "disabled" } },
          },
        },
        thinking: {
          modelParams: {
            additionalModelRequestFields: {
              thinking: { type: "adaptive", display: "summarized" },
            },
          },
        },
      }
    }
  }
  return {}
}

/**
 * Budget-style variants. The model exposes a thinking budget; we expose
 * `high` (half the max budget) and `max` (the full max budget, capped to
 * the model's output limit). When the budget is too small to be useful
 * (≤0), we emit nothing.
 */
function budgetVariants(
  npm: string,
  model: Partial<Pick<ModelsDev.Model, "id" | "limit">>,
  option: Extract<ReasoningOption, { type: "budget_tokens" }>,
): Record<string, Record<string, unknown>> {
  const id = model.id ?? ""
  const limit = model.limit?.output ?? 0
  const maximum = Math.min(option.max ?? OUTPUT_TOKEN_MAX - 1, limit - 1, OUTPUT_TOKEN_MAX - 1)
  if (maximum <= 0) return {}
  const high = Math.min(Math.max(option.min ?? 0, Math.floor((maximum + 1) / 2)), maximum)

  const result: Record<string, Record<string, unknown>> = {}
  const highSettings = settingsForBudget(npm, id, high)
  if (highSettings) result.high = highSettings
  const maxSettings = settingsForBudget(npm, id, maximum)
  if (maxSettings) result.max = maxSettings
  return result
}

/**
 * Map a Vercel AI Gateway model id (e.g. `anthropic/claude-...`) onto the
 * upstream npm package. Lets us recurse through the same per-npm settings
 * tables for gateway-routed models.
 */
function gatewayPackage(modelID: string): string | undefined {
  const separator = modelID.indexOf("/")
  if (separator <= 0) return
  const prefix = modelID.slice(0, separator)
  if (prefix === "anthropic") return "@ai-sdk/anthropic"
  if (prefix === "google") return "@ai-sdk/google"
  if (prefix === "amazon") return "@ai-sdk/amazon-bedrock"
  if (prefix === "alibaba") return "@ai-sdk/alibaba"
}

/**
 * Anthropic models older than 4.6 don't accept `thinking: { type: "adaptive" }`
 * — they need a `budget_tokens` field. Detects the family / version from
 * either `claude-{family}-{version}` or `claude-{version}-{family}`.
 */
function anthropicManualThinking(modelID: string): boolean {
  const familyFirst = /(?:claude-)?(?:opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?/i.exec(modelID)
  const versionFirst = /claude-(\d+)(?:[.-](\d+))?-(?:opus|sonnet|haiku)/i.exec(modelID)
  const major = Number(familyFirst?.[1] ?? versionFirst?.[1])
  const rawMinor = Number(familyFirst?.[2] ?? versionFirst?.[2] ?? 0)
  if (!Number.isFinite(major)) return false
  const minor = rawMinor > 9 ? 0 : rawMinor
  return major < 4 || (major === 4 && minor < 6)
}
