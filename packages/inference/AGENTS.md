# @nikcli-ai/inference — Agent Guidelines

OpenAI-compatible inference gateway that fronts **14 upstream providers** (Together, Fireworks, DeepInfra, Groq, Cerebras, SambaNova, Hyperbolic, Nebius, OpenRouter, DeepSeek, Mistral, Moonshot, Zhipu, plus self-hosted vLLM), routes each request to the cheapest healthy upstream per model, caches results aggressively, and charges the customer at a fixed `MODELS` price — the spread is the margin.

## Stack

- **Runtime:** Bun (`bun run --hot src/main.ts`)
- **HTTP:** Hono 4 + `hono/cors`
- **Validation:** Zod (request body + env)
- **Rate limit / cache:** `@upstash/ratelimit` + `@upstash/redis` (REST) with in-memory fallback
- **Lang:** TypeScript strict, ESM (`@tsconfig/bun`), typecheck via `tsgo --noEmit`

## Request Flow

```
POST /v1/chat/completions
  ├─ Auth      validateKey()  Bearer nik-{free|starter|pro|biz}
  ├─ Validate  Zod schema (chatCompletionsSchema)
  ├─ Limit     getRateLimiter().check()  per-tier req + token quota (Upstash or memory)
  ├─ Cache
  │   ├─ hashKey()            SHA-256 over normalized payload (gateway model id, not upstream)
  │   ├─ store.get()          L1 LRU + optional Upstash L2
  │   └─ Coalescer            in-flight dedup on identical concurrent requests
  ├─ Router (on miss)
  │   ├─ routes ← ROUTES[model]                   ordered upstream candidates with prices
  │   ├─ filter: provider enabled + breaker closed + (not estimated unless opted in)
  │   ├─ sort: blendedCost ASC                    cheapest first
  │   ├─ preferProvider?                           pin override
  │   └─ try in order; fall through on 5xx/429/network; surface 4xx immediately
  └─ Response  body + nikcli.{cache, provider, upstreamModel, costUsd, upstreamCostUsd, savedCostUsd, marginUsd}
```

State is **in-memory by default** and **upgrades transparently** when Upstash env vars are set. No restart-time persistence requirements for the gateway itself.

## Cost-saving stack (the whole reason this exists)

Margin per call ≈ `MODELS[id].price × (1 + MARKUP) − routed-upstream-cost − cache-hit-savings`. Every layer below pushes the right-hand subtractors toward zero.

1. **Cheapest-provider routing.** `src/config/routing.ts` holds per-model upstream prices for every supported provider. The router picks the cheapest _healthy_ route via `blendedCost(route)` (weights output 3× input — agent traffic is output-heavy). Customer price is fixed by `MODELS[id]`; the delta is gross margin.
2. **Circuit-broken failover.** `src/health/circuit.ts` opens a per-provider breaker after 5 consecutive failures, recovers via half-open probes. Bad providers are skipped silently — no user-visible 503 unless _all_ providers fail.
3. **Content-hash response cache.** `src/cache/hash.ts` + `store.ts`. Key = SHA-256 over `{model, messages, tools, tool_choice, temperature, top_p, max_tokens, response_format, stop, seed}`. Default policy: cache only on `temperature === 0` or `seed` set. Override per request with `body.nikcli.cache: true` to opt-in for higher temperatures.
4. **In-flight coalescing.** `src/cache/coalesce.ts`. Concurrent identical requests share one upstream Promise — first one pays, the rest return `cache: "coalesced"`.
5. **vLLM prefix caching** (when routing to `local`). Server-side flag `--enable-prefix-caching`. We don't reorder messages; we keep stable prefix (system + tool schemas) first. `prefixCacheable: true` surfaces when this should hit.
6. **Optional Upstash L2** for cross-instance cache + quota sharing. Falls back to memory on REST error.

Response envelope:

