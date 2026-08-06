/**
 * Catalog-side variant generation, mirroring upstream opencode v2's
 * `opencode.variant` plugin (`packages/core/src/plugin/variant.ts`).
 *
 * Upstream's plugin (`opencode.variant`) only handles one model family
 * (`glm-5.2` on `@ai-sdk/openai-compatible`) because everything else is
 * expected to carry `reasoning_options` directly in the models.dev
 * catalog. nikcli ships its own list because it supports providers
 * (xAI/grok, deepseek, kimi, qwen, glm, MiniMax M3) whose catalog
 * entries the upstream registry doesn't yet enrich with
 * `reasoning_options`, but for which nikcli has working reasoning
 * control today.
 *
 * Structure is the same as upstream:
 *   - `generate(model, provider)` returns the list of variants to
 *     auto-generate for a single (provider, model) entry, or `[]` if
 *     none apply.
 *   - The caller (see `patchReasoningOptions` in `./models.ts`)
 *     iterates the catalog, calls `generate`, and merges: any explicit
 *     variant already on the model wins over the generated one.
 *   - Variants are emitted as `reasoning_options` so the data-driven
 *     path in `./variants.ts` produces the same providerOptions shape
 *     it would for a catalog-declared entry.
 */

import type { ModelsDev } from "./models"
import type { ReasoningOption } from "./variants"

/**
 * Upstream-style (id, package) → reasoning_options patch. Each entry
 * declares the option shape that the data-driven `reasoningVariants`
 * knows how to translate into per-npm `providerOptions`.
 *
 * Tests in `test/provider/variants-catalog-patch.test.ts` cover every
 * entry; the inline comments cite the upstream docs that justify the
 * tier set.
 */
