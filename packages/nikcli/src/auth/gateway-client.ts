/**
 * Shared nikcli Gateway device-authorization client.
 *
 * Single source of truth for the device-auth HTTP contract used by both the
 * `nikcli auth gateway` CLI command and the `@nikcli-ai/plugin` loader. Any
 * behavioural change (rate-limit handling, polling cadence, token expiry
 * semantics) must be made here and nowhere else.
 */

export namespace GatewayClient {
  const DEFAULT_API_BASE = "https://api.nikcli.ai"
  const POLL_INTERVAL_MS = 3_000
  /** Fallback lifetime for the stored token when the server omits `expiresIn`. */
  const DEFAULT_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

  export interface InitResponse {
    code: string
    verificationUrl: string
    /** Validity window for the pending authorization code, in seconds. */
    expiresIn: number
  }

  export interface PollResponse {
    status: "pending" | "approved" | "denied" | "expired"
    token?: string
    userEmail?: string
    /** Optional token lifetime in seconds, as returned by the server. */
    expiresIn?: number
    accountId?: string
  }

  export interface ApprovedAuth {
    token: string
    userEmail: string
    /** Absolute `Date.now()`-based expiry derived from the server response. */
    expiresAt: number
    accountId?: string
  }

  export function apiBase(): string {
    return process.env.NIKCLI_API_URL || DEFAULT_API_BASE
  }

  export async function initiateDeviceAuth(): Promise<InitResponse> {
    const response = await fetch(`${apiBase()}/api/device-auth/codes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Too many pending authorization requests. Please try again later.")
      }
      throw new Error(`Failed to initiate device authorization: ${response.status}`)
    }

    return (await response.json()) as InitResponse
  }

  export async function pollDeviceAuth(code: string): Promise<PollResponse> {
    const response = await fetch(`${apiBase()}/api/device-auth/codes/${code}`)

    if (response.status === 202) return { status: "pending" }
    if (response.status === 403) return { status: "denied" }
    if (response.status === 410) return { status: "expired" }

    if (!response.ok) {
      throw new Error(`Failed to poll device authorization: ${response.status}`)
    }

    return (await response.json()) as PollResponse
  }

  /**
   * Approve a pending device-auth code. Used only by the `devApprove` CLI
   * helper during local development. Throws on non-2xx responses so callers
   * cannot print a false "approved" confirmation.
   */
  export async function approveDeviceAuth(code: string): Promise<void> {
    const response = await fetch(`${apiBase()}/api/device-auth/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })

    if (!response.ok) {
      let detail = ""
      try {
        detail = (await response.text()).trim()
      } catch {
        /* body was not readable */
      }
      throw new Error(`Failed to approve device authorization: ${response.status}${detail ? ` — ${detail}` : ""}`)
    }
  }

  /**
   * Polls the device-auth code endpoint until the user approves/denies it or
   * the verification window (`expiresIn` seconds) elapses. Enforces both the
   * attempt count AND the wall-clock budget so a laggy server cannot keep the
   * client spinning past the code's real lifetime.
   */
  export async function waitForAuth(code: string, expiresIn: number): Promise<ApprovedAuth> {
    const startTime = Date.now()
    const deadline = startTime + expiresIn * 1000
    const maxAttempts = Math.max(1, Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS))

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (Date.now() >= deadline) break

      const result = await pollDeviceAuth(code)

      if (result.status === "approved") {
        if (!result.token || !result.userEmail) {
          throw new Error("Invalid response from authorization server")
        }
        const lifetimeMs =
          typeof result.expiresIn === "number" && result.expiresIn > 0
            ? result.expiresIn * 1000
            : DEFAULT_TOKEN_LIFETIME_MS
        return {
          token: result.token,
          userEmail: result.userEmail,
          expiresAt: Date.now() + lifetimeMs,
          accountId: result.accountId,
        }
      }

      if (result.status === "denied") throw new Error("Authorization denied by user")
      if (result.status === "expired") throw new Error("Authorization code expired")

      if (attempt < maxAttempts - 1 && Date.now() + POLL_INTERVAL_MS < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    }

    throw new Error("Authorization timed out")
  }
}
