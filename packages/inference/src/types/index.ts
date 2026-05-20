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
  "deepseek-v4-flash-free": {
    provider: "openrouter",
    context: 1_048_576,
    input: 0,
    output: 0,
    params: "MoE flash (V4) — free tier",
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
  "glm-5.1-free": {
    provider: "openrouter",
    context: 202_800,
    input: 0,
    output: 0,
    params: "GLM 5.1 — free tier",
    hfId: "zai-org/GLM-5.1",
  },
  "minimax-2.5": {
    provider: "openrouter",
    context: 205_000,
    input: 0.19,
    output: 1.44,
    params: "MoE 2.5",
    hfId: "MiniMaxAI/MiniMax-M2.5",
  },
  "minimax-2.5-free": {
    provider: "openrouter",
    context: 205_000,
    input: 0,
    output: 0,
    params: "MoE 2.5 — free tier",
    hfId: "MiniMaxAI/MiniMax-M2.5",
  },
} as const

export type ModelId = keyof typeof MODELS

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
  "nikcli-free": "minimax-2.5-free",
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

  // Optional / hybrid reasoning (toggle via :thinking)
  "deepseek-v4-pro": "optional",
  "deepseek-v4-flash": "optional",
  "deepseek-v4-flash-free": "optional",
  "deepseek-v3.2": "optional",
  "deepseek-v3": "optional",
  "kimi-k2.6": "optional",
  "kimi-k2.5": "optional",
  "glm-5.1": "optional",
  "glm-5": "optional",
  "glm-5.1-free": "optional",
  "qwen-3.5-72b": "optional",
  "qwen-3.5-32b": "optional",
  "qwen-3.6-max": "optional",
  "qwen-3.5-flash": "optional",
  "minimax-2.5": "optional",
  "minimax-2.5-free": "optional",
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

export const TIER_LIMITS = {
  free: { reqPerDay: 100, tokensPerDay: 50_000 },
  starter: { reqPerDay: 1_000, tokensPerDay: 1_000_000 },
  pro: { reqPerDay: 10_000, tokensPerDay: 10_000_000 },
  business: { reqPerDay: 100_000, tokensPerDay: 100_000_000 },
} as const

export const MARKUP = 0.25 // 25% margin

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  name?: string
}

export interface CompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

// ============ Extended Model Metadata (matching ~/.cache/nikcli/models.json schema) ============

export interface ModelMetadata {
  /** Display name shown in SDK catalogs */
  name: string
  /** Model family grouping (e.g. "kimi", "deepseek-thinking") */
  family: string
  /** Whether the model accepts file/image attachments */
  attachment: boolean
  /** Whether the model has a dedicated reasoning/think mode */
  reasoning: boolean
  /** Whether the model supports tool_calls (function calling) */
  tool_call: boolean
  /** Whether the model supports temperature parameter */
  temperature: boolean
  /** Knowledge cutoff date string (e.g. "2025-09") */
  knowledge?: string
  /** ISO release date */
  release_date?: string
  /** ISO last_updated date */
  last_updated?: string
  /** Supported modalities */
  modalities: {
    input: ("text" | "image" | "audio" | "video" | "pdf")[]
    output: ("text" | "audio")[]
  }
  /** Whether upstream weights are publicly available */
  open_weights: boolean
  /** Token limits */
  limit: {
    context: number
    output: number
  }
  /** Upstream cost per 1M tokens (source of truth for billing calc) */
  cost: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
    reasoning?: number
    input_audio?: number
    output_audio?: number
  }
}

/**
 * Extended metadata per model. Fields here are merged into /v1/models responses
 * for SDK catalog compatibility with nikcli's local model cache.
 */
