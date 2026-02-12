# @nikcli-ai/cloud

Cloud relay and sync backend for Nikcli mobile and web remote clients.

## Features

- Open JWT authentication (OIDC JWKS or HMAC secret)
- Device registration with per-device public keys
- Encrypted session and message storage in D1
- Pull/push sync log API for offline clients
- WebSocket relay via Durable Objects

## Local development

```bash
bun install
bun run dev
```

## Database migrations

```bash
bun run db:migrate:local
```

## Authentication

The service supports two open authentication modes:

1. **OIDC/JWKS** (recommended): set `AUTH_JWKS_URL` and optionally `AUTH_ISSUER`/`AUTH_AUDIENCE`
2. **HMAC JWT**: set `AUTH_JWT_SECRET` and optionally `AUTH_ISSUER`/`AUTH_AUDIENCE`

## Environment

- `AUTH_JWKS_URL` (optional): JWKS endpoint for asymmetric JWT verification
- `AUTH_JWT_SECRET` (optional): symmetric secret for HS256/384/512 JWT verification
- `AUTH_ISSUER` (optional): expected JWT issuer
- `AUTH_AUDIENCE` (optional): expected JWT audience
- `ALLOWED_ORIGINS` (optional): comma-separated origin allowlist
