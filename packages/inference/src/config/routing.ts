import type { ModelId } from "../types"
import type { ProviderName } from "../providers/registry"

export interface ProviderRoute {
  provider: ProviderName
  /** Model id as the upstream provider expects it. */
  upstreamModel: string
  /** Upstream cost USD per 1M input tokens. */
  input: number
  /** Upstream cost USD per 1M output tokens. */
  output: number
  /** If true, route is speculative / unverified (e.g. future model). */
  estimated?: boolean
}

/**
 * Per-model routes, ordered most-canonical first. The router sorts by
 * cost — this order only matters for tie-breaking and provenance.
 *
 * Prices last refreshed: 2026-02 from each provider's public pricing page.
 * Routes flagged `estimated: true` are for models that may not yet be live
 * with a given provider; the router skips them when an enabled non-estimated
 * route exists.
 */
export const ROUTES: Partial<Record<ModelId, ProviderRoute[]>> = {
  "kimi-k2.6": [
    { provider: "moonshot", upstreamModel: "kimi-k2-0711-preview", input: 0.15, output: 2.5 },
    { provider: "openrouter", upstreamModel: "moonshotai/kimi-k2.6-20260420", input: 0.73, output: 3.49 },
    { provider: "together", upstreamModel: "moonshotai/Kimi-K2-Instruct", input: 1.0, output: 3.0, estimated: true },
  ],
  "kimi-k2.5": [
    { provider: "moonshot", upstreamModel: "kimi-k2-0711-preview", input: 0.15, output: 2.5 },
    { provider: "openrouter", upstreamModel: "moonshotai/kimi-latest", input: 0.73, output: 3.49 },
  ],
  "glm-5.1": [
    { provider: "zhipu", upstreamModel: "glm-4.5", input: 0.6, output: 2.2, estimated: true },
    { provider: "openrouter", upstreamModel: "z-ai/glm-5.1-20260406", input: 0, output: 0 },
  ],
  "glm-5": [
    { provider: "zhipu", upstreamModel: "glm-4-plus", input: 0.5, output: 1.5 },
    { provider: "openrouter", upstreamModel: "z-ai/glm-5.1-20260406", input: 0, output: 0 },
  ],
  "qwen-3.5-72b": [
    { provider: "nebius", upstreamModel: "Qwen/Qwen2.5-72B-Instruct", input: 0.13, output: 0.4 },
    { provider: "deepinfra", upstreamModel: "Qwen/Qwen2.5-72B-Instruct", input: 0.4, output: 0.4 },
    { provider: "hyperbolic", upstreamModel: "Qwen/Qwen2.5-72B-Instruct", input: 0.4, output: 0.4 },
    { provider: "openrouter", upstreamModel: "qwen/qwen-2.5-72b-instruct", input: 0.4, output: 0.4 },
    { provider: "fireworks", upstreamModel: "accounts/fireworks/models/qwen2p5-72b-instruct", input: 0.9, output: 0.9 },
    { provider: "together", upstreamModel: "Qwen/Qwen2.5-72B-Instruct-Turbo", input: 1.2, output: 1.2 },
  ],
  "qwen-3.5-32b": [
    { provider: "nebius", upstreamModel: "Qwen/Qwen2.5-32B-Instruct", input: 0.13, output: 0.4 },
    { provider: "deepinfra", upstreamModel: "Qwen/Qwen2.5-32B-Instruct", input: 0.18, output: 0.18 },
    { provider: "hyperbolic", upstreamModel: "Qwen/Qwen2.5-32B-Instruct", input: 0.4, output: 0.4 },
    { provider: "openrouter", upstreamModel: "qwen/qwen-2.5-32b-instruct", input: 0.4, output: 0.4 },
  ],
  "qwen-3.5-14b": [
    { provider: "deepinfra", upstreamModel: "Qwen/Qwen2.5-14B-Instruct", input: 0.08, output: 0.13 },
    { provider: "nebius", upstreamModel: "Qwen/Qwen2.5-14B-Instruct", input: 0.1, output: 0.3 },
    { provider: "openrouter", upstreamModel: "qwen/qwen-2.5-14b-instruct", input: 0.2, output: 0.3 },
  ],
  "qwq-32b": [
    { provider: "deepinfra", upstreamModel: "Qwen/QwQ-32B-Preview", input: 0.18, output: 0.6 },
    { provider: "nebius", upstreamModel: "Qwen/QwQ-32B", input: 0.18, output: 0.6 },
    { provider: "groq", upstreamModel: "qwen-qwq-32b", input: 0.29, output: 0.39 },
    { provider: "openrouter", upstreamModel: "qwen/qwq-32b-preview", input: 0.5, output: 0.5 },
    { provider: "fireworks", upstreamModel: "accounts/fireworks/models/qwq-32b", input: 0.9, output: 0.9 },
  ],
  "deepseek-v4-pro": [
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-v4-pro-20260423", input: 0.44, output: 0.87 },
    { provider: "deepseek", upstreamModel: "deepseek-chat", input: 0.27, output: 1.1, estimated: true },
    { provider: "hyperbolic", upstreamModel: "deepseek-ai/DeepSeek-V3", input: 0.25, output: 0.85 },
  ],
  "deepseek-v3": [
    { provider: "deepseek", upstreamModel: "deepseek-chat", input: 0.27, output: 1.1 },
    { provider: "hyperbolic", upstreamModel: "deepseek-ai/DeepSeek-V3", input: 0.25, output: 0.85 },
    { provider: "nebius", upstreamModel: "deepseek-ai/DeepSeek-V3", input: 0.4, output: 0.89 },
    { provider: "deepinfra", upstreamModel: "deepseek-ai/DeepSeek-V3", input: 0.49, output: 0.89 },
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-chat", input: 0.27, output: 1.1 },
    { provider: "together", upstreamModel: "deepseek-ai/DeepSeek-V3", input: 1.25, output: 1.25 },
  ],
  "deepseek-r1": [
    { provider: "deepseek", upstreamModel: "deepseek-reasoner", input: 0.55, output: 2.19 },
    { provider: "hyperbolic", upstreamModel: "deepseek-ai/DeepSeek-R1", input: 2.0, output: 2.0 },
    { provider: "nebius", upstreamModel: "deepseek-ai/DeepSeek-R1", input: 0.8, output: 2.4 },
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-r1", input: 3.0, output: 8.0 },
  ],
  "deepseek-r1-distill-32b": [
    { provider: "deepinfra", upstreamModel: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", input: 0.18, output: 0.6 },
    { provider: "nebius", upstreamModel: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", input: 0.18, output: 0.6 },
    { provider: "groq", upstreamModel: "deepseek-r1-distill-qwen-32b", input: 0.69, output: 0.69 },
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-r1-distill-qwen-32b", input: 0.5, output: 0.5 },
  ],
  "llama-4-scout": [
    { provider: "groq", upstreamModel: "meta-llama/llama-4-scout-17b-16e-instruct", input: 0.11, output: 0.34 },
    { provider: "deepinfra", upstreamModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct", input: 0.08, output: 0.3 },
    { provider: "openrouter", upstreamModel: "meta-llama/llama-4-scout", input: 0.15, output: 0.5 },
    { provider: "together", upstreamModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct", input: 0.18, output: 0.59 },
    { provider: "fireworks", upstreamModel: "accounts/fireworks/models/llama4-scout-instruct-basic", input: 0.15, output: 0.6 },
  ],
  "llama-4-maverick": [
    { provider: "deepinfra", upstreamModel: "meta-llama/Llama-4-Maverick-17B-128E-Instruct", input: 0.2, output: 0.6 },
    { provider: "together", upstreamModel: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", input: 0.27, output: 0.85 },
    { provider: "fireworks", upstreamModel: "accounts/fireworks/models/llama4-maverick-instruct-basic", input: 0.22, output: 0.88 },
    { provider: "openrouter", upstreamModel: "meta-llama/llama-4-maverick", input: 0.27, output: 0.85 },
  ],
  "llama-3.3-70b": [
    { provider: "nebius", upstreamModel: "meta-llama/Llama-3.3-70B-Instruct", input: 0.13, output: 0.4 },
    { provider: "deepinfra", upstreamModel: "meta-llama/Llama-3.3-70B-Instruct", input: 0.23, output: 0.4 },
    { provider: "hyperbolic", upstreamModel: "meta-llama/Llama-3.3-70B-Instruct", input: 0.4, output: 0.4 },
    { provider: "openrouter", upstreamModel: "meta-llama/llama-3.3-70b-instruct", input: 0.4, output: 0.4 },
    { provider: "groq", upstreamModel: "llama-3.3-70b-versatile", input: 0.59, output: 0.79 },
    { provider: "cerebras", upstreamModel: "llama-3.3-70b", input: 0.85, output: 1.2 },
    { provider: "sambanova", upstreamModel: "Meta-Llama-3.3-70B-Instruct", input: 0.6, output: 1.2 },
    { provider: "together", upstreamModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", input: 0.88, output: 0.88 },
    { provider: "fireworks", upstreamModel: "accounts/fireworks/models/llama-v3p3-70b-instruct", input: 0.9, output: 0.9 },
  ],
  "mistral-medium-3.5": [
    { provider: "mistral", upstreamModel: "mistral-medium-latest", input: 0.4, output: 2.0 },
    { provider: "openrouter", upstreamModel: "mistralai/mistral-medium-3", input: 0.4, output: 2.0 },
  ],
  "mistral-small-4": [
    { provider: "mistral", upstreamModel: "mistral-small-latest", input: 0.2, output: 0.6 },
    { provider: "deepinfra", upstreamModel: "mistralai/Mistral-Small-24B-Instruct-2501", input: 0.07, output: 0.15 },
    { provider: "openrouter", upstreamModel: "mistralai/mistral-small-3.1-24b-instruct", input: 0.1, output: 0.3 },
    { provider: "together", upstreamModel: "mistralai/Mistral-Small-24B-Instruct-2501", input: 0.8, output: 0.8 },
  ],
  "devstral-2": [
    { provider: "mistral", upstreamModel: "devstral-medium-2507", input: 0.4, output: 2.0, estimated: true },
    { provider: "openrouter", upstreamModel: "mistralai/devstral-medium", input: 0.4, output: 2.0 },
  ],
  "gemma-4-31b": [
    { provider: "deepinfra", upstreamModel: "google/gemma-3-27b-it", input: 0.1, output: 0.2 },
    { provider: "openrouter", upstreamModel: "google/gemma-3-27b-it", input: 0.1, output: 0.2 },
  ],
  "gemma-4-26b-a4b": [
    { provider: "openrouter", upstreamModel: "google/gemma-3-27b-it", input: 0.1, output: 0.2, estimated: true },
  ],
  "phi-4-mini": [
    { provider: "deepinfra", upstreamModel: "microsoft/Phi-4-mini-instruct", input: 0.07, output: 0.14 },
    { provider: "nebius", upstreamModel: "microsoft/Phi-4-mini-instruct", input: 0.1, output: 0.2 },
    { provider: "openrouter", upstreamModel: "microsoft/phi-4-mini-instruct", input: 0.1, output: 0.2, estimated: true },
  ],
  "phi-4": [
    { provider: "deepinfra", upstreamModel: "microsoft/phi-4", input: 0.07, output: 0.14 },
    { provider: "nebius", upstreamModel: "microsoft/phi-4", input: 0.1, output: 0.2 },
    { provider: "openrouter", upstreamModel: "microsoft/phi-4", input: 0.07, output: 0.14 },
  ],
  "minimax-m2.7": [
    { provider: "openrouter", upstreamModel: "minimax/minimax-m2.7-20260318", input: 0.28, output: 1.2 },
  ],
  "minimax-m2": [
    { provider: "openrouter", upstreamModel: "minimax/minimax-m2", input: 0.255, output: 1.0 },
  ],

  // ============ Latest OpenRouter-only models (verified IDs) ============
  "deepseek-v4-flash": [
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-v4-flash-20260423", input: 0.112, output: 0.224 },
  ],
  "deepseek-v4-flash-free": [
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-v4-flash:free", input: 0, output: 0 },
  ],
  "deepseek-v3.2": [
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-v3.2", input: 0.252, output: 0.378 },
  ],
  "deepseek-r1-0528": [
    { provider: "openrouter", upstreamModel: "deepseek/deepseek-r1-0528", input: 0.5, output: 2.15 },
  ],
  "qwen-3.6-max": [
    { provider: "openrouter", upstreamModel: "qwen/qwen3.6-max-preview-20260420", input: 1.04, output: 6.24 },
  ],
  "qwen-3.5-flash": [
    { provider: "openrouter", upstreamModel: "qwen/qwen3.5-flash-20260224", input: 0.065, output: 0.26 },
  ],
  "glm-5.1-free": [
    { provider: "openrouter", upstreamModel: "z-ai/glm-5.1-20260406", input: 0, output: 0 },
  ],
  "minimax-2.5": [
    { provider: "openrouter", upstreamModel: "minimax/minimax-m2.5", input: 0.15, output: 1.15 },
  ],
  "minimax-2.5-free": [
    { provider: "openrouter", upstreamModel: "minimax/minimax-m2.5:free", input: 0, output: 0 },
  ],
}

/**
 * Effective per-1M cost for ranking providers. Output is heavier in real
 * traffic — agentic workloads typically have 1:3 input:output, so we score
 * with that ratio.
 */
export function blendedCost(route: ProviderRoute, ratio = 1 / 4): number {
  return route.input * ratio + route.output * (1 - ratio)
}

export function getRoutesForModel(model: ModelId): ProviderRoute[] {
  return ROUTES[model] ?? []
}
