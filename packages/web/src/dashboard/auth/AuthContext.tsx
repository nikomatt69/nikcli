import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  DASHBOARD_USER_KEY,
  USER_TOKEN_KEY,
  clearDashboardSession,
  clearServerConfig,
  getErrorMessage,
  requestJson,
  resolveServerBase,
  saveServerConfig,
} from "../lib/studio-api"

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
  loading: boolean
  error: string | null
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
  setServerUrl(url: string): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(USER_TOKEN_KEY)
}

function getStoredUser(): User | null {
  if (typeof window === "undefined") return null
  try {
    const data = localStorage.getItem(DASHBOARD_USER_KEY)
    return data ? (JSON.parse(data) as User) : null
  } catch {
    return null
  }
}

function getStoredServerUrl(): string | null {
  const base = resolveServerBase()
  return base || null
}

function saveSession(token: string, user: User) {
  if (typeof window === "undefined") return
  localStorage.setItem(USER_TOKEN_KEY, token)
  localStorage.setItem(DASHBOARD_USER_KEY, JSON.stringify(user))
}

function clearSession() {
  clearDashboardSession()
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Start null on both server and client to prevent SSR hydration mismatch.
  // localStorage is read in the mount effect below.
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [serverUrl, setServerUrlState] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setServerUrl = useCallback((url: string) => {
    const normalized = url.trim()
    if (!normalized) {
      clearServerConfig()
      setServerUrlState(null)
    } else {
      setServerUrlState(saveServerConfig(normalized))
    }
    clearSession()
    setUser(null)
    setToken(null)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const baseUrl = isDev ? "" : resolveServerBase(serverUrl)
      if (!baseUrl && !isDev) {
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
        saveSession(data.token, data.user)
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
      const baseUrl = isDev ? "" : resolveServerBase(serverUrl)
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
      clearSession()
      setUser(null)
      setToken(null)
      setLoading(false)
    }
  }, [serverUrl, token])

  useEffect(() => {
    // Read from localStorage only on the client (after mount)
    const storedToken = getStoredToken()
    const storedUrl = getStoredServerUrl()
    const storedUser = getStoredUser()

    if (!storedToken || storedUrl === null) {
      // No session — state stays null, DashboardShell will redirect to login/setup
      setServerUrlState(storedUrl)
      return
    }

    // Restore immediately so UI doesn't flash to "not connected"
    setToken(storedToken)
    setServerUrlState(storedUrl)
    if (storedUser) setUser(storedUser)

    // Validate the token against the server in the background
    const baseUrl = isDev ? "" : storedUrl
    if (!baseUrl && !isDev) return
    requestJson<User>("/user/me", { token: storedToken, serverUrl: baseUrl })
      .then((user) => {
        setUser(user)
        localStorage.setItem(DASHBOARD_USER_KEY, JSON.stringify(user))
      })
      .catch((err) => {
        const status =
          typeof err === "object" && err && "status" in err ? Number((err as { status?: unknown }).status) : 0
        if (status === 401 || status === 403) {
          clearSession()
          setUser(null)
          setToken(null)
        }
      }) // network/server error — keep existing session
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, serverUrl, loading, error, login, logout, setServerUrl }),
    [user, token, serverUrl, loading, error, login, logout, setServerUrl],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
