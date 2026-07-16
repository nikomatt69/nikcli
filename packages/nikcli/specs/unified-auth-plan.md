# NikCLI Identity — Ground-Up Master Plan

Rewritten from zero on 2026-07-16. Designs the entire shared-auth system from first
principles (requirements → architecture → detailed design → implementation → rollout),
then maps it onto the repo. Supersedes the previous incremental draft; companion
architecture note: `unified-auth.md`.

**Implementation status (2026-07-17):** integrated and verified locally. Production deployment, DNS, GitHub OAuth credentials, Cloudflare Email Sending onboarding, and live cross-client smoke tests remain rollout operations requiring external resources.

---

## 1. Requirements

**Functional**

- R1 One account works everywhere: CLI, mobile app, desktop app, Studio dashboard,
  hosted hub (`s.nikcli.store`), cloud sync, inference API keys, web (artifacts/shares).
- R2 Login methods: GitHub OAuth + email code (passwordless). Password login only as a
  legacy fallback during migration.
- R3 Every client type gets a first-class flow: headless terminal (CLI), native mobile,
  native desktop, browser SPA.
- R4 Self-hosted/enterprise deployments can run their own issuer and point every client
  at it with one setting.

**Non-functional**

- N1 **Offline-first**: a localhost nikcli server keeps working with zero accounts and
  zero network. Identity is only enforced on shared/hosted deployments.
- N2 Resource servers must verify credentials **without calling the issuer per request**
  (the hub already handles PTY websockets and high-frequency sync).
- N3 Compromised-token blast radius bounded to minutes, not months.
- N4 No secrets in public clients (CLI binaries, mobile bundles, SPAs).
- N5 Existing users/tokens keep working through the migration; no flag-day.

**Explicit non-goals (v1)**

- SSO/SAML, MFA, fine-grained per-route permissions (roles stay in each server's local
  `users` table), org/workspace billing scopes in tokens (console keeps handling that).

---

## 2. Architecture

Classic OIDC-shaped split — one **issuer** that authenticates humans, N **resource
servers** that verify tokens offline, N **public clients** that obtain tokens:

```
                        ┌─────────────────────────────────────┐
                        │  packages/identity  (NEW)           │
                        │  Cloudflare Worker @ auth.nikcli.store
                        │  Hono + OpenAuth(lib) + KV + D1     │
                        │  • GitHub + email-code login        │
                        │  • JWT access (15m) / refresh (90d) │
                        │  • JWKS · device flow · PKCE        │
                        └────────┬───────────────┬────────────┘
                 tokens (PKCE / device / refresh)│ JWKS (offline verify)
        ┌────────────────────────┘               └──────────────────────┐
        ▼                                                               ▼
┌──────────────────────┐                              ┌──────────────────────────────┐
│ PUBLIC CLIENTS        │                              │ RESOURCE SERVERS             │
│ cli      device flow  │                              │ nikcli server (local+hub)    │
│ desktop  PKCE+deeplink│                              │ packages/cloud (D1 sync)     │
│ mobile   PKCE+deeplink│                              │ packages/web APIs (artifacts)│
│ studio   PKCE (SPA)   │                              │ inference-dashboard API      │
│ console  PKCE (SPA)   │                              │ (all via packages/auth)      │
└──────────────────────┘                              └──────────────────────────────┘
```

**Key decision — dedicated `packages/identity`, not the console worker.** The console's
`function/src/auth.ts` proved OpenAuth works here, but it is entangled with console-core
Drizzle models, SST resources, and fork leftovers (an `@anoma.ly` email guard). Building
identity as its own package gives it an independent lifecycle, its own storage, and makes
console just another client. Its code is donor material, not the foundation.

**Second key decision — two credential planes, kept separate on purpose:**

- **Identity plane** (this plan): who you are. JWTs from the issuer.
- **Capability plane** (already exists, unchanged): what a specific server lets a
  machine do — `nkm_` scoped tokens for pairing/sync/teleport, per-share secrets,
  inference API keys. Capabilities are _minted by_ an authenticated identity but do not
  carry identity themselves.

