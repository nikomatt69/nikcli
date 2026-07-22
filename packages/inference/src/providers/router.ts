import type { ChatMessage, ModelId } from "../types"
import type { ChatOptions, BaseProvider } from "./index"
import { type ProviderRoute, blendedCost, getRoutesForModel } from "../config/routing"
import { CircuitBreaker } from "../health/circuit"
import { getRegistry } from "./registry"

export interface RouteSelection {
  route: ProviderRoute
  provider: BaseProvider
}

export interface RouterChatResult {
  response: Response
  route: ProviderRoute
  attempts: { provider: string; status: number; durationMs: number; error?: string }[]
}

export interface RouterOptions {
  /** Optional pin: force a specific provider for the request. */
  preferProvider?: string
  /** Allow estimated/unverified routes to be used. */
  allowEstimated?: boolean
}

/**
 * Free model variants are throttled per-minute upstream, so an agentic burst
 * gets 429s that clear within seconds. Absorb them here instead of failing the
 * request: the client's own retry would arrive just as hot.
 */
const THROTTLE_RETRIES = 2
const THROTTLE_BASE_DELAY_MS = 1_200
const THROTTLE_MAX_DELAY_MS = 8_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Honour the upstream's own backoff hint when it sends one. */
function throttleDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after")
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1_000, THROTTLE_MAX_DELAY_MS)
  }
  return Math.min(THROTTLE_BASE_DELAY_MS * 2 ** (attempt - 1), THROTTLE_MAX_DELAY_MS)
}

export class Router {
  private readonly breakers = new Map<string, CircuitBreaker>()

  private breakerFor(name: string): CircuitBreaker {
    let b = this.breakers.get(name)
    if (!b) {
      b = new CircuitBreaker(name)
      this.breakers.set(name, b)
    }
    return b
  }

  /** Return the ordered list of (route, provider) to try for a model. */
  plan(model: ModelId, options: RouterOptions = {}): RouteSelection[] {
    const registry = getRegistry()
    const routes = getRoutesForModel(model)
    const enabled = routes.filter((r) => registry.isEnabled(r.provider))
    const filtered = options.allowEstimated ? enabled : enabled.filter((r) => !r.estimated)
    const usable = filtered.length > 0 ? filtered : enabled

    const sorted = [...usable].sort((a, b) => blendedCost(a) - blendedCost(b))

    if (options.preferProvider) {
      const idx = sorted.findIndex((r) => r.provider === options.preferProvider)
      if (idx >= 0) {
        const [pinned] = sorted.splice(idx, 1)
        if (pinned) sorted.unshift(pinned)
      }
    }

    return sorted
      .filter((r) => this.breakerFor(r.provider).allow())
      .map((route) => {
        const provider = registry.get(route.provider)?.provider
        return provider ? { route, provider } : null
      })
      .filter((s): s is RouteSelection => s !== null)
  }

  async chat(
    model: ModelId,
    messages: ChatMessage[],
    options: ChatOptions = {},
    routerOptions: RouterOptions = {},
  ): Promise<RouterChatResult> {
    const plan = this.plan(model, routerOptions)
    if (plan.length === 0) {
      // Fall through to local provider if no managed routes match.
      const local = getRegistry().get("local")
      if (!local?.enabled) throw new RouterError("no providers available", [])
      const started = Date.now()
      const response = await local.provider.chatCompletions(model, messages, options)
      return {
        response,
        route: { provider: "local", upstreamModel: model, input: 0, output: 0 },
        attempts: [{ provider: "local", status: response.status, durationMs: Date.now() - started }],
      }
    }

    const attempts: RouterChatResult["attempts"] = []
    let lastError: Error | null = null
    let throttled: { response: Response; route: ProviderRoute } | null = null

    for (const { route, provider } of plan) {
      const breaker = this.breakerFor(route.provider)
      let throttleAttempt = 0

      while (true) {
        const started = Date.now()
        try {
          const response = await provider.chatCompletions(route.upstreamModel, messages, options)
          const durationMs = Date.now() - started
          attempts.push({ provider: route.provider, status: response.status, durationMs })
          if (response.ok) {
            breaker.recordSuccess()
            return { response, route, attempts }
          }
          if (response.status === 429) {
            // Throttling means healthy-but-busy, not broken: tripping the breaker
            // here would take every model on this provider offline. Retry the
            // same route briefly, then keep the response so the caller surfaces
            // a real 429 instead of a 503.
            if (throttleAttempt < THROTTLE_RETRIES) {
              throttleAttempt++
              await sleep(throttleDelayMs(response, throttleAttempt))
              continue
            }
            throttled ??= { response, route }
            break
          }
          if (response.status >= 500) {
            breaker.recordFailure()
            break
          }
          // 4xx other than 429 — surface immediately, do not fall back
          return { response, route, attempts }
        } catch (err) {
          const durationMs = Date.now() - started
          const message = err instanceof Error ? err.message : String(err)
          attempts.push({ provider: route.provider, status: 0, durationMs, error: message })
          breaker.recordFailure()
          lastError = err instanceof Error ? err : new Error(message)
          break
        }
      }
    }

    // Every route was rate-limited: return the upstream 429 (with its
    // Retry-After) so clients back off instead of treating it as an outage.
    if (throttled) return { response: throttled.response, route: throttled.route, attempts }

    throw new RouterError(lastError?.message ?? "all providers failed", attempts)
  }

  breakerStatuses(): { provider: string; state: string }[] {
    return Array.from(this.breakers.entries()).map(([name, b]) => ({ provider: name, state: b.state() }))
  }
}

export class RouterError extends Error {
  constructor(
    message: string,
    public readonly attempts: RouterChatResult["attempts"],
  ) {
    super(message)
    this.name = "RouterError"
  }
}

let singleton: Router | null = null
export function getRouter(): Router {
  if (!singleton) singleton = new Router()
  return singleton
}

export function resetRouterForTests(): Router {
  singleton = new Router()
  return singleton
}
