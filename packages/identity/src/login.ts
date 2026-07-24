import type { Context } from "hono"
import { AUTH_CODE_TTL_SECONDS, EMAIL_CODE_TTL_SECONDS, LOGIN_STATE_TTL_SECONDS } from "./constants"
import { randomDigits, randomToken, secureEqual, sha256 } from "./crypto"
import { linkAccount, setDeviceDecision } from "./database"
import { HttpError, readForm } from "./http"
import { consumeRateLimit } from "./rate-limit"
import type { AuthCode, EmailChallenge, LoginIntent } from "./types"
import { emailCodePage, loginPage, resultPage } from "./ui"

type AppContext = Context<{ Bindings: Env }>

type GitHubEmail = { email?: unknown; primary?: unknown; verified?: unknown }
type GitHubUser = { id?: unknown }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The absolute `redirect_uri` we send to GitHub. GitHub's OAuth app
 * ("Authorization callback URL") performs an exact string match against this
 * value, so the configured callback MUST be registered there verbatim —
 * mismatches surface as GitHub's "The redirect_uri is not associated with
 * this application" error and break sign-in completely.
 *
 * The default is `${ISSUER}/callback/github`, which matches the route
 * registered below in `index.ts`. Operators can override with the
 * `GITHUB_REDIRECT_URI` env var when the registered URL differs (for
 * example, a tenant-scoped subdomain or a path-prefixed deployment).
 */
export function githubRedirectURI(env: { ISSUER: string; GITHUB_REDIRECT_URI?: string }): string {
  return env.GITHUB_REDIRECT_URI?.trim() || new URL("/callback/github", env.ISSUER).toString()
}

/**
 * Short-circuit `/login/github` and `/callback/github` with a 503 page when the
 * GitHub OAuth app credentials are not configured. Without this guard, sending
 * a user to GitHub with an empty `client_id` lets the round-trip complete and
 * then fails inside the token exchange with a generic 500 — far worse than
 * telling the operator (or a visiting user) that the issuer is misconfigured.
 */
function requireGitHubCredentials(c: AppContext): Response | null {
  const id = c.env.GITHUB_CLIENT_ID
  const secret = c.env.GITHUB_CLIENT_SECRET
  if (!id || !secret) {
    return resultPage(
      c,
      "Sign-in unavailable",
      "GitHub sign-in is not configured on this issuer. Contact the operator.",
      503,
    )
  }
  return null
}

function loginKey(state: string): string {
  return `login:${state}`
}

function emailKey(state: string): string {
  return `email:${state}`
}

/**
 * Short-lived pointer to the redirect a completed login already issued.
 * The hosted login pages are pure HTML with no script-src in their CSP
 * (by design), so a mistimed OTP autofill plus a manual tap on "Verify and
 * continue" can fire several near-simultaneous submits of the same form.
 * Only the first submit finds the login intent; without this cache the
 * rest would race it to "Session expired" instead of just replaying the
 * same redirect the first submit already produced.
 */
function completedKey(state: string): string {
  return `completed:${state}`
}
const COMPLETED_REPLAY_TTL_SECONDS = 60

export async function createLoginState(env: Env, intent: LoginIntent): Promise<string> {
  const state = randomToken(32)
  await env.STATE.put(loginKey(state), JSON.stringify(intent), {
    expirationTtl: LOGIN_STATE_TTL_SECONDS,
  })
  return state
}

async function loadIntent(env: Env, state: string): Promise<LoginIntent | null> {
  return env.STATE.get<LoginIntent>(loginKey(state), "json")
}

async function completeLogin(c: AppContext, loginState: string, accountID: string): Promise<Response> {
  const intent = await loadIntent(c.env, loginState)
  if (!intent) {
    const replay = await c.env.STATE.get(completedKey(loginState))
    if (replay) return c.redirect(replay, 302)
    return resultPage(c, "Session expired", "Start the sign-in flow again.", 400)
  }
  await c.env.STATE.delete(loginKey(loginState))
  await c.env.STATE.delete(emailKey(loginState))

  if (intent.kind === "device") {
    const approved = await setDeviceDecision(c.env.DB, intent.userCode, "approved", accountID, Date.now())
    if (!approved) return resultPage(c, "Device code expired", "Return to the terminal and start sign-in again.", 400)
    return resultPage(c, "Device connected", "You can close this window and return to your terminal.")
  }

  const code = randomToken(32)
  const payload: AuthCode = {
    accountID,
    clientID: intent.clientID,
    redirectURI: intent.redirectURI,
    scope: intent.scope,
    codeChallenge: intent.codeChallenge,
  }
  await c.env.STATE.put(`authcode:${await sha256(code)}`, JSON.stringify(payload), {
    expirationTtl: AUTH_CODE_TTL_SECONDS,
  })
  const redirect = new URL(intent.redirectURI)
  redirect.searchParams.set("code", code)
  redirect.searchParams.set("state", intent.state)
  await c.env.STATE.put(completedKey(loginState), redirect.toString(), {
    expirationTtl: COMPLETED_REPLAY_TTL_SECONDS,
  })
  return c.redirect(redirect.toString(), 302)
}