LLM-provider auth (`auth.json`, Anthropic/Copilot/xAI plugins) is a third, untouched world.

---

## 3. Detailed design

### 3.1 Identity data model (issuer-owned, D1)

```sql
accounts        (id TEXT PK,            -- acc_<ulid>
                 email TEXT UNIQUE NOT NULL,
                 created_at INTEGER, updated_at INTEGER, disabled_at INTEGER)
auth_methods    (id TEXT PK, account_id FK,
                 provider TEXT NOT NULL,          -- 'github' | 'email'
                 subject  TEXT NOT NULL,          -- github user id / email addr
                 UNIQUE(provider, subject))
refresh_tokens  (id TEXT PK, account_id FK,
                 token_hash TEXT UNIQUE NOT NULL, -- SHA-256, raw never stored
                 client_id TEXT NOT NULL,
                 family_id TEXT NOT NULL,         -- rotation family (reuse detection)
                 expires_at INTEGER, rotated_at INTEGER, revoked_at INTEGER)
device_codes    (device_code_hash TEXT PK, user_code TEXT UNIQUE,
                 client_id TEXT, scope TEXT,
                 status TEXT,                     -- pending|approved|denied|consumed
                 account_id TEXT NULL, expires_at INTEGER, last_poll_at INTEGER)
signing_keys    (kid TEXT PK, alg TEXT, private_jwk TEXT, public_jwk TEXT,
                 created_at INTEGER, retired_at INTEGER)
```

Ephemeral state (authorization codes, PKCE challenges, email codes, poll rate-limit)
lives in KV with TTLs. Long-lived state (above) in D1.

### 3.2 Tokens

| Token     | Format                 | TTL        | Notes                                                           |
| --------- | ---------------------- | ---------- | --------------------------------------------------------------- |
| Access    | JWT, ES256             | **15 min** | verified offline everywhere (N2, N3)                            |
| Refresh   | opaque, hashed at rest | 90 days    | **rotating**; reuse of a rotated token revokes the whole family |
| ID claims | inside access token    | —          | no separate ID token in v1                                      |

Access-token claims:

```json
{
  "iss": "https://auth.nikcli.store",
  "sub": "acc_01J...",
  "aud": "nikcli-api",
  "email": "user@example.com",
  "client_id": "nikcli-mobile",
  "iat": 1752690000,
  "exp": 1752690900,
  "kid": "<header>"
}
```

One audience (`nikcli-api`) for all nikcli resource servers: a login is valid against any
server that trusts the issuer; _authorization_ (roles/admin) remains local per server.
Verifiers accept 60s clock skew. Keys: ES256, stored in `signing_keys`, published at
`/.well-known/jwks.json`, rotated by adding a new kid and retiring the old after
`access_ttl` (retired public keys stay in JWKS for 24h).

### 3.3 Issuer HTTP surface (`auth.nikcli.store`)

| Endpoint                                      | Purpose                                                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /authorize`                              | OAuth 2.1 authorization-code + **PKCE S256 required**; `client_id`, `redirect_uri`, `state`, `code_challenge`                                                              |
| `POST /token` (+ alias `POST /oauth/token`)   | grants: `authorization_code`, `refresh_token`, `urn:ietf:...:device_code`                                                                                                  |
| `POST /oauth/device/code`                     | device flow start — **must return the shape in `packages/nikcli/src/account/schema.ts` (`DeviceCodeResponse`)**                                                            |
| `POST /oauth/device/token`                    | device poll — **must return `PollResult` status literals: `pending\|slow_down\|expired\|denied\|success`** (the shipped CLI client defines the contract, not raw RFC 8628) |
| `GET /device`                                 | human page: login (normal authorize flow) → enter `user_code` → approve/deny                                                                                               |
| `POST /revoke`                                | revoke a refresh token / family                                                                                                                                            |
| `GET /userinfo`                               | `{ id, email, created_at, ... }` for clients (matches `account/schema.ts Info`)                                                                                            |
| `GET /.well-known/jwks.json`                  | public keys                                                                                                                                                                |
| `GET /.well-known/oauth-authorization-server` | standard metadata                                                                                                                                                          |
| `GET /.well-known/nikcli`                     | nikcli discovery doc (contract in `src/auth/index.ts:61-70`) — enables `enterpriseUrl` self-hosting (R4)                                                                   |

Login providers inside `/authorize`: **GitHub** (verified primary email required) and
**email code** (6-digit, KV TTL 10 min, sent via Cloudflare Email Service). Account
linking: `auth_methods` matched by `(provider, subject)`, else by verified email, else a
new account — same algorithm the console worker already implements, re-homed.

Registered public clients (no secrets, N4): `nikcli` (CLI — already hardcoded in the
shipped client), `nikcli-desktop`, `nikcli-mobile`, `nikcli-studio`, `nikcli-web`,
`nikcli-console`. Allowed redirect URIs per client (`nikcli://auth/callback` for
mobile/desktop, `https://…/dashboard/callback` for SPAs, loopback `http://127.0.0.1:*`
for CLI fallback).

