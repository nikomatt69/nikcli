import type { Context } from "hono"
import {
  AUTH_CODE_TTL_SECONDS,
  DEVICE_APPROVAL_LIMIT,
  DEVICE_APPROVAL_WINDOW_SECONDS,
  EMAIL_CODE_BURST_LIMIT,
  EMAIL_CODE_BURST_WINDOW_SECONDS,
  EMAIL_CODE_HOURLY_LIMIT,
  EMAIL_CODE_HOURLY_WINDOW_SECONDS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_SECONDS,
  LOGIN_STATE_TTL_SECONDS,
} from "./constants"
import { randomDigits, randomToken, secureEqual, sha256 } from "./crypto"
import { countPasskeys, getDeviceByUserCode, linkAccount, setDeviceDecision } from "./database"
import { HttpError, readForm, requestIP } from "./http"
import { consumeRateLimit } from "./rate-limit"
import type { AuthCode, EmailChallenge, LoginIntent, PasskeyOffer } from "./types"
import { devicePage, emailCodePage, loginPage, passkeyOfferPage, resultPage } from "./ui"

type AppContext = Context<{ Bindings: Env }>

type GitHubEmail = { email?: unknown; primary?: unknown; verified?: unknown }
type GitHubUser = { id?: unknown }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Codes travel through email clients, clipboards, and OTP autofill, so what
 * arrives in the form is routinely `123 456`, `1234-5678`, a non-breaking
 * space, or a trailing newline. Everything the user can plausibly submit
 * reduces to its digits; anything else was never a code.
 */
function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "")
}

/** `12345678`, `1234 5678`, `1234-5678` → `1234-5678`; anything else → "". */
export function normalizeUserCode(value: string): string {
  const digits = digitsOnly(value)
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : ""
}

function formatDuration(seconds: number): string {
  if (seconds >= 90) return `${Math.ceil(seconds / 60)} minutes`
  return `${Math.max(1, Math.ceil(seconds))} seconds`
}

/**
 * KV rejects a TTL under 60s, so a code with less than a minute left is stored
 * for the minimum — `expiresAt` on the challenge stays authoritative for
 * whether it is still usable.
 */
function remainingTtl(expiresAt: number, now = Date.now()): number {
  return Math.max(60, Math.ceil((expiresAt - now) / 1000))
}

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

/**
 * A device login has no redirect to replay, so its completion marker is this
 * sentinel and the replay re-renders the same "connected" page.
 */
const DEVICE_COMPLETED_MARKER = "device"

function deviceConnectedPage(c: AppContext): Response {
  return resultPage(c, "Device connected", "You can close this window and return to your terminal.")
}

/**
 * Re-serve whatever a completed login already produced. Every duplicate submit
 * of the same `login_state` — autofill racing a tap, a double-tap, a browser
 * retry — reaches here after the first one consumed the intent, and telling
 * those "session expired" when the sign-in actually succeeded is the single
 * most confusing failure this flow can produce.
 */
async function replayCompleted(c: AppContext, loginState: string): Promise<Response | null> {
  if (!loginState) return null
  const replay = await c.env.STATE.get(completedKey(loginState))
  if (!replay) return null
  return replay === DEVICE_COMPLETED_MARKER ? deviceConnectedPage(c) : c.redirect(replay, 302)
}

export async function createLoginState(env: Env, intent: LoginIntent): Promise<string> {
  const state = randomToken(32)
  await env.STATE.put(loginKey(state), JSON.stringify(intent), {
    expirationTtl: LOGIN_STATE_TTL_SECONDS,
  })
  return state
}

export async function loadLoginIntent(env: Env, state: string): Promise<LoginIntent | null> {
  if (!state) return null
  return env.STATE.get<LoginIntent>(loginKey(state), "json")
}

function passkeyOfferKey(state: string): string {
  return `passkey-offer:${state}`
}

export type FinalizeLoginResult = { kind: "redirect"; url: string } | { kind: "device" }

/**
 * Consume the login intent and issue the authorize redirect or device
 * approval. HTML handlers turn this into a page via `completeLogin`; JSON
 * passkey verify endpoints return the same side effects as `{ redirect }` or
 * `{ ok, device }`.
 */
