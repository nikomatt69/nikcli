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
  loading: boolean
  error: string | null
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const TOKEN_KEY = "nikcli_dashboard_token"
const USER_KEY = "nikcli_dashboard_user"

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
  const [user, setUser] = useState<User | null>(() => getStoredUser())
  const [token, setToken] = useState<string | null>(() => getStoredToken())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/user/login", {
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
  }, [])

  const logout = useCallback(async () => {
    setLoading(true)
    try {
      await fetch("/user/logout", { method: "POST" }).catch(() => {})
    } finally {
      clearSession()
      setUser(null)
      setToken(null)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const storedToken = getStoredToken()
    if (storedToken && !getStoredUser()) {
      fetch("/user/me", { headers: { Authorization: `Bearer ${storedToken}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            setUser(data as User)
            setToken(storedToken)
            localStorage.setItem(USER_KEY, JSON.stringify(data))
          } else {
            clearSession()
            setUser(null)
            setToken(null)
          }
        })
        .catch(() => {
          clearSession()
          setUser(null)
          setToken(null)
        })
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, error, login, logout }),
    [user, token, loading, error, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