Implementation: Hono worker; use `@openauthjs/openauth` as a library where it fits
(authorize UI, provider adapters, storage) and hand-rolled Hono routes where it doesn't
(device flow, `/.well-known/nikcli`, revocation). `jose` for signing.

### 3.4 Shared verifier — new `packages/auth` (`@nikcli-ai/auth`)

Small, dependency-light (jose + zod, peer hono), consumed by every resource server:

- `verify.ts` — `verifyAccessToken(token, { issuer, audience, jwksUrl | jwtSecret })`;
  cached `createRemoteJWKSet`; ES256/RS256/EdDSA + HS256 fallback for tests.
  (Donor code: `packages/cloud/src/auth.ts:7-62`, generalized.)
- `claims.ts` — zod `AuthClaims`, `AuthContext { accountID, email, clientID, claims }`.
- `hono.ts` — `requireAuth({ ensureUser? })` middleware factory (donor:
  `cloud/src/auth.ts:81-98`), optional `?token=` for websockets.
- `client.ts` — token-store helper for Node/Bun clients: persist `{access, refresh,
expires}`, auto-refresh 60s before expiry with single-flight lock (donor pattern:
  `src/auth/index.ts getValidImpl`).

### 3.5 Resource-server rule (uniform)

Order of acceptance in every server's auth middleware:

1. issuer JWT (via `@nikcli-ai/auth`) → resolve/provision local user;
2. local capability token (`nkm_` scopes, API keys, share secrets) — unchanged;
3. legacy credentials (`nku_` session, Basic, Tailscale) — only while migration flag allows.

nikcli server specifics: identity linking needs `users.external_subject TEXT UNIQUE`
(match by subject → else by verified email → else create with role `member`); enforcement
flag `NIKCLI_REQUIRE_OAUTH=1` on hosted hubs disables plane 3 and closes password
registration. Local default (no flag): nothing changes (N1).

### 3.6 Client flows

**CLI — device flow** (client already shipped: `src/account/index.ts:228-330`)

```
nikcli auth login
  → POST /oauth/device/code            → { user_code, verification_url, interval }
  → print URL+code, open browser       → user approves at auth.nikcli.store/device
  → poll POST /oauth/device/token      → { access, refresh }
  → persist in account store (AccountRow: access_token/refresh_token/token_expiry)
  → hub requests attach Bearer access; auto-refresh via packages/auth client.ts
```

**Mobile — PKCE via `expo-auth-session`** (dep installed, unused; scheme `nikcli` already
in `app.json:9`): system browser → `/authorize` → redirect
`nikcli://auth/callback?code&state` → verify state → exchange → tokens in
expo-secure-store. Refresh lazily on foreground/401 (iOS background keychain caveat).

**Desktop — PKCE via system browser + Tauri deep link** (deep-link plugin + `nikcli`
scheme already registered in `src-tauri/tauri.conf.json`): Rust handler forwards
`auth/callback` payload to the webview; `account.tsx` exchanges code, stores
`{access, refresh, expires}` in the existing per-server persisted map.

