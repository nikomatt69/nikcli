// Latest Open Models (Apache 2.0 / MIT - can be resold)
// Updated: May 2026

export const MODELS = {
  // ============ KIMI (Moonshot AI) - K2.6 Latest ============
  "kimi-k2.6": {
    provider: "local",
    context: 262_144,
    input: 8,
    output: 24,
    params: "32B act / 1T total",
    hfId: "moonshotai/Kimi-K2.6",
  },
  "kimi-k2.5": {
    provider: "local",
    context: 262_144,
    input: 7,
    output: 21,
    params: "32B act / 1T total",
    hfId: "moonshotai/Kimi-K2.5",
  },

  // ============ GLM (Zhipu AI) - 5.1 Latest ============
  "glm-5.1": {
    provider: "local",
    context: 200_000,
    input: 10,
    output: 30,
    params: "94B act / 752B total",
    hfId: "zai-org/GLM-5.1",
  },
  "glm-5": {
    provider: "local",
    context: 200_000,
    input: 8,
    output: 24,
    params: "94B act / 752B total",
    hfId: "zai-org/GLM-5",
  },

  // ============ QWEN (Alibaba) - 3.5 Latest ============
  "qwen-3.5-72b": {
    provider: "local",
    context: 131_072,
    input: 12,
    output: 36,
    params: "72B",
    hfId: "Qwen/Qwen3.5-72B-Instruct",
  },
  "qwen-3.5-32b": {
    provider: "local",
    context: 131_072,
    input: 6,
    output: 18,
    params: "32B",
    hfId: "Qwen/Qwen3.5-32B-Instruct",
  },
  "qwen-3.5-14b": {
    provider: "local",
    context: 131_072,
    input: 3,
    output: 9,
    params: "14B",
    hfId: "Qwen/Qwen3.5-14B-Instruct",
  },
  "qwq-32b": {
    provider: "local",
    context: 131_072,
    input: 8,
    output: 24,
    params: "32B reasoning",
    hfId: "Qwen/QWQ-32B",
  },

  // ============ DEEPSEEK - V4 / R2 Latest ============
  "deepseek-v4-pro": {
    provider: "local",
    context: 131_072,
    input: 8,
    output: 32,
    params: "236B act / 2T total",
    hfId: "deepseek-ai/DeepSeek-V4-Pro",
  },
  "deepseek-v3": {
    provider: "local",
    context: 131_072,
    input: 5,
    output: 15,
    params: "37B act / 685B total",
    hfId: "deepseek-ai/DeepSeek-V3",
  },
  "deepseek-r1": {
    provider: "local",
    context: 131_072,
    input: 5,
    output: 20,
    params: "671B",
    hfId: "deepseek-ai/DeepSeek-R1",
  },
  "deepseek-r1-distill-32b": {
    provider: "local",
    context: 131_072,
    input: 4,
    output: 16,
    params: "32B distilled",
    hfId: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
  },

  // ============ LLAMA (Meta) - 4 Latest ============
  "llama-4-scout": {
    provider: "local",
    context: 1_048_576,
    input: 4,
    output: 12,
    params: "17B act / 109B total",
    hfId: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  },
  "llama-4-maverick": {
    provider: "local",
    context: 1_048_576,
    input: 6,
    output: 18,
    params: "17B act / 402B total",
    hfId: "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
  },
  "llama-3.3-70b": {
    provider: "groq",
    context: 131_072,
    input: 59,
    output: 79,
    params: "70B dense",
    hfId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },

  // ============ MISTRAL - Medium 3.5 / Small 4 ============
  "mistral-medium-3.5": {
    provider: "local",
    context: 262_144,
    input: 15,
    output: 45,
    params: "128B dense",
    hfId: "mistralai/Mistral-Medium-3.5-128B",
  },
  "mistral-small-4": {
    provider: "local",
    context: 131_072,
    input: 6,
    output: 18,
    params: "119B",
    hfId: "mistralai/Mistral-Small-4-119B-2603",
  },
  "devstral-2": {
    provider: "local",
    context: 131_072,
    input: 8,
    output: 24,
    params: "123B",
    hfId: "mistralai/Devstral-2-123B-Instruct-2512",
  },

  // ============ GEMMA (Google) - 4 Latest ============
  "gemma-4-31b": {
    provider: "local",
    context: 262_144,
    input: 5,
    output: 15,
    params: "31B dense",
    hfId: "google/gemma-4-31B-it",
  },
  "gemma-4-26b-a4b": {
    provider: "local",
    context: 262_144,
    input: 4,
    output: 12,
    params: "4B act / 26B total MoE",
    hfId: "google/gemma-4-26B-A4B-it",
  },

  // ============ PHI (Microsoft) - 4 Latest ============
  "phi-4-mini": {
    provider: "local",
    context: 131_072,
    input: 1,
    output: 3,
    params: "3.8B",
    hfId: "microsoft/Phi-4-mini-instruct",
  },
  "phi-4": {
    provider: "local",
    context: 131_072,
    input: 3,
    output: 9,
    params: "14B",
    hfId: "microsoft/Phi-4",
  },

  // ============ MINIMAX (MiniMax AI) - M2.7 ============
  "minimax-m2.7": {
    provider: "local",
    context: 100_000,
    input: 8,
    output: 24,
    params: "456B act / 2T total",
    hfId: "MiniMaxAI/MiniMax-M2.7",
  },
  "minimax-m2": {
    provider: "local",
    context: 100_000,
    input: 6,
    output: 18,
    params: "456B act / 2T total",
    hfId: "MiniMaxAI/MiniMax-M2",
  },

  // ============ OPENROUTER-ONLY MODELS (added via /openrouter/<provider>) ============
  "deepseek-v4-flash": {
    provider: "openrouter",
    context: 1_048_576,
    input: 0.14,
    output: 0.28,
    params: "MoE flash (V4)",
    hfId: "deepseek-ai/DeepSeek-V4-Flash",
  },
  "deepseek-v3.2": {
    provider: "openrouter",
    context: 131_072,
    input: 0.32,
    output: 0.47,
    params: "MoE (V3.2)",
    hfId: "deepseek-ai/DeepSeek-V3.2",
  },
  "deepseek-r1-0528": {
    provider: "openrouter",
    context: 164_000,
    input: 0.63,
    output: 2.69,
    params: "671B (R1 — May 2025 refresh)",
    hfId: "deepseek-ai/DeepSeek-R1-0528",
  },
  "qwen-3.6-max": {
    provider: "openrouter",
    context: 262_144,
    input: 1.3,
    output: 7.8,
    params: "Qwen 3.6 Max (preview)",
    hfId: "Qwen/Qwen3.6-Max",
  },
  "qwen-3.5-flash": {
    provider: "openrouter",
    context: 1_000_000,
    input: 0.08,
    output: 0.33,
    params: "Qwen 3.5 Flash (efficient)",
    hfId: "Qwen/Qwen3.5-Flash",
  },
  "minimax-2.5": {
    provider: "openrouter",
    context: 205_000,
    input: 0.19,
    output: 1.44,
    params: "MoE 2.5",
    hfId: "MiniMaxAI/MiniMax-M2.5",
  },
  // ============ FREE MODELS — OpenRouter `:free`, verified 2026-07-22 ============
  // Billed 0/0 by design: `isFreeModel` derives from pricing. Re-verify the
  // upstream `:free` ids periodically — OpenRouter rotates them.
  "nemotron-3-nano": {
    provider: "openrouter",
    context: 256_000,
    input: 0,
    output: 0,
    params: "3B act / 30B MoE",
    hfId: "nvidia/Nemotron-3-Nano-30B-A3B",
  },
  "nemotron-3-nano-omni": {
    provider: "openrouter",
    context: 256_000,
    input: 0,
    output: 0,
    params: "3B act / 30B MoE — omni (text+image+audio+video in)",
    hfId: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning",
  },
  "nemotron-3-super": {
    provider: "openrouter",
    context: 262_144,
    input: 0,
    output: 0,
    params: "12B act / 120B MoE",
    hfId: "nvidia/Nemotron-3-Super-120B-A12B",
  },
  "nemotron-3-ultra": {
    provider: "openrouter",
    context: 1_000_000,
    input: 0,
    output: 0,
    params: "55B act / 550B MoE",
    hfId: "nvidia/Nemotron-3-Ultra-550B-A55B",
  },
  "nemotron-nano-9b": {
    provider: "openrouter",
    context: 128_000,
    input: 0,
    output: 0,
    params: "9B dense",
    hfId: "nvidia/NVIDIA-Nemotron-Nano-9B-v2",
  },
  "nemotron-nano-12b-vl": {
    provider: "openrouter",
    context: 128_000,
    input: 0,
    output: 0,
    params: "12B VL (text+image+video in)",
    hfId: "nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL",
  },
  "gemma-4-31b-free": {
    provider: "openrouter",
    context: 262_144,
    input: 0,
    output: 0,
    params: "31B dense — free tier",
    hfId: "google/gemma-4-31B-it",
  },
  "gemma-4-26b-free": {
    provider: "openrouter",
    context: 262_144,
    input: 0,
    output: 0,
    params: "4B act / 26B MoE — free tier",
    hfId: "google/gemma-4-26B-A4B-it",
  },
  "gpt-oss-20b": {
    provider: "openrouter",
    context: 131_072,
    input: 0,
    output: 0,
    params: "20B MoE (open weights)",
    hfId: "openai/gpt-oss-20b",
  },
  "laguna-m.1": {
    provider: "openrouter",
    context: 262_144,
    input: 0,
    output: 0,
    params: "Poolside Laguna M.1",
    hfId: "poolside/laguna-m.1",
  },
  "laguna-s-2.1": {
    provider: "openrouter",
    context: 262_144,
    input: 0,
    output: 0,
    params: "Poolside Laguna S 2.1",
    hfId: "poolside/laguna-s-2.1",
  },
  "laguna-xs-2.1": {
    provider: "openrouter",
    context: 262_144,
    input: 0,
    output: 0,
    params: "Poolside Laguna XS 2.1",
    hfId: "poolside/laguna-xs-2.1",
  },
  "north-mini-code": {
    provider: "openrouter",
    context: 256_000,
    input: 0,
    output: 0,
    params: "Cohere North Mini Code",
    hfId: "cohere/north-mini-code",
  },
} as const