export async function finalizeLogin(
  c: AppContext,
  loginState: string,
  accountID: string,
): Promise<FinalizeLoginResult> {
  const intent = await loadLoginIntent(c.env, loginState)
  if (!intent) {
    const replay = await c.env.STATE.get(completedKey(loginState))
    if (replay === DEVICE_COMPLETED_MARKER) return { kind: "device" }
    if (replay) return { kind: "redirect", url: replay }
    throw new HttpError(400, "Session expired")
  }
  await c.env.STATE.delete(loginKey(loginState))
  await c.env.STATE.delete(emailKey(loginState))
  await c.env.STATE.delete(`passkey:auth:${loginState}`)
  await c.env.STATE.delete(`passkey:reg:${loginState}`)
  await c.env.STATE.delete(passkeyOfferKey(loginState))

  if (intent.kind === "device") {
    const approved = await setDeviceDecision(c.env.DB, intent.userCode, "approved", accountID, Date.now())
    if (!approved) {
      // Losing the pending→approved race is the normal outcome of a duplicate
      // submit, not a failure: if the row already carries this account, the
      // terminal is connected and the user should be told exactly that.
      const row = await getDeviceByUserCode(c.env.DB, intent.userCode)
      if (row?.account_id === accountID && (row.status === "approved" || row.status === "consumed")) {
        return { kind: "device" }
      }
      throw new HttpError(400, "Device code expired")
    }
    await c.env.STATE.put(completedKey(loginState), DEVICE_COMPLETED_MARKER, {
      expirationTtl: COMPLETED_REPLAY_TTL_SECONDS,
    })
    return { kind: "device" }
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
  return { kind: "redirect", url: redirect.toString() }
}

export async function completeLogin(c: AppContext, loginState: string, accountID: string): Promise<Response> {
  try {
    const result = await finalizeLogin(c, loginState, accountID)
    return result.kind === "device" ? deviceConnectedPage(c) : c.redirect(result.url, 302)
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
      if (error.message === "Device code expired") {
        return resultPage(c, "Device code expired", "Return to the terminal and start sign-in again.", 400)
      }
      return resultPage(c, "Session expired", "Start the sign-in flow again.", 400)
    }
    throw error
  }
}

/**
 * First-time accounts get a chance to save a platform passkey before the
 * login intent is consumed. Accounts that already have one complete as usual.
 */
async function completeOrOfferPasskey(c: AppContext, loginState: string, accountID: string): Promise<Response> {
  if ((await countPasskeys(c.env.DB, accountID)) > 0) return completeLogin(c, loginState, accountID)
  const offer: PasskeyOffer = { accountID }
  await c.env.STATE.put(passkeyOfferKey(loginState), JSON.stringify(offer), {
    expirationTtl: LOGIN_STATE_TTL_SECONDS,
  })
  return passkeyOfferPage(c, loginState)
}

export async function startGitHub(c: AppContext): Promise<Response> {
  const unavailable = requireGitHubCredentials(c)
  if (unavailable) return unavailable
  const loginState = c.req.query("login_state") ?? ""
  if (!(await loadLoginIntent(c.env, loginState)))
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
  if (!code || !(await loadLoginIntent(c.env, loginState)))
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
  return completeOrOfferPasskey(c, loginState, account.id)
}

