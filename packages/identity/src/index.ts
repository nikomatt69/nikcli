import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import {
  ACCESS_TTL_SECONDS,
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  isAllowedRedirect,
  isClientID,
} from "./constants"
import { randomDigits, randomToken, secureEqual, sha256 } from "./crypto"
import {
  consumeDeviceCode,
  createDeviceCode,
  getDeviceCode,
  hashDeviceCode,
  listPublicSigningKeys,
  markDevicePolled,
  revokeRefreshByHash,
} from "./database"
import { bearerToken, HttpError, noStore, oauthError, readForm, readJson, requestIP } from "./http"
import {
  beginDeviceApproval,
  createLoginState,
  finishGitHub,
  requestEmailCode,
  startGitHub,
  verifyEmailCode,
} from "./login"
import { consumeRateLimit } from "./rate-limit"
import { issueTokenPair, refreshTokenPair, verifyAccessToken } from "./tokens"
import type { AuthCode, DeviceCodeRow } from "./types"
import { devicePage, loginPage } from "./ui"

type AppEnv = { Bindings: Env }
const app = new Hono<AppEnv>()

function formRecord(form: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {}
  form.forEach((value, key) => {
    result[key] = value
  })
  return result
}

const allowedOrigins = new Set([
  "https://nikcli.store",
  "https://console.nikcli.store",
  "tauri://localhost",
  "http://tauri.localhost",
])

app.use(
  "*",
  cors({
    origin(origin) {
      return allowedOrigins.has(origin) || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) ? origin : null
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
)

app.use("*", async (c, next) => {
  await next()
  if (c.req.path !== "/.well-known/jwks.json") noStore(c.res)
  c.res.headers.set("X-Content-Type-Options", "nosniff")
  c.res.headers.set("Referrer-Policy", "no-referrer")
})

app.onError((error, c) => {
  const status = error instanceof HttpError ? error.status : 500
  console.error(
    JSON.stringify({
      message: "identity request failed",
      method: c.req.method,
      path: c.req.path,
      status,
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  return c.json(
    {
      error: status < 500 ? "invalid_request" : "server_error",
      error_description: status < 500 ? error.message : "The identity service could not complete the request",
    },
    status as 400,
  )
})

app.get("/health", (c) => c.json({ status: "ok", service: "nikcli-identity" }))

app.get("/authorize", async (c) => {
  const responseType = c.req.query("response_type")
  const clientID = c.req.query("client_id") ?? ""
  const redirectURI = c.req.query("redirect_uri") ?? ""
  const state = c.req.query("state") ?? ""
  const challenge = c.req.query("code_challenge") ?? ""
  const challengeMethod = c.req.query("code_challenge_method")
  if (responseType !== "code") return oauthError(c, "unsupported_response_type", "response_type must be code")
  if (!isClientID(clientID)) return oauthError(c, "invalid_client", "Unknown public client")
  if (!isAllowedRedirect(clientID, redirectURI))
    return oauthError(c, "invalid_request", "redirect_uri is not registered")
  if (!state || state.length > 512) return oauthError(c, "invalid_request", "state is required")
  if (challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return oauthError(c, "invalid_request", "PKCE S256 is required")
  }
  const loginState = await createLoginState(c.env, {
    kind: "authorize",
    clientID,
    redirectURI,
    state,
    scope: c.req.query("scope") ?? "openid profile email offline_access",
    codeChallenge: challenge,
  })
  return loginPage(c, loginState)
})

app.get("/login/github", startGitHub)
app.get("/callback/github", finishGitHub)
app.post("/login/email/request", requestEmailCode)
app.post("/login/email/verify", verifyEmailCode)

app.get("/device", (c) => devicePage(c, c.req.query("user_code")))
app.post("/device", beginDeviceApproval)

app.post("/oauth/device/code", async (c) => {
  const rate = await consumeRateLimit(c.env.STATE, "device-start", requestIP(c.req.raw), 20, 60)
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfter))
    return c.json({ error: "rate_limited" }, 429)
  }
  const body = await readJson(c.req.raw)
  const clientID = typeof body.client_id === "string" ? body.client_id : ""
  if (!isClientID(clientID)) return oauthError(c, "invalid_client", "Unknown public client")
  const deviceCode = randomToken(48)
  const userDigits = randomDigits(8)
  const userCode = `${userDigits.slice(0, 4)}-${userDigits.slice(4)}`
  const now = Date.now()
  const row: DeviceCodeRow = {
    device_code_hash: await hashDeviceCode(deviceCode),
    user_code: userCode,
    client_id: clientID,
    scope: typeof body.scope === "string" ? body.scope : "openid profile email offline_access",
    status: "pending",
    account_id: null,
    expires_at: now + DEVICE_CODE_TTL_SECONDS * 1000,
    last_poll_at: null,
    created_at: now,
  }
  await createDeviceCode(c.env.DB, row)
  const verificationURL = new URL("/device", c.env.ISSUER).toString()
  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_url: verificationURL,
    verification_uri_complete: `${verificationURL}?user_code=${encodeURIComponent(userCode)}`,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
    expires_in: DEVICE_CODE_TTL_SECONDS,
  })
})