export type ModelId = keyof typeof MODELS

/** A model is free when the billed price is 0/0 — the free catalog derives from pricing, not a flag. */
export function isFreeModel(id: ModelId): boolean {
  const info = MODELS[id]
  return info.input === 0 && info.output === 0
}

/**
 * Public-facing aliases. Each alias resolves to a canonical MODELS entry
 * before tier limit / routing / cost calc. Exposed as separate entries in
 * `/v1/models` so SDK catalogs see them as first-class.
 */
export const MODEL_ALIASES: Record<string, ModelId> = {
  "nikcli-mini": "qwen-3.5-flash",
  "nikcli-fast": "deepseek-v4-flash",
  nikseek: "deepseek-v4-pro",
  "nikcli-max": "kimi-k2.6",
  "nikcli-reason": "deepseek-r1-0528",
  "nikcli-coder": "devstral-2",
  "nikcli-vision": "llama-4-scout",
  "nikcli-free": "nemotron-3-super",
  "nikcli-free-mini": "nemotron-3-nano",
  "nikcli-free-coder": "north-mini-code",
} as const

/**
 * Reasoning / chain-of-thought support per model.
 *  - "native":   model always produces reasoning (R1, QwQ). `:thinking` variant
 *                is redundant but accepted as a no-op for API parity.
 *  - "optional": model has a switchable reasoning mode. The `:thinking` variant
 *                enables `reasoning: { effort }` on the upstream call.
 *
 * Models not in this map don't expose a `:thinking` variant.
 */
