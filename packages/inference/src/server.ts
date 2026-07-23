import { Hono } from "hono"
import { cors } from "hono/cors"
import { MODELS, MODEL_ALIASES, THINKING_SUPPORT, isFreeModel, resolveModelId, type ModelId } from "./types"
import { loadEnv } from "./config/env"
import { calcCost, routedCostUsd, upstreamCostUsd } from "./middleware"
import { getRateLimiter, validateKey, recordUsage } from "./middleware/ratelimit"
import { validateChatBody } from "./middleware/validation"
import { getLogger, requestId } from "./middleware/logger"
import { CachedProvider, UpstreamError, RouterError } from "./providers/cached"
import { getRegistry } from "./providers/registry"
import { getRouter } from "./providers/router"
import { ROUTES, getRoutesForModel } from "./config/routing"

const DEFAULT_PREFER_PROVIDER = process.env.DEFAULT_PREFER_PROVIDER || undefined

const app = new Hono()
const cachedProvider = new CachedProvider()
const log = getLogger()

app.use("*", cors())

app.use("*", async (c, next) => {
  const rid = c.req.header("x-request-id") ?? requestId()
  c.set("rid" as never, rid as never)
  const started = Date.now()
  await next()
  log.info("http", {
    rid,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - started,
  })
  c.res.headers.set("X-Request-Id", rid)
})

app.get("/health", (c) => {
  const registry = getRegistry()
  const router = getRouter()
  return c.json({
    status: "ok",
    version: "0.1.0",
    providers: registry.list().map((p) => ({ name: p.name, enabled: p.enabled, reason: p.reason })),
    breakers: router.breakerStatuses(),
    cache: cachedProvider.stats(),
  })
})

app.get("/v1/providers", (c) => {
  const registry = getRegistry()
  return c.json({
    object: "list",
    data: registry.list().map((p) => ({
      id: p.name,
      enabled: p.enabled,
      reason: p.reason ?? null,
    })),
  })
})

app.get("/v1/models", (c) => {
  const includeRoutes = c.req.query("routes") === "1"
  const freeOnly = loadEnv().INFERENCE_FREE_ONLY
  const visible = (id: string) => !freeOnly || isFreeModel(id as ModelId)
  const canonical = Object.entries(MODELS)
    .filter(([id]) => visible(id))
    .map(([id, info]) => {
      const routes = getRoutesForModel(id as ModelId)
      const support = THINKING_SUPPORT[id as ModelId]
      return {
        id,
        object: "model",
        created: Date.now(),
        owned_by: info.provider,
        context_window: info.context,
        params: info.params,
        hf_id: info.hfId,
        pricing: { input: info.input, output: info.output },
        thinking: support ?? null,
        routes: includeRoutes
          ? routes.map((r) => ({
              provider: r.provider,
              upstreamModel: r.upstreamModel,
              input: r.input,
              output: r.output,
              estimated: r.estimated ?? false,
              enabled: getRegistry().isEnabled(r.provider),
            }))
          : undefined,
      }
    })
  const aliased = Object.entries(MODEL_ALIASES)
    .filter(([, target]) => visible(target))
    .map(([alias, target]) => {
      const info = MODELS[target]
      return {
        id: alias,
        object: "model",
        created: Date.now(),
        owned_by: info.provider,
        context_window: info.context,
        params: info.params,
        hf_id: info.hfId,
        pricing: { input: info.input, output: info.output },
        alias_of: target,
        thinking: THINKING_SUPPORT[target] ?? null,
      }
    })
  // Emit `:thinking` variants for every model+alias that supports optional reasoning.
  const variants: Array<Record<string, unknown>> = []
  for (const [id, info] of Object.entries(MODELS)) {
    if (!visible(id)) continue
    if (THINKING_SUPPORT[id as ModelId] !== "optional") continue
    variants.push({
      id: `${id}:thinking`,
      object: "model",
      created: Date.now(),
      owned_by: info.provider,
      context_window: info.context,
      params: info.params,
      hf_id: info.hfId,
      pricing: { input: info.input, output: info.output },
      variant_of: id,
      thinking: "optional",
    })
  }
  for (const [alias, target] of Object.entries(MODEL_ALIASES)) {
    if (!visible(target)) continue
    if (THINKING_SUPPORT[target] !== "optional") continue
    const info = MODELS[target]
    variants.push({
      id: `${alias}:thinking`,
      object: "model",
      created: Date.now(),
      owned_by: info.provider,
      context_window: info.context,
      params: info.params,
      hf_id: info.hfId,
      pricing: { input: info.input, output: info.output },
      alias_of: target,
      variant_of: alias,
      thinking: "optional",
    })
  }
  return c.json({ object: "list", data: [...canonical, ...aliased, ...variants] })
})