```json
"nikcli": {
  "provider": "groq",
  "upstreamModel": "llama-3.3-70b-versatile",
  "cache": "hit | miss | coalesced",
  "prefixCacheable": true,
  "stored": false,
  "costUsd": 0.000180,
  "upstreamCostUsd": 0.000000,
  "savedCostUsd": 0.000059,
  "marginUsd": 0.000180,
  "costCents": 0.018,
  "rid": "<request-uuid>"
}
```

- `costUsd` — billed to customer (`MODELS.price × 1.25`).
- `upstreamCostUsd` — what we actually paid the routed provider (`0` on hits/coalesces).
- `savedCostUsd` — counterfactual: what a vanilla MODELS-priced call would have cost.
- `marginUsd = costUsd − upstreamCostUsd` per call.

## Providers (14)

`src/providers/openai-compat.ts` defines a single `OpenAICompatProvider` class plus the catalog. A provider auto-enables iff its env key is present:

| Name       | Env key              | Base URL                                   | Strength                      |
| ---------- | -------------------- | ------------------------------------------ | ----------------------------- |
| local      | `LOCAL_API_KEY`      | `VLLM_BASE_URL` (default `localhost:8000`) | Self-hosted, prefix caching   |
| together   | `TOGETHER_API_KEY`   | `api.together.xyz/v1`                      | Broad catalog, turbo variants |
| fireworks  | `FIREWORKS_API_KEY`  | `api.fireworks.ai/inference/v1`            | Latency-tuned, fp8 / fp16     |
| deepinfra  | `DEEPINFRA_API_KEY`  | `api.deepinfra.com/v1/openai`              | Cheapest on many open models  |
| groq       | `GROQ_API_KEY`       | `api.groq.com/openai/v1`                   | Fastest for Llama family      |
| cerebras   | `CEREBRAS_API_KEY`   | `api.cerebras.ai/v1`                       | Ultra-low latency Llama       |
| sambanova  | `SAMBANOVA_API_KEY`  | `api.sambanova.ai/v1`                      | Fast Llama 3.x                |
| hyperbolic | `HYPERBOLIC_API_KEY` | `api.hyperbolic.xyz/v1`                    | Cheap DeepSeek / Llama / Qwen |
| nebius     | `NEBIUS_API_KEY`     | `api.studio.nebius.ai/v1`                  | Often cheapest for Llama/Qwen |
| openrouter | `OPENROUTER_API_KEY` | `openrouter.ai/api/v1`                     | Catch-all, dynamic routing    |
| deepseek   | `DEEPSEEK_API_KEY`   | `api.deepseek.com/v1`                      | Native V3 / R1 cheapest       |
| mistral    | `MISTRAL_API_KEY`    | `api.mistral.ai/v1`                        | Native Mistral / Devstral     |
| moonshot   | `MOONSHOT_API_KEY`   | `api.moonshot.cn/v1`                       | Native Kimi K2                |
| zhipu      | `ZHIPU_API_KEY`      | `open.bigmodel.cn/api/paas/v4`             | Native GLM                    |

