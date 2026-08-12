import { Option } from "effect"
import { Flag } from "@/flag/flag"
import { MobileAuth } from "@/mobile/auth"
import { UserDB } from "@/user/users"
import { externalSessionForToken } from "@/server/identity-auth"
import { Log } from "@/util/log"

/**
 * Canonical auth resolution for the nikcli server.
 *
 * `Auth.authenticate` is the single implementation of the resource-server
 * acceptance order (specs/unified-auth-plan.md §3.5):
 *
 *   1. identity-plane JWT from the issuer (`identity-auth.ts`, JWKS verify);
 *   2. capability tokens (`nkm_` — `MobileAuth.verify`);
 *   3. legacy credentials (`nku_` session, Basic, Tailscale), gated by
 *      `NIKCLI_REQUIRE_OAUTH` / `NIKCLI_LEGACY_LOGIN`.
 *
 * `ServerRouter` calls `authenticate` and remembers the principal on the
 * request. The HttpApi bridge calls the same function for direct consumers
 * (tests, embedded clients), so every entry point accepts the same credentials.
 *
 * `auth_token` (legacy `?token=` query parameter used by mobile and websocket
 * clients — see `MobileAuth.bearer`) is accepted as a bearer everywhere.
 */
export namespace Auth {
  const log = Log.create({ service: "httpapi.auth" })

  /** Basic-auth credentials. `username` defaults to `nikcli`. */
  export interface Credentials {
    readonly username: string
    readonly password: Option.Option<string>
  }

  /** The identity resolved for a request. `open` = allowed without an identified user (basic/tailscale/no-password dev mode). */
  export type Principal =
    | { readonly type: "user"; readonly session: { user: UserDB.PublicUser; token: string } }
    | { readonly type: "mobile"; readonly token: MobileAuth.PublicToken }
    | { readonly type: "open" }

  export type AuthenticateResult =
    | { readonly ok: true; readonly principal: Principal }
    | { readonly ok: false; readonly response: Response }

  const principals = new WeakMap<Request, Principal>()

  export function principal(request: Request): Principal | undefined {
    return principals.get(request)
  }

  export function remember(request: Request, value: Principal) {
    principals.set(request, value)
  }

  export interface AuthenticateOptions {
    /** Listen-state the router passes in; direct bridge consumers omit both. */
    readonly mobileAuthRequired?: boolean
    readonly listenHostname?: string
    /** Test seam replacing the Flag-derived basic-auth credentials. */
    readonly credentials?: Credentials
  }

  /**
   * Reads `Flag.NIKCLI_SERVER_*` every call so runtime changes (e.g. tests
   * that toggle the flag) take effect without a restart.
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

  /** Basic-auth challenge header emitted when credentials are required but missing/invalid. */
  export const challenge = `Basic realm="nikcli", charset="UTF-8"`

  /**
   * Parses `?token=…` from a URL. The `auth_token` security scheme: mobile and
   * websocket clients pass the bearer token via query parameter because the
   * transport cannot send custom headers.
   */
  export function extractQueryToken(url: URL): string | undefined {
    const value = url.searchParams.get("token")
    return value && value.length > 0 ? value : undefined
  }

  export function isLoopbackHostname(hostname: string | undefined) {
    if (!hostname) return false
    return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
  }

  /**
   * Routes reachable without credentials. Flag-dependent: closing legacy
   * login (`NIKCLI_REQUIRE_OAUTH` without `NIKCLI_LEGACY_LOGIN`) also closes
   * password login/registration.
   */
  export function isPublicPath(method: string, pathname: string): boolean {
    const normalizedMethod = method.toUpperCase()
    if (normalizedMethod === "OPTIONS") return true
    if (pathname === "/user/status") return true
    if (
      (pathname === "/user/login" || pathname === "/user/register") &&
      (!Flag.NIKCLI_REQUIRE_OAUTH || Flag.NIKCLI_LEGACY_LOGIN)
    ) {
      return true
    }
    if (normalizedMethod === "GET" && pathname === "/global/health") return true
    return false
  }

  function legacyUserTokenAllowed() {
    return !Flag.NIKCLI_REQUIRE_OAUTH || Flag.NIKCLI_LEGACY_LOGIN
  }

  /**
   * Best-effort principal resolution from a bearer token (header or
   * `?token=`), in acceptance order. Returns undefined when no bearer is
   * present or nothing matches — enforcement is `authenticate`'s job.
   */
  export async function resolveBearer(
    request: Request,
  ): Promise<Extract<Principal, { type: "user" | "mobile" }> | undefined> {
    const bearer = MobileAuth.bearer(request) ?? extractQueryToken(new URL(request.url))
    if (!bearer) return undefined
    const external = await externalSessionForToken(bearer).catch(() => undefined)
    if (external) return { type: "user", session: external }
    const mobile = await MobileAuth.verify(bearer)
    if (mobile) return { type: "mobile", token: mobile }
    if (bearer.startsWith("nku_") && legacyUserTokenAllowed()) {
      const user = UserDB.verifySession(bearer)
      if (user) return { type: "user", session: { user, token: bearer } }
    }
    return undefined
  }

  /**
   * Full auth decision for a request. Both backends call this — Hono's
   * middleware for every route, the bridge for direct consumers — so the
   * acceptance order has exactly one implementation.
   */
  export async function authenticate(request: Request, options?: AuthenticateOptions): Promise<AuthenticateResult> {
    const bearer = MobileAuth.bearer(request) ?? extractQueryToken(new URL(request.url))
    if (bearer) {
      const principal = await resolveBearer(request)
      if (principal) return { ok: true, principal }
      return unauthorized()
    }

    if (options?.mobileAuthRequired || (Flag.NIKCLI_REQUIRE_OAUTH && !Flag.NIKCLI_LEGACY_LOGIN)) {
      return unauthorized()
    }

    const credentials = options?.credentials ?? currentCredentials()

    const tailscaleAuthEnabled = Flag.NIKCLI_SERVER_TAILSCALE_AUTH && isLoopbackHostname(options?.listenHostname)
    if (tailscaleAuthEnabled) {
      const login = request.headers.get("Tailscale-User-Login")?.trim()
      if (login) {
        if (!isTailscaleLoginAllowed(login)) {
          log.warn("tailscale user not allowed", { login })
          return { ok: false, response: new Response("Forbidden", { status: 403 }) }
        }
        return { ok: true, principal: { type: "open" } }
      }
      // Tailscale auth requires identity headers; optionally fall back to Basic.
      if (Option.isNone(credentials.password)) return unauthorized()
    }

    if (Option.isNone(credentials.password)) return { ok: true, principal: { type: "open" } }
    if (matchesBasicAuth(credentials, request.headers.get("authorization"))) {
      return { ok: true, principal: { type: "open" } }
    }
    return {
      ok: false,
      response: new Response("Unauthorized", {
        status: 401,
        headers: { "www-authenticate": challenge },
      }),
    }
  }

  function unauthorized(): AuthenticateResult {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
  }

  function isTailscaleLoginAllowed(login: string) {
    const configured = Flag.NIKCLI_SERVER_TAILSCALE_USERS?.trim()
    if (!configured) return true

    const items = configured
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)

    if (items.length === 0) return true
    if (items.some((x) => x === "*" || x.toLowerCase() === "any")) return true

    const normalized = login.toLowerCase()
    return items.some((x) => x.toLowerCase() === normalized)
  }
}

function safeBase64Decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64").toString("utf-8")
  } catch {
    return null
  }
}
