import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  clearDashboardSession,
  clearServerConfig,
  getErrorMessage,
  getSharedToken,
  requestJson,
  resolveServerBase,
  saveServerConfig,
  saveSharedToken,
} from "../lib/studio-api"
import { beginOAuth, createStudioTokenClient, tokenStore } from "./oauth"

export interface User {
  id: string
  username: string
  email: string
  displayName?: string
  role: "admin" | "user"
}

interface AuthProviderProps {
  children: ReactNode
}

interface AuthContextValue {
  user: User | null
  token: string | null
  serverUrl: string | null
  /** True once a server URL + a token that the server accepts are present. */
  connected: boolean
  loading: boolean
  error: string | null
  /** Connect with the shared nikcli pairing token (Authorization: Bearer nkm_…). */
  connect(token: string): Promise<void>
  loginWithOAuth(): Promise<void>
  /** Legacy email/password sign-in (kept for back-compat; the server still supports it). */
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
  setServerUrl(url: string): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function getStoredServerUrl(): string | null {
  const base = resolveServerBase()
  return base || null
}

/** A lightweight identity derived from the active connection (the pairing token
 *  carries no user account), so display code that expects a `user` keeps working. */
function connectionIdentity(serverUrl: string | null): User {
  let label = "nikcli server"
  if (serverUrl) {
    try {
      label = new URL(serverUrl).host
    } catch {
      label = serverUrl
    }
  }
  return {
    id: "self",
    username: "nikcli",
    email: label,
    displayName: undefined,
    role: "user",
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Start null on both server and client to prevent SSR hydration mismatch.
  // Storage is read in the mount effect below.
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [serverUrl, setServerUrlState] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setServerUrl = useCallback((url: string) => {
    const normalized = url.trim()
    if (!normalized) {
      clearServerConfig()
      clearDashboardSession()
      setServerUrlState(null)
      setUser(null)
      setToken(null)
      return
    }
    setServerUrlState(saveServerConfig(normalized))
  }, [])

  // Validate the shared pairing token against an authorized endpoint (/config).
  const connect = useCallback(
    async (rawToken: string) => {
      const value = rawToken.trim()
      const baseUrl = resolveServerBase(serverUrl)
      if (!baseUrl) {
        setError("No server configured")
        throw new Error("No server configured")
      }
      if (!value) {
        setError("Paste your nikcli pairing token")
        throw new Error("Missing token")
      }
      setLoading(true)
      setError(null)
      try {
        // /config requires auth — a 200 proves the token is accepted by the server.
        await requestJson<unknown>("/config", {
          token: value,
          serverUrl: baseUrl,
        })
        saveSharedToken(value)
        setToken(value)
        setUser(connectionIdentity(baseUrl))
        window.posthog?.capture("studio_connected")
      } catch (err) {
        window.posthog?.captureException(err)
        setError(getErrorMessage(err) || "Could not connect with that token")
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverUrl],
  )

  const loginWithOAuth = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const redirectUri = new URL("/dashboard/callback", window.location.origin).toString()
      window.location.assign(await beginOAuth(redirectUri))
    } catch (err) {
      setError(getErrorMessage(err))
      setLoading(false)
      throw err
    }
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const baseUrl = resolveServerBase(serverUrl)
      if (!baseUrl) {
        setError("No server configured")
        throw new Error("No server configured")
      }
      setLoading(true)
      setError(null)
      try {
        const data = await requestJson<{ user: User; token: string }>("/user/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
          serverUrl: baseUrl,
        })
        saveSharedToken(data.token)
        setUser(data.user)
        setToken(data.token)
        window.posthog?.identify(data.user.id, {
          email: data.user.email,
          username: data.user.username,
          role: data.user.role,
        })
        window.posthog?.capture("user_signed_in", { role: data.user.role })
      } catch (err) {
        window.posthog?.captureException(err)
        setError(getErrorMessage(err) || "Login failed")
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverUrl],
  )

  const logout = useCallback(async () => {
    setLoading(true)
    try {
      const baseUrl = resolveServerBase(serverUrl)
      if (baseUrl && token) {
        await requestJson<{ ok: boolean }>("/user/logout", {
          method: "POST",
          token,
          serverUrl: baseUrl,
        }).catch(() => {})
      }
    } finally {
      window.posthog?.capture("user_signed_out")
      window.posthog?.reset()
      clearDashboardSession()
      await tokenStore.clear?.()
      setUser(null)
      setToken(null)
      setLoading(false)
    }
  }, [serverUrl, token])

  useEffect(() => {
    // Read from storage only on the client (after mount)
    const oauthClient = createStudioTokenClient()
    const oauthTokens = tokenStore.get()
    const storedToken = getSharedToken()
    const storedUrl = getStoredServerUrl()
    setServerUrlState(storedUrl)

    if (!storedUrl) {
      // Not connected — DashboardShell will show setup / connect
      return
    }

    if (oauthTokens) {
      const refreshIdentity = () =>
        oauthClient
          .getValidAccessToken()
          .then((access) => {
            saveSharedToken(access)
            setToken(access)
            return requestJson<User>("/user/me", {
              token: access,
              serverUrl: storedUrl,
            })
          })
          .then(setUser)
          .catch(() => {})
      void refreshIdentity()
      const timer = window.setInterval(refreshIdentity, 60_000)
      return () => window.clearInterval(timer)
    }

    // Restore immediately so the UI doesn't flash "not connected"
    if (!storedToken) {
      oauthClient
        .getValidAccessToken()
        .then((access) => {
          saveSharedToken(access)
          setToken(access)
          return requestJson<User>("/user/me", {
            token: access,
            serverUrl: storedUrl,
          })
        })
        .then(setUser)
        .catch(() => {})
      return
    }
    setToken(storedToken)
    setUser(connectionIdentity(storedUrl))

    const statusOf = (err: unknown) =>
      typeof err === "object" && err && "status" in err ? Number((err as { status?: unknown }).status) : 0

    // Validate in the background. Both credential types live in the SAME server DB:
    //   • an account session (nku_) resolves a real user via /user/me;
    //   • a pairing token (nkm_) has no user account, so fall back to /config.
    requestJson<User>("/user/me", { token: storedToken, serverUrl: storedUrl })
      .then((u) => setUser(u))
      .catch((err) => {
        if (statusOf(err) !== 401 && statusOf(err) !== 403) return // network error — keep session
        requestJson<unknown>("/config", {
          token: storedToken,
          serverUrl: storedUrl,
        })
          .then(() => setUser(connectionIdentity(storedUrl)))
          .catch((err2) => {
            if (statusOf(err2) === 401 || statusOf(err2) === 403) {
              clearDashboardSession()
              setUser(null)
              setToken(null)
            }
          })
      })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      serverUrl,
      connected: !!token,
      loading,
      error,
      connect,
      loginWithOAuth,
      login,
      logout,
      setServerUrl,
    }),
    [user, token, serverUrl, loading, error, connect, loginWithOAuth, login, logout, setServerUrl],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
