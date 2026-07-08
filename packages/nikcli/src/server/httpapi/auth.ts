import { Option } from "effect"
import { Flag } from "@/flag/flag"

/**
 * Centralized Effect-side auth resolution for the HttpApi bridge.
 *
 * `NIKCLI_SERVER_PASSWORD` / `NIKCLI_SERVER_USERNAME` are the legacy
 * basic-auth credentials used by Hono's middleware in `server.ts`. The
 * Effect backend resolves the same flags through a shared `currentCredentials`
 * helper so the two backends stay in lockstep — Hono's middleware is the
 * source of truth, and the bridge calls the same logic before delegating to
 * the Effect router.
 *
 * `auth_token` (legacy `?token=` query parameter used by mobile and websocket
 * clients — see `MobileAuth.bearer`) is enforced as a security scheme on the
 * `/sync/*` and `/chatbot/*` webhook receivers, which read it via
 * `Auth.extractQueryToken`. They verify scope via `c.get("mobileAuth")`; the
 * bridge does not centralize that check because webhook payloads need the raw
 * request for signature verification.
 */
export namespace Auth {
  /** Basic-auth credentials. `username` defaults to `nikcli`. */
  export interface Credentials {
    readonly username: string
    readonly password: Option.Option<string>
  }

  /**
   * Synchronous helper used by the Hono/Effect bridge at request time. Mirrors
   * the Hono middleware in `server.ts` so basic auth requests land on either
   * backend with the same result. Reads `Flag.NIKCLI_SERVER_*` every call so
   * runtime changes (e.g. tests that toggle the flag) take effect without a
   * restart.
   */
  export function currentCredentials(): Credentials {
    const username = Flag.NIKCLI_SERVER_USERNAME?.trim() || "nikcli"
    const password = Flag.NIKCLI_SERVER_PASSWORD?.trim()
    return {
      username,
      password: password ? Option.some(password) : Option.none(),
    }
  }

  /** True when the configured password matches the request's basic-auth header. */
  export function matchesBasicAuth(credentials: Credentials, header: string | null | undefined): boolean {
    if (header === undefined || header === null) return false
    const match = /^Basic\s+(.+)$/i.exec(header)
    if (!match) return false
    const decoded = safeBase64Decode(match[1])
    if (!decoded) return false
    const sep = decoded.indexOf(":")
    if (sep < 0) return false
    const user = decoded.slice(0, sep)
    const pass = decoded.slice(sep + 1)
    return user === credentials.username && Option.getOrUndefined(credentials.password) === pass
  }

  /**
   * Basic-auth challenge header emitted by the bridge when credentials are
   * required but missing/invalid. Mirrors the Hono middleware's response.
   */
  export const challenge = `Basic realm="nikcli", charset="UTF-8"`

  /**
   * Parses `?token=…` from a URL. The `auth_token` security scheme for the
   * Effect backend: mobile and websocket clients pass the bearer token via
   * query parameter because the transport cannot send custom headers.
   */
  export function extractQueryToken(url: URL): string | undefined {
    const value = url.searchParams.get("token")
    return value && value.length > 0 ? value : undefined
  }
}

function safeBase64Decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64").toString("utf-8")
  } catch {
    return null
  }
}
