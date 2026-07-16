# Unified Auth — CLI · Mobile · Studio · Desktop · s.nikcli.store

Status: proposed (2026-07-16). Decision: **yes, build a shared OAuth — but don't invent one.**
Finish the OpenAuth issuer that already exists in `packages/console`, host it at
`auth.nikcli.store` (the domain the CLI code already targets), and turn every other
surface into either an OAuth client or a JWT resource server.

## 1. Current state (verified in code)

Four independent auth systems exist today:

| Surface | Mechanism | Key files |
|---|---|---|
| nikcli server (local + s.nikcli.store) | email/password → opaque `nku_` session tokens (SHA-256-hashed, SQLite/Drizzle); `nkm_` scoped pairing tokens (`mobile\|cli-sync\|studio`); Basic/Tailscale fallbacks | `src/user/users.ts`, `src/mobile/auth.ts`, `src/server/server.ts:289-344` |
| Studio (dashboard in `packages/web`) | pastes an `nkm_` pairing token, or legacy email/password → `nku_`; no identity of its own | `packages/web/src/dashboard/auth/AuthContext.tsx`, `lib/studio-api.ts` |
| Mobile | `/user/login` email/password → `nku_` bearer in expo-secure-store; pairing token fallback | `packages/mobile/app/login.tsx`, `lib/client.ts`, `lib/storage.ts` |
| Desktop/app | same `nku_` per-server tokens via account context | `packages/app/src/context/account.tsx`, `context/global-sdk.tsx` |
| inference-dashboard | its own bcrypt + `nik_session` cookie on D1 | `packages/inference-dashboard/src/lib/auth.ts` |
| packages/cloud | **JWT resource server** — `jose` + JWKS (`AUTH_JWKS_URL`, issuer/audience), lazy `ensureUser` provisioning into D1 | `packages/cloud/src/auth.ts` |
| packages/console | **OpenAuth issuer** — GitHub provider, KV storage, account/user/workspace/billing Drizzle models | `packages/console/function/src/auth.ts`, `core/src/schema/*` |

Pieces of the target design that already exist:

- RFC 8628 **device-flow client** in the CLI against `https://auth.nikcli.store`
  (`src/account/index.ts:228-330`, `client_id: "nikcli"`).
- **refresh_token flow** against `auth.nikcli.store/oauth/token` (`src/auth/index.ts:390-437`),
  with `enterpriseUrl` override and `/.well-known/nikcli` discovery for self-hosted issuers.
- `@openauthjs/openauth` is already a dependency of both `packages/nikcli` and `packages/console`.
- `nikcli://` scheme registered on mobile (`packages/mobile/app.json:9`) and desktop
  (Tauri deep-link plugin, `src-tauri/tauri.conf.json`); `expo-auth-session` installed but unused.
- s.nikcli.store is the same nikcli server deployed as sync hub; it already accepts
  bearer tokens through one global middleware — a single choke point to extend.

## 2. Target architecture

One central identity provider, everything else standardized on two roles:

```
                 ┌──────────────────────────────────┐
                 │  auth.nikcli.store (OpenAuth,     │
                 │  CF Worker + KV; users/accounts   │
                 │  in console Drizzle DB)           │
                 │  providers: GitHub, email+code/pw │
                 └───────┬──────────────┬───────────┘
        issues JWT access (≤1h) + refresh tokens; publishes JWKS
                        │              │
        ┌───────────────┴───┐      ┌───┴──────────────────────────┐
        │ OAuth clients      │      │ Resource servers (verify JWT │
        │ (public, PKCE)     │      │ offline via JWKS, jose)      │
        ├────────────────────┤      ├──────────────────────────────┤
        │ CLI    device flow │      │ nikcli server @ s.nikcli.store│
        │ Mobile PKCE + deep │      │ packages/cloud (già fatto)   │
        │        link        │      │ packages/web API endpoints   │
        │ Desktop PKCE + deep│      │ inference-dashboard API      │
        │        link        │      └──────────────────────────────┘
        │ Studio PKCE (SPA)  │
        └────────────────────┘
```

- **Issuer**: extend `packages/console/function/src/auth.ts`. Add the email
  code/password provider (scaffolding is already commented out there) alongside GitHub.
  Configure it to issue **JWT access tokens** (short-lived, 15m–1h) + refresh tokens.
  Claims: `sub` (account id), `email`, optional `workspace`/`scopes`.
- **Verification**: the `packages/cloud/src/auth.ts` pattern (jose + `createRemoteJWKSet`,
  cached; `AUTH_ISSUER`/`AUTH_AUDIENCE`) is the template. Extract it into a small shared
  package (`packages/auth` or `packages/util/auth`) so nikcli server, cloud, web, and
  inference-dashboard all use the same verifier. Verification is offline (no per-request
  call to the issuer) — important for the CLI's embedded server.