OpenRouter also reads `OPENROUTER_REFERRER` and `OPENROUTER_APP_NAME` (used for OpenRouter's referrer policy).

## API

| Method | Path                   | Auth   | Description                                            |
| ------ | ---------------------- | ------ | ------------------------------------------------------ |
| GET    | `/health`              | none   | Status, version, providers, circuit breakers, cache    |
| GET    | `/v1/providers`        | none   | Provider catalog with enabled status                   |
| GET    | `/v1/models`           | none   | All `MODELS`; `?routes=1` includes upstream candidates |
| POST   | `/v1/chat/completions` | Bearer | OpenAI-compatible chat, SSE supported                  |

Per-request controls inside the body (all optional):

```jsonc
{
  "model": "kimi-k2.6",
  "messages": [...],
  "nikcli": {
    "cache": true,             // opt-in caching for temperature > 0
    "cacheTtlSeconds": 3600,
    "preferProvider": "groq",  // pin a provider (must still be enabled + healthy)
    "allowEstimated": false    // allow routes marked estimated/unverified
  }
}
```

## Tier Limits

`TIER_LIMITS` in `src/types/index.ts`. Quotas reset on the UTC day boundary. Enforced by `getRateLimiter().check()` — Upstash when env present, memory otherwise.

| Tier       | Key           | Req / day | Tokens / day |
| ---------- | ------------- | --------- | ------------ |
| `free`     | `nik-free`    | 100       | 50K          |
| `starter`  | `nik-starter` | 1,000     | 1M           |
| `pro`      | `nik-pro`     | 10,000    | 10M          |
| `business` | `nik-biz`     | 100,000   | 100M         |

## Environment

Validated by `src/config/env.ts` (Zod). Missing required vars throw at boot.

| Var                        | Default                    | Notes                                 |
| -------------------------- | -------------------------- | ------------------------------------- |
| `NODE_ENV`                 | `development`              | `development`, `production`, `test`   |
| `PORT`                     | `3000`                     |                                       |
| `HOST`                     | `0.0.0.0`                  |                                       |
| `LOG_LEVEL`                | `info`                     | `debug` / `info` / `warn` / `error`   |
| `VLLM_BASE_URL`            | `http://localhost:8000/v1` | Local fallback                        |
| `LOCAL_API_KEY`            | `local-dev-key`            | Local fallback                        |
| `<PROVIDER>_API_KEY`       | —                          | See provider table; auto-enables      |
| `UPSTASH_REDIS_REST_URL`   | —                          | Enables L2 cache + distributed limits |
| `UPSTASH_REDIS_REST_TOKEN` | —                          | "                                     |
| `INFERENCE_CACHE_MAX`      | `5000`                     | L1 LRU max entries                    |
| `INFERENCE_CACHE_TTL`      | `86400` (24h)              | Default cache TTL seconds             |
| `ALLOW_ESTIMATED_ROUTES`   | `false`                    | Global fallback for unverified routes |
| `STRIPE_SECRET_KEY`        | —                          | Declared, not wired up                |

See `.env.example` for the full template.

## Scripts

```bash
bun run dev         # bun run --hot src/main.ts
bun run build       # bun build → dist/ (minified)
bun run start       # bun run dist/main.js
bun run typecheck   # tsgo --noEmit
bun test
```

## Production

```bash
docker build -f deploy/Dockerfile -t nikcli-inference .
docker run --env-file .env -p 3000:3000 nikcli-inference

# or
docker compose -f deploy/docker-compose.yml up -d
```

The Dockerfile is multi-stage (deps → build → minimal runtime), uses `oven/bun:1.3-alpine`, runs as non-root user `nikcli`, and includes a `HEALTHCHECK` against `/health`. The entrypoint `src/main.ts` validates env at boot and handles `SIGTERM` / `SIGINT` gracefully.

### Where to deploy

- **Fly.io / Render / Railway**: drop in the Dockerfile.
- **Vercel**: not ideal — this is a long-lived HTTP service, not Edge-friendly because of the in-flight coalescer and breaker state.
- **Self-hosted with vLLM behind**: run `nikcli-inference` next to a vLLM instance, point `VLLM_BASE_URL` at it, leave managed-provider keys unset to operate fully self-hosted.

## Key files

```
src/
├── main.ts                 Bun entrypoint, env load, graceful shutdown
├── server.ts               Hono routes + orchestration
├── index.ts                Public package surface
├── types/index.ts          MODELS, TIER_LIMITS, MARKUP, ChatMessage
├── config/
│   ├── env.ts              Zod env validation
│   └── routing.ts          ROUTES — per-model upstream candidates + prices
├── cache/
│   ├── hash.ts             content-hash cache key + isDeterministic policy
│   ├── store.ts            L1 memory LRU + optional Upstash L2
│   └── coalesce.ts         in-flight request dedup
├── health/
│   └── circuit.ts          per-provider circuit breaker
├── providers/
│   ├── index.ts            BaseProvider + LocalProvider (vLLM)
│   ├── openai-compat.ts    OpenAICompatProvider + PROVIDER_DEFS catalog
│   ├── registry.ts         ProviderRegistry — auto-detect from env
│   ├── router.ts           Router — cheapest healthy + fallback
│   ├── cached.ts           CachedProvider — wraps Router with cache + coalescing
│   ├── base.ts             dead — duplicate, see Known gaps
│   └── local.ts            dead — stale model list, see Known gaps
└── middleware/
    ├── index.ts            barrel + legacy calcCost/upstreamCostUsd
    ├── validation.ts       Zod request body schema
    ├── ratelimit.ts        getRateLimiter() — Upstash + memory fallback
    └── logger.ts           structured JSON logger
```

Tests: `test/{cached-provider,router,registry,circuit,validation}.test.ts` — 32 tests covering cache hit/miss/coalesce, cheapest-route selection + failover, registry auto-detection, breaker state transitions, and request validation.

## Adding a model

1. Add an entry to `MODELS` in `src/types/index.ts` with `provider`, `context`, `input`, `output`, `params`, `hfId`.
2. Add an entry in `ROUTES` (`src/config/routing.ts`) mapping the gateway id → ordered list of upstream provider routes with their upstream model ids and **upstream** prices (not your sell price).
3. If unsure whether a provider serves the model yet, mark the route `estimated: true` — the router skips it unless `nikcli.allowEstimated` or `ALLOW_ESTIMATED_ROUTES` is set.
4. No code change is needed for the route to take effect; providers auto-enable from env.

## Adding a provider

1. Append an entry to `PROVIDER_DEFS` in `src/providers/openai-compat.ts` with `baseUrl` and `envKey`.
2. (Most providers are already covered by `OpenAICompatProvider`. For non-OpenAI dialects — Anthropic, Google — subclass `BaseProvider` and have the registry use it.)
3. Add the env var to `src/config/env.ts` (`Env` schema).
4. Add entries to `ROUTES` for each model the provider serves.

## Operational notes

- **Refresh prices.** `ROUTES` ship with prices as of 2026-02. Providers move; treat the table as the source of truth and audit it monthly.
- **Pin a provider in dev** with `body.nikcli.preferProvider = "groq"` to validate a specific upstream.
- **Watch the breakers** via `GET /health` — open breakers mean a provider is shedding load or down.
- **Structured logs.** Every request emits `http` + `inference.complete` with `rid`, `provider`, `cache`, `inputTokens`, `outputTokens`, `billedUsd`, `upstreamUsd`, `marginUsd`. Ship to your log sink for revenue accounting.

## Known gaps / TODOs

- **Dead code in `providers/`.** `base.ts` and `local.ts` define a duplicate `BaseProvider` / `LocalProvider` that nothing imports. `local.ts` still lists Qwen-2.5 / MiniMax-7B / Llama-3.1 IDs that no longer exist in `MODELS`. Safe to delete.
- **Streaming responses are not cached.** `CachedProvider` passes streams straight through to the routed provider. Buffer + replay would let SSE benefit from the cache too.
- **`max_tokens` is charged eagerly.** `RateLimiter.check()` reserves `body.max_tokens ?? 1000` against the daily quota up front and never refunds the unused portion.
- **Token usage from cache hits.** When the cache serves a hit, the rate limiter still consumes a request slot — arguably correct (each /v1 call still costs us bandwidth) but worth noting.
- **`provider: "groq"` field in `MODELS`** is now informational only — the router decides at request time from `ROUTES`. The legacy field can be removed once you confirm no consumers depend on `/v1/models` `owned_by` returning a route hint.
- **No request validation for non-chat endpoints.** Only `/v1/chat/completions` runs Zod.
- **Stripe is declared but unused.** When wiring billing, hook into the `inference.complete` log to meter usage.
- **Single-region Upstash.** Multi-region writes will race; pick a primary or move to Redis Cluster.
- **Estimated routes.** Marked `estimated: true` in `ROUTES` for models that may not yet be live with a given provider. Verify periodically.

## Out of scope for this package

- Model weights / vLLM deployment scripts (see `README.md` for the Modal one-liner).
- Customer-facing billing UI — Stripe wiring lives elsewhere in the monorepo.
- Auth beyond static bearer tokens — no JWT, no per-user keys yet.