const REASONING_OPTIONS: ReadonlyArray<{
  /** Match when the model's npm is in this list. Empty list = any npm. */
  readonly npms: readonly string[]
  /** Match when the model id (or model.modelID) lowercased contains one of these substrings. */
  readonly idIncludes: readonly string[]
  readonly options: readonly ReasoningOption[]
}> = [
  // ─── xAI (grok) ──────────────────────────────────────────────────
  // Docs: https://docs.x.ai/docs/guides/reasoning
  // grok-3-mini: only low/high (reasoning can't be disabled).
  {
    npms: ["@ai-sdk/xai"],
    idIncludes: ["grok-3-mini"],
    options: [{ type: "effort", values: ["low", "high"] }],
  },
  // grok-4.5: low/medium/high. Matched by exact dot/dash forms only —
  // "grok-4" alone would over-match grok-4.20-multi-agent and grok-4.3.
  {
    npms: ["@ai-sdk/xai"],
    idIncludes: ["grok-4.5", "grok-4-5"],
    options: [{ type: "effort", values: ["low", "medium", "high"] }],
  },
  // grok multi-agent (grok-4.20-multi-agent-...): 4 tiers; xhigh will be
  // dropped by `settingsForEffort` because the @ai-sdk/xai zod schema
  // rejects it, matching the test "drops xhigh the SDK schema rejects".
  {
    npms: ["@ai-sdk/xai"],
    idIncludes: ["multi-agent"],
    options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
  },

  // ─── xAI on OpenRouter ───────────────────────────────────────────
  // OpenRouter's `reasoning.effort` passthrough accepts xhigh, so all
  // four tiers are emitted as-is.
  {
    npms: ["@openrouter/ai-sdk-provider"],
    idIncludes: ["grok-3-mini"],
    options: [{ type: "effort", values: ["low", "high"] }],
  },
  {
    npms: ["@openrouter/ai-sdk-provider"],
    idIncludes: ["grok-4.5", "grok-4-5"],
    options: [{ type: "effort", values: ["low", "medium", "high"] }],
  },
  {
    npms: ["@openrouter/ai-sdk-provider"],
    idIncludes: ["multi-agent"],
    options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
  },

  // ─── deepseek ────────────────────────────────────────────────────
  // deepseek-reasoner / r1 / v3 are pure reasoning models; the
  // reasoning budget is internal so we only expose the toggle on
  // openai-compatible fronts. deepseek-v4 (and v4-pro) gets an effort
  // ramp matching the openai-compatible branch in the procedural code.
  {
    npms: ["@ai-sdk/openai-compatible"],
    idIncludes: ["deepseek-v4"],
    options: [{ type: "effort", values: ["low", "medium", "high", "max"] }],
  },

  // ─── kimi (Moonshot) ─────────────────────────────────────────────
  // kimi-k2-thinking / kimi-k2.5 / kimi-k2p5 / kimi-k2-5 reason by
  // default on alibaba; on anthropic-fronted kimi we expose adaptive
  // thinking via the toggle.
  {
    npms: ["@ai-sdk/alibaba"],
    idIncludes: ["kimi-k2-thinking", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"],
    options: [{ type: "effort", values: ["low", "medium", "high"] }],
  },
  {
    npms: ["@ai-sdk/anthropic", "@ai-sdk/google-vertex/anthropic"],
    idIncludes: ["kimi-k2-thinking", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"],
    options: [{ type: "effort", values: ["low", "medium", "high", "max"] }],
  },

  // ─── qwen (Alibaba / openai-compatible) ─────────────────────────
  {
    npms: ["@ai-sdk/alibaba"],
    idIncludes: ["qwen"],
    options: [{ type: "effort", values: ["low", "medium", "high"] }],
  },
  {
    npms: ["@ai-sdk/openai-compatible"],
    idIncludes: ["qwen"],
    options: [{ type: "effort", values: ["low", "medium", "high"] }],
  },

  // ─── glm (Zhipu / openai-compatible) ────────────────────────────
  {
    npms: ["@ai-sdk/alibaba"],
    idIncludes: ["glm"],
    options: [{ type: "effort", values: ["low", "medium", "high"] }],
  },
  {
    npms: ["@ai-sdk/openai-compatible"],
    idIncludes: ["glm-4.6", "glm-4.7", "glm-4-6", "glm-4-7", "glm-5"],
    options: [{ type: "effort", values: ["low", "medium", "high", "max"] }],
  },

  // ─── k2p / kimi-k2p (GLM-style k2p5 family) ────────────────────
  {
    npms: ["@ai-sdk/alibaba"],
    idIncludes: ["k2p"],
    options: [{ type: "effort", values: ["low", "medium", "high"] }],
  },

  // ─── MiniMax M3 (Anthropic-compatible) ──────────────────────────
  // M3 takes the Anthropic adaptive thinking format; declared with a
  // toggle + effort ramp, matching the upstream fixture
  // `opencode-go/minimax-m3`.
  {
    npms: ["@ai-sdk/anthropic", "@ai-sdk/google-vertex/anthropic"],
    idIncludes: ["minimax-m3"],
    options: [{ type: "effort", values: ["low", "medium", "high", "max"] }],
  },
]

/**
 * Return the `reasoning_options` to inject for a model, or `[]` if
 * no patch applies. Mirrors upstream `opencode.variant`'s `generate`:
 * matches on the model's effective npm and on substring(s) of the id,
 * case-insensitive.
 */
export function generateReasoningOptions(model: ModelsDev.Model, providerNpm: string | undefined): ReasoningOption[] {
  if (!providerNpm) return []
  // The catalog source has only `id`; `modelID` is the resolved provider id
  // that exists on `Provider.Model` after normalization. We accept both
  // shapes here so the same matcher works when called from either stage.
  const id = `${model.id ?? ""}`.toLowerCase()
  if (!id.trim()) return []

  for (const rule of REASONING_OPTIONS) {
    if (rule.npms.length > 0 && !rule.npms.includes(providerNpm)) continue
    if (!rule.idIncludes.some((needle) => id.includes(needle.toLowerCase()))) continue
    return [...rule.options]
  }
  return []
}

/**
 * Apply the patch to the whole catalog in place. Models that already
 * declare `reasoning_options` are left untouched; the patch only
 * fills in for entries that don't. Mirrors the merge logic in
 * `opencode.variant`: explicit beats generated.
 */
export function patchReasoningOptions(database: Record<string, ModelsDev.Provider>): void {
  for (const provider of Object.values(database)) {
    const providerNpm = provider.npm
    for (const model of Object.values(provider.models ?? {})) {
      if (model.reasoning_options && model.reasoning_options.length > 0) continue
      const generated = generateReasoningOptions(model, providerNpm)
      if (generated.length === 0) continue
      // The schema for `ModelsDev.Model.reasoning_options` is a mutable
      // union; our internal `ReasoningOption` is `readonly`. Clone each
      // variant into the mutable shape the schema expects.
      model.reasoning_options = generated.map(cloneOption)
    }
  }
}

/**
 * Convert a `readonly ReasoningOption` to the mutable shape the
 * `ModelsDev.Model.reasoning_options` schema expects. Mirrors the
 * `Schema.Array(Schema.Union([...])).Type` widening that happens at
 * the catalog boundary.
 */
function cloneOption(option: ReasoningOption): NonNullable<ModelsDev.Model["reasoning_options"]>[number] {
  if (option.type === "effort") {
    return { type: "effort", values: [...option.values] }
  }
  if (option.type === "toggle") {
    return { type: "toggle" }
  }
  return {
    type: "budget_tokens",
    ...(option.min !== undefined ? { min: option.min } : {}),
    ...(option.max !== undefined ? { max: option.max } : {}),
  }
}