async function pollDevice(c: Context<AppEnv>, provided?: Record<string, unknown>) {
  const body =
    provided ??
    (c.req.header("content-type")?.startsWith("application/json")
      ? await readJson(c.req.raw)
      : formRecord(await readForm(c.req.raw)))
  const clientID = typeof body.client_id === "string" ? body.client_id : ""
  const deviceCode = typeof body.device_code === "string" ? body.device_code : ""
  if (!isClientID(clientID) || !deviceCode) return c.json({ status: "expired" })
  const hash = await hashDeviceCode(deviceCode)
  const row = await getDeviceCode(c.env.DB, hash)
  const now = Date.now()
  if (!row || row.client_id !== clientID || row.expires_at <= now || row.status === "consumed") {
    return c.json({ status: "expired" })
  }
  if (row.status === "denied") return c.json({ status: "denied" })
  if (row.status === "pending") {
    const tooFast = row.last_poll_at !== null && now - row.last_poll_at < DEVICE_POLL_INTERVAL_SECONDS * 1000
    await markDevicePolled(c.env.DB, hash, now)
    return c.json(
      tooFast
        ? { status: "slow_down", interval: DEVICE_POLL_INTERVAL_SECONDS + 5 }
        : { status: "pending", interval: DEVICE_POLL_INTERVAL_SECONDS },
    )
  }
  if (!row.account_id || !(await consumeDeviceCode(c.env.DB, hash, now))) return c.json({ status: "expired" })
  return c.json({
    status: "success",
    ...(await issueTokenPair(c.env, row.account_id, row.client_id, now)),
  })
}

app.post("/oauth/device/token", (c) => pollDevice(c))

async function exchangeToken(c: Context<AppEnv>) {
  const rate = await consumeRateLimit(c.env.STATE, "token", requestIP(c.req.raw), 60, 60)
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfter))
    return oauthError(c, "temporarily_unavailable", "Too many token requests", 429)
  }
  const form = await readForm(c.req.raw)
  const grantType = form.get("grant_type")
  if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
    return pollDevice(c, formRecord(form))
  }
  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token") ?? ""
    const requested = form.get("client_id") ?? ""
    if (!refreshToken || (requested && !isClientID(requested))) {
      return oauthError(c, "invalid_request", "Valid refresh_token and client_id are required")
    }
    const pair = await refreshTokenPair(c.env, refreshToken, requested && isClientID(requested) ? requested : undefined)
    return pair ? c.json(pair) : oauthError(c, "invalid_grant", "Refresh token is invalid or reused")
  }
  if (grantType !== "authorization_code") {
    return oauthError(c, "unsupported_grant_type", "Unsupported grant_type")
  }
  const code = form.get("code") ?? ""
  const verifier = form.get("code_verifier") ?? ""
  const clientID = form.get("client_id") ?? ""
  const redirectURI = form.get("redirect_uri") ?? ""
  if (!code || !verifier || !isClientID(clientID)) {
    return oauthError(c, "invalid_request", "code, code_verifier, and client_id are required")
  }
  const key = `authcode:${await sha256(code)}`
  const authorization = await c.env.STATE.get<AuthCode>(key, "json")
  if (!authorization) return oauthError(c, "invalid_grant", "Authorization code is invalid or expired")
  const challenge = await sha256(verifier)
  if (
    authorization.clientID !== clientID ||
    authorization.redirectURI !== redirectURI ||
    !(await secureEqual(challenge, authorization.codeChallenge))
  ) {
    return oauthError(c, "invalid_grant", "Authorization code binding or PKCE validation failed")
  }
  await c.env.STATE.delete(key)
  return c.json(await issueTokenPair(c.env, authorization.accountID, authorization.clientID))
}

app.post("/token", exchangeToken)
app.post("/oauth/token", exchangeToken)

app.post("/revoke", async (c) => {
  const form = await readForm(c.req.raw)
  const token = form.get("token")
  if (token) await revokeRefreshByHash(c.env.DB, await sha256(token), Date.now())
  return new Response(null, { status: 200 })
})

app.get("/userinfo", async (c) => {
  const token = bearerToken(c.req.raw)
  if (!token) return oauthError(c, "invalid_token", "Bearer access token is required", 401)
  const identity = await verifyAccessToken(c.env, token)
  if (!identity) return oauthError(c, "invalid_token", "Access token is invalid or expired", 401)
  return c.json({
    id: identity.account.id,
    sub: identity.account.id,
    email: identity.account.email,
    created_at: identity.account.created_at,
    updated_at: identity.account.updated_at,
  })
})

app.get("/.well-known/jwks.json", async (c) => {
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
  return c.json({ keys: await listPublicSigningKeys(c.env.DB) })
})

app.get("/.well-known/oauth-authorization-server", (c) =>
  c.json({
    issuer: c.env.ISSUER,
    authorization_endpoint: new URL("/authorize", c.env.ISSUER).toString(),
    token_endpoint: new URL("/token", c.env.ISSUER).toString(),
    revocation_endpoint: new URL("/revoke", c.env.ISSUER).toString(),
    device_authorization_endpoint: new URL("/oauth/device/code", c.env.ISSUER).toString(),
    userinfo_endpoint: new URL("/userinfo", c.env.ISSUER).toString(),
    jwks_uri: new URL("/.well-known/jwks.json", c.env.ISSUER).toString(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    access_token_ttl: ACCESS_TTL_SECONDS,
  }),
)

app.get("/.well-known/nikcli/issuer", (c) => c.text(c.env.ISSUER))
app.get("/.well-known/nikcli", (c) =>
  c.json({
    issuer: c.env.ISSUER,
    authorization_endpoint: new URL("/authorize", c.env.ISSUER).toString(),
    token_endpoint: new URL("/oauth/token", c.env.ISSUER).toString(),
    device_authorization_endpoint: new URL("/oauth/device/code", c.env.ISSUER).toString(),
    device_token_endpoint: new URL("/oauth/device/token", c.env.ISSUER).toString(),
    jwks_uri: new URL("/.well-known/jwks.json", c.env.ISSUER).toString(),
    auth: {
      command: ["curl", "-fsS", new URL("/.well-known/nikcli/issuer", c.env.ISSUER).toString()],
      env: "NIKCLI_ACCOUNT_URL",
    },
  }),
)

export default app
