import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

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

const TOKEN_KEY = "nikcli_dashboard_token"
const USER_KEY = "nikcli_dashboard_user"
const SERVER_CONFIG_KEY = "nikcli_server_config"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true
const DEFAULT_SERVER_URL = (typeof import.meta !== "undefined" && (import.meta as any).env?.PROD_SERVER_URL) || ""

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

function getStoredUser(): User | null {
  if (typeof window === "undefined") return null
  try {
    const data = localStorage.getItem(USER_KEY)
    return data ? (JSON.parse(data) as User) : null
  } catch {
    return null
  }
}

function getStoredServerUrl(): string | null {
  if (typeof window === "undefined") return null
  // In dev mode, always use the Vite proxy (relative URLs)
  if (isDev) return ""
  try {
    const raw = localStorage.getItem(SERVER_CONFIG_KEY)
    if (!raw) return DEFAULT_SERVER_URL || null
    const cfg = JSON.parse(raw) as { url?: string }
    return cfg.url ? cfg.url.replace(/\/$/, "") : DEFAULT_SERVER_URL || null
  } catch {
    return DEFAULT_SERVER_URL || null
  }
}

function saveSession(token: string, user: User) {
  if (typeof window === "undefined") return
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

function clearSession() {
  if (typeof window === "undefined") return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
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
    const normalized = url.trim().replace(/\/$/, "")
    try {
      const existing = localStorage.getItem(SERVER_CONFIG_KEY)
      const cfg = existing ? JSON.parse(existing) : {}
      cfg.url = normalized
      localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(cfg))
    } catch {}
    setServerUrlState(normalized)
    clearSession()
    setUser(null)
    setToken(null)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const baseUrl = isDev ? "" : serverUrl || DEFAULT_SERVER_URL
      if (!baseUrl) {
        setError("No server configured")
        throw new Error("No server configured")
      }
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${baseUrl}/user/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
        const data = (await res.json()) as { error?: string; user: User; token: string }
        if (!res.ok) throw new Error(data.error || "Login failed")
        saveSession(data.token, data.user)
        setUser(data.user)
        setToken(data.token)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed")
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
      const baseUrl = isDev ? "" : serverUrl || DEFAULT_SERVER_URL
      if (baseUrl && token) {
        await fetch(`${baseUrl}/user/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {})
      }
    } finally {
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
    const baseUrl = isDev ? "" : storedUrl || DEFAULT_SERVER_URL
    if (!baseUrl) return
    fetch(`${baseUrl}/user/me`, { headers: { Authorization: `Bearer ${storedToken}` } })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          clearSession()
          setUser(null)
          setToken(null)
          return
        }
        if (!res.ok) return // server error — keep existing session
        return res.json().then((data) => {
          const user = data as User
          setUser(user)
          localStorage.setItem(USER_KEY, JSON.stringify(user))
        })
      })
      .catch(() => {}) // network error — keep existing session
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