export const MODEL_METADATA: Partial<Record<ModelId, ModelMetadata>> = {
  // ============ KIMI ============
  "kimi-k2.6": {
    name: "Kimi K2.6",
    family: "kimi",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2026-03",
    release_date: "2026-03-15",
    last_updated: "2026-03-15",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 262_144, output: 16_384 },
    cost: { input: 0.5, output: 2, cache_read: 0.4 },
  },
  "kimi-k2.5": {
    name: "Kimi K2.5",
    family: "kimi",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-05",
    last_updated: "2025-09-05",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 262_144, output: 16_384 },
    cost: { input: 0.57, output: 2.3, cache_read: 0.4 },
  },

  // ============ GLM ============
  "glm-5.1": {
    name: "GLM 5.1",
    family: "glm",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-10",
    last_updated: "2025-09-10",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 200_000, output: 131_072 },
    cost: { input: 0.3, output: 1.2 },
  },
  "glm-5": {
    name: "GLM 5",
    family: "glm",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-10",
    last_updated: "2025-09-10",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 200_000, output: 131_072 },
    cost: { input: 0.28, output: 1.1 },
  },

  // ============ QWEN ============
  "qwen-3.5-72b": {
    name: "Qwen 3.5 72B",
    family: "qwen",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-23",
    last_updated: "2025-09-23",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 131_072, output: 16_384 },
    cost: { input: 0.5, output: 2, reasoning: 6 },
  },
  "qwen-3.5-32b": {
    name: "Qwen 3.5 32B",
    family: "qwen",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-23",
    last_updated: "2025-09-23",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 131_072, output: 16_384 },
    cost: { input: 0.2, output: 0.8, reasoning: 2.4 },
  },
  "qwen-3.5-14b": {
    name: "Qwen 3.5 14B",
    family: "qwen",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-04",
    release_date: "2025-04",
    last_updated: "2025-04",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 131_072, output: 8192 },
    cost: { input: 0.07, output: 0.28 },
  },
  "qwq-32b": {
    name: "QwQ 32B",
    family: "qwen-thinking",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-23",
    last_updated: "2025-09-23",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 131_072, output: 16_384 },
    cost: { input: 0.5, output: 2, reasoning: 6 },
  },

  // ============ DEEPSEEK ============
  "deepseek-v4-pro": {
    name: "DeepSeek V4 Pro",
    family: "deepseek-thinking",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-05",
    release_date: "2026-04-24",
    last_updated: "2026-04-24",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 1_000_000, output: 384_000 },
    cost: { input: 1.74, output: 3.48, cache_read: 0.145 },
  },
  "deepseek-v3": {
    name: "DeepSeek V3",
    family: "deepseek",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2024-12",
    release_date: "2024-12-26",
    last_updated: "2024-12-26",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 128_000, output: 8192 },
    cost: { input: 0.56, output: 1.68, cache_read: 0.07 },
  },
  "deepseek-r1": {
    name: "DeepSeek R1",
    family: "deepseek-thinking",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-12-01",
    last_updated: "2026-02-28",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 1_000_000, output: 384_000 },
    cost: { input: 0.14, output: 0.28, cache_read: 0.028 },
  },
  "deepseek-r1-distill-32b": {
    name: "DeepSeek R1 Distill 32B",
    family: "deepseek-thinking",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-01",
    release_date: "2025-01-20",
    last_updated: "2025-01-20",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 128_000, output: 4096 },
    cost: { input: 0.03, output: 0.13 },
  },

  // ============ LLAMA ============
  "llama-4-scout": {
    name: "Llama 4 Scout 17B 16E",
    family: "llama",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-01",
    release_date: "2025-01-01",
    last_updated: "2025-01-01",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: false,
    limit: { context: 1_048_576, output: 8192 },
    cost: { input: 0.08, output: 0.3 },
  },
  "llama-4-maverick": {
    name: "Llama 4 Maverick 17B 128E",
    family: "llama",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-01",
    release_date: "2025-01-01",
    last_updated: "2025-01-01",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: false,
    limit: { context: 1_048_576, output: 8192 },
    cost: { input: 0.15, output: 0.6 },
  },
  "llama-3.3-70b": {
    name: "Llama 3.3 70B",
    family: "llama",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2024-12",
    release_date: "2024-12-06",
    last_updated: "2024-12-06",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 131_072, output: 32_678 },
    cost: { input: 0.59, output: 0.79 },
  },

  // ============ MISTRAL ============
  "mistral-medium-3.5": {
    name: "Mistral Medium 3.5",
    family: "mistral-medium",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    release_date: "2026-04-29",
    last_updated: "2026-04-29",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: true,
    limit: { context: 262_144, output: 262_144 },
    cost: { input: 1.5, output: 7.5 },
  },
  "mistral-small-4": {
    name: "Mistral Small 4",
    family: "mistral-small",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-06",
    release_date: "2026-03-16",
    last_updated: "2026-03-16",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: true,
    limit: { context: 256_000, output: 256_000 },
    cost: { input: 0.15, output: 0.6 },
  },
  "devstral-2": {
    name: "Devstral 2 123B",
    family: "mistral",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-01",
    release_date: "2025-12-15",
    last_updated: "2025-12-15",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 131_072, output: 16_384 },
    cost: { input: 0.12, output: 0.36 },
  },

  // ============ GEMMA ============
  "gemma-4-31b": {
    name: "Gemma 4 31B",
    family: "gemma",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    release_date: "2026-04-02",
    last_updated: "2026-04-02",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: true,
    limit: { context: 262_144, output: 32_768 },
    cost: { input: 0.3, output: 0.9 },
  },
  "gemma-4-26b-a4b": {
    name: "Gemma 4 26B A4B",
    family: "gemma",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    release_date: "2026-04-02",
    last_updated: "2026-04-02",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: true,
    limit: { context: 262_144, output: 32_768 },
    cost: { input: 0.25, output: 0.75 },
  },

  // ============ PHI ============
  "phi-4-mini": {
    name: "Phi-4 Mini",
    family: "phi",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-06",
    release_date: "2025-06-10",
    last_updated: "2025-06-10",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 131_072, output: 8192 },
    cost: { input: 0.05, output: 0.15 },
  },
  "phi-4": {
    name: "Phi-4",
    family: "phi",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-06",
    release_date: "2025-06-10",
    last_updated: "2025-06-10",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 131_072, output: 8192 },
    cost: { input: 0.15, output: 0.45 },
  },

  // ============ MINIMAX ============
  "minimax-m2.7": {
    name: "MiniMax M2.7",
    family: "minimax",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-20",
    last_updated: "2025-09-20",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 100_000, output: 16_384 },
    cost: { input: 0.5, output: 2 },
  },
  "minimax-m2": {
    name: "MiniMax M2",
    family: "minimax",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-04",
    release_date: "2025-04-15",
    last_updated: "2025-04-15",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 100_000, output: 16_384 },
    cost: { input: 0.4, output: 1.5 },
  },

  // ============ OPENROUTER MODELS ============
  "deepseek-v4-flash": {
    name: "DeepSeek V4 Flash",
    family: "deepseek-flash",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-05",
    release_date: "2026-04-24",
    last_updated: "2026-04-24",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 1_000_000, output: 384_000 },
    cost: { input: 0.14, output: 0.28, cache_read: 0.028 },
  },
  "deepseek-v4-flash-free": {
    name: "DeepSeek V4 Flash (Free)",
    family: "deepseek-flash",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-05",
    release_date: "2026-04-24",
    last_updated: "2026-04-24",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 1_000_000, output: 384_000 },
    cost: { input: 0, output: 0 },
  },
  "deepseek-v3.2": {
    name: "DeepSeek V3.2",
    family: "deepseek",
    attachment: false,
    reasoning: false,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-22",
    last_updated: "2025-09-22",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 163_840, output: 65_536 },
    cost: { input: 0.27, output: 0.41 },
  },
  "deepseek-r1-0528": {
    name: "DeepSeek R1 (May 2025)",
    family: "deepseek-thinking",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-12-01",
    last_updated: "2026-02-28",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 1_000_000, output: 384_000 },
    cost: { input: 0.14, output: 0.28, cache_read: 0.028 },
  },
  "qwen-3.6-max": {
    name: "Qwen 3.6 Max",
    family: "qwen",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-23",
    last_updated: "2025-09-23",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 262_144, output: 65_536 },
    cost: { input: 0.8, output: 4 },
  },
  "qwen-3.5-flash": {
    name: "Qwen 3.5 Flash",
    family: "qwen",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-23",
    last_updated: "2025-09-23",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    limit: { context: 1_000_000, output: 65_536 },
    cost: { input: 0.08, output: 0.33, reasoning: 1 },
  },
  "glm-5.1-free": {
    name: "GLM 5.1 (Free)",
    family: "glm",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-09",
    release_date: "2025-09-10",
    last_updated: "2025-09-10",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 202_800, output: 131_072 },
    cost: { input: 0, output: 0 },
  },
  "minimax-2.5": {
    name: "MiniMax 2.5",
    family: "minimax",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-04",
    release_date: "2025-04-15",
    last_updated: "2025-04-15",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 205_000, output: 65_536 },
    cost: { input: 0.19, output: 1.44, reasoning: 4.32 },
  },
  "minimax-2.5-free": {
    name: "MiniMax 2.5 (Free)",
    family: "minimax",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    knowledge: "2025-04",
    release_date: "2025-04-15",
    last_updated: "2025-04-15",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 205_000, output: 65_536 },
    cost: { input: 0, output: 0 },
  },
}