export const THINKING_SUPPORT: Partial<Record<ModelId, "native" | "optional">> = {
  // Native reasoning (no toggle — they always reason)
  "deepseek-r1": "native",
  "deepseek-r1-0528": "native",
  "deepseek-r1-distill-32b": "native",
  "qwq-32b": "native",
  "nemotron-3-nano-omni": "native",

  // Optional / hybrid reasoning (toggle via :thinking)
  "deepseek-v4-pro": "optional",
  "deepseek-v4-flash": "optional",
  "deepseek-v3.2": "optional",
  "deepseek-v3": "optional",
  "kimi-k2.6": "optional",
  "kimi-k2.5": "optional",
  "glm-5.1": "optional",
  "glm-5": "optional",
  "qwen-3.5-72b": "optional",
  "qwen-3.5-32b": "optional",
  "qwen-3.6-max": "optional",
  "qwen-3.5-flash": "optional",
  "minimax-2.5": "optional",
  "minimax-m2.7": "optional",
  "minimax-m2": "optional",
} as const

export type ThinkingEffort = "low" | "medium" | "high"
const THINKING_EFFORTS = new Set<string>(["low", "medium", "high"])

export interface ResolvedModel {
  id: ModelId
  /** True if the caller requested a `:thinking[-effort]` variant. */
  thinking: boolean
  /** Effort level; defaults to "medium" when only `:thinking` was passed. */
  effort?: ThinkingEffort
  /** True if reasoning is always-on for this base model (native). */
  nativeReasoning: boolean
}

