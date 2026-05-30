/**
 * Bridge to @nikcli-ai/llm's route-based provider stack.
 *
 * Exports the Effect Layer for LLMClient which handles provider routing,
 * body building, and transport for all supported providers.
 *
 * Usage:
 *   import { defaultLayer } from "@/provider/llm-client"
 *   import { LLMClient } from "@nikcli-ai/llm/route"
 *
 * The layer can be provided to Effect context:
 *   Layer.provide(llmClientLayer, Layer.provide(...otherLayers))
 */
import { Layer } from "effect"
import { LLMClient, RequestExecutor } from "@nikcli-ai/llm/route"
import type { LLMClientService } from "@nikcli-ai/llm/route"

/**
 * Default layer for LLMClient, including HTTP executor.
 * Use layerWithWebSocket if you need WebSocket support.
 */
export const defaultLayer = Layer.suspend(() => LLMClient.layer.pipe(Layer.provide(RequestExecutor.defaultLayer)))

export type { LLMClientService }

export * as LLMClientBridge from "./llm-client"
