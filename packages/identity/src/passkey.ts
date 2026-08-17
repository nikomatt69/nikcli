import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { isoBase64URL } from "@simplewebauthn/server/helpers"
import type { Context } from "hono"
import { PASSKEY_AUTH_LIMIT, PASSKEY_AUTH_WINDOW_SECONDS, PASSKEY_CHALLENGE_TTL_SECONDS } from "./constants"
import { createID } from "./crypto"
import { getAccount, getPasskeyByCredentialID, insertPasskey, listPasskeys, updatePasskeyCounter } from "./database"
import { HttpError, readForm, readJson, requestIP } from "./http"
import { completeLogin, finalizeLogin, loadLoginIntent } from "./login"
import { consumeRateLimit } from "./rate-limit"
import type { PasskeyOffer, PasskeyRow } from "./types"
import { resultPage } from "./ui"

type AppContext = Context<{ Bindings: Env }>

const TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
])

function authChallengeKey(loginState: string): string {
  return `passkey:auth:${loginState}`
}

function regChallengeKey(loginState: string): string {
  return `passkey:reg:${loginState}`
}

function offerKey(loginState: string): string {
  return `passkey-offer:${loginState}`
}

function relyingParty(env: Env): { rpID: string; rpName: string; expectedOrigin: string } {
  const issuer = new URL(env.ISSUER)
  return {
    rpID: issuer.hostname,
    rpName: "nikcli",
    expectedOrigin: issuer.origin,
  }
}

function requireLoginState(body: Record<string, unknown>): string {
  const value = body.login_state
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, "login_state is required")
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function parseTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    const transports = parsed.filter((item): item is AuthenticatorTransportFuture => {
      return typeof item === "string" && TRANSPORTS.has(item as AuthenticatorTransportFuture)
    })
    return transports.length > 0 ? transports : undefined
  } catch {
    return undefined
  }
}

function asAuthenticationResponse(value: unknown): AuthenticationResponseJSON {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new HttpError(400, "credential is required")
  }
  return value as unknown as AuthenticationResponseJSON
}

function asRegistrationResponse(value: unknown): RegistrationResponseJSON {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new HttpError(400, "credential is required")
  }
  return value as unknown as RegistrationResponseJSON
}

function loginResultJson(c: AppContext, result: Awaited<ReturnType<typeof finalizeLogin>>): Response {
  return result.kind === "device" ? c.json({ ok: true, device: true }) : c.json({ redirect: result.url })
}

async function consumePasskeyAuthLimit(c: AppContext): Promise<void> {
  const rate = await consumeRateLimit(
    c.env.STATE,
    "passkey-auth",
    requestIP(c.req.raw),
    PASSKEY_AUTH_LIMIT,
    PASSKEY_AUTH_WINDOW_SECONDS,
  )
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfter))
    throw new HttpError(429, "Too many passkey attempts")
  }
}

async function requireIntent(c: AppContext, loginState: string) {
  const intent = await loadLoginIntent(c.env, loginState)
  if (!intent) throw new HttpError(400, "Session expired")
  return intent
}

function webAuthnCredential(row: PasskeyRow) {
  return {
    id: row.credential_id,
    publicKey: isoBase64URL.toBuffer(row.public_key),
    counter: row.sign_count,
    transports: parseTransports(row.transports),
  }
}

export async function passkeyAuthenticationOptions(c: AppContext): Promise<Response> {
  await consumePasskeyAuthLimit(c)
  const loginState = requireLoginState(await readJson(c.req.raw))
  await requireIntent(c, loginState)
  const { rpID } = relyingParty(c.env)
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  })
  await c.env.STATE.put(authChallengeKey(loginState), options.challenge, {
    expirationTtl: PASSKEY_CHALLENGE_TTL_SECONDS,
  })
  return c.json(options)
}

