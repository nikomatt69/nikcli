import { AccountDB } from "./db"
import { AccountRepo } from "./repo"
import { normalizeServerUrl } from "./url"
import { Identifier } from "@/id/id"
import { Lock } from "@/util/lock"
import { Log } from "@/util/log"
import type { AccountRow } from "./schema"
import {
  AccountID,
  type DeviceCode,
  type DeviceCodeRequest,
  type DeviceCodeResponse,
  type Info,
  type Org,
  type OrgID,
  type PollResult,
  type RefreshToken,
  type UserCode,
} from "./schema"
import { Context, Effect, Layer, Schema } from "effect"

export namespace Account {
  const log = Log.create({ service: "account" })

  /**
   * Tagged errors that the account service can surface through the Effect
   * error channel. Each is a `Schema.TaggedErrorClass` so call sites can use
   * `Effect.catchTag("AccountNotFound", ...)` and `instanceof` continues to
   * work for plain `try/catch` paths.
   */
  export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("AccountNotFound", {
    message: Schema.String,
    accountID: Schema.String,
  }) {}

  export class LoginFlowError extends Schema.TaggedErrorClass<LoginFlowError>()("AccountLoginFlow", {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
    responseBody: Schema.optional(Schema.String),
  }) {}

  export class LoginTimeoutError extends Schema.TaggedErrorClass<LoginTimeoutError>()("AccountLoginTimeout", {
    message: Schema.String,
  }) {}

  export class LoginDeniedError extends Schema.TaggedErrorClass<LoginDeniedError>()("AccountLoginDenied", {
    message: Schema.String,
  }) {}

  export class TokenExpiredError extends Schema.TaggedErrorClass<TokenExpiredError>()("AccountTokenExpired", {
    message: Schema.String,
  }) {}

  export class TokenRefreshError extends Schema.TaggedErrorClass<TokenRefreshError>()("AccountTokenRefresh", {
    message: Schema.String,
    accountID: Schema.String,
    status: Schema.optional(Schema.Number),
    responseBody: Schema.optional(Schema.String),
  }) {}

  export class FetchOrgsError extends Schema.TaggedErrorClass<FetchOrgsError>()("AccountFetchOrgs", {
    message: Schema.String,
    accountID: Schema.String,
    status: Schema.optional(Schema.Number),
    responseBody: Schema.optional(Schema.String),
  }) {}