app.post("/v1/chat/completions", async (c) => {
  const rid = c.get("rid" as never) as string
  const key = await validateKey(c.req.header("Authorization"))
  if (!key) return c.json({ error: { message: "Unauthorized", type: "auth_error" } }, 401)

  const raw = await c.req.json()
  const validated = validateChatBody(raw)
  if (!validated.ok) {
    return c.json({ error: { message: validated.error, type: "invalid_request_error" } }, 400)
  }
  const body = validated.data

  const resolved = resolveModelId(body.model)
  if (!resolved) {
    return c.json({ error: { message: `Model '${body.model}' not found`, type: "invalid_request_error" } }, 400)
  }
  const resolvedModel = resolved.id
  if (loadEnv().INFERENCE_FREE_ONLY && !isFreeModel(resolvedModel)) {
    return c.json(
      {
        error: { message: `Model '${body.model}' is not available on the free gateway`, type: "invalid_request_error" },
      },
      404,
    )
  }
  const modelInfo = MODELS[resolvedModel]
  const displayedModel = body.model // keep alias/variant in response if client used one

  const estimated = body.max_tokens ?? 1000
  const limit = await getRateLimiter().check(key, body.model, estimated)
  if (!limit.ok) {
    return c.json({ error: { message: limit.reason ?? "rate limit exceeded", type: "rate_limit_exceeded" } }, 429)
  }

  try {
    const reasoning =
      resolved.thinking && !resolved.nativeReasoning
        ? { effort: resolved.effort ?? "medium", enabled: true }
        : undefined
    const result = await cachedProvider.chatCompletions(resolvedModel, body.messages, {
      maxTokens: body.max_tokens,
      temperature: body.temperature,
      top_p: body.top_p,
      stream: body.stream,
      tools: body.tools,
      tool_choice: body.tool_choice,
      response_format: body.response_format,
      stop: body.stop,
      seed: body.seed,
      reasoning,
      cacheOverride: body.nikcli?.cache,
      cacheTtlSeconds: body.nikcli?.cacheTtlSeconds,
      preferProvider: body.nikcli?.preferProvider ?? DEFAULT_PREFER_PROVIDER,
      allowEstimated: body.nikcli?.allowEstimated,
    })

    if ("passthrough" in result) {
      const stream = result.passthrough.body
      if (!stream) return c.json({ error: { message: "upstream returned empty stream" } }, 502)
      log.info("inference.stream", { rid, model: body.model, provider: result.route.provider, tier: key.tier })
      return c.body(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "X-Nikcli-Provider": result.route.provider,
          "X-Nikcli-Cache": "stream",
          "X-Request-Id": rid,
        },
      })
    }

    const inputTokens = result.promptTokens
    const outputTokens = result.completionTokens
    const billedUsd = calcCost(resolvedModel, inputTokens, outputTokens)
    const upstreamUsd =
      result.cache === "miss" && result.route
        ? routedCostUsd(result.route.input, result.route.output, inputTokens, outputTokens)
        : 0
    const savedUsd = result.cache === "miss" ? 0 : upstreamCostUsd(resolvedModel, inputTokens, outputTokens)

    log.info("inference.complete", {
      rid,
      model: displayedModel,
      resolvedModel,
      provider: result.route?.provider ?? "cache",
      upstreamModel: result.route?.upstreamModel,
      cache: result.cache,
      inputTokens,
      outputTokens,
      billedUsd,
      upstreamUsd,
      marginUsd: billedUsd - upstreamUsd,
      attempts: result.attempts.length,
      tier: key.tier,
    })

    if (key.userId) {
      void recordUsage({
        keyId: key.keyId,
        userId: key.userId,
        model: displayedModel,
        resolvedModel,
        provider: result.route?.provider ?? null,
        upstreamModel: result.route?.upstreamModel ?? null,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        billedUsd,
        upstreamUsd,
        savedUsd,
        cache: result.cache ?? null,
        rid,
      })
    }

    return c.json({
      ...result.body,
      model: displayedModel,
      nikcli: {
        resolvedModel: displayedModel !== resolvedModel ? resolvedModel : undefined,
        thinking:
          resolved.thinking || resolved.nativeReasoning
            ? {
                requested: resolved.thinking,
                native: resolved.nativeReasoning,
                effort: resolved.effort,
              }
            : undefined,
        provider: result.route?.provider ?? null,
        upstreamModel: result.route?.upstreamModel ?? null,
        cache: result.cache,
        prefixCacheable: result.prefixCacheable,
        stored: result.stored,
        costUsd: round6(billedUsd),
        upstreamCostUsd: round6(upstreamUsd),
        savedCostUsd: round6(savedUsd),
        marginUsd: round6(billedUsd - upstreamUsd),
        costCents: Math.round(billedUsd * 100 * 100) / 100,
        rid,
      },
    })
  } catch (err) {
    if (err instanceof UpstreamError) {
      const upstreamBody = await err.response.json().catch(() => ({ error: { message: "upstream error" } }))
      log.warn("inference.upstream_error", { rid, status: err.response.status, attempts: err.attempts })
      // Pass the upstream backoff hint through so clients wait instead of hammering.
      const retryAfter = err.response.headers.get("retry-after")
      if (retryAfter) c.header("Retry-After", retryAfter)
      return c.json(upstreamBody as object, err.response.status as 400 | 500 | 502)
    }
    if (err instanceof RouterError) {
      log.error("inference.router_error", { rid, attempts: err.attempts, message: err.message })
      return c.json(
        { error: { message: "all upstream providers failed", type: "provider_unavailable", attempts: err.attempts } },
        503,
      )
    }
    log.error("inference.unknown_error", { rid, message: err instanceof Error ? err.message : String(err) })
    return c.json({ error: { message: "internal server error", type: "server_error" } }, 500)
  }
})

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

export default app
