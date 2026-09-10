# EOT-11: Provider Streaming and Inference Pipeline

Status: proposed. Tier: 1. Phase: P2. Dependencies: EOT-01, EOT-02, EOT-10.
Owner: provider and session/llm maintainers, `@nikcli-ai/llm` core. [Roadmap](../ROADMAP.md).

## Problem and Evidence

Evidence B20, B21, B22, B23 in the [register](../README.md): the new `@nikcli-ai/llm` package is a typed Effect Schema-first
core with `Protocol`/`Endpoint`/`Auth`/`Framing` composition and `LLMEvent` streams, but the production request path still
runs through `session/llm/*` and `provider/provider.ts` via Promises and AI SDK adapters. Streaming deltas currently travel
across two boundaries (AI SDK → `session/llm` adapters → bus → `Bus.publish` → SSE → TUI), and each boundary has its own
backpressure, error, and dedup rules. There is no single architectural spec unifying provider streaming, model selection,
cache policy, retry, failover, rate limit, and cancellation across all these layers.

The opportunity is to converge on `LLMClient.stream` / `LLMClient.generate` as the canonical model, keep the AI SDK route as
one adapter rather than two models, and use Effect `Stream` end-to-end without losing the existing Promise-SDK
compatibility or the Bus publish shape. No second LLM runtime; no replacement of the AI SDK by force.

## Scope and Non-Goals

Apply the Effect `Stream` model to provider streaming, model selection, and inference caching across the existing
`session/llm/*`, `provider/*`, and `@nikcli-ai/llm/*` packages. Keep the existing AI SDK providers (Anthropic, OpenAI,
Google, Bedrock, Azure, XAI, OpenRouter, Copilot, OpenAI-compatible) working without code changes for callers. Preserve
bus/SSE wire compatibility and the existing `SessionMessage` event timeline. Do not introduce a new provider abstraction,
a second AI SDK route, a global model router, distributed inference, or a fresh cache layer that competes with the existing
provider cache policy.

## Design and Requirements

1. Adopt `@nikcli-ai/llm`'s `LLMEvent` and `LLMRequest` as the canonical schema for new producer code. Existing AI SDK
   providers keep producing AI SDK streams; an adapter inside `provider/provider.ts` converts `LanguageModelV2` streams into
   `LLMEvent` streams, not into a third wire format. Wire schemas in `server/httpapi/session.ts` stay unchanged unless EOT-10
   requires them.
2. Use Effect `Stream.Stream` end-to-end in new code paths: `LLMClient.stream(request)` for incremental deltas,
   `LLMClient.generate(request)` for the collected response, `LLMClient.prepare<Body>(request)` for compiled bodies.
   Convert at the AI SDK boundary with `Stream.fromAsyncIterable` / `Stream.fromReadableStream` and `Effect.mapEffect`, not
   with manual async generators that lose backpressure. `provider/provider.ts` becomes an adapter, not a parallel schema.
3. Cancellation must reach the underlying provider request through the AI SDK `AbortSignal`, not just through the Promise
   wrapper. `LLMClient.stream` accepts `Stream.fromEffect` consumers with interruption that propagates into the adapter.
   Late events after cancellation are dropped before they reach the bus/SSE/TUI path; do not deliver them with a "done"
   marker that masks the cancellation.
4. Define a typed model-selection service that derives `ModelRef` from `(providerID, modelID)` plus config overrides,
   resolves `auth_provider` aliases through `Auth.Service`, applies variants/transforms, and returns a typed
   `LanguageModelV2 | LlmRoute`. Pure transforms remain pure functions; Effect only orchestrates and acquires.
5. Cache policy belongs to a `CachePolicy.Service` that composes the existing `cache-policy.ts`, `cache-diagnostics.ts`,
   and `models-macro.ts`. Pin a structured key (`providerID`, `modelID`, `route`, prompt-prefix hash, tool schema version,
   capability revision), not a string. Cache hits return cached frames through the same `LLMEvent` stream the producer
   would; do not fork a faster Promise-only path that breaks EOT-10 contract tests.
6. Retry only classified transient failures: HTTP 408/429/5xx with a `retry-after` header, network resets, provider rate
   limit responses with a documented backoff schedule. Never retry non-idempotent completions after partial output has
   been emitted; the bus/SSE contract publishes order, and a replay would scramble it. Authentication failures, validation
   failures, schema mismatches, and unknown errors do not retry without explicit user action.
7. Multi-provider failover for **idempotent** reads only (compaction summaries, embeddings, route warmup). Mark the route
   as idempotent in the `Protocol` definition; never enable failover by default for chat completions. A failed primary
   must not produce a partial response visible to the user.