export async function requestEmailCode(c: AppContext): Promise<Response> {
  const form = await readForm(c.req.raw)
  const loginState = form.get("login_state") ?? ""
  const email = (form.get("email") ?? "").trim().toLowerCase()
  if (!(await loadLoginIntent(c.env, loginState))) {
    const replay = await replayCompleted(c, loginState)
    return replay ?? resultPage(c, "Session expired", "Start the sign-in flow again.", 400)
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return loginPage(c, loginState, "Enter a valid email address.")

  const [burst, sustained] = await Promise.all([
    consumeRateLimit(c.env.STATE, "email", email, EMAIL_CODE_BURST_LIMIT, EMAIL_CODE_BURST_WINDOW_SECONDS),
    consumeRateLimit(c.env.STATE, "email-hour", email, EMAIL_CODE_HOURLY_LIMIT, EMAIL_CODE_HOURLY_WINDOW_SECONDS),
  ])
  const limited = !burst.allowed ? burst : !sustained.allowed ? sustained : null
  if (limited) {
    c.header("Retry-After", String(limited.retryAfter))
    // An already-delivered code stays usable while the sender is throttled, so
    // keep the user on the page where they can still enter it.
    const pending = await c.env.STATE.get<EmailChallenge>(emailKey(loginState), "json")
    const wait = formatDuration(limited.retryAfter)
    return pending
      ? emailCodePage(
          c,
          loginState,
          email,
          `Too many codes were sent to this address. Enter the code you already received, or request another in ${wait}.`,
          429,
        )
      : loginPage(c, loginState, `Too many codes were sent to this address. Try again in ${wait}.`, 429)
  }

  const code = randomDigits(6)
  const nonce = randomToken(16)
  const challenge: EmailChallenge = {
    email,
    nonce,
    codeHash: await sha256(`${nonce}:${code}`),
    attempts: 0,
    expiresAt: Date.now() + EMAIL_CODE_TTL_SECONDS * 1000,
  }
  try {
    await c.env.EMAIL.send({
      to: email,
      from: { email: c.env.EMAIL_SENDER, name: "NikCLI" },
      subject: `${code} is your NikCLI sign-in code`,
      text: `Your NikCLI sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
      html: `<p>Your NikCLI sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:0.2em">${code}</p><p>It expires in 10 minutes. If you did not request this code, ignore this email.</p>`,
    })
  } catch (error) {
    // A rejected send used to surface as a bare 500 from the worker, which
    // reads to the user as "sign-in is broken" rather than "try again or use
    // GitHub". Log the domain (never the address) so delivery problems with a
    // specific provider are diagnosable from `wrangler tail`.
    console.error(
      JSON.stringify({
        message: "email code send failed",
        domain: email.slice(email.lastIndexOf("@") + 1),
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return loginPage(
      c,
      loginState,
      "We could not send the code right now. Try again in a moment, or continue with GitHub.",
      502,
    )
  }
  // Persist only after the mail is accepted: a challenge nobody can satisfy
  // would just burn the address's send budget on the retry.
  await c.env.STATE.put(emailKey(loginState), JSON.stringify(challenge), {
    expirationTtl: EMAIL_CODE_TTL_SECONDS,
  })
  return emailCodePage(c, loginState, email)
}

export async function verifyEmailCode(c: AppContext): Promise<Response> {
  const form = await readForm(c.req.raw)
  const loginState = form.get("login_state") ?? ""
  const code = digitsOnly(form.get("code") ?? "")
  const challenge = await c.env.STATE.get<EmailChallenge>(emailKey(loginState), "json")
  if (!challenge || !(await loadLoginIntent(c.env, loginState))) {
    // A prior submit for this same login_state may have already verified the
    // code and consumed both KV entries — replay its outcome instead of
    // telling a merely-late duplicate request its code is expired.
    const replay = await replayCompleted(c, loginState)
    if (replay) return replay
    return resultPage(c, "Code expired", "Request a new sign-in code.", 400)
  }

  const expiresAt = challenge.expiresAt ?? Date.now() + EMAIL_CODE_TTL_SECONDS * 1000
  if (expiresAt <= Date.now()) {
    await c.env.STATE.delete(emailKey(loginState))
    return loginPage(c, loginState, "That code expired. Request a new one.")
  }

  // Empty or short submissions are typos and half-finished autofills, not
  // guesses. Spending one of the five real attempts on them is how a user with
  // a perfectly good code ends up locked out of it.
  if (code.length !== 6) {
    return emailCodePage(c, loginState, challenge.email, "Enter the six digits from the email.", 400)
  }

  challenge.attempts += 1
  if (challenge.attempts > EMAIL_CODE_MAX_ATTEMPTS) {
    await c.env.STATE.delete(emailKey(loginState))
    // The login intent is still alive, so offer a new code here rather than
    // sending the user back to the terminal to restart the whole flow.
    return loginPage(c, loginState, "Too many wrong codes. Request a new one.", 429)
  }
  await c.env.STATE.put(emailKey(loginState), JSON.stringify({ ...challenge, expiresAt }), {
    expirationTtl: remainingTtl(expiresAt),
  })
  const providedHash = await sha256(`${challenge.nonce}:${code}`)
  if (!(await secureEqual(providedHash, challenge.codeHash))) {
    const left = EMAIL_CODE_MAX_ATTEMPTS - challenge.attempts
    return emailCodePage(
      c,
      loginState,
      challenge.email,
      left > 0
        ? `That code is not valid. ${left} ${left === 1 ? "try" : "tries"} left, or send a new code.`
        : "That code is not valid. Send a new code to continue.",
      400,
    )
  }

  const account = await linkAccount(c.env.DB, "email", challenge.email, challenge.email)
  return completeOrOfferPasskey(c, loginState, account.id)
}

export async function beginDeviceApproval(c: AppContext): Promise<Response> {
  const form = await readForm(c.req.raw)
  const submitted = form.get("user_code") ?? ""
  const decision = form.get("decision")
  if (decision !== "approve" && decision !== "deny") throw new HttpError(400, "invalid decision")

  const formatted = normalizeUserCode(submitted)
  // Keep whatever digits the user typed in the field so a mistyped code is a
  // one-character correction instead of a retype from the terminal.
  if (!formatted) {
    return devicePage(c, digitsOnly(submitted).slice(0, 8), "Enter the eight digits shown in your terminal.", 400)
  }

  const rate = await consumeRateLimit(
    c.env.STATE,
    "device-approve",
    requestIP(c.req.raw),
    DEVICE_APPROVAL_LIMIT,
    DEVICE_APPROVAL_WINDOW_SECONDS,
  )
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfter))
    return devicePage(c, formatted, `Too many attempts. Try again in ${formatDuration(rate.retryAfter)}.`, 429)
  }

  const row = await getDeviceByUserCode(c.env.DB, formatted)
  // Every branch below used to collapse into one "Invalid device code" dead
  // end with no form to retry on — including the case where the code had
  // already been approved by this very browser.
  if (!row) {
    return devicePage(c, formatted, "That code does not match a waiting terminal. Check it and try again.", 400)
  }
  if (row.status === "approved" || row.status === "consumed") {
    return resultPage(c, "Device already connected", "This code was already approved. Return to your terminal.")
  }
  if (row.status === "denied") {
    return resultPage(c, "Device denied", "This code was already denied. Start sign-in again in your terminal.", 400)
  }
  if (row.expires_at <= Date.now()) {
    return devicePage(c, "", "That code expired. Start sign-in again in your terminal to get a new one.", 400)
  }

  if (decision === "deny") {
    await setDeviceDecision(c.env.DB, formatted, "denied", null, Date.now())
    return resultPage(c, "Device denied", "The terminal was not authorized.")
  }
  const loginState = await createLoginState(c.env, {
    kind: "device",
    userCode: formatted,
  })
  return loginPage(c, loginState)
}
