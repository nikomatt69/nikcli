import type { ChatMessage, ModelId } from "../types"
import type { ChatOptions } from "./index"
import { Coalescer } from "../cache/coalesce"
import { hashKey, isDeterministic, type CacheKeyInput } from "../cache/hash"
import { getCacheStore, type CachedEntry, type CacheStore } from "../cache/store"
import { Router, getRouter, RouterError, type RouterChatResult } from "./router"
import type { ProviderRoute } from "../config/routing"

export interface CachedChatOptions extends ChatOptions {
  cacheOverride?: boolean
  cacheTtlSeconds?: number
  preferProvider?: string
  allowEstimated?: boolean
}

export interface CachedChatResult {
  body: Record<string, unknown> & { usage?: { prompt_tokens?: number; completion_tokens?: number } }
  promptTokens: number
  completionTokens: number
  cache: "hit" | "miss" | "coalesced"
  prefixCacheable: boolean
  stored: boolean
  route: ProviderRoute | null
  attempts: RouterChatResult["attempts"]
}

const DEFAULT_TTL = Number(process.env.INFERENCE_CACHE_TTL ?? 24 * 60 * 60)

interface CachedEntryWithRoute extends CachedEntry {
  route?: ProviderRoute | null
}

export class CachedProvider {
  private readonly store: CacheStore
  private readonly coalescer = new Coalescer<CachedChatResult>()

  constructor(
    private readonly router: Router = getRouter(),
    store: CacheStore = getCacheStore(),
  ) {
    this.store = store
  }

  async chatCompletions(
    model: ModelId,
    messages: ChatMessage[],
    options: CachedChatOptions = {},
  ): Promise<CachedChatResult | { passthrough: Response; route: ProviderRoute }> {
    const cacheKey = await this.buildKey(model, messages, options)
    const allowCache = options.cacheOverride ?? isDeterministic(options)
    const prefixCacheable = hasStablePrefix(messages)

    if (options.stream) {
      const routerResult = await this.router.chat(model, messages, options, {
        preferProvider: options.preferProvider,
        allowEstimated: options.allowEstimated,
      })
      return { passthrough: routerResult.response, route: routerResult.route }
    }

    if (allowCache) {
      const cached = (await this.store.get(cacheKey)) as CachedEntryWithRoute | null
      if (cached) {
        return {
          body: cached.body as CachedChatResult["body"],
          promptTokens: cached.promptTokens,
          completionTokens: cached.completionTokens,
          cache: "hit",
          prefixCacheable,
          stored: false,
          route: cached.route ?? null,
          attempts: [],
        }
      }
    }

    const { value, coalesced } = await this.coalescer.run(cacheKey, async () => {
      const routerResult = await this.router.chat(model, messages, options, {
        preferProvider: options.preferProvider,
        allowEstimated: options.allowEstimated,
      })
      if (!routerResult.response.ok) {
        throw new UpstreamError(routerResult.response, routerResult.attempts)
      }
      const body = (await routerResult.response.json()) as CachedChatResult["body"]
      const promptTokens = body.usage?.prompt_tokens ?? 0
      const completionTokens = body.usage?.completion_tokens ?? 0
      const entry: CachedEntryWithRoute = {
        body,
        promptTokens,
        completionTokens,
        model,
        storedAt: Date.now(),
        route: routerResult.route,
      }
      let stored = false
      if (allowCache) {
        await this.store.set(cacheKey, entry, options.cacheTtlSeconds ?? DEFAULT_TTL)
        stored = true
      }
      return {
        body,
        promptTokens,
        completionTokens,
        cache: "miss" as const,
        prefixCacheable,
        stored,
        route: routerResult.route,
        attempts: routerResult.attempts,
      }
    })

    if (coalesced) return { ...value, cache: "coalesced", stored: false }
    return value
  }

  stats() {
    return { ...this.store.stats(), inflight: this.coalescer.size() }
  }

  private async buildKey(model: string, messages: ChatMessage[], options: CachedChatOptions): Promise<string> {
    const input: CacheKeyInput = {
      model,
      messages,
      tools: options.tools,
      tool_choice: options.tool_choice,
      temperature: options.temperature,
      top_p: options.top_p,
      max_tokens: options.maxTokens,
      response_format: options.response_format,
      stop: options.stop,
      seed: options.seed,
    }
    return hashKey(input)
  }
}

export class UpstreamError extends Error {
  constructor(
    public readonly response: Response,
    public readonly attempts: RouterChatResult["attempts"] = [],
  ) {
    super(`Upstream error ${response.status}`)
  }
}

export { RouterError }

function hasStablePrefix(messages: ChatMessage[]): boolean {
  if (messages.length < 2) return false
  return messages[0]?.role === "system"
}
