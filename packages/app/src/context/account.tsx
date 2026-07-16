import { createSimpleContext } from "@nikcli-ai/ui/context"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "./platform"
import { useServer } from "./server"
import { Persist, persisted } from "@/utils/persist"
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  isOAuthTokens,
  parseAuthCallback,
  refreshOAuthTokens,
  OAuthTokenError,
  type OAuthPending,
  type OAuthTokens,
} from "./account-oauth"

/**
 * Public shape of a nikcli account, mirroring `UserDB.PublicUser` on the
 * server (packages/nikcli/src/db/users.ts). This is the same account the CLI
 * authenticates against — the desktop/web/mobile surfaces all talk to the same
 * nikcli server, so logging in here is logging in with the CLI account.
 */
export type AccountUser = {
  id: string
  username: string
  email: string
  display_name: string | null
  role: "admin" | "user"
  created_at: number
  updated_at: number
}

export type AccountStatus = "anonymous" | "loading" | "authenticated"

/** Stable per-server key so a token follows the server it was issued for. */
function serverKey(url: string) {
  if (!url) return ""
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

export const { use: useAccount, provider: AccountProvider } = createSimpleContext({
  name: "Account",
  gate: false,
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const fetcher = platform.fetch ?? globalThis.fetch
    const oauthFetcher = platform.externalFetch ?? globalThis.fetch

    // Tokens are persisted per server so the session survives restarts and a
    // user can be signed into different servers independently.
    const [store, setStore, , ready] = persisted(
      Persist.global("account", ["account.v1"]),
      createStore({
        tokens: {} as Record<string, string | OAuthTokens>,
        pending: {} as Record<string, OAuthPending>,
      }),
    )

    const [user, setUser] = createStore<{ value: AccountUser | undefined }>({
      value: undefined,
    })
    const [status, setStatus] = createSignal<AccountStatus>("anonymous")
    const [error, setError] = createSignal<string | undefined>(undefined)
    const [canRegister, setCanRegister] = createSignal(false)

    const key = createMemo(() => serverKey(server.url))
    const credentials = createMemo(() => (ready() ? store.tokens[key()] : undefined))
    const token = createMemo(() => {
      const value = credentials()
      return isOAuthTokens(value) ? value.access : value
    })
    const refreshFlights = new Map<string, Promise<OAuthTokens>>()

    function persistToken(value: string | OAuthTokens | undefined, target = key()) {
      const k = target
      if (!k) return
      setStore("tokens", k, value as string | OAuthTokens)
    }

    async function getValidAccessToken(force = false) {
      const current = credentials()
      if (!isOAuthTokens(current)) return current
      if (!force && current.expires > Date.now() + 60_000) return current.access
      const target = key()
      let flight = refreshFlights.get(target)
      if (!flight) {
        flight = refreshOAuthTokens(current, oauthFetcher)
          .then((next) => {
            persistToken(next, target)
            return next
          })
          .catch((cause) => {
            if (cause instanceof OAuthTokenError && (cause.status === 400 || cause.status === 401)) {
              persistToken(undefined, target)
            }
            throw cause
          })
          .finally(() => {
            refreshFlights.delete(target)
          })
        refreshFlights.set(target, flight)
      }
      return (await flight).access
    }

    async function refreshAccessToken(rejected: string | undefined) {
      const current = credentials()
      if (!isOAuthTokens(current)) return current
      if (rejected && current.access !== rejected) return current.access
      return getValidAccessToken(true)
    }

    async function request(path: string, init?: RequestInit & { auth?: boolean }) {
      const base = server.url
      if (!base) throw new Error("No active server")
      const headers = new Headers(init?.headers)
      headers.set("Content-Type", "application/json")
      const current = init?.auth === false ? undefined : await getValidAccessToken()
      if (current) headers.set("Authorization", `Bearer ${current}`)
      return fetcher(`${base}${path}`, { ...init, headers })
    }

    async function loadMe() {
      const current = token()
      if (!current) {
        batch(() => {
          setUser("value", undefined)
          setStatus("anonymous")
        })
        return
      }
      setStatus("loading")
      try {
        const res = await request("/user/me")
        if (res.status === 401) {
          // The stored token is no longer valid on this server — drop it.
          batch(() => {
            persistToken(undefined)
            setUser("value", undefined)
            setStatus("anonymous")
          })
          return
        }
        if (!res.ok) throw new Error(`Failed to load account (${res.status})`)
        const data = (await res.json()) as AccountUser
        batch(() => {
          setUser("value", data)
          setStatus("authenticated")
        })
      } catch {
        // Network/transient error — keep the token, surface the last known
        // state so a flaky connection doesn't look like a logout.
        setStatus(token() ? "authenticated" : "anonymous")
      }
    }

    async function refreshStatus() {
      try {
        const res = await request("/user/status", { auth: false })
        if (!res.ok) return
        const data = (await res.json()) as { hasUsers: boolean }
        // When no users exist yet, the first registration is allowed without
        // an admin — expose that so the UI can offer account creation.
        setCanRegister(!data.hasUsers)
      } catch {
        setCanRegister(false)
      }
    }

    async function login(email: string, password: string) {
      setError(undefined)
      const res = await request("/user/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        const message = body?.error ?? `Sign in failed (${res.status})`
        setError(message)
        throw new Error(message)
      }
      const data = (await res.json()) as { token: string; user: AccountUser }
      batch(() => {
        persistToken(data.token)
        setUser("value", data.user)
        setStatus("authenticated")
        setError(undefined)
      })
    }

    async function loginWithOAuth() {
      if (!ready()) throw new Error("Account storage is not ready")
      setError(undefined)
      const authorization = await createAuthorizationRequest()
      setStore("pending", key(), authorization.pending)
      setStatus("loading")
      platform.openLink(authorization.url)
    }

    async function handleAuthCallback(input: string) {
      const callback = parseAuthCallback(input)
      if (!callback) return false
      if (!ready()) throw new Error("Account storage is not ready")
      const entry = Object.entries(store.pending).find(([, pending]) => pending.state === callback.state)
      if (!entry) throw new Error("OAuth callback state does not match the pending sign-in")
      const [target, pending] = entry
      setStore("pending", target, undefined as unknown as OAuthPending)
      if (Date.now() - pending.created > 10 * 60_000) throw new Error("OAuth sign-in expired; start again")
      if (callback.error) throw new Error(callback.error)
      if (!callback.code || !callback.state) throw new Error("OAuth callback is missing code or state")
      const next = await exchangeAuthorizationCode(callback.code, pending.verifier, oauthFetcher)
      persistToken(next, target)
      if (target === key()) await loadMe()
      return true
    }

    async function register(input: { username: string; email: string; password: string; displayName?: string }) {
      setError(undefined)
      const res = await request("/user/register", {
        method: "POST",
        auth: false,
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        const message = body?.error ?? `Account creation failed (${res.status})`
        setError(message)
        throw new Error(message)
      }
      const data = (await res.json()) as { token: string; user: AccountUser }
      batch(() => {
        persistToken(data.token)
        setUser("value", data.user)
        setStatus("authenticated")
        setError(undefined)
      })
    }

    async function logout() {
      try {
        await request("/user/logout", { method: "POST" })
      } catch {
        // Best-effort server revoke — the local token is cleared regardless.
      }
      batch(() => {
        persistToken(undefined)
        setUser("value", undefined)
        setStatus("anonymous")
        setError(undefined)
      })
    }

    // Re-resolve the account whenever the active server or its token changes so
    // the signed-in identity stays in sync with whatever server is connected.
    createEffect(() => {
      void key()
      void token()
      void loadMe()
    })

    const deepLinkEvent = "nikcli:deep-link"
    const receiveDeepLinks = (urls: string[]) => {
      if (!ready()) return
      for (const url of urls) {
        if (!parseAuthCallback(url)) continue
        void handleAuthCallback(url).catch((cause) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          batch(() => {
            setError(message)
            setStatus(token() ? "authenticated" : "anonymous")
          })
        })
      }
    }
    const onDeepLink = (event: Event) => {
      const detail = (event as CustomEvent<{ urls?: string[] }>).detail
      receiveDeepLinks(detail?.urls ?? [])
    }
    window.addEventListener(deepLinkEvent, onDeepLink)
    onCleanup(() => window.removeEventListener(deepLinkEvent, onDeepLink))
    createEffect(() => {
      if (!ready()) return
      const pending = window.__NIKCLI__?.deepLinks ?? []
      receiveDeepLinks(pending)
    })

    createEffect(() => {
      void key()
      if (server.url) void refreshStatus()
    })

    return {
      get status() {
        return status()
      },
      get user() {
        return user.value
      },
      get token() {
        return token()
      },
      get error() {
        return error()
      },
      get canRegister() {
        return canRegister()
      },
      get serverName() {
        return server.name
      },
      login,
      loginWithOAuth,
      register,
      logout,
      refresh: loadMe,
      getValidAccessToken,
      refreshAccessToken,
      get hasRefreshToken() {
        return isOAuthTokens(credentials())
      },
      clearError: () => setError(undefined),
    }
  },
})
