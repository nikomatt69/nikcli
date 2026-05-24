import type { ProviderOptions, ReasoningEffort } from "../schema"
import { mergeProviderOptions } from "../schema"

/**
 * Typed shape for `providerOptions.openrouter`. The `openrouter.ts` protocol
 * passes these through to the wire as-is (renaming a couple of keys —
 * `promptCacheKey` → `prompt_cache_key`, `usage: true` → `usage: { include: true }`).
 */
export interface OpenRouterReasoning {
  readonly effort?: ReasoningEffort
  readonly maxTokens?: number
  readonly exclude?: boolean
}

export interface OpenRouterOptionsInput {
  readonly [key: string]: unknown
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: OpenRouterReasoning | Record<string, unknown>
  readonly promptCacheKey?: string
}

export type OpenRouterProviderOptionsInput = ProviderOptions & {
  readonly openrouter?: OpenRouterOptionsInput
}

const definedEntries = (input: Record<string, unknown>) =>
  Object.entries(input).filter((entry) => entry[1] !== undefined)

const openRouterProviderOptions = (options: OpenRouterOptionsInput | undefined): ProviderOptions | undefined => {
  if (!options) return undefined
  const openrouter = Object.fromEntries(
    definedEntries({
      usage: options.usage,
      reasoning: options.reasoning,
      promptCacheKey: options.promptCacheKey,
    }),
  )
  if (Object.keys(openrouter).length === 0) return undefined
  return { openrouter }
}

/**
 * Per-model defaults: OpenRouter model IDs are namespaced as `<vendor>/<id>`
 * (e.g. `openai/gpt-5`, `anthropic/claude-sonnet-4-7`, `z-ai/glm-4.5`).
 * We pattern-match on the full ID and emit a sensible reasoning + usage default.
 *
 * Coverage mirrors opencode's per-upstream variant matrix (rekram1-node PRs)
 * so each family on OpenRouter gets the same tiers as its direct provider.
 */
export const openRouterDefaultOptions = (modelID: string): ProviderOptions | undefined => {
  const id = modelID.toLowerCase()
  const usageDefault: OpenRouterOptionsInput = { usage: true }

  // OpenAI gpt-5 / o-series via OpenRouter.
  if (id.startsWith("openai/gpt-5") && !id.includes("gpt-5-chat") && !id.includes("gpt-5-pro")) {
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort: "medium" } })
  }
  if (id.startsWith("openai/o1") || id.startsWith("openai/o3") || id.startsWith("openai/o4")) {
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort: "medium" } })
  }

  // Anthropic thinking-capable models (claude-4.x or `:thinking`/`:reasoning` suffix).
  if (
    id.startsWith("anthropic/claude") &&
    (id.includes(":thinking") ||
      id.includes(":reasoning") ||
      id.includes("claude-opus-4") ||
      id.includes("claude-sonnet-4"))
  ) {
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort: "high" } })
  }

  // Google gemini-2.5 / gemini-3 (thinking-capable).
  if (id.startsWith("google/gemini-2.5") || id.startsWith("google/gemini-3")) {
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort: "medium" } })
  }

  // xAI grok-3-mini / grok-4 via OpenRouter.
  if (id.startsWith("x-ai/grok-3-mini") || id.startsWith("x-ai/grok-4")) {
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort: "medium" } })
  }

  // GLM / Z.AI on OpenRouter (z-ai/glm-4.5, zhipuai/glm-4-plus, etc).
  if (id.startsWith("z-ai/") || id.startsWith("zhipuai/") || id.includes("/glm-")) {
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort: "medium" } })
  }

  // DeepSeek-on-OpenRouter — v4+ accepts `max`, others use medium.
  if (id.startsWith("deepseek/") || id.includes("/deepseek-")) {
    const effort = id.includes("v4") || id.includes("v3.1") || id.includes("r1") ? "high" : "medium"
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort } })
  }

  // Kimi / Moonshot on OpenRouter.
  if (id.startsWith("moonshotai/") || id.includes("/kimi-") || id.includes("/k2p5")) {
    return openRouterProviderOptions({ ...usageDefault, reasoning: { effort: "medium" } })
  }

  // Default: enable usage so token counting works downstream.
  return openRouterProviderOptions(usageDefault)
}

export const withOpenRouterOptions = <
  Options extends { readonly providerOptions?: OpenRouterProviderOptionsInput },
>(
  modelID: string,
  options: Options,
): Options & { readonly id: string; readonly providerOptions?: ProviderOptions } => {
  return {
    ...options,
    id: modelID,
    providerOptions: mergeProviderOptions(openRouterDefaultOptions(modelID), options.providerOptions),
  }
}

export * as OpenRouterProviderOptions from "./openrouter-options"
