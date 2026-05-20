# @nikcli-ai/inference

Multi-provider, OpenAI-compatible AI inference gateway. Routes every request to the cheapest healthy upstream (Together, Fireworks, DeepInfra, Groq, Cerebras, SambaNova, Hyperbolic, Nebius, OpenRouter, DeepSeek, Mistral, Moonshot, Zhipu, or self-hosted vLLM), caches results, and exposes a fixed sell price — the spread is the margin.

## Features

- **14 upstream providers** auto-detected from env keys
- **Cheapest-route + failover** via a per-provider circuit breaker
- **Content-hash response cache** (memory L1 + optional Upstash L2)
- **In-flight request coalescing** for concurrent identical calls
- **Per-tier rate limiting** (Upstash or in-memory)
- **Streaming SSE** pass-through with provider attribution
- **Zod-validated** request body + env

## Quick Start

```bash
cp .env.example .env
# add at least one *_API_KEY (e.g. GROQ_API_KEY, DEEPINFRA_API_KEY)
bun install
bun run dev
```

```bash
curl http://localhost:3000/health
curl http://localhost:3000/v1/providers
curl http://localhost:3000/v1/models?routes=1 -H "Authorization: Bearer nik-pro"

curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer nik-pro" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.3-70b","messages":[{"role":"user","content":"Hello"}]}'
```

The response includes a `nikcli` envelope showing which provider served the request, cache status, and margin per call.

## Production

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Multi-stage Bun Alpine image, non-root user, `HEALTHCHECK` against `/health`, graceful `SIGTERM` handling.

## API Keys (dev tiers)

| Key            | Tier     | Req/day | Tokens/day |
| -------------- | -------- | ------- | ---------- |
| `nik-free`     | free     | 100     | 50K        |
| `nik-starter`  | starter  | 1,000   | 1M         |
| `nik-pro`      | pro      | 10,000  | 10M        |
| `nik-biz`      | business | 100,000 | 100M       |

## License

MIT