8. Rate limit handling: provider signals (HTTP 429, `quota_exceeded`, `rate_limit_exceeded`) decode into
   `ProviderError.RateLimited` with `retryAfter`, surfaced to the user as a typed failure, never as a silent retry loop.
   Local quota (`nikcli-inference`) is checked synchronously before the request is constructed; a denied quota returns
   `ProviderError.QuotaDenied` without burning a request.
9. Streaming observability: every LLM call yields a span with `provider`, `model`, `route`, `stream.tokens.in`,
   `stream.tokens.out`, `stream.duration`, `stream.first_token_ms`, `stream.interruptions`. Cardinality is fixed; no
   prompts/tokens/URLs in dimensions. Truncation/resampling preserves the totals and the first/last N samples.
10. Token accounting is a `Usage.Service` that aggregates per-call and per-session tokens from `LLMEvent.usage` deltas.
    The TUI's existing usage panel reads from this service, not from a parallel accumulator. Missing `usage` chunks must
    not silently under-report; the aggregator either reconstructs from prior deltas or flags the gap explicitly.

## Streaming Topology

```text
LanguageModelV2.stream
  -> Stream.fromAsyncIterable / Stream.fromReadableStream
  -> ProviderError schema mapping (HTTP/code → tagged error)
  -> CachePolicy lookup (idempotent routes only)
  -> Token accumulator + span emission
  -> LLMEvent schema validation
  -> session/llm adapter -> existing bus publication
  -> SSE / event bus → SDK client → TUI delta consumer
```

The single seam that changes is the AI SDK → LLMEvent adapter inside `provider/provider.ts`. Everything downstream keeps
its existing shape; the bus/SSE wire schema does not change.

## Failure and Cancellation

Use `Schema.TaggedError` for `ProviderError.Transport`, `ProviderError.RateLimited`, `ProviderError.AuthExpired`,
`ProviderError.QuotaDenied`, `ProviderError.SchemaMismatch`, `ProviderError.Unsupported`, `ProviderError.Timeout`. Distinguish
defects internally and sanitize at the user boundary. Cancellation must interrupt the AI SDK request and the underlying
HTTP/WS connection, not just drop the consumer. A failed stream must not commit a "done" marker; downstream consumers
either see the failure or no terminal event. Provider partial outputs that never reached the bus are not user-visible; do
not invent partial-success.

## Acceptance and Verification

- An interrupted stream halts the AI SDK request within the EOT-01 cancellation budget; the bus publishes no terminal
  event; the SDK does not deliver post-cancel frames; the TUI shows no commit.
- A 429 response decodes to `ProviderError.RateLimited` with `retryAfter`; the failure path is exercised without retry; the
  user sees a typed failure, not a retry loop. A real `Retry-After` produces the same path.
- Cached and uncached runs produce identical `LLMEvent` shape; cache hit rate, byte savings, and invalidation rate are
  recorded per session; no model produces different user-visible output for the same cache key.
- Multi-provider failover is exercised only on idempotent routes (compaction/embeddings); chat completions do not failover;
  a failure on the primary stays a failure with a clear reason.
- Token accounting matches the provider's reported totals for at least three live providers (Anthropic, OpenAI, Google)
  on a fixed corpus. Missing `usage` chunks are flagged, not interpolated.
- Spans correlate with the session's parent span; trace ids are stable across provider/SDK/bus/SSE/TUI hops; no high-card
  dimensions appear.
- Extend `packages/nikcli/test/provider/`, `packages/nikcli/test/session/`, `packages/nikcli/test/llm/` (or
  `packages/llm/test/`), `packages/nikcli/test/server/event-feed.test.ts`, and `packages/nikcli/test/tui/streaming-cost.test.ts`.
- From `packages/nikcli`: `bun test test/provider/ test/session/ test/server/event-feed.test.ts test/tui/streaming-cost.test.ts`.
  One final root `bun run typecheck` after the slice, not per-file.
- Meet EOT-01 budgets; target at least 30% reduction in per-token cost for the workloads that hit cache, with at least 95%
  cache hit rate on the second identical request in the test fixture.

## Migration and Rollback

Start with one provider and one session path; capture the existing AI SDK event order as a recorded fixture, then introduce
the adapter. Verify byte-identical user-visible output for the recorded fixture before/after the adapter. Only then extend
to other providers and to the live route. Roll back the adapter behind the existing `provider/provider.ts` facade; never
delete the AI SDK route until every caller uses the new seam. Cache invalidation must be additive; never delete
user-visible cache state as part of a streaming refactor.
