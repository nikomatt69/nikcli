import { Effect, Schema } from "effect"
import { Route, type RouteModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Provider } from "../provider"
import { Protocol } from "../route/protocol"
import {
  AuthenticationReason,
  LLMError,
  ProviderInternalReason,
  ProviderID,
  QuotaExceededReason,
  RateLimitReason,
  UnknownProviderReason,
  type ModelID,
  type ProviderOptions,
} from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.openrouter
export const id = ProviderID.make(profile.provider)
const ADAPTER = "openrouter"

export interface OpenRouterOptions {
  readonly [key: string]: unknown
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type OpenRouterProviderOptionsInput = ProviderOptions & {
  readonly openrouter?: OpenRouterOptions
}

export type ModelOptions = Omit<RouteModelInput, "id" | "baseURL" | "providerOptions"> & {
  readonly baseURL?: string
  readonly providerOptions?: OpenRouterProviderOptionsInput
}
type ModelInput = ModelOptions & Pick<RouteModelInput, "id">

const OpenRouterBody = Schema.StructWithRest(Schema.Struct(OpenAIChat.bodyFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type OpenRouterBody = Schema.Schema.Type<typeof OpenRouterBody>

// OpenRouter is a gateway. When an upstream provider fails mid-stream it does
// NOT return an HTTP 4xx/5xx — it returns HTTP 200 and emits a single SSE data
// frame shaped `{"error":{"code":429,"message":"...","metadata":{...}}}`. This
// is common on the free model tier (rate limits, exhausted credits, gated or
// down upstream). The strict OpenAI Chat event schema has no `error` field, so
// without handling it the frame decodes as a generic "Invalid stream event" and
// the real cause is buried in a non-retryable error. We decode the error frame
// and translate it into a properly classified LLMError so retry/backoff and the
// surfaced message are correct.
const OpenRouterErrorPayload = Schema.Struct({
  code: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  message: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const OpenRouterErrorEvent = Schema.Struct({
  error: OpenRouterErrorPayload,
})
type OpenRouterErrorEvent = Schema.Schema.Type<typeof OpenRouterErrorEvent>

// Error variant first so an in-band error frame is never mis-decoded as a chat
// event. The two are disjoint: the error frame has no required `choices`, a
// chat frame has no required `error`.
const OpenRouterStreamEvent = Schema.fromJsonString(
  Schema.Union([OpenRouterErrorEvent, OpenAIChat.OpenAIChatEvent]),
)

const numericCode = (code: number | string | undefined): number | undefined => {
  if (typeof code === "number") return code
  if (typeof code === "string") {
    const parsed = Number(code)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const retryAfterMs = (metadata: Record<string, unknown> | undefined): number | undefined => {
  if (!isRecord(metadata)) return undefined
  const headers = isRecord(metadata.headers) ? metadata.headers : undefined
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"] ?? metadata.retry_after
  const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined
}

const streamError = (error: OpenRouterErrorEvent["error"]) => {
  const message = error.message ?? "OpenRouter returned an error"
  const code = numericCode(error.code)
  const text = `${message} ${typeof error.code === "string" ? error.code : ""}`.toLowerCase()
  const retry = retryAfterMs(error.metadata)

  const reason =
    code === 429 || /rate.?limit/.test(text)
      ? new RateLimitReason({ message, retryAfterMs: retry })
      : code === 402 || /quota|insufficient.?(credit|fund)|payment.?required/.test(text)
        ? new QuotaExceededReason({ message })
        : code === 401 || /invalid.?api.?key|unauthor/.test(text)
          ? new AuthenticationReason({ message, kind: "invalid" })
          : code === 403 || /forbidden|permission/.test(text)
            ? new AuthenticationReason({ message, kind: "insufficient-permissions" })
            : code !== undefined && code >= 500
              ? new ProviderInternalReason({ message, status: code, retryAfterMs: retry })
              : new UnknownProviderReason({ message, status: code })

  return new LLMError({ module: "openrouter", method: "stream", reason })
}

export const protocol = Protocol.make({
  id: "openrouter-chat",
  body: {
    schema: OpenRouterBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map(
          (body) =>
            ({
              ...body,
              ...bodyOptions(request.providerOptions?.openrouter),
            }) as OpenRouterBody,
        ),
      ),
  },
  stream: {
    event: OpenRouterStreamEvent,
    initial: OpenAIChat.protocol.stream.initial,
    step: (state, event) =>
      "error" in event
        ? Effect.fail(streamError(event.error))
        : OpenAIChat.protocol.stream.step(state, event as OpenAIChat.OpenAIChatEvent),
    onHalt: OpenAIChat.protocol.stream.onHalt,
  },
})

const bodyOptions = (input: unknown) => {
  const openrouter = isRecord(input) ? input : {}
  return {
    ...(openrouter.usage === true
      ? { usage: { include: true } }
      : isRecord(openrouter.usage)
        ? { usage: openrouter.usage }
        : {}),
    ...(isRecord(openrouter.reasoning) ? { reasoning: openrouter.reasoning } : {}),
    ...(typeof openrouter.promptCacheKey === "string" ? { prompt_cache_key: openrouter.promptCacheKey } : {}),
  }
}

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export const routes = [route]

const modelRef = Route.model<ModelInput>(route, {
  provider: profile.provider,
  baseURL: profile.baseURL,
})

export const model = (id: string | ModelID, options: ModelOptions = {}) => modelRef({ ...options, id })

export const provider = Provider.make({
  id,
  model,
})