export async function startGitHub(c: AppContext): Promise<Response> {
  const unavailable = requireGitHubCredentials(c)
  if (unavailable) return unavailable
  const loginState = c.req.query("login_state") ?? ""
  if (!(await loadIntent(c.env, loginState)))
    return resultPage(c, "Session expired", "Start the sign-in flow again.", 400)
  const callback = githubRedirectURI(c.env)
  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID)
  url.searchParams.set("redirect_uri", callback)
  url.searchParams.set("scope", "read:user user:email")
  url.searchParams.set("state", loginState)
  return c.redirect(url.toString(), 302)
}

export async function finishGitHub(c: AppContext): Promise<Response> {
  const unavailable = requireGitHubCredentials(c)
  if (unavailable) return unavailable

  const loginState = c.req.query("state") ?? ""
  const code = c.req.query("code") ?? ""
  if (!code || !(await loadIntent(c.env, loginState)))
    return resultPage(c, "Sign-in failed", "The GitHub sign-in session is invalid or expired.", 400)

  const callback = githubRedirectURI(c.env)
  const exchange = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callback,
    }),
  })
  if (!exchange.ok) {
    return resultPage(
      c,
      "Sign-in failed",
      `GitHub rejected the authorization code (${exchange.status}). Start the sign-in flow again.`,
      502,
    )
  }
  const tokenBody = (await exchange.json()) as {
    access_token?: unknown
    error?: unknown
    error_description?: unknown
  }
  if (typeof tokenBody.access_token !== "string") {
    const detail =
      typeof tokenBody.error_description === "string" && tokenBody.error_description.length > 0
        ? ` GitHub says: ${tokenBody.error_description}.`
        : ""
    return resultPage(
      c,
      "Sign-in failed",
      `GitHub did not issue an access token.${detail} Start the sign-in flow again.`,
      502,
    )
  }

  const headers = {
    Authorization: `Bearer ${tokenBody.access_token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "nikcli-identity",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const [userResponse, emailResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ])
  if (!userResponse.ok || !emailResponse.ok) {
    // Surface the actual upstream status + WWW-Authenticate hint so the
    // operator can distinguish "GitHub denied the token" (401 / 403),
    // "GitHub rate-limited us" (403 with rate-limit headers), or "GitHub
    // API outage" (5xx). Without this, every call looked identical to the
    // user (and to wrangler tail) as a generic "GitHub profile request
    // failed" 502.
    const userHint = userResponse.ok ? null : userResponse.headers.get("x-oauth-scopes")
    const userReset = userResponse.ok ? null : userResponse.headers.get("x-ratelimit-reset")
    const emailHint = emailResponse.ok ? null : emailResponse.headers.get("x-oauth-scopes")
    console.error(
      JSON.stringify({
        message: "github profile request failed",
        path: c.req.path,
        user: {
          status: userResponse.status,
          scopes: userHint,
          reset: userReset,
        },
        emails: { status: emailResponse.status, scopes: emailHint },
      }),
    )
    const detail =
      `GitHub did not return the profile (user=${userResponse.status}, emails=${emailResponse.status}). ` +
      (userResponse.status === 401 || userResponse.status === 403
        ? "The OAuth token was rejected — check the GitHub OAuth app's scopes and that the secret matches the deployed one. "
        : userResponse.status === 429 || (userReset !== null && Number(userReset) * 1000 > Date.now() + 60_000)
          ? "GitHub rate-limited the request — try again in a minute. "
          : "") +
      "Try again in a moment."
    return resultPage(c, "Sign-in failed", detail, 502)
  }
  const user = (await userResponse.json()) as GitHubUser
  const emails = (await emailResponse.json()) as GitHubEmail[]
  const primary = emails.find((item) => item.primary === true)
  if (!primary || primary.verified !== true || typeof primary.email !== "string") {
    return resultPage(c, "Verified email required", "Verify your primary email on GitHub, then try again.", 400)
  }
  if ((typeof user.id !== "number" && typeof user.id !== "string") || !String(user.id)) {
    return resultPage(c, "Sign-in failed", "GitHub returned a profile without an id. Try again in a moment.", 502)
  }
  const account = await linkAccount(c.env.DB, "github", String(user.id), primary.email)
  return completeLogin(c, loginState, account.id)
}

export async function requestEmailCode(c: AppContext): Promise<Response> {
  const form = await readForm(c.req.raw)
  const loginState = form.get("login_state") ?? ""
  const email = (form.get("email") ?? "").trim().toLowerCase()
  if (!(await loadIntent(c.env, loginState)))
    return resultPage(c, "Session expired", "Start the sign-in flow again.", 400)
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return loginPage(c, loginState, "Enter a valid email address.")

  const rate = await consumeRateLimit(c.env.STATE, "email", email, 3, 60 * 60)
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfter))
    return resultPage(c, "Try again later", "Too many email codes were requested for this address.", 429)
  }

  const code = randomDigits(6)
  const nonce = randomToken(16)
  const challenge: EmailChallenge = {
    email,
    nonce,
    codeHash: await sha256(`${nonce}:${code}`),
    attempts: 0,
  }
  await c.env.STATE.put(emailKey(loginState), JSON.stringify(challenge), {
    expirationTtl: EMAIL_CODE_TTL_SECONDS,
  })
  await c.env.EMAIL.send({
    to: email,
    from: { email: c.env.EMAIL_SENDER, name: "NikCLI" },
    subject: `${code} is your NikCLI sign-in code`,
    text: `Your NikCLI sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
    html: `<p>Your NikCLI sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em">${code}</p><p>It expires in 10 minutes. If you did not request this code, ignore this email.</p>`,
  })
  return emailCodePage(c, loginState, email)
}