**Studio / web SPAs — PKCE in browser**: callback route under the SPA; access token in
memory + localStorage, refresh rotation; pairing-token connect remains as secondary path
for self-hosted servers without an issuer.

### 3.7 Security posture

- PKCE S256 mandatory on every authorization-code flow; `state` verified before exchange.
- Refresh rotation with family reuse-detection (stolen-refresh mitigation).
- All persisted tokens hashed (SHA-256) issuer-side; clients store raw tokens in the most
  protected store available per platform (secure-store / chmod-600 files / Tauri fs).
- 15-min access TTL bounds revocation latency without introducing an introspection
  endpoint on the hot path (N2/N3). `/revoke` + family revocation covers logout.
- Rate limits (KV counters): device polls (honor `slow_down`), email codes per address,
  token exchanges per IP.
- Websocket `?token=` fallback stays; short TTL bounds log-leak exposure.

---

## 4. Implementation plan (workstreams → repo)

### W0 — `packages/auth` (verifier + client helper) — _prerequisite, zero behavior change_

Create the package per §3.4; migrate `packages/cloud/src/auth.ts` to consume it (first
verifier in production, proves parity). Typecheck via `bun run typecheck`.

### W1 — `packages/identity` (the issuer)

New Cloudflare Worker (Hono): D1 schema §3.1, KV for ephemeral state, endpoints §3.3,
GitHub + email-code providers, device flow matching `account/schema.ts`, JWKS + key
rotation, `wrangler.jsonc`. Donor code: `console/function/src/auth.ts` (account-linking
algorithm, OpenAuth wiring) — copied in, minus console-core coupling and the `@anoma.ly`
guard. Deploy `dev.auth.nikcli.store` (staging) → `auth.nikcli.store`.

### W2 — nikcli server (local + `s.nikcli.store` hub)

- Migration: `users.external_subject` (`src/user/users.sql.ts` + `src/database/migration/`).
- `UserDB.ensureExternalUser({ sub, email })` in `src/user/users.ts`.
- Global middleware `src/server/server.ts:289-344`: insert plane-1 JWT check (env
  `NIKCLI_AUTH_ISSUER`/`NIKCLI_AUTH_JWKS_URL`/`NIKCLI_AUTH_AUDIENCE`); mirror in the
  Effect bridge (`src/server/httpapi/users.ts`). Set the same `userSession` context shape.
- `NIKCLI_REQUIRE_OAUTH` in `src/flag/flag.ts` per §3.5.
- Curl-verify `/user/me` + one `/mobile/*` route with a real staging JWT against a live
  server before merge (bridge runtime-validation rule).

### W3 — clients (order: CLI → desktop/app → mobile → Studio)

- **CLI**: wire `src/account/index.ts` into `src/cli/cmd/auth.ts` (`nikcli auth login`);
  attach account access token in `src/sync/transport.ts` / `src/sync/remote-client.ts`
  when no explicit `NIKCLI_REMOTE_TOKEN` is configured.
- **Desktop/app**: deep-link `auth/callback` handling in
  `packages/desktop/src-tauri/src/lib.rs`; `loginWithOAuth()` in
  `packages/app/src/context/account.tsx`; refresh in `context/global-sdk.tsx`
  `authenticatedFetch`.
- **Mobile**: new `packages/mobile/lib/oauth.ts` (expo-auth-session PKCE);
  `app/login.tsx` primary button → OAuth, email/password demoted to fallback;
  token triple in `lib/storage.ts`; boot refresh in `lib/server-provider.tsx`.
  Verify on dev-client simulator (Expo Go lacks the native modules).
- **Studio**: `packages/web/src/dashboard/auth/AuthContext.tsx` `loginWithOAuth()` +
  callback page `packages/web/src/pages/dashboard/callback.astro`.

### W4 — consolidation & deprecation

- `packages/inference-dashboard`: drop bcrypt/`nik_session` credential code
  (`src/lib/auth.ts`, `api/auth/*`); session = issuer PKCE + cookie verified via
  `@nikcli-ai/auth`; API keys stay, owned by `accountID`.