export async function passkeyAuthenticationVerify(c: AppContext): Promise<Response> {
  await consumePasskeyAuthLimit(c)
  const body = await readJson(c.req.raw)
  const loginState = requireLoginState(body)
  await requireIntent(c, loginState)
  const challenge = await c.env.STATE.get(authChallengeKey(loginState))
  if (!challenge) throw new HttpError(400, "Passkey challenge expired")
  await c.env.STATE.delete(authChallengeKey(loginState))

  const response = asAuthenticationResponse(body.credential)
  const passkey = await getPasskeyByCredentialID(c.env.DB, response.id)
  if (!passkey) throw new HttpError(400, "Unknown passkey")

  const { rpID, expectedOrigin } = relyingParty(c.env)
  let verified = false
  let newCounter = passkey.sign_count
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: webAuthnCredential(passkey),
      requireUserVerification: false,
    })
    verified = result.verified
    newCounter = result.authenticationInfo.newCounter
  } catch {
    throw new HttpError(400, "Passkey verification failed")
  }
  if (!verified) throw new HttpError(400, "Passkey verification failed")

  await updatePasskeyCounter(c.env.DB, passkey.credential_id, newCounter, Date.now())
  return loginResultJson(c, await finalizeLogin(c, loginState, passkey.account_id))
}

export async function passkeyRegistrationOptions(c: AppContext): Promise<Response> {
  const loginState = requireLoginState(await readJson(c.req.raw))
  await requireIntent(c, loginState)
  const offer = await c.env.STATE.get<PasskeyOffer>(offerKey(loginState), "json")
  if (!offer) throw new HttpError(400, "Passkey enrollment is not available")
  const account = await getAccount(c.env.DB, offer.accountID)
  if (!account) throw new HttpError(400, "Passkey enrollment is not available")

  const { rpID, rpName } = relyingParty(c.env)
  const existing = await listPasskeys(c.env.DB, account.id)
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: account.email,
    userDisplayName: account.email,
    userID: new TextEncoder().encode(account.id).slice(),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
    excludeCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: parseTransports(row.transports),
    })),
  })
  await c.env.STATE.put(regChallengeKey(loginState), options.challenge, {
    expirationTtl: PASSKEY_CHALLENGE_TTL_SECONDS,
  })
  return c.json(options)
}

export async function passkeyRegistrationVerify(c: AppContext): Promise<Response> {
  const body = await readJson(c.req.raw)
  const loginState = requireLoginState(body)
  await requireIntent(c, loginState)
  const offer = await c.env.STATE.get<PasskeyOffer>(offerKey(loginState), "json")
  if (!offer) throw new HttpError(400, "Passkey enrollment is not available")
  const challenge = await c.env.STATE.get(regChallengeKey(loginState))
  if (!challenge) throw new HttpError(400, "Passkey challenge expired")
  await c.env.STATE.delete(regChallengeKey(loginState))

  const response = asRegistrationResponse(body.credential)
  const { rpID, expectedOrigin } = relyingParty(c.env)
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
    if (!result.verified || !result.registrationInfo) throw new Error("unverified")
    const now = Date.now()
    const { credential, credentialBackedUp, credentialDeviceType } = result.registrationInfo
    await insertPasskey(c.env.DB, {
      id: createID("pk", now),
      account_id: offer.accountID,
      credential_id: credential.id,
      public_key: isoBase64URL.fromBuffer(credential.publicKey),
      sign_count: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      backed_up: credentialBackedUp ? 1 : 0,
      device_type: credentialDeviceType,
      user_handle: offer.accountID,
      created_at: now,
      last_used_at: null,
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, "Passkey registration failed")
  }

  return loginResultJson(c, await finalizeLogin(c, loginState, offer.accountID))
}

export async function skipPasskey(c: AppContext): Promise<Response> {
  const form = await readForm(c.req.raw)
  const loginState = form.get("login_state") ?? ""
  const offer = await c.env.STATE.get<PasskeyOffer>(offerKey(loginState), "json")
  if (offer) return completeLogin(c, loginState, offer.accountID)
  if (await loadLoginIntent(c.env, loginState)) {
    return resultPage(c, "Session expired", "Start the sign-in flow again.", 400)
  }
  return completeLogin(c, loginState, "")
}