  export class IOError extends Schema.TaggedErrorClass<IOError>()("AccountIOError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }) {}

  /**
   * Union of all errors that any `Account.Service` method can fail with.
   */
  export type Error =
    | NotFoundError
    | LoginFlowError
    | LoginTimeoutError
    | LoginDeniedError
    | TokenExpiredError
    | TokenRefreshError
    | FetchOrgsError
    | IOError

  /**
   * Preserve typed account errors thrown by the impl. Anything we recognize
   * passes through unchanged; untyped `Error` instances become
   * `Account.IOError`; everything else is wrapped in `IOError` so the Effect
   * error channel stays typed at the `Account.Error` union.
   */
  function asAccountError(e: unknown): Error {
    if (
      e instanceof NotFoundError ||
      e instanceof LoginFlowError ||
      e instanceof LoginTimeoutError ||
      e instanceof LoginDeniedError ||
      e instanceof TokenExpiredError ||
      e instanceof TokenRefreshError ||
      e instanceof FetchOrgsError ||
      e instanceof IOError
    ) {
      return e
    }
    if (e instanceof Error) {
      return new IOError({ message: e.message, cause: e })
    }
    return new IOError({ message: String(e) })
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  const DEFAULT_ACCOUNT_URL = process.env.NIKCLI_ACCOUNT_URL ?? "https://auth.nikcli.store"

  // ============================================================================
  // Token cache — with eviction and size limits
  // ============================================================================

  const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
  const MAX_TOKEN_CACHE_SIZE = 50

  /** Evict stale entries from the token cache */
  function evictTokenCache() {
    const now = Date.now()
    // Remove expired entries first
    for (const [key, val] of tokenCache) {
      if (val.expiresAt <= now) tokenCache.delete(key)
    }
    // If still over size, evict the entry with the soonest expiry (LRU-like)
    if (tokenCache.size > MAX_TOKEN_CACHE_SIZE) {
      let oldest: string | undefined
      let oldestAt = Infinity
      for (const [key, val] of tokenCache) {
        if (val.expiresAt < oldestAt) {
          oldest = key
          oldestAt = val.expiresAt
        }
      }
      if (oldest) tokenCache.delete(oldest)
    }
  }

  // ============================================================================
  // Account row cache — avoids double-reads in token() + orgs()
  // ============================================================================

  const accountRowCache = new Map<string, { row: AccountRow; cachedAt: number }>()
  const ACCOUNT_ROW_CACHE_TTL = 5_000 // 5 seconds

  // ============================================================================
  // Device code flow
  // ============================================================================

  /**
   * Device code request options
   */
  export interface LoginOptions {
    email?: string
    serverUrl?: string
  }

  /**
   * Device code flow response (first step)
   */
  export interface LoginStartResult {
    deviceCode: DeviceCode
    userCode: UserCode
    verificationUrl: string
    interval: number
    expiresIn: number
  }

  export interface Interface {
    login(options?: LoginOptions): Effect.Effect<LoginStartResult, Error>
    poll(
      deviceCode: DeviceCode,
      options?: { serverUrl?: string; onPending?: () => void },
    ): Effect.Effect<
      { accountID: AccountID; accessToken: string; refreshToken: RefreshToken; expiresIn: number },
      Error
    >
    loginFull(
      options?: LoginOptions & { onPending?: (userCode: UserCode) => void },
    ): Effect.Effect<
      { accountID: AccountID; accessToken: string; refreshToken: RefreshToken; expiresIn: number },
      Error
    >
    token(accountID: AccountID): Effect.Effect<string, Error>
    orgs(accountID: AccountID): Effect.Effect<Org[], Error>
    active(): Effect.Effect<Info | undefined>
    get(accountID: AccountID): Effect.Effect<Info | undefined>
    list(): Effect.Effect<Info[]>
    use(accountID: AccountID | null, orgID?: OrgID | null): Effect.Effect<void>
    remove(accountID: AccountID): Effect.Effect<boolean>
    config(): Effect.Effect<{ serverUrl: string }>
  }

  export class Service extends Context.Service<Service, Interface>()("Account.Service") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      login: (options) => Effect.tryPromise({ try: () => loginImpl(options), catch: asAccountError }),
      poll: (deviceCode, options) =>
        Effect.tryPromise({ try: () => pollImpl(deviceCode, options), catch: asAccountError }),
      loginFull: (options) => Effect.tryPromise({ try: () => loginFullImpl(options), catch: asAccountError }),
      token: (accountID) => Effect.tryPromise({ try: () => tokenImpl(accountID), catch: asAccountError }),
      orgs: (accountID) => Effect.tryPromise({ try: () => orgsImpl(accountID), catch: asAccountError }),
      active: () => Effect.sync(() => activeImpl()),
      get: (accountID) => Effect.sync(() => getImpl(accountID)),
      list: () => Effect.sync(() => listImpl()),
      use: (accountID, orgID) => Effect.sync(() => useImpl(accountID, orgID)),
      remove: (accountID) => Effect.sync(() => removeImpl(accountID)),
      config: () => Effect.sync(() => configImpl()),
    }),
  )

  export const defaultLayer = layer

  /**
   * Start the device code login flow.
   * Returns the device code info needed for polling.
   */
  async function loginImpl(options: LoginOptions = {}): Promise<LoginStartResult> {
    const serverUrl = normalizeServerUrl(options.serverUrl ?? DEFAULT_ACCOUNT_URL)
    log.info("starting device code login", { serverUrl })

    const request: DeviceCodeRequest = {
      client_id: "nikcli",
      scope: "openid profile email offline_access",
    }

    const response = await fetch(`${serverUrl}oauth/device/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new LoginFlowError({
        message: `Failed to start device code flow: ${response.status} ${errorText}`,
        status: response.status,
        responseBody: errorText,
      })
    }

    const data = (await response.json()) as DeviceCodeResponse
    log.info("device code received", { userCode: data.user_code })

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUrl: data.verification_url,
      interval: data.interval,
      expiresIn: data.expires_in,
    }
  }

  /**
   * Poll for token completion of the device code flow.
   * Returns when the user has authenticated or throws on failure.
   */
  async function pollImpl(
    deviceCode: DeviceCode,
    options: { serverUrl?: string; onPending?: () => void } = {},
  ): Promise<{ accountID: AccountID; accessToken: string; refreshToken: RefreshToken; expiresIn: number }> {
    const serverUrl = normalizeServerUrl(options.serverUrl ?? DEFAULT_ACCOUNT_URL)
    const startTime = Date.now()

    log.info("polling for device code completion", { serverUrl })

    while (true) {
      const response = await fetch(`${serverUrl}oauth/device/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: "nikcli",
          device_code: deviceCode,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error")
        throw new LoginFlowError({
          message: `Failed to poll device code: ${response.status} ${errorText}`,
          status: response.status,
          responseBody: errorText,
        })
      }

      const result = (await response.json()) as PollResult

      switch (result.status) {
        case "pending": {
          options.onPending?.()
          await Bun.sleep((result.interval ?? 5) * 1000)
          break
        }

        case "slow_down": {
          // Increase poll interval as requested by server
          await Bun.sleep(result.interval * 1000)
          break
        }

        case "expired": {
          throw new Error("Device code has expired. Please try logging in again.")
        }

        case "denied": {
          throw new Error("Login was denied. Please try again.")
        }

        case "success": {
          // Generate a canonical, time-ordered account ID using the shared Identifier helper.
          // Parsed through the schema so the value is runtime-validated (not just a cast),
          // which guarantees downstream `Identifier.timestamp(id)` and schema checks keep working.
          const accountID = AccountID.parse(Identifier.ascending("account"))

          log.info("device code flow completed", { accountID })

          // Persist the account
          AccountRepo.persistAccount(
            accountID,
            "", // email will be fetched later
            serverUrl,
            result.access_token,
            result.refresh_token,
            result.expires_in,
          )

          return {
            accountID,
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            expiresIn: result.expires_in,
          }
        }
      }

      // Safety: timeout after 10 minutes
      if (Date.now() - startTime > 600_000) {
        throw new Error("Login timed out. Please try again.")
      }
    }
  }

  /**
   * Full login flow: start + poll.
   * Convenience function that handles the entire device code flow.
   */
  async function loginFullImpl(
    options: LoginOptions & { onPending?: (userCode: UserCode) => void } = {},
  ): Promise<{ accountID: AccountID; accessToken: string; refreshToken: RefreshToken; expiresIn: number }> {
    const start = await loginImpl(options)
    options.onPending?.(start.userCode)

    return pollImpl(start.deviceCode, {
      serverUrl: options.serverUrl,
      onPending: () => options.onPending?.(start.userCode),
    })
  }

  // ============================================================================
  // Token management
  // ============================================================================

  /**
   * Get a valid access token for an account.
   * Automatically refreshes if expired (within threshold).
   * Uses Lock.write to serialize concurrent refresh attempts.
   */
  async function tokenImpl(accountID: AccountID): Promise<string> {
    // Check in-memory cache first
    const cached = tokenCache.get(accountID)
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken
    }

    // Get account from DB (with row cache)
    const account = getAccountRowCached(accountID)
    if (!account) {
      throw new Error(`Account not found: ${accountID}`)
    }

    // Check if token is still valid
    if (account.token_expiry > Date.now() + 60_000) {
      const accessToken = account.access_token
      tokenCache.set(accountID, { accessToken, expiresAt: account.token_expiry })
      return accessToken
    }

    // Token expired or about to expire — refresh under lock
    const lockKey = `account-refresh:${accountID}`
    using _ = await Lock.write(lockKey)

    // Re-check after acquiring lock
    const recheck = getAccountRowCached(accountID)
    if (!recheck) {
      throw new Error(`Account not found: ${accountID}`)
    }

    if (recheck.token_expiry > Date.now() + 60_000) {
      return recheck.access_token
    }

    // Refresh the token
    log.info("refreshing account token", { accountID })

    const serverUrl = normalizeServerUrl(recheck.url)
    const response = await fetch(`${serverUrl}oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: recheck.refresh_token,
        client_id: "nikcli",
      }).toString(),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
    }

    const result = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    // Persist updated tokens (only token fields, not email/url/created_at)
    AccountRepo.persistToken(
      accountID,
      result.access_token,
      result.refresh_token ?? recheck.refresh_token,
      result.expires_in,
    )

    // Update caches
    const expiresAt = Date.now() + result.expires_in * 1000
    tokenCache.set(accountID, { accessToken: result.access_token, expiresAt })
    // Invalidate the row cache so next read gets fresh data
    accountRowCache.delete(accountID)
    evictTokenCache()

    return result.access_token
  }

  // ============================================================================
  // Organizations
  // ============================================================================

  /**
   * List organizations for an account.
   * Uses the cached account row from token() to avoid double-reads.
   */
  async function orgsImpl(accountID: AccountID): Promise<Org[]> {
    const accessToken = await tokenImpl(accountID)
    // Reuse the cached account row instead of reading from DB again
    const account = getAccountRowCached(accountID)
    if (!account) {
      throw new Error(`Account not found: ${accountID}`)
    }

    const serverUrl = normalizeServerUrl(account.url)

    const response = await fetch(`${serverUrl}api/user/orgs`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`Failed to fetch orgs: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as { orgs: Org[] }
    return data.orgs
  }

  // ============================================================================
  // Account management
  // ============================================================================

  /**
   * Get the active account info
   */
  function activeImpl(): Info | undefined {
    return AccountRepo.active()
  }

  /**
   * Get account info by ID
   */
  function getImpl(accountID: AccountID): Info | undefined {
    return AccountRepo.get(accountID)
  }

  /**
   * List all accounts
   */
  function listImpl(): Info[] {
    return AccountRepo.list()
  }

  /**
   * Switch to a different account and optionally org.
   * Clears token cache for both the outgoing and incoming accounts.
   */
  function useImpl(accountID: AccountID | null, orgID?: OrgID | null): void {
    // Clear the outgoing account's cache too
    const config = AccountDB.getConfig()
    const previousActiveId = config.active_account_id
    if (previousActiveId) {
      tokenCache.delete(previousActiveId)
      accountRowCache.delete(previousActiveId)
    }
    // Clear the incoming account's cache
    if (accountID) {
      tokenCache.delete(accountID)
      accountRowCache.delete(accountID)
    }
    AccountRepo.use(accountID, orgID)
  }

  /**
   * Remove an account
   */
  function removeImpl(accountID: AccountID): boolean {
    tokenCache.delete(accountID)
    accountRowCache.delete(accountID)
    return AccountRepo.remove(accountID)
  }

  /**
   * Get the current server URL
   */
  function configImpl(): { serverUrl: string } {
    return {
      serverUrl: DEFAULT_ACCOUNT_URL,
    }
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /** Get an account row with short-lived caching to avoid double-reads */
  function getAccountRowCached(accountID: string): AccountRow | undefined {
    const now = Date.now()
    const cached = accountRowCache.get(accountID)
    if (cached && now - cached.cachedAt < ACCOUNT_ROW_CACHE_TTL) {
      return cached.row
    }
    const row = AccountDB.getAccount(accountID)
    if (row) {
      accountRowCache.set(accountID, { row, cachedAt: now })
    }
    return row
  }
}