- `packages/web` `/user/*` proxies → issuer-token exchange; `ARTIFACT_TOKEN_COOKIE`
  carries the JWT.
- `packages/console` app: point `app/src/context/auth.ts` client at the new issuer;
  retire `console/function/src/auth.ts`.
- Enable `NIKCLI_REQUIRE_OAUTH=1` on `s.nikcli.store`; `nku_` password login behind
  `NIKCLI_LEGACY_LOGIN=1` for one release, then remove login/register UI from clients
  (server code may stay for pure self-hosted mode).

Dependency graph (each step shippable, additive until the last):

```
W0 ──► W1 (staging) ──► W2 ──► W3.cli ──► W3.desktop ──► W3.mobile ──► W3.studio ──► W4
```

Commit at workstream boundaries; update this spec + `unified-auth.md` in the same commits.

---

## 5. Config matrix

| Var                                                                         | Where                            | Default                                               | Purpose                                           |
| --------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `NIKCLI_ACCOUNT_URL`                                                        | CLI (exists, `account/index.ts`) | `https://auth.nikcli.store`                           | issuer base                                       |
| `NIKCLI_AUTH_ISSUER` / `_JWKS_URL` / `_AUDIENCE`                            | nikcli server (new)              | issuer / `{iss}/.well-known/jwks.json` / `nikcli-api` | verifier config                                   |
| `NIKCLI_REQUIRE_OAUTH`                                                      | hosted hub                       | unset                                                 | enforce plane 1+2 only                            |
| `NIKCLI_LEGACY_LOGIN`                                                       | server                           | unset                                                 | keep `nku_` password login alive post-deprecation |
| `AUTH_ISSUER/AUDIENCE/JWKS_URL`                                             | cloud (exist)                    | —                                                     | point at same issuer                              |
| `IDENTITY_GITHUB_CLIENT_ID/SECRET`, `IDENTITY_EMAIL_SENDER`, D1/KV bindings | identity worker (new)            | —                                                     | issuer runtime                                    |

---

## 6. Testing & acceptance

- **W0 unit**: expired / wrong-aud / wrong-iss / skew / HS-fallback; refresh single-flight.
- **W1 integration (staging)**: shipped CLI device-flow client end-to-end; PKCE round
  trip; refresh rotation + family-reuse revocation; email-code login; JWKS rotation with
  in-flight tokens.
- **W2 matrix (bun test)**: `/user/me` + `/mobile/*` × {JWT valid, JWT expired, JWT
  wrong-aud, `nkm_`, `nku_`, none} × {local mode, `NIKCLI_REQUIRE_OAUTH=1`} — redirect
  test output to file (bun piped-output crash caveat).
- **W3 per client**: CLI login E2E on staging; packaged Tauri deep-link callback; mobile
  dev-client (login → deep-link → `userMe()` → kill/relaunch → session survives);
  Studio PKCE against staging hub.
- **Acceptance (R1)**: one account logs into CLI, mobile, desktop, and Studio against the
  same staging hub with no pasted tokens; local `nikcli` with no config still works
  offline (N1).

---

## 7. Risks & mitigations

1. **Device-flow contract drift** — the shipped CLI defines the wire shape
   (`account/schema.ts`); contract tests in W1 pin `DeviceCodeResponse`/`PollResult`.
2. **OpenAuth as a library** — if its authorize/session internals don't compose with the
   custom device flow + D1 model, fall back to plain Hono + `jose` + provider adapters
   (arctic-style); the endpoint surface (§3.3) is the stable contract either way.
3. **Email deliverability** — Cloudflare Email Service needs SPF/DKIM on nikcli.store;
   GitHub login is the fallback if email lags.
4. **Mobile background refresh** — refresh only on foreground/401; never in background
   tasks (iOS keychain access).
5. **Multi-hub trust** — single `aud` means one login works on every trusting hub;
   per-server roles stay local. If isolation is needed later, introduce per-hub `aud` —
   verifier already parameterized.
6. **SPA token storage** — localStorage accepted in v1 (15-min TTL); revisit with a
   cookie BFF on `packages/web` if Studio's admin surface grows.