/**
 * Resolve a public model id (alias / canonical / `:thinking[-effort]` variant)
 * into the canonical id plus thinking metadata. Returns undefined if unknown.
 */
export function resolveModelId(input: string): ResolvedModel | undefined {
  let base = input
  let thinking = false
  let effort: ThinkingEffort | undefined

  if (base.includes(":thinking")) {
    const [head, suffix] = base.split(":thinking", 2) as [string, string]
    base = head
    thinking = true
    const trimmed = (suffix ?? "").replace(/^-/, "")
    if (trimmed && THINKING_EFFORTS.has(trimmed)) effort = trimmed as ThinkingEffort
    else if (trimmed === "") effort = "medium"
    else return undefined
  }

  const canonical: ModelId | undefined = base in MODELS ? (base as ModelId) : MODEL_ALIASES[base]
  if (!canonical) return undefined

  const support = THINKING_SUPPORT[canonical]
  const nativeReasoning = support === "native"
  if (thinking && !support) return undefined

  return { id: canonical, thinking, effort: thinking ? (effort ?? "medium") : undefined, nativeReasoning }
}

/**
 * Daily quotas per tier. The token budget is charged as a *reservation* of
 * `max_tokens` at request time, not actual usage, so it must stay well above
 * real consumption — an agentic client reserves 8-16k per call.
 */
export const TIER_LIMITS = {
  free: { reqPerDay: 100_000, tokensPerDay: 30_000_000 },
  starter: { reqPerDay: 300_000, tokensPerDay: 100_000_000 },
  pro: { reqPerDay: 1_000_000, tokensPerDay: 500_000_000 },
  business: { reqPerDay: 5_000_000, tokensPerDay: 2_000_000_000 },
} as const

export const MARKUP = 0.25 // 25% margin

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | ContentPart[]
  name?: string
  tool_call_id?: string
}

// Content part types for AI SDK compatibility
export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image"
  image: string | URL
}

export interface FilePart {
  type: "file"
  data: string
  mediaType?: string
  filename?: string
}

export type ContentPart = TextPart | ImagePart | FilePart

export interface CompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}