export async function verifyEmailCode(c: AppContext): Promise<Response> {
  const form = await readForm(c.req.raw)
  const loginState = form.get("login_state") ?? ""
  const code = (form.get("code") ?? "").trim()
  const challenge = await c.env.STATE.get<EmailChallenge>(emailKey(loginState), "json")
  if (!challenge || !(await loadIntent(c.env, loginState))) {
    // A prior submit for this same login_state may have already verified the
    // code and consumed both KV entries — replay its redirect instead of
    // telling a merely-late duplicate request its code is expired.
    const replay = await c.env.STATE.get(completedKey(loginState))
    if (replay) return c.redirect(replay, 302)
    return resultPage(c, "Code expired", "Request a new sign-in code.", 400)
  }

  challenge.attempts += 1
  if (challenge.attempts > 5) {
    await c.env.STATE.delete(emailKey(loginState))
    return resultPage(c, "Too many attempts", "Start the sign-in flow again.", 429)
  }
  await c.env.STATE.put(emailKey(loginState), JSON.stringify(challenge), {
    expirationTtl: EMAIL_CODE_TTL_SECONDS,
  })
  const providedHash = await sha256(`${challenge.nonce}:${code}`)
  if (!(await secureEqual(providedHash, challenge.codeHash)))
    return emailCodePage(c, loginState, challenge.email, "That code is not valid. Try again.")

  const account = await linkAccount(c.env.DB, "email", challenge.email, challenge.email)
  return completeLogin(c, loginState, account.id)
}

export async function beginDeviceApproval(c: AppContext): Promise<Response> {
  const form = await readForm(c.req.raw)
  const userCode = (form.get("user_code") ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  const formatted = userCode.length === 8 ? `${userCode.slice(0, 4)}-${userCode.slice(4)}` : userCode
  const decision = form.get("decision")
  const row = await c.env.DB.prepare("SELECT status, expires_at FROM device_codes WHERE user_code = ?")
    .bind(formatted)
    .first<{ status: string; expires_at: number }>()
  if (!row || row.expires_at <= Date.now() || row.status !== "pending")
    return resultPage(c, "Invalid device code", "Check the code in your terminal or start sign-in again.", 400)
  if (decision === "deny") {
    await setDeviceDecision(c.env.DB, formatted, "denied", null, Date.now())
    return resultPage(c, "Device denied", "The terminal was not authorized.")
  }
  if (decision !== "approve") throw new HttpError(400, "invalid decision")
  const loginState = await createLoginState(c.env, {
    kind: "device",
    userCode: formatted,
  })
  return loginPage(c, loginState)
}