- **Identity mapping on the nikcli server**: in the global middleware
  (`server.ts:289-344`) accept a third credential type: valid JWT from
  `auth.nikcli.store` → lazily provision/link a row in the local `users` table keyed by
  `sub` (same `ensureUser` pattern as cloud). Existing `nku_`/`nkm_` checks stay.
- **Device flow**: the CLI client half already exists; the issuer must expose
  `POST /oauth/device/code` + `POST /oauth/device/token`. If OpenAuth's shipped grant
  set doesn't include RFC 8628, implement those two endpoints on the same worker (KV
  makes the pending-authorization store trivial) — the CLI's request/poll shapes in
  `src/account/schema.ts` define the contract.

### Per-client login flows

| Client | Flow | Notes |
|---|---|---|
| CLI (`nikcli auth login` / account) | Device flow (già implementato client-side); PKCE+localhost loopback come fallback | token → `Global.Path.data` come oggi |
| Mobile | `expo-auth-session` (già installato) authorization-code + PKCE, redirect `nikcli://auth/callback` | sostituisce la login screen email/password; token in expo-secure-store |
| Desktop | apre il browser di sistema, callback via Tauri deep-link `nikcli://auth/callback` | `account.tsx` conserva la stessa forma `{token, user}` |
| Studio / web | authorization-code + PKCE da SPA (o cookie di sessione impostato dai proxy `packages/web/src/pages/user/*`) | rimuove il paste del token `nkm_` come flusso primario |

### What stays

- **Local/offline mode is sacred**: a localhost nikcli server with no password
  configured keeps today's behavior (no account required). OAuth is required only on
  hosted/shared deployments (s.nikcli.store) — gate with the existing
  `_mobileAuthRequired`-style flag (e.g. `NIKCLI_REQUIRE_OAUTH=1` on the hub).
- **`nkm_` scoped tokens survive** as machine-to-machine credentials (device pairing,
  `nikcli sync token create`, teleport target tokens). They're per-server capabilities,
  not identities — no reason to force them through OAuth.
- **LLM-provider auth (`auth.json`)** is untouched; it's a separate concern.
- **Self-hosted/enterprise**: `enterpriseUrl` + `/.well-known/nikcli` discovery already
  let an org point all clients at its own issuer; keep that contract.

## 3. Rejected alternatives

- **Keep `nku_` everywhere and sync user tables** — no SSO, N user databases, every new
  service re-implements login; Studio's synthetic identity shows the model is at its limit.
- **better-auth / Auth.js as issuer** — fine libraries, but you'd discard the working
  OpenAuth issuer, KV storage, console account/workspace/billing models, and the CLI
  device-flow client that all target this design already.
- **Clerk/Auth0** — least work but an external dependency in the middle of a product
  whose selling point includes self-hosting; conflicts with `enterpriseUrl` discovery.

## 4. Phases

1. **P0 — shared verifier**: extract JWKS/JWT middleware from `packages/cloud/src/auth.ts`
   into a shared package; define the claim set and `aud` values (`nikcli-api`).
2. **P1 — issuer**: productionize `console/function/src/auth.ts` at `auth.nikcli.store`
   (GitHub + email provider, JWT access tokens, refresh, JWKS endpoint, device-flow
   endpoints matching `src/account/schema.ts`).
3. **P2 — server**: nikcli server middleware accepts issuer JWTs + lazy user linking;
   enable `NIKCLI_REQUIRE_OAUTH` on the s.nikcli.store deploy.
4. **P3 — clients**: CLI (wire existing `account/index.ts` into `nikcli auth login`),
   desktop/app (`account.tsx` → PKCE + deep link), mobile (`expo-auth-session`),
   Studio (PKCE, drop token-paste as primary).
5. **P4 — consolidation**: inference-dashboard and `packages/web` user proxies switch to
   issuer sessions; retire duplicated bcrypt/cookie code; keep `nku_` login as a
   deprecated fallback for one release cycle.

## 5. Verification

- Issuer: `curl https://auth.nikcli.store/.well-known/jwks.json`; full device-flow
  round-trip from `nikcli auth login` against a staging issuer.
- Server: integration test hitting `/mobile/*` and `/user/me` with (a) `nku_`,
  (b) `nkm_`, (c) issuer JWT — all three must resolve an identity; expired/wrong-aud
  JWT must 401.
- Mobile: dev-client on simulator (Expo Go lacks the native modules) — login via
  browser, deep-link return, `userMe()` succeeds, token survives app restart.
- Desktop: `nikcli://auth/callback` deep link completes login in the Tauri build.
- Studio: login from `packages/web` dashboard against staging hub without pasting tokens.
